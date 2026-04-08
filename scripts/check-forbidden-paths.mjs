#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const forbiddenDirectoryReasons = new Map([
  ["node_modules", "runtime dependency artifacts must never be committed"],
  [".build", "build output must never be committed"],
  [".build-local", "local build output must never be committed"],
  ["dist", "generated distribution output must never be committed"],
  ["dist-runtime", "generated runtime packaging output must never be committed"],
  ["coverage", "coverage output must never be committed"],
]);

function usage() {
  console.error(
    "Usage: node scripts/check-forbidden-paths.mjs --tracked|--staged|--paths [--allow-deleted-tracked] <path...>",
  );
  process.exit(2);
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

function normalizePathSeparators(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+/gu, "/");
}

function resolveForbiddenDirectory(filePath) {
  const segments = normalizePathSeparators(filePath).split("/").filter(Boolean);
  for (const segment of segments) {
    if (forbiddenDirectoryReasons.has(segment)) {
      return segment;
    }
  }
  return null;
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
  const cleanScopeLabel =
    mode === "--tracked" ? "tracked" : mode === "--staged" ? "staged" : "provided";
  const violationScopeLabel =
    mode === "--tracked"
      ? "tracked files"
      : mode === "--staged"
        ? "staged files"
        : "provided paths";
  const violations = files
    .map((filePath) => {
      const forbiddenDirectory = resolveForbiddenDirectory(filePath);
      if (forbiddenDirectory === null) {
        return null;
      }
      return {
        filePath,
        reason: forbiddenDirectoryReasons.get(forbiddenDirectory),
      };
    })
    .filter(Boolean);

  if (violations.length === 0) {
    console.log(`check-forbidden-paths: ${cleanScopeLabel} paths look clean.`);
    return;
  }

  console.error(`check-forbidden-paths: forbidden ${violationScopeLabel} detected:`);
  for (const violation of violations) {
    console.error(`  - ${violation.filePath} (${violation.reason})`);
  }
  process.exit(1);
}

main();
