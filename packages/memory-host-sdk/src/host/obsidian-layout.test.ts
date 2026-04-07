import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../../../src/config/config.js";
import { buildFileEntry, listMemoryFiles } from "./internal.js";
import {
  buildObsidianDailyNoteSeed,
  resolveObsidianMemoryLayout,
  resolveObsidianReadPath,
  resolveObsidianToolPathForDate,
  syncObsidianLongTermMemoryRollup,
} from "./obsidian-layout.js";

describe("obsidian memory layout", () => {
  let workspaceDir = "";
  let vaultDir = "";

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-workspace-"));
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-vault-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(vaultDir, { recursive: true, force: true });
  });

  it("rejects invalid vault and memory paths", () => {
    expect(() =>
      resolveObsidianMemoryLayout({
        workspaceDir,
        cfg: { memory: { vaultPath: "relative/vault" } } as OpenClawConfig,
      }),
    ).toThrow('memory.vaultPath must be absolute or start with "~"');

    expect(() =>
      resolveObsidianMemoryLayout({
        workspaceDir,
        cfg: { memory: { memoryPath: "../escape" } } as OpenClawConfig,
      }),
    ).toThrow('memory.memoryPath must not contain "." or ".." segments');
  });

  it("labels builtin obsidian files with a stable tool path", async () => {
    const cfg = {
      memory: {
        vaultPath: vaultDir,
        memoryPath: "Alisio Memory",
      },
    } as OpenClawConfig;
    const layout = resolveObsidianMemoryLayout({ cfg, workspaceDir });
    expect(layout).not.toBeNull();

    const notePath = path.join(vaultDir, "Alisio Memory", "daily", "2026-04-07.md");
    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.writeFile(notePath, "vault note", "utf-8");

    const files = await listMemoryFiles(workspaceDir, [], undefined, layout);
    expect(files).toContain(notePath);

    const entry = await buildFileEntry(notePath, workspaceDir, undefined, layout);
    expect(entry?.path).toBe("obsidian/Alisio Memory/daily/2026-04-07.md");
    expect(
      resolveObsidianReadPath({
        layout,
        relPath: "obsidian/Alisio Memory/daily/2026-04-07.md",
      }),
    ).toBe(notePath);
  });

  it("builds a deterministic long-term rollup from daily obsidian notes", async () => {
    const cfg = {
      memory: {
        vaultPath: vaultDir,
        memoryPath: "Alisio Memory",
      },
    } as OpenClawConfig;
    const layout = resolveObsidianMemoryLayout({ cfg, workspaceDir });
    expect(layout).not.toBeNull();

    const dateA = "2026-04-07";
    const dateB = "2026-04-06";
    const fileA = path.join(vaultDir, "Alisio Memory", "daily", `${dateA}.md`);
    const fileB = path.join(vaultDir, "Alisio Memory", "daily", `${dateB}.md`);
    await fs.mkdir(path.dirname(fileA), { recursive: true });
    await fs.writeFile(fileA, `${buildObsidianDailyNoteSeed(dateA)}alpha durable note`, "utf-8");
    await fs.writeFile(fileB, `${buildObsidianDailyNoteSeed(dateB)}beta durable note`, "utf-8");

    const result = await syncObsidianLongTermMemoryRollup({ cfg, workspaceDir });
    expect(result).toMatchObject({
      updated: true,
      path: path.join(vaultDir, "Alisio Memory", "long-term.md"),
    });

    const rollup = await fs.readFile(path.join(vaultDir, "Alisio Memory", "long-term.md"), "utf-8");
    expect(rollup).toContain("# Alisio Long-Term Memory");
    expect(rollup).toContain(`### ${dateA}`);
    expect(rollup).toContain(
      `Source: [[${resolveObsidianToolPathForDate(layout!, dateA).slice("obsidian/".length, -3)}]]`,
    );
    expect(rollup).toContain("alpha durable note");
    expect(rollup).toContain(`### ${dateB}`);
    expect(rollup).toContain("beta durable note");

    const rerun = await syncObsidianLongTermMemoryRollup({ cfg, workspaceDir });
    expect(rerun.updated).toBe(false);
  });
});
