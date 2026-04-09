import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts", "clean-room-run.mjs");
const tempRepos: string[] = [];

function run(cwd: string, command: string, args: string[]) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
  });
}

function git(cwd: string, ...args: string[]) {
  return run(cwd, "git", args).trim();
}

function createRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), "alisio-clean-room-test-"));
  tempRepos.push(repo);

  git(repo, "init", "-q");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test User");

  return repo;
}

function writeRepoFile(repo: string, relativePath: string, contents: string) {
  const fullPath = path.join(repo, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents, "utf8");
}

function commitAll(repo: string, message: string) {
  git(repo, "add", ".");
  git(repo, "commit", "-qm", message);
}

function runHelper(repo: string, args: string[]) {
  return run(process.cwd(), process.execPath, [scriptPath, "--repo", repo, ...args]);
}

afterEach(() => {
  while (tempRepos.length > 0) {
    const repo = tempRepos.pop();
    if (repo) {
      rmSync(repo, { force: true, recursive: true });
    }
  }
});

describe("scripts/clean-room-run.mjs", () => {
  it("materializes an archive snapshot and overlays untracked files only when requested", () => {
    const repo = createRepo();
    writeRepoFile(repo, "tracked.txt", "base\n");
    commitAll(repo, "seed");
    writeRepoFile(repo, "overlay.txt", "overlay\n");

    const output = runHelper(repo, [
      "--include",
      "overlay.txt",
      "--",
      process.execPath,
      "-e",
      [
        'const fs = require("node:fs");',
        'const tracked = fs.readFileSync("tracked.txt", "utf8").trim();',
        'const overlay = fs.readFileSync("overlay.txt", "utf8").trim();',
        "process.stdout.write(`${tracked}|${overlay}`);",
      ].join(" "),
    ]);

    expect(output).toContain("[clean-room] mode: archive");
    expect(output).toContain("[clean-room] source diff: clean");
    expect(output).toContain("[clean-room] untracked overlays:");
    expect(output).toContain("overlay.txt");
    expect(output).toContain("base|overlay");
  });

  it("treats missing overlay paths as deletions inside the clean snapshot", () => {
    const repo = createRepo();
    writeRepoFile(repo, "delete-me.txt", "present\n");
    commitAll(repo, "seed");
    rmSync(path.join(repo, "delete-me.txt"));

    const output = runHelper(repo, [
      "--include",
      "delete-me.txt",
      "--",
      process.execPath,
      "-e",
      [
        'const fs = require("node:fs");',
        'process.stdout.write(fs.existsSync("delete-me.txt") ? "present" : "absent");',
      ].join(" "),
    ]);

    expect(output).toContain("[clean-room] mode: archive");
    expect(output).toContain("delete-me.txt");
    expect(output).toContain("absent");
  });

  it("isolates clone-mode proof output to the included tracked changes", () => {
    const repo = createRepo();
    writeRepoFile(repo, "tracked.txt", "base\n");
    commitAll(repo, "seed");
    writeRepoFile(repo, "tracked.txt", "changed\n");
    writeRepoFile(repo, "ignored.txt", "noise\n");

    const output = runHelper(repo, [
      "--mode",
      "clone",
      "--include",
      "tracked.txt",
      "--",
      "git",
      "status",
      "--short",
    ]);

    expect(output).toContain("[clean-room] mode: clone");
    expect(output).toContain("[clean-room] snapshot status:");
    expect(output).toContain("M tracked.txt");
    expect(output).not.toContain("ignored.txt");
  });
});
