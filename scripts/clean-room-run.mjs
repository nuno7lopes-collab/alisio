#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function usage() {
  console.error(`Usage:
  node scripts/clean-room-run.mjs [options] -- <command> [args...]

Options:
  --include <path>   Overlay a repo-relative path from the current worktree.
                     Repeatable. Missing paths are treated as deletions.
  --link <path>      Symlink a repo-relative path from the current worktree
                     into the clean snapshot. Repeatable.
  --mode <mode>      Snapshot materialization mode: archive (default) or clone
  --ref <git-ref>    Git ref to materialize in the clean snapshot (default: HEAD)
  --repo <path>      Repository root to snapshot (default: detected from cwd)
  --keep             Keep the temporary snapshot directory after the command exits
  --no-proof         Skip the pre-run git status/diff proof output
  --help             Show this help message
`);
}

function fail(message) {
  console.error(`[clean-room] ${message}`);
  process.exit(1);
}

function runCaptured(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function runInherited(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stderr });
    });
  });
}

function detectRepoRoot(startDir) {
  const result = runCaptured(["git", "-C", startDir, "rev-parse", "--show-toplevel"]);
  if (result.status !== 0) {
    fail(result.stderr.trim() || `failed to detect git root from ${startDir}`);
  }
  const root = result.stdout.trim();
  if (!root) {
    fail(`failed to detect git root from ${startDir}`);
  }
  return path.resolve(root);
}

function resolveCommit(repoRoot, ref) {
  const result = runCaptured(["git", "-C", repoRoot, "rev-parse", "--verify", `${ref}^{commit}`]);
  if (result.status !== 0) {
    fail(result.stderr.trim() || `failed to resolve ref ${ref}`);
  }
  const commit = result.stdout.trim();
  if (!commit) {
    fail(`failed to resolve ref ${ref}`);
  }
  return commit;
}

function normalizeOverlayPath(repoRoot, rawPath) {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    fail("overlay path cannot be empty");
  }
  const normalized = trimmed.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized === ".") {
    fail(`invalid overlay path: ${rawPath}`);
  }
  if (normalized === ".git" || normalized.startsWith(".git/")) {
    fail(`overlay path is not allowed: ${rawPath}`);
  }
  const absolutePath = path.resolve(repoRoot, normalized);
  const rootWithSep = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
  if (absolutePath !== repoRoot && !absolutePath.startsWith(rootWithSep)) {
    fail(`overlay path escapes repository root: ${rawPath}`);
  }
  return { normalized, absolutePath };
}

async function overlayPath(repoRoot, snapshotRoot, relativePath) {
  const source = normalizeOverlayPath(repoRoot, relativePath);
  const destination = normalizeOverlayPath(snapshotRoot, relativePath);
  await fs.rm(destination.absolutePath, { recursive: true, force: true });

  const stat = await fs.lstat(source.absolutePath).catch(() => null);
  if (!stat) {
    return;
  }

  await fs.mkdir(path.dirname(destination.absolutePath), { recursive: true });
  await fs.cp(source.absolutePath, destination.absolutePath, {
    recursive: true,
    force: true,
    dereference: false,
    verbatimSymlinks: true,
  });
}

async function linkPath(repoRoot, snapshotRoot, relativePath) {
  const source = normalizeOverlayPath(repoRoot, relativePath);
  const destination = normalizeOverlayPath(snapshotRoot, relativePath);
  const stat = await fs.lstat(source.absolutePath).catch(() => null);
  if (!stat) {
    fail(`link path does not exist: ${relativePath}`);
  }

  await fs.rm(destination.absolutePath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination.absolutePath), { recursive: true });
  await fs.symlink(
    source.absolutePath,
    destination.absolutePath,
    stat.isDirectory() ? "dir" : "file",
  );
}

function formatCommand(argv) {
  return argv.map((value) => (/\s/.test(value) ? JSON.stringify(value) : value)).join(" ");
}

function printCloneProof(snapshotRoot, includePaths) {
  const status = runCaptured(["git", "-C", snapshotRoot, "status", "--short"]);
  if (status.status !== 0) {
    fail(status.stderr.trim() || "failed to collect clean-room status");
  }
  const diffArgs = ["git", "-C", snapshotRoot, "diff", "--stat"];
  if (includePaths.length > 0) {
    diffArgs.push("--", ...includePaths);
  }
  const diff = runCaptured(diffArgs);
  if (diff.status !== 0) {
    fail(diff.stderr.trim() || "failed to collect clean-room diff");
  }

  console.log(`[clean-room] snapshot status${status.stdout.trim() ? ":" : ": clean"}`);
  if (status.stdout.trim()) {
    process.stdout.write(status.stdout);
  }
  console.log(`[clean-room] snapshot diff${diff.stdout.trim() ? ":" : ": clean"}`);
  if (diff.stdout.trim()) {
    process.stdout.write(diff.stdout);
  }
}

function printSourceProof(repoRoot, resolvedCommit, includePaths) {
  if (includePaths.length === 0) {
    console.log("[clean-room] source diff: clean");
    console.log("[clean-room] untracked overlays: none");
    return;
  }

  const diff = runCaptured([
    "git",
    "-C",
    repoRoot,
    "diff",
    "--stat",
    resolvedCommit,
    "--",
    ...includePaths,
  ]);
  if (diff.status !== 0) {
    fail(diff.stderr.trim() || "failed to collect overlay diff");
  }

  const untracked = runCaptured([
    "git",
    "-C",
    repoRoot,
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...includePaths,
  ]);
  if (untracked.status !== 0) {
    fail(untracked.stderr.trim() || "failed to collect untracked overlays");
  }

  console.log(`[clean-room] source diff${diff.stdout.trim() ? ":" : ": clean"}`);
  if (diff.stdout.trim()) {
    process.stdout.write(diff.stdout);
  }
  console.log(`[clean-room] untracked overlays${untracked.stdout.trim() ? ":" : ": none"}`);
  if (untracked.stdout.trim()) {
    process.stdout.write(untracked.stdout);
  }
}

async function materializeArchiveSnapshot(repoRoot, resolvedCommit, snapshotRoot) {
  await fs.mkdir(snapshotRoot, { recursive: true });
  const gitArchive = spawn("git", ["-C", repoRoot, "archive", "--format=tar", resolvedCommit], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tarExtract = spawn("tar", ["-xf", "-", "-C", snapshotRoot], {
    stdio: ["pipe", "ignore", "pipe"],
  });
  gitArchive.stdout.pipe(tarExtract.stdin);
  const [gitResult, tarResult] = await Promise.all([
    waitForProcess(gitArchive),
    waitForProcess(tarExtract),
  ]);
  if (gitResult.code !== 0) {
    fail(gitResult.stderr.trim() || `failed to archive ${resolvedCommit}`);
  }
  if (tarResult.code !== 0) {
    fail(tarResult.stderr.trim() || `failed to extract archive for ${resolvedCommit}`);
  }
}

async function materializeCloneSnapshot(repoRoot, resolvedCommit, snapshotRoot) {
  const clone = runCaptured([
    "git",
    "clone",
    "--local",
    "--quiet",
    "--no-checkout",
    repoRoot,
    snapshotRoot,
  ]);
  if (clone.status !== 0) {
    fail(clone.stderr.trim() || "failed to create clean-room clone");
  }

  const checkout = runCaptured([
    "git",
    "-C",
    snapshotRoot,
    "checkout",
    "--quiet",
    "--detach",
    resolvedCommit,
  ]);
  if (checkout.status !== 0) {
    fail(checkout.stderr.trim() || `failed to checkout ${resolvedCommit}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const includePaths = [];
  const linkPaths = [];
  let mode = "archive";
  let ref = "HEAD";
  let repoRoot = null;
  let keep = false;
  let proof = true;
  let command = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      command = args.slice(index + 1);
      break;
    }
    if (arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--include") {
      const next = args[index + 1];
      if (!next) {
        fail("--include requires a path");
      }
      includePaths.push(next);
      index += 1;
      continue;
    }
    if (arg === "--link") {
      const next = args[index + 1];
      if (!next) {
        fail("--link requires a path");
      }
      linkPaths.push(next);
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      const next = args[index + 1];
      if (!next) {
        fail("--mode requires a value");
      }
      if (next !== "archive" && next !== "clone") {
        fail(`unsupported mode: ${next}`);
      }
      mode = next;
      index += 1;
      continue;
    }
    if (arg === "--ref") {
      const next = args[index + 1];
      if (!next) {
        fail("--ref requires a git ref");
      }
      ref = next;
      index += 1;
      continue;
    }
    if (arg === "--repo") {
      const next = args[index + 1];
      if (!next) {
        fail("--repo requires a path");
      }
      repoRoot = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--keep") {
      keep = true;
      continue;
    }
    if (arg === "--no-proof") {
      proof = false;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }

  if (!command || command.length === 0) {
    usage();
    process.exit(1);
  }

  const resolvedRepoRoot = repoRoot ?? detectRepoRoot(process.cwd());
  const resolvedCommit = resolveCommit(resolvedRepoRoot, ref);
  const normalizedIncludePaths = includePaths.map(
    (entry) => normalizeOverlayPath(resolvedRepoRoot, entry).normalized,
  );
  const normalizedLinkPaths = linkPaths.map(
    (entry) => normalizeOverlayPath(resolvedRepoRoot, entry).normalized,
  );

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-clean-room-"));
  const snapshotRoot = path.join(tempRoot, "repo");

  let shouldKeep = keep;
  try {
    console.log(`[clean-room] materializing ${mode} snapshot in ${snapshotRoot}`);
    if (mode === "archive") {
      console.log(`[clean-room] exporting ${resolvedCommit}`);
      await materializeArchiveSnapshot(resolvedRepoRoot, resolvedCommit, snapshotRoot);
    } else {
      console.log(`[clean-room] creating clone snapshot`);
      console.log(`[clean-room] checking out ${resolvedCommit}`);
      await materializeCloneSnapshot(resolvedRepoRoot, resolvedCommit, snapshotRoot);
    }

    if (normalizedIncludePaths.length > 0) {
      console.log(
        `[clean-room] overlaying ${normalizedIncludePaths.length} path(s) from the current worktree`,
      );
    }
    for (const overlay of normalizedIncludePaths) {
      await overlayPath(resolvedRepoRoot, snapshotRoot, overlay);
    }
    if (normalizedLinkPaths.length > 0) {
      console.log(
        `[clean-room] linking ${normalizedLinkPaths.length} path(s) from the current worktree`,
      );
    }
    for (const linkedPath of normalizedLinkPaths) {
      await linkPath(resolvedRepoRoot, snapshotRoot, linkedPath);
    }

    console.log(`[clean-room] repo: ${resolvedRepoRoot}`);
    console.log(`[clean-room] base ref: ${ref}`);
    console.log(`[clean-room] base commit: ${resolvedCommit}`);
    console.log(`[clean-room] mode: ${mode}`);
    console.log(`[clean-room] snapshot: ${snapshotRoot}`);
    if (normalizedIncludePaths.length > 0) {
      console.log("[clean-room] overlays:");
      for (const overlay of normalizedIncludePaths) {
        console.log(`  - ${overlay}`);
      }
    } else {
      console.log("[clean-room] overlays: none");
    }
    if (normalizedLinkPaths.length > 0) {
      console.log("[clean-room] linked paths:");
      for (const linkedPath of normalizedLinkPaths) {
        console.log(`  - ${linkedPath}`);
      }
    } else {
      console.log("[clean-room] linked paths: none");
    }
    if (proof) {
      if (mode === "clone") {
        printCloneProof(snapshotRoot, normalizedIncludePaths);
      } else {
        printSourceProof(resolvedRepoRoot, resolvedCommit, normalizedIncludePaths);
      }
    }
    console.log(`[clean-room] running: ${formatCommand(command)}`);

    const result = runInherited(command, {
      cwd: snapshotRoot,
      env: process.env,
    });

    const exitCode = typeof result.status === "number" ? result.status : 1;
    if (exitCode !== 0) {
      shouldKeep = shouldKeep || process.env.ALISIO_CLEAN_ROOM_KEEP_ON_FAIL === "1";
      process.exitCode = exitCode;
    }
  } finally {
    if (shouldKeep) {
      console.log(`[clean-room] kept snapshot at ${snapshotRoot}`);
    } else {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

await main();
