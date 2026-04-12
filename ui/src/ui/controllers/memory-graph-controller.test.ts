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
      title: "Project Atlas",
      slug: "project-atlas",
      sourcePath: "memory/project-atlas.md",
      sourceKind: "workspace-memory",
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
      title: "Roadmap",
      slug: "roadmap",
      sourcePath: "memory/roadmap.md",
      sourceKind: "workspace-memory",
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
      title: "Launch Notes",
      slug: "launch-notes",
      sourcePath: "memory/launch-notes.md",
      sourceKind: "workspace-memory",
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
  it("filters by relation type and preserves focus visibility", () => {
    const filters = createMemoryGraphFilterState();
    filters.relationTypes = ["depends-on"];

    const view = buildMemoryGraphViewModel(graph, filters);

    expect(view.nodes.map((node) => node.id)).toEqual(["atlas", "roadmap"]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["edge-atlas-roadmap"]);
    expect(view.focusNode?.id).toBe("atlas");
  });

  it("limits the graph to the focused neighborhood when requested", () => {
    const filters = createMemoryGraphFilterState();
    filters.tags = ["launch"];
    filters.neighbourhoodOnly = true;

    const view = buildMemoryGraphViewModel(graph, filters);

    expect(view.nodes.map((node) => node.id)).toEqual(["atlas", "launch"]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["edge-atlas-launch"]);
    expect(view.highlightedNodeIds.has("atlas")).toBe(true);
    expect(view.highlightedNodeIds.has("launch")).toBe(true);
  });
});
