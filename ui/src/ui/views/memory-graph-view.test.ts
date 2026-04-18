/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMemoryGraphLayout } from "./memory-graph-layout.ts";
import { createMemoryGraphSimulation, stepMemoryGraphSimulation } from "./memory-graph-physics.ts";
import "./memory-graph-view.ts";

function makeGraph() {
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
    scope: "global" as const,
    mode: "overview" as const,
    focus: {
      nodeId: "atlas",
      pageId: "atlas",
      entityId: "atlas",
      title: "Atlas",
      sourcePath: "memory/atlas.md",
    },
    nodes: [
      {
        id: "atlas",
        pageId: "atlas",
        entityId: "atlas",
        kind: "note" as const,
        title: "Atlas",
        slug: "atlas",
        sourcePath: "memory/atlas.md",
        sourceKind: "workspace-memory" as const,
        aliases: [],
        tags: ["launch"],
        incoming: 0,
        outgoing: 1,
        degree: 1,
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
          sourceTitle: "Atlas",
          targetTitle: "Roadmap",
          sourcePath: "memory/atlas.md",
          targetPath: "memory/roadmap.md",
          relationType: "depends-on",
          ordinal: 0,
        },
      },
    ],
    branches: [],
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
}

function makeDenseGraph() {
  return {
    ...makeGraph(),
    nodes: [
      {
        ...makeGraph().nodes[0],
        id: "hub",
        pageId: "hub",
        entityId: "hub",
        title: "Hub",
        slug: "hub",
        degree: 12,
        outgoing: 6,
        incoming: 6,
      },
      {
        ...makeGraph().nodes[1],
        id: "leaf",
        pageId: "leaf",
        entityId: "leaf",
        title: "Leaf",
        slug: "leaf",
        degree: 1,
        sourcePath: "memory/leaf.md",
      },
    ],
    edges: [
      {
        ...makeGraph().edges[0],
        id: "edge-hub-leaf",
        fromId: "hub",
        toId: "leaf",
        fromPageId: "hub",
        toPageId: "leaf",
        reason: {
          ...makeGraph().edges[0].reason,
          sourcePageId: "hub",
          targetPageId: "leaf",
          sourceTitle: "Hub",
          targetTitle: "Leaf",
          sourcePath: "memory/hub.md",
          targetPath: "memory/leaf.md",
        },
      },
    ],
    focus: {
      nodeId: "hub",
      pageId: "hub",
      entityId: "hub",
      title: "Hub",
      sourcePath: "memory/hub.md",
    },
  };
}

async function flushGraphView() {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

function setCanvasRect(canvas: HTMLElement, width: number, height: number) {
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON() {},
    }),
  });
}

describe("memory-graph-view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows grouping controls for the graph", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: ReturnType<typeof makeGraph>;
    };
    element.graph = makeGraph();
    document.body.appendChild(element);

    await flushGraphView();

    const settingsButton = element.querySelector(
      "button[aria-label='Graph']",
    ) as HTMLButtonElement | null;
    expect(settingsButton).toBeTruthy();
    settingsButton?.click();
    await flushGraphView();

    expect(element.textContent).toContain("Groups");
    expect(element.textContent).toContain("Folder");
    expect(element.textContent).toContain("Tag");
    expect(element.textContent).not.toContain("Forces");
    expect(element.textContent).not.toContain("Filter by relation");
  });

  it("opens a context menu on right click and emits local focus actions", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: ReturnType<typeof makeGraph>;
    };
    const focusSpy = vi.fn();
    element.graph = makeGraph();
    element.addEventListener("alisio-memory-graph-focus-node", focusSpy);
    document.body.appendChild(element);

    await flushGraphView();

    const node = element.querySelector(".alisio-memory-graph__node") as SVGGElement | null;
    expect(node).toBeTruthy();
    node?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 140,
      }),
    );
    await flushGraphView();

    const menu = element.querySelector(".alisio-memory-graph__context-menu");
    expect(menu).toBeTruthy();

    const localButton = Array.from(menu?.querySelectorAll("button") ?? []).find((entry) =>
      entry.textContent?.includes("local graph"),
    );
    expect(localButton).toBeTruthy();
    localButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushGraphView();

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy.mock.calls[0]?.[0].detail).toMatchObject({
      nodeId: "atlas",
      pageId: "atlas",
    });
  });

  it("permite arrastar um nó no canvas", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: ReturnType<typeof makeGraph>;
    };
    element.graph = makeGraph();
    document.body.appendChild(element);

    await flushGraphView();

    const node = element.querySelector(".alisio-memory-graph__node") as SVGGElement | null;
    expect(node).toBeTruthy();
    const before = node?.getAttribute("transform");

    node?.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 120,
        clientY: 140,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        clientX: 170,
        clientY: 190,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        clientX: 170,
        clientY: 190,
      }),
    );
    await flushGraphView();

    const after = node?.getAttribute("transform");
    expect(after).not.toBe(before);
  });

  it("renderiza o canvas do grafo com viewport e paints explícitos", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: ReturnType<typeof makeGraph>;
    };
    element.graph = makeGraph();
    document.body.appendChild(element);

    await flushGraphView();

    const canvas = element.querySelector(".alisio-memory-graph__canvas") as HTMLElement | null;
    expect(canvas).toBeTruthy();
    setCanvasRect(canvas!, 960, 640);
    (element as unknown as { requestUpdate: () => void }).requestUpdate();
    await flushGraphView();

    const svg = element.querySelector(".alisio-memory-graph__canvas svg");
    expect(svg?.getAttribute("viewBox")).toBe("-480 -320 960 640");

    const circle = element.querySelector(
      ".alisio-memory-graph__node .alisio-memory-graph__node-body",
    );
    expect(circle?.getAttribute("fill")).toMatch(/rgb|rgba|#/);
    expect(circle?.getAttribute("stroke")).toMatch(/rgb|rgba|#/);
    expect(circle?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(element.querySelector(".alisio-memory-graph__cluster")).toBeNull();
  });

  it("mantém os nós como uma única bola e limita o tamanho máximo", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: ReturnType<typeof makeDenseGraph>;
    };
    element.graph = makeDenseGraph();
    document.body.appendChild(element);

    await flushGraphView();

    const nodeBodies = Array.from(
      element.querySelectorAll<SVGCircleElement>(
        ".alisio-memory-graph__node .alisio-memory-graph__node-body",
      ),
    );
    expect(nodeBodies).toHaveLength(2);
    const radii = nodeBodies.map((node) => Number(node.getAttribute("r")));
    expect(element.querySelector(".alisio-memory-graph__node-halo")).toBeNull();
    expect(element.querySelector(".alisio-memory-graph__node-dot")).toBeNull();
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii));
    expect(Math.max(...radii)).toBeLessThanOrEqual(20);
  });

  it("só aplica atalhos de teclado quando o stage está focado", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: ReturnType<typeof makeGraph>;
    };
    element.graph = makeGraph();
    document.body.appendChild(element);

    await flushGraphView();

    const canvas = element.querySelector(".alisio-memory-graph__canvas") as HTMLElement | null;
    expect(canvas).toBeTruthy();
    setCanvasRect(canvas!, 960, 640);
    (element as unknown as { requestUpdate: () => void }).requestUpdate();
    await flushGraphView();

    const camera = element.querySelector(".alisio-memory-graph__camera") as SVGGElement | null;
    const stage = element.querySelector(".alisio-memory-graph__stage") as HTMLElement | null;
    expect(camera).toBeTruthy();
    expect(stage).toBeTruthy();

    const before = camera?.getAttribute("transform");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flushGraphView();
    expect(camera?.getAttribute("transform")).toBe(before);

    stage?.focus();
    await flushGraphView();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flushGraphView();
    expect(camera?.getAttribute("transform")).not.toBe(before);
  });

  it("actualiza o viewport quando o canvas cresce", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: ReturnType<typeof makeGraph>;
    };
    element.graph = makeGraph();
    document.body.appendChild(element);

    await flushGraphView();

    const canvas = element.querySelector(".alisio-memory-graph__canvas") as HTMLElement | null;
    expect(canvas).toBeTruthy();
    setCanvasRect(canvas!, 960, 640);
    (element as unknown as { requestUpdate: () => void }).requestUpdate();
    await flushGraphView();

    const svg = element.querySelector(".alisio-memory-graph__canvas svg");
    expect(svg?.getAttribute("viewBox")).toBe("-480 -320 960 640");

    setCanvasRect(canvas!, 1120, 760);
    window.dispatchEvent(new Event("resize"));
    await flushGraphView();

    expect(svg?.getAttribute("viewBox")).toBe("-560 -380 1120 760");
  });

  it("mostra e alterna o inspector de arestas ao seleccionar uma ligação", async () => {
    const element = document.createElement("alisio-memory-graph-view") as HTMLElement & {
      graph: ReturnType<typeof makeGraph>;
    };
    element.graph = makeGraph();
    document.body.appendChild(element);

    await flushGraphView();

    const edgeHit = element.querySelector(
      ".alisio-memory-graph__edge-hit",
    ) as SVGLineElement | null;
    expect(edgeHit).toBeTruthy();

    edgeHit?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushGraphView();

    const card = element.querySelector(".alisio-memory-graph__selection-card");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("depends-on");
    expect(card?.textContent).toContain("Atlas");
    expect(card?.textContent).toContain("Roadmap");

    edgeHit?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushGraphView();

    expect(element.querySelector(".alisio-memory-graph__selection-card")).toBeNull();
  });

  it("mantém a rede viva durante o arrasto e faz o nó regressar ao equilíbrio", () => {
    const graph = makeGraph();
    const layout = buildMemoryGraphLayout({
      nodes: graph.nodes,
      edges: graph.edges,
      focusNodeId: graph.focus.nodeId,
      nodeGroups: {
        atlas: "folder:memory",
        roadmap: "folder:memory",
      },
    });
    const simulation = createMemoryGraphSimulation({
      layout,
      nodes: graph.nodes,
    });

    const roadmapBefore = { ...simulation.positions.roadmap };
    simulation.positions.atlas.x += 140;
    simulation.positions.atlas.y += 28;
    simulation.velocities.atlas = { x: 8, y: 2 };

    for (let index = 0; index < 12; index += 1) {
      stepMemoryGraphSimulation({
        state: simulation,
        nodes: graph.nodes,
        edges: graph.edges,
        focusNodeId: graph.focus.nodeId,
        nodeGroups: {
          atlas: "folder:memory",
          roadmap: "folder:memory",
        },
        draggedNodeId: "atlas",
        dtMs: 16.6667,
        localScope: true,
      });
    }

    const roadmapDuringDrag = simulation.positions.roadmap.x;
    expect(roadmapDuringDrag).not.toBe(roadmapBefore.x);

    const releaseDistance = Math.hypot(simulation.positions.atlas.x, simulation.positions.atlas.y);
    for (let index = 0; index < 90; index += 1) {
      stepMemoryGraphSimulation({
        state: simulation,
        nodes: graph.nodes,
        edges: graph.edges,
        focusNodeId: graph.focus.nodeId,
        nodeGroups: {
          atlas: "folder:memory",
          roadmap: "folder:memory",
        },
        draggedNodeId: null,
        dtMs: 16.6667,
        localScope: true,
      });
    }

    const settledDistance = Math.hypot(simulation.positions.atlas.x, simulation.positions.atlas.y);
    expect(settledDistance).toBeLessThan(releaseDistance);
  });
});
