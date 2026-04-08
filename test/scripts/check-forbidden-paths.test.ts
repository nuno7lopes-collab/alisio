import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectForbiddenPathViolations,
  loadForbiddenDirectoryReasons,
  parseForbiddenDirectoryReasonsFromGitignore,
  resolveForbiddenDirectory,
} from "../../scripts/check-forbidden-paths.mjs";

const tempDirs: string[] = [];
const fixtureGitignore = [
  "# forbidden-commit-dir: node_modules | runtime dependency artifacts must never be committed",
  "node_modules",
  "**/node_modules/",
  "# forbidden-commit-dir: .build | build output must never be committed",
  ".build",
  "**/.build/",
  "# forbidden-commit-dir: .build-local | local build output must never be committed",
  ".build-local",
  "**/.build-local/",
  "# forbidden-commit-dir: dist | generated distribution output must never be committed",
  "dist",
  "**/dist/",
  "# forbidden-commit-dir: dist-runtime | generated runtime packaging output must never be committed",
  "dist-runtime",
  "**/dist-runtime/",
  "# forbidden-commit-dir: coverage | coverage output must never be committed",
  "coverage",
  "**/coverage/",
  "",
].join("\n");

function makeTempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "forbidden-paths-test-"));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, ".gitignore"), fixtureGitignore);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("check-forbidden-paths", () => {
  it("parses the guarded artifact directory list from .gitignore", () => {
    const rules = parseForbiddenDirectoryReasonsFromGitignore(fixtureGitignore);

    expect([...rules.entries()]).toEqual([
      ["node_modules", "runtime dependency artifacts must never be committed"],
      [".build", "build output must never be committed"],
      [".build-local", "local build output must never be committed"],
      ["dist", "generated distribution output must never be committed"],
      ["dist-runtime", "generated runtime packaging output must never be committed"],
      ["coverage", "coverage output must never be committed"],
    ]);
  });

  it("loads forbidden directory rules from the repo .gitignore", () => {
    const repo = makeTempRepo();
    const rules = loadForbiddenDirectoryReasons(repo);

    expect([...rules.keys()]).toEqual([
      "node_modules",
      ".build",
      ".build-local",
      "dist",
      "dist-runtime",
      "coverage",
    ]);
  });

  it("matches forbidden directory segments anywhere in a relative path", () => {
    const rules = parseForbiddenDirectoryReasonsFromGitignore(fixtureGitignore);

    expect(resolveForbiddenDirectory("./packages/app/dist/index.js", rules)).toBe("dist");
    expect(resolveForbiddenDirectory("apps/macos/.build/debug.log", rules)).toBe(".build");
    expect(resolveForbiddenDirectory("src/index.ts", rules)).toBeNull();
  });

  it("collects violations with the reason from the .gitignore marker", () => {
    const rules = parseForbiddenDirectoryReasonsFromGitignore(fixtureGitignore);

    expect(
      collectForbiddenPathViolations(
        [
          "src/index.ts",
          "coverage/lcov.info",
          "packages/app/node_modules/pkg/index.js",
          "apps/macos/.build-local/output.txt",
        ],
        rules,
      ),
    ).toEqual([
      {
        filePath: "coverage/lcov.info",
        reason: "coverage output must never be committed",
      },
      {
        filePath: "packages/app/node_modules/pkg/index.js",
        reason: "runtime dependency artifacts must never be committed",
      },
      {
        filePath: "apps/macos/.build-local/output.txt",
        reason: "local build output must never be committed",
      },
    ]);
  });
});
