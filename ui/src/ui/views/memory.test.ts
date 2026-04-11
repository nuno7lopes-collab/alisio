/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { GatewayRequestError } from "../gateway.ts";
import { renderMemoryHub } from "./memory.ts";

async function flushMemoryHub() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function mountNativeHub(
  props: Parameters<typeof renderMemoryHub>[0],
  container = document.createElement("div"),
) {
  const hub = document.createElement("alisio-memory-native-hub") as HTMLElement & {
    props: Parameters<typeof renderMemoryHub>[0];
  };
  hub.props = props;
  document.body.appendChild(container);
  container.appendChild(hub);
  await flushMemoryHub();
  return { container, hub };
}

function makeRequestMock() {
  return vi.fn((method: string, params?: Record<string, unknown>) => {
    const pageId = typeof params?.pageId === "string" ? params.pageId : "";
    const traceId = typeof params?.traceId === "string" ? params.traceId : "";
    const format = typeof params?.format === "string" ? params.format : "json";
    if (method === "memory.wiki.list") {
      return Promise.resolve({
        agentId: "main",
        sync: {
          lastSyncedLamport: "42",
          e2eeRequired: true,
        },
        exportFormats: ["zip", "json", "markdown"],
        pages: [
          {
            id: "atlas",
            title: "Project Atlas",
            path: "memory/project-atlas.md",
            excerpt: "Launch blockers and delivery plan.",
            backlinks: 1,
            claims: 1,
            evidence: 1,
            traceId: "trace-atlas",
            reasonTags: [{ code: "recent", label: "Recent change" }],
          },
          {
            id: "roadmap",
            title: "Roadmap",
            path: "memory/roadmap.md",
            excerpt: "Release roadmap",
            backlinks: 1,
            claims: 0,
            evidence: 0,
          },
        ],
      });
    }
    if (method === "memory.wiki.get" && params?.pageId === "atlas") {
      return Promise.resolve({
        agentId: "main",
        page: {
          id: "atlas",
          title: "Project Atlas",
          path: "memory/project-atlas.md",
          content: "# Project Atlas\n\n- Launch blocker review",
          backlinks: [
            {
              id: "roadmap",
              title: "Roadmap",
              path: "memory/roadmap.md",
              excerpt: "Depends on Atlas milestones.",
            },
          ],
          claims: [
            {
              id: "claim-atlas",
              claim: "Atlas depends on roadmap sign-off.",
              confidence: 0.84,
              evidence: [
                {
                  id: "evidence-roadmap",
                  title: "Roadmap",
                  excerpt: "Milestone approval still pending.",
                },
              ],
            },
          ],
          provenance: [{ label: "Ledger", value: "evt-1" }],
          reasonTags: [{ code: "recent", label: "Recent change" }],
          traceId: "trace-atlas",
          contextPreview: {
            summary: "Surfaced because recent edits mention the launch blockers.",
            reasonTags: [{ code: "linked", label: "Linked context" }],
            traceId: "trace-atlas",
          },
          revision: {
            eventId: "evt-1",
            lamport: "42",
            updatedAt: "2026-04-11T10:00:00Z",
            author: "atlas",
            summary: "Updated page",
          },
        },
      });
    }
    if (method === "memory.wiki.get" && params?.pageId === "roadmap") {
      return Promise.resolve({
        agentId: "main",
        page: {
          id: "roadmap",
          title: "Roadmap",
          path: "memory/roadmap.md",
          content: "# Roadmap\n\nMilestone approval pending.",
          backlinks: [],
          claims: [],
          provenance: [{ label: "Ledger", value: "evt-2" }],
        },
      });
    }
    if (method === "memory.wiki.history") {
      return Promise.resolve({
        agentId: "main",
        pageId,
        history: [
          {
            eventId: "evt-1",
            lamport: "42",
            summary: "Updated page",
            at: "2026-04-11T10:00:00Z",
            author: "atlas",
            diffSummary: "Claims and evidence refreshed.",
          },
        ],
      });
    }
    if (method === "memory.files.list") {
      return Promise.resolve({
        agentId: "main",
        sync: {
          lastSyncedLamport: "42",
          e2eeRequired: true,
        },
        files: [
          {
            id: "brief",
            name: "product-brief.pdf",
            mediaType: "application/pdf",
            size: 1024,
            provenanceSummary: "Imported from product brief",
            traceId: "trace-file",
            reasonTags: [{ code: "attachment", label: "Attachment" }],
          },
        ],
      });
    }
    if (method === "memory.files.get") {
      return Promise.resolve({
        agentId: "main",
        file: {
          id: "brief",
          name: "product-brief.pdf",
          mediaType: "application/pdf",
          size: 1024,
          updatedAt: "2026-04-11T10:10:00Z",
          provenanceSummary: "Imported from product brief",
          provenance: [{ label: "Source", value: "product-brief.md" }],
          relatedPages: [{ id: "atlas", title: "Project Atlas", path: "memory/project-atlas.md" }],
          traceId: "trace-file",
          reasonTags: [{ code: "attachment", label: "Attachment" }],
        },
      });
    }
    if (method === "memory.trace.get") {
      return Promise.resolve({
        traceId,
        summary: ["Query: launch blockers", "Reasons: recent, linked"],
        reasonTags: [{ code: "linked", label: "Linked context" }],
        raw: {
          query: "launch blockers",
          reasons: ["recent", "linked"],
          hits: [{ pageId: "atlas" }],
        },
      });
    }
    if (method === "memory.export") {
      return Promise.resolve({
        format,
        fileName: "memory.json",
        mediaType: "application/json",
        content: '{"ok":true}',
      });
    }
    throw new Error(`unexpected request: ${method}`);
  });
}

function createProps(
  overrides: Partial<Parameters<typeof renderMemoryHub>[0]> = {},
): Parameters<typeof renderMemoryHub>[0] {
  const request = makeRequestMock();
  return {
    client: { request } as unknown as Parameters<typeof renderMemoryHub>[0]["client"],
    connected: true,
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
      ],
    },
    memoryActive: "MEMORY.md",
    memoryContents: {
      "MEMORY.md": "# Main memory",
    },
    memoryDrafts: {
      "MEMORY.md": "# Main memory",
    },
    memorySaving: false,
    memoryDeleting: false,
    memoryStatusLoading: false,
    memoryStatusError: null,
    memoryStatus: {
      agentId: "main",
      enabled: true,
      config: {
        provider: "local",
        fallback: "none",
        sources: ["memory"],
        extraPaths: [],
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
        provider: "local",
        model: "embeddinggemma-300m-qat-Q8_0.gguf",
        files: 2,
        chunks: 10,
        dirty: false,
        dbPath: "/workspace/main/.memory/memory.db",
        sourceCounts: [{ source: "memory", files: 2, chunks: 10 }],
        fts: {
          enabled: true,
          available: true,
        },
        vector: {
          enabled: true,
          available: true,
          dims: 768,
        },
        canonicalStore: {
          state: "ready",
          path: "/Users/test/.alisio/memory/profiles/local-main/canonical.sqlite",
          profileId: "local-main",
          profileSource: "local-profile",
          workspaceScope: "scope-main",
          workspaceDir: "/workspace/main",
          backend: "builtin",
          entities: 2,
          relations: 1,
          projections: 2,
          projectionInterface: "markdown-vault",
          syncMode: "local-first",
          cloudSync: "enabled",
          projectionSources: ["workspace-memory"],
          ledgerEventsCount: 5,
          lastSyncedLamport: 5,
          checkpointsCount: 1,
          e2eeRequired: true,
        },
      },
      embedding: {
        ok: true,
      },
    },
    memorySyncing: false,
    memorySyncAvailable: true,
    memoryGraphLoading: false,
    memoryGraphError: null,
    memoryGraph: {
      query: "Project Atlas",
      profileId: "local-main",
      workspaceScope: "scope-main",
      storePath: "/tmp/canonical.sqlite",
      backend: "builtin",
      state: "ready",
      projectionInterface: "markdown-vault",
      syncMode: "local-first",
      cloudSync: "enabled",
      lastSyncedLamport: 5,
      e2eeRequired: true,
      matches: [
        {
          entityId: "atlas",
          title: "Project Atlas",
          slug: "project-atlas",
          sourcePath: "memory/project-atlas.md",
          sourceKind: "workspace-memory",
          aliases: ["Atlas"],
          tags: ["launch"],
          score: 1,
          projections: [
            {
              projectionId: "projection-atlas",
              path: "memory/project-atlas.md",
              sourceKind: "workspace-memory",
              editable: true,
            },
          ],
          relations: [
            {
              direction: "outgoing",
              relationType: "depends-on",
              ordinal: 0,
              metadata: {},
              relatedEntity: {
                entityId: "roadmap",
                title: "Roadmap",
                slug: "roadmap",
                sourcePath: "memory/roadmap.md",
                sourceKind: "workspace-memory",
              },
            },
          ],
        },
      ],
    },
    memoryGraphQuery: "Project Atlas",
    configLoading: false,
    configSaving: false,
    configDirty: false,
    configSchema: { type: "object", properties: {} },
    configUiHints: {},
    configForm: {
      ui: {
        memory: {
          newViews: { enabled: true },
          traces: { enabled: true },
          legacyEditor: { enabled: false },
        },
      },
    },
    searchQuery: "",
    composerOpen: false,
    composerDate: "2026-04-11",
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

function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((entry) =>
    entry.textContent?.includes(label),
  );
  expect(button).toBeTruthy();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("renderMemoryHub", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the native memory shell with wiki, files, and graph views", async () => {
    const { container } = await mountNativeHub(createProps());

    expect(container.textContent).toContain("Wiki");
    expect(container.textContent).toContain("Files");
    expect(container.textContent).toContain("Graph");
    expect(container.textContent).toContain("Project Atlas");
    expect(container.textContent).toContain("Backlinks");
    expect(container.textContent).toContain("Claims");
    expect(container.textContent).toContain("History");
    expect(container.textContent).toContain("Last synced lamport");
    expect(container.textContent).toContain("E2EE");
    expect(container.textContent).toContain("Required");
  });

  it("opens traces from the wiki context preview", async () => {
    const { container } = await mountNativeHub(createProps());

    clickButton(container, "View trace");
    await flushMemoryHub();

    expect(container.textContent).toContain("Retrieval trace");
    expect(container.textContent).toContain("Query: launch blockers");
    expect(container.textContent).toContain("Linked context");
  });

  it("navigates through files and graph views and opens linked pages from the graph", async () => {
    const onSelectFile = vi.fn();
    const { container } = await mountNativeHub(
      createProps({
        onSelectFile,
      }),
    );

    clickButton(container, "Files");
    await flushMemoryHub();
    expect(container.textContent).toContain("product-brief.pdf");
    expect(container.textContent).toContain("Imported from product brief");
    expect(container.textContent).toContain("Source");

    clickButton(container, "Graph");
    await flushMemoryHub();
    expect(container.textContent).toContain("depends-on");

    clickButton(container, "depends-on");
    await flushMemoryHub();

    expect(container.textContent).toContain("Roadmap");
    expect(onSelectFile).toHaveBeenCalledWith("memory/roadmap.md");
  });

  it("shows a friendly message when the native wiki endpoint is unavailable", async () => {
    const request = vi.fn((method: string) => {
      if (method === "memory.wiki.list") {
        return Promise.reject(
          new GatewayRequestError({
            code: "INVALID_REQUEST",
            message: "unknown method: memory.wiki.list",
          }),
        );
      }
      if (method === "memory.files.list") {
        return Promise.resolve({ agentId: "main", files: [] });
      }
      throw new Error(`unexpected request: ${method}`);
    });

    const { container } = await mountNativeHub(
      createProps({
        client: { request } as unknown as Parameters<typeof renderMemoryHub>[0]["client"],
      }),
    );

    expect(container.textContent).toContain(
      "This version of Alisio does not expose the native memory wiki yet.",
    );
  });

  it("wraps the native hub when the new views flag is enabled", () => {
    const container = document.createElement("div");
    render(renderMemoryHub(createProps()), container);
    expect(container.querySelector("alisio-memory-native-hub")).toBeTruthy();
  });
});
