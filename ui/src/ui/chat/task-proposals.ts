import type { TaskProposalDraft, TaskProposalRecord } from "../types.ts";

const TASK_PROPOSAL_BLOCK_RE = /```alisio-task\s*\n([\s\S]*?)```/gim;
const MAX_BLOCK_CHARS = 12_000;

type TaskProposalBlock = {
  cleanedMarkdown: string | null;
  proposals: TaskProposalDraft[];
};

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function normalizeAcceptance(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((entry) =>
        entry
          .replace(/^\s*[-*]\s*/, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function resolveSourceMessageId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const value = message as { id?: unknown; messageId?: unknown };
  if (
    (typeof value.id === "string" ||
      typeof value.id === "number" ||
      typeof value.id === "bigint") &&
    String(value.id).trim()
  ) {
    return String(value.id).trim();
  }
  if (
    (typeof value.messageId === "string" ||
      typeof value.messageId === "number" ||
      typeof value.messageId === "bigint") &&
    String(value.messageId).trim()
  ) {
    return String(value.messageId).trim();
  }
  return undefined;
}

function resolveProposalClientKey(message: unknown, rawBlock: string, ordinal: number): string {
  const sourceMessageId = resolveSourceMessageId(message);
  if (sourceMessageId) {
    return `msg:${sourceMessageId}:${ordinal}`;
  }
  const timestamp =
    message &&
    typeof message === "object" &&
    typeof (message as { timestamp?: unknown }).timestamp === "number"
      ? (message as { timestamp: number }).timestamp
      : 0;
  return `msg:${timestamp || "unknown"}:${stableHash(rawBlock)}:${ordinal}`;
}

function parseTaskProposalJson(
  raw: string,
  requesterSessionKey: string,
  message: unknown,
  ordinal: number,
): TaskProposalDraft | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_BLOCK_CHARS) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const proposal = parsed as Record<string, unknown>;
  const title =
    trimToUndefined(proposal.title) ??
    trimToUndefined(proposal.task) ??
    trimToUndefined(proposal.name);
  if (!title) {
    return null;
  }
  return {
    clientKey: resolveProposalClientKey(message, trimmed, ordinal),
    requesterSessionKey,
    ...(resolveSourceMessageId(message)
      ? { sourceMessageId: resolveSourceMessageId(message) }
      : {}),
    kind: proposal.kind === "project" ? "project" : "task",
    title,
    ...(trimToUndefined(proposal.summary) ? { summary: trimToUndefined(proposal.summary) } : {}),
    ...(trimToUndefined(proposal.rationale)
      ? { rationale: trimToUndefined(proposal.rationale) }
      : {}),
    acceptance: normalizeAcceptance(proposal.acceptance),
    ...(trimToUndefined(proposal.launchPrompt)
      ? { launchPrompt: trimToUndefined(proposal.launchPrompt) }
      : trimToUndefined(proposal.prompt)
        ? { launchPrompt: trimToUndefined(proposal.prompt) }
        : {}),
    ...(trimToUndefined(proposal.agentId) ? { agentId: trimToUndefined(proposal.agentId) } : {}),
    createdBy: "assistant",
  };
}

export function extractTaskProposalBlocks(params: {
  markdown: string;
  requesterSessionKey: string;
  message: unknown;
}): TaskProposalBlock {
  const proposals: TaskProposalDraft[] = [];
  let ordinal = 0;
  const cleaned = params.markdown.replace(TASK_PROPOSAL_BLOCK_RE, (match, body: string) => {
    const proposal = parseTaskProposalJson(
      body,
      params.requesterSessionKey,
      params.message,
      ordinal,
    );
    ordinal += 1;
    if (!proposal) {
      return match;
    }
    proposals.push(proposal);
    return "";
  });
  if (proposals.length === 0) {
    return {
      cleanedMarkdown: params.markdown,
      proposals: [],
    };
  }
  const normalized = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return {
    cleanedMarkdown: normalized || null,
    proposals,
  };
}

export function findPersistedTaskProposal(
  proposals: readonly TaskProposalRecord[] | null | undefined,
  draft: TaskProposalDraft,
): TaskProposalRecord | null {
  return (
    proposals?.find(
      (proposal) =>
        proposal.requesterSessionKey === draft.requesterSessionKey &&
        proposal.clientKey === draft.clientKey,
    ) ?? null
  );
}
