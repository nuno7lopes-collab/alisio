import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resetConfigRuntimeState, validateConfigObject } from "./config.js";
import { withTempHomeConfig } from "./test-helpers.js";

describe("config memory settings", () => {
  beforeEach(() => {
    resetConfigRuntimeState();
  });

  afterEach(() => {
    resetConfigRuntimeState();
  });

  it("preserves obsidian memory config values", async () => {
    await withTempHomeConfig(
      {
        memory: {
          backend: "builtin",
          vaultPath: "~/Obsidian/Main",
          memoryPath: "Alisio Memory",
        },
      },
      async () => {
        const cfg = loadConfig();
        expect(cfg.memory?.backend).toBe("builtin");
        expect(cfg.memory?.vaultPath).toMatch(/Obsidian[/\\]Main$/);
        expect(cfg.memory?.memoryPath).toBe("Alisio Memory");
      },
    );
  });

  it("preserves obsidian read-only connector values", async () => {
    await withTempHomeConfig(
      {
        memory: {
          obsidianReadOnly: {
            enabled: true,
            vaultPath: "~/Obsidian/Research",
          },
        },
      },
      async () => {
        const cfg = loadConfig();
        expect(cfg.memory?.obsidianReadOnly?.enabled).toBe(true);
        expect(cfg.memory?.obsidianReadOnly?.vaultPath).toMatch(/Obsidian[/\\]Research$/);
      },
    );
  });

  it("rejects non-absolute obsidian vault paths", () => {
    const result = validateConfigObject({
      memory: {
        vaultPath: "vaults/main",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === "memory.vaultPath")).toBe(true);
    }
  });

  it("rejects memory paths that escape the configured directory", () => {
    const result = validateConfigObject({
      memory: {
        memoryPath: "../escape",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === "memory.memoryPath")).toBe(true);
    }
  });

  it("rejects read-only obsidian connectors without a vault path", () => {
    const result = validateConfigObject({
      memory: {
        obsidianReadOnly: {
          enabled: true,
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((issue) => issue.path === "memory.obsidianReadOnly.vaultPath"),
      ).toBe(true);
    }
  });

  it("rejects non-absolute read-only obsidian vault paths", () => {
    const result = validateConfigObject({
      memory: {
        obsidianReadOnly: {
          enabled: true,
          vaultPath: "vaults/main",
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((issue) => issue.path === "memory.obsidianReadOnly.vaultPath"),
      ).toBe(true);
    }
  });
});
