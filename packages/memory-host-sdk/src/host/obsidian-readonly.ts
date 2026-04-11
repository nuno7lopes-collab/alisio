import fs from "node:fs/promises";
import path from "node:path";
import type { AlisioConfig } from "../../../../src/config/config.js";
import { resolveUserPath } from "../../../../src/utils.js";

export const OBSIDIAN_READONLY_TOOL_PREFIX = "obsidian-vault";
export const DEFAULT_OBSIDIAN_READONLY_MAX_FILES = 2000;
export const DEFAULT_OBSIDIAN_READONLY_MAX_FILE_BYTES = 1024 * 1024;

export type ResolvedObsidianReadOnlyVault = {
  vaultRoot: string;
  maxFiles: number;
  maxFileBytes: number;
};

export type ObsidianReadOnlyVaultFile = {
  absPath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
};

export type ObsidianReadOnlyVaultScanResult = {
  enabled: true;
  active: boolean;
  vaultPath: string;
  indexedFiles: number;
  skippedLargeFiles: number;
  maxFiles: number;
  maxFileBytes: number;
  error?: string;
  files?: ObsidianReadOnlyVaultFile[];
};

type LegacyObsidianReadOnlyConfig = {
  obsidianReadOnly?: {
    enabled?: boolean;
    vaultPath?: string;
  };
};

function resolveVaultRoot(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("memory.obsidianReadOnly.vaultPath must not be empty");
  }
  if (!trimmed.startsWith("~") && !path.isAbsolute(trimmed)) {
    throw new Error('memory.obsidianReadOnly.vaultPath must be absolute or start with "~"');
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

function shouldSkipVaultEntry(name: string): boolean {
  return name === ".obsidian" || name.startsWith(".");
}

function normalizeRelativePath(raw: string): string {
  const normalized = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    throw new Error("invalid obsidian vault path");
  }
  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "." || segment === ".." || segment === ".obsidian" || segment.startsWith("."),
    )
  ) {
    throw new Error("invalid obsidian vault path");
  }
  return segments.join("/");
}

export function resolveObsidianReadOnlyVault(params: {
  cfg?: AlisioConfig;
}): ResolvedObsidianReadOnlyVault | null {
  const legacyMemory = params.cfg?.memory as LegacyObsidianReadOnlyConfig | undefined;
  const connector = legacyMemory?.obsidianReadOnly;
  if (!connector?.enabled) {
    return null;
  }
  const rawVaultPath = connector.vaultPath?.trim();
  if (!rawVaultPath) {
    return null;
  }
  return {
    vaultRoot: resolveVaultRoot(rawVaultPath),
    maxFiles: DEFAULT_OBSIDIAN_READONLY_MAX_FILES,
    maxFileBytes: DEFAULT_OBSIDIAN_READONLY_MAX_FILE_BYTES,
  };
}

export function resolveObsidianReadOnlyDisplayPath(
  absolutePath: string,
  vault: ResolvedObsidianReadOnlyVault | null,
): string | null {
  if (!vault || !isWithinRoot(vault.vaultRoot, absolutePath)) {
    return null;
  }
  const relative = path.relative(vault.vaultRoot, absolutePath).replace(/\\/g, "/");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return `${OBSIDIAN_READONLY_TOOL_PREFIX}/${relative}`;
}

export function resolveObsidianReadOnlyReadPath(params: {
  vault: ResolvedObsidianReadOnlyVault | null;
  relPath: string;
}): string | null {
  const vault = params.vault;
  if (!vault) {
    return null;
  }
  const trimmed = params.relPath.trim();
  const prefix = `${OBSIDIAN_READONLY_TOOL_PREFIX}/`;
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const relative = normalizeRelativePath(trimmed.slice(prefix.length));
  const absolutePath = path.resolve(vault.vaultRoot, relative);
  if (!isWithinRoot(vault.vaultRoot, absolutePath)) {
    throw new Error("obsidian vault path escapes configured vault root");
  }
  if (!absolutePath.toLowerCase().endsWith(".md")) {
    throw new Error("path required");
  }
  return absolutePath;
}

export async function scanObsidianReadOnlyVault(params: {
  vault: ResolvedObsidianReadOnlyVault;
  includeFiles?: boolean;
}): Promise<ObsidianReadOnlyVaultScanResult> {
  const { vault } = params;
  let rootRealPath: string;
  try {
    const stat = await fs.lstat(vault.vaultRoot);
    if (!stat.isDirectory()) {
      return {
        enabled: true,
        active: false,
        vaultPath: vault.vaultRoot,
        indexedFiles: 0,
        skippedLargeFiles: 0,
        maxFiles: vault.maxFiles,
        maxFileBytes: vault.maxFileBytes,
        error: "Obsidian vault path is not a directory",
      };
    }
    rootRealPath = await fs.realpath(vault.vaultRoot);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return {
      enabled: true,
      active: false,
      vaultPath: vault.vaultRoot,
      indexedFiles: 0,
      skippedLargeFiles: 0,
      maxFiles: vault.maxFiles,
      maxFileBytes: vault.maxFileBytes,
      error:
        code === "ENOENT"
          ? "Obsidian vault path does not exist"
          : `Obsidian vault is not accessible (${code ?? "error"})`,
    };
  }

  let indexedFiles = 0;
  let totalMarkdownFiles = 0;
  let skippedLargeFiles = 0;
  const files: ObsidianReadOnlyVaultFile[] | undefined = params.includeFiles ? [] : undefined;
  const queue: Array<{ absPath: string; relativePath: string }> = [
    { absPath: vault.vaultRoot, relativePath: "" },
  ];

  while (queue.length > 0) {
    const nextDir = queue.pop()!;
    let entries;
    try {
      entries = await fs.readdir(nextDir.absPath, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      return {
        enabled: true,
        active: false,
        vaultPath: vault.vaultRoot,
        indexedFiles: 0,
        skippedLargeFiles: 0,
        maxFiles: vault.maxFiles,
        maxFileBytes: vault.maxFileBytes,
        error: `Obsidian vault is not accessible (${code ?? "error"})`,
      };
    }

    for (const entry of entries) {
      if (shouldSkipVaultEntry(entry.name) || entry.isSymbolicLink()) {
        continue;
      }
      const absPath = path.join(nextDir.absPath, entry.name);
      let realPath = absPath;
      try {
        realPath = await fs.realpath(absPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") {
          continue;
        }
      }
      if (!isWithinRoot(rootRealPath, realPath)) {
        continue;
      }

      const relativePath = nextDir.relativePath
        ? `${nextDir.relativePath}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        queue.push({ absPath, relativePath });
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }

      totalMarkdownFiles += 1;
      if (totalMarkdownFiles > vault.maxFiles) {
        return {
          enabled: true,
          active: false,
          vaultPath: vault.vaultRoot,
          indexedFiles: 0,
          skippedLargeFiles: 0,
          maxFiles: vault.maxFiles,
          maxFileBytes: vault.maxFileBytes,
          error: `Obsidian vault exceeds the ${vault.maxFiles} Markdown file limit`,
        };
      }

      let stat;
      try {
        stat = await fs.stat(absPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") {
          continue;
        }
        return {
          enabled: true,
          active: false,
          vaultPath: vault.vaultRoot,
          indexedFiles: 0,
          skippedLargeFiles: 0,
          maxFiles: vault.maxFiles,
          maxFileBytes: vault.maxFileBytes,
          error: `Obsidian vault is not accessible (${code ?? "error"})`,
        };
      }
      if (!stat.isFile()) {
        continue;
      }
      if (stat.size > vault.maxFileBytes) {
        skippedLargeFiles += 1;
        continue;
      }

      indexedFiles += 1;
      files?.push({
        absPath,
        relativePath: relativePath.replace(/\\/g, "/"),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  return {
    enabled: true,
    active: true,
    vaultPath: vault.vaultRoot,
    indexedFiles,
    skippedLargeFiles,
    maxFiles: vault.maxFiles,
    maxFileBytes: vault.maxFileBytes,
    ...(files ? { files } : {}),
  };
}
