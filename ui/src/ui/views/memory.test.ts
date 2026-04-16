/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderMemoryHub } from "./memory.ts";

function makeGraphResult(
  scope: "global" | "local" = "global",
  focusNoteId: string | null = "atlas",
  includeAttachments = false,
) {
  const nodes = [
    {
      id: "atlas",
      pageId: "atlas",
      entityId: "atlas",
      kind: "note" as const,
      title: "Project Atlas",
      slug: "project-atlas",
      sourcePath: "memory/project-atlas.md",
      sourceKind: "workspace-memory" as const,
      aliases: ["Atlas"],
      tags: ["launch"],
      incoming: 0,
      outgoing: includeAttachments ? 2 : 1,
      degree: includeAttachments ? 2 : 1,
    },
    {
      id: "roadmap",
      pageId: "roadmap",
      entityId: "roadmap",
      kind: "note" as const,
      title: "Roadmap",
      slug: "roadmap",
      sourcePath: "memory/roadmap.md",
      sourceKind: "workspace-memory" as const,
      aliases: [],
      tags: ["planning"],
      incoming: 1,
      outgoing: 0,
      degree: 1,
    },
    ...(includeAttachments
      ? [
          {
            id: "attachment:product-brief.pdf",
            pageId: "attachment:product-brief.pdf",
            entityId: "attachment:product-brief.pdf",
            kind: "attachment" as const,
            title: "product-brief.pdf",
            slug: "product-brief.pdf",
            sourcePath: "attachments/product-brief.pdf",
            sourceKind: "workspace-memory" as const,
            aliases: ["product-brief.pdf"],
            tags: ["application/pdf"],
            attachmentId: "product-brief.pdf",
            fileName: "product-brief.pdf",
            mediaType: "application/pdf",
            incoming: 1,
            outgoing: 0,
            degree: 1,
          },
        ]
      : []),
  ];
  const edges = [
    {
      id: "edge-atlas-roadmap",
      fromId: "atlas",
      toId: "roadmap",
      fromPageId: "atlas",
      toPageId: "roadmap",
      relationType: "depends-on",
      ordinal: 0,
      reason: {
        kind: "canonical-link" as const,
        sourcePageId: "atlas",
        targetPageId: "roadmap",
        sourceTitle: "Project Atlas",
        targetTitle: "Roadmap",
        sourcePath: "memory/project-atlas.md",
        targetPath: "memory/roadmap.md",
        relationType: "depends-on",
        ordinal: 0,
      },
    },
    ...(includeAttachments
      ? [
          {
            id: "edge-atlas-brief",
            fromId: "atlas",
            toId: "attachment:product-brief.pdf",
            fromPageId: "atlas",
            toPageId: "attachment:product-brief.pdf",
            relationType: "references-attachment",
            ordinal: 1,
            reason: {
              kind: "attachment-reference" as const,
              sourcePageId: "atlas",
              targetPageId: "attachment:product-brief.pdf",
              sourceTitle: "Project Atlas",
              targetTitle: "product-brief.pdf",
              sourcePath: "memory/project-atlas.md",
              targetPath: "attachments/product-brief.pdf",
              relationType: "references-attachment",
              ordinal: 1,
              attachmentId: "product-brief.pdf",
              fileName: "product-brief.pdf",
              mediaType: "application/pdf",
            },
          },
        ]
      : []),
  ];
  return {
    query: "",
    profileId: "local-main",
    workspaceScope: "scope-main",
    storePath: "/tmp/canonical.sqlite",
    backend: "builtin" as const,
    state: "ready" as const,
    projectionInterface: "markdown-repo" as const,
    syncMode: "local-first" as const,
    cloudSync: "enabled" as const,
    lastSyncedLamport: 5,
    e2eeRequired: true as const,
    scope,
    mode: scope === "global" ? ("overview" as const) : ("focus" as const),
    focus: focusNoteId
      ? {
          nodeId: focusNoteId,
          pageId: focusNoteId,
          entityId: focusNoteId,
          title: focusNoteId === "atlas" ? "Project Atlas" : "Roadmap",
          sourcePath: focusNoteId === "atlas" ? "memory/project-atlas.md" : "memory/roadmap.md",
        }
      : undefined,
    nodes,
    edges,
    branches: [],
    availableRelationTypes: includeAttachments
      ? ["depends-on", "references-attachment"]
      : ["depends-on"],
    availableTags: includeAttachments
      ? ["application/pdf", "launch", "planning"]
      : ["launch", "planning"],
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      visibleNodes: nodes.length,
      visibleEdges: edges.length,
    },
    truncated: {
      nodes: false,
      edges: false,
    },
    matches: [],
  };
}

async function flushMemoryHub() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

function cleanText(node: ParentNode) {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("style").forEach((entry) => entry.remove());
  return clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
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

function clickButton(container: ParentNode, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((entry) =>
    entry.textContent?.includes(label),
  );
  expect(button).toBeTruthy();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickButtonByLabel(container: ParentNode, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (entry) =>
      entry.getAttribute("aria-label")?.includes(label) ||
      entry.getAttribute("title")?.includes(label),
  );
  expect(button).toBeTruthy();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function makeRequestMock() {
  return vi.fn((method: string, params?: Record<string, unknown>) => {
    const noteId = typeof params?.noteId === "string" ? params.noteId : "atlas";
    const includeAttachments = params?.includeAttachments === true;
    const query = typeof params?.query === "string" ? params.query.trim().toLowerCase() : "";
    if (method === "memory.notes.list") {
      const notes = [
        {
          id: "atlas",
          title: "Project Atlas",
          path: "memory/project-atlas.md",
          excerpt: "Launch blockers and delivery plan.",
          summary: "Launch blockers and delivery plan.",
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
          summary: "Release roadmap",
          backlinks: 1,
          claims: 0,
          evidence: 0,
        },
      ];
      return Promise.resolve({
        agentId: "main",
        sync: {
          lastSyncedLamport: "42",
          e2eeRequired: true,
        },
        exportFormats: ["zip", "json", "markdown"],
        notes: query === "roadmap" ? notes.filter((note) => note.id === "roadmap") : notes,
      });
    }
    if (method === "memory.notes.get" && noteId === "atlas") {
      return Promise.resolve({
        agentId: "main",
        sync: {
          lastSyncedLamport: "42",
          e2eeRequired: true,
        },
        note: {
          id: "atlas",
          title: "Project Atlas",
          path: "memory/project-atlas.md",
          content: [
            "---",
            'summary: "Launch blockers and delivery plan."',
            "---",
            "# Project Atlas",
            "",
            "Project Atlas keeps the launch blockers in one place.",
            "",
            "## Dependencies",
            "",
            "See [[Roadmap]] for the approval track.",
          ].join("\n"),
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
          evidence: [
            {
              id: "evidence-roadmap",
              title: "Roadmap approval",
              source: "roadmap.md",
              excerpt: "Milestone approval still pending.",
              provenance: [{ label: "Chunk", value: "roadmap:14-18" }],
            },
          ],
          attachments: [
            {
              id: "product-brief.pdf",
              name: "product-brief.pdf",
              mediaType: "application/pdf",
              provenanceSummary: "Imported from product brief",
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
            summary: "Updated note",
          },
        },
      });
    }
    if (method === "memory.notes.get" && noteId === "roadmap") {
      return Promise.resolve({
        agentId: "main",
        sync: {
          lastSyncedLamport: "42",
          e2eeRequired: true,
        },
        note: {
          id: "roadmap",
          title: "Roadmap",
          path: "memory/roadmap.md",
          content: "# Roadmap\n\nMilestone approval pending.",
          backlinks: [],
          claims: [],
          evidence: [],
          attachments: [],
          provenance: [{ label: "Ledger", value: "evt-2" }],
        },
      });
    }
    if (method === "memory.notes.history") {
      return Promise.resolve({
        agentId: "main",
        noteId,
        history: [
          {
            eventId: "evt-1",
            lamport: "42",
            summary: "Updated note",
            at: "2026-04-11T10:00:00Z",
            author: "atlas",
            diffSummary: "Claims and evidence refreshed.",
          },
        ],
      });
    }
    if (method === "memory.files.get") {
      return Promise.resolve({
        agentId: "main",
        file: {
          id: "product-brief.pdf",
          name: "product-brief.pdf",
          mediaType: "application/pdf",
          previewKind: "pdf",
          size: 1024,
          sha256: "sha-product-brief",
          updatedAt: "2026-04-11T10:10:00Z",
          summary: "Imported from product brief",
          provenanceSummary: "Imported from product brief",
          relatedPagesCount: 1,
          primaryPage: {
            pageId: "atlas",
            entityId: "atlas",
            title: "Project Atlas",
            path: "memory/project-atlas.md",
            relation: "mentioned",
          },
          provenance: [{ label: "Source", value: "product-brief.md" }],
          preview: {
            kind: "pdf",
            mediaType: "application/pdf",
            bytesBase64: "YnJpZWY=",
          },
          download: {
            fileName: "product-brief.pdf",
            mediaType: "application/pdf",
            bytesBase64: "YnJpZWY=",
          },
          relatedPages: [
            {
              pageId: "atlas",
              entityId: "atlas",
              title: "Project Atlas",
              path: "memory/project-atlas.md",
              relation: "mentioned",
            },
          ],
        },
      });
    }
    if (method === "memory.graph") {
      return Promise.resolve(
        makeGraphResult(
          params?.scope === "local" ? "local" : "global",
          typeof params?.pageId === "string" ? params.pageId : "atlas",
          includeAttachments,
        ),
      );
    }
    if (method === "memory.trace.get") {
      return Promise.resolve({
        traceId: "trace-atlas",
        summary: ["Query: launch blockers", "Reasons: recent, linked"],
        reasonTags: [{ code: "linked", label: "Linked context" }],
        raw: {
          query: "launch blockers",
          reasons: ["recent", "linked"],
          hits: [{ noteId: "atlas" }],
        },
      });
    }
    if (method === "memory.export") {
      return Promise.resolve({
        format: "json",
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
          projectionInterface: "markdown-repo",
          syncMode: "local-first",
          cloudSync: "enabled",
          projectionSources: ["workspace-memory"],
          ledgerEventsCount: 5,
          lastSyncedLamport: 5,
          checkpointsCount: 1,
          e2eeRequired: true,
          syncAvailability: "active",
          syncModeConfigured: "cloud",
        },
      },
      embedding: {
        ok: true,
      },
    },
    memoryGraphLoading: false,
    memoryGraphError: null,
    memoryGraph: makeGraphResult("global"),
    searchQuery: "",
    onSelectAgent: vi.fn(),
    onRefresh: vi.fn(),
    onSearchChange: vi.fn(),
    ...overrides,
  };
}

describe("renderMemoryHub", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the note explorer layout instead of legacy memory view tabs", async () => {
    const { container } = await mountNativeHub(createProps());
    const text = cleanText(container);

    expect(container.querySelector(".alisio-memory-notes__explorer")).toBeTruthy();
    expect(container.querySelectorAll(".alisio-memory-view-tab")).toHaveLength(0);
    expect(container.querySelector(".memory-note__article-markdown")).toBeTruthy();
    expect(text).toContain("Notes");
    expect(text).toContain("Attachments");
    expect(text).toContain("Graph");
  });

  it("renders the shared empty state when the selected agent has no notes yet", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "memory.notes.list") {
        return {
          agentId: "main",
          sync: {
            lastSyncedLamport: "42",
            e2eeRequired: true,
          },
          exportFormats: ["zip"],
          notes: [],
        };
      }
      throw new Error(`unexpected request: ${method}`);
    });

    const { container } = await mountNativeHub(
      createProps({
        client: { request } as unknown as Parameters<typeof renderMemoryHub>[0]["client"],
        memoryGraph: null,
      }),
    );

    const emptyState = container.querySelector(".empty-state--surface.alisio-memory-placeholder");
    expect(emptyState).not.toBeNull();
    expect(cleanText(container)).toContain("New note");
  });

  it("rerenders hub copy when only the locale changes", async () => {
    const { container, hub } = await mountNativeHub(createProps());
    const element = hub as HTMLElement & { updateComplete?: Promise<unknown> };

    expect(cleanText(container)).toContain("Notes");

    await i18n.setLocale("pt-PT");
    await element.updateComplete;
    await flushMemoryHub();

    const text = cleanText(container);
    expect(text).toContain("Notas");
    expect(text).not.toContain("Notes");
  });

  it("não pede o grafo no primeiro open enquanto a vista principal está nas notas", async () => {
    const props = createProps();
    const client = props.client as unknown as { request: ReturnType<typeof makeRequestMock> };

    await mountNativeHub(props);

    expect(client.request.mock.calls.some(([method]) => method === "memory.graph")).toBe(false);
  });

  it("reaproveita a lista e a nota em cache quando a tab é reaberta com o mesmo client", async () => {
    const props = createProps();
    const client = props.client as unknown as { request: ReturnType<typeof makeRequestMock> };
    const firstMount = await mountNativeHub(props);

    firstMount.container.remove();
    client.request.mockClear();

    const secondMount = await mountNativeHub(props);

    expect(cleanText(secondMount.container)).toContain("Project Atlas");
    expect(client.request.mock.calls.some(([method]) => method === "memory.notes.list")).toBe(
      false,
    );
    expect(client.request.mock.calls.some(([method]) => method === "memory.notes.get")).toBe(false);
  });

  it("opens the selected note in reading mode by default and keeps attachments secondary", async () => {
    const { container } = await mountNativeHub(createProps());
    const title = container.querySelector(".alisio-memory-note__title");
    const markdown = container.querySelector(".alisio-memory-note__textarea");
    const text = cleanText(container);

    expect(title?.textContent).toContain("Project Atlas");
    expect(markdown).toBeNull();
    expect(text).toContain("Backlinks");
    expect(text).toContain("Attachments");
    expect(text).toContain("product-brief.pdf");
    expect(text).not.toContain("Context");
    expect(text).not.toContain("Revision");
    expect(text).not.toContain("History");
    expect(text).not.toContain("Provenance");
    expect(text).not.toContain("Memory views");
  });

  it("entra em edição só quando se carrega em editar e volta à leitura depois de guardar", async () => {
    const { container } = await mountNativeHub(createProps());

    clickButtonByLabel(container, "Markdown");
    await flushMemoryHub();

    const title = container.querySelector(
      ".alisio-memory-note__title-input",
    ) as HTMLInputElement | null;
    expect(title?.value).toBe("Project Atlas");
    const markdown = container.querySelector(
      ".alisio-memory-note__textarea",
    ) as HTMLTextAreaElement;
    expect(markdown.value).toContain("# Project Atlas");

    clickButtonByLabel(container, "Save");
    await flushMemoryHub();

    expect(container.querySelector(".alisio-memory-note__title")).toBeTruthy();
    expect(container.querySelector(".alisio-memory-note__textarea")).toBeNull();
  });

  it("loads an attachment preview inside the note detail instead of a separate primary files view", async () => {
    const { container } = await mountNativeHub(createProps());

    clickButton(container, "product-brief.pdf");
    await flushMemoryHub();

    const text = cleanText(container);
    expect(container.querySelector("iframe.alisio-memory-files-preview__frame")).toBeTruthy();
    expect(text).toContain("Download");
    expect(text).toContain("Related notes");
    expect(text).toContain("Project Atlas");
  });

  it("não recarrega o grafo ao mudar de nota enquanto o grafo não está aberto", async () => {
    const props = createProps();
    const client = props.client as unknown as { request: ReturnType<typeof makeRequestMock> };
    const { container } = await mountNativeHub(props);

    client.request.mockClear();

    clickButton(container, "Roadmap");
    await flushMemoryHub();

    expect(client.request.mock.calls.some(([method]) => method === "memory.notes.get")).toBe(true);
    expect(client.request.mock.calls.some(([method]) => method === "memory.graph")).toBe(false);
  });

  it("reloads the graph with attachments on demand and abre notas sem barra lateral", async () => {
    const props = createProps();
    const client = props.client as unknown as { request: ReturnType<typeof makeRequestMock> };
    const { container } = await mountNativeHub(props);

    expect(
      client.request.mock.calls.some(
        ([method, params]) =>
          method === "memory.graph" &&
          (params as Record<string, unknown>).includeAttachments === true,
      ),
    ).toBe(false);

    clickButton(container, "Graph");
    await flushMemoryHub();

    const settingsButton = container.querySelector(
      ".alisio-memory-graph button[aria-label='Graph']",
    ) as HTMLButtonElement | null;
    expect(settingsButton).toBeTruthy();
    settingsButton?.click();
    await flushMemoryHub();

    const toggle = Array.from(container.querySelectorAll("label")).find((entry) =>
      entry.textContent?.includes("Show attachments"),
    );
    const checkbox = toggle?.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    checkbox?.click();
    await flushMemoryHub();

    expect(
      client.request.mock.calls.some(
        ([method, params]) =>
          method === "memory.graph" &&
          (params as Record<string, unknown>).includeAttachments === true,
      ),
    ).toBe(true);

    const graph = container.querySelector("alisio-memory-graph-view");
    expect(graph).toBeTruthy();
    graph?.dispatchEvent(
      new CustomEvent("alisio-memory-graph-open-node", {
        detail: { nodeId: "attachment:product-brief.pdf", pageId: "attachment:product-brief.pdf" },
        bubbles: true,
        composed: true,
      }),
    );
    await flushMemoryHub();
    expect(container.querySelector(".alisio-memory-graph-workspace")).toBeNull();
    expect(container.querySelector("iframe.alisio-memory-files-preview__frame")).toBeTruthy();
    expect(cleanText(container)).toContain("Project Atlas");
  });

  it("opens the graph as a primary workspace view with its own canvas", async () => {
    const props = createProps();
    const client = props.client as unknown as { request: ReturnType<typeof makeRequestMock> };
    const { container } = await mountNativeHub(props);

    clickButton(container, "Graph");
    await flushMemoryHub();

    expect(container.querySelector(".alisio-memory-graph-workspace")).toBeTruthy();
    expect(container.querySelector(".alisio-memory-graph__canvas")).toBeTruthy();
    expect(container.querySelector(".alisio-memory-sidebar")).toBeNull();
    expect(
      client.request.mock.calls.some(
        ([method, params]) =>
          method === "memory.graph" &&
          (params as Record<string, unknown>).scope === "global" &&
          !("pageId" in ((params as Record<string, unknown>) ?? {})) &&
          !("nodeLimit" in ((params as Record<string, unknown>) ?? {})) &&
          !("edgeLimit" in ((params as Record<string, unknown>) ?? {})),
      ),
    ).toBe(true);
  });

  it("não mostra erros SQLite crus quando já existe conteúdo visível", async () => {
    const { container } = await mountNativeHub(
      createProps({
        memoryStatusError: "database is locked: code=ERR_SQLITE_ERROR",
      }),
    );

    const text = cleanText(container);
    expect(text).not.toContain("database is locked");
    expect(text).not.toContain("ERR_SQLITE_ERROR");
    expect(text).toContain("Project Atlas");
  });

  it("can refocus the graph into a local graph from a node action", async () => {
    const props = createProps();
    const client = props.client as unknown as { request: ReturnType<typeof makeRequestMock> };
    const { container } = await mountNativeHub(props);

    clickButton(container, "Graph");
    await flushMemoryHub();

    const graph = container.querySelector("alisio-memory-graph-view");
    expect(graph).toBeTruthy();
    graph?.dispatchEvent(
      new CustomEvent("alisio-memory-graph-focus-node", {
        detail: { nodeId: "roadmap", pageId: "roadmap" },
        bubbles: true,
        composed: true,
      }),
    );
    await flushMemoryHub();

    expect(container.querySelector(".alisio-memory-graph-workspace")).toBeTruthy();
    expect(
      client.request.mock.calls.some(
        ([method, params]) =>
          method === "memory.graph" &&
          (params as Record<string, unknown>).scope === "local" &&
          (params as Record<string, unknown>).pageId === "roadmap",
      ),
    ).toBe(true);
  });

  it("uses the injected graph when a native graph refresh fails", async () => {
    const request = vi.fn((method: string, params?: Record<string, unknown>) => {
      const noteId = typeof params?.noteId === "string" ? params.noteId : "atlas";
      if (method === "memory.notes.list") {
        return Promise.resolve({
          agentId: "main",
          notes: [{ id: "atlas", title: "Project Atlas", path: "memory/project-atlas.md" }],
        });
      }
      if (method === "memory.notes.get") {
        return Promise.resolve({
          agentId: "main",
          note: {
            id: noteId,
            title: "Project Atlas",
            path: "memory/project-atlas.md",
            content: "# Project Atlas",
            attachments: [],
          },
        });
      }
      if (method === "memory.graph") {
        return Promise.reject(new Error("temporary graph fetch failure"));
      }
      throw new Error(`unexpected request: ${method}`);
    });

    const { container } = await mountNativeHub(
      createProps({
        client: { request } as unknown as Parameters<typeof renderMemoryHub>[0]["client"],
        memoryGraph: makeGraphResult("global"),
      }),
    );

    clickButton(container, "Graph");
    await flushMemoryHub();

    expect(container.querySelector(".alisio-memory-graph-workspace")).toBeTruthy();
    expect(container.querySelector(".alisio-memory-graph__canvas")).toBeTruthy();
    expect(cleanText(container)).toContain("Project Atlas");
    expect(cleanText(container)).not.toContain("temporary graph fetch failure");
  });

  it("reloads notes without touching the graph when the sync marker changes in note mode", async () => {
    const props = createProps();
    const client = props.client as unknown as { request: ReturnType<typeof makeRequestMock> };
    const { hub } = await mountNativeHub(props);
    client.request.mockClear();

    hub.props = {
      ...props,
      memoryStatus: {
        ...props.memoryStatus!,
        runtime: {
          ...props.memoryStatus!.runtime!,
          canonicalStore: {
            ...props.memoryStatus!.runtime!.canonicalStore!,
            lastSyncedLamport: 6,
          },
        },
      },
    };
    await flushMemoryHub();

    expect(client.request.mock.calls.some(([method]) => method === "memory.notes.list")).toBe(true);
    expect(client.request.mock.calls.some(([method]) => method === "memory.graph")).toBe(false);
  });

  it("reloads the graph too when the sync marker changes with graph mode open", async () => {
    const props = createProps();
    const client = props.client as unknown as { request: ReturnType<typeof makeRequestMock> };
    const { container, hub } = await mountNativeHub(props);

    clickButton(container, "Graph");
    await flushMemoryHub();
    client.request.mockClear();

    hub.props = {
      ...props,
      memoryStatus: {
        ...props.memoryStatus!,
        runtime: {
          ...props.memoryStatus!.runtime!,
          canonicalStore: {
            ...props.memoryStatus!.runtime!.canonicalStore!,
            lastSyncedLamport: 6,
          },
        },
      },
    };
    await flushMemoryHub();

    expect(client.request.mock.calls.some(([method]) => method === "memory.notes.list")).toBe(true);
    expect(client.request.mock.calls.some(([method]) => method === "memory.graph")).toBe(true);
  });

  it("wraps the native memory hub", () => {
    const container = document.createElement("div");
    render(renderMemoryHub(createProps()), container);
    expect(container.querySelector("alisio-memory-native-hub")).toBeTruthy();
  });
});
