#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const forbiddenDirectoryMarkerPattern = /^#\s*forbidden-commit-dir:\s*([^|\s]+)\s*\|\s*(.+?)\s*$/u;

function usage() {
  console.error(
    "Usage: node scripts/check-forbidden-paths.mjs --tracked|--staged|--paths [--allow-deleted-tracked] <path...>",
  );
  process.exit(2);
}

export function parseForbiddenDirectoryReasonsFromGitignore(gitignoreContents) {
  const rules = new Map();

  for (const line of gitignoreContents.split(/\r?\n/u)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    const match = forbiddenDirectoryMarkerPattern.exec(trimmedLine);
    if (!match) {
      continue;
    }

    const [, directoryName, reason] = match;
    rules.set(directoryName, reason);
  }

  return rules;
}

export function resolveRepoRootFromGit(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

export function loadForbiddenDirectoryReasons(repoRoot = resolveRepoRootFromGit()) {
  const gitignorePath = resolve(repoRoot, ".gitignore");
  const rules = parseForbiddenDirectoryReasonsFromGitignore(readFileSync(gitignorePath, "utf8"));

  if (rules.size === 0) {
    throw new Error(
      `check-forbidden-paths: no forbidden-commit-dir entries found in ${gitignorePath}.`,
    );
  }

  return rules;
}

function splitNullSeparated(raw) {
  return raw
    .split("\0")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function gitListPaths(args) {
  const raw = execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return splitNullSeparated(raw);
}

export function normalizePathSeparators(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+/gu, "/");
}

export function resolveForbiddenDirectory(filePath, forbiddenDirectoryReasons) {
  const segments = normalizePathSeparators(filePath).split("/").filter(Boolean);
  for (const segment of segments) {
    if (forbiddenDirectoryReasons.has(segment)) {
      return segment;
    }
  }
  return null;
}

export function collectForbiddenPathViolations(files, forbiddenDirectoryReasons) {
  return files
    .map((filePath) => {
      const forbiddenDirectory = resolveForbiddenDirectory(filePath, forbiddenDirectoryReasons);
      if (forbiddenDirectory === null) {
        return null;
      }

      return {
        filePath,
        reason: forbiddenDirectoryReasons.get(forbiddenDirectory),
      };
    })
    .filter(Boolean);
}

function listPaths(mode, extraArgs) {
  if (mode === "--tracked") {
    return gitListPaths(["ls-files", "-z"]);
  }
  if (mode === "--staged") {
    return gitListPaths(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
  }
  if (mode === "--paths") {
    const allowDeletedTracked = extraArgs[0] === "--allow-deleted-tracked";
    const rawPaths = allowDeletedTracked ? extraArgs.slice(1) : extraArgs;
    if (rawPaths.length === 0) {
      usage();
    }
    return rawPaths.filter((filePath) => {
      if (!allowDeletedTracked) {
        return true;
      }
      if (existsSync(filePath)) {
        return true;
      }
      try {
        gitListPaths(["ls-files", "--error-unmatch", "--", filePath]);
        return false;
      } catch {
        return true;
      }
    });
  }
  usage();
  return [];
}

function main() {
  const mode = process.argv[2];
  const extraArgs = process.argv.slice(3);
  if (!mode) {
    usage();
  }

  if ((mode === "--tracked" || mode === "--staged") && extraArgs.length !== 0) {
    usage();
  }

  const files = listPaths(mode, extraArgs);
  let forbiddenDirectoryReasons;
  try {
    forbiddenDirectoryReasons = loadForbiddenDirectoryReasons();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(2);
  }

  const cleanScopeLabel =
    mode === "--tracked" ? "tracked" : mode === "--staged" ? "staged" : "provided";
  const violationScopeLabel =
    mode === "--tracked"
      ? "tracked files"
      : mode === "--staged"
        ? "staged files"
        : "provided paths";
  const violations = collectForbiddenPathViolations(files, forbiddenDirectoryReasons);

  if (violations.length === 0) {
    console.log(`check-forbidden-paths: ${cleanScopeLabel} paths look clean.`);
    return;
  }

  console.error(
    `check-forbidden-paths: forbidden ${violationScopeLabel} detected from .gitignore markers:`,
  );
  for (const violation of violations) {
    console.error(`  - ${violation.filePath} (${violation.reason})`);
  }
  process.exit(1);
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  main();
}
