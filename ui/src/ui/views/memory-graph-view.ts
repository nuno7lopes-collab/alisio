import { LitElement, html, nothing, svg } from "lit";
import { property } from "lit/decorators.js";
import {
  buildMemoryGraphViewModel,
  createMemoryGraphFilterState,
  type MemoryGraphFilterState,
  type MemoryGraphViewModel,
} from "../controllers/memory-graph-controller.ts";
import { icons } from "../icons.ts";
import type { MemoryGraphState } from "../types.ts";
import { buildMemoryGraphLayout, type MemoryGraphLayout } from "./memory-graph-layout.ts";
import {
  createMemoryGraphSimulation,
  stepMemoryGraphSimulation,
  type MemoryGraphSimulationState,
} from "./memory-graph-physics.ts";

export type MemoryGraphViewText = {
  graphTitle: string;
  graphLoading: string;
  graphUnavailable: string;
  graphEmpty: string;
  graphFocus: string;
  graphGlobal: string;
  graphLocal: string;
  graphDepth?: string;
  graphResetView: string;
  graphFilterTags: string;
  graphGroups?: string;
  graphColorBy?: string;
  graphGroupNone?: string;
  graphGroupFolder?: string;
  graphGroupTag?: string;
  graphGroupKind?: string;
  graphGroupSource?: string;
  graphGroupNote?: string;
  graphGroupAttachment?: string;
  graphContextMenuOpen?: string;
  graphContextMenuCenter?: string;
  graphContextMenuLocal?: string;
  graphNodesCount: string;
  graphEdgesCount: string;
  graphCenterFocus?: string;
  graphShowAttachments?: string;
  graphZoomIn?: string;
  graphZoomOut?: string;
  graphRelationType?: string;
  graphSource?: string;
  graphTarget?: string;
  graphCanvasHint?: string;
};

type GraphGroupMode = "none" | "folder" | "tag" | "kind" | "source";

type GraphContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

type GraphGroupSummary = {
  label: string;
  detail: string;
};

type GraphClusterOverlay = {
  id: string;
  label: string;
  color: string;
  count: number;
  x: number;
  y: number;
  radius: number;
};

type DragState =
  | {
      kind: "pan";
      lastX: number;
      lastY: number;
    }
  | {
      kind: "node";
      nodeId: string;
      lastX: number;
      lastY: number;
      moved: boolean;
    };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shortenGraphLabel(value: string, max = 22) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function titleCase(value: string) {
  return value
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveGraphColor(groupId: string) {
  const palette = [
    "#7bb9ff",
    "#ffb86c",
    "#7fd1ae",
    "#c8a2ff",
    "#ff9fb2",
    "#9bd6f2",
    "#ffd166",
    "#95d5b2",
  ];
  return palette[hashString(groupId) % palette.length] ?? palette[0];
}

const GRAPH_SURFACE_ELEVATED = "#171b24";
const GRAPH_TEXT = "#edf2fb";
const GRAPH_TEXT_MUTED = "#a8b4c7";
const GRAPH_EDGE = "#9aa7ba";
const GRAPH_EDGE_HIGHLIGHT = "#8f5bff";
const GRAPH_NOTE = "#8ba8ff";
const GRAPH_ATTACHMENT = "#d8aa63";
const GRAPH_SHADOW = "rgba(8, 14, 28, 0.22)";
const GRAPH_OVERLAY_TOP = "rgba(0, 0, 0, 0.06)";
const GRAPH_OVERLAY_BOTTOM = "rgba(0, 0, 0, 0.08)";
const GRAPH_GRID_LINE = "rgba(173, 183, 198, 0.08)";

type GraphThemePalette = {
  surfaceElevated: string;
  text: string;
  textMuted: string;
  edge: string;
  edgeHighlight: string;
  note: string;
  attachment: string;
  gridLine: string;
  overlayTop: string;
  overlayBottom: string;
  shadow: string;
};

function hexToRgb(value: string) {
  const normalized = value.trim().replace("#", "");
  if (normalized.length !== 6) {
    return null;
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  if ([red, green, blue].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return { red, green, blue };
}

function mixColors(base: string, tint: string, tintWeight: number) {
  const baseRgb = hexToRgb(base);
  const tintRgb = hexToRgb(tint);
  if (!baseRgb || !tintRgb) {
    return tint;
  }
  const weight = clamp(tintWeight, 0, 1);
  const inverseWeight = 1 - weight;
  const red = Math.round(baseRgb.red * inverseWeight + tintRgb.red * weight);
  const green = Math.round(baseRgb.green * inverseWeight + tintRgb.green * weight);
  const blue = Math.round(baseRgb.blue * inverseWeight + tintRgb.blue * weight);
  return `rgb(${String(red)} ${String(green)} ${String(blue)})`;
}

function withAlpha(color: string, alpha: number) {
  const rgb = hexToRgb(color);
  if (!rgb) {
    return color;
  }
  return `rgba(${String(rgb.red)}, ${String(rgb.green)}, ${String(rgb.blue)}, ${String(
    clamp(alpha, 0, 1),
  )})`;
}

function resolveCssColorVar(target: Element, name: string, fallback: string, alpha?: number) {
  const value = globalThis.getComputedStyle?.(target).getPropertyValue(name).trim() || fallback;
  return alpha == null ? value : withAlpha(value, alpha);
}

function buildNodeGroups(view: MemoryGraphViewModel, mode: GraphGroupMode) {
  const groups: Record<string, string> = {};
  if (mode === "none") {
    return groups;
  }
  for (const node of view.nodes) {
    if (groups[node.id]) {
      continue;
    }
    const pathSegments = node.sourcePath.split("/").filter(Boolean);
    const folder = pathSegments.length > 1 ? pathSegments.slice(0, -1).join("/") : pathSegments[0];
    const tag = node.tags.find((entry) => entry.trim()) ?? null;
    if (mode === "folder") {
      groups[node.id] = folder
        ? `folder:${folder}`
        : node.kind === "attachment"
          ? "attachments"
          : `source:${node.sourceKind}`;
      continue;
    }
    if (mode === "tag") {
      groups[node.id] = tag
        ? `tag:${tag}`
        : node.kind === "attachment"
          ? "attachments"
          : folder
            ? `folder:${folder}`
            : `source:${node.sourceKind}`;
      continue;
    }
    if (mode === "kind") {
      groups[node.id] = node.kind;
      continue;
    }
    groups[node.id] = `source:${node.sourceKind}`;
  }
  return groups;
}

function describeGraphGroup(groupId: string, text: MemoryGraphViewText): GraphGroupSummary {
  const label =
    groupId === "note"
      ? (text.graphGroupNote ?? "Note")
      : groupId === "attachment"
        ? (text.graphGroupAttachment ?? "Attachment")
        : groupId.startsWith("folder:")
          ? groupId.slice("folder:".length)
          : groupId.startsWith("tag:")
            ? `#${groupId.slice("tag:".length)}`
            : groupId.startsWith("source:")
              ? titleCase(groupId.slice("source:".length))
              : titleCase(groupId);
  const detail =
    groupId === "note"
      ? `${text.graphGroupKind ?? "Type"} · ${text.graphGroupNote ?? "Note"}`
      : groupId === "attachment"
        ? `${text.graphGroupKind ?? "Type"} · ${text.graphGroupAttachment ?? "Attachment"}`
        : label;
  return {
    label,
    detail,
  };
}

function buildGraphClusterOverlays(params: {
  view: MemoryGraphViewModel;
  layout: MemoryGraphLayout;
  nodeGroups: Record<string, string | null | undefined>;
  text: MemoryGraphViewText;
}): GraphClusterOverlay[] {
  const groups = new Map<string, Array<{ x: number; y: number }>>();
  for (const node of params.view.nodes) {
    const groupId = params.nodeGroups[node.id];
    const position = params.layout[node.id];
    if (!groupId || !position) {
      continue;
    }
    const entries = groups.get(groupId) ?? [];
    entries.push(position);
    groups.set(groupId, entries);
  }
  if (groups.size <= 1) {
    return [];
  }
  return Array.from(groups.entries())
    .map(([groupId, points]) => {
      const centroid = points.reduce(
        (acc, point) => {
          acc.x += point.x;
          acc.y += point.y;
          return acc;
        },
        { x: 0, y: 0 },
      );
      centroid.x /= points.length;
      centroid.y /= points.length;
      const radius = clamp(
        points.reduce(
          (maxRadius, point) =>
            Math.max(maxRadius, Math.hypot(point.x - centroid.x, point.y - centroid.y)),
          0,
        ) + 84,
        96,
        312,
      );
      const summary = describeGraphGroup(groupId, params.text);
      return {
        id: groupId,
        label: summary.label,
        color: resolveGraphColor(groupId),
        count: points.length,
        x: centroid.x,
        y: centroid.y,
        radius,
      } satisfies GraphClusterOverlay;
    })
    .toSorted((left, right) => right.radius - left.radius);
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select, button") ||
      Boolean(target.closest("[contenteditable='true']")))
  );
}

export class AlisioMemoryGraphView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ attribute: false })
  graph: MemoryGraphState | null = null;

  @property({ type: Boolean })
  loading = false;

  @property()
  error: string | null = null;

  @property({ attribute: false })
  text: MemoryGraphViewText | null = null;

  @property({ type: Boolean })
  localAvailable = false;

  @property()
  activeScope: "global" | "local" = "global";

  @property({ type: Boolean })
  includeAttachments = false;

  @property({ type: Number })
  localDepth = 2;

  @property()
  searchQuery = "";

  @property({ type: Boolean })
  compact = false;

  private filters: MemoryGraphFilterState = createMemoryGraphFilterState();
  private layout: MemoryGraphLayout = {};
  private layoutSignature = "";
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private dragState: DragState | null = null;
  private showArrows = false;
  private nodeScale = 1.04;
  private linkThickness = 1.08;
  private textFadeThreshold = 0.82;
  private groupMode: GraphGroupMode = "folder";
  private contextMenu: GraphContextMenuState | null = null;
  private simulationState: MemoryGraphSimulationState | null = null;
  private simulationFrame: number | null = null;
  private lastSimulationTs: number | null = null;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private settingsOpen = false;
  private pendingViewportFit = true;
  private interactionActive = false;
  private readonly svgIds = {
    arrow: `alisio-memory-graph-arrow-${Math.random().toString(36).slice(2, 9)}`,
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("mousemove", this.handleGlobalMouseMove);
    window.addEventListener("mouseup", this.handleGlobalMouseUp);
    window.addEventListener("mousedown", this.handleGlobalMouseDown);
    window.addEventListener("keydown", this.handleGlobalKeyDown);
    window.addEventListener("resize", this.handleViewportResize);
  }

  disconnectedCallback() {
    window.removeEventListener("mousemove", this.handleGlobalMouseMove);
    window.removeEventListener("mouseup", this.handleGlobalMouseUp);
    window.removeEventListener("mousedown", this.handleGlobalMouseDown);
    window.removeEventListener("keydown", this.handleGlobalKeyDown);
    window.removeEventListener("resize", this.handleViewportResize);
    if (this.simulationFrame !== null) {
      window.cancelAnimationFrame(this.simulationFrame);
      this.simulationFrame = null;
    }
    super.disconnectedCallback();
  }

  protected updated() {
    if (this.syncCanvasMetrics() && this.pendingViewportFit) {
      this.fitGraphToViewport();
    } else if (this.pendingViewportFit && this.canvasWidth > 0 && this.canvasHeight > 0) {
      this.fitGraphToViewport();
    }
  }

  private get resolvedText(): MemoryGraphViewText {
    return (
      this.text ?? {
        graphTitle: "Graph",
        graphLoading: "Loading graph",
        graphUnavailable: "Graph unavailable",
        graphEmpty: "No graph data available.",
        graphFocus: "Focus",
        graphGlobal: "Global",
        graphLocal: "Local",
        graphDepth: "Local depth",
        graphResetView: "Reset view",
        graphFilterTags: "Tag filters",
        graphGroups: "Groups",
        graphColorBy: "Color by",
        graphGroupNone: "None",
        graphGroupFolder: "Folder",
        graphGroupTag: "Tag",
        graphGroupKind: "Type",
        graphGroupSource: "Source",
        graphGroupNote: "Note",
        graphGroupAttachment: "Attachment",
        graphContextMenuOpen: "Open",
        graphContextMenuCenter: "Center node",
        graphContextMenuLocal: "Open local graph",
        graphNodesCount: "Nodes",
        graphEdgesCount: "Edges",
        graphCenterFocus: "Center focus",
        graphShowAttachments: "Attachments",
        graphZoomIn: "Zoom in",
        graphZoomOut: "Zoom out",
        graphRelationType: "Relation",
        graphSource: "Source",
        graphTarget: "Target",
        graphCanvasHint:
          "Drag to pan, scroll to zoom, hover a node to inspect it, click to open it, and right-click for more actions.",
      }
    );
  }

  private get activeFilters(): MemoryGraphFilterState {
    const searchQuery = this.activeScope === "global" ? this.searchQuery : "";
    return {
      ...this.filters,
      searchQuery,
    };
  }

  private updateFilters(next: Partial<MemoryGraphFilterState>) {
    this.filters = {
      ...this.filters,
      ...next,
    };
    this.requestUpdate();
  }

  private viewportViewBox() {
    const width = Math.max(this.canvasWidth, 960);
    const height = Math.max(this.canvasHeight, this.compact ? 420 : 640);
    return {
      width,
      height,
      minX: -width / 2,
      minY: -height / 2,
    };
  }

  private syncCanvasMetrics() {
    const canvas = this.querySelector(".alisio-memory-graph__canvas");
    if (!(canvas instanceof HTMLElement)) {
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.round(rect.width);
    const nextHeight = Math.round(rect.height);
    if (
      nextWidth <= 0 ||
      nextHeight <= 0 ||
      (nextWidth === this.canvasWidth && nextHeight === this.canvasHeight)
    ) {
      return false;
    }
    this.canvasWidth = nextWidth;
    this.canvasHeight = nextHeight;
    return true;
  }

  private handleViewportResize = () => {
    if (!this.syncCanvasMetrics()) {
      return;
    }
    if (this.pendingViewportFit) {
      this.fitGraphToViewport();
      return;
    }
    this.requestUpdate();
  };

  private setInteractionActive(active: boolean) {
    if (this.interactionActive === active) {
      return;
    }
    this.interactionActive = active;
    this.requestUpdate();
  }

  private focusStage() {
    const stage = this.querySelector(".alisio-memory-graph__stage");
    if (stage instanceof HTMLElement) {
      stage.focus({ preventScroll: true });
    }
  }

  private hasKeyboardFocus() {
    const stage = this.querySelector(".alisio-memory-graph__stage");
    return (
      stage instanceof HTMLElement &&
      (document.activeElement === stage || stage.contains(document.activeElement))
    );
  }

  private projectScreenPointToWorld(localX: number, localY: number) {
    return {
      x: (localX - this.panX) / this.zoom,
      y: (localY - this.panY) / this.zoom,
    };
  }

  private applyZoom(nextZoom: number, anchorLocalX = 0, anchorLocalY = 0) {
    const clampedZoom = clamp(nextZoom, 0.35, 2.6);
    if (!Number.isFinite(clampedZoom) || clampedZoom === this.zoom) {
      return;
    }
    const worldPoint = this.projectScreenPointToWorld(anchorLocalX, anchorLocalY);
    this.zoom = clampedZoom;
    this.panX = anchorLocalX - worldPoint.x * this.zoom;
    this.panY = anchorLocalY - worldPoint.y * this.zoom;
    this.pendingViewportFit = false;
  }

  private adjustZoom(factor: number) {
    this.applyZoom(this.zoom * factor);
    this.requestUpdate();
  }

  private resetViewport() {
    this.pendingViewportFit = true;
    this.requestUpdate();
  }

  private centerFocus() {
    const view = this.ensureLayout();
    const focusId = view.focusNode?.id ?? null;
    if (!focusId) {
      this.resetViewport();
      return;
    }
    const position = this.layout[focusId];
    if (!position) {
      this.resetViewport();
      return;
    }
    this.panX = -position.x * this.zoom;
    this.panY = -position.y * this.zoom;
    this.pendingViewportFit = false;
    this.requestUpdate();
  }

  private centerNode(nodeId: string) {
    const position = this.layout[nodeId];
    if (!position) {
      return;
    }
    this.panX = -position.x * this.zoom;
    this.panY = -position.y * this.zoom;
    this.pendingViewportFit = false;
    this.requestUpdate();
  }

  private fitGraphToViewport() {
    if (this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      return;
    }
    const points = Object.values(this.layout);
    if (points.length === 0) {
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.pendingViewportFit = false;
      this.requestUpdate();
      return;
    }
    const bounds = points.reduce(
      (acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        maxX: Math.max(acc.maxX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxY: Math.max(acc.maxY, point.y),
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      },
    );
    const padding = 96;
    const graphWidth = Math.max(bounds.maxX - bounds.minX, 220);
    const graphHeight = Math.max(bounds.maxY - bounds.minY, 220);
    const availableWidth = Math.max(this.canvasWidth - padding * 2, 220);
    const availableHeight = Math.max(this.canvasHeight - padding * 2, 220);
    const scaleX = availableWidth / graphWidth;
    const scaleY = availableHeight / graphHeight;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    this.zoom = clamp(Math.min(scaleX, scaleY), 0.42, 1.85);
    this.panX = -centerX * this.zoom;
    this.panY = -centerY * this.zoom;
    this.pendingViewportFit = false;
    this.requestUpdate();
  }

  private cloneLayout(layout: MemoryGraphLayout) {
    return Object.fromEntries(
      Object.entries(layout).map(([id, point]) => [id, { x: point.x, y: point.y }]),
    );
  }

  private startSimulation() {
    if (!this.simulationState || this.simulationFrame !== null) {
      return;
    }
    const tick = (timestamp: number) => {
      this.simulationFrame = null;
      if (!this.graph || !this.simulationState) {
        this.lastSimulationTs = null;
        return;
      }
      const view = buildMemoryGraphViewModel(this.graph, this.activeFilters);
      if (view.nodes.length === 0) {
        this.layout = {};
        this.simulationState = null;
        this.lastSimulationTs = null;
        this.requestUpdate();
        return;
      }
      const result = stepMemoryGraphSimulation({
        state: this.simulationState,
        nodes: view.nodes,
        edges: view.edges,
        focusNodeId: view.focusNode?.id ?? null,
        nodeGroups: buildNodeGroups(view, this.groupMode),
        draggedNodeId: this.dragState?.kind === "node" ? this.dragState.nodeId : null,
        dtMs: this.lastSimulationTs == null ? 16.6667 : timestamp - this.lastSimulationTs,
        localScope: this.activeScope === "local",
      });
      this.lastSimulationTs = timestamp;
      this.layout = this.cloneLayout(this.simulationState.positions);
      if (this.pendingViewportFit && this.canvasWidth > 0 && this.canvasHeight > 0) {
        this.fitGraphToViewport();
      } else {
        this.requestUpdate();
      }
      if (!result.settled || this.dragState?.kind === "node") {
        this.simulationFrame = window.requestAnimationFrame(tick);
        return;
      }
      this.lastSimulationTs = null;
    };
    this.simulationFrame = window.requestAnimationFrame(tick);
  }

  private resetSimulation(view: MemoryGraphViewModel) {
    const nextLayout = buildMemoryGraphLayout({
      nodes: view.nodes,
      edges: view.edges,
      focusNodeId: view.focusNode?.id ?? null,
      previousLayout: this.simulationState?.positions ?? this.layout,
      nodeGroups: buildNodeGroups(view, this.groupMode),
    });
    this.simulationState = createMemoryGraphSimulation({
      layout: nextLayout,
      previousState: this.simulationState,
      nodes: view.nodes,
    });
    this.layout = this.cloneLayout(this.simulationState.positions);
    this.lastSimulationTs = null;
    this.pendingViewportFit = true;
    this.startSimulation();
  }

  private ensureLayout() {
    const filters = this.activeFilters;
    const view = buildMemoryGraphViewModel(this.graph, filters);
    const signature = JSON.stringify({
      scope: this.activeScope,
      focus: view.focusNode?.id ?? null,
      searchQuery: filters.searchQuery.trim(),
      tags: [...filters.tags].toSorted(),
      groupMode: this.groupMode,
      nodes: view.nodes.map((node) => node.id),
      edges: view.edges.map((edge) => edge.id),
    });
    if (signature !== this.layoutSignature) {
      this.layoutSignature = signature;
      this.resetSimulation(view);
    } else if (!this.simulationState && view.nodes.length > 0) {
      this.resetSimulation(view);
    }
    return view;
  }

  private handleGlobalMouseMove = (event: MouseEvent) => {
    if (!this.dragState) {
      return;
    }
    const dx = event.clientX - this.dragState.lastX;
    const dy = event.clientY - this.dragState.lastY;
    if (this.dragState.kind === "pan") {
      this.panX += dx;
      this.panY += dy;
      this.pendingViewportFit = false;
      this.dragState = { ...this.dragState, lastX: event.clientX, lastY: event.clientY };
      this.requestUpdate();
      return;
    }
    const nodePosition = this.layout[this.dragState.nodeId];
    if (!nodePosition) {
      return;
    }
    const nextDx = dx / this.zoom;
    const nextDy = dy / this.zoom;
    nodePosition.x += nextDx;
    nodePosition.y += nextDy;
    if (this.simulationState) {
      this.simulationState.positions[this.dragState.nodeId] = { ...nodePosition };
      this.simulationState.velocities[this.dragState.nodeId] = { x: nextDx, y: nextDy };
    }
    this.dragState = {
      kind: "node",
      nodeId: this.dragState.nodeId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: this.dragState.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2,
    };
    this.pendingViewportFit = false;
    this.startSimulation();
    this.requestUpdate();
  };

  private handleGlobalMouseUp = () => {
    if (!this.dragState) {
      return;
    }
    const dragState = this.dragState;
    this.dragState = null;
    if (dragState.kind === "node") {
      if (!dragState.moved) {
        this.dispatchNodeOpen(dragState.nodeId);
        return;
      }
      this.startSimulation();
    }
    if (!this.hasKeyboardFocus() && !this.contextMenu) {
      this.setInteractionActive(false);
    }
  };

  private handleGlobalMouseDown = (event: MouseEvent) => {
    const target = event.target;
    let changed = false;
    if (
      this.settingsOpen &&
      !(
        target instanceof Element &&
        target.closest(".alisio-memory-graph__settings, .alisio-memory-graph__settings-toggle")
      )
    ) {
      this.settingsOpen = false;
      changed = true;
    }
    if (this.contextMenu) {
      if (target instanceof Element && target.closest(".alisio-memory-graph__context-menu")) {
        return;
      }
      this.contextMenu = null;
      changed = true;
    }
    if (changed) {
      this.requestUpdate();
    }
  };

  private handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) {
      return;
    }
    if (!this.hasKeyboardFocus() && !this.contextMenu) {
      return;
    }
    if (event.key === "Escape") {
      const hadSelectedEdge = Boolean(this.filters.selectedEdgeId);
      let changed = false;
      if (this.contextMenu) {
        this.contextMenu = null;
        changed = true;
      }
      if (this.settingsOpen) {
        this.settingsOpen = false;
        changed = true;
      }
      if (hadSelectedEdge) {
        this.updateFilters({ selectedEdgeId: null, hoveredNodeId: null });
      } else if (changed) {
        this.requestUpdate();
      }
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      this.adjustZoom(1.08);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      this.adjustZoom(0.92);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      this.resetViewport();
      return;
    }
    const step = event.shiftKey ? 72 : 28;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.panX += step;
      this.pendingViewportFit = false;
      this.requestUpdate();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.panX -= step;
      this.pendingViewportFit = false;
      this.requestUpdate();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.panY += step;
      this.pendingViewportFit = false;
      this.requestUpdate();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.panY -= step;
      this.pendingViewportFit = false;
      this.requestUpdate();
    }
  };

  private handleStageMouseEnter = () => {
    this.setInteractionActive(true);
  };

  private handleStageMouseLeave = () => {
    if (!this.dragState && !this.hasKeyboardFocus() && !this.contextMenu) {
      this.setInteractionActive(false);
    }
  };

  private handleStageFocusIn = () => {
    this.setInteractionActive(true);
  };

  private handleStageFocusOut = () => {
    queueMicrotask(() => {
      if (!this.dragState && !this.hasKeyboardFocus() && !this.contextMenu) {
        this.setInteractionActive(false);
      }
    });
  };

  private dispatchNodeOpen(nodeId: string) {
    const node = this.graph?.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("alisio-memory-graph-open-node", {
        detail: {
          pageId: node.pageId,
          nodeId: node.id,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchScopeChange(scope: "global" | "local") {
    this.dispatchEvent(
      new CustomEvent("alisio-memory-graph-scope-change", {
        detail: { scope },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchAttachmentsChange(includeAttachments: boolean) {
    this.dispatchEvent(
      new CustomEvent("alisio-memory-graph-attachments-change", {
        detail: { includeAttachments },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchDepthChange(depth: number) {
    this.dispatchEvent(
      new CustomEvent("alisio-memory-graph-depth-change", {
        detail: { depth },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchLocalFocus(nodeId: string) {
    const node = this.graph?.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("alisio-memory-graph-focus-node", {
        detail: {
          nodeId: node.id,
          pageId: node.pageId,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleCanvasMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.focusStage();
    this.setInteractionActive(true);
    if (this.filters.selectedEdgeId || this.filters.hoveredNodeId) {
      this.updateFilters({ selectedEdgeId: null, hoveredNodeId: null });
    }
    this.dragState = {
      kind: "pan",
      lastX: event.clientX,
      lastY: event.clientY,
    };
  };

  private handleNodeMouseDown(event: MouseEvent, nodeId: string) {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    this.focusStage();
    this.setInteractionActive(true);
    this.dragState = {
      kind: "node",
      nodeId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
  }

  private handleNodeContextMenu(event: MouseEvent, nodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    this.focusStage();
    this.setInteractionActive(true);
    this.contextMenu = {
      nodeId,
      x: event.clientX,
      y: event.clientY,
    };
    this.requestUpdate();
  }

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.setInteractionActive(true);
    const canvas = event.currentTarget;
    if (!(canvas instanceof HTMLElement)) {
      this.adjustZoom(event.deltaY < 0 ? 1.08 : 0.92);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const nextZoom = clamp(this.zoom * (event.deltaY < 0 ? 1.08 : 0.92), 0.35, 2.6);
    if (rect.width <= 0 || rect.height <= 0 || nextZoom === this.zoom) {
      this.adjustZoom(event.deltaY < 0 ? 1.08 : 0.92);
      return;
    }
    const localX = ((event.clientX - rect.left) / rect.width) * rect.width - rect.width / 2;
    const localY = ((event.clientY - rect.top) / rect.height) * rect.height - rect.height / 2;
    this.applyZoom(nextZoom, localX, localY);
    this.requestUpdate();
  };

  private renderTopbar(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const zoomLabel = `${Math.round(this.zoom * 100)}%`;
    return html`
      <div class="alisio-memory-graph__topbar">
        <div class="alisio-memory-graph__scope">
          <button
            type="button"
            class="btn btn--sm ${this.activeScope === "global" ? "primary" : ""}"
            title=${text.graphGlobal}
            @click=${() => this.dispatchScopeChange("global")}
          >
            ${text.graphGlobal}
          </button>
          <button
            type="button"
            class="btn btn--sm ${this.activeScope === "local" ? "primary" : ""}"
            ?disabled=${!this.localAvailable}
            title=${text.graphLocal}
            @click=${() => this.dispatchScopeChange("local")}
          >
            ${text.graphLocal}
          </button>
        </div>
        <div class="alisio-memory-graph__topbar-meta">
          <span class="alisio-memory-graph__pill"
            >${text.graphNodesCount}: ${view.nodes.length}</span
          >
          <span class="alisio-memory-graph__pill"
            >${text.graphEdgesCount}: ${view.edges.length}</span
          >
          <span class="alisio-memory-graph__pill">${zoomLabel}</span>
        </div>
        <div class="alisio-memory-graph__toolbar">
          <button
            type="button"
            class="btn btn--icon btn--ghost"
            title=${text.graphZoomIn ?? "Zoom in"}
            aria-label=${text.graphZoomIn ?? "Zoom in"}
            @click=${() => this.adjustZoom(1.08)}
          >
            ${icons.plus}
          </button>
          <button
            type="button"
            class="btn btn--icon btn--ghost"
            title=${text.graphZoomOut ?? "Zoom out"}
            aria-label=${text.graphZoomOut ?? "Zoom out"}
            @click=${() => this.adjustZoom(0.92)}
          >
            -
          </button>
          <button
            type="button"
            class="btn btn--sm"
            @click=${() => this.centerFocus()}
            ?disabled=${!view.focusNode}
          >
            ${text.graphCenterFocus ?? text.graphFocus}
          </button>
          <button type="button" class="btn btn--sm" @click=${() => this.resetViewport()}>
            ${text.graphResetView}
          </button>
          <button
            type="button"
            class="btn btn--icon alisio-memory-graph__settings-toggle ${this.settingsOpen
              ? "primary"
              : "btn--ghost"}"
            title=${text.graphTitle}
            aria-label=${text.graphTitle}
            @click=${() => {
              this.focusStage();
              this.setInteractionActive(true);
              this.settingsOpen = !this.settingsOpen;
              this.requestUpdate();
            }}
          >
            ${icons.settings}
          </button>
        </div>
      </div>
    `;
  }

  private renderSettingsPanel(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    if (!this.settingsOpen) {
      return nothing;
    }
    return html`
      <aside class="alisio-memory-graph__settings">
        ${this.renderFiltersCard(view, text)} ${this.renderGroupsCard(view, text)}
      </aside>
    `;
  }

  private renderFiltersCard(_view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const selectedTags = new Set(this.filters.tags);
    const hasTagFilters = this.graph!.availableTags.length > 0;
    return html`
      <section class="alisio-memory-graph__card">
        <label class="field checkbox" style="margin: 0;">
          <input
            type="checkbox"
            .checked=${this.includeAttachments}
            @change=${(event: Event) =>
              this.dispatchAttachmentsChange((event.currentTarget as HTMLInputElement).checked)}
          />
          <span class="field-checkbox__label">${text.graphShowAttachments ?? "Attachments"}</span>
        </label>
        ${this.activeScope === "local"
          ? this.renderSliderRow({
              label: text.graphDepth ?? "Local depth",
              value: this.localDepth,
              min: 1,
              max: 4,
              step: 1,
              onInput: (value) => this.dispatchDepthChange(Math.round(value)),
            })
          : nothing}
        ${hasTagFilters
          ? html`
              <div class="alisio-memory-group__header"><h2>${text.graphFilterTags}</h2></div>
              <div class="alisio-memory-graph__chips">
                ${this.graph!.availableTags.map(
                  (tag) => html`
                    <button
                      type="button"
                      class="btn btn--sm ${selectedTags.has(tag) ? "primary" : ""}"
                      aria-pressed=${selectedTags.has(tag)}
                      @click=${() =>
                        this.updateFilters({
                          tags: selectedTags.has(tag)
                            ? this.filters.tags.filter((value) => value !== tag)
                            : [...this.filters.tags, tag],
                          selectedEdgeId: null,
                        })}
                    >
                      ${tag}
                    </button>
                  `,
                )}
              </div>
            `
          : nothing}
      </section>
    `;
  }

  private renderGroupsCard(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const assignments = buildNodeGroups(view, this.groupMode);
    const groupIds = Array.from(
      new Set(
        view.nodes
          .map((node) => assignments[node.id])
          .filter((value): value is string => Boolean(value)),
      ),
    ).toSorted((left, right) => left.localeCompare(right));
    const groups = groupIds.map((groupId) => {
      const count = view.nodes.filter((node) => assignments[node.id] === groupId).length;
      const summary = describeGraphGroup(groupId, text);
      return {
        id: groupId,
        label: summary.detail,
        count,
        color: resolveGraphColor(groupId),
      };
    });
    const modes: Array<{ id: GraphGroupMode; label: string }> = [
      { id: "none", label: text.graphGroupNone ?? "None" },
      { id: "folder", label: text.graphGroupFolder ?? "Folder" },
      { id: "tag", label: text.graphGroupTag ?? "Tag" },
      { id: "kind", label: text.graphGroupKind ?? "Type" },
      { id: "source", label: text.graphGroupSource ?? "Source" },
    ];
    return html`
      <section class="alisio-memory-graph__card">
        <div class="alisio-memory-group__header"><h2>${text.graphGroups ?? "Groups"}</h2></div>
        <div class="alisio-memory-graph__meta-block">
          <strong>${text.graphColorBy ?? "Color by"}</strong>
          <div class="alisio-memory-graph__chips">
            ${modes.map(
              (mode) => html`
                <button
                  type="button"
                  class="btn btn--sm ${this.groupMode === mode.id ? "primary" : ""}"
                  aria-pressed=${this.groupMode === mode.id}
                  @click=${() => {
                    this.groupMode = mode.id;
                    this.layoutSignature = "";
                    this.requestUpdate();
                  }}
                >
                  ${mode.label}
                </button>
              `,
            )}
          </div>
        </div>
        ${groups.length === 0
          ? html`<div class="alisio-memory-empty">${text.graphEmpty}</div>`
          : html`
              <div class="alisio-memory-graph__legend">
                ${groups.map(
                  (group) => html`
                    <div class="alisio-memory-graph__legend-item">
                      <span
                        class="alisio-memory-graph__legend-dot"
                        style=${`background:${group.color}`}
                      ></span>
                      <span class="alisio-memory-graph__legend-copy">
                        <strong>${group.label}</strong>
                        <em>${String(group.count)}</em>
                      </span>
                    </div>
                  `,
                )}
              </div>
            `}
      </section>
    `;
  }

  private renderSliderRow(params: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onInput: (value: number) => void;
  }) {
    const formattedValue =
      Number.isInteger(params.value) && Number.isInteger(params.step)
        ? String(params.value)
        : params.value.toFixed(2);
    return html`
      <label class="alisio-memory-graph__slider">
        <span>
          <strong>${params.label}</strong>
          <em>${formattedValue}</em>
        </span>
        <input
          type="range"
          min=${String(params.min)}
          max=${String(params.max)}
          step=${String(params.step)}
          .value=${String(params.value)}
          @input=${(event: Event) =>
            params.onInput(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </label>
    `;
  }

  private renderContextMenu(text: MemoryGraphViewText) {
    if (!this.contextMenu) {
      return nothing;
    }
    const node = this.graph?.nodes.find((entry) => entry.id === this.contextMenu?.nodeId) ?? null;
    if (!node) {
      return nothing;
    }
    const menuWidth = 232;
    const menuHeight = 156;
    const left = clamp(this.contextMenu.x, 12, Math.max(12, window.innerWidth - menuWidth - 12));
    const top = clamp(this.contextMenu.y, 12, Math.max(12, window.innerHeight - menuHeight - 12));
    return html`
      <div
        class="alisio-memory-graph__context-menu"
        style=${`left:${String(left)}px;top:${String(top)}px;`}
      >
        <button
          type="button"
          class="btn btn--sm"
          @click=${() => {
            this.dispatchNodeOpen(node.id);
            this.contextMenu = null;
          }}
        >
          ${text.graphContextMenuOpen ?? "Open"}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          @click=${() => {
            this.centerNode(node.id);
            this.contextMenu = null;
          }}
        >
          ${text.graphContextMenuCenter ?? "Center node"}
        </button>
        <button
          type="button"
          class="btn btn--sm primary"
          @click=${() => {
            this.dispatchLocalFocus(node.id);
            this.contextMenu = null;
          }}
        >
          ${text.graphContextMenuLocal ?? "Open local graph"}
        </button>
      </div>
    `;
  }

  private renderSelectionCard(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const edge = view.selectedEdge;
    if (!edge) {
      return nothing;
    }
    const source =
      view.nodes.find((node) => node.id === edge.fromId) ??
      this.graph?.nodes.find((node) => node.id === edge.fromId) ??
      null;
    const target =
      view.nodes.find((node) => node.id === edge.toId) ??
      this.graph?.nodes.find((node) => node.id === edge.toId) ??
      null;
    const kindLabel =
      edge.reason.kind === "attachment-reference"
        ? (text.graphGroupAttachment ?? "Attachment")
        : (text.graphRelationType ?? "Relation");
    return html`
      <div class="alisio-memory-graph__hud">
        <div class="alisio-memory-graph__selection-card">
          <div class="alisio-memory-graph__selection-head">
            <span class="alisio-memory-graph__selection-kicker">${kindLabel}</span>
            <span class="alisio-memory-graph__selection-relation">${edge.relationType}</span>
          </div>
          <div class="alisio-memory-graph__selection-grid">
            <span>
              <strong>${text.graphSource ?? "Source"}</strong>
              <em>${source?.title ?? edge.fromPageId}</em>
            </span>
            <span>
              <strong>${text.graphTarget ?? "Target"}</strong>
              <em>${target?.title ?? edge.toPageId}</em>
            </span>
          </div>
        </div>
      </div>
    `;
  }

  private resolveNodeTone(
    palette: GraphThemePalette,
    params: { groupId: string | null; kind: "note" | "attachment" },
  ) {
    if (params.groupId) {
      return resolveGraphColor(params.groupId);
    }
    return params.kind === "attachment" ? palette.attachment : palette.note;
  }

  private resolveThemePalette(): GraphThemePalette {
    const target = this.isConnected ? this : document.documentElement;
    return {
      surfaceElevated: resolveCssColorVar(target, "--panel-strong", GRAPH_SURFACE_ELEVATED),
      text: resolveCssColorVar(target, "--text-strong", GRAPH_TEXT),
      textMuted: resolveCssColorVar(target, "--muted", GRAPH_TEXT_MUTED),
      edge: resolveCssColorVar(target, "--border-strong", GRAPH_EDGE),
      edgeHighlight: resolveCssColorVar(target, "--accent", GRAPH_EDGE_HIGHLIGHT),
      note: resolveCssColorVar(target, "--accent-2", GRAPH_NOTE),
      attachment: resolveCssColorVar(target, "--warn", GRAPH_ATTACHMENT),
      gridLine: resolveCssColorVar(target, "--grid-line", GRAPH_GRID_LINE),
      overlayTop: resolveCssColorVar(target, "--text-strong", GRAPH_OVERLAY_TOP, 0.05),
      overlayBottom: resolveCssColorVar(target, "--text-strong", GRAPH_OVERLAY_BOTTOM, 0.08),
      shadow: resolveCssColorVar(target, "--text-strong", GRAPH_SHADOW, 0.16),
    };
  }

  private resolveNodeFill(
    tone: string,
    palette: GraphThemePalette,
    params: { focus: boolean; dimmed: boolean },
  ) {
    const fill = params.focus
      ? mixColors(palette.surfaceElevated, tone, 0.34)
      : mixColors(palette.surfaceElevated, tone, 0.2);
    return params.dimmed ? withAlpha(fill, 0.38) : fill;
  }

  private resolveNodeStroke(
    tone: string,
    palette: GraphThemePalette,
    params: { focus: boolean; highlighted: boolean; dimmed: boolean },
  ) {
    const stroke = params.focus
      ? mixColors(palette.text, tone, 0.62)
      : params.highlighted
        ? mixColors(palette.text, tone, 0.5)
        : mixColors(palette.textMuted, tone, 0.28);
    return params.dimmed ? withAlpha(stroke, 0.4) : stroke;
  }

  private resolveEdgeColor(params: {
    palette: GraphThemePalette;
    highlighted: boolean;
    attachmentEdge: boolean;
    dimmed: boolean;
  }) {
    const base = params.highlighted
      ? params.palette.edgeHighlight
      : params.attachmentEdge
        ? mixColors(params.palette.edge, params.palette.attachment, 0.35)
        : params.palette.edge;
    return params.dimmed ? withAlpha(base, 0.14) : withAlpha(base, params.highlighted ? 0.9 : 0.28);
  }

  private renderCanvas(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const palette = this.resolveThemePalette();
    const focusNode = view.focusNode;
    const nodeGroups = buildNodeGroups(view, this.groupMode);
    const clusterOverlays = buildGraphClusterOverlays({
      view,
      layout: this.layout,
      nodeGroups,
      text,
    });
    const viewport = this.viewportViewBox();
    const gridWidth = Math.max(viewport.width, 960);
    const gridHeight = Math.max(viewport.height, 640);
    const gridStep = 72;
    const verticalLines = Array.from(
      { length: Math.ceil(gridWidth / gridStep) + 2 },
      (_, index) => -Math.ceil(gridWidth / 2) - gridStep + index * gridStep,
    );
    const horizontalLines = Array.from(
      { length: Math.ceil(gridHeight / gridStep) + 2 },
      (_, index) => -Math.ceil(gridHeight / 2) - gridStep + index * gridStep,
    );
    return html`
      <section class="alisio-memory-graph__canvas" @wheel=${this.handleWheel}>
        ${svg`
          <svg
            viewBox=${`${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`}
            role="img"
            aria-label=${text.graphTitle}
            preserveAspectRatio="xMidYMid meet"
            @mousedown=${this.handleCanvasMouseDown}
          >
            <defs>
              <marker
                id=${this.svgIds.arrow}
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L9,3 z" fill="currentColor"></path>
              </marker>
            </defs>
            <g class="alisio-memory-graph__grid">
              ${verticalLines.map(
                (offset) =>
                  svg`<line x1=${offset} y1=${-gridHeight} x2=${offset} y2=${gridHeight}></line>`,
              )}
              ${horizontalLines.map(
                (offset) =>
                  svg`<line x1=${-gridWidth} y1=${offset} x2=${gridWidth} y2=${offset}></line>`,
              )}
            </g>
            <g class="alisio-memory-graph__camera" transform=${`translate(${this.panX} ${this.panY})`}>
              <g class="alisio-memory-graph__scene" transform=${`scale(${this.zoom})`}>
                ${clusterOverlays.map((group) => {
                  const clusterLabel = `${shortenGraphLabel(group.label, 24)} · ${String(group.count)}`;
                  const labelWidth = clamp(clusterLabel.length * 7.1 + 34, 104, 248);
                  return svg`
                    <g
                      class="alisio-memory-graph__cluster"
                      transform=${`translate(${group.x} ${group.y})`}
                    >
                      <circle
                        class="alisio-memory-graph__cluster-surface"
                        r=${group.radius}
                        fill=${withAlpha(group.color, 0.08)}
                        stroke=${withAlpha(group.color, 0.2)}
                      ></circle>
                      <rect
                        class="alisio-memory-graph__cluster-label"
                        x=${-labelWidth / 2}
                        y=${-group.radius + 18}
                        width=${labelWidth}
                        height="24"
                        rx="12"
                        fill=${withAlpha(group.color, 0.18)}
                        stroke=${withAlpha(group.color, 0.24)}
                      ></rect>
                      <text
                        class="alisio-memory-graph__cluster-copy"
                        y=${-group.radius + 34}
                        text-anchor="middle"
                        fill=${withAlpha(palette.text, 0.84)}
                      >
                        ${clusterLabel}
                      </text>
                    </g>
                  `;
                })}
                ${view.edges.map((edge) => {
                  const source = this.layout[edge.fromId];
                  const target = this.layout[edge.toId];
                  if (!source || !target) {
                    return nothing;
                  }
                  const highlighted = view.highlightedEdgeIds.has(edge.id);
                  const attachmentEdge = edge.reason.kind === "attachment-reference";
                  const selected = view.selectedEdge?.id === edge.id;
                  const dimmed = view.highlightedNodeIds.size > 0 && !highlighted;
                  const edgeColor = this.resolveEdgeColor({
                    palette,
                    highlighted,
                    attachmentEdge,
                    dimmed,
                  });
                  const edgeGlowColor = attachmentEdge
                    ? withAlpha(mixColors(palette.edgeHighlight, palette.attachment, 0.24), 0.18)
                    : withAlpha(palette.edgeHighlight, 0.18);
                  return svg`
                    ${
                      highlighted || selected
                        ? svg`
                          <line
                            class="alisio-memory-graph__edge-glow"
                            x1=${source.x}
                            y1=${source.y}
                            x2=${target.x}
                            y2=${target.y}
                            style=${`stroke:${edgeGlowColor};stroke-width:${String(
                              (highlighted ? 10 : 8) * this.linkThickness,
                            )}`}
                          ></line>
                        `
                        : nothing
                    }
                    <line
                      class="alisio-memory-graph__edge ${highlighted ? "is-highlighted" : ""} ${
                        dimmed ? "is-dimmed" : ""
                      } ${attachmentEdge ? "is-attachment" : ""}"
                      x1=${source.x}
                      y1=${source.y}
                      x2=${target.x}
                      y2=${target.y}
                      style=${`stroke:${edgeColor};color:${edgeColor};stroke-width:${String(
                        (highlighted ? 3 : 2) * this.linkThickness,
                      )}`}
                      marker-end=${this.showArrows ? `url(#${this.svgIds.arrow})` : nothing}
                    ></line>
                    <line
                      class="alisio-memory-graph__edge-hit"
                      x1=${source.x}
                      y1=${source.y}
                      x2=${target.x}
                      y2=${target.y}
                      @mousedown=${(event: MouseEvent) => {
                        event.stopPropagation();
                        this.focusStage();
                        this.setInteractionActive(true);
                      }}
                      @click=${() =>
                        this.updateFilters({
                          selectedEdgeId: this.filters.selectedEdgeId === edge.id ? null : edge.id,
                        })}
                    ></line>
                  `;
                })}
                ${view.nodes.map((node) => {
                  const position = this.layout[node.id];
                  if (!position) {
                    return nothing;
                  }
                  const groupId = nodeGroups[node.id] ?? null;
                  const tone = this.resolveNodeTone(palette, {
                    groupId,
                    kind: node.kind,
                  });
                  const highlighted = view.highlightedNodeIds.has(node.id);
                  const dimmed =
                    view.highlightedNodeIds.size > 0 && !highlighted && node.id !== focusNode?.id;
                  const focused = node.id === focusNode?.id;
                  const baseRadius =
                    node.kind === "attachment"
                      ? 11 + Math.min(node.degree * 1.5, 6)
                      : 14 + Math.min(node.degree * 2, 12);
                  const radius = (focused ? Math.max(baseRadius, 28) : baseRadius) * this.nodeScale;
                  const label = shortenGraphLabel(node.title, focused ? 28 : 22);
                  const showLabel =
                    focused ||
                    highlighted ||
                    this.zoom >= this.textFadeThreshold ||
                    view.nodes.length <= 12;
                  const labelOpacity = showLabel
                    ? 1
                    : clamp((this.zoom - this.textFadeThreshold + 0.25) / 0.35, 0, 0.72);
                  const shouldRenderLabel = showLabel || labelOpacity > 0.08;
                  const fill = this.resolveNodeFill(tone, palette, { focus: focused, dimmed });
                  const stroke = this.resolveNodeStroke(tone, palette, {
                    focus: focused,
                    highlighted,
                    dimmed,
                  });
                  const labelColor = dimmed ? withAlpha(palette.textMuted, 0.4) : palette.text;
                  const halo = dimmed
                    ? withAlpha(tone, 0.06)
                    : withAlpha(tone, focused ? 0.22 : highlighted ? 0.16 : 0.09);
                  const labelWidth = clamp(label.length * 7.6 + 24, 72, 212);
                  const labelFill = dimmed
                    ? withAlpha(fill, 0.18)
                    : withAlpha(
                        mixColors(palette.surfaceElevated, tone, focused ? 0.18 : 0.12),
                        0.9,
                      );
                  const labelStroke = dimmed ? withAlpha(stroke, 0.12) : withAlpha(stroke, 0.34);
                  return svg`
                    <g
                      class="alisio-memory-graph__node ${focused ? "is-focus" : ""} ${
                        highlighted ? "is-highlighted" : ""
                      } ${dimmed ? "is-dimmed" : ""} ${
                        node.kind === "attachment" ? "is-attachment" : "is-note"
                      }"
                      transform=${`translate(${position.x} ${position.y})`}
                      @mouseenter=${() => this.updateFilters({ hoveredNodeId: node.id })}
                      @mouseleave=${() => this.updateFilters({ hoveredNodeId: null })}
                      @mousedown=${(event: MouseEvent) => this.handleNodeMouseDown(event, node.id)}
                      @contextmenu=${(event: MouseEvent) =>
                        this.handleNodeContextMenu(event, node.id)}
                    >
                      <circle
                        class="alisio-memory-graph__node-halo"
                        r=${radius + 8}
                        fill=${halo}
                      ></circle>
                      <circle
                        r=${radius}
                        fill=${fill}
                        stroke=${stroke}
                        stroke-width=${focused ? "3" : "2"}
                      ></circle>
                      <circle
                        class="alisio-memory-graph__node-dot"
                        r=${Math.max(2.8, Math.min(radius * 0.22, 5.4))}
                        fill=${dimmed ? withAlpha(stroke, 0.44) : withAlpha(stroke, 0.92)}
                      ></circle>
                      ${
                        shouldRenderLabel
                          ? svg`
                            <g
                              class="alisio-memory-graph__node-label"
                              style=${`opacity:${String(labelOpacity)}`}
                            >
                              <rect
                                class="alisio-memory-graph__label-chip"
                                x=${-labelWidth / 2}
                                y=${radius + 10}
                                width=${labelWidth}
                                height="22"
                                rx="11"
                                fill=${labelFill}
                                stroke=${labelStroke}
                              ></rect>
                              <text
                                class="alisio-memory-graph__label"
                                y=${radius + 25}
                                text-anchor="middle"
                                fill=${labelColor}
                              >
                                ${label}
                              </text>
                            </g>
                          `
                          : nothing
                      }
                    </g>
                  `;
                })}
              </g>
            </g>
          </svg>
        `}
        ${this.renderSelectionCard(view, text)}
      </section>
    `;
  }

  render() {
    const text = this.resolvedText;
    const view = this.ensureLayout();
    const palette = this.resolveThemePalette();

    return html`
      <style>
        .alisio-memory-graph {
          position: relative;
          min-width: 0;
        }
        .alisio-memory-graph__card {
          display: grid;
          gap: 12px;
          padding: 18px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent);
          border-radius: 22px;
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--surface-elevated) 88%, transparent),
            color-mix(in srgb, var(--surface-panel) 96%, transparent)
          );
          box-shadow: 0 12px 32px ${withAlpha(palette.text, 0.08)};
        }
        .alisio-memory-graph.is-compact .alisio-memory-graph__card {
          padding: 14px 16px;
          border-radius: 18px;
          box-shadow: none;
        }
        .alisio-memory-graph__lede {
          margin: 0;
          color: var(--text-muted);
          line-height: 1.65;
        }
        .alisio-memory-graph__scope,
        .alisio-memory-graph__toolbar,
        .alisio-memory-graph__chips,
        .alisio-memory-graph__meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .alisio-memory-graph__toolbar {
          gap: 10px;
        }
        .alisio-memory-graph__meta {
          color: var(--text-muted);
          font-size: 13px;
        }
        .alisio-memory-graph__stage {
          position: relative;
          min-width: 0;
          outline: none;
        }
        .alisio-memory-graph__stage.is-interacting .alisio-memory-graph__canvas,
        .alisio-memory-graph__stage:focus-within .alisio-memory-graph__canvas {
          border-color: color-mix(in srgb, var(--accent-primary) 24%, var(--border-subtle));
          box-shadow:
            0 18px 44px ${withAlpha(palette.text, 0.1)},
            inset 0 1px 0 color-mix(in srgb, var(--surface-elevated) 64%, transparent);
        }
        .alisio-memory-graph__topbar {
          position: absolute;
          top: 16px;
          left: 16px;
          right: 16px;
          z-index: 2;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          pointer-events: none;
        }
        .alisio-memory-graph__topbar > * {
          pointer-events: auto;
        }
        .alisio-memory-graph__scope,
        .alisio-memory-graph__toolbar,
        .alisio-memory-graph__topbar-meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px;
          border-radius: 18px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 82%, transparent);
          backdrop-filter: blur(18px);
          box-shadow: 0 18px 36px ${withAlpha(palette.text, 0.08)};
        }
        .alisio-memory-graph__topbar-meta {
          justify-content: center;
          flex: 1 1 280px;
        }
        .alisio-memory-graph__pill {
          display: inline-flex;
          align-items: center;
          min-height: 30px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 76%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 88%, transparent);
          backdrop-filter: blur(14px);
          color: var(--text-muted);
          font-size: 0.78rem;
          font-weight: 600;
        }
        .alisio-memory-graph__meta-block {
          display: grid;
          gap: 4px;
        }
        .alisio-memory-graph__meta-block span {
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.55;
        }
        .alisio-memory-graph__legend {
          display: grid;
          gap: 8px;
        }
        .alisio-memory-graph__legend-item {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .alisio-memory-graph__legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          flex: 0 0 auto;
        }
        .alisio-memory-graph__legend-copy {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          width: 100%;
        }
        .alisio-memory-graph__legend-copy em {
          color: var(--text-muted);
          font-style: normal;
        }
        .alisio-memory-graph__slider {
          display: grid;
          gap: 8px;
        }
        .alisio-memory-graph__slider span {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 13px;
        }
        .alisio-memory-graph__slider em {
          color: var(--text-muted);
          font-style: normal;
        }
        .alisio-memory-graph__settings {
          position: absolute;
          top: 70px;
          right: 16px;
          z-index: 3;
          display: grid;
          gap: 10px;
          width: min(340px, calc(100% - 32px));
          max-height: calc(100% - 86px);
          overflow: auto;
          padding-right: 2px;
          backdrop-filter: blur(18px);
        }
        .alisio-memory-graph__settings .alisio-memory-graph__slider input[type="range"] {
          width: 100%;
        }
        .alisio-memory-graph__canvas {
          position: relative;
          height: min(76vh, 900px);
          min-height: 640px;
          color: ${palette.textMuted};
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          border-radius: 24px;
          overflow: hidden;
          background:
            radial-gradient(
              circle at 18% 12%,
              color-mix(in srgb, var(--accent-primary) 14%, transparent),
              transparent 34%
            ),
            radial-gradient(
              circle at 84% 0%,
              color-mix(in srgb, var(--accent) 10%, transparent),
              transparent 30%
            ),
            linear-gradient(
              180deg,
              color-mix(in srgb, var(--surface-elevated) 96%, transparent),
              color-mix(in srgb, var(--surface-panel) 98%, transparent)
            );
        }
        .alisio-memory-graph.is-compact .alisio-memory-graph__canvas {
          height: min(56vh, 560px);
          min-height: 420px;
          border-radius: 20px;
        }
        .alisio-memory-graph__canvas svg {
          width: 100%;
          height: 100%;
          display: block;
          cursor: grab;
        }
        .alisio-memory-graph__canvas::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(180deg, ${palette.overlayTop}, transparent 20%),
            linear-gradient(0deg, ${palette.overlayBottom}, transparent 18%);
        }
        .alisio-memory-graph__canvas svg:active {
          cursor: grabbing;
        }
        .alisio-memory-graph__grid {
          opacity: 0.82;
        }
        .alisio-memory-graph__grid line {
          stroke: ${palette.gridLine};
          stroke-width: 1;
        }
        .alisio-memory-graph__cluster,
        .alisio-memory-graph__cluster-copy,
        .alisio-memory-graph__cluster-label,
        .alisio-memory-graph__cluster-surface,
        .alisio-memory-graph__node-halo,
        .alisio-memory-graph__node-dot,
        .alisio-memory-graph__node-label {
          pointer-events: none;
        }
        .alisio-memory-graph__cluster-surface,
        .alisio-memory-graph__cluster-label {
          stroke-width: 1.25;
        }
        .alisio-memory-graph__cluster-copy {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.01em;
        }
        .alisio-memory-graph__edge-hit {
          stroke: transparent;
          stroke-width: 18;
          cursor: pointer;
        }
        .alisio-memory-graph__edge-glow {
          stroke-linecap: round;
          opacity: 0.94;
        }
        .alisio-memory-graph__edge {
          stroke-linecap: round;
          vector-effect: non-scaling-stroke;
          transition:
            opacity 120ms ease,
            stroke-width 120ms ease;
        }
        .alisio-memory-graph__edge.is-attachment {
          stroke-dasharray: 5 5;
        }
        .alisio-memory-graph__edge.is-dimmed {
          opacity: 1;
        }
        .alisio-memory-graph__node {
          cursor: pointer;
          filter: drop-shadow(0 10px 18px ${withAlpha(palette.text, 0.12)});
          transition:
            opacity 120ms ease,
            filter 120ms ease;
        }
        .alisio-memory-graph__node.is-dimmed {
          opacity: 0.34;
        }
        .alisio-memory-graph__node circle {
          transition:
            fill 120ms ease,
            stroke 120ms ease,
            transform 120ms ease;
          transform-box: fill-box;
          transform-origin: center;
        }
        .alisio-memory-graph__node.is-highlighted circle:not(.alisio-memory-graph__node-halo),
        .alisio-memory-graph__node.is-focus circle:not(.alisio-memory-graph__node-halo) {
          transform: scale(1.03);
        }
        .alisio-memory-graph__label-chip {
          stroke-width: 1;
          transition:
            fill 120ms ease,
            stroke 120ms ease,
            opacity 120ms ease;
        }
        .alisio-memory-graph__label {
          font-size: 13px;
          font-weight: 600;
          pointer-events: none;
          transition: opacity 120ms ease;
        }
        .alisio-memory-graph__hud {
          position: absolute;
          left: 16px;
          right: 16px;
          bottom: 16px;
          z-index: 2;
          display: flex;
          justify-content: flex-end;
          pointer-events: none;
        }
        .alisio-memory-graph__selection-card {
          width: min(420px, 100%);
          padding: 12px 14px;
          border-radius: 18px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 86%, transparent);
          box-shadow: 0 20px 44px ${palette.shadow};
          backdrop-filter: blur(20px);
          pointer-events: auto;
        }
        .alisio-memory-graph__selection-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }
        .alisio-memory-graph__selection-kicker,
        .alisio-memory-graph__selection-relation {
          display: inline-flex;
          align-items: center;
          min-height: 26px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 0.76rem;
          font-weight: 700;
        }
        .alisio-memory-graph__selection-kicker {
          background: color-mix(in srgb, var(--surface-elevated) 86%, transparent);
          color: var(--text-muted);
        }
        .alisio-memory-graph__selection-relation {
          background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
          color: var(--text);
        }
        .alisio-memory-graph__selection-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .alisio-memory-graph__selection-grid span {
          display: grid;
          gap: 4px;
          min-width: 0;
        }
        .alisio-memory-graph__selection-grid strong {
          color: var(--text-muted);
          font-size: 0.74rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .alisio-memory-graph__selection-grid em {
          color: var(--text);
          font-style: normal;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .alisio-memory-graph__context-menu {
          position: fixed;
          z-index: 50;
          display: grid;
          gap: 8px;
          min-width: 180px;
          padding: 12px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 84%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 96%, transparent);
          box-shadow: 0 20px 40px ${palette.shadow};
          backdrop-filter: blur(18px);
        }
        .alisio-memory-graph__context-menu .btn {
          justify-content: flex-start;
          width: 100%;
        }
        @media (max-width: 980px) {
          .alisio-memory-graph__canvas {
            min-height: 440px;
          }
          .alisio-memory-graph__topbar {
            top: 12px;
            left: 12px;
            right: 12px;
          }
          .alisio-memory-graph__settings {
            top: 64px;
            right: 12px;
            width: min(340px, calc(100% - 24px));
            max-height: calc(100% - 76px);
          }
          .alisio-memory-graph__hud {
            left: 12px;
            right: 12px;
            bottom: 12px;
          }
          .alisio-memory-graph__selection-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
      ${this.loading
        ? html`
            <section class="alisio-memory-runtime">
              <div class="alisio-memory-empty">${text.graphLoading}</div>
            </section>
          `
        : this.error
          ? html`
              <section class="alisio-memory-runtime">
                <div class="callout info">${this.error}</div>
              </section>
            `
          : !this.graph
            ? html`<div class="alisio-memory-panel alisio-memory-panel--empty">
                ${text.graphUnavailable}
              </div>`
            : view.nodes.length === 0
              ? html`<div class="alisio-memory-panel alisio-memory-panel--empty">
                  ${text.graphEmpty}
                </div>`
              : html`
                  <div class="alisio-memory-graph ${this.compact ? "is-compact" : ""}">
                    <section
                      class="alisio-memory-graph__stage ${this.interactionActive
                        ? "is-interacting"
                        : ""}"
                      tabindex="0"
                      title=${text.graphCanvasHint ?? nothing}
                      @mouseenter=${this.handleStageMouseEnter}
                      @mouseleave=${this.handleStageMouseLeave}
                      @focusin=${this.handleStageFocusIn}
                      @focusout=${this.handleStageFocusOut}
                    >
                      ${this.renderTopbar(view, text)} ${this.renderSettingsPanel(view, text)}
                      ${this.renderCanvas(view, text)}
                    </section>
                  </div>
                  ${this.renderContextMenu(text)}
                `}
    `;
  }
}

if (!customElements.get("alisio-memory-graph-view")) {
  customElements.define("alisio-memory-graph-view", AlisioMemoryGraphView);
}
