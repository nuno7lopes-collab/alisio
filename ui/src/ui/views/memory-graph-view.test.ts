/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import "./memory-graph-view.ts";

function flushGraphView() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

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
      incoming: 0,
      outgoing: 1,
      degree: 1,
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
  ],
  branches: [
    {
      id: "outgoing:depends-on",
      direction: "outgoing" as const,
      relationType: "depends-on",
      nodeIds: ["roadmap"],
    },
  ],
  availableRelationTypes: ["depends-on"],
  availableTags: ["launch", "planning"],
  stats: {
    totalNodes: 2,
    totalEdges: 1,
    visibleNodes: 2,
    visibleEdges: 1,
  },
  truncated: {
    nodes: false,
    edges: false,
  },
  matches: [],
};

describe("memory graph view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens pages from branch navigation and shows edge reasons", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: typeof graph;
      activeScope: "global" | "local";
      localAvailable: boolean;
    };
    element.graph = graph;
    element.activeScope = "local";
    element.localAvailable = true;
    const opened: Array<{ pageId: string }> = [];
    element.addEventListener("alisio-memory-graph-open-node", (event) => {
      opened.push((event as CustomEvent<{ pageId: string }>).detail);
    });
    document.body.appendChild(element);
    await flushGraphView();

    const edgeHit = element.querySelector(".alisio-memory-graph__edge-hit");
    edgeHit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushGraphView();

    expect(element.textContent).toContain("memory/project-atlas.md");
    expect(element.textContent).toContain("memory/roadmap.md");

    const roadmapButton = Array.from(element.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("Roadmap"),
    );
    roadmapButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushGraphView();

    expect(opened).toEqual([
      expect.objectContaining({
        pageId: "roadmap",
        nodeId: "roadmap",
      }),
    ]);
  });

  it("supports zooming and dragging nodes", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: typeof graph;
      activeScope: "global" | "local";
      localAvailable: boolean;
    };
    element.graph = graph;
    element.activeScope = "local";
    element.localAvailable = true;
    document.body.appendChild(element);
    await flushGraphView();

    const world = element.querySelector("svg > g[transform]") as SVGGElement | null;
    expect(world?.getAttribute("transform")).toBe("translate(0 0) scale(1)");

    const canvas = element.querySelector(".alisio-memory-graph__canvas");
    canvas?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
    await flushGraphView();
    expect(world?.getAttribute("transform")).toContain("scale(1.08)");

    const node = element.querySelector(".alisio-memory-graph__node") as SVGGElement | null;
    const before = node?.getAttribute("transform");
    node?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 150, clientY: 135 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 150, clientY: 135 }));
    await flushGraphView();

    expect(node?.getAttribute("transform")).not.toBe(before);
  });
});
