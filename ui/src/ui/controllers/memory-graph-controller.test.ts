import { describe, expect, it } from "vitest";
import {
  buildMemoryGraphViewModel,
  createMemoryGraphFilterState,
} from "./memory-graph-controller.ts";

const graph = {
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
  scope: "local" as const,
  mode: "focus" as const,
  focus: {
    nodeId: "atlas",
    pageId: "atlas",
    entityId: "atlas",
    title: "Project Atlas",
    sourcePath: "memory/project-atlas.md",
  },
  nodes: [
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
      incoming: 1,
      outgoing: 2,
      degree: 3,
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
    {
      id: "launch",
      pageId: "launch",
      entityId: "launch",
      kind: "note" as const,
      title: "Launch Notes",
      slug: "launch-notes",
      sourcePath: "memory/launch-notes.md",
      sourceKind: "workspace-memory" as const,
      aliases: [],
      tags: ["launch"],
      incoming: 1,
      outgoing: 0,
      degree: 1,
    },
  ],
  edges: [
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
    {
      id: "edge-atlas-launch",
      fromId: "atlas",
      toId: "launch",
      fromPageId: "atlas",
      toPageId: "launch",
      relationType: "mentions",
      ordinal: 1,
      reason: {
        kind: "canonical-link" as const,
        sourcePageId: "atlas",
        targetPageId: "launch",
        sourceTitle: "Project Atlas",
        targetTitle: "Launch Notes",
        sourcePath: "memory/project-atlas.md",
        targetPath: "memory/launch-notes.md",
        relationType: "mentions",
        ordinal: 1,
      },
    },
  ],
  branches: [],
  availableRelationTypes: ["depends-on", "mentions"],
  availableTags: ["launch", "planning"],
  stats: {
    totalNodes: 3,
    totalEdges: 2,
    visibleNodes: 3,
    visibleEdges: 2,
  },
  truncated: {
    nodes: false,
    edges: false,
  },
  matches: [],
};

describe("memory graph controller", () => {
  it("filters by tag and preserves focus visibility", () => {
    const filters = createMemoryGraphFilterState();
    filters.tags = ["planning"];

    const view = buildMemoryGraphViewModel(graph, filters);

    expect(view.nodes.map((node) => node.id)).toEqual(["atlas", "roadmap"]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["edge-atlas-roadmap"]);
    expect(view.focusNode?.id).toBe("atlas");
  });

  it("highlights the hovered neighbourhood around the focused node", () => {
    const filters = createMemoryGraphFilterState();
    filters.hoveredNodeId = "launch";

    const view = buildMemoryGraphViewModel(graph, filters);

    expect(view.nodes.map((node) => node.id)).toEqual(["atlas", "roadmap", "launch"]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["edge-atlas-roadmap", "edge-atlas-launch"]);
    expect(view.highlightedNodeIds.has("atlas")).toBe(true);
    expect(view.highlightedNodeIds.has("launch")).toBe(true);
  });

  it("filters visible nodes by local search while preserving focus visibility", () => {
    const filters = createMemoryGraphFilterState();
    filters.searchQuery = "road";

    const view = buildMemoryGraphViewModel(graph, filters);

    expect(view.nodes.map((node) => node.id)).toEqual(["atlas", "roadmap"]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["edge-atlas-roadmap"]);
    expect(view.focusNode?.id).toBe("atlas");
  });

  it("includes attachment nodes when tag filters match them", () => {
    const filters = createMemoryGraphFilterState();
    filters.tags = ["application/pdf"];

    const graphWithAttachment = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: "attachment:brief",
          pageId: "attachment:brief",
          entityId: "attachment:brief",
          kind: "attachment" as const,
          title: "product-brief.pdf",
          slug: "product-brief.pdf",
          sourcePath: "attachments/product-brief.pdf",
          sourceKind: "workspace-memory" as const,
          aliases: ["product-brief.pdf"],
          tags: ["application/pdf"],
          attachmentId: "brief",
          fileName: "product-brief.pdf",
          mediaType: "application/pdf",
          incoming: 1,
          outgoing: 0,
          degree: 1,
        },
      ],
      edges: [
        ...graph.edges,
        {
          id: "edge-atlas-brief",
          fromId: "atlas",
          toId: "attachment:brief",
          fromPageId: "atlas",
          toPageId: "attachment:brief",
          relationType: "references-attachment",
          ordinal: 2,
          reason: {
            kind: "attachment-reference" as const,
            sourcePageId: "atlas",
            targetPageId: "attachment:brief",
            sourceTitle: "Project Atlas",
            targetTitle: "product-brief.pdf",
            sourcePath: "memory/project-atlas.md",
            targetPath: "attachments/product-brief.pdf",
            relationType: "references-attachment",
            ordinal: 2,
            attachmentId: "brief",
            fileName: "product-brief.pdf",
            mediaType: "application/pdf",
          },
        },
      ],
      availableRelationTypes: [...graph.availableRelationTypes, "references-attachment"],
      availableTags: [...graph.availableTags, "application/pdf"],
      stats: {
        totalNodes: 4,
        totalEdges: 3,
        visibleNodes: 4,
        visibleEdges: 3,
      },
    };

    const view = buildMemoryGraphViewModel(graphWithAttachment, filters);

    expect(view.nodes.map((node) => node.id)).toEqual(["atlas", "attachment:brief"]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["edge-atlas-brief"]);
    expect(view.focusNode?.id).toBe("atlas");
  });

  it("keeps non-matching notes visible when no filters are active", () => {
    const filters = createMemoryGraphFilterState();

    const view = buildMemoryGraphViewModel(graph, filters);

    expect(view.nodes.map((node) => node.id)).toEqual(["atlas", "roadmap", "launch"]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["edge-atlas-roadmap", "edge-atlas-launch"]);
    expect(view.focusNode?.id).toBe("atlas");
  });

  it("selecting an edge highlights both endpoint nodes", () => {
    const filters = createMemoryGraphFilterState();
    filters.selectedEdgeId = "edge-atlas-roadmap";

    const view = buildMemoryGraphViewModel(graph, filters);

    expect(view.selectedEdge?.id).toBe("edge-atlas-roadmap");
    expect(view.highlightedNodeIds.has("atlas")).toBe(true);
    expect(view.highlightedNodeIds.has("roadmap")).toBe(true);
    expect(view.nodes.map((node) => node.id)).toContain("launch");
  });
});
