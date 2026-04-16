import { describe, expect, it, vi } from "vitest";
import type { ModelCatalogEntry } from "../../agents/model-catalog.js";
import { buildModelAliasIndex } from "../../agents/model-selection.js";
import type { AlisioConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { applyResetModelOverride } from "./session-reset-model.js";

const { loadMergedRuntimeModelCatalogMock } = vi.hoisted(() => ({
  loadMergedRuntimeModelCatalogMock: vi.fn(async () => modelCatalog),
}));

vi.mock("../../agents/model-catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/model-catalog.js")>();
  return {
    ...actual,
    loadMergedRuntimeModelCatalog: loadMergedRuntimeModelCatalogMock,
  };
});

const modelCatalog: ModelCatalogEntry[] = [
  { provider: "minimax", id: "m2.7", name: "M2.7" },
  { provider: "openai", id: "gpt-4o-mini", name: "GPT-4o mini" },
];

function createResetFixture(entry: Partial<SessionEntry> = {}) {
  const cfg = {} as AlisioConfig;
  const aliasIndex = buildModelAliasIndex({ cfg, defaultProvider: "openai" });
  const sessionEntry: SessionEntry = {
    sessionId: "s1",
    updatedAt: Date.now(),
    ...entry,
  };
  return {
    cfg,
    aliasIndex,
    sessionEntry,
    sessionStore: { "agent:main:dm:1": sessionEntry } as Record<string, SessionEntry>,
    sessionCtx: { BodyStripped: "minimax summarize" },
    ctx: { ChatType: "direct" },
  };
}

async function applyResetFixture(params: {
  resetTriggered: boolean;
  sessionEntry?: Partial<SessionEntry>;
}) {
  const fixture = createResetFixture(params.sessionEntry);
  await applyResetModelOverride({
    cfg: fixture.cfg,
    resetTriggered: params.resetTriggered,
    bodyStripped: "minimax summarize",
    sessionCtx: fixture.sessionCtx,
    ctx: fixture.ctx,
    sessionEntry: fixture.sessionEntry,
    sessionStore: fixture.sessionStore,
    sessionKey: "agent:main:dm:1",
    defaultProvider: "openai",
    defaultModel: "gpt-4o-mini",
    aliasIndex: fixture.aliasIndex,
    modelCatalog,
  });
  return fixture;
}

describe("applyResetModelOverride", () => {
  it("loads the merged runtime catalog for dynamic local overrides when no catalog is injected", async () => {
    loadMergedRuntimeModelCatalogMock.mockClear();
    loadMergedRuntimeModelCatalogMock.mockResolvedValueOnce([
      { provider: "openai", id: "gpt-4o-mini", name: "GPT-4o mini" },
      {
        provider: "alisio-local-current-llama",
        id: "qwen3-4b-q4-k-m",
        name: "Qwen3 4B",
      },
    ]);
    const fixture = createResetFixture();

    await applyResetModelOverride({
      cfg: fixture.cfg,
      resetTriggered: true,
      bodyStripped: "alisio-local-current-llama/qwen3-4b-q4-k-m summarize",
      sessionCtx: fixture.sessionCtx,
      ctx: fixture.ctx,
      sessionEntry: fixture.sessionEntry,
      sessionStore: fixture.sessionStore,
      sessionKey: "agent:main:dm:1",
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
      aliasIndex: fixture.aliasIndex,
    });

    expect(loadMergedRuntimeModelCatalogMock).toHaveBeenCalledWith({
      config: fixture.cfg,
      dynamicProviderIds: ["alisio-local-current-llama"],
    });
    expect(fixture.sessionEntry.providerOverride).toBe("alisio-local-current-llama");
    expect(fixture.sessionEntry.modelOverride).toBe("qwen3-4b-q4-k-m");
    expect(fixture.sessionCtx.BodyStripped).toBe("summarize");
  });

  it("selects a model hint and strips it from the body", async () => {
    const { sessionEntry, sessionCtx } = await applyResetFixture({
      resetTriggered: true,
    });

    expect(sessionEntry.providerOverride).toBe("minimax");
    expect(sessionEntry.modelOverride).toBe("m2.7");
    expect(sessionCtx.BodyStripped).toBe("summarize");
  });

  it("clears auth profile overrides when reset applies a model", async () => {
    const { sessionEntry } = await applyResetFixture({
      resetTriggered: true,
      sessionEntry: {
        authProfileOverride: "anthropic:default",
        authProfileOverrideSource: "user",
        authProfileOverrideCompactionCount: 2,
      },
    });

    expect(sessionEntry.authProfileOverride).toBeUndefined();
    expect(sessionEntry.authProfileOverrideSource).toBeUndefined();
    expect(sessionEntry.authProfileOverrideCompactionCount).toBeUndefined();
  });

  it("skips when resetTriggered is false", async () => {
    const { sessionEntry, sessionCtx } = await applyResetFixture({
      resetTriggered: false,
    });

    expect(sessionEntry.providerOverride).toBeUndefined();
    expect(sessionEntry.modelOverride).toBeUndefined();
    expect(sessionCtx.BodyStripped).toBe("minimax summarize");
  });
});
