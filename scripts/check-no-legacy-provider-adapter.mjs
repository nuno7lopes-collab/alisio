#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GUARDED_PROVIDER_ADAPTER_PATHS = [
  "src/provider-adapters/provider-adapter.ts",
  "src/provider-adapters/alisio-provider-adapters.ts",
  "src/agents/alisio-provider-stream.ts",
  "src/infra/alisio-model-providers.ts",
];

const LEGACY_LOCAL_PROVIDER = ["ol", "lama"].join("");
const LEGACY_LOCAL_RUNTIME = ["lm", "studio"].join("");

export const BLOCKED_LEGACY_PROVIDER_ADAPTER_PATTERNS = [
  {
    label: LEGACY_LOCAL_PROVIDER,
    pattern: new RegExp(String.raw`(?<!server-)\b` + LEGACY_LOCAL_PROVIDER + String.raw`\b`, "iu"),
  },
  {
    label: LEGACY_LOCAL_RUNTIME,
    pattern: new RegExp(String.raw`\b` + LEGACY_LOCAL_RUNTIME + String.raw`\b`, "iu"),
  },
  { label: "openai-compatible", pattern: /\bopenai-compatible\b/iu },
  { label: "local servers", pattern: /\blocal servers?\b/iu },
  {
    label: "legacy remote endpoint copy",
    pattern: new RegExp(String.raw`\bremote ` + "model " + String.raw`servers?\b`, "iu"),
  },
  {
    label: "legacy model state field",
    pattern: new RegExp(String.raw`\bmodel` + String.raw`Servers\b`, "u"),
  },
  {
    label: ["legacy server ", LEGACY_LOCAL_PROVIDER, " token"].join(""),
    pattern: new RegExp(String.raw`\bserver-` + LEGACY_LOCAL_PROVIDER + String.raw`\b`, "iu"),
  },
  {
    label: "legacy server openai token",
    pattern: new RegExp(String.raw`\bserver-` + "openai" + String.raw`\b`, "iu"),
  },
];

function toLineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/u).length;
}

export function collectNoLegacyProviderAdapterViolationsFromEntries(
  entries,
  patterns = BLOCKED_LEGACY_PROVIDER_ADAPTER_PATTERNS,
) {
  const violations = [];
  for (const entry of entries) {
    for (const { label, pattern } of patterns) {
      const globalPattern = new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
      );
      for (const match of entry.content.matchAll(globalPattern)) {
        const index = match.index ?? 0;
        violations.push({
          filePath: entry.filePath,
          label,
          line: toLineNumber(entry.content, index),
        });
      }
    }
  }
  return violations;
}

export function listTrackedGuardedProviderAdapterFiles(
  cwd = process.cwd(),
  guardedPaths = GUARDED_PROVIDER_ADAPTER_PATHS,
) {
  const output = execFileSync("git", ["ls-files", "-z", "--", ...guardedPaths], {
    cwd,
    encoding: "utf8",
  });
  return output
    .split("\0")
    .filter(Boolean)
    .map((relativePath) => path.join(cwd, relativePath));
}

export function collectNoLegacyProviderAdapterViolations(filePaths, readFile = fs.readFileSync) {
  return collectNoLegacyProviderAdapterViolationsFromEntries(
    filePaths.map((filePath) => ({
      filePath,
      content: readFile(filePath, "utf8"),
    })),
  );
}

export async function main() {
  const cwd = process.cwd();
  const filePaths = listTrackedGuardedProviderAdapterFiles(cwd);
  const violations = collectNoLegacyProviderAdapterViolations(filePaths);

  if (violations.length === 0) {
    console.log("check-no-legacy-provider-adapter: guarded provider adapter surfaces look clean.");
    return;
  }

  console.error("check-no-legacy-provider-adapter: blocked legacy provider tokens detected:");
  for (const violation of violations) {
    const relativePath = path.relative(cwd, violation.filePath) || violation.filePath;
    console.error(`- ${relativePath}:${violation.line} (${violation.label})`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
