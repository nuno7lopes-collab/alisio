import fs from "node:fs/promises";
import path from "node:path";
import { getMemorySearchManager } from "alisio/plugin-sdk/memory-core-engine-runtime";
import {
  resolveCanonicalMemoryDailyNoteTarget,
  type AlisioConfig,
} from "alisio/plugin-sdk/memory-core-host-runtime-core";
import { appendFileWithinRoot } from "../infra/fs-safe.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory/daily-memory");

export function buildSessionMemoryDailyEntry(params: {
  nowMs: number;
  slug?: string | null;
  action: "new" | "reset";
  sessionKey: string;
  sessionId: string;
  source: string;
  sessionContent?: string | null;
}): string {
  const now = new Date(params.nowMs);
  const timeStr = now.toISOString().split("T")[1]?.split(".")[0] ?? "00:00:00";
  const normalizedSlug = params.slug?.trim();
  const fallbackSlug = timeStr.replace(/:/g, "").slice(0, 4);
  const headingSuffix =
    normalizedSlug && normalizedSlug !== fallbackSlug ? ` - ${normalizedSlug}` : "";
  const lines = [
    `## ${timeStr} UTC${headingSuffix}`,
    "",
    `- **Action**: /${params.action}`,
    `- **Session Key**: ${params.sessionKey}`,
    `- **Session ID**: ${params.sessionId}`,
    `- **Source**: ${params.source}`,
    "",
  ];
  const sessionContent = params.sessionContent?.trim();
  if (sessionContent) {
    lines.push("### Conversation Summary", "", sessionContent, "");
  }
  return lines.join("\n").trim();
}

export function resolveCanonicalDailyMemoryRelativePath(params: {
  cfg?: AlisioConfig;
  nowMs?: number;
}): string {
  return resolveCanonicalMemoryDailyNoteTarget(params).relativePath;
}

export async function readWorkspaceMemoryFileText(params: {
  workspaceDir: string;
  relativePath: string;
}): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(params.workspaceDir, params.relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function appendCanonicalDailyMemoryEntry(params: {
  cfg?: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  entry: string;
  nowMs?: number;
}): Promise<{ relativePath: string; absolutePath: string }> {
  const entry = params.entry.trim();
  const relativePath = resolveCanonicalDailyMemoryRelativePath({
    cfg: params.cfg,
    nowMs: params.nowMs,
  });
  const absolutePath = path.join(params.workspaceDir, relativePath);
  if (!entry) {
    return { relativePath, absolutePath };
  }

  const existing = await readWorkspaceMemoryFileText({
    workspaceDir: params.workspaceDir,
    relativePath,
  });
  const payload = existing && existing.trim().length > 0 ? `\n\n${entry}\n` : `${entry}\n`;
  await appendFileWithinRoot({
    rootDir: params.workspaceDir,
    relativePath,
    data: payload,
    encoding: "utf8",
    mkdir: true,
  });
  return { relativePath, absolutePath };
}

export async function syncDailyMemoryThroughCanonicalPipeline(params: {
  cfg: AlisioConfig;
  agentId: string;
  reason: string;
}): Promise<void> {
  const result = await getMemorySearchManager({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  if (!result.manager) {
    log.warn(`daily memory sync unavailable (${params.reason}): ${result.error ?? "no manager"}`);
    return;
  }

  const force = result.manager.status().dirty !== true;
  await result.manager.sync?.({
    reason: params.reason,
    force,
  });
}
