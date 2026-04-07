import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../../../../src/config/config.js";
import { resolveUserPath } from "../../../../src/utils.js";

export const OBSIDIAN_MEMORY_TOOL_PREFIX = "obsidian";
export const DEFAULT_OBSIDIAN_MEMORY_PATH = "Alisio Memory";
export const LEGACY_MEMORY_PATH = "memory";
export const OBSIDIAN_DAILY_SUBDIR = "daily";
export const OBSIDIAN_LONG_TERM_FILENAME = "long-term.md";

const DAILY_TAGS = ["alisio/memory", "alisio/daily"];
const LONG_TERM_TAGS = ["alisio/memory", "alisio/long-term"];

export type ResolvedObsidianMemoryLayout = {
  vaultRoot: string;
  memoryPath: string;
  memoryDir: string;
  dailyDir: string;
  longTermPath: string;
  toolRoot: string;
  longTermToolPath: string;
  usesExternalVault: boolean;
};

type ObsidianRollupEntry = {
  date: string;
  body: string;
  wikiLink: string;
};

function normalizePosixRelativePath(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${label} must not be empty`);
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error(`${label} must be a relative path`);
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new Error(`${label} must not be empty`);
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`${label} must not contain "." or ".." segments`);
  }
  return segments.join("/");
}

function resolveVaultRoot(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("memory.vaultPath must not be empty");
  }
  if (!trimmed.startsWith("~") && !path.isAbsolute(trimmed)) {
    throw new Error('memory.vaultPath must be absolute or start with "~"');
  }
  return path.normalize(resolveUserPath(trimmed));
}

function normalizeForContainment(target: string): string {
  return path.normalize(path.resolve(target));
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(normalizeForContainment(root), normalizeForContainment(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSamePath(a: string, b: string): boolean {
  return normalizeForContainment(a) === normalizeForContainment(b);
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) {
    return content;
  }
  return content.slice(end + 5);
}

function toWikiLinkPath(params: {
  layout: ResolvedObsidianMemoryLayout;
  absolutePath: string;
}): string {
  const relative = path
    .relative(params.layout.vaultRoot, params.absolutePath)
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "");
  return relative;
}

function formatYamlList(values: string[]): string[] {
  return values.flatMap((value) => [`  - ${value}`]);
}

function extractRollupBody(content: string, date: string): string {
  const withoutFrontmatter = stripFrontmatter(content).trim();
  if (!withoutFrontmatter) {
    return "";
  }
  const titleLine = `# Alisio Daily Memory ${date}`;
  if (withoutFrontmatter === titleLine) {
    return "";
  }
  if (withoutFrontmatter.startsWith(`${titleLine}\n`)) {
    return withoutFrontmatter.slice(titleLine.length).trim();
  }
  return withoutFrontmatter;
}

export function normalizeObsidianMemoryPath(raw: string): string {
  return normalizePosixRelativePath(raw, "memory.memoryPath");
}

export function resolveObsidianMemoryLayout(params: {
  cfg?: OpenClawConfig;
  workspaceDir: string;
}): ResolvedObsidianMemoryLayout | null {
  const rawVaultPath = params.cfg?.memory?.vaultPath?.trim();
  const rawMemoryPath = params.cfg?.memory?.memoryPath?.trim();
  const normalizedMemoryPath = rawMemoryPath ? normalizeObsidianMemoryPath(rawMemoryPath) : null;
  const vaultRoot = rawVaultPath ? resolveVaultRoot(rawVaultPath) : params.workspaceDir;
  const obsidianEnabled =
    Boolean(rawVaultPath) ||
    Boolean(normalizedMemoryPath && normalizedMemoryPath !== LEGACY_MEMORY_PATH);

  if (!obsidianEnabled) {
    return null;
  }

  const memoryPath =
    normalizedMemoryPath ?? (rawVaultPath ? DEFAULT_OBSIDIAN_MEMORY_PATH : LEGACY_MEMORY_PATH);
  const memoryDir = path.join(vaultRoot, ...memoryPath.split("/"));
  const dailyDir = path.join(memoryDir, OBSIDIAN_DAILY_SUBDIR);
  const longTermPath = path.join(memoryDir, OBSIDIAN_LONG_TERM_FILENAME);
  const toolRoot = `${OBSIDIAN_MEMORY_TOOL_PREFIX}/${memoryPath}`;

  return {
    vaultRoot,
    memoryPath,
    memoryDir,
    dailyDir,
    longTermPath,
    toolRoot,
    longTermToolPath: `${toolRoot}/${OBSIDIAN_LONG_TERM_FILENAME}`,
    usesExternalVault: !isSamePath(vaultRoot, params.workspaceDir),
  };
}

export function resolveObsidianDisplayPath(
  absolutePath: string,
  layout: ResolvedObsidianMemoryLayout | null,
): string | null {
  if (!layout || !isWithinRoot(layout.memoryDir, absolutePath)) {
    return null;
  }
  const relative = path.relative(layout.vaultRoot, absolutePath).replace(/\\/g, "/");
  return `${OBSIDIAN_MEMORY_TOOL_PREFIX}/${relative}`;
}

export function resolveObsidianToolPathForDate(
  layout: ResolvedObsidianMemoryLayout,
  date: string,
): string {
  return `${layout.toolRoot}/${OBSIDIAN_DAILY_SUBDIR}/${date}.md`;
}

export function resolveObsidianWritePathForDate(params: {
  layout: ResolvedObsidianMemoryLayout;
  date: string;
  workspaceDir: string;
}): string {
  const absolutePath = path.join(params.layout.dailyDir, `${params.date}.md`);
  if (params.layout.usesExternalVault) {
    return absolutePath;
  }
  return path.relative(params.workspaceDir, absolutePath).replace(/\\/g, "/");
}

export function resolveObsidianReadPath(params: {
  layout: ResolvedObsidianMemoryLayout | null;
  relPath: string;
}): string | null {
  const layout = params.layout;
  if (!layout) {
    return null;
  }
  const trimmed = params.relPath.trim();
  const prefix = `${OBSIDIAN_MEMORY_TOOL_PREFIX}/`;
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const relative = trimmed.slice(prefix.length);
  if (!relative) {
    throw new Error("invalid obsidian memory path");
  }
  const absolutePath = path.resolve(layout.vaultRoot, relative);
  if (!isWithinRoot(layout.memoryDir, absolutePath)) {
    throw new Error("obsidian memory path escapes configured memory directory");
  }
  if (!absolutePath.toLowerCase().endsWith(".md")) {
    throw new Error("path required");
  }
  return absolutePath;
}

export function buildObsidianDailyNoteSeed(date: string): string {
  return [
    "---",
    "alisio-memory: daily",
    `date: ${date}`,
    "tags:",
    ...formatYamlList(DAILY_TAGS),
    "---",
    "",
    `# Alisio Daily Memory ${date}`,
    "",
  ].join("\n");
}

function buildObsidianLongTermRollup(entries: ObsidianRollupEntry[]): string {
  return [
    "---",
    "alisio-memory: long-term",
    "tags:",
    ...formatYamlList(LONG_TERM_TAGS),
    "---",
    "",
    "# Alisio Long-Term Memory",
    "",
    "## Daily Rollup",
    "",
    ...entries.flatMap((entry) => [
      `### ${entry.date}`,
      `Source: [[${entry.wikiLink}]]`,
      "",
      entry.body,
      "",
    ]),
  ]
    .join("\n")
    .trimEnd()
    .concat("\n");
}

export async function syncObsidianLongTermMemoryRollup(params: {
  cfg?: OpenClawConfig;
  workspaceDir: string;
}): Promise<{ updated: boolean; path?: string }> {
  const layout = resolveObsidianMemoryLayout(params);
  if (!layout) {
    return { updated: false };
  }

  let files: string[] = [];
  try {
    const entries = await fs.readdir(layout.dailyDir, { withFileTypes: true });
    files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => path.join(layout.dailyDir, entry.name))
      .toSorted()
      .toReversed();
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { updated: false };
    }
    throw error;
  }

  const rollupEntries: ObsidianRollupEntry[] = [];
  for (const filePath of files) {
    const date = path.basename(filePath, ".md");
    const content = await fs.readFile(filePath, "utf-8");
    const body = extractRollupBody(content, date);
    if (!body) {
      continue;
    }
    rollupEntries.push({
      date,
      body,
      wikiLink: toWikiLinkPath({ layout, absolutePath: filePath }),
    });
  }

  if (rollupEntries.length === 0) {
    return { updated: false };
  }

  const nextContent = buildObsidianLongTermRollup(rollupEntries);
  let currentContent = "";
  try {
    currentContent = await fs.readFile(layout.longTermPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      throw error;
    }
  }

  if (currentContent === nextContent) {
    return { updated: false, path: layout.longTermPath };
  }

  await fs.mkdir(path.dirname(layout.longTermPath), { recursive: true });
  await fs.writeFile(layout.longTermPath, nextContent, "utf-8");
  return { updated: true, path: layout.longTermPath };
}
