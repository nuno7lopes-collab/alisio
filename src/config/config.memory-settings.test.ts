import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resetConfigRuntimeState } from "./config.js";
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
});
