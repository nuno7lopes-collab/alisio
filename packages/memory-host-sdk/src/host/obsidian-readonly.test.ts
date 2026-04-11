import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AlisioConfig } from "../../../../src/config/config.js";
import {
  OBSIDIAN_READONLY_TOOL_PREFIX,
  resolveObsidianReadOnlyDisplayPath,
  resolveObsidianReadOnlyReadPath,
  resolveObsidianReadOnlyVault,
  scanObsidianReadOnlyVault,
} from "./obsidian-readonly.js";

describe("obsidian read-only vault", () => {
  let vaultDir = "";
  let outsideDir = "";

  beforeEach(async () => {
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-obsidian-vault-ro-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-obsidian-outside-"));
  });

  afterEach(async () => {
    await fs.rm(vaultDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("requires explicit opt-in before resolving the connector", () => {
    expect(
      resolveObsidianReadOnlyVault({
        cfg: {
          memory: {
            obsidianReadOnly: {
              vaultPath: vaultDir,
            },
          },
        } as AlisioConfig,
      }),
    ).toBeNull();

    expect(
      resolveObsidianReadOnlyVault({
        cfg: {
          memory: {
            obsidianReadOnly: {
              enabled: true,
              vaultPath: vaultDir,
            },
          },
        } as AlisioConfig,
      }),
    ).toMatchObject({
      vaultRoot: vaultDir,
      maxFiles: 2000,
      maxFileBytes: 1048576,
    });
  });

  it("scans the whole vault while skipping hidden dirs, .obsidian, symlinks, and oversized files", async () => {
    const visibleDir = path.join(vaultDir, "notes");
    const hiddenDir = path.join(vaultDir, ".hidden");
    const appDir = path.join(vaultDir, ".obsidian");
    const oversizedFile = path.join(vaultDir, "notes", "huge.md");
    const keptFile = path.join(vaultDir, "notes", "topic.md");
    const hiddenFile = path.join(hiddenDir, "secret.md");
    const appFile = path.join(appDir, "workspace.md");
    const outsideFile = path.join(outsideDir, "outside.md");
    await fs.mkdir(visibleDir, { recursive: true });
    await fs.mkdir(hiddenDir, { recursive: true });
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(keptFile, "# Topic", "utf-8");
    await fs.writeFile(oversizedFile, "x".repeat(64), "utf-8");
    await fs.writeFile(hiddenFile, "# Hidden", "utf-8");
    await fs.writeFile(appFile, "# App", "utf-8");
    await fs.writeFile(outsideFile, "# Outside", "utf-8");

    const symlinkPath = path.join(vaultDir, "notes", "outside-link.md");
    let symlinkCreated = true;
    try {
      await fs.symlink(outsideFile, symlinkPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "EPERM" || code === "EACCES") {
        symlinkCreated = false;
      } else {
        throw err;
      }
    }

    const vault = {
      vaultRoot: vaultDir,
      maxFiles: 10,
      maxFileBytes: 32,
    };
    const result = await scanObsidianReadOnlyVault({
      vault,
      includeFiles: true,
    });

    expect(result).toMatchObject({
      enabled: true,
      active: true,
      vaultPath: vaultDir,
      indexedFiles: 1,
      skippedLargeFiles: 1,
    });
    expect(result.files?.map((entry) => entry.relativePath)).toEqual(["notes/topic.md"]);
    if (symlinkCreated) {
      expect(result.files?.some((entry) => entry.relativePath.endsWith("outside-link.md"))).toBe(
        false,
      );
    }
    expect(result.files?.some((entry) => entry.relativePath.endsWith("secret.md"))).toBe(false);
    expect(result.files?.some((entry) => entry.relativePath.endsWith("workspace.md"))).toBe(false);

    expect(resolveObsidianReadOnlyDisplayPath(keptFile, vault)).toBe(
      `${OBSIDIAN_READONLY_TOOL_PREFIX}/notes/topic.md`,
    );
    expect(
      resolveObsidianReadOnlyReadPath({
        vault,
        relPath: `${OBSIDIAN_READONLY_TOOL_PREFIX}/notes/topic.md`,
      }),
    ).toBe(keptFile);
  });

  it("degrades cleanly when the vault exceeds the file limit", async () => {
    await fs.writeFile(path.join(vaultDir, "a.md"), "# A", "utf-8");
    await fs.writeFile(path.join(vaultDir, "b.md"), "# B", "utf-8");

    const result = await scanObsidianReadOnlyVault({
      vault: {
        vaultRoot: vaultDir,
        maxFiles: 1,
        maxFileBytes: 1024,
      },
    });

    expect(result.active).toBe(false);
    expect(result.error).toContain("file limit");
    expect(result.indexedFiles).toBe(0);
  });

  it("rejects invalid read-only vault paths", () => {
    const vault = {
      vaultRoot: vaultDir,
      maxFiles: 10,
      maxFileBytes: 1024,
    };

    expect(() =>
      resolveObsidianReadOnlyReadPath({
        vault,
        relPath: `${OBSIDIAN_READONLY_TOOL_PREFIX}/../escape.md`,
      }),
    ).toThrow("invalid obsidian vault path");

    expect(() =>
      resolveObsidianReadOnlyReadPath({
        vault,
        relPath: `${OBSIDIAN_READONLY_TOOL_PREFIX}/.obsidian/workspace.md`,
      }),
    ).toThrow("invalid obsidian vault path");
  });
});
