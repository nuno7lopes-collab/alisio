import fs from "node:fs";
import path from "node:path";
import { DEFAULT_AGENTS_FILENAME } from "../agents/workspace.js";
import type { AlisioConfig } from "../config/config.js";
import { resolveObsidianMemoryLayout } from "../plugin-sdk/memory-core-host-runtime-files.js";
import { shortenHomePath } from "../utils.js";

const DEFAULT_OBSIDIAN_MEMORY_PATH = "Alisio Memory";

export const MEMORY_SYSTEM_PROMPT = [
  "Memory system not found in workspace.",
  "Paste this into your agent:",
  "",
  "Install the memory system by applying:",
  "https://github.com/openclaw/openclaw/commit/9ffea23f31ca1df5183b25668f8f814bee0fb34e",
  "https://github.com/openclaw/openclaw/commit/7d1fee70e76f2f634f1b41fca927ee663914183a",
].join("\n");

export async function shouldSuggestMemorySystem(params: {
  workspaceDir: string;
  cfg?: AlisioConfig;
}): Promise<boolean> {
  const workspaceDir = params.workspaceDir;
  if (resolveObsidianMemoryLayout({ cfg: params.cfg, workspaceDir })) {
    return false;
  }
  const memoryPaths = [path.join(workspaceDir, "MEMORY.md"), path.join(workspaceDir, "memory.md")];
  const obsidianMemoryPaths = [
    path.join(workspaceDir, DEFAULT_OBSIDIAN_MEMORY_PATH),
    path.join(workspaceDir, DEFAULT_OBSIDIAN_MEMORY_PATH, "long-term.md"),
  ];

  for (const memoryPath of [...memoryPaths, ...obsidianMemoryPaths]) {
    try {
      await fs.promises.access(memoryPath);
      return false;
    } catch {
      // keep scanning
    }
  }

  const agentsPath = path.join(workspaceDir, DEFAULT_AGENTS_FILENAME);
  try {
    const content = await fs.promises.readFile(agentsPath, "utf-8");
    if (/memory\.md/i.test(content)) {
      return false;
    }
  } catch {
    // no AGENTS.md or unreadable; treat as missing memory guidance
  }

  return true;
}

export type LegacyWorkspaceDetection = {
  activeWorkspace: string;
  legacyDirs: string[];
};

export function detectLegacyWorkspaceDirs(params: {
  workspaceDir: string;
}): LegacyWorkspaceDetection {
  const activeWorkspace = path.resolve(params.workspaceDir);
  const legacyDirs: string[] = [];
  return { activeWorkspace, legacyDirs };
}

export function formatLegacyWorkspaceWarning(detection: LegacyWorkspaceDetection): string {
  return [
    "Extra workspace directories detected (may contain old agent files):",
    ...detection.legacyDirs.map((dir) => `- ${shortenHomePath(dir)}`),
    `Active workspace: ${shortenHomePath(detection.activeWorkspace)}`,
    "If unused, archive or move to Trash.",
  ].join("\n");
}
