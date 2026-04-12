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

  it("preserves qmd memory config values", async () => {
    await withTempHomeConfig(
      {
        memory: {
          backend: "qmd",
          qmd: {
            includeDefaultMemory: false,
            paths: [{ path: "~/Notes", name: "notes", pattern: "**/*.md" }],
          },
        },
      },
      async () => {
        const cfg = loadConfig();
        expect(cfg.memory?.backend).toBe("qmd");
        expect(cfg.memory?.qmd?.includeDefaultMemory).toBe(false);
        expect(cfg.memory?.qmd?.paths).toEqual([
          { path: expect.stringMatching(/Notes$/), name: "notes", pattern: "**/*.md" },
        ]);
      },
    );
  });

  it("preserves native canonical memory feature flags", async () => {
    await withTempHomeConfig(
      {
        memory: {
          ledger: {
            enabled: false,
          },
          legacyMarkdownProjection: {
            enabled: false,
          },
          crdt: {
            pages: {
              enabled: true,
            },
          },
        },
      },
      async () => {
        const cfg = loadConfig();
        expect(cfg.memory?.ledger).toEqual({
          enabled: false,
        });
        expect(cfg.memory?.legacyMarkdownProjection).toEqual({
          enabled: false,
        });
        expect(cfg.memory?.crdt).toEqual({
          pages: {
            enabled: true,
          },
        });
      },
    );
  });

  it("rejects unknown legacy memory keys", () => {
    const legacyVaultKey = ["vault", "Path"].join("");
    const result = validateConfigObject({
      memory: {
        [legacyVaultKey]: "vaults/main",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects unexpected legacy subpath keys", () => {
    const legacyPathKey = ["memory", "Path"].join("");
    const result = validateConfigObject({
      memory: {
        [legacyPathKey]: "../escape",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects removed legacy connector config", () => {
    const legacyConnectorKey = ["obsi", "dian", "ReadOnly"].join("");
    const result = validateConfigObject({
      memory: {
        [legacyConnectorKey]: {
          enabled: true,
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects unsupported sync transport config until runtime wiring lands", () => {
    const result = validateConfigObject({
      memory: {
        sync: {
          enabled: true,
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects unsupported E2EE transport config until runtime wiring lands", () => {
    const result = validateConfigObject({
      memory: {
        e2ee: {
          required: true,
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected validation to fail");
    }
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
