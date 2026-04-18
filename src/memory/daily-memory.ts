import fs from "node:fs/promises";
import path from "node:path";
import { getMemorySearchManager } from "alisio/plugin-sdk/memory-core-engine-runtime";
import {
  resolveCanonicalMemoryBacklogNoteTarget,
  type AlisioConfig,
} from "alisio/plugin-sdk/memory-core-host-runtime-core";
import { writeFileWithinRoot } from "../infra/fs-safe.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory/daily-memory");

function humanizeSlug(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toYamlQuoted(value: string): string {
  return JSON.stringify(value);
}

function summarizeSessionContent(value: string | null | undefined): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) {
    return "Session snapshot pending promotion.";
  }
  return normalized.length <= 140 ? normalized : `${normalized.slice(0, 139).trimEnd()}…`;
}

function resolveUniqueBacklogRelativePath(
  existing: Set<string>,
  relativePath: string,
): string {
  if (!existing.has(relativePath)) {
    return relativePath;
  }
  const ext = path.posix.extname(relativePath) || ".md";
  const stem = relativePath.slice(0, -ext.length);
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem}-${index}${ext}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${stem}-${Date.now().toString(36)}${ext}`;
}

async function listExistingBacklogRelativePaths(params: {
  workspaceDir: string;
  relativeDir: string;
}): Promise<Set<string>> {
  const absoluteDir = path.join(params.workspaceDir, params.relativeDir);
  try {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    return new Set(
      entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.posix.join(params.relativeDir, entry.name).replace(/\\/g, "/")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

export function buildSessionMemoryBacklogNote(params: {
  cfg?: AlisioConfig;
  nowMs: number;
  slug?: string | null;
  action: "new" | "reset";
  sessionKey: string;
  sessionId: string;
  source: string;
  sessionContent?: string | null;
}): {
  title: string;
  relativePath: string;
  content: string;
} {
  const now = new Date(params.nowMs);
  const isoTimestamp = now.toISOString();
  const timeStr = isoTimestamp.split("T")[1]?.split(".")[0] ?? "00:00:00";
  const target = resolveCanonicalMemoryBacklogNoteTarget({
    cfg: params.cfg,
    nowMs: params.nowMs,
    slug: params.slug,
    title: params.slug,
  });
  const titleSuffix = humanizeSlug(target.slug) || `${timeStr} UTC`;
  const title = `Session ${params.action} - ${titleSuffix}`;
  const summary = summarizeSessionContent(params.sessionContent);
  const sessionContent = params.sessionContent?.trim();
  const lines = [
    "---",
    `summary: ${toYamlQuoted(summary)}`,
    "memoryRole: backlog",
    "backlogStatus: pending",
    `capturedAt: ${toYamlQuoted(isoTimestamp)}`,
    `sessionAction: ${toYamlQuoted(params.action)}`,
    `sessionKey: ${toYamlQuoted(params.sessionKey)}`,
    `sessionId: ${toYamlQuoted(params.sessionId)}`,
    `source: ${toYamlQuoted(params.source)}`,
    "tags:",
    "  - backlog",
    "  - session-memory",
    "---",
    `# ${title}`,
    "",
    "## Context",
    "",
    `- **Captured At**: ${isoTimestamp}`,
    `- **Action**: /${params.action}`,
    `- **Session Key**: ${params.sessionKey}`,
    `- **Session ID**: ${params.sessionId}`,
    `- **Source**: ${params.source}`,
    "",
    "## Conversation Summary",
    "",
  ];
  if (sessionContent) {
    lines.push(sessionContent, "");
  } else {
    lines.push("No transcript summary was available for this session snapshot.", "");
  }
  return {
    title,
    relativePath: target.relativePath,
    content: `${lines.join("\n").trim()}\n`,
  };
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

export async function writeCanonicalBacklogMemoryNote(params: {
  workspaceDir: string;
  note: ReturnType<typeof buildSessionMemoryBacklogNote>;
}): Promise<{ relativePath: string; absolutePath: string }> {
  const relativeDir =
    path.posix.dirname(params.note.relativePath).replace(/\\/g, "/") || "memory/backlog";
  const existing = await listExistingBacklogRelativePaths({
    workspaceDir: params.workspaceDir,
    relativeDir,
  });
  const relativePath = resolveUniqueBacklogRelativePath(existing, params.note.relativePath);
  await writeFileWithinRoot({
    rootDir: params.workspaceDir,
    relativePath,
    data: params.note.content,
    encoding: "utf8",
    mkdir: true,
  });
  return {
    relativePath,
    absolutePath: path.join(params.workspaceDir, relativePath),
  };
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
