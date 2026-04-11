import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type {
  TranscriptRewriteReplacement,
  TranscriptRewriteRequest,
  TranscriptRewriteResult,
} from "../../context-engine/types.js";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import { getRawSessionAppendMessage } from "../session-tool-result-guard.js";
import { acquireSessionWriteLock } from "../session-write-lock.js";
import { log } from "./logger.js";

type SessionManagerLike = ReturnType<typeof SessionManager.open>;
type SessionBranchEntry = ReturnType<SessionManagerLike["getBranch"]>[number];

export type TranscriptLeafRestoreResult = {
  changed: boolean;
  previousLeafId: string | null;
  restoredToEntryId: string | null;
  reason?: string;
};

function estimateMessageBytes(message: AgentMessage): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

function remapEntryId(
  entryId: string | null | undefined,
  rewrittenEntryIds: ReadonlyMap<string, string>,
): string | null {
  if (!entryId) {
    return null;
  }
  return rewrittenEntryIds.get(entryId) ?? entryId;
}

function appendBranchEntry(params: {
  sessionManager: SessionManagerLike;
  entry: SessionBranchEntry;
  rewrittenEntryIds: ReadonlyMap<string, string>;
  appendMessage: SessionManagerLike["appendMessage"];
}): string {
  const { sessionManager, entry, rewrittenEntryIds, appendMessage } = params;
  if (entry.type === "message") {
    return appendMessage(entry.message as Parameters<typeof sessionManager.appendMessage>[0]);
  }
  if (entry.type === "compaction") {
    return sessionManager.appendCompaction(
      entry.summary,
      remapEntryId(entry.firstKeptEntryId, rewrittenEntryIds) ?? entry.firstKeptEntryId,
      entry.tokensBefore,
      entry.details,
      entry.fromHook,
    );
  }
  if (entry.type === "thinking_level_change") {
    return sessionManager.appendThinkingLevelChange(entry.thinkingLevel);
  }
  if (entry.type === "model_change") {
    return sessionManager.appendModelChange(entry.provider, entry.modelId);
  }
  if (entry.type === "custom") {
    return sessionManager.appendCustomEntry(entry.customType, entry.data);
  }
  if (entry.type === "custom_message") {
    return sessionManager.appendCustomMessageEntry(
      entry.customType,
      entry.content,
      entry.display,
      entry.details,
    );
  }
  if (entry.type === "session_info") {
    if (entry.name) {
      return sessionManager.appendSessionInfo(entry.name);
    }
    return sessionManager.appendSessionInfo("");
  }
  if (entry.type === "branch_summary") {
    return sessionManager.branchWithSummary(
      remapEntryId(entry.parentId, rewrittenEntryIds),
      entry.summary,
      entry.details,
      entry.fromHook,
    );
  }
  return sessionManager.appendLabelChange(
    remapEntryId(entry.targetId, rewrittenEntryIds) ?? entry.targetId,
    entry.label,
  );
}

export function restoreTranscriptLeafInSessionManager(params: {
  sessionManager: SessionManagerLike;
  targetEntryId: string | null;
}): TranscriptLeafRestoreResult {
  const previousLeafId =
    (params.sessionManager.getLeafEntry() as { id?: string } | null | undefined)?.id ?? null;
  if (previousLeafId === params.targetEntryId) {
    return {
      changed: false,
      previousLeafId,
      restoredToEntryId: params.targetEntryId,
      reason: "already at requested transcript leaf",
    };
  }

  if (params.targetEntryId === null) {
    params.sessionManager.resetLeaf();
    return {
      changed: true,
      previousLeafId,
      restoredToEntryId: null,
    };
  }

  const branch = params.sessionManager.getBranch();
  const targetExists = branch.some((entry) => entry.id === params.targetEntryId);
  if (!targetExists) {
    return {
      changed: false,
      previousLeafId,
      restoredToEntryId: params.targetEntryId,
      reason: "requested transcript leaf not found on active branch",
    };
  }

  params.sessionManager.branch(params.targetEntryId);
  return {
    changed: true,
    previousLeafId,
    restoredToEntryId: params.targetEntryId,
  };
}

/**
 * Safely rewrites transcript message entries on the active branch by branching
 * from the first rewritten message's parent and re-appending the suffix.
 */
export function rewriteTranscriptEntriesInSessionManager(params: {
  sessionManager: SessionManagerLike;
  replacements: TranscriptRewriteReplacement[];
}): TranscriptRewriteResult {
  const replacementsById = new Map(
    params.replacements
      .filter((replacement) => replacement.entryId.trim().length > 0)
      .map((replacement) => [replacement.entryId, replacement.message]),
  );
  if (replacementsById.size === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no replacements requested",
    };
  }

  const branch = params.sessionManager.getBranch();
  if (branch.length === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "empty session",
    };
  }

  const matchedIndices: number[] = [];
  let bytesFreed = 0;

  for (let index = 0; index < branch.length; index++) {
    const entry = branch[index];
    if (entry.type !== "message") {
      continue;
    }
    const replacement = replacementsById.get(entry.id);
    if (!replacement) {
      continue;
    }
    const originalBytes = estimateMessageBytes(entry.message);
    const replacementBytes = estimateMessageBytes(replacement);
    matchedIndices.push(index);
    bytesFreed += Math.max(0, originalBytes - replacementBytes);
  }

  if (matchedIndices.length === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no matching message entries",
    };
  }

  const firstMatchedEntry = branch[matchedIndices[0]] as
    | Extract<SessionBranchEntry, { type: "message" }>
    | undefined;
  // matchedIndices only contains indices of branch "message" entries.
  if (!firstMatchedEntry) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "invalid first rewrite target",
    };
  }

  if (!firstMatchedEntry.parentId) {
    params.sessionManager.resetLeaf();
  } else {
    params.sessionManager.branch(firstMatchedEntry.parentId);
  }

  // Maintenance rewrites should preserve the exact requested history without
  // re-running persistence hooks or size truncation on replayed messages.
  const appendMessage = getRawSessionAppendMessage(params.sessionManager);
  const rewrittenEntryIds = new Map<string, string>();
  for (let index = matchedIndices[0]; index < branch.length; index++) {
    const entry = branch[index];
    const replacement = entry.type === "message" ? replacementsById.get(entry.id) : undefined;
    const newEntryId =
      replacement === undefined
        ? appendBranchEntry({
            sessionManager: params.sessionManager,
            entry,
            rewrittenEntryIds,
            appendMessage,
          })
        : appendMessage(replacement as Parameters<typeof params.sessionManager.appendMessage>[0]);
    rewrittenEntryIds.set(entry.id, newEntryId);
  }

  return {
    changed: true,
    bytesFreed,
    rewrittenEntries: matchedIndices.length,
  };
}

/**
 * Open a transcript file, rewrite message entries on the active branch, and
 * emit a transcript update when the active branch changed.
 */
export async function rewriteTranscriptEntriesInSessionFile(params: {
  sessionFile: string;
  sessionId?: string;
  sessionKey?: string;
  request: TranscriptRewriteRequest;
}): Promise<TranscriptRewriteResult> {
  let sessionLock: Awaited<ReturnType<typeof acquireSessionWriteLock>> | undefined;
  try {
    sessionLock = await acquireSessionWriteLock({
      sessionFile: params.sessionFile,
    });
    const sessionManager = SessionManager.open(params.sessionFile);
    const result = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: params.request.replacements,
    });
    if (result.changed) {
      emitSessionTranscriptUpdate(params.sessionFile);
      log.info(
        `[transcript-rewrite] rewrote ${result.rewrittenEntries} entr` +
          `${result.rewrittenEntries === 1 ? "y" : "ies"} ` +
          `bytesFreed=${result.bytesFreed} ` +
          `sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
      );
    }
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn(`[transcript-rewrite] failed: ${reason}`);
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason,
    };
  } finally {
    await sessionLock?.release();
  }
}

export async function restoreTranscriptLeafInSessionFile(params: {
  sessionFile: string;
  sessionId?: string;
  sessionKey?: string;
  targetEntryId: string | null;
}): Promise<TranscriptLeafRestoreResult> {
  let sessionLock: Awaited<ReturnType<typeof acquireSessionWriteLock>> | undefined;
  try {
    sessionLock = await acquireSessionWriteLock({
      sessionFile: params.sessionFile,
    });
    const sessionManager = SessionManager.open(params.sessionFile);
    const result = restoreTranscriptLeafInSessionManager({
      sessionManager,
      targetEntryId: params.targetEntryId,
    });
    if (result.changed) {
      emitSessionTranscriptUpdate(params.sessionFile);
      log.info(
        `[transcript-rewind] restored leaf from ${result.previousLeafId ?? "root"} to ` +
          `${result.restoredToEntryId ?? "root"} ` +
          `sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
      );
    }
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn(`[transcript-rewind] failed: ${reason}`);
    return {
      changed: false,
      previousLeafId: null,
      restoredToEntryId: params.targetEntryId,
      reason,
    };
  } finally {
    await sessionLock?.release();
  }
}
