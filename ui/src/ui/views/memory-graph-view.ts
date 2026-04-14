import { LitElement, html, nothing } from "lit";
import { property } from "lit/decorators.js";
import {
  buildMemoryGraphViewModel,
  createMemoryGraphFilterState,
  type MemoryGraphFilterState,
  type MemoryGraphViewModel,
} from "../controllers/memory-graph-controller.ts";
import type { MemoryGraphBranch, MemoryGraphNode, MemoryGraphState } from "../types.ts";
import { buildMemoryGraphLayout, type MemoryGraphLayout } from "./memory-graph-layout.ts";

export type MemoryGraphViewText = {
  graphTitle: string;
  graphDescription?: string;
  graphLoading: string;
  graphUnavailable: string;
  graphEmpty: string;
  graphFocus: string;
  graphGlobal: string;
  graphLocal: string;
  graphDepth?: string;
  graphResetView: string;
  graphNeighbourhood: string;
  graphOrphans?: string;
  graphBranches: string;
  graphBranchesEmpty: string;
  graphEdgeReason: string;
  graphEdgeReasonEmpty: string;
  graphFilterRelations: string;
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
  graphDisplay?: string;
  graphArrows?: string;
  graphTextFadeThreshold?: string;
  graphNodeSize?: string;
  graphLinkThickness?: string;
  graphForces?: string;
  graphCenterForce?: string;
  graphRepelForce?: string;
  graphLinkForce?: string;
  graphLinkDistance?: string;
  graphNodesCount: string;
  graphEdgesCount: string;
  graphTruncated: string;
  graphSource: string;
  graphTarget: string;
  graphRelationType: string;
  graphClusters?: string;
  graphSuggestions?: string;
  graphSpotlight?: string;
  graphIncoming?: string;
  graphOutgoing?: string;
  graphDegree?: string;
  graphZoomIn?: string;
  graphZoomOut?: string;
  graphCenterFocus?: string;
  graphCanvasHint?: string;
  graphAliases?: string;
  graphTags?: string;
  graphRelations?: string;
  searchPlaceholder?: string;
  wikiOpenPage?: string;
  none?: string;
  ready?: string;
  unavailable?: string;
  builtin?: string;
  localFirst?: string;
  localOnly?: string;
  cloudSyncEnabled?: string;
  cloudSyncUnavailable?: string;
  cloudSyncError?: string;
};

type GraphGroupMode = "none" | "folder" | "tag" | "kind" | "source";

type GraphContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
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

function resolveBranchLabel(
  branch: MemoryGraphBranch,
  text: Pick<MemoryGraphViewText, "graphIncoming" | "graphOutgoing">,
) {
  const direction = branch.direction === "incoming" ? text.graphIncoming : text.graphOutgoing;
  return `${direction ?? branch.direction} · ${branch.relationType}`;
}

function resolveGraphStateLabel(
  graph: MemoryGraphState,
  text: Pick<
    MemoryGraphViewText,
    | "ready"
    | "builtin"
    | "localFirst"
    | "localOnly"
    | "cloudSyncEnabled"
    | "cloudSyncUnavailable"
    | "cloudSyncError"
  >,
) {
  const parts = [
    graph.state === "ready" ? (text.ready ?? "Ready") : graph.state,
    graph.backend === "builtin" ? (text.builtin ?? "Built-in") : graph.backend,
    graph.syncMode === "local-first"
      ? (text.localFirst ?? "Local-first")
      : graph.syncMode === "local-only"
        ? (text.localOnly ?? "Local-only")
        : graph.syncMode,
  ].filter(Boolean);

  const cloudSync =
    graph.cloudSync === "enabled"
      ? text.cloudSyncEnabled
      : graph.cloudSync === "unavailable"
        ? text.cloudSyncUnavailable
        : graph.cloudSync === "error"
          ? text.cloudSyncError
          : graph.cloudSync;
  if (cloudSync) {
    parts.push(cloudSync);
  }
  return parts.join(" · ");
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
  private nodeScale = 1;
  private linkThickness = 1;
  private textFadeThreshold = 0.9;
  private centerForce = 1;
  private repelForce = 1;
  private linkForce = 1;
  private linkDistance = 1;
  private groupMode: GraphGroupMode = "folder";
  private contextMenu: GraphContextMenuState | null = null;
  private targetLayout: MemoryGraphLayout = {};
  private layoutFrame: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("mousemove", this.handleGlobalMouseMove);
    window.addEventListener("mouseup", this.handleGlobalMouseUp);
    window.addEventListener("mousedown", this.handleGlobalMouseDown);
    window.addEventListener("keydown", this.handleGlobalKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("mousemove", this.handleGlobalMouseMove);
    window.removeEventListener("mouseup", this.handleGlobalMouseUp);
    window.removeEventListener("mousedown", this.handleGlobalMouseDown);
    window.removeEventListener("keydown", this.handleGlobalKeyDown);
    if (this.layoutFrame !== null) {
      window.cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = null;
    }
    super.disconnectedCallback();
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
        graphNeighbourhood: "Neighborhood",
        graphOrphans: "Show orphans",
        graphBranches: "Branches",
        graphBranchesEmpty: "No branches available.",
        graphEdgeReason: "Why this link exists",
        graphEdgeReasonEmpty: "Select an edge to inspect the canonical link behind it.",
        graphFilterRelations: "Relation filters",
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
        graphDisplay: "Display",
        graphArrows: "Arrows",
        graphTextFadeThreshold: "Text fade",
        graphNodeSize: "Node size",
        graphLinkThickness: "Link thickness",
        graphForces: "Forces",
        graphCenterForce: "Center force",
        graphRepelForce: "Repel force",
        graphLinkForce: "Link force",
        graphLinkDistance: "Link distance",
        graphNodesCount: "Nodes",
        graphEdgesCount: "Edges",
        graphTruncated: "Truncated to keep the graph responsive.",
        graphSource: "Source",
        graphTarget: "Target",
        graphRelationType: "Relation",
        graphSuggestions: "Suggested routes",
        graphSpotlight: "Spotlight",
        graphIncoming: "Incoming",
        graphOutgoing: "Outgoing",
        graphDegree: "Degree",
        graphZoomIn: "Zoom in",
        graphZoomOut: "Zoom out",
        graphCenterFocus: "Center focus",
        graphCanvasHint:
          "Drag to pan, scroll to zoom, click to open a page, and right-click a node for more actions.",
        graphAliases: "Aliases",
        graphTags: "Tags",
        graphRelations: "Relations",
        none: "None",
        ready: "Ready",
        builtin: "Built-in",
        localFirst: "Local-first",
        localOnly: "Local-only",
        cloudSyncEnabled: "Cloud sync active",
        cloudSyncUnavailable: "Cloud sync unavailable",
        cloudSyncError: "Cloud sync error",
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

  private adjustZoom(factor: number) {
    this.zoom = clamp(this.zoom * factor, 0.35, 2.6);
    this.requestUpdate();
  }

  private resetViewport() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
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
    this.panX = -position.x;
    this.panY = -position.y;
    this.requestUpdate();
  }

  private centerNode(nodeId: string) {
    const position = this.layout[nodeId];
    if (!position) {
      return;
    }
    this.panX = -position.x;
    this.panY = -position.y;
    this.requestUpdate();
  }

  private cloneLayout(layout: MemoryGraphLayout) {
    return Object.fromEntries(
      Object.entries(layout).map(([id, point]) => [id, { x: point.x, y: point.y }]),
    );
  }

  private applyTargetLayout(nextLayout: MemoryGraphLayout, focusNodeId: string | null) {
    this.targetLayout = this.cloneLayout(nextLayout);
    if (Object.keys(this.layout).length === 0) {
      this.layout = this.cloneLayout(nextLayout);
      return;
    }
    const nextCurrent = this.cloneLayout(this.layout);
    const focusPosition =
      (focusNodeId ? nextCurrent[focusNodeId] : null) ??
      (focusNodeId ? nextLayout[focusNodeId] : null) ?? { x: 0, y: 0 };
    for (const [id, target] of Object.entries(this.targetLayout)) {
      if (!nextCurrent[id]) {
        nextCurrent[id] = {
          x: focusPosition.x + (target.x - focusPosition.x) * 0.16,
          y: focusPosition.y + (target.y - focusPosition.y) * 0.16,
        };
      }
    }
    this.layout = nextCurrent;
    this.startLayoutAnimation();
  }

  private startLayoutAnimation() {
    if (this.layoutFrame !== null) {
      return;
    }
    const animate = () => {
      const nextLayout: MemoryGraphLayout = {};
      let moving = false;
      for (const [id, target] of Object.entries(this.targetLayout)) {
        const current = this.layout[id] ?? target;
        const dx = target.x - current.x;
        const dy = target.y - current.y;
        if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
          nextLayout[id] = {
            x: current.x + dx * 0.18,
            y: current.y + dy * 0.18,
          };
          moving = true;
        } else {
          nextLayout[id] = { x: target.x, y: target.y };
        }
      }
      this.layout = nextLayout;
      this.requestUpdate();
      if (!moving) {
        this.layout = this.cloneLayout(this.targetLayout);
        this.layoutFrame = null;
        this.requestUpdate();
        return;
      }
      this.layoutFrame = window.requestAnimationFrame(animate);
    };
    this.layoutFrame = window.requestAnimationFrame(animate);
  }

  private ensureLayout() {
    const filters = this.activeFilters;
    const view = buildMemoryGraphViewModel(this.graph, filters);
    const signature = JSON.stringify({
      focus: view.focusNode?.id ?? null,
      searchQuery: filters.searchQuery.trim(),
      relationTypes: [...filters.relationTypes].toSorted(),
      tags: [...filters.tags].toSorted(),
      neighbourhoodOnly: filters.neighbourhoodOnly,
      showOrphans: filters.showOrphans,
      display: {
        groupMode: this.groupMode,
        nodeScale: this.nodeScale,
        linkThickness: this.linkThickness,
        textFadeThreshold: this.textFadeThreshold,
        centerForce: this.centerForce,
        repelForce: this.repelForce,
        linkForce: this.linkForce,
        linkDistance: this.linkDistance,
      },
      nodes: view.nodes.map((node) => node.id),
      edges: view.edges.map((edge) => edge.id),
    });
    if (signature !== this.layoutSignature) {
      // Reuse the previous layout when possible so filter changes do not reshuffle the graph.
      const nextLayout = buildMemoryGraphLayout({
        nodes: view.nodes,
        edges: view.edges,
        focusNodeId: view.focusNode?.id ?? null,
        previousLayout: this.layout,
        nodeGroups: buildNodeGroups(view, this.groupMode),
        centerForce: this.centerForce,
        repelForce: this.repelForce,
        linkForce: this.linkForce,
        linkDistance: this.linkDistance,
      });
      this.applyTargetLayout(nextLayout, view.focusNode?.id ?? null);
      this.layoutSignature = signature;
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
      this.panX += dx / this.zoom;
      this.panY += dy / this.zoom;
      this.dragState = { ...this.dragState, lastX: event.clientX, lastY: event.clientY };
      this.requestUpdate();
      return;
    }
    const nodePosition = this.layout[this.dragState.nodeId];
    if (!nodePosition) {
      return;
    }
    nodePosition.x += dx / this.zoom;
    nodePosition.y += dy / this.zoom;
    if (this.targetLayout[this.dragState.nodeId]) {
      this.targetLayout[this.dragState.nodeId] = { ...nodePosition };
    }
    this.dragState = {
      kind: "node",
      nodeId: this.dragState.nodeId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: this.dragState.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2,
    };
    this.requestUpdate();
  };

  private handleGlobalMouseUp = () => {
    if (!this.dragState) {
      return;
    }
    if (this.dragState.kind === "node" && !this.dragState.moved) {
      this.dispatchNodeOpen(this.dragState.nodeId);
    }
    this.dragState = null;
  };

  private handleGlobalMouseDown = (event: MouseEvent) => {
    if (!this.contextMenu) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".alisio-memory-graph__context-menu")) {
      return;
    }
    this.contextMenu = null;
    this.requestUpdate();
  };

  private handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }
    if (this.contextMenu) {
      this.contextMenu = null;
      this.requestUpdate();
    }
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
    this.contextMenu = {
      nodeId,
      x: event.clientX,
      y: event.clientY,
    };
    this.requestUpdate();
  }

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.adjustZoom(event.deltaY < 0 ? 1.08 : 0.92);
  };

  private renderMetaCard(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const focusNode = view.focusNode;
    return html`
      <section class="alisio-memory-graph__card">
        <div class="alisio-memory-group__header"><h2>${text.graphTitle}</h2></div>
        ${text.graphDescription
          ? html`<p class="alisio-memory-graph__lede">${text.graphDescription}</p>`
          : nothing}
        <div class="alisio-memory-graph__scope">
          <button
            type="button"
            class="btn btn--sm ${this.activeScope === "global" ? "primary" : ""}"
            @click=${() => this.dispatchScopeChange("global")}
          >
            ${text.graphGlobal}
          </button>
          <button
            type="button"
            class="btn btn--sm ${this.activeScope === "local" ? "primary" : ""}"
            ?disabled=${!this.localAvailable}
            @click=${() => this.dispatchScopeChange("local")}
          >
            ${text.graphLocal}
          </button>
          <button type="button" class="btn btn--sm" @click=${() => this.resetViewport()}>
            ${text.graphResetView}
          </button>
        </div>
        <div class="alisio-memory-graph__toolbar">
          <button type="button" class="btn btn--sm" @click=${() => this.adjustZoom(1.08)}>
            ${text.graphZoomIn ?? "+"}
          </button>
          <button type="button" class="btn btn--sm" @click=${() => this.adjustZoom(0.92)}>
            ${text.graphZoomOut ?? "-"}
          </button>
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${!focusNode}
            @click=${() => this.centerFocus()}
          >
            ${text.graphCenterFocus ?? text.graphFocus}
          </button>
        </div>
        <div class="alisio-memory-graph__meta">
          <span>${text.graphNodesCount}: ${view.nodes.length}</span>
          <span>${text.graphEdgesCount}: ${view.edges.length}</span>
          <span>${resolveGraphStateLabel(this.graph!, text)}</span>
        </div>
        ${this.graph!.truncated.nodes || this.graph!.truncated.edges
          ? html`<div class="muted">${text.graphTruncated}</div>`
          : nothing}
        ${text.graphCanvasHint ? html`<div class="muted">${text.graphCanvasHint}</div>` : nothing}
      </section>
    `;
  }

  private renderFiltersCard(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const selectedRelationTypes = new Set(this.filters.relationTypes);
    const selectedTags = new Set(this.filters.tags);
    return html`
      <section class="alisio-memory-graph__card">
        <div class="alisio-memory-group__header"><h2>${text.graphFilterRelations}</h2></div>
        <div class="alisio-memory-graph__chips">
          ${this.graph!.availableRelationTypes.map(
            (relationType) => html`
              <button
                type="button"
                class="btn btn--sm ${selectedRelationTypes.has(relationType) ? "primary" : ""}"
                aria-pressed=${selectedRelationTypes.has(relationType)}
                @click=${() =>
                  this.updateFilters({
                    relationTypes: selectedRelationTypes.has(relationType)
                      ? this.filters.relationTypes.filter((value) => value !== relationType)
                      : [...this.filters.relationTypes, relationType],
                    selectedEdgeId: null,
                  })}
              >
                ${relationType}
              </button>
            `,
          )}
        </div>
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
        <label class="field checkbox" style="margin: 0;">
          <input
            type="checkbox"
            .checked=${this.filters.neighbourhoodOnly}
            @change=${(event: Event) =>
              this.updateFilters({
                neighbourhoodOnly: (event.currentTarget as HTMLInputElement).checked,
                selectedEdgeId: null,
              })}
          />
          <span class="field-checkbox__label">${text.graphNeighbourhood}</span>
        </label>
        <label class="field checkbox" style="margin: 0;">
          <input
            type="checkbox"
            .checked=${this.filters.showOrphans}
            @change=${(event: Event) =>
              this.updateFilters({
                showOrphans: (event.currentTarget as HTMLInputElement).checked,
                selectedEdgeId: null,
              })}
          />
          <span class="field-checkbox__label">${text.graphOrphans ?? "Show orphans"}</span>
        </label>
        ${this.activeFilters.searchQuery.trim()
          ? html`
              <div class="alisio-memory-graph__search-indicator">
                <strong>${text.searchPlaceholder ?? "Search"}</strong>
                <span>${this.activeFilters.searchQuery.trim()}</span>
              </div>
            `
          : nothing}
        ${view.nodes.length === 0
          ? html`<div class="alisio-memory-empty">${text.graphEmpty}</div>`
          : nothing}
      </section>
    `;
  }

  private renderDisplayCard(text: MemoryGraphViewText) {
    return html`
      <section class="alisio-memory-graph__card">
        <div class="alisio-memory-group__header"><h2>${text.graphDisplay ?? "Display"}</h2></div>
        <label class="field checkbox" style="margin: 0;">
          <input
            type="checkbox"
            .checked=${this.showArrows}
            @change=${(event: Event) => {
              this.showArrows = (event.currentTarget as HTMLInputElement).checked;
              this.requestUpdate();
            }}
          />
          <span class="field-checkbox__label">${text.graphArrows ?? "Arrows"}</span>
        </label>
        ${this.renderSliderRow({
          label: text.graphNodeSize ?? "Node size",
          value: this.nodeScale,
          min: 0.7,
          max: 1.8,
          step: 0.05,
          onInput: (value) => {
            this.nodeScale = value;
            this.requestUpdate();
          },
        })}
        ${this.renderSliderRow({
          label: text.graphLinkThickness ?? "Link thickness",
          value: this.linkThickness,
          min: 0.7,
          max: 2.2,
          step: 0.05,
          onInput: (value) => {
            this.linkThickness = value;
            this.requestUpdate();
          },
        })}
        ${this.renderSliderRow({
          label: text.graphTextFadeThreshold ?? "Text fade",
          value: this.textFadeThreshold,
          min: 0.45,
          max: 1.5,
          step: 0.05,
          onInput: (value) => {
            this.textFadeThreshold = value;
            this.requestUpdate();
          },
        })}
      </section>
    `;
  }

  private renderGroupsCard(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const assignments = buildNodeGroups(view, this.groupMode);
    const groupIds = Array.from(
      new Set(view.nodes.map((node) => assignments[node.id]).filter((value): value is string => Boolean(value))),
    ).toSorted((left, right) => left.localeCompare(right));
    const groups = groupIds.map((groupId) => {
      const count = view.nodes.filter((node) => assignments[node.id] === groupId).length;
      const label =
        groupId === "note"
          ? text.graphGroupNote ?? "Note"
          : groupId === "attachment"
            ? text.graphGroupAttachment ?? "Attachment"
            : groupId.startsWith("folder:")
              ? groupId.slice("folder:".length)
              : groupId.startsWith("tag:")
                ? `#${groupId.slice("tag:".length)}`
                : groupId.startsWith("source:")
                  ? titleCase(groupId.slice("source:".length))
                  : titleCase(groupId);
      return {
        id: groupId,
        label:
          groupId === "note"
            ? `${text.graphGroupKind ?? "Type"} · ${text.graphGroupNote ?? "Note"}`
            : groupId === "attachment"
              ? `${text.graphGroupKind ?? "Type"} · ${text.graphGroupAttachment ?? "Attachment"}`
              : label,
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

  private renderForcesCard(text: MemoryGraphViewText) {
    return html`
      <section class="alisio-memory-graph__card">
        <div class="alisio-memory-group__header"><h2>${text.graphForces ?? "Forces"}</h2></div>
        ${this.renderSliderRow({
          label: text.graphCenterForce ?? "Center force",
          value: this.centerForce,
          min: 0.5,
          max: 1.8,
          step: 0.05,
          onInput: (value) => {
            this.centerForce = value;
            this.layoutSignature = "";
            this.requestUpdate();
          },
        })}
        ${this.renderSliderRow({
          label: text.graphRepelForce ?? "Repel force",
          value: this.repelForce,
          min: 0.55,
          max: 2.25,
          step: 0.05,
          onInput: (value) => {
            this.repelForce = value;
            this.layoutSignature = "";
            this.requestUpdate();
          },
        })}
        ${this.renderSliderRow({
          label: text.graphLinkForce ?? "Link force",
          value: this.linkForce,
          min: 0.55,
          max: 1.9,
          step: 0.05,
          onInput: (value) => {
            this.linkForce = value;
            this.layoutSignature = "";
            this.requestUpdate();
          },
        })}
        ${this.renderSliderRow({
          label: text.graphLinkDistance ?? "Link distance",
          value: this.linkDistance,
          min: 0.65,
          max: 1.8,
          step: 0.05,
          onInput: (value) => {
            this.linkDistance = value;
            this.layoutSignature = "";
            this.requestUpdate();
          },
        })}
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
    return html`
      <label class="alisio-memory-graph__slider">
        <span>
          <strong>${params.label}</strong>
          <em>${params.value.toFixed(2)}</em>
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

  private renderBranchesCard(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    return html`
      <section class="alisio-memory-graph__card">
        <div class="alisio-memory-group__header"><h2>${text.graphBranches}</h2></div>
        <div class="alisio-memory-graph__branch-list">
          ${view.branches.length === 0
            ? html`<div class="alisio-memory-empty">${text.graphBranchesEmpty}</div>`
            : view.branches.map(
                (branch) => html`
                  <article class="alisio-memory-graph__branch">
                    <strong>${resolveBranchLabel(branch, text)}</strong>
                    <div class="alisio-memory-graph__chips">
                      ${branch.nodeIds.map((nodeId) => {
                        const node = view.nodes.find((entry) => entry.id === nodeId);
                        return html`
                          <button
                            type="button"
                            class="btn btn--sm"
                            @click=${() => this.dispatchNodeOpen(nodeId)}
                          >
                            ${node?.title ?? nodeId}
                          </button>
                        `;
                      })}
                    </div>
                  </article>
                `,
              )}
        </div>
      </section>
    `;
  }

  private renderSpotlightCard(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const focusNode = view.focusNode;
    const selectedEdge = view.selectedEdge;
    return html`
      <section class="alisio-memory-graph__card">
        <div class="alisio-memory-group__header">
          <h2>${selectedEdge ? text.graphEdgeReason : (text.graphSpotlight ?? text.graphFocus)}</h2>
        </div>
        ${selectedEdge
          ? html`
              <div class="alisio-memory-graph__edge-reason">
                <strong>
                  ${selectedEdge.reason.sourceTitle} ${selectedEdge.relationType}
                  ${selectedEdge.reason.targetTitle}
                </strong>
                <div>${text.graphRelationType}: ${selectedEdge.reason.relationType}</div>
                <div>${text.graphSource}: ${selectedEdge.reason.sourcePath}</div>
                <div>${text.graphTarget}: ${selectedEdge.reason.targetPath}</div>
              </div>
            `
          : !focusNode
            ? html`<div class="alisio-memory-empty">${text.graphEdgeReasonEmpty}</div>`
            : html`
                <div class="alisio-memory-graph__spotlight">
                  <strong>${focusNode.title}</strong>
                  <span>${focusNode.sourcePath}</span>
                  <div class="alisio-memory-graph__meta">
                    <span>${text.graphDegree ?? "Degree"}: ${focusNode.degree}</span>
                    <span>
                      ${text.graphIncoming ?? "Incoming"}: ${String(focusNode.incoming)}
                    </span>
                    <span>
                      ${text.graphOutgoing ?? "Outgoing"}: ${String(focusNode.outgoing)}
                    </span>
                  </div>
                  ${focusNode.aliases.length > 0
                    ? html`
                        <div class="alisio-memory-graph__meta-block">
                          <strong>${text.graphAliases ?? "Aliases"}</strong>
                          <span>${focusNode.aliases.join(", ")}</span>
                        </div>
                      `
                    : nothing}
                  ${focusNode.tags.length > 0
                    ? html`
                        <div class="alisio-memory-graph__meta-block">
                          <strong>${text.graphTags ?? "Tags"}</strong>
                          <span>${focusNode.tags.join(", ")}</span>
                        </div>
                      `
                    : nothing}
                  <button
                    type="button"
                    class="btn btn--sm primary"
                    @click=${() => this.dispatchNodeOpen(focusNode.id)}
                  >
                    ${text.wikiOpenPage ?? text.graphFocus}
                  </button>
                </div>
              `}
      </section>
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
    return html`
      <div
        class="alisio-memory-graph__context-menu"
        style=${`left:${String(this.contextMenu.x)}px;top:${String(this.contextMenu.y)}px;`}
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

  private renderCanvas(view: MemoryGraphViewModel, text: MemoryGraphViewText) {
    const focusNode = view.focusNode;
    const transform = `translate(${this.panX} ${this.panY}) scale(${this.zoom})`;
    const nodeGroups = buildNodeGroups(view, this.groupMode);
    return html`
      <section class="alisio-memory-graph__canvas" @wheel=${this.handleWheel}>
        <svg
          viewBox="-520 -400 1040 800"
          role="img"
          aria-label=${text.graphTitle}
          @mousedown=${this.handleCanvasMouseDown}
        >
          <defs>
            <marker
              id="alisio-memory-graph-arrow"
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
            ${Array.from({ length: 13 }, (_, index) => -360 + index * 60).map(
              (offset) => html`
                <line x1=${offset} y1="-420" x2=${offset} y2="420"></line>
                <line x1="-560" y1=${offset} x2="560" y2=${offset}></line>
              `,
            )}
          </g>
          <g transform=${transform}>
            ${view.edges.map((edge) => {
              const source = this.layout[edge.fromId];
              const target = this.layout[edge.toId];
              if (!source || !target) {
                return nothing;
              }
              const highlighted = view.highlightedEdgeIds.has(edge.id);
              const attachmentEdge = edge.reason.kind === "attachment-reference";
              const dimmed =
                view.highlightedNodeIds.size > 0 &&
                !highlighted &&
                !view.selectedEdge?.id &&
                !view.highlightedEdgeIds.has(edge.id);
              return html`
                <line
                  class="alisio-memory-graph__edge ${highlighted ? "is-highlighted" : ""} ${dimmed
                    ? "is-dimmed"
                    : ""} ${attachmentEdge ? "is-attachment" : ""}"
                  x1=${source.x}
                  y1=${source.y}
                  x2=${target.x}
                  y2=${target.y}
                  style=${`stroke-width:${String((highlighted ? 3 : 2) * this.linkThickness)}`}
                  marker-end=${this.showArrows ? "url(#alisio-memory-graph-arrow)" : nothing}
                ></line>
                <line
                  class="alisio-memory-graph__edge-hit"
                  x1=${source.x}
                  y1=${source.y}
                  x2=${target.x}
                  y2=${target.y}
                  @click=${() => this.updateFilters({ selectedEdgeId: edge.id })}
                ></line>
              `;
            })}
            ${view.nodes.map((node) => {
              const position = this.layout[node.id];
              if (!position) {
                return nothing;
              }
              const groupId = nodeGroups[node.id] ?? null;
              const tone =
                groupId
                  ? resolveGraphColor(groupId)
                  : node.kind === "attachment"
                    ? "#d8aa63"
                    : "var(--accent-primary)";
              const highlighted = view.highlightedNodeIds.has(node.id);
              const dimmed =
                view.highlightedNodeIds.size > 0 &&
                !highlighted &&
                node.id !== focusNode?.id &&
                !view.selectedEdge;
              const baseRadius =
                node.kind === "attachment"
                  ? 11 + Math.min(node.degree * 1.5, 6)
                  : 14 + Math.min(node.degree * 2, 12);
              const radius =
                (node.id === focusNode?.id ? Math.max(baseRadius, 28) : baseRadius) * this.nodeScale;
              const showLabel =
                node.id === focusNode?.id ||
                highlighted ||
                this.zoom >= this.textFadeThreshold ||
                view.nodes.length <= 12;
              const labelOpacity = showLabel
                ? 1
                : clamp((this.zoom - this.textFadeThreshold + 0.25) / 0.35, 0, 0.72);
              return html`
                <g
                  class="alisio-memory-graph__node ${node.id === focusNode?.id
                    ? "is-focus"
                    : ""} ${highlighted ? "is-highlighted" : ""} ${dimmed ? "is-dimmed" : ""} ${node.kind === "attachment"
                    ? "is-attachment"
                    : "is-note"}"
                  transform=${`translate(${position.x} ${position.y})`}
                  style=${`--alisio-memory-graph-node-tint:${tone}`}
                  @mouseenter=${() => this.updateFilters({ hoveredNodeId: node.id })}
                  @mouseleave=${() => this.updateFilters({ hoveredNodeId: null })}
                  @mousedown=${(event: MouseEvent) => this.handleNodeMouseDown(event, node.id)}
                  @contextmenu=${(event: MouseEvent) => this.handleNodeContextMenu(event, node.id)}
                >
                  <circle r=${radius}></circle>
                  <text
                    class="alisio-memory-graph__label"
                    y=${radius + 18}
                    text-anchor="middle"
                    style=${`opacity:${String(labelOpacity)}`}
                  >
                    ${shortenGraphLabel(node.title)}
                  </text>
                </g>
              `;
            })}
          </g>
        </svg>
      </section>
    `;
  }

  render() {
    const text = this.resolvedText;
    const view = this.ensureLayout();

    return html`
      <style>
        .alisio-memory-graph {
          display: grid;
          grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
          gap: 18px;
        }
        .alisio-memory-graph.is-compact {
          grid-template-columns: 1fr;
          gap: 14px;
        }
        .alisio-memory-graph__sidebar {
          display: grid;
          gap: 14px;
        }
        .alisio-memory-graph.is-compact .alisio-memory-graph__sidebar {
          gap: 12px;
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
          box-shadow: 0 12px 32px rgba(10, 18, 30, 0.08);
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
        .alisio-memory-graph__search-indicator,
        .alisio-memory-graph__spotlight,
        .alisio-memory-graph__branch,
        .alisio-memory-graph__edge-reason {
          display: grid;
          gap: 8px;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          background: color-mix(in srgb, var(--surface-elevated) 76%, transparent);
        }
        .alisio-memory-graph__search-indicator span {
          color: var(--text-muted);
          overflow-wrap: anywhere;
        }
        .alisio-memory-graph__branch-list {
          display: grid;
          gap: 10px;
        }
        .alisio-memory-graph__canvas {
          position: relative;
          min-height: 640px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          border-radius: 24px;
          overflow: hidden;
          background:
            radial-gradient(
              circle at top,
              color-mix(in srgb, var(--accent-primary) 12%, transparent),
              transparent 42%
            ),
            color-mix(in srgb, var(--surface-elevated) 92%, transparent);
        }
        .alisio-memory-graph.is-compact .alisio-memory-graph__canvas {
          min-height: 420px;
          border-radius: 20px;
        }
        .alisio-memory-graph__canvas svg {
          width: 100%;
          height: 100%;
          display: block;
          cursor: grab;
        }
        .alisio-memory-graph__canvas svg:active {
          cursor: grabbing;
        }
        .alisio-memory-graph__grid line {
          stroke: color-mix(in srgb, currentColor 8%, transparent);
          stroke-width: 1;
        }
        .alisio-memory-graph__edge-hit {
          stroke: transparent;
          stroke-width: 16;
          cursor: pointer;
        }
        .alisio-memory-graph__edge {
          stroke: color-mix(in srgb, currentColor 24%, transparent);
          stroke-width: 2;
          transition:
            opacity 120ms ease,
            stroke-width 120ms ease;
        }
        .alisio-memory-graph__edge.is-attachment {
          stroke-dasharray: 5 5;
        }
        .alisio-memory-graph__edge.is-highlighted {
          stroke: color-mix(in srgb, var(--accent-primary) 58%, currentColor);
          stroke-width: 3;
        }
        .alisio-memory-graph__edge.is-dimmed {
          opacity: 0.14;
        }
        .alisio-memory-graph__node {
          cursor: pointer;
          transition: opacity 120ms ease;
        }
        .alisio-memory-graph__node.is-dimmed {
          opacity: 0.25;
        }
        .alisio-memory-graph__node circle {
          fill: color-mix(
            in srgb,
            var(--surface-panel) 82%,
            var(--alisio-memory-graph-node-tint, var(--accent-primary)) 18%
          );
          stroke: color-mix(
            in srgb,
            var(--alisio-memory-graph-node-tint, currentColor) 42%,
            transparent
          );
          stroke-width: 2;
          transition:
            fill 120ms ease,
            stroke 120ms ease,
            transform 120ms ease;
        }
        .alisio-memory-graph__node.is-focus circle {
          fill: color-mix(
            in srgb,
            var(--alisio-memory-graph-node-tint, var(--accent-primary)) 24%,
            var(--surface-panel)
          );
          stroke: color-mix(
            in srgb,
            var(--alisio-memory-graph-node-tint, var(--accent-primary)) 68%,
            currentColor
          );
          stroke-width: 3;
        }
        .alisio-memory-graph__node.is-highlighted circle {
          stroke: color-mix(
            in srgb,
            var(--alisio-memory-graph-node-tint, var(--accent-primary)) 78%,
            currentColor
          );
        }
        .alisio-memory-graph__label {
          fill: currentColor;
          font-size: 13px;
          pointer-events: none;
          transition: opacity 120ms ease;
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
          box-shadow: 0 20px 40px rgba(8, 14, 28, 0.22);
        }
        @media (max-width: 980px) {
          .alisio-memory-graph {
            grid-template-columns: 1fr;
          }
          .alisio-memory-graph__canvas {
            min-height: 440px;
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
                    <aside class="alisio-memory-graph__sidebar">
                      ${this.renderMetaCard(view, text)} ${this.renderFiltersCard(view, text)}
                      ${this.renderGroupsCard(view, text)} ${this.renderDisplayCard(text)}
                      ${this.renderForcesCard(text)}
                      ${this.renderBranchesCard(view, text)} ${this.renderSpotlightCard(view, text)}
                    </aside>
                    ${this.renderCanvas(view, text)}
                  </div>
                  ${this.renderContextMenu(text)}
                `}
    `;
  }
}

if (!customElements.get("alisio-memory-graph-view")) {
  customElements.define("alisio-memory-graph-view", AlisioMemoryGraphView);
}
