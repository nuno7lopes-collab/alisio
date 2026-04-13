import { LitElement, html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";
import { buildMemoryFileActionModel } from "../controllers/memory-files-preview.ts";
import {
  MemoryEndpointUnavailableError,
  type MemoryClaimItem,
  type MemoryEvidenceItem,
  type MemoryExportFormat,
  type MemoryExportResult,
  type MemoryFileDetail,
  type MemoryFilesListResult,
  type MemoryReasonTag,
  type MemorySyncSurface,
  type MemoryTraceResult,
  type MemoryWikiBacklink,
  type MemoryWikiHistoryEntry,
  type MemoryWikiListResult,
  type MemoryWikiPage,
  requestMemoryExport,
  requestMemoryFile,
  requestMemoryFilesList,
  requestMemoryGraph,
  requestMemoryTrace,
  requestMemoryWikiHistory,
  requestMemoryWikiList,
  requestMemoryWikiPage,
  requestMemoryWikiUpdate,
} from "../controllers/memory-runtime.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { icons } from "../icons.ts";
import type { MemoryGraphState } from "../types.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
} from "./loading-skeleton.ts";
import { renderLegacyMemoryEditor } from "./memory-legacy.ts";
import "./memory-graph-view.ts";
import { renderMemorySettings } from "./memory-settings.ts";
import { renderMemoryFilesView } from "./memory/files-view.ts";
import { renderMemoryWikiView } from "./memory/wiki-view.ts";

type MemoryHubProps = import("./memory.ts").MemoryHubProps;
type MemoryView = "wiki" | "files" | "graph";

function memoryText() {
  return {
    agent: t("alisio.memory.agent"),
    loading: t("alisio.memory.loading"),
    refresh: t("common.refresh"),
    searchPlaceholder: t("alisio.memory.searchPlaceholder"),
    save: t("alisio.memory.save"),
    saving: t("alisio.memory.saving"),
    reset: t("alisio.memory.reset"),
    preview: t("alisio.memory.preview"),
    previewEmpty: t("alisio.memory.previewEmpty"),
    unsaved: t("alisio.memory.unsaved"),
    missing: t("alisio.memory.missing"),
    emptyAgents: t("alisio.memory.emptyAgents"),
    statusLoading: t("alisio.memory.statusLoading"),
    runtimeUnavailable: t("alisio.memory.runtimeUnavailable"),
    runtimeTitle: t("alisio.memory.runtimeTitle"),
    backend: t("alisio.memory.backend"),
    provider: t("alisio.memory.provider"),
    embedding: t("alisio.memory.embedding"),
    ready: t("alisio.memory.ready"),
    unavailable: t("alisio.memory.unavailable"),
    syncNow: t("alisio.memory.syncNow"),
    syncing: t("alisio.memory.syncing"),
    graphTitle: t("alisio.memory.graphTitle"),
    graphLoading: t("alisio.memory.graphLoading"),
    graphEmpty: t("alisio.memory.graphEmpty"),
    graphUnavailable: t("alisio.memory.graphUnavailable"),
    graphAliases: t("alisio.memory.graphAliases"),
    graphTags: t("alisio.memory.graphTags"),
    graphRelations: t("alisio.memory.graphRelations"),
    none: t("common.none"),
    na: t("common.na"),
    views: {
      wiki: t("alisio.memory.views.wiki"),
      files: t("alisio.memory.views.files"),
      graph: t("alisio.memory.views.graph"),
    },
    viewsLabel: t("alisio.memory.views.label"),
    shellTitle: t("alisio.memory.shell.title"),
    wikiListTitle: t("alisio.memory.wiki.listTitle"),
    wikiEmpty: t("alisio.memory.wiki.empty"),
    wikiUnavailable: t("alisio.memory.wiki.unavailable"),
    wikiCreate: t("alisio.memory.wiki.create"),
    wikiCreatePlaceholder: t("alisio.memory.wiki.createPlaceholder"),
    wikiCreateConfirm: t("alisio.memory.wiki.createConfirm"),
    wikiEditorTitle: t("alisio.memory.wiki.editorTitle"),
    wikiBacklinks: t("alisio.memory.wiki.backlinks"),
    wikiClaims: t("alisio.memory.wiki.claims"),
    wikiEvidence: t("alisio.memory.wiki.evidence"),
    wikiProvenance: t("alisio.memory.wiki.provenance"),
    wikiHistory: t("alisio.memory.wiki.history"),
    wikiContext: t("alisio.memory.wiki.context"),
    wikiRevision: t("alisio.memory.wiki.revision"),
    wikiOpenPage: t("alisio.memory.wiki.openPage"),
    wikiNoSelection: t("alisio.memory.wiki.noSelection"),
    wikiHistoryEmpty: t("alisio.memory.wiki.historyEmpty"),
    wikiBacklinksEmpty: t("alisio.memory.wiki.backlinksEmpty"),
    wikiClaimsEmpty: t("alisio.memory.wiki.claimsEmpty"),
    wikiEvidenceEmpty: t("alisio.memory.wiki.evidenceEmpty"),
    wikiProvenanceEmpty: t("alisio.memory.wiki.provenanceEmpty"),
    wikiUpdated: t("alisio.memory.wiki.updated"),
    wikiPath: t("alisio.memory.wiki.path"),
    filesTitle: t("alisio.memory.files.title"),
    filesEmpty: t("alisio.memory.files.empty"),
    filesUnavailable: t("alisio.memory.files.unavailable"),
    filesProvenance: t("alisio.memory.files.provenance"),
    filesRelatedPages: t("alisio.memory.files.relatedPages"),
    filesMediaType: t("alisio.memory.files.mediaType"),
    filesSize: t("alisio.memory.files.size"),
    filesUpdated: t("alisio.memory.files.updated"),
    filesSummary: t("alisio.memory.files.summary"),
    filesHash: t("alisio.memory.files.hash"),
    filesPreviewKind: t("alisio.memory.files.previewKind"),
    filesOpen: t("alisio.memory.files.open"),
    filesDownload: t("alisio.memory.files.download"),
    filesOpenPage: t("alisio.memory.files.openPage"),
    filesFocusGraph: t("alisio.memory.files.focusGraph"),
    filesPreviewUnavailable: t("alisio.memory.files.previewUnavailable"),
    filesPreviewTruncated: t("alisio.memory.files.previewTruncated"),
    filesNoSelection: t("alisio.memory.files.noSelection"),
    exportLabel: t("alisio.memory.export.label"),
    exportFormats: {
      zip: t("alisio.memory.export.zip"),
      json: t("alisio.memory.export.json"),
      markdown: t("alisio.memory.export.markdown"),
    },
    exportReady: t("alisio.memory.export.ready"),
    syncLamport: t("alisio.memory.sync.lamport"),
    syncE2ee: t("alisio.memory.sync.e2ee"),
    syncE2eeRequired: t("alisio.memory.sync.e2eeRequired"),
    syncState: t("alisio.memory.sync.state"),
    syncDetail: t("alisio.memory.sync.detail"),
    reasonTags: t("alisio.memory.trace.reasonTags"),
    whySurfaced: t("alisio.memory.trace.whySurfaced"),
    viewTrace: t("alisio.memory.trace.view"),
    traceTitle: t("alisio.memory.trace.title"),
    traceSummary: t("alisio.memory.trace.summary"),
    traceQuery: t("alisio.memory.trace.query"),
    traceReasons: t("alisio.memory.trace.reasons"),
    traceHits: t("alisio.memory.trace.hits"),
    traceRaw: t("alisio.memory.trace.raw"),
    traceClose: t("alisio.memory.trace.close"),
    traceUnavailable: t("alisio.memory.trace.unavailable"),
    confidenceLabel: t("alisio.memory.claims.confidence"),
    legacyTitle: t("alisio.memory.legacy.title"),
    legacyBody: t("alisio.memory.legacy.body"),
    graphFocus: t("alisio.memory.graph.focus"),
    graphGlobal: t("alisio.memory.graph.global"),
    graphLocal: t("alisio.memory.graph.local"),
    graphResetView: t("alisio.memory.graph.resetView"),
    graphNeighbourhood: t("alisio.memory.graph.neighbourhood"),
    graphBranches: t("alisio.memory.graph.branches"),
    graphBranchesEmpty: t("alisio.memory.graph.branchesEmpty"),
    graphEdgeReason: t("alisio.memory.graph.edgeReason"),
    graphEdgeReasonEmpty: t("alisio.memory.graph.edgeReasonEmpty"),
    graphFilterRelations: t("alisio.memory.graph.filterRelations"),
    graphFilterTags: t("alisio.memory.graph.filterTags"),
    graphNodesCount: t("alisio.memory.graph.nodesCount"),
    graphEdgesCount: t("alisio.memory.graph.edgesCount"),
    graphTruncated: t("alisio.memory.graph.truncated"),
    graphSource: t("alisio.memory.graph.source"),
    graphTarget: t("alisio.memory.graph.target"),
    graphRelationType: t("alisio.memory.graph.relationType"),
  };
}

function readNestedValue(
  record: Record<string, unknown> | null | undefined,
  path: readonly string[],
): unknown {
  let current: unknown = record;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readMemoryUiFlag(
  record: Record<string, unknown> | null | undefined,
  path: readonly string[],
  fallback: boolean,
) {
  const value = readNestedValue(record, path);
  return typeof value === "boolean" ? value : fallback;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? formatRelativeTimestamp(parsed) : value;
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function describeMemoryError(err: unknown) {
  if (err instanceof MemoryEndpointUnavailableError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function emitMemoryTelemetry(event: string, detail: Record<string, unknown> = {}) {
  window.dispatchEvent(
    new CustomEvent("alisio-ui-telemetry", {
      detail: { event, ...detail },
    }),
  );
}

function formatReasonLabel(tag: MemoryReasonTag) {
  const localized = t(`alisio.memory.trace.codes.${tag.code}`);
  if (localized && localized !== `alisio.memory.trace.codes.${tag.code}`) {
    return localized;
  }
  return tag.label?.trim() || tag.code.trim();
}

function normalizeSummaryLines(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function buildTraceSummary(
  trace: MemoryTraceResult | null,
  text: Pick<ReturnType<typeof memoryText>, "traceQuery" | "traceReasons" | "traceHits">,
) {
  const lines: string[] = [];
  const raw =
    trace?.raw && typeof trace.raw === "object" && !Array.isArray(trace.raw)
      ? (trace.raw as Record<string, unknown>)
      : null;
  if (!raw) {
    return normalizeSummaryLines(trace?.summary);
  }
  const query = typeof raw.query === "string" ? raw.query.trim() : "";
  if (query) {
    lines.push(`${text.traceQuery}: ${query}`);
  }
  const reasonTags = Array.isArray(trace?.reasonTags) ? trace.reasonTags.filter(Boolean) : [];
  const reasons =
    reasonTags.length > 0
      ? reasonTags.map((tag) => formatReasonLabel(tag))
      : Array.isArray(raw.reasons)
        ? raw.reasons.map((entry) => String(entry).trim()).filter(Boolean)
        : [];
  if (reasons.length > 0) {
    lines.push(`${text.traceReasons}: ${reasons.join(", ")}`);
  }
  const hits =
    typeof raw.hitCount === "number"
      ? raw.hitCount
      : Array.isArray(raw.hits)
        ? raw.hits.length
        : null;
  if (typeof hits === "number") {
    lines.push(`${text.traceHits}: ${hits}`);
  }
  return lines.length > 0 ? lines : normalizeSummaryLines(trace?.summary);
}

function buildContextPreviewSummary(
  text: Pick<ReturnType<typeof memoryText>, "na">,
  page: MemoryWikiPage | null,
  summary?: string | null,
) {
  const explicit = typeof summary === "string" ? summary.trim() : "";
  if (explicit) {
    return explicit;
  }
  const traceSummary = page?.contextPreview?.traceSummary?.find(
    (entry) => typeof entry === "string" && entry.trim(),
  );
  if (traceSummary) {
    return traceSummary;
  }
  const pageSummary = typeof page?.summary === "string" ? page.summary.trim() : "";
  return pageSummary || text.na;
}

function mergeSyncSurfaces(
  ...surfaces: Array<MemorySyncSurface | null | undefined>
): MemorySyncSurface | null {
  const merged: MemorySyncSurface = {};
  for (const surface of surfaces) {
    if (!surface) {
      continue;
    }
    if (merged.lastSyncedLamport == null && surface.lastSyncedLamport != null) {
      merged.lastSyncedLamport = surface.lastSyncedLamport;
    }
    if (merged.e2eeRequired == null && surface.e2eeRequired != null) {
      merged.e2eeRequired = surface.e2eeRequired;
    }
    if (merged.state == null && surface.state != null) {
      merged.state = surface.state;
    }
    if (merged.mode == null && surface.mode != null) {
      merged.mode = surface.mode;
    }
    if (merged.blockedReason == null && surface.blockedReason != null) {
      merged.blockedReason = surface.blockedReason;
    }
    if (merged.lastSuccessAt == null && surface.lastSuccessAt != null) {
      merged.lastSuccessAt = surface.lastSuccessAt;
    }
    if (merged.lastAckLamport == null && surface.lastAckLamport != null) {
      merged.lastAckLamport = surface.lastAckLamport;
    }
    if (merged.pendingBacklog == null && surface.pendingBacklog != null) {
      merged.pendingBacklog = surface.pendingBacklog;
    }
    if (merged.detail == null && surface.detail != null) {
      merged.detail = surface.detail;
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

function buildCanonicalStatusSyncDetail(
  canonicalStore:
    | NonNullable<NonNullable<MemoryHubProps["memoryStatus"]>["runtime"]>["canonicalStore"]
    | null
    | undefined,
) {
  if (!canonicalStore) {
    return null;
  }
  const parts = [
    `mode ${canonicalStore.syncModeConfigured}`,
    ...(canonicalStore.syncBlockedReason ? [`blocked ${canonicalStore.syncBlockedReason}`] : []),
    ...(typeof canonicalStore.lastAckLamport === "number"
      ? [`ack ${String(canonicalStore.lastAckLamport)}`]
      : []),
    ...(typeof canonicalStore.pendingBacklog === "number"
      ? [`backlog ${String(canonicalStore.pendingBacklog)}`]
      : []),
    ...(canonicalStore.lastSyncSuccessAt
      ? [`last success ${canonicalStore.lastSyncSuccessAt}`]
      : []),
    ...(canonicalStore.lastError ? [canonicalStore.lastError] : []),
  ];
  return parts.length > 0 ? parts.join("; ") : null;
}

function deriveStatusSyncSurface(
  status: MemoryHubProps["memoryStatus"] | null | undefined,
  graph: MemoryGraphState | null | undefined,
): MemorySyncSurface | null {
  return mergeSyncSurfaces(
    status?.runtime?.canonicalStore
      ? {
          lastSyncedLamport: status.runtime.canonicalStore.lastSyncedLamport,
          e2eeRequired: status.runtime.canonicalStore.e2eeRequired,
          state: status.runtime.canonicalStore.syncAvailability,
          mode: status.runtime.canonicalStore.syncModeConfigured,
          blockedReason: status.runtime.canonicalStore.syncBlockedReason,
          lastSuccessAt: status.runtime.canonicalStore.lastSyncSuccessAt,
          lastAckLamport: status.runtime.canonicalStore.lastAckLamport,
          pendingBacklog: status.runtime.canonicalStore.pendingBacklog,
          detail: buildCanonicalStatusSyncDetail(status.runtime.canonicalStore),
        }
      : null,
    graph
      ? {
          lastSyncedLamport: graph.lastSyncedLamport,
          e2eeRequired: graph.e2eeRequired,
          state: graph.state,
          detail: graph.lastError,
        }
      : null,
  );
}

function resolveSyncInvalidationMarker(
  props: Pick<MemoryHubProps, "memoryStatus" | "memoryGraph"> | null | undefined,
) {
  const surface = deriveStatusSyncSurface(props?.memoryStatus, props?.memoryGraph);
  if (!surface) {
    return null;
  }
  const state = surface.state?.trim() ?? "";
  const lamport = surface.lastSyncedLamport == null ? "" : String(surface.lastSyncedLamport).trim();
  const detail = surface.detail?.trim() ?? "";
  return `${state}:${lamport}:${detail}`;
}

function formatSyncStateLabel(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return normalized
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function downloadText(filename: string, content: string, mediaType: string) {
  const blob = new Blob([content], { type: `${mediaType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBase64(filename: string, data: string, mediaType: string) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderReasonTags(tags: readonly MemoryReasonTag[] | null | undefined) {
  const entries = tags?.filter((tag) => tag.code.trim() || tag.label?.trim()) ?? [];
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <span class="alisio-memory-native__chips">
      ${entries.map(
        (tag) => html`<span class="alisio-memory-badge">${formatReasonLabel(tag)}</span>`,
      )}
    </span>
  `;
}

function renderProvenanceRows(
  rows: Array<{ label: string; value: string }> | null | undefined,
  emptyLabel: string,
) {
  const entries =
    rows?.filter((row) => row.label.trim() && row.value.trim()).map((row) => ({ ...row })) ?? [];
  if (entries.length === 0) {
    return html`<div class="alisio-memory-empty">${emptyLabel}</div>`;
  }
  return html`
    <div class="alisio-memory-native__pairs">
      ${entries.map(
        (row) => html`
          <div class="alisio-memory-native__pair">
            <span>${row.label}</span>
            <strong>${row.value}</strong>
          </div>
        `,
      )}
    </div>
  `;
}

function resolveAllowedExportFormats(wiki: MemoryWikiListResult | null): MemoryExportFormat[] {
  const allowed = new Set<MemoryExportFormat>(["zip", "json", "markdown"]);
  if (!wiki?.exportFormats?.length) {
    return [...allowed];
  }
  return wiki.exportFormats
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is MemoryExportFormat => allowed.has(entry as MemoryExportFormat));
}

function renderSyncCard(params: {
  text: ReturnType<typeof memoryText>;
  sync: MemorySyncSurface | null;
  status: MemoryHubProps["memoryStatus"];
  syncing: boolean;
  canSync: boolean;
  exportBusy: boolean;
  exportFormat: MemoryExportFormat;
  exportFormats: MemoryExportFormat[];
  exportMessage: string | null;
  onSync: () => void;
  onExportFormat: (value: MemoryExportFormat) => void;
  onExport: () => void;
}) {
  const provider =
    params.status?.runtime?.provider ?? params.status?.config?.provider ?? params.text.unavailable;
  const lamport = params.sync?.lastSyncedLamport ?? params.text.na;
  const syncState = formatSyncStateLabel(params.sync?.state) ?? params.text.na;
  const e2eeRequired =
    params.sync?.e2eeRequired === false ? params.text.na : params.text.syncE2eeRequired;
  const syncDetail = params.sync?.detail?.trim() ?? "";
  return html`
    <section class="alisio-memory-runtime">
      <div class="alisio-memory-runtime__header">
        <div class="alisio-memory-runtime__copy">
          <h3>${params.text.shellTitle}</h3>
        </div>
        <div class="alisio-memory-runtime__actions">
          <button
            class="btn btn--sm"
            ?disabled=${params.syncing || !params.canSync}
            @click=${params.onSync}
          >
            ${params.syncing ? params.text.syncing : params.text.syncNow}
          </button>
          <label class="field field--inline">
            <span>${params.text.exportLabel}</span>
            <select
              .value=${params.exportFormat}
              ?disabled=${params.exportBusy}
              @change=${(event: Event) =>
                params.onExportFormat(
                  (event.target as HTMLSelectElement).value as MemoryExportFormat,
                )}
            >
              ${params.exportFormats.map(
                (format) => html`
                  <option value=${format}>
                    ${params.text.exportFormats[format as keyof typeof params.text.exportFormats]}
                  </option>
                `,
              )}
            </select>
          </label>
          <button
            class="btn btn--sm primary"
            ?disabled=${params.exportBusy}
            @click=${params.onExport}
          >
            ${params.exportBusy ? params.text.saving : params.text.exportReady}
          </button>
        </div>
      </div>
      ${params.exportMessage
        ? html`<div class="callout info">${params.exportMessage}</div>`
        : nothing}
      <div class="alisio-memory-runtime__stats">
        <div class="alisio-memory-stat">
          <span class="alisio-memory-stat__label">${params.text.syncLamport}</span>
          <strong class="alisio-memory-stat__value">${String(lamport)}</strong>
        </div>
        <div class="alisio-memory-stat">
          <span class="alisio-memory-stat__label">${params.text.syncE2ee}</span>
          <strong class="alisio-memory-stat__value">${e2eeRequired}</strong>
        </div>
        <div class="alisio-memory-stat">
          <span class="alisio-memory-stat__label">${params.text.syncState}</span>
          <strong class="alisio-memory-stat__value">${syncState}</strong>
        </div>
        <div class="alisio-memory-stat">
          <span class="alisio-memory-stat__label">${params.text.backend}</span>
          <strong class="alisio-memory-stat__value">
            ${params.status?.backend?.backend ?? params.text.na}
          </strong>
        </div>
        <div class="alisio-memory-stat">
          <span class="alisio-memory-stat__label">${params.text.provider}</span>
          <strong class="alisio-memory-stat__value">${provider}</strong>
        </div>
      </div>
      ${syncDetail
        ? html`<div class="alisio-memory-runtime__meta-detail">
            ${params.text.syncDetail}: ${syncDetail}
          </div>`
        : nothing}
    </section>
  `;
}

export class AlisioMemoryNativeHub extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ attribute: false })
  props: MemoryHubProps | null = null;

  @state() private activeView: MemoryView = "wiki";
  @state() private wikiLoading = false;
  @state() private wikiError: string | null = null;
  @state() private wikiList: MemoryWikiListResult | null = null;
  @state() private selectedPageId: string | null = null;
  @state() private pageLoading = false;
  @state() private pageError: string | null = null;
  @state() private page: MemoryWikiPage | null = null;
  @state() private historyLoading = false;
  @state() private historyError: string | null = null;
  @state() private history: MemoryWikiHistoryEntry[] = [];
  @state() private pageSync: MemorySyncSurface | null = null;
  @state() private pageDrafts: Record<string, string> = {};
  @state() private pageTitleDrafts: Record<string, string> = {};
  @state() private pageSaving = false;
  @state() private wikiEditorOpen = false;
  @state() private createOpen = false;
  @state() private createTitle = "";
  @state() private filesLoading = false;
  @state() private filesError: string | null = null;
  @state() private filesList: MemoryFilesListResult | null = null;
  @state() private selectedFileId: string | null = null;
  @state() private fileSync: MemorySyncSurface | null = null;
  @state() private fileLoading = false;
  @state() private fileError: string | null = null;
  @state() private fileDetail: MemoryFileDetail | null = null;
  @state() private traceOpen = false;
  @state() private traceLoading = false;
  @state() private traceError: string | null = null;
  @state() private traceTitle = "";
  @state() private traceData: MemoryTraceResult | null = null;
  @state() private exportBusy = false;
  @state() private exportMessage: string | null = null;
  @state() private exportFormat: MemoryExportFormat = "zip";
  @state() private mutationSync: MemorySyncSurface | null = null;
  @state() private graphLoading = false;
  @state() private graphError: string | null = null;
  @state() private graphData: MemoryGraphState | null = null;
  @state() private graphScope: "global" | "local" = "global";

  private wikiListToken = 0;
  private pageToken = 0;
  private historyToken = 0;
  private filesListToken = 0;
  private fileToken = 0;
  private traceToken = 0;
  private graphToken = 0;

  protected willUpdate(changed: PropertyValues<this>) {
    if (!changed.has("props") || !this.props) {
      return;
    }
    const previous = changed.get("props");
    const agentChanged = previous?.selectedAgentId !== this.props.selectedAgentId;
    const clientChanged =
      previous?.client !== this.props.client || previous?.connected !== this.props.connected;
    if (clientChanged || agentChanged) {
      this.resetNativeState();
    }
  }

  protected updated(changed: PropertyValues<this>) {
    if (!changed.has("props") || !this.props) {
      return;
    }
    const previous = changed.get("props");
    const agentChanged = previous?.selectedAgentId !== this.props.selectedAgentId;
    const queryChanged = previous?.searchQuery !== this.props.searchQuery;
    const clientChanged =
      previous?.client !== this.props.client || previous?.connected !== this.props.connected;
    const syncChanged =
      resolveSyncInvalidationMarker(previous) !== resolveSyncInvalidationMarker(this.props);
    if (clientChanged || agentChanged) {
      if (this.props.connected && this.props.client && this.props.selectedAgentId) {
        void this.reloadNativeLists();
      }
    } else if (
      queryChanged &&
      this.props.connected &&
      this.props.client &&
      this.props.selectedAgentId
    ) {
      void this.reloadNativeLists();
    } else if (
      syncChanged &&
      this.props.connected &&
      this.props.client &&
      this.props.selectedAgentId
    ) {
      void this.reloadNativeLists();
    }
  }

  private resetNativeState() {
    this.wikiLoading = false;
    this.wikiError = null;
    this.wikiList = null;
    this.selectedPageId = null;
    this.pageLoading = false;
    this.pageError = null;
    this.page = null;
    this.historyLoading = false;
    this.historyError = null;
    this.history = [];
    this.pageSync = null;
    this.pageDrafts = {};
    this.pageTitleDrafts = {};
    this.wikiEditorOpen = false;
    this.filesLoading = false;
    this.filesError = null;
    this.filesList = null;
    this.selectedFileId = null;
    this.fileSync = null;
    this.fileLoading = false;
    this.fileError = null;
    this.fileDetail = null;
    this.traceOpen = false;
    this.traceLoading = false;
    this.traceError = null;
    this.traceData = null;
    this.exportMessage = null;
    this.mutationSync = null;
    this.graphLoading = false;
    this.graphError = null;
    this.graphData = null;
    this.graphScope = "global";
  }

  private get client(): GatewayBrowserClient | null {
    return this.props?.connected ? (this.props.client ?? null) : null;
  }

  private get selectedAgentId() {
    return this.props?.selectedAgentId?.trim() ?? "";
  }

  private get tracesEnabled() {
    return readMemoryUiFlag(this.props?.configForm, ["ui", "memory", "traces", "enabled"], true);
  }

  private get legacyEditorEnabled() {
    return readMemoryUiFlag(
      this.props?.configForm,
      ["ui", "memory", "legacyEditor", "enabled"],
      false,
    );
  }

  private get syncSurface(): MemorySyncSurface | null {
    return mergeSyncSurfaces(
      this.mutationSync,
      this.pageSync,
      this.fileSync,
      this.wikiList?.sync,
      this.filesList?.sync,
      deriveStatusSyncSurface(
        this.props?.memoryStatus,
        this.graphData ?? this.props?.memoryGraph ?? null,
      ),
    );
  }

  private get currentPageDraft() {
    if (!this.page?.id) {
      return "";
    }
    return this.pageDrafts[this.page.id] ?? this.page.content;
  }

  private get currentPageTitleDraft() {
    if (!this.page?.id) {
      return "";
    }
    return this.pageTitleDrafts[this.page.id] ?? this.page.title;
  }

  private get pageDirty() {
    if (!this.page) {
      return false;
    }
    return (
      this.currentPageDraft !== this.page.content || this.currentPageTitleDraft !== this.page.title
    );
  }

  private async reloadNativeLists() {
    await Promise.allSettled([this.loadWikiList(), this.loadFilesList()]);
    await this.loadGraph();
  }

  private async loadWikiList() {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.wikiListToken;
    this.wikiLoading = true;
    this.wikiError = null;
    try {
      const result = await requestMemoryWikiList(this.client, {
        agentId: this.selectedAgentId,
        query: this.props?.searchQuery.trim() || undefined,
      });
      if (token !== this.wikiListToken) {
        return;
      }
      this.wikiList = result;
      const allowedFormats = resolveAllowedExportFormats(result);
      if (!allowedFormats.includes(this.exportFormat)) {
        this.exportFormat = allowedFormats[0] ?? "zip";
      }
      const nextPageId = result.pages.some((page) => page.id === this.selectedPageId)
        ? this.selectedPageId
        : this.props?.searchQuery.trim()
          ? (result.pages[0]?.id ?? null)
          : null;
      this.selectedPageId = nextPageId;
      if (nextPageId) {
        await Promise.allSettled([
          this.loadWikiPage(nextPageId, { preserveDraft: true }),
          this.loadWikiHistory(nextPageId),
        ]);
      } else {
        this.page = null;
        this.history = [];
        this.pageSync = null;
      }
    } catch (err) {
      if (token !== this.wikiListToken) {
        return;
      }
      this.wikiError = describeMemoryError(err);
      this.wikiList = null;
      this.page = null;
      this.history = [];
    } finally {
      if (token === this.wikiListToken) {
        this.wikiLoading = false;
      }
    }
  }

  private async loadWikiPage(pageId: string, options?: { preserveDraft?: boolean }) {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.pageToken;
    this.pageLoading = true;
    this.pageError = null;
    try {
      const result = await requestMemoryWikiPage(this.client, {
        agentId: this.selectedAgentId,
        pageId,
        query: this.props?.searchQuery.trim() || undefined,
      });
      if (token !== this.pageToken) {
        return;
      }
      const preserveDraft =
        options?.preserveDraft && this.page?.id === result.page.id && this.pageDirty;
      this.page = result.page;
      this.pageSync = result.sync ?? null;
      if (!preserveDraft) {
        this.pageDrafts = {
          ...this.pageDrafts,
          [result.page.id]: result.page.content,
        };
        this.pageTitleDrafts = {
          ...this.pageTitleDrafts,
          [result.page.id]: result.page.title,
        };
      }
    } catch (err) {
      if (token !== this.pageToken) {
        return;
      }
      this.pageError = describeMemoryError(err);
      this.page = null;
      this.pageSync = null;
    } finally {
      if (token === this.pageToken) {
        this.pageLoading = false;
      }
    }
  }

  private async loadWikiHistory(pageId: string) {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.historyToken;
    this.historyLoading = true;
    this.historyError = null;
    try {
      const result = await requestMemoryWikiHistory(this.client, {
        agentId: this.selectedAgentId,
        pageId,
      });
      if (token !== this.historyToken) {
        return;
      }
      this.history = result.history;
    } catch (err) {
      if (token !== this.historyToken) {
        return;
      }
      this.historyError = describeMemoryError(err);
      this.history = [];
    } finally {
      if (token === this.historyToken) {
        this.historyLoading = false;
      }
    }
  }

  private async loadFilesList() {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.filesListToken;
    this.filesLoading = true;
    this.filesError = null;
    try {
      const result = await requestMemoryFilesList(this.client, {
        agentId: this.selectedAgentId,
        query: this.props?.searchQuery.trim() || undefined,
      });
      if (token !== this.filesListToken) {
        return;
      }
      this.filesList = result;
      const nextFileId = result.files.some((file) => file.id === this.selectedFileId)
        ? this.selectedFileId
        : (result.files[0]?.id ?? null);
      this.selectedFileId = nextFileId;
      if (nextFileId && this.activeView === "files") {
        await this.loadFileDetail(nextFileId);
      }
    } catch (err) {
      if (token !== this.filesListToken) {
        return;
      }
      this.filesError = describeMemoryError(err);
      this.filesList = null;
      this.fileDetail = null;
    } finally {
      if (token === this.filesListToken) {
        this.filesLoading = false;
      }
    }
  }

  private async loadFileDetail(fileId: string) {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.fileToken;
    this.fileLoading = true;
    this.fileError = null;
    try {
      const result = await requestMemoryFile(this.client, {
        agentId: this.selectedAgentId,
        fileId,
        query: this.props?.searchQuery.trim() || undefined,
      });
      if (token !== this.fileToken) {
        return;
      }
      this.fileDetail = result.file;
      this.fileSync = result.sync ?? null;
    } catch (err) {
      if (token !== this.fileToken) {
        return;
      }
      this.fileError = describeMemoryError(err);
      this.fileDetail = null;
      this.fileSync = null;
    } finally {
      if (token === this.fileToken) {
        this.fileLoading = false;
      }
    }
  }

  private async loadGraph(options?: { scope?: "global" | "local"; focusPageId?: string | null }) {
    if (!this.client || !this.selectedAgentId) {
      this.graphData = null;
      this.graphError = null;
      this.graphLoading = false;
      return;
    }
    const requestedScope = options?.scope ?? this.graphScope;
    const focusPageId = options?.focusPageId ?? this.page?.id ?? this.selectedPageId ?? null;
    const scope = requestedScope === "local" && focusPageId ? "local" : "global";
    const token = ++this.graphToken;
    this.graphScope = scope;
    this.graphLoading = true;
    this.graphError = null;
    try {
      const result = await requestMemoryGraph(this.client, {
        agentId: this.selectedAgentId,
        scope,
        ...(focusPageId ? { pageId: focusPageId } : {}),
        direction: "both",
        depth: scope === "local" ? 2 : 1,
        nodeLimit: scope === "local" ? 48 : 140,
        edgeLimit: scope === "local" ? 120 : 280,
      });
      if (token !== this.graphToken) {
        return;
      }
      this.graphData = result;
    } catch (err) {
      if (token !== this.graphToken) {
        return;
      }
      this.graphData = null;
      this.graphError = describeMemoryError(err);
    } finally {
      if (token === this.graphToken) {
        this.graphLoading = false;
      }
    }
  }

  private async selectPage(pageId: string) {
    this.selectedPageId = pageId;
    this.activeView = "wiki";
    this.wikiEditorOpen = false;
    emitMemoryTelemetry("ui_memory_view_opened", { view: "wiki" });
    void this.loadGraph({ scope: this.graphScope, focusPageId: pageId });
    await Promise.allSettled([
      this.loadWikiPage(pageId, { preserveDraft: true }),
      this.loadWikiHistory(pageId),
    ]);
  }

  private openWikiHome() {
    this.activeView = "wiki";
    this.selectedPageId = null;
    this.page = null;
    this.pageError = null;
    this.pageSync = null;
    this.history = [];
    this.historyError = null;
    this.wikiEditorOpen = false;
    emitMemoryTelemetry("ui_memory_view_opened", { view: "wiki" });
    void this.loadGraph({ scope: this.graphScope, focusPageId: null });
  }

  private async savePage() {
    if (!this.client || !this.selectedAgentId || !this.page) {
      return;
    }
    this.pageSaving = true;
    this.pageError = null;
    try {
      const result = await requestMemoryWikiUpdate(this.client, {
        agentId: this.selectedAgentId,
        pageId: this.page.id,
        title: this.currentPageTitleDraft,
        content: this.currentPageDraft,
      });
      this.mutationSync = result.sync ?? null;
      const pageId = result.page?.id ?? this.page.id;
      this.pageDrafts = {
        ...this.pageDrafts,
        [pageId]: this.currentPageDraft,
      };
      this.pageTitleDrafts = {
        ...this.pageTitleDrafts,
        [pageId]: this.currentPageTitleDraft,
      };
      await Promise.allSettled([
        this.loadWikiList(),
        this.loadWikiPage(pageId, { preserveDraft: false }),
        this.loadWikiHistory(pageId),
      ]);
      this.props?.onRefresh();
    } catch (err) {
      this.pageError = describeMemoryError(err);
    } finally {
      this.pageSaving = false;
    }
  }

  private async createPage() {
    if (!this.client || !this.selectedAgentId || !this.createTitle.trim()) {
      return;
    }
    this.pageSaving = true;
    this.pageError = null;
    try {
      const title = this.createTitle.trim();
      const result = await requestMemoryWikiUpdate(this.client, {
        agentId: this.selectedAgentId,
        title,
        content: `# ${title}\n\n`,
      });
      this.mutationSync = result.sync ?? null;
      this.createOpen = false;
      this.createTitle = "";
      await this.loadWikiList();
      const nextId =
        result.page?.id ??
        this.wikiList?.pages.find((page) => page.title.trim() === title)?.id ??
        null;
      if (nextId) {
        await this.selectPage(nextId);
        this.wikiEditorOpen = true;
      }
      this.props?.onRefresh();
    } catch (err) {
      this.pageError = describeMemoryError(err);
    } finally {
      this.pageSaving = false;
    }
  }

  private async openTrace(params: {
    label: string;
    traceId?: string | null;
    trace?: unknown;
    summary?: string[] | null;
    reasonTags?: MemoryReasonTag[] | null;
  }) {
    const text = memoryText();
    emitMemoryTelemetry("ui_trace_opened", { label: params.label });
    this.traceOpen = true;
    this.traceLoading = true;
    this.traceError = null;
    this.traceTitle = params.label;
    if (!this.tracesEnabled) {
      this.traceLoading = false;
      this.traceError = text.traceUnavailable;
      this.traceData = null;
      return;
    }
    try {
      if (params.traceId && this.client && this.selectedAgentId) {
        const token = ++this.traceToken;
        const trace = await requestMemoryTrace(this.client, {
          agentId: this.selectedAgentId,
          traceId: params.traceId,
        });
        if (token !== this.traceToken) {
          return;
        }
        this.traceData = trace;
      } else if (params.trace !== undefined) {
        this.traceData = {
          traceId: params.traceId,
          summary: params.summary ?? [],
          reasonTags: params.reasonTags ?? [],
          raw: params.trace,
        };
      } else {
        this.traceData = null;
        this.traceError = text.traceUnavailable;
      }
    } catch (err) {
      this.traceData = null;
      this.traceError = describeMemoryError(err);
    } finally {
      this.traceLoading = false;
    }
  }

  private renderTraceAction(
    text: ReturnType<typeof memoryText>,
    params: {
      label: string;
      traceId?: string | null;
      trace?: unknown;
      summary?: string[] | null;
      reasonTags?: MemoryReasonTag[] | null;
    },
  ) {
    if (!this.tracesEnabled || (!params.traceId && params.trace === undefined)) {
      return nothing;
    }
    return html`
      <div class="alisio-memory-native__result-actions">
        <button
          type="button"
          class="btn btn--sm"
          @click=${(event: Event) => {
            event.stopPropagation();
            void this.openTrace(params);
          }}
        >
          ${text.viewTrace}
        </button>
      </div>
    `;
  }

  private async exportMemory() {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    emitMemoryTelemetry("ui_export_clicked", { format: this.exportFormat });
    this.exportBusy = true;
    this.exportMessage = null;
    try {
      const result = await requestMemoryExport(this.client, {
        agentId: this.selectedAgentId,
        format: this.exportFormat,
      });
      this.finishExport(result);
    } catch (err) {
      this.exportMessage = describeMemoryError(err);
    } finally {
      this.exportBusy = false;
    }
  }

  private finishExport(result: MemoryExportResult) {
    const mediaType =
      result.mediaType ??
      (result.format === "json"
        ? "application/json"
        : result.format === "markdown"
          ? "text/markdown"
          : "application/zip");
    const fileName =
      result.fileName ??
      `alisio-memory-export.${result.format === "markdown" ? "md" : result.format}`;
    if (result.downloadUrl) {
      const link = document.createElement("a");
      link.href = result.downloadUrl;
      link.download = fileName;
      link.click();
      this.exportMessage = fileName;
      return;
    }
    if (result.bytesBase64) {
      downloadBase64(fileName, result.bytesBase64, mediaType);
      this.exportMessage = fileName;
      return;
    }
    if (typeof result.content === "string") {
      downloadText(fileName, result.content, mediaType);
      this.exportMessage = fileName;
      return;
    }
    this.exportMessage = result.savedPath ?? result.message ?? fileName;
  }

  private normalizeWikiLookupKey(value: string) {
    return value
      .replace(/\\/g, "/")
      .trim()
      .replace(/^\.?\//, "")
      .replace(/\.md$/i, "")
      .replace(/\/+/g, "/")
      .toLowerCase();
  }

  private findMatchingWikiPage(
    pages: ReadonlyArray<{ id: string; title: string; slug?: string | null; path?: string | null }>,
    target: string,
  ) {
    const normalizedTarget = this.normalizeWikiLookupKey(target);
    return (
      pages.find((page) => {
        const candidates = [
          page.id,
          page.title,
          page.slug ?? "",
          page.path ?? "",
          page.path ? page.path.replace(/^memory\//, "") : "",
          page.path ? (page.path.split("/").at(-1)?.replace(/\.md$/i, "") ?? "") : "",
        ];
        return candidates.some(
          (candidate) => this.normalizeWikiLookupKey(candidate) === normalizedTarget,
        );
      }) ?? null
    );
  }

  private async findPageIdByTarget(target: string) {
    const directMatch = this.findMatchingWikiPage(this.wikiList?.pages ?? [], target);
    if (directMatch) {
      return directMatch.id;
    }
    if (!this.client || !this.selectedAgentId) {
      return null;
    }
    try {
      const result = await requestMemoryWikiList(this.client, {
        agentId: this.selectedAgentId,
      });
      return this.findMatchingWikiPage(result.pages, target)?.id ?? null;
    } catch {
      return null;
    }
  }

  private async openWikiTarget(target: string) {
    const pageId = await this.findPageIdByTarget(target);
    if (pageId) {
      await this.selectPage(pageId);
      return;
    }
    if (!this.legacyEditorEnabled) {
      return;
    }
    this.activeView = "wiki";
    emitMemoryTelemetry("ui_memory_view_opened", { view: "wiki" });
    this.props?.onSelectFile(target);
  }

  private async openGraphTarget(path: string | null | undefined) {
    if (!path) {
      return;
    }
    await this.openWikiTarget(path);
  }

  private openRelatedFile(fileId: string) {
    this.activeView = "files";
    this.selectedFileId = fileId;
    emitMemoryTelemetry("ui_memory_view_opened", { view: "files" });
    void this.loadFileDetail(fileId);
  }

  private openFileAttachment() {
    const target = buildMemoryFileActionModel(this.fileDetail).openHref;
    if (!target) {
      return;
    }
    const link = document.createElement("a");
    link.href = target;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  }

  private downloadFileAttachment() {
    const download = buildMemoryFileActionModel(this.fileDetail).download;
    if (!download) {
      return;
    }
    downloadBase64(download.fileName, download.bytesBase64, download.mediaType);
  }

  private openFileWikiPage(pageId: string) {
    void this.selectPage(pageId);
  }

  private focusGraphPage(pageId: string) {
    void (async () => {
      await this.selectPage(pageId);
      this.activeView = "graph";
      emitMemoryTelemetry("ui_memory_view_opened", { view: "graph" });
    })();
  }

  private setView(view: MemoryView) {
    this.activeView = view;
    emitMemoryTelemetry("ui_memory_view_opened", { view });
    if (view === "files" && this.selectedFileId) {
      void this.loadFileDetail(this.selectedFileId);
    }
    if (view === "graph") {
      void this.loadGraph();
    }
  }

  private renderHeader(text: ReturnType<typeof memoryText>) {
    const agents = this.props?.agentsList?.agents ?? [];
    return html`
      <section class="alisio-memory-runtime">
        <div class="alisio-memory-runtime__header">
          <div class="alisio-memory-runtime__copy">
            <h3>${text.runtimeTitle}</h3>
          </div>
          <div class="alisio-memory-runtime__actions">
            <label class="field field--inline">
              <span>${text.agent}</span>
              <select
                .value=${this.props?.selectedAgentId ?? ""}
                ?disabled=${agents.length === 0}
                @change=${(event: Event) =>
                  this.props?.onSelectAgent((event.target as HTMLSelectElement).value)}
              >
                ${agents.length === 0
                  ? html`<option value="">${text.emptyAgents}</option>`
                  : agents.map(
                      (agent) => html`<option value=${agent.id}>${agent.name ?? agent.id}</option>`,
                    )}
              </select>
            </label>
            <label class="field field--with-icon alisio-memory-search">
              <span class="sr-only">${text.searchPlaceholder}</span>
              <span class="field__icon" aria-hidden="true">${icons.search}</span>
              <input
                .value=${this.props?.searchQuery ?? ""}
                placeholder=${text.searchPlaceholder}
                @input=${(event: Event) =>
                  this.props?.onSearchChange((event.target as HTMLInputElement).value)}
              />
            </label>
            <button
              class="btn btn--icon btn--ghost alisio-memory-refresh"
              title=${text.refresh}
              aria-label=${text.refresh}
              @click=${() => {
                this.props?.onRefresh();
                void this.reloadNativeLists();
              }}
            >
              ${icons.refresh}
            </button>
          </div>
        </div>
        <div class="alisio-memory-native__tabs" role="tablist" aria-label=${text.viewsLabel}>
          ${(["wiki", "files", "graph"] as const).map(
            (view) => html`
              <button
                type="button"
                class="btn btn--sm ${this.activeView === view ? "primary" : ""}"
                role="tab"
                aria-selected=${this.activeView === view ? "true" : "false"}
                @click=${() => this.setView(view)}
              >
                ${text.views[view]}
              </button>
            `,
          )}
        </div>
      </section>
    `;
  }

  private renderWikiSidebar(text: ReturnType<typeof memoryText>) {
    if (this.wikiLoading && !this.wikiList) {
      return html`
        <section class="alisio-memory-group">
          <div class="loading-state__list">
            ${renderSkeletonListItem({ lines: ["short", "medium"] })}
            ${renderSkeletonListItem({ lines: ["short", "medium"] })}
            ${renderSkeletonListItem({ lines: ["short", "medium"] })}
          </div>
        </section>
      `;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header">
          <h2>${text.wikiListTitle}</h2>
          <button class="btn btn--sm primary" @click=${() => (this.createOpen = !this.createOpen)}>
            ${icons.plus} ${text.wikiCreate}
          </button>
        </div>
        ${this.createOpen
          ? html`
              <div class="alisio-memory-native__composer">
                <label class="field">
                  <span>${text.wikiCreate}</span>
                  <input
                    .value=${this.createTitle}
                    placeholder=${text.wikiCreatePlaceholder}
                    @input=${(event: Event) =>
                      (this.createTitle = (event.target as HTMLInputElement).value)}
                  />
                </label>
                <div class="alisio-memory-runtime__actions">
                  <button class="btn btn--sm" @click=${() => (this.createOpen = false)}>
                    ${t("alisio.memory.cancelCreate")}
                  </button>
                  <button
                    class="btn btn--sm primary"
                    ?disabled=${!this.createTitle.trim() || this.pageSaving}
                    @click=${() => void this.createPage()}
                  >
                    ${text.wikiCreateConfirm}
                  </button>
                </div>
              </div>
            `
          : nothing}
        ${this.wikiError
          ? html`<div class="callout info">${this.wikiError}</div>`
          : this.wikiList && this.wikiList.pages.length === 0
            ? html`<div class="alisio-memory-empty">${text.wikiEmpty}</div>`
            : html`
                <div class="alisio-memory-file-list">
                  ${(this.wikiList?.pages ?? []).map(
                    (page) => html`
                      <article class="alisio-memory-native__result-card">
                        <button
                          type="button"
                          class="alisio-memory-file ${this.selectedPageId === page.id
                            ? "is-active"
                            : ""}"
                          aria-current=${this.selectedPageId === page.id ? "true" : "false"}
                          @click=${() => void this.selectPage(page.id)}
                        >
                          <span class="alisio-memory-file__copy">
                            <span class="alisio-memory-file__title">${page.title}</span>
                            <span class="alisio-memory-file__meta">
                              ${page.excerpt?.trim() || page.path?.trim() || text.na}
                            </span>
                            ${renderReasonTags(page.reasonTags)}
                          </span>
                          <span class="alisio-memory-file__status">
                            ${typeof page.backlinks === "number"
                              ? `${page.backlinks} ↩`
                              : (formatTimestamp(page.updatedAt) ?? text.na)}
                          </span>
                        </button>
                        ${this.renderTraceAction(text, {
                          label: page.title,
                          traceId: page.traceId,
                          trace: page.trace,
                          summary: page.traceSummary,
                          reasonTags: page.reasonTags,
                        })}
                      </article>
                    `,
                  )}
                </div>
              `}
      </section>
    `;
  }

  private renderBacklinks(
    text: ReturnType<typeof memoryText>,
    backlinks: MemoryWikiBacklink[] | null | undefined,
  ) {
    const items = backlinks ?? [];
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.wikiBacklinks}</h2></div>
        ${items.length === 0
          ? html`<div class="alisio-memory-empty">${text.wikiBacklinksEmpty}</div>`
          : html`
              <div class="alisio-memory-file-list">
                ${items.map(
                  (item) => html`
                    <button
                      type="button"
                      class="alisio-memory-file"
                      @click=${() =>
                        item.id ? void this.selectPage(item.id) : this.openGraphTarget(item.path)}
                    >
                      <span class="alisio-memory-file__copy">
                        <span class="alisio-memory-file__title">${item.title}</span>
                        <span class="alisio-memory-file__meta">
                          ${item.excerpt?.trim() || item.path?.trim() || text.na}
                        </span>
                      </span>
                    </button>
                  `,
                )}
              </div>
            `}
      </section>
    `;
  }

  private renderClaims(
    text: ReturnType<typeof memoryText>,
    claims: MemoryClaimItem[] | null | undefined,
  ) {
    const items = claims ?? [];
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.wikiClaims}</h2></div>
        ${items.length === 0
          ? html`<div class="alisio-memory-empty">${text.wikiClaimsEmpty}</div>`
          : html`
              <div class="alisio-memory-native__stack">
                ${items.map(
                  (claim) => html`
                    <article class="alisio-memory-runtime">
                      <strong>${claim.claim}</strong>
                      ${claim.confidence != null
                        ? html`
                            <span class="alisio-memory-runtime__meta-detail">
                              ${text.confidenceLabel} ${String(claim.confidence)}
                            </span>
                          `
                        : nothing}
                      ${claim.evidence?.length
                        ? html`
                            <div class="alisio-memory-native__stack">
                              ${claim.evidence.map(
                                (item) => html`
                                  <div class="alisio-memory-runtime__meta-item">
                                    <span class="alisio-memory-runtime__meta-label">
                                      ${item.title?.trim() ||
                                      item.source?.trim() ||
                                      text.wikiEvidence}
                                    </span>
                                    <span class="alisio-memory-runtime__meta-detail">
                                      ${item.excerpt?.trim() || text.na}
                                    </span>
                                  </div>
                                `,
                              )}
                            </div>
                          `
                        : nothing}
                    </article>
                  `,
                )}
              </div>
            `}
      </section>
    `;
  }

  private renderEvidence(
    text: ReturnType<typeof memoryText>,
    evidence: MemoryEvidenceItem[] | null | undefined,
  ) {
    const items = evidence ?? [];
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.wikiEvidence}</h2></div>
        ${items.length === 0
          ? html`<div class="alisio-memory-empty">${text.wikiEvidenceEmpty}</div>`
          : html`
              <div class="alisio-memory-native__stack">
                ${items.map(
                  (item) => html`
                    <article class="alisio-memory-runtime">
                      <strong>
                        ${item.title?.trim() || item.source?.trim() || text.wikiEvidence}
                      </strong>
                      <span class="alisio-memory-runtime__meta-detail">
                        ${item.excerpt?.trim() || text.na}
                      </span>
                      ${item.source?.trim() && item.source !== item.title?.trim()
                        ? html`
                            <span class="alisio-memory-runtime__meta-detail"> ${item.source} </span>
                          `
                        : nothing}
                      ${item.provenance?.length
                        ? renderProvenanceRows(item.provenance, text.wikiProvenanceEmpty)
                        : nothing}
                    </article>
                  `,
                )}
              </div>
            `}
      </section>
    `;
  }

  private renderRevision(text: ReturnType<typeof memoryText>) {
    const revision = this.page?.revision ?? null;
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.wikiRevision}</h2></div>
        ${!revision
          ? html`<div class="alisio-memory-empty">${text.na}</div>`
          : html`
              <article class="alisio-memory-runtime__meta-item">
                <span class="alisio-memory-runtime__meta-label">
                  ${revision.summary?.trim() || revision.eventId || text.wikiRevision}
                </span>
                <strong class="alisio-memory-runtime__meta-value">
                  ${String(revision.lamport ?? text.na)}
                </strong>
                <span class="alisio-memory-runtime__meta-detail">
                  ${[formatTimestamp(revision.updatedAt), revision.author]
                    .filter(Boolean)
                    .join(" · ") || text.na}
                </span>
                ${revision.eventId
                  ? html`
                      <span class="alisio-memory-runtime__meta-detail"> ${revision.eventId} </span>
                    `
                  : nothing}
              </article>
            `}
      </section>
    `;
  }

  private renderHistory(text: ReturnType<typeof memoryText>) {
    if (this.historyLoading && this.history.length === 0) {
      return html`
        <section class="alisio-memory-group">
          <div class="alisio-memory-group__header"><h2>${text.wikiHistory}</h2></div>
          <div class="alisio-memory-empty">
            ${renderSkeletonLines(["short", "medium"], { compact: true })}
          </div>
        </section>
      `;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.wikiHistory}</h2></div>
        ${this.historyError
          ? html`<div class="callout info">${this.historyError}</div>`
          : this.history.length === 0
            ? html`<div class="alisio-memory-empty">${text.wikiHistoryEmpty}</div>`
            : html`
                <div class="alisio-memory-native__stack">
                  ${this.history.map(
                    (entry) => html`
                      <article class="alisio-memory-runtime__meta-item">
                        <span class="alisio-memory-runtime__meta-label">
                          ${entry.summary?.trim() || entry.operation?.trim() || entry.eventId}
                        </span>
                        <strong class="alisio-memory-runtime__meta-value">
                          ${String(entry.lamport ?? text.na)}
                        </strong>
                        <span class="alisio-memory-runtime__meta-detail">
                          ${[formatTimestamp(entry.at), entry.author].filter(Boolean).join(" · ") ||
                          text.na}
                        </span>
                        ${entry.diffSummary
                          ? html`
                              <span class="alisio-memory-runtime__meta-detail">
                                ${entry.diffSummary}
                              </span>
                            `
                          : nothing}
                      </article>
                    `,
                  )}
                </div>
              `}
      </section>
    `;
  }

  private renderContext(text: ReturnType<typeof memoryText>) {
    const preview = this.page?.contextPreview ?? null;
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.wikiContext}</h2></div>
        ${!preview
          ? html`<div class="alisio-memory-empty">${text.na}</div>`
          : html`
              <div class="alisio-memory-native__stack">
                <div class="alisio-memory-runtime__meta-item">
                  <span class="alisio-memory-runtime__meta-label">${text.whySurfaced}</span>
                  <span class="alisio-memory-runtime__meta-detail">
                    ${buildContextPreviewSummary(text, this.page, preview.summary)}
                  </span>
                  ${renderReasonTags(preview.reasonTags)}
                  ${this.tracesEnabled && (preview.traceId || preview.trace)
                    ? html`
                        <div class="alisio-memory-runtime__actions">
                          <button
                            class="btn btn--sm"
                            @click=${() =>
                              void this.openTrace({
                                label: this.page?.title ?? text.traceTitle,
                                traceId: preview.traceId,
                                trace: preview.trace,
                                summary: preview.traceSummary,
                                reasonTags: preview.reasonTags,
                              })}
                          >
                            ${text.viewTrace}
                          </button>
                        </div>
                      `
                    : nothing}
                </div>
              </div>
            `}
      </section>
    `;
  }

  private renderWikiView(text: ReturnType<typeof memoryText>) {
    return renderMemoryWikiView({
      text,
      searchQuery: this.props?.searchQuery ?? "",
      wikiLoading: this.wikiLoading,
      wikiError: this.wikiError,
      wikiList: this.wikiList,
      selectedPageId: this.selectedPageId,
      pageLoading: this.pageLoading,
      pageError: this.pageError,
      page: this.page,
      historyLoading: this.historyLoading,
      historyError: this.historyError,
      history: this.history,
      tracesEnabled: this.tracesEnabled,
      createOpen: this.createOpen,
      createTitle: this.createTitle,
      pageSaving: this.pageSaving,
      pageDirty: this.pageDirty,
      currentPageDraft: this.currentPageDraft,
      currentPageTitleDraft: this.currentPageTitleDraft,
      editorOpen: this.wikiEditorOpen,
      legacyEditorEnabled: this.legacyEditorEnabled,
      legacyEditor: this.legacyEditorEnabled
        ? renderLegacyMemoryEditor(this.props!, { compact: true })
        : undefined,
      onGoHome: () => this.openWikiHome(),
      onSelectPage: (pageId) => void this.selectPage(pageId),
      onSelectFile: (fileId) => this.openRelatedFile(fileId),
      onOpenTrace: (params) => void this.openTrace(params),
      onOpenWikiTarget: (target) => void this.openWikiTarget(target),
      onToggleCreate: (open) => {
        this.createOpen = open;
      },
      onCreateTitle: (value) => {
        this.createTitle = value;
      },
      onCreatePage: () => void this.createPage(),
      onToggleEditor: (open) => {
        this.wikiEditorOpen = open;
      },
      onSetPageDraft: (value) => {
        if (!this.page?.id) {
          return;
        }
        this.pageDrafts = {
          ...this.pageDrafts,
          [this.page.id]: value,
        };
      },
      onSetPageTitleDraft: (value) => {
        if (!this.page?.id) {
          return;
        }
        this.pageTitleDrafts = {
          ...this.pageTitleDrafts,
          [this.page.id]: value,
        };
      },
      onResetPage: () => {
        if (!this.page?.id) {
          return;
        }
        this.pageDrafts = { ...this.pageDrafts, [this.page.id]: this.page.content };
        this.pageTitleDrafts = { ...this.pageTitleDrafts, [this.page.id]: this.page.title };
      },
      onSavePage: () => void this.savePage(),
    });
  }

  private renderFilesView(text: ReturnType<typeof memoryText>) {
    return renderMemoryFilesView({
      text,
      filesLoading: this.filesLoading,
      filesError: this.filesError,
      filesList: this.filesList,
      selectedFileId: this.selectedFileId,
      fileLoading: this.fileLoading,
      fileError: this.fileError,
      fileDetail: this.fileDetail,
      renderReasonTags,
      renderProvenance: renderProvenanceRows,
      renderTraceAction: (params) => this.renderTraceAction(text, params),
      formatBytes,
      formatTimestamp,
      onSelectFile: (fileId) => {
        this.selectedFileId = fileId;
        void this.loadFileDetail(fileId);
      },
      onOpenAttachment: () => this.openFileAttachment(),
      onDownloadAttachment: () => this.downloadFileAttachment(),
      onOpenWikiPage: (pageId) => this.openFileWikiPage(pageId),
      onFocusGraphPage: (pageId) => this.focusGraphPage(pageId),
    });
  }

  private renderGraphView(text: ReturnType<typeof memoryText>) {
    return html`
      <alisio-memory-graph-view
        .graph=${this.graphData}
        .loading=${this.graphLoading}
        .error=${this.graphError}
        .activeScope=${this.graphScope}
        .localAvailable=${Boolean(this.page?.id ?? this.selectedPageId)}
        .text=${{
          graphTitle: text.graphTitle,
          graphLoading: text.graphLoading,
          graphUnavailable: text.graphUnavailable,
          graphEmpty: text.graphEmpty,
          graphFocus: text.graphFocus,
          graphGlobal: text.graphGlobal,
          graphLocal: text.graphLocal,
          graphResetView: text.graphResetView,
          graphNeighbourhood: text.graphNeighbourhood,
          graphBranches: text.graphBranches,
          graphBranchesEmpty: text.graphBranchesEmpty,
          graphEdgeReason: text.graphEdgeReason,
          graphEdgeReasonEmpty: text.graphEdgeReasonEmpty,
          graphFilterRelations: text.graphFilterRelations,
          graphFilterTags: text.graphFilterTags,
          graphNodesCount: text.graphNodesCount,
          graphEdgesCount: text.graphEdgesCount,
          graphTruncated: text.graphTruncated,
          graphSource: text.graphSource,
          graphTarget: text.graphTarget,
          graphRelationType: text.graphRelationType,
        }}
        @alisio-memory-graph-open-node=${(event: CustomEvent<{ pageId: string }>) => {
          const pageId = event.detail?.pageId?.trim();
          if (pageId) {
            void this.selectPage(pageId);
          }
        }}
        @alisio-memory-graph-scope-change=${(event: CustomEvent<{ scope: "global" | "local" }>) => {
          const scope = event.detail?.scope;
          if (!scope) {
            return;
          }
          void this.loadGraph({ scope });
        }}
      ></alisio-memory-graph-view>
    `;
  }

  private renderTraceDrawer(text: ReturnType<typeof memoryText>) {
    if (!this.traceOpen) {
      return nothing;
    }
    const summary = buildTraceSummary(this.traceData, text);
    return html`
      <section class="alisio-memory-runtime alisio-memory-native__drawer">
        <div class="alisio-memory-runtime__header">
          <div class="alisio-memory-runtime__copy">
            <h3>${text.traceTitle}</h3>
            <p>${this.traceTitle}</p>
          </div>
          <div class="alisio-memory-runtime__actions">
            <button class="btn btn--sm" @click=${() => (this.traceOpen = false)}>
              ${text.traceClose}
            </button>
          </div>
        </div>
        ${this.traceLoading
          ? html`<div class="alisio-memory-empty">${text.loading}</div>`
          : this.traceError
            ? html`<div class="callout info">${this.traceError}</div>`
            : !this.traceData
              ? html`<div class="alisio-memory-empty">${text.traceUnavailable}</div>`
              : html`
                  ${renderReasonTags(this.traceData.reasonTags)}
                  <div class="alisio-memory-native__trace-grid">
                    <section class="alisio-memory-group">
                      <div class="alisio-memory-group__header"><h2>${text.traceSummary}</h2></div>
                      ${summary.length === 0
                        ? html`<div class="alisio-memory-empty">${text.na}</div>`
                        : html`
                            <div class="alisio-memory-native__stack">
                              ${summary.map((line) => html`<div>${line}</div>`)}
                            </div>
                          `}
                    </section>
                    <section class="alisio-memory-group">
                      <div class="alisio-memory-group__header"><h2>${text.traceRaw}</h2></div>
                      <pre class="alisio-memory-native__trace-raw">
${JSON.stringify(this.traceData.raw, null, 2)}</pre
                      >
                    </section>
                  </div>
                `}
      </section>
    `;
  }

  render() {
    const props = this.props;
    const text = memoryText();
    if (!props) {
      return nothing;
    }
    if (props.agentsLoading && !(props.agentsList?.agents.length ?? 0)) {
      return html`
        <section class="alisio-page alisio-memory-page" aria-label=${text.loading}>
          <div class="alisio-memory-skeleton">
            <div class="loading-state__header">
              <div class="loading-state__header-copy">
                <div class="skeleton loading-state__title"></div>
                <div class="skeleton skeleton-line loading-state__subtitle"></div>
              </div>
              ${renderSkeletonButton()}
            </div>
            <div class="loading-state__list" style="margin-top: 18px;">
              ${renderSkeletonListItem({ lines: ["short", "medium"] })}
              ${renderSkeletonListItem({ lines: ["short", "medium"] })}
            </div>
          </div>
        </section>
      `;
    }

    return html`
      <style>
        .alisio-memory-native__tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .alisio-memory-native__stack {
          display: grid;
          gap: 12px;
        }
        .alisio-memory-native__chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }
        .alisio-memory-native__editor {
          display: grid;
          gap: 16px;
        }
        .alisio-memory-native__panels {
          display: grid;
          gap: 18px;
          margin-top: 18px;
        }
        .alisio-memory-native__composer {
          display: grid;
          gap: 12px;
          margin-bottom: 16px;
        }
        .alisio-memory-native__pairs {
          display: grid;
          gap: 12px;
        }
        .alisio-memory-native__pair {
          display: grid;
          gap: 6px;
        }
        .alisio-memory-native__drawer {
          margin-top: 18px;
        }
        .alisio-memory-native__trace-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 18px;
        }
        .alisio-memory-native__result-card {
          display: grid;
          gap: 8px;
        }
        .alisio-memory-native__result-actions {
          display: flex;
          justify-content: flex-end;
        }
        .alisio-memory-preview {
          display: grid;
          gap: 10px;
        }
        .alisio-memory-preview__label {
          font-size: 0.78rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .alisio-memory-preview__body,
        .alisio-memory-preview__empty,
        .alisio-memory-files-preview__code {
          margin: 0;
          padding: 14px;
          border-radius: 16px;
          background: color-mix(in srgb, var(--surface-elevated) 78%, transparent);
        }
        .alisio-memory-files-preview__code {
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .alisio-memory-files-preview__image,
        .alisio-memory-files-preview__frame {
          width: 100%;
          border: 0;
          border-radius: 16px;
          background: color-mix(in srgb, var(--surface-elevated) 78%, transparent);
        }
        .alisio-memory-files-preview__image {
          display: block;
          max-height: 480px;
          object-fit: contain;
        }
        .alisio-memory-files-preview__frame {
          min-height: 480px;
        }
        .alisio-memory-files-preview__audio {
          width: 100%;
        }
        .alisio-memory-preview__hint {
          font-size: 0.82rem;
          color: var(--text-muted);
        }
        .alisio-memory-native__trace-raw {
          margin: 0;
          overflow: auto;
          border-radius: 16px;
          padding: 14px;
          background: color-mix(in srgb, var(--surface-elevated) 78%, transparent);
        }
        .alisio-memory-native__graph {
          width: 100%;
          min-height: 360px;
        }
        .alisio-memory-native__graph-node {
          cursor: pointer;
        }
        .alisio-memory-native__graph-node circle {
          fill: color-mix(in srgb, var(--accent-primary) 14%, var(--surface-panel));
          stroke: color-mix(in srgb, var(--accent-primary) 38%, var(--border-subtle));
          stroke-width: 2;
        }
        .alisio-memory-native__graph-node.is-active circle {
          fill: color-mix(in srgb, var(--accent-primary) 22%, var(--surface-panel));
          stroke-width: 3;
        }
        .alisio-memory-native__graph-node text,
        .alisio-memory-native__edge-label {
          fill: currentColor;
          font-size: 13px;
        }
        @media (max-width: 900px) {
          .alisio-memory-native__trace-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
      <section class="alisio-page alisio-memory-page">
        ${this.renderHeader(text)}
        ${renderSyncCard({
          text,
          sync: this.syncSurface,
          status: props.memoryStatus,
          syncing: props.memorySyncing,
          canSync: props.memorySyncAvailable && Boolean(props.memoryStatus?.enabled),
          exportBusy: this.exportBusy,
          exportFormat: this.exportFormat,
          exportFormats: resolveAllowedExportFormats(this.wikiList),
          exportMessage: this.exportMessage,
          onSync: props.onSync,
          onExportFormat: (value) => {
            this.exportFormat = value;
          },
          onExport: () => void this.exportMemory(),
        })}
        ${props.agentsError
          ? html`<div class="callout danger">${props.agentsError}</div>`
          : nothing}
        ${props.memoryError
          ? html`<div class="callout danger">${props.memoryError}</div>`
          : nothing}
        ${props.memoryStatusError
          ? html`<div class="callout info">${props.memoryStatusError}</div>`
          : nothing}
        ${this.activeView === "wiki"
          ? this.renderWikiView(text)
          : this.activeView === "files"
            ? this.renderFilesView(text)
            : this.renderGraphView(text)}
        ${this.renderTraceDrawer(text)}
        ${this.activeView === "graph"
          ? nothing
          : renderMemorySettings({
              loading: props.configLoading,
              saving: props.configSaving,
              dirty: props.configDirty,
              schema: props.configSchema,
              uiHints: props.configUiHints,
              value: props.configForm,
              selectedAgentId: props.selectedAgentId,
              selectedAgentLabel:
                props.agentsList?.agents.find((agent) => agent.id === props.selectedAgentId)
                  ?.name ?? props.selectedAgentId,
              onPatch: props.onConfigPatch,
              onSave: props.onSaveSettings,
            })}
      </section>
    `;
  }
}

if (!customElements.get("alisio-memory-native-hub")) {
  customElements.define("alisio-memory-native-hub", AlisioMemoryNativeHub);
}
