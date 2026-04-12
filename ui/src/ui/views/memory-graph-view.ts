import { LitElement, html, nothing } from "lit";
import { property } from "lit/decorators.js";
import {
  buildMemoryGraphViewModel,
  createMemoryGraphFilterState,
  type MemoryGraphFilterState,
} from "../controllers/memory-graph-controller.ts";
import type { MemoryGraphState } from "../types.ts";
import { buildMemoryGraphLayout, type MemoryGraphLayout } from "./memory-graph-layout.ts";

export type MemoryGraphViewText = {
  graphTitle: string;
  graphLoading: string;
  graphUnavailable: string;
  graphEmpty: string;
  graphFocus: string;
  graphGlobal: string;
  graphLocal: string;
  graphResetView: string;
  graphNeighbourhood: string;
  graphBranches: string;
  graphBranchesEmpty: string;
  graphEdgeReason: string;
  graphEdgeReasonEmpty: string;
  graphFilterRelations: string;
  graphFilterTags: string;
  graphNodesCount: string;
  graphEdgesCount: string;
  graphTruncated: string;
  graphSource: string;
  graphTarget: string;
  graphRelationType: string;
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

  private filters: MemoryGraphFilterState = createMemoryGraphFilterState();
  private layout: MemoryGraphLayout = {};
  private layoutSignature = "";
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private dragState: DragState | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("mousemove", this.handleGlobalMouseMove);
    window.addEventListener("mouseup", this.handleGlobalMouseUp);
  }

  disconnectedCallback() {
    window.removeEventListener("mousemove", this.handleGlobalMouseMove);
    window.removeEventListener("mouseup", this.handleGlobalMouseUp);
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
        graphResetView: "Reset view",
        graphNeighbourhood: "Neighborhood",
        graphBranches: "Branches",
        graphBranchesEmpty: "No branches available.",
        graphEdgeReason: "Why this link exists",
        graphEdgeReasonEmpty: "Select an edge to inspect the canonical link.",
        graphFilterRelations: "Relation filters",
        graphFilterTags: "Tag filters",
        graphNodesCount: "Nodes",
        graphEdgesCount: "Edges",
        graphTruncated: "Truncated to keep the graph responsive.",
        graphSource: "Source",
        graphTarget: "Target",
        graphRelationType: "Relation",
      }
    );
  }

  private updateFilters(next: Partial<MemoryGraphFilterState>) {
    this.filters = {
      ...this.filters,
      ...next,
    };
    this.requestUpdate();
  }

  private resetViewport() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.requestUpdate();
  }

  private ensureLayout() {
    const view = buildMemoryGraphViewModel(this.graph, this.filters);
    const signature = JSON.stringify({
      focus: view.focusNode?.id ?? null,
      nodes: view.nodes.map((node) => node.id),
      edges: view.edges.map((edge) => edge.id),
    });
    if (signature !== this.layoutSignature) {
      this.layout = buildMemoryGraphLayout({
        nodes: view.nodes,
        edges: view.edges,
        focusNodeId: view.focusNode?.id ?? null,
        previousLayout: this.layout,
      });
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

  private handleCanvasMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
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
    this.dragState = {
      kind: "node",
      nodeId,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
  }

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const nextZoom = clamp(this.zoom * (event.deltaY < 0 ? 1.08 : 0.92), 0.35, 2.6);
    this.zoom = nextZoom;
    this.requestUpdate();
  };

  render() {
    const text = this.resolvedText;
    const view = this.ensureLayout();
    const selectedRelationTypes = new Set(this.filters.relationTypes);
    const selectedTags = new Set(this.filters.tags);
    const focusNode = view.focusNode;
    const transform = `translate(${this.panX} ${this.panY}) scale(${this.zoom})`;

    return html`
      <style>
        .alisio-memory-graph {
          display: grid;
          grid-template-columns: minmax(250px, 300px) minmax(0, 1fr);
          gap: 18px;
        }
        .alisio-memory-graph__sidebar {
          display: grid;
          gap: 14px;
        }
        .alisio-memory-graph__card {
          display: grid;
          gap: 12px;
          padding: 16px;
          border: 1px solid var(--border-subtle);
          border-radius: 18px;
          background: color-mix(in srgb, var(--surface-elevated) 82%, transparent);
        }
        .alisio-memory-graph__scope {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .alisio-memory-graph__chips {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .alisio-memory-graph__chips button {
          border-radius: 999px;
        }
        .alisio-memory-graph__canvas {
          min-height: 620px;
          border: 1px solid var(--border-subtle);
          border-radius: 22px;
          overflow: hidden;
          background:
            radial-gradient(circle at top, color-mix(in srgb, var(--accent-primary) 12%, transparent), transparent 38%),
            color-mix(in srgb, var(--surface-elevated) 90%, transparent);
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
          stroke: color-mix(in srgb, currentColor 9%, transparent);
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
          transition: opacity 120ms ease, stroke-width 120ms ease;
        }
        .alisio-memory-graph__edge.is-highlighted {
          stroke: color-mix(in srgb, var(--accent-primary) 56%, currentColor);
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
          fill: color-mix(in srgb, var(--surface-panel) 84%, var(--accent-primary) 16%);
          stroke: color-mix(in srgb, currentColor 18%, transparent);
          stroke-width: 2;
        }
        .alisio-memory-graph__node.is-focus circle {
          fill: color-mix(in srgb, var(--accent-primary) 24%, var(--surface-panel));
          stroke: color-mix(in srgb, var(--accent-primary) 56%, currentColor);
          stroke-width: 3;
        }
        .alisio-memory-graph__node.is-highlighted circle {
          stroke: color-mix(in srgb, var(--accent-primary) 68%, currentColor);
        }
        .alisio-memory-graph__label {
          fill: currentColor;
          font-size: 13px;
          pointer-events: none;
        }
        .alisio-memory-graph__meta {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          font-size: 13px;
        }
        .alisio-memory-graph__branch-list,
        .alisio-memory-graph__edge-reason {
          display: grid;
          gap: 10px;
        }
        .alisio-memory-graph__branch button {
          width: 100%;
          justify-content: flex-start;
        }
        @media (max-width: 980px) {
          .alisio-memory-graph {
            grid-template-columns: 1fr;
          }
          .alisio-memory-graph__canvas {
            min-height: 420px;
          }
        }
      </style>
      ${this.loading
        ? html`<section class="alisio-memory-runtime"><div class="alisio-memory-empty">${text.graphLoading}</div></section>`
        : this.error
          ? html`<section class="alisio-memory-runtime"><div class="callout info">${this.error}</div></section>`
          : !this.graph
            ? html`<div class="alisio-memory-panel alisio-memory-panel--empty">${text.graphUnavailable}</div>`
            : view.nodes.length === 0
              ? html`<div class="alisio-memory-panel alisio-memory-panel--empty">${text.graphEmpty}</div>`
            : html`
                <div class="alisio-memory-graph">
                  <aside class="alisio-memory-graph__sidebar">
                    <section class="alisio-memory-graph__card">
                      <div class="alisio-memory-group__header"><h2>${text.graphTitle}</h2></div>
                      <div class="alisio-memory-graph__scope">
                        <button
                          type="button"
                          class="btn btn--sm ${this.activeScope === "global" ? "btn--primary" : ""}"
                          @click=${() => this.dispatchScopeChange("global")}
                        >
                          ${text.graphGlobal}
                        </button>
                        <button
                          type="button"
                          class="btn btn--sm ${this.activeScope === "local" ? "btn--primary" : ""}"
                          ?disabled=${!this.localAvailable}
                          @click=${() => this.dispatchScopeChange("local")}
                        >
                          ${text.graphLocal}
                        </button>
                        <button type="button" class="btn btn--sm" @click=${() => this.resetViewport()}>
                          ${text.graphResetView}
                        </button>
                      </div>
                      <div class="alisio-memory-graph__meta">
                        <span>${text.graphNodesCount}: ${view.nodes.length}</span>
                        <span>${text.graphEdgesCount}: ${view.edges.length}</span>
                      </div>
                      ${this.graph.truncated.nodes || this.graph.truncated.edges
                        ? html`<div class="muted">${text.graphTruncated}</div>`
                        : nothing}
                      ${focusNode
                        ? html`
                            <article class="alisio-memory-runtime__meta-item">
                              <span class="alisio-memory-runtime__meta-label">${text.graphFocus}</span>
                              <strong class="alisio-memory-runtime__meta-value">${focusNode.title}</strong>
                              <span class="alisio-memory-runtime__meta-detail">${focusNode.sourcePath}</span>
                            </article>
                          `
                        : html`<div class="alisio-memory-empty">${text.graphEmpty}</div>`}
                    </section>

                    <section class="alisio-memory-graph__card">
                      <div class="alisio-memory-group__header"><h2>${text.graphFilterRelations}</h2></div>
                      <div class="alisio-memory-graph__chips">
                        ${this.graph.availableRelationTypes.map(
                          (relationType) => html`
                            <button
                              type="button"
                              class="btn btn--sm ${selectedRelationTypes.has(relationType)
                                ? "btn--primary"
                                : ""}"
                              aria-pressed=${selectedRelationTypes.has(relationType)}
                              @click=${() =>
                                this.updateFilters({
                                  relationTypes: selectedRelationTypes.has(relationType)
                                    ? this.filters.relationTypes.filter((value) => value !== relationType)
                                    : [...this.filters.relationTypes, relationType],
                                })}
                            >
                              ${relationType}
                            </button>
                          `,
                        )}
                      </div>
                      <div class="alisio-memory-group__header"><h2>${text.graphFilterTags}</h2></div>
                      <div class="alisio-memory-graph__chips">
                        ${this.graph.availableTags.map(
                          (tag) => html`
                            <button
                              type="button"
                              class="btn btn--sm ${selectedTags.has(tag) ? "btn--primary" : ""}"
                              aria-pressed=${selectedTags.has(tag)}
                              @click=${() =>
                                this.updateFilters({
                                  tags: selectedTags.has(tag)
                                    ? this.filters.tags.filter((value) => value !== tag)
                                    : [...this.filters.tags, tag],
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
                            })}
                        />
                        <span class="field-checkbox__label">${text.graphNeighbourhood}</span>
                      </label>
                    </section>

                    <section class="alisio-memory-graph__card">
                      <div class="alisio-memory-group__header"><h2>${text.graphBranches}</h2></div>
                      <div class="alisio-memory-graph__branch-list">
                        ${view.branches.length === 0
                          ? html`<div class="alisio-memory-empty">${text.graphBranchesEmpty}</div>`
                          : view.branches.map(
                              (branch) => html`
                                <article class="alisio-memory-graph__branch">
                                  <strong>${branch.direction} · ${branch.relationType}</strong>
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

                    <section class="alisio-memory-graph__card">
                      <div class="alisio-memory-group__header"><h2>${text.graphEdgeReason}</h2></div>
                      ${view.selectedEdge
                        ? html`
                            <div class="alisio-memory-graph__edge-reason">
                              <strong>
                                ${view.selectedEdge.reason.sourceTitle} ${view.selectedEdge.relationType}
                                ${view.selectedEdge.reason.targetTitle}
                              </strong>
                              <div>${text.graphRelationType}: ${view.selectedEdge.reason.relationType}</div>
                              <div>${text.graphSource}: ${view.selectedEdge.reason.sourcePath}</div>
                              <div>${text.graphTarget}: ${view.selectedEdge.reason.targetPath}</div>
                            </div>
                          `
                        : html`<div class="alisio-memory-empty">${text.graphEdgeReasonEmpty}</div>`}
                    </section>
                  </aside>

                  <section class="alisio-memory-graph__canvas" @wheel=${this.handleWheel}>
                    <svg
                      viewBox="-520 -400 1040 800"
                      role="img"
                      aria-label=${text.graphTitle}
                      @mousedown=${this.handleCanvasMouseDown}
                    >
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
                          const dimmed =
                            view.highlightedNodeIds.size > 0 &&
                            !highlighted &&
                            !view.selectedEdge?.id &&
                            !view.highlightedEdgeIds.has(edge.id);
                          return html`
                            <line
                              class="alisio-memory-graph__edge ${highlighted
                                ? "is-highlighted"
                                : ""} ${dimmed ? "is-dimmed" : ""}"
                              x1=${source.x}
                              y1=${source.y}
                              x2=${target.x}
                              y2=${target.y}
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
                          const highlighted = view.highlightedNodeIds.has(node.id);
                          const dimmed =
                            view.highlightedNodeIds.size > 0 &&
                            !highlighted &&
                            node.id !== focusNode?.id &&
                            !view.selectedEdge;
                          const radius = node.id === focusNode?.id ? 28 : 18 + Math.min(node.degree * 2, 12);
                          return html`
                            <g
                              class="alisio-memory-graph__node ${node.id === focusNode?.id
                                ? "is-focus"
                                : ""} ${highlighted ? "is-highlighted" : ""} ${dimmed
                                ? "is-dimmed"
                                : ""}"
                              transform=${`translate(${position.x} ${position.y})`}
                              @mouseenter=${() => this.updateFilters({ hoveredNodeId: node.id })}
                              @mouseleave=${() => this.updateFilters({ hoveredNodeId: null })}
                              @mousedown=${(event: MouseEvent) => this.handleNodeMouseDown(event, node.id)}
                            >
                              <circle r=${radius}></circle>
                              <text class="alisio-memory-graph__label" y=${radius + 18} text-anchor="middle">
                                ${node.title}
                              </text>
                            </g>
                          `;
                        })}
                      </g>
                    </svg>
                  </section>
                </div>
              `}
    `;
  }
}

if (!customElements.get("alisio-memory-graph-view")) {
  customElements.define("alisio-memory-graph-view", AlisioMemoryGraphView);
}
