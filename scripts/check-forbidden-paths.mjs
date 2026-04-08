#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const forbiddenDirectoryReasons = new Map([
  ["node_modules", "runtime dependency artifacts must never be committed"],
  [".build", "build output must never be committed"],
  [".build-local", "local build output must never be committed"],
  ["dist", "generated distribution output must never be committed"],
  ["dist-runtime", "generated runtime packaging output must never be committed"],
  ["coverage", "coverage output must never be committed"],
]);

function usage() {
  console.error("Usage: node scripts/check-forbidden-paths.mjs --tracked|--staged");
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

function listPaths(mode) {
  if (mode === "--tracked") {
    return gitListPaths(["ls-files", "-z"]);
  }
  if (mode === "--staged") {
    return gitListPaths(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
  }
  usage();
  return [];
}

function main() {
  const mode = process.argv[2];
  if (!mode || process.argv.length !== 3) {
    usage();
  }

  const files = listPaths(mode);
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
    const scopeLabel = mode === "--tracked" ? "tracked" : "staged";
    console.log(`check-forbidden-paths: ${scopeLabel} paths look clean.`);
    return;
  }

  const scopeLabel = mode === "--tracked" ? "tracked files" : "staged files";
  console.error(`check-forbidden-paths: forbidden ${scopeLabel} detected:`);
  for (const violation of violations) {
    console.error(`  - ${violation.filePath} (${violation.reason})`);
  }
  process.exit(1);
}

main();
