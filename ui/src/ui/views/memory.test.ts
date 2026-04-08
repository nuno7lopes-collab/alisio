/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderMemoryHub } from "./memory.ts";

function createProps(
  overrides: Partial<Parameters<typeof renderMemoryHub>[0]> = {},
): Parameters<typeof renderMemoryHub>[0] {
  return {
    aiState: null,
    agentsLoading: false,
    agentsError: null,
    agentsList: {
      defaultId: "main",
      mainKey: "main",
      scope: "per-sender",
      agents: [{ id: "main", name: "Main" }],
    },
    selectedAgentId: "main",
    memoryLoading: false,
    memoryError: null,
    memoryList: {
      agentId: "main",
      workspace: "/workspace/main",
      files: [
        {
          name: "MEMORY.md",
          path: "/workspace/main/MEMORY.md",
          missing: false,
          size: 12,
          updatedAtMs: 10,
        },
        {
          name: "memory/2026-04-06-trip-planning.md",
          path: "/workspace/main/memory/2026-04-06-trip-planning.md",
          missing: false,
          size: 8,
          updatedAtMs: 20,
        },
      ],
    },
    memoryActive: "MEMORY.md",
    memoryContents: {
      "MEMORY.md": "# Main memory",
      "memory/2026-04-06-trip-planning.md": "# Trip planning",
    },
    memoryDrafts: {
      "MEMORY.md": "# Main memory",
      "memory/2026-04-06-trip-planning.md": "# Trip planning",
    },
    memorySaving: false,
    memoryDeleting: false,
    memoryStatusLoading: false,
    memoryStatusError: null,
    memoryStatus: {
      agentId: "main",
      enabled: true,
      config: {
        provider: "openai",
        fallback: "text-embedding-3-small",
        sources: ["memory", "sessions"],
        extraPaths: ["docs/memory"],
        sync: {
          onSessionStart: true,
          onSearch: true,
          watch: true,
          watchDebounceMs: 750,
          intervalMinutes: 15,
        },
        store: {
          driver: "sqlite",
          path: "/workspace/main/.memory/memory.db",
          ftsTokenizer: "unicode61",
          vectorEnabled: true,
        },
      },
      backend: {
        backend: "builtin",
      },
      runtime: {
        backend: "builtin",
        provider: "openai",
        model: "text-embedding-3-small",
        files: 2,
        chunks: 10,
        dirty: false,
        dbPath: "/workspace/main/.memory/memory.db",
        sourceCounts: [
          { source: "memory", files: 1, chunks: 4 },
          { source: "sessions", files: 1, chunks: 6 },
        ],
        fts: {
          enabled: true,
          available: true,
        },
        vector: {
          enabled: true,
          available: true,
          dims: 1536,
        },
        obsidianReadOnly: {
          enabled: true,
          active: true,
          vaultPath: "/vaults/research",
          indexedFiles: 24,
          skippedLargeFiles: 2,
          maxFiles: 2000,
          maxFileBytes: 1048576,
        },
      },
      embedding: {
        ok: true,
      },
    },
    memorySyncing: false,
    memorySyncAvailable: true,
    configLoading: false,
    configSaving: false,
    configDirty: false,
    configSchema: {
      type: "object",
      properties: {
        memory: {
          type: "object",
          properties: {
            backend: { type: "string" },
          },
          additionalProperties: false,
        },
        agents: {
          type: "object",
          properties: {
            defaults: {
              type: "object",
              properties: {
                memorySearch: {
                  type: "object",
                  properties: {
                    provider: { type: "string" },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
            list: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  memorySearch: {
                    type: "object",
                    properties: {
                      provider: { type: "string" },
                    },
                    additionalProperties: false,
                  },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    configUiHints: {},
    configForm: {
      memory: {
        backend: "builtin",
      },
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
          },
        },
        list: [{ id: "main", memorySearch: { provider: "openai" } }],
      },
    },
    searchQuery: "",
    composerOpen: false,
    composerDate: "2026-04-06",
    composerTitle: "",
    onSelectAgent: vi.fn(),
    onRefresh: vi.fn(),
    onSearchChange: vi.fn(),
    onSelectFile: vi.fn(),
    onDraftChange: vi.fn(),
    onResetFile: vi.fn(),
    onSaveFile: vi.fn(),
    onDeleteFile: vi.fn(),
    onComposerOpenChange: vi.fn(),
    onComposerDateChange: vi.fn(),
    onComposerTitleChange: vi.fn(),
    onCreateNote: vi.fn(),
    onSync: vi.fn(),
    onConfigPatch: vi.fn(),
    onSaveSettings: vi.fn(),
    onUseLocalEmbeddings: vi.fn(),
    ...overrides,
  };
}

describe("renderMemoryHub", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders a dedicated long-term memory workspace without note delete actions", () => {
    const container = document.createElement("div");

    render(renderMemoryHub(createProps()), container);

    expect(container.textContent).toContain("Long-term memory");
    expect(container.textContent).toContain("Memory runtime");
    expect(container.textContent).toContain("Memory settings");
    expect(container.textContent).toContain("Main memory");
    expect(container.textContent).toContain("Trip Planning");
    expect(container.textContent).toContain("Obsidian vault");
    expect(container.textContent).toContain("/vaults/research");
    expect(container.textContent).not.toContain("Delete");
  });

  it("shows the note composer preview path and note delete action in note mode", () => {
    const container = document.createElement("div");

    render(
      renderMemoryHub(
        createProps({
          memoryActive: "memory/2026-04-06-trip-planning.md",
          composerOpen: true,
          composerTitle: "Daily standup",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("memory/2026-04-06-daily-standup.md");
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("Delete"),
      ),
    ).toBe(true);
  });

  it("wires sync and settings save actions from the memory surface", () => {
    const container = document.createElement("div");
    const onSync = vi.fn();
    const onSaveSettings = vi.fn();

    render(
      renderMemoryHub(
        createProps({
          configDirty: true,
          onSync,
          onSaveSettings,
        }),
      ),
      container,
    );

    const syncButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Sync now"),
    );
    const saveSettingsButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save settings"),
    );

    syncButton?.click();
    saveSettingsButton?.click();

    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSaveSettings).toHaveBeenCalledTimes(1);
  });

  it("suggests local embeddings when Codex OAuth is active and auto selection has no usable provider", () => {
    const container = document.createElement("div");
    const onUseLocalEmbeddings = vi.fn();
    const props = createProps({
      aiState: {
        provider: "openai",
        status: "connected",
      },
      onUseLocalEmbeddings,
    });
    const baseStatus = props.memoryStatus!;
    const baseConfig = baseStatus.config!;
    const baseRuntime = baseStatus.runtime!;

    props.memoryStatus = {
      ...baseStatus,
      config: {
        provider: "auto",
        fallback: baseConfig.fallback,
        sources: [...baseConfig.sources],
        extraPaths: [...baseConfig.extraPaths],
        sync: { ...baseConfig.sync },
        store: { ...baseConfig.store },
      },
      runtime: {
        backend: baseRuntime.backend,
        provider: "auto",
        model: baseRuntime.model,
        files: baseRuntime.files,
        chunks: baseRuntime.chunks,
        dirty: baseRuntime.dirty,
        dbPath: baseRuntime.dbPath,
        sourceCounts: baseRuntime.sourceCounts,
        fts: baseRuntime.fts,
        vector: baseRuntime.vector,
        requestedProvider: "auto",
      },
      embedding: {
        ok: false,
        error: [
          'No API key found for provider "openai".',
          'No API key found for provider "voyage".',
          'No API key found for provider "mistral".',
        ].join("\n\n"),
      },
    };

    render(renderMemoryHub(props), container);

    expect(container.textContent).toContain("Memory still needs embeddings");
    expect(container.textContent).toContain("Codex/OpenAI sign-in covers chat");
    expect(container.textContent).not.toContain("No API key found");
    expect(container.textContent).not.toContain("Voyage");
    expect(container.textContent).not.toContain("Mistral");

    const localButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use local embeddings"),
    );

    localButton?.click();

    expect(onUseLocalEmbeddings).toHaveBeenCalledTimes(1);
  });

  it("shows .alisio instead of legacy .openclaw paths in runtime details", () => {
    const container = document.createElement("div");
    const props = createProps();
    const baseStatus = props.memoryStatus!;
    const baseConfig = baseStatus.config!;
    const baseRuntime = baseStatus.runtime!;

    props.memoryStatus = {
      ...baseStatus,
      config: {
        provider: baseConfig.provider,
        fallback: baseConfig.fallback,
        sources: [...baseConfig.sources],
        extraPaths: [...baseConfig.extraPaths],
        sync: { ...baseConfig.sync },
        store: {
          ...baseConfig.store,
          path: "/Users/nuno/.openclaw/memory/main.sqlite",
        },
      },
      runtime: {
        backend: baseRuntime.backend,
        provider: baseRuntime.provider,
        model: baseRuntime.model,
        files: baseRuntime.files,
        chunks: baseRuntime.chunks,
        dirty: baseRuntime.dirty,
        dbPath: "/Users/nuno/.openclaw/memory/main.sqlite",
        sourceCounts: baseRuntime.sourceCounts,
        fts: baseRuntime.fts,
        vector: baseRuntime.vector,
      },
    };

    render(renderMemoryHub(props), container);

    expect(container.textContent).not.toContain(".openclaw");
    expect(container.textContent).toContain(".alisio");
  });
});
