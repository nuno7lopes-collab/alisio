import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import {
  buildMemoryFileActionModel,
  buildMemoryFilePreviewModel,
} from "../controllers/memory-files-preview.ts";
import {
  MemoryEndpointUnavailableError,
  type MemoryClaimItem,
  type MemoryEvidenceItem,
  type MemoryExportFormat,
  type MemoryExportResult,
  type MemoryFileDetail,
  type MemoryNote,
  type MemoryNoteAttachment,
  type MemoryNoteBacklink,
  type MemoryNoteHistoryEntry,
  type MemoryNoteListEntry,
  type MemoryNotesListResult,
  type MemoryReasonTag,
  type MemorySyncSurface,
  type MemoryTraceResult,
  requestMemoryExport,
  requestMemoryFile,
  requestMemoryGraph,
  requestMemoryNote,
  requestMemoryNoteHistory,
  requestMemoryNotesList,
  requestMemoryNoteUpdate,
  requestMemoryTrace,
} from "../controllers/memory-runtime.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import type { MemoryGraphState } from "../types.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
  renderSkeletonPill,
} from "./loading-skeleton.ts";
import "./memory-graph-view.ts";
import { renderMemoryFilePreview } from "./memory/files-preview.ts";

type MemoryHubProps = import("./memory.ts").MemoryHubProps;
type NoteMode = "markdown" | "reading";

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
    builtin: t("alisio.memory.builtin"),
    provider: t("alisio.memory.provider"),
    embedding: t("alisio.memory.embedding"),
    ready: t("alisio.memory.ready"),
    unavailable: t("alisio.memory.unavailable"),
    localFirst: t("alisio.memory.localFirst"),
    localOnly: t("alisio.memory.localOnly"),
    cloudSyncEnabled: t("alisio.memory.cloudSyncEnabled"),
    cloudSyncUnavailable: t("alisio.memory.cloudSyncUnavailable"),
    cloudSyncError: t("alisio.memory.cloudSyncError"),
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
      graph: t("alisio.memory.views.graph"),
    },
    viewDescriptions: {
      wiki: t("alisio.memory.views.wikiDescription"),
      graph: t("alisio.memory.views.graphDescription"),
    },
    notesListTitle: t("alisio.memory.wiki.listTitle"),
    notesEmpty: t("alisio.memory.wiki.empty"),
    notesCreate: t("alisio.memory.wiki.create"),
    notesCreatePlaceholder: t("alisio.memory.wiki.createPlaceholder"),
    notesCreateConfirm: t("alisio.memory.wiki.createConfirm"),
    noteMarkdown: t("alisio.memory.wiki.editorTitle"),
    noteReading: t("alisio.memory.wiki.readMode"),
    noteBacklinks: t("alisio.memory.wiki.backlinks"),
    noteClaims: t("alisio.memory.wiki.claims"),
    noteEvidence: t("alisio.memory.wiki.evidence"),
    noteProvenance: t("alisio.memory.wiki.provenance"),
    noteHistory: t("alisio.memory.wiki.history"),
    noteContext: t("alisio.memory.wiki.context"),
    noteRevision: t("alisio.memory.wiki.revision"),
    noteOpen: t("alisio.memory.wiki.openPage"),
    noteNoSelection: t("alisio.memory.wiki.noSelection"),
    noteHistoryEmpty: t("alisio.memory.wiki.historyEmpty"),
    noteBacklinksEmpty: t("alisio.memory.wiki.backlinksEmpty"),
    noteClaimsEmpty: t("alisio.memory.wiki.claimsEmpty"),
    noteEvidenceEmpty: t("alisio.memory.wiki.evidenceEmpty"),
    noteProvenanceEmpty: t("alisio.memory.wiki.provenanceEmpty"),
    noteUpdated: t("alisio.memory.wiki.updated"),
    notePath: t("alisio.memory.wiki.path"),
    filesTitle: t("alisio.memory.files.title"),
    filesEmpty: t("alisio.memory.files.empty"),
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
    filesAttached: t("alisio.memory.files.attached"),
    filesMentioned: t("alisio.memory.files.mentioned"),
    filesUnlinked: t("alisio.memory.files.unlinked"),
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
    graphHint: t("alisio.memory.graph.hint"),
    graphFocus: t("alisio.memory.graph.focus"),
    graphGlobal: t("alisio.memory.graph.global"),
    graphLocal: t("alisio.memory.graph.local"),
    graphDepth: t("alisio.memory.graph.depth"),
    graphResetView: t("alisio.memory.graph.resetView"),
    graphNeighbourhood: t("alisio.memory.graph.neighbourhood"),
    graphOrphans: t("alisio.memory.graph.orphans"),
    graphBranches: t("alisio.memory.graph.branches"),
    graphBranchesEmpty: t("alisio.memory.graph.branchesEmpty"),
    graphEdgeReason: t("alisio.memory.graph.edgeReason"),
    graphEdgeReasonEmpty: t("alisio.memory.graph.edgeReasonEmpty"),
    graphFilterRelations: t("alisio.memory.graph.filterRelations"),
    graphFilterTags: t("alisio.memory.graph.filterTags"),
    graphGroups: t("alisio.memory.graph.groups"),
    graphColorBy: t("alisio.memory.graph.colorBy"),
    graphGroupNone: t("alisio.memory.graph.groupNone"),
    graphGroupFolder: t("alisio.memory.graph.groupFolder"),
    graphGroupTag: t("alisio.memory.graph.groupTag"),
    graphGroupKind: t("alisio.memory.graph.groupKind"),
    graphGroupSource: t("alisio.memory.graph.groupSource"),
    graphGroupNote: t("alisio.memory.graph.groupNote"),
    graphGroupAttachment: t("alisio.memory.graph.groupAttachment"),
    graphContextMenuOpen: t("alisio.memory.graph.contextMenuOpen"),
    graphContextMenuCenter: t("alisio.memory.graph.contextMenuCenter"),
    graphContextMenuLocal: t("alisio.memory.graph.contextMenuLocal"),
    graphDisplay: t("alisio.memory.graph.display"),
    graphArrows: t("alisio.memory.graph.arrows"),
    graphTextFadeThreshold: t("alisio.memory.graph.textFadeThreshold"),
    graphNodeSize: t("alisio.memory.graph.nodeSize"),
    graphLinkThickness: t("alisio.memory.graph.linkThickness"),
    graphForces: t("alisio.memory.graph.forces"),
    graphCenterForce: t("alisio.memory.graph.centerForce"),
    graphRepelForce: t("alisio.memory.graph.repelForce"),
    graphLinkForce: t("alisio.memory.graph.linkForce"),
    graphLinkDistance: t("alisio.memory.graph.linkDistance"),
    graphNodesCount: t("alisio.memory.graph.nodesCount"),
    graphEdgesCount: t("alisio.memory.graph.edgesCount"),
    graphTruncated: t("alisio.memory.graph.truncated"),
    graphSource: t("alisio.memory.graph.source"),
    graphTarget: t("alisio.memory.graph.target"),
    graphRelationType: t("alisio.memory.graph.relationType"),
    graphClusters: t("alisio.memory.graph.clusters"),
    graphSuggestions: t("alisio.memory.graph.suggestions"),
    graphSpotlight: t("alisio.memory.graph.spotlight"),
    graphIncoming: t("alisio.memory.graph.incoming"),
    graphOutgoing: t("alisio.memory.graph.outgoing"),
    graphDegree: t("alisio.memory.graph.degree"),
    graphZoomIn: t("alisio.memory.graph.zoomIn"),
    graphZoomOut: t("alisio.memory.graph.zoomOut"),
    graphCenterFocus: t("alisio.memory.graph.centerFocus"),
    graphCanvasHint: t("alisio.memory.graph.canvasHint"),
    graphShowAttachments: t("alisio.memory.graph.showAttachments"),
    cancelCreate: t("alisio.memory.cancelCreate"),
    shellTitle: t("alisio.memory.shell.title"),
    shellSubtitle: t("alisio.memory.shell.subtitle"),
    workspaceExplorer: t("alisio.memory.workspace.explorer"),
    workspaceInspector: t("alisio.memory.workspace.inspector"),
    workspaceGraphPane: t("alisio.memory.workspace.graphPane"),
    workspaceVault: t("alisio.memory.workspace.vault"),
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
  note: MemoryNote | null,
  summary?: string | null,
) {
  const explicit = typeof summary === "string" ? summary.trim() : "";
  if (explicit) {
    return explicit;
  }
  const traceSummary = note?.contextPreview?.traceSummary?.find(
    (entry) => typeof entry === "string" && entry.trim(),
  );
  if (traceSummary) {
    return traceSummary;
  }
  const noteSummary = typeof note?.summary === "string" ? note.summary.trim() : "";
  return noteSummary || text.na;
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

function renderMemoryNotice(message: string, tone: "danger" | "info" = "info") {
  return html`<div class="alisio-memory-notice is-${tone}">${message}</div>`;
}

function renderMemoryPlaceholder(params: {
  icon: unknown;
  label?: string | null;
  detail?: string | null;
  action?: TemplateResult;
  compact?: boolean;
}) {
  return html`
    <div class="alisio-memory-placeholder ${params.compact ? "is-compact" : ""}">
      <span class="alisio-memory-placeholder__icon" aria-hidden="true">${params.icon}</span>
      ${params.label ? html`<strong>${params.label}</strong>` : nothing}
      ${params.detail ? html`<span>${params.detail}</span>` : nothing} ${params.action ?? nothing}
    </div>
  `;
}

function renderExplorerSkeleton() {
  return html`
    <div class="alisio-memory-skeleton-stack" aria-hidden="true">
      ${renderSkeletonButton({ small: true, wide: true })}
      ${renderSkeletonListItem({ lines: ["medium"], aside: "pill", compact: true })}
      ${renderSkeletonListItem({ lines: ["long", "short"], aside: "pill", compact: true })}
      ${renderSkeletonListItem({ lines: ["medium", "short"], aside: "pill", compact: true })}
    </div>
  `;
}

function hasProvenanceRows(rows: Array<{ label: string; value: string }> | null | undefined) {
  return rows?.some((row) => row.label.trim().length > 0 && row.value.trim().length > 0) ?? false;
}

function renderNoteSkeleton() {
  return html`
    <article class="alisio-memory-note alisio-memory-note--skeleton" aria-hidden="true">
      <div class="alisio-memory-skeleton-stack">
        ${renderSkeletonPill({ small: true })} ${renderSkeletonLines(["medium"])}
      </div>
      ${renderSkeletonLines(["full", "full", "long", "medium"], {
        className: "alisio-memory-skeleton-copy",
      })}
    </article>
  `;
}

function resolveAllowedExportFormats(
  list: { exportFormats?: string[] | null } | null,
): MemoryExportFormat[] {
  const allowed = new Set<MemoryExportFormat>(["zip", "json", "markdown"]);
  if (!list?.exportFormats?.length) {
    return [...allowed];
  }
  return list.exportFormats
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is MemoryExportFormat => allowed.has(entry as MemoryExportFormat));
}

function renderSyncCard(params: {
  text: ReturnType<typeof memoryText>;
  sync: MemorySyncSurface | null;
  status: MemoryHubProps["memoryStatus"];
  noteCount: number;
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
  const showCard =
    params.syncing ||
    params.exportBusy ||
    Boolean(params.exportMessage) ||
    (params.noteCount > 0 &&
      (params.canSync || Boolean(params.sync) || params.status?.enabled === true));
  if (!showCard) {
    return nothing;
  }
  const pills = [
    lamport !== params.text.na ? `L ${String(lamport)}` : null,
    e2eeRequired !== params.text.na ? "E2EE" : null,
    syncState !== params.text.na ? syncState : null,
    params.status?.backend?.backend?.trim() || null,
    provider !== params.text.unavailable ? provider : null,
  ].filter((value): value is string => Boolean(value));
  return html`
    <section class="alisio-memory-utilitybar">
      <div class="alisio-memory-utilitybar__meta">
        ${pills.map((pill) => html`<span class="alisio-memory-utilitybar__pill">${pill}</span>`)}
      </div>
      <div class="alisio-memory-utilitybar__actions">
        <button
          class="btn btn--sm btn--ghost"
          ?disabled=${params.syncing || !params.canSync}
          title=${params.syncing ? params.text.syncing : params.text.syncNow}
          aria-label=${params.syncing ? params.text.syncing : params.text.syncNow}
          @click=${params.onSync}
        >
          ${icons.refresh}
        </button>
        <select
          class="alisio-memory-utilitybar__select"
          .value=${params.exportFormat}
          ?disabled=${params.exportBusy}
          @change=${(event: Event) =>
            params.onExportFormat((event.target as HTMLSelectElement).value as MemoryExportFormat)}
        >
          ${params.exportFormats.map(
            (format) => html`
              <option value=${format}>
                ${params.text.exportFormats[format as keyof typeof params.text.exportFormats]}
              </option>
            `,
          )}
        </select>
        <button
          class="btn btn--sm primary"
          ?disabled=${params.exportBusy}
          @click=${params.onExport}
        >
          ${params.exportBusy ? params.text.saving : params.text.exportReady}
        </button>
      </div>
      ${params.exportMessage
        ? html`<div class="alisio-memory-utilitybar__message">${params.exportMessage}</div>`
        : syncDetail
          ? html`<div class="alisio-memory-utilitybar__message">${syncDetail}</div>`
          : nothing}
    </section>
  `;
}

type NoteExplorerTreeNode = {
  label: string;
  path: string;
  folders: NoteExplorerTreeNode[];
  notes: MemoryNoteListEntry[];
  noteCount: number;
};

function normalizeNoteFolder(pathValue: string | null | undefined) {
  const normalized = typeof pathValue === "string" ? pathValue.replace(/\\/g, "/").trim() : "";
  if (!normalized.includes("/")) {
    return "/";
  }
  const folder = normalized.split("/").slice(0, -1).join("/");
  return folder || "/";
}

function buildNoteExplorerTree(notes: MemoryNoteListEntry[]) {
  type MutableNode = {
    label: string;
    path: string;
    folders: Map<string, MutableNode>;
    notes: MemoryNoteListEntry[];
  };

  const createNode = (path: string, label: string): MutableNode => ({
    label,
    path,
    folders: new Map(),
    notes: [],
  });

  const root = createNode("/", "/");
  for (const note of notes) {
    const folder = normalizeNoteFolder(note.path);
    const segments = folder === "/" ? [] : folder.split("/").filter(Boolean);
    let current = root;
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = current.folders.get(currentPath);
      if (!child) {
        child = createNode(currentPath, segment);
        current.folders.set(currentPath, child);
      }
      current = child;
    }
    current.notes.push(note);
  }

  const finalize = (node: MutableNode): NoteExplorerTreeNode => {
    const folders = [...node.folders.values()]
      .map((child) => finalize(child))
      .toSorted((left, right) => left.label.localeCompare(right.label));
    const orderedNotes = [...node.notes].toSorted((left, right) =>
      left.title.localeCompare(right.title),
    );
    return {
      label: node.label,
      path: node.path,
      folders,
      notes: orderedNotes,
      noteCount: orderedNotes.length + folders.reduce((sum, entry) => sum + entry.noteCount, 0),
    };
  };

  return finalize(root);
}

function stripFrontmatter(markdown: string) {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) {
    return markdown;
  }
  return markdown.slice(end + 5);
}

function convertWikiLinks(markdown: string) {
  return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, rawTarget, rawLabel) => {
    const target = String(rawTarget ?? "").trim();
    const fallbackLabel = target.split("/").at(-1) ?? target;
    const label = String(rawLabel ?? fallbackLabel).trim() || fallbackLabel;
    return `[${label}](memory-note://${encodeURIComponent(target)})`;
  });
}

function renderMarkdownPreview(markdown: string) {
  return unsafeHTML(toSanitizedMarkdownHtml(convertWikiLinks(stripFrontmatter(markdown))));
}

function normalizeLookupKey(value: string) {
  return value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\.md$/i, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function formatNoteSubtitle(
  text: Pick<ReturnType<typeof memoryText>, "na">,
  note: Pick<MemoryNoteListEntry, "path" | "excerpt" | "updatedAt">,
) {
  return note.excerpt?.trim() || note.path?.trim() || formatTimestamp(note.updatedAt) || text.na;
}

export class AlisioMemoryNativeHub extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ attribute: false })
  props: MemoryHubProps | null = null;

  @state() private notesLoading = false;
  @state() private notesError: string | null = null;
  @state() private notesList: MemoryNotesListResult | null = null;
  @state() private selectedNoteId: string | null = null;
  @state() private noteLoading = false;
  @state() private noteError: string | null = null;
  @state() private note: MemoryNote | null = null;
  @state() private noteMode: NoteMode = "markdown";
  @state() private noteSaving = false;
  @state() private noteSync: MemorySyncSurface | null = null;
  @state() private noteDrafts: Record<string, string> = {};
  @state() private noteTitleDrafts: Record<string, string> = {};
  @state() private historyLoading = false;
  @state() private historyError: string | null = null;
  @state() private history: MemoryNoteHistoryEntry[] = [];
  @state() private createOpen = false;
  @state() private createTitle = "";
  @state() private selectedAttachmentId: string | null = null;
  @state() private attachmentLoading = false;
  @state() private attachmentError: string | null = null;
  @state() private attachmentDetail: MemoryFileDetail | null = null;
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
  @state() private graphIncludeAttachments = false;
  @state() private graphDepth = 2;
  @state() private mainPaneMode: "note" | "graph" = "note";

  private notesListToken = 0;
  private noteToken = 0;
  private historyToken = 0;
  private attachmentToken = 0;
  private traceToken = 0;
  private graphToken = 0;
  private searchReloadTimer: number | null = null;

  disconnectedCallback() {
    this.clearSearchReloadTimer();
    this.invalidatePendingRequests();
    super.disconnectedCallback();
  }

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
        void this.reloadAll();
      }
      return;
    }
    if (queryChanged && this.props.connected && this.props.client && this.props.selectedAgentId) {
      this.scheduleSearchReload();
      return;
    }
    if (syncChanged && this.props.connected && this.props.client && this.props.selectedAgentId) {
      void this.reloadAll();
    }
  }

  private resetNativeState() {
    this.clearSearchReloadTimer();
    this.invalidatePendingRequests();
    this.notesLoading = false;
    this.notesError = null;
    this.notesList = null;
    this.selectedNoteId = null;
    this.noteLoading = false;
    this.noteError = null;
    this.note = null;
    this.noteMode = "markdown";
    this.noteSaving = false;
    this.noteSync = null;
    this.noteDrafts = {};
    this.noteTitleDrafts = {};
    this.historyLoading = false;
    this.historyError = null;
    this.history = [];
    this.createOpen = false;
    this.createTitle = "";
    this.selectedAttachmentId = null;
    this.attachmentLoading = false;
    this.attachmentError = null;
    this.attachmentDetail = null;
    this.traceOpen = false;
    this.traceLoading = false;
    this.traceError = null;
    this.traceTitle = "";
    this.traceData = null;
    this.exportBusy = false;
    this.exportMessage = null;
    this.mutationSync = null;
    this.graphLoading = false;
    this.graphError = null;
    this.graphData = null;
    this.graphScope = "global";
    this.graphIncludeAttachments = false;
    this.graphDepth = 2;
    this.mainPaneMode = "note";
  }

  private invalidatePendingRequests() {
    this.notesListToken += 1;
    this.noteToken += 1;
    this.historyToken += 1;
    this.attachmentToken += 1;
    this.traceToken += 1;
    this.graphToken += 1;
  }

  private clearSearchReloadTimer() {
    if (this.searchReloadTimer == null) {
      return;
    }
    window.clearTimeout(this.searchReloadTimer);
    this.searchReloadTimer = null;
  }

  private scheduleSearchReload() {
    this.clearSearchReloadTimer();
    this.searchReloadTimer = window.setTimeout(() => {
      this.searchReloadTimer = null;
      void this.reloadAll();
    }, 180);
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

  private get syncSurface(): MemorySyncSurface | null {
    return mergeSyncSurfaces(
      this.mutationSync,
      this.noteSync,
      this.notesList?.sync,
      deriveStatusSyncSurface(
        this.props?.memoryStatus,
        this.graphData ?? this.props?.memoryGraph ?? null,
      ),
    );
  }

  private get currentNoteDraft() {
    if (!this.note?.id) {
      return "";
    }
    return this.noteDrafts[this.note.id] ?? this.note.content;
  }

  private get currentNoteTitleDraft() {
    if (!this.note?.id) {
      return "";
    }
    return this.noteTitleDrafts[this.note.id] ?? this.note.title;
  }

  private get noteDirty() {
    if (!this.note) {
      return false;
    }
    return (
      this.currentNoteDraft !== this.note.content || this.currentNoteTitleDraft !== this.note.title
    );
  }

  private async reloadAll() {
    await this.loadNotesList();
    await this.loadGraph({
      scope: this.graphScope,
      focusNoteId: this.selectedNoteId,
      includeAttachments: this.graphIncludeAttachments,
    });
  }

  private async loadNotesList() {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.notesListToken;
    this.notesLoading = true;
    this.notesError = null;
    try {
      const result = await requestMemoryNotesList(this.client, {
        agentId: this.selectedAgentId,
        query: this.props?.searchQuery.trim() || undefined,
      });
      if (token !== this.notesListToken) {
        return;
      }
      this.notesList = result;
      const allowedFormats = resolveAllowedExportFormats(result);
      if (!allowedFormats.includes(this.exportFormat)) {
        this.exportFormat = allowedFormats[0] ?? "zip";
      }
      const nextNoteId = result.notes.some((note) => note.id === this.selectedNoteId)
        ? this.selectedNoteId
        : (result.notes[0]?.id ?? null);
      this.selectedNoteId = nextNoteId;
      if (!nextNoteId) {
        this.note = null;
        this.noteSync = null;
        this.noteError = null;
        this.history = [];
        this.historyError = null;
        this.selectedAttachmentId = null;
        this.attachmentDetail = null;
        this.attachmentError = null;
        return;
      }
      await Promise.allSettled([
        this.loadNote(nextNoteId, { preserveDraft: true }),
        this.loadNoteHistory(nextNoteId),
      ]);
    } catch (err) {
      if (token !== this.notesListToken) {
        return;
      }
      this.notesError = describeMemoryError(err);
      this.notesList = null;
      this.note = null;
      this.noteSync = null;
      this.history = [];
      this.attachmentDetail = null;
      this.attachmentError = null;
    } finally {
      if (token === this.notesListToken) {
        this.notesLoading = false;
      }
    }
  }

  private async loadNote(noteId: string, options?: { preserveDraft?: boolean }) {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.noteToken;
    this.noteLoading = true;
    this.noteError = null;
    try {
      const result = await requestMemoryNote(this.client, {
        agentId: this.selectedAgentId,
        noteId,
        query: this.props?.searchQuery.trim() || undefined,
      });
      if (token !== this.noteToken) {
        return;
      }
      const preserveDraft =
        options?.preserveDraft && this.note?.id === result.note.id && this.noteDirty;
      this.note = result.note;
      this.noteSync = result.sync ?? null;
      if (!preserveDraft) {
        this.noteDrafts = {
          ...this.noteDrafts,
          [result.note.id]: result.note.content,
        };
        this.noteTitleDrafts = {
          ...this.noteTitleDrafts,
          [result.note.id]: result.note.title,
        };
      }
      const visibleAttachmentIds = new Set(
        (result.note.attachments ?? []).map((attachment) => attachment.id ?? attachment.name),
      );
      if (
        this.selectedAttachmentId &&
        !visibleAttachmentIds.has(this.selectedAttachmentId) &&
        visibleAttachmentIds.size > 0
      ) {
        this.selectedAttachmentId = null;
        this.attachmentDetail = null;
        this.attachmentError = null;
      }
    } catch (err) {
      if (token !== this.noteToken) {
        return;
      }
      this.noteError = describeMemoryError(err);
      this.note = null;
      this.noteSync = null;
    } finally {
      if (token === this.noteToken) {
        this.noteLoading = false;
      }
    }
  }

  private async loadNoteHistory(noteId: string) {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.historyToken;
    this.historyLoading = true;
    this.historyError = null;
    try {
      const result = await requestMemoryNoteHistory(this.client, {
        agentId: this.selectedAgentId,
        noteId,
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

  private async loadAttachment(fileId: string) {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.attachmentToken;
    this.selectedAttachmentId = fileId;
    this.attachmentLoading = true;
    this.attachmentError = null;
    try {
      const result = await requestMemoryFile(this.client, {
        agentId: this.selectedAgentId,
        fileId,
        query: this.props?.searchQuery.trim() || undefined,
      });
      if (token !== this.attachmentToken) {
        return;
      }
      this.attachmentDetail = result.file;
    } catch (err) {
      if (token !== this.attachmentToken) {
        return;
      }
      this.attachmentError = describeMemoryError(err);
      this.attachmentDetail = null;
    } finally {
      if (token === this.attachmentToken) {
        this.attachmentLoading = false;
      }
    }
  }

  private async loadGraph(options?: {
    scope?: "global" | "local";
    focusNoteId?: string | null;
    includeAttachments?: boolean;
    depth?: number;
  }) {
    if (!this.client || !this.selectedAgentId) {
      this.graphData = null;
      this.graphError = null;
      this.graphLoading = false;
      return;
    }
    const requestedScope = options?.scope ?? this.graphScope;
    const focusNoteId = options?.focusNoteId ?? this.note?.id ?? this.selectedNoteId ?? null;
    const scope = requestedScope === "local" && focusNoteId ? "local" : "global";
    const includeAttachments = options?.includeAttachments ?? this.graphIncludeAttachments;
    const depth =
      scope === "local" ? Math.max(1, Math.round(options?.depth ?? this.graphDepth)) : 1;
    const token = ++this.graphToken;
    this.graphScope = scope;
    if (scope === "local") {
      this.graphDepth = depth;
    }
    this.graphLoading = true;
    this.graphError = null;
    try {
      const result = await requestMemoryGraph(this.client, {
        agentId: this.selectedAgentId,
        scope,
        query: this.props?.searchQuery.trim() || undefined,
        ...(focusNoteId ? { pageId: focusNoteId } : {}),
        direction: "both",
        depth,
        nodeLimit: scope === "local" ? 48 : 140,
        edgeLimit: scope === "local" ? 120 : 280,
        ...(includeAttachments ? { includeAttachments: true } : {}),
      });
      if (token !== this.graphToken) {
        return;
      }
      this.graphData = result;
    } catch (err) {
      if (token !== this.graphToken) {
        return;
      }
      this.graphError = describeMemoryError(err);
    } finally {
      if (token === this.graphToken) {
        this.graphLoading = false;
      }
    }
  }

  private async selectNote(
    noteId: string,
    options?: { preserveMode?: boolean; preservePane?: boolean },
  ) {
    this.selectedNoteId = noteId;
    if (!options?.preserveMode) {
      this.noteMode = "markdown";
    }
    if (!options?.preservePane) {
      this.mainPaneMode = "note";
    }
    emitMemoryTelemetry("ui_memory_note_opened", { noteId });
    await Promise.allSettled([
      this.loadNote(noteId, { preserveDraft: true }),
      this.loadNoteHistory(noteId),
      this.loadGraph({
        scope: this.graphScope,
        focusNoteId: noteId,
        includeAttachments: this.graphIncludeAttachments,
      }),
    ]);
  }

  private async saveNote() {
    if (!this.client || !this.selectedAgentId || !this.note) {
      return;
    }
    this.noteSaving = true;
    this.noteError = null;
    try {
      const result = await requestMemoryNoteUpdate(this.client, {
        agentId: this.selectedAgentId,
        noteId: this.note.id,
        title: this.currentNoteTitleDraft,
        content: this.currentNoteDraft,
      });
      const savedNoteId = result.note?.id ?? this.note.id;
      this.mutationSync = result.sync ?? null;
      this.noteDrafts = {
        ...this.noteDrafts,
        [savedNoteId]: this.currentNoteDraft,
      };
      this.noteTitleDrafts = {
        ...this.noteTitleDrafts,
        [savedNoteId]: this.currentNoteTitleDraft,
      };
      await Promise.allSettled([
        this.loadNotesList(),
        this.loadNote(savedNoteId, { preserveDraft: false }),
        this.loadNoteHistory(savedNoteId),
        this.loadGraph({
          scope: this.graphScope,
          focusNoteId: savedNoteId,
          includeAttachments: this.graphIncludeAttachments,
        }),
      ]);
      this.props?.onRefresh();
    } catch (err) {
      this.noteError = describeMemoryError(err);
    } finally {
      this.noteSaving = false;
    }
  }

  private async createNote() {
    if (!this.client || !this.selectedAgentId || !this.createTitle.trim()) {
      return;
    }
    this.noteSaving = true;
    this.noteError = null;
    try {
      const title = this.createTitle.trim();
      const result = await requestMemoryNoteUpdate(this.client, {
        agentId: this.selectedAgentId,
        title,
        content: `# ${title}\n\n`,
      });
      this.mutationSync = result.sync ?? null;
      this.createOpen = false;
      this.createTitle = "";
      await this.loadNotesList();
      const nextId =
        result.note?.id ??
        this.notesList?.notes.find((note) => note.title.trim() === title)?.id ??
        null;
      if (nextId) {
        await this.selectNote(nextId);
      }
      this.props?.onRefresh();
    } catch (err) {
      this.noteError = describeMemoryError(err);
    } finally {
      this.noteSaving = false;
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

  private findMatchingNote(
    notes: ReadonlyArray<{ id: string; title: string; slug?: string | null; path?: string | null }>,
    target: string,
  ) {
    const normalizedTarget = normalizeLookupKey(target);
    return (
      notes.find((note) => {
        const candidates = [
          note.id,
          note.title,
          note.slug ?? "",
          note.path ?? "",
          note.path ? note.path.replace(/^memory\//, "") : "",
          note.path ? (note.path.split("/").at(-1)?.replace(/\.md$/i, "") ?? "") : "",
        ];
        return candidates.some((candidate) => normalizeLookupKey(candidate) === normalizedTarget);
      }) ?? null
    );
  }

  private async findNoteIdByTarget(target: string) {
    const directMatch = this.findMatchingNote(this.notesList?.notes ?? [], target);
    if (directMatch) {
      return directMatch.id;
    }
    if (!this.client || !this.selectedAgentId) {
      return null;
    }
    try {
      const result = await requestMemoryNotesList(this.client, {
        agentId: this.selectedAgentId,
      });
      return this.findMatchingNote(result.notes, target)?.id ?? null;
    } catch {
      return null;
    }
  }

  private async openNoteTarget(target: string) {
    const noteId = await this.findNoteIdByTarget(target);
    if (noteId) {
      await this.selectNote(noteId, {
        preserveMode: true,
        preservePane: this.mainPaneMode === "graph",
      });
    }
  }

  private async openGraphNode(nodeId: string) {
    const graph = this.graphData ?? this.props?.memoryGraph ?? null;
    const node = graph?.nodes.find((entry) => entry.id === nodeId) ?? null;
    if (!node) {
      return;
    }
    if (node.kind === "attachment" && node.attachmentId) {
      await this.selectNote(node.pageId, {
        preserveMode: true,
        preservePane: true,
      });
      await this.loadAttachment(node.attachmentId);
      return;
    }
    await this.selectNote(node.pageId, {
      preserveMode: true,
      preservePane: true,
    });
  }

  private async focusGraphNode(nodeId: string) {
    const graph = this.graphData ?? this.props?.memoryGraph ?? null;
    const node = graph?.nodes.find((entry) => entry.id === nodeId) ?? null;
    if (!node) {
      return;
    }
    await this.selectNote(node.pageId, {
      preserveMode: true,
      preservePane: true,
    });
    this.mainPaneMode = "graph";
    await this.loadGraph({
      scope: "local",
      focusNoteId: node.pageId,
      includeAttachments: this.graphIncludeAttachments,
      depth: this.graphDepth,
    });
  }

  private handlePreviewClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const anchor = target.closest("a");
    const href = anchor?.getAttribute("href")?.trim() ?? "";
    if (!href.startsWith("memory-note://")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const targetNote = decodeURIComponent(href.slice("memory-note://".length));
    void this.openNoteTarget(targetNote);
  };

  private openAttachment() {
    const target = buildMemoryFileActionModel(this.attachmentDetail).openHref;
    if (!target) {
      return;
    }
    const link = document.createElement("a");
    link.href = target;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  }

  private downloadAttachment() {
    const download = buildMemoryFileActionModel(this.attachmentDetail).download;
    if (!download) {
      return;
    }
    downloadBase64(download.fileName, download.bytesBase64, download.mediaType);
  }

  private async openAttachmentPrimaryNote() {
    const pageId = buildMemoryFileActionModel(this.attachmentDetail).primaryPage?.pageId;
    if (!pageId) {
      return;
    }
    await this.selectNote(pageId, {
      preserveMode: true,
      preservePane: this.mainPaneMode === "graph",
    });
  }

  private async focusAttachmentPrimaryNote() {
    const pageId = buildMemoryFileActionModel(this.attachmentDetail).primaryPage?.pageId;
    if (!pageId) {
      return;
    }
    await this.selectNote(pageId, { preserveMode: true });
    this.mainPaneMode = "graph";
    await this.loadGraph({
      scope: "local",
      focusNoteId: pageId,
      includeAttachments: this.graphIncludeAttachments,
      depth: this.graphDepth,
    });
  }

  private renderHeader(text: ReturnType<typeof memoryText>) {
    const agents = this.props?.agentsList?.agents ?? [];
    const visibleNotes = this.notesList?.notes.length ?? 0;
    return html`
      <section class="alisio-memory-toolbar">
        <div class="alisio-memory-toolbar__copy">
          <div class="alisio-memory-toolbar__title-row">
            <h2>${text.views.wiki}</h2>
            <span class="alisio-memory-toolbar__count">
              ${String(visibleNotes)} ${text.notesListTitle.toLowerCase()}
            </span>
          </div>
          <div class="alisio-memory-toolbar__tabs">
            <button
              type="button"
              class="btn btn--sm ${this.mainPaneMode === "note" ? "primary" : ""}"
              @click=${() => (this.mainPaneMode = "note")}
            >
              ${text.views.wiki}
            </button>
            <button
              type="button"
              class="btn btn--sm ${this.mainPaneMode === "graph" ? "primary" : ""}"
              @click=${() => {
                this.mainPaneMode = "graph";
                void this.loadGraph({
                  scope: this.graphScope,
                  focusNoteId: this.note?.id ?? this.selectedNoteId,
                  includeAttachments: this.graphIncludeAttachments,
                  depth: this.graphDepth,
                });
              }}
            >
              ${text.views.graph}
            </button>
          </div>
        </div>
        <div class="alisio-memory-toolbar__controls">
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
              void this.reloadAll();
            }}
          >
            ${icons.refresh}
          </button>
        </div>
      </section>
    `;
  }

  private renderExplorerNote(
    note: MemoryNoteListEntry,
    text: ReturnType<typeof memoryText>,
    depth: number,
  ) {
    const isActive = this.selectedNoteId === note.id;
    const subtitle = note.path?.trim()?.split("/").at(-1) ?? formatNoteSubtitle(text, note);
    return html`
      <button
        type="button"
        class="alisio-memory-tree__note ${isActive ? "is-active" : ""}"
        aria-current=${isActive ? "true" : "false"}
        style=${`--tree-depth:${String(depth)}`}
        @click=${() => void this.selectNote(note.id)}
      >
        <span class="alisio-memory-tree__glyph">${icons.fileText}</span>
        <span class="alisio-memory-tree__note-copy">
          <strong>${note.title}</strong>
          <span>${subtitle}</span>
        </span>
        <span class="alisio-memory-tree__note-meta">
          ${typeof note.backlinks === "number" ? `${note.backlinks}` : ""}
        </span>
      </button>
    `;
  }

  private renderExplorerFolderNode(
    node: NoteExplorerTreeNode,
    text: ReturnType<typeof memoryText>,
    depth = 0,
  ): TemplateResult {
    return html`
      <details class="alisio-memory-tree__folder" open>
        <summary
          class="alisio-memory-tree__folder-summary"
          style=${`--tree-depth:${String(depth)}`}
        >
          <span class="alisio-memory-tree__chevron">${icons.chevronRight}</span>
          <span class="alisio-memory-tree__glyph">${icons.folder}</span>
          <span class="alisio-memory-tree__folder-label">${node.label}</span>
          <span class="alisio-memory-tree__folder-meta">${String(node.noteCount)}</span>
        </summary>
        <div class="alisio-memory-tree__children">
          ${node.folders.map(
            (child): TemplateResult => this.renderExplorerFolderNode(child, text, depth + 1),
          )}
          ${node.notes.map((note) => this.renderExplorerNote(note, text, depth + 1))}
        </div>
      </details>
    `;
  }

  private renderExplorer(text: ReturnType<typeof memoryText>) {
    const tree = buildNoteExplorerTree(this.notesList?.notes ?? []);
    const emptyAction = html`
      <button class="btn btn--sm primary" @click=${() => (this.createOpen = true)}>
        ${text.notesCreate}
      </button>
    `;
    return html`
      <aside class="alisio-memory-notes__explorer">
        <section class="alisio-memory-vault">
          <div class="alisio-memory-vault__header">
            <h3>${text.notesListTitle}</h3>
            <button
              class="btn btn--icon btn--ghost"
              title=${text.notesCreate}
              aria-label=${text.notesCreate}
              @click=${() => (this.createOpen = !this.createOpen)}
            >
              ${icons.plus}
            </button>
          </div>
          ${this.createOpen
            ? html`
                <div class="alisio-memory-native__composer alisio-memory-vault__composer">
                  <label class="field">
                    <span class="sr-only">${text.notesCreate}</span>
                    <input
                      .value=${this.createTitle}
                      placeholder=${text.notesCreatePlaceholder}
                      @input=${(event: Event) =>
                        (this.createTitle = (event.target as HTMLInputElement).value)}
                    />
                  </label>
                  <div class="alisio-memory-runtime__actions">
                    <button class="btn btn--sm" @click=${() => (this.createOpen = false)}>
                      ${text.cancelCreate}
                    </button>
                    <button
                      class="btn btn--sm primary"
                      ?disabled=${!this.createTitle.trim() || this.noteSaving}
                      @click=${() => void this.createNote()}
                    >
                      ${text.notesCreateConfirm}
                    </button>
                  </div>
                </div>
              `
            : nothing}
          ${this.notesError
            ? renderMemoryNotice(this.notesError)
            : this.notesLoading && !this.notesList
              ? renderExplorerSkeleton()
              : (this.notesList?.notes.length ?? 0) === 0
                ? renderMemoryPlaceholder({
                    icon: icons.folder,
                    label: text.notesListTitle,
                    action: emptyAction,
                    compact: true,
                  })
                : html`
                    <div class="alisio-memory-tree">
                      ${tree.folders.map((node) => this.renderExplorerFolderNode(node, text))}
                      ${tree.notes.map((note) => this.renderExplorerNote(note, text, 0))}
                    </div>
                  `}
        </section>
      </aside>
    `;
  }

  private renderBacklinks(
    text: ReturnType<typeof memoryText>,
    backlinks: MemoryNoteBacklink[] | null | undefined,
  ) {
    const items = backlinks ?? [];
    if (items.length === 0) {
      return nothing;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.noteBacklinks}</h2></div>
        <div class="alisio-memory-file-list">
          ${items.map(
            (item) => html`
              <button
                type="button"
                class="alisio-memory-file"
                @click=${() =>
                  item.id
                    ? void this.selectNote(item.id, { preserveMode: true })
                    : this.openNoteTarget(item.path ?? item.title)}
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
      </section>
    `;
  }

  private renderAttachments(
    text: ReturnType<typeof memoryText>,
    attachments: MemoryNoteAttachment[] | null | undefined,
  ) {
    const items = attachments ?? [];
    if (items.length === 0) {
      return nothing;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.filesTitle}</h2></div>
        <div class="alisio-memory-file-list">
          ${items.map((attachment) => {
            const attachmentId = attachment.id ?? attachment.name;
            return html`
              <button
                type="button"
                class="alisio-memory-file ${this.selectedAttachmentId === attachmentId
                  ? "is-active"
                  : ""}"
                @click=${() => void this.loadAttachment(attachmentId)}
              >
                <span class="alisio-memory-file__copy">
                  <span class="alisio-memory-file__title">${attachment.name}</span>
                  <span class="alisio-memory-file__meta">
                    ${attachment.provenanceSummary?.trim() ||
                    attachment.mediaType?.trim() ||
                    text.na}
                  </span>
                </span>
                <span class="alisio-memory-file__status">
                  ${formatTimestamp(attachment.updatedAt) ?? text.na}
                </span>
              </button>
            `;
          })}
        </div>
      </section>
    `;
  }

  private renderClaims(
    text: ReturnType<typeof memoryText>,
    claims: MemoryClaimItem[] | null | undefined,
  ) {
    const items = claims ?? [];
    if (items.length === 0) {
      return nothing;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.noteClaims}</h2></div>
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
                                ${item.title?.trim() || item.source?.trim() || text.noteEvidence}
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
      </section>
    `;
  }

  private renderEvidence(
    text: ReturnType<typeof memoryText>,
    evidence: MemoryEvidenceItem[] | null | undefined,
  ) {
    const items = evidence ?? [];
    if (items.length === 0) {
      return nothing;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.noteEvidence}</h2></div>
        <div class="alisio-memory-native__stack">
          ${items.map(
            (item) => html`
              <article class="alisio-memory-runtime">
                <strong>${item.title?.trim() || item.source?.trim() || text.noteEvidence}</strong>
                <span class="alisio-memory-runtime__meta-detail">
                  ${item.excerpt?.trim() || text.na}
                </span>
                ${item.source?.trim() && item.source !== item.title?.trim()
                  ? html`<span class="alisio-memory-runtime__meta-detail">${item.source}</span>`
                  : nothing}
                ${item.provenance?.length
                  ? renderProvenanceRows(item.provenance, text.noteProvenanceEmpty)
                  : nothing}
              </article>
            `,
          )}
        </div>
      </section>
    `;
  }

  private renderRevision(text: ReturnType<typeof memoryText>) {
    const revision = this.note?.revision ?? null;
    if (!revision) {
      return nothing;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.noteRevision}</h2></div>
        <article class="alisio-memory-runtime__meta-item">
          <span class="alisio-memory-runtime__meta-label">
            ${revision.summary?.trim() || revision.eventId || text.noteRevision}
          </span>
          <strong class="alisio-memory-runtime__meta-value">
            ${String(revision.lamport ?? text.na)}
          </strong>
          <span class="alisio-memory-runtime__meta-detail">
            ${[formatTimestamp(revision.updatedAt), revision.author].filter(Boolean).join(" · ") ||
            text.na}
          </span>
          ${revision.eventId
            ? html`<span class="alisio-memory-runtime__meta-detail">${revision.eventId}</span>`
            : nothing}
        </article>
      </section>
    `;
  }

  private renderHistory(text: ReturnType<typeof memoryText>) {
    if (this.historyLoading && this.history.length === 0) {
      return html`
        <section class="alisio-memory-group">
          <div class="alisio-memory-group__header"><h2>${text.noteHistory}</h2></div>
          ${renderSkeletonLines(["medium", "short", "medium"], { compact: true })}
        </section>
      `;
    }
    if (this.historyError) {
      return html`
        <section class="alisio-memory-group">
          <div class="alisio-memory-group__header"><h2>${text.noteHistory}</h2></div>
          ${renderMemoryNotice(this.historyError)}
        </section>
      `;
    }
    if (this.history.length === 0) {
      return nothing;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.noteHistory}</h2></div>
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
                      <span class="alisio-memory-runtime__meta-detail">${entry.diffSummary}</span>
                    `
                  : nothing}
              </article>
            `,
          )}
        </div>
      </section>
    `;
  }

  private renderContext(text: ReturnType<typeof memoryText>) {
    const preview = this.note?.contextPreview ?? null;
    if (!preview) {
      return nothing;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.noteContext}</h2></div>
        <div class="alisio-memory-native__stack">
          <div class="alisio-memory-runtime__meta-item">
            <span class="alisio-memory-runtime__meta-label">${text.whySurfaced}</span>
            <span class="alisio-memory-runtime__meta-detail">
              ${buildContextPreviewSummary(text, this.note, preview.summary)}
            </span>
            ${renderReasonTags(preview.reasonTags)}
            ${this.tracesEnabled && (preview.traceId || preview.trace)
              ? html`
                  <div class="alisio-memory-runtime__actions">
                    <button
                      class="btn btn--sm"
                      @click=${() =>
                        void this.openTrace({
                          label: this.note?.title ?? text.traceTitle,
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
      </section>
    `;
  }

  private renderAttachmentPreview(text: ReturnType<typeof memoryText>) {
    const detail = this.attachmentDetail;
    const preview = buildMemoryFilePreviewModel(detail);
    const primaryPage = buildMemoryFileActionModel(detail).primaryPage;
    if (this.attachmentLoading) {
      return html`
        <section class="alisio-memory-group">
          <div class="alisio-memory-group__header"><h2>${text.filesTitle}</h2></div>
          ${renderSkeletonLines(["medium", "long", "full"], { compact: true })}
        </section>
      `;
    }
    if (this.attachmentError) {
      return html`
        <section class="alisio-memory-group">
          <div class="alisio-memory-group__header"><h2>${text.filesTitle}</h2></div>
          ${renderMemoryNotice(this.attachmentError)}
        </section>
      `;
    }
    if (!detail) {
      return nothing;
    }
    return html`
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.filesTitle}</h2></div>
        <article class="alisio-memory-runtime">
          <div class="alisio-memory-runtime__header">
            <div class="alisio-memory-runtime__copy">
              <h3>${detail.name}</h3>
              <p>${detail.summary?.trim() || detail.provenanceSummary?.trim() || text.na}</p>
            </div>
            <div class="alisio-memory-runtime__actions">
              <button class="btn btn--sm" @click=${() => this.openAttachment()}>
                ${text.filesOpen}
              </button>
              <button class="btn btn--sm" @click=${() => this.downloadAttachment()}>
                ${text.filesDownload}
              </button>
            </div>
          </div>
          <div class="alisio-memory-runtime__stats">
            <div class="alisio-memory-stat">
              <span class="alisio-memory-stat__label">${text.filesMediaType}</span>
              <strong class="alisio-memory-stat__value">${detail.mediaType}</strong>
            </div>
            <div class="alisio-memory-stat">
              <span class="alisio-memory-stat__label">${text.filesSize}</span>
              <strong class="alisio-memory-stat__value">
                ${formatBytes(detail.size) ?? text.na}
              </strong>
            </div>
            <div class="alisio-memory-stat">
              <span class="alisio-memory-stat__label">${text.filesHash}</span>
              <strong class="alisio-memory-stat__value">${detail.sha256}</strong>
            </div>
          </div>
          <div class="alisio-memory-preview">
            <span class="alisio-memory-preview__label">${text.preview}</span>
            ${renderMemoryFilePreview({
              preview,
              text: {
                previewLabel: text.preview,
                previewEmpty: text.previewEmpty,
                previewUnavailable: text.filesPreviewUnavailable,
                previewTruncated: text.filesPreviewTruncated,
              },
            })}
          </div>
          ${primaryPage
            ? html`
                <div class="alisio-memory-runtime__actions">
                  <button class="btn btn--sm" @click=${() => void this.openAttachmentPrimaryNote()}>
                    ${text.filesOpenPage}
                  </button>
                  <button
                    class="btn btn--sm"
                    @click=${() => void this.focusAttachmentPrimaryNote()}
                  >
                    ${text.filesFocusGraph}
                  </button>
                </div>
              `
            : nothing}
          <section class="alisio-memory-group">
            <div class="alisio-memory-group__header"><h2>${text.filesRelatedPages}</h2></div>
            ${(detail.relatedPages?.length ?? 0) === 0
              ? html`<div class="alisio-memory-empty">${text.none}</div>`
              : html`
                  <div class="alisio-memory-file-list">
                    ${detail.relatedPages.map(
                      (page) => html`
                        <button
                          type="button"
                          class="alisio-memory-file"
                          @click=${() =>
                            void this.selectNote(page.pageId, {
                              preserveMode: true,
                              preservePane: this.mainPaneMode === "graph",
                            })}
                        >
                          <span class="alisio-memory-file__copy">
                            <span class="alisio-memory-file__title">${page.title}</span>
                            <span class="alisio-memory-file__meta">
                              ${page.path || page.pageId}
                            </span>
                          </span>
                          <span class="alisio-memory-file__status">
                            ${page.relation === "attached"
                              ? text.filesAttached
                              : page.relation === "mentioned"
                                ? text.filesMentioned
                                : text.filesUnlinked}
                          </span>
                        </button>
                      `,
                    )}
                  </div>
                `}
          </section>
          <section class="alisio-memory-group">
            <div class="alisio-memory-group__header"><h2>${text.filesProvenance}</h2></div>
            ${renderProvenanceRows(detail.provenance, text.noteProvenanceEmpty)}
          </section>
        </article>
      </section>
    `;
  }

  private renderNoteBody(text: ReturnType<typeof memoryText>) {
    if (this.noteLoading && !this.note) {
      return renderNoteSkeleton();
    }
    if (this.noteError) {
      return renderMemoryNotice(this.noteError);
    }
    if (!this.note) {
      return renderMemoryPlaceholder({
        icon: icons.fileText,
        label: text.views.wiki,
      });
    }
    const revisionTime = formatTimestamp(this.note.revision?.updatedAt);
    const attachmentCount = this.note.attachments?.length ?? 0;
    const backlinkCount = this.note.backlinks?.length ?? 0;
    return html`
      <article class="alisio-memory-note">
        <header class="alisio-memory-note__header">
          <div class="alisio-memory-note__copy">
            <div class="alisio-memory-note__eyebrow">
              ${this.note.path?.trim() || text.notePath}
            </div>
            <label class="sr-only" for="memory-note-title">${text.notesCreatePlaceholder}</label>
            <input
              id="memory-note-title"
              class="alisio-memory-note__title-input"
              .value=${this.currentNoteTitleDraft}
              @input=${(event: Event) => {
                if (!this.note?.id) {
                  return;
                }
                this.noteTitleDrafts = {
                  ...this.noteTitleDrafts,
                  [this.note.id]: (event.target as HTMLInputElement).value,
                };
              }}
            />
            <div class="alisio-memory-note__meta">
              ${[
                revisionTime ? `${text.noteUpdated}: ${revisionTime}` : null,
                attachmentCount > 0
                  ? `${String(attachmentCount)} ${text.filesTitle.toLowerCase()}`
                  : null,
                backlinkCount > 0
                  ? `${String(backlinkCount)} ${text.noteBacklinks.toLowerCase()}`
                  : null,
              ]
                .filter(Boolean)
                .map((item) => html`<span>${item}</span>`)}
            </div>
            ${renderReasonTags(this.note.reasonTags)}
          </div>
          <div class="alisio-memory-note__actions">
            <div class="alisio-memory-note__mode-switch">
              <button
                class="btn btn--sm ${this.noteMode === "markdown" ? "primary" : ""}"
                @click=${() => (this.noteMode = "markdown")}
              >
                ${text.noteMarkdown}
              </button>
              <button
                class="btn btn--sm ${this.noteMode === "reading" ? "primary" : ""}"
                @click=${() => (this.noteMode = "reading")}
              >
                ${text.noteReading}
              </button>
            </div>
            <div class="alisio-memory-note__utility-actions">
              <button
                class="btn btn--sm"
                @click=${() => {
                  this.mainPaneMode = "graph";
                  void this.loadGraph({
                    scope: "local",
                    focusNoteId: this.note?.id ?? this.selectedNoteId,
                    includeAttachments: this.graphIncludeAttachments,
                    depth: this.graphDepth,
                  });
                }}
              >
                ${text.views.graph}
              </button>
              ${this.renderTraceAction(text, {
                label: this.note.title,
                traceId: this.note.traceId,
                trace: this.note.trace,
                summary: this.note.traceSummary,
                reasonTags: this.note.reasonTags,
              })}
              <button
                class="btn btn--sm"
                ?disabled=${!this.noteDirty || this.noteSaving}
                @click=${() => {
                  if (!this.note?.id) {
                    return;
                  }
                  this.noteDrafts = { ...this.noteDrafts, [this.note.id]: this.note.content };
                  this.noteTitleDrafts = {
                    ...this.noteTitleDrafts,
                    [this.note.id]: this.note.title,
                  };
                }}
              >
                ${text.reset}
              </button>
              <button
                class="btn btn--sm primary"
                ?disabled=${!this.noteDirty || this.noteSaving}
                @click=${() => void this.saveNote()}
              >
                ${this.noteSaving ? text.saving : text.save}
              </button>
            </div>
          </div>
        </header>

        ${this.noteMode === "markdown"
          ? html`
              <div class="alisio-memory-native__editor">
                <label class="sr-only" for="memory-note-markdown">${text.noteMarkdown}</label>
                <textarea
                  id="memory-note-markdown"
                  class="alisio-memory-note__textarea"
                  .value=${this.currentNoteDraft}
                  @input=${(event: Event) => {
                    if (!this.note?.id) {
                      return;
                    }
                    this.noteDrafts = {
                      ...this.noteDrafts,
                      [this.note.id]: (event.target as HTMLTextAreaElement).value,
                    };
                  }}
                ></textarea>
                ${this.noteDirty
                  ? html`<div class="alisio-memory-note__dirty">${text.unsaved}</div>`
                  : nothing}
              </div>
            `
          : html`
              <div class="alisio-memory-preview">
                <span class="alisio-memory-preview__label">${text.noteReading}</span>
                <div
                  class="alisio-memory-preview__body sidebar-markdown memory-note__article-markdown"
                  @click=${this.handlePreviewClick}
                >
                  ${renderMarkdownPreview(this.note.content)}
                </div>
              </div>
            `}
      </article>
    `;
  }

  private renderNoteMeta(text: ReturnType<typeof memoryText>) {
    if (!this.note && !this.attachmentDetail && !this.attachmentLoading && !this.attachmentError) {
      return nothing;
    }
    const hasProvenance = hasProvenanceRows(this.note?.provenance);
    return html`
      <div class="alisio-memory-sidebar__stack">
        ${this.renderAttachments(text, this.note?.attachments)}
        ${this.renderAttachmentPreview(text)} ${this.renderBacklinks(text, this.note?.backlinks)}
        ${this.renderContext(text)} ${this.renderRevision(text)} ${this.renderHistory(text)}
        ${this.renderClaims(text, this.note?.claims)}
        ${this.renderEvidence(text, this.note?.evidence)}
        ${hasProvenance
          ? html`
              <section class="alisio-memory-group alisio-memory-sidebar__group">
                <div class="alisio-memory-group__header"><h2>${text.noteProvenance}</h2></div>
                ${renderProvenanceRows(this.note?.provenance, text.noteProvenanceEmpty)}
              </section>
            `
          : nothing}
      </div>
    `;
  }

  private renderGraphView(text: ReturnType<typeof memoryText>, options?: { compact?: boolean }) {
    const resolvedGraph = this.graphData ?? this.props?.memoryGraph ?? null;
    const resolvedError = resolvedGraph
      ? null
      : (this.graphError ?? this.props?.memoryGraphError ?? null);
    const resolvedLoading =
      !resolvedGraph && (this.graphLoading || this.props?.memoryGraphLoading || false);
    const resolvedScope = resolvedGraph?.scope ?? this.graphScope;
    return html`
      <alisio-memory-graph-view
        .graph=${resolvedGraph}
        .loading=${resolvedLoading}
        .error=${resolvedError}
        .compact=${options?.compact ?? false}
        .activeScope=${resolvedScope}
        .includeAttachments=${this.graphIncludeAttachments}
        .localDepth=${this.graphDepth}
        .localAvailable=${Boolean(
          this.note?.id ?? this.selectedNoteId ?? resolvedGraph?.focus?.pageId,
        )}
        .text=${{
          graphTitle: text.graphTitle,
          graphDescription: text.viewDescriptions.graph,
          graphLoading: text.graphLoading,
          graphUnavailable: text.graphUnavailable,
          graphEmpty: text.graphEmpty,
          graphFocus: text.graphFocus,
          graphGlobal: text.graphGlobal,
          graphLocal: text.graphLocal,
          graphDepth: text.graphDepth,
          graphResetView: text.graphResetView,
          graphNeighbourhood: text.graphNeighbourhood,
          graphOrphans: text.graphOrphans,
          graphBranches: text.graphBranches,
          graphBranchesEmpty: text.graphBranchesEmpty,
          graphEdgeReason: text.graphEdgeReason,
          graphEdgeReasonEmpty: text.graphEdgeReasonEmpty,
          graphFilterRelations: text.graphFilterRelations,
          graphFilterTags: text.graphFilterTags,
          graphGroups: text.graphGroups,
          graphColorBy: text.graphColorBy,
          graphGroupNone: text.graphGroupNone,
          graphGroupFolder: text.graphGroupFolder,
          graphGroupTag: text.graphGroupTag,
          graphGroupKind: text.graphGroupKind,
          graphGroupSource: text.graphGroupSource,
          graphGroupNote: text.graphGroupNote,
          graphGroupAttachment: text.graphGroupAttachment,
          graphContextMenuOpen: text.graphContextMenuOpen,
          graphContextMenuCenter: text.graphContextMenuCenter,
          graphContextMenuLocal: text.graphContextMenuLocal,
          graphDisplay: text.graphDisplay,
          graphArrows: text.graphArrows,
          graphTextFadeThreshold: text.graphTextFadeThreshold,
          graphNodeSize: text.graphNodeSize,
          graphLinkThickness: text.graphLinkThickness,
          graphForces: text.graphForces,
          graphCenterForce: text.graphCenterForce,
          graphRepelForce: text.graphRepelForce,
          graphLinkForce: text.graphLinkForce,
          graphLinkDistance: text.graphLinkDistance,
          graphNodesCount: text.graphNodesCount,
          graphEdgesCount: text.graphEdgesCount,
          graphTruncated: text.graphTruncated,
          graphSource: text.graphSource,
          graphTarget: text.graphTarget,
          graphRelationType: text.graphRelationType,
          graphClusters: text.graphClusters,
          graphSuggestions: text.graphSuggestions,
          graphSpotlight: text.graphSpotlight,
          graphIncoming: text.graphIncoming,
          graphOutgoing: text.graphOutgoing,
          graphDegree: text.graphDegree,
          graphZoomIn: text.graphZoomIn,
          graphZoomOut: text.graphZoomOut,
          graphCenterFocus: text.graphCenterFocus,
          graphCanvasHint: text.graphCanvasHint,
          graphShowAttachments: text.graphShowAttachments,
          graphAliases: text.graphAliases,
          graphTags: text.graphTags,
          graphRelations: text.graphRelations,
          searchPlaceholder: text.searchPlaceholder,
          wikiOpenPage: text.noteOpen,
          none: text.none,
          ready: text.ready,
          unavailable: text.unavailable,
          builtin: text.builtin,
          localFirst: text.localFirst,
          localOnly: text.localOnly,
          cloudSyncEnabled: text.cloudSyncEnabled,
          cloudSyncUnavailable: text.cloudSyncUnavailable,
          cloudSyncError: text.cloudSyncError,
        }}
        @alisio-memory-graph-open-node=${(event: CustomEvent<{ nodeId: string }>) => {
          const nodeId = event.detail?.nodeId?.trim();
          if (nodeId) {
            void this.openGraphNode(nodeId);
          }
        }}
        @alisio-memory-graph-focus-node=${(event: CustomEvent<{ nodeId: string }>) => {
          const nodeId = event.detail?.nodeId?.trim();
          if (nodeId) {
            void this.focusGraphNode(nodeId);
          }
        }}
        @alisio-memory-graph-scope-change=${(event: CustomEvent<{ scope: "global" | "local" }>) => {
          const scope = event.detail?.scope;
          if (!scope) {
            return;
          }
          void this.loadGraph({
            scope,
            focusNoteId: this.note?.id ?? this.selectedNoteId,
            includeAttachments: this.graphIncludeAttachments,
          });
        }}
        @alisio-memory-graph-attachments-change=${(
          event: CustomEvent<{ includeAttachments: boolean }>,
        ) => {
          this.graphIncludeAttachments = Boolean(event.detail?.includeAttachments);
          void this.loadGraph({
            scope: this.graphScope,
            focusNoteId: this.note?.id ?? this.selectedNoteId,
            includeAttachments: this.graphIncludeAttachments,
            depth: this.graphDepth,
          });
        }}
        @alisio-memory-graph-depth-change=${(event: CustomEvent<{ depth: number }>) => {
          const nextDepth = Number(event.detail?.depth);
          if (!Number.isFinite(nextDepth)) {
            return;
          }
          this.graphDepth = nextDepth;
          void this.loadGraph({
            scope: "local",
            focusNoteId: this.note?.id ?? this.selectedNoteId,
            includeAttachments: this.graphIncludeAttachments,
            depth: nextDepth,
          });
        }}
      ></alisio-memory-graph-view>
    `;
  }

  private renderGraphWorkspace(text: ReturnType<typeof memoryText>) {
    const focusLabel = this.note?.title?.trim() || this.selectedNoteId || text.views.graph;
    return html`
      <section class="alisio-memory-graph-workspace">
        <div class="alisio-memory-graph-workspace__toolbar">
          <div class="alisio-memory-graph-workspace__copy">
            <h3>${focusLabel}</h3>
          </div>
          <div class="alisio-memory-graph-workspace__controls">
            <button class="btn btn--sm" @click=${() => (this.mainPaneMode = "note")}>
              ${text.views.wiki}
            </button>
          </div>
        </div>
        ${this.renderGraphView(text)}
      </section>
    `;
  }

  private hasSidePaneContent() {
    return (
      this.attachmentLoading ||
      Boolean(this.attachmentError) ||
      Boolean(this.attachmentDetail) ||
      (this.note?.attachments?.length ?? 0) > 0 ||
      (this.note?.backlinks?.length ?? 0) > 0 ||
      Boolean(this.note?.contextPreview) ||
      Boolean(this.note?.revision) ||
      this.historyLoading ||
      Boolean(this.historyError) ||
      this.history.length > 0 ||
      (this.note?.claims?.length ?? 0) > 0 ||
      (this.note?.evidence?.length ?? 0) > 0 ||
      hasProvenanceRows(this.note?.provenance)
    );
  }

  private renderSidePane(text: ReturnType<typeof memoryText>) {
    if (!this.hasSidePaneContent()) {
      return nothing;
    }
    return html`
      <aside class="alisio-memory-sidebar">
        <div class="alisio-memory-sidebar__toolbar">
          <button
            type="button"
            class="btn btn--sm ${this.mainPaneMode === "note" ? "primary" : ""}"
            @click=${() => {
              this.mainPaneMode = "note";
            }}
          >
            ${text.workspaceInspector}
          </button>
          <button
            type="button"
            class="btn btn--sm ${this.mainPaneMode === "graph" ? "primary" : ""}"
            @click=${() => {
              this.mainPaneMode = "graph";
              void this.loadGraph({
                scope: this.graphScope,
                focusNoteId: this.note?.id ?? this.selectedNoteId,
                includeAttachments: this.graphIncludeAttachments,
                depth: this.graphDepth,
              });
            }}
          >
            ${text.workspaceGraphPane}
          </button>
        </div>
        <div class="alisio-memory-sidebar__body">${this.renderNoteMeta(text)}</div>
      </aside>
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
          ? renderSkeletonLines(["medium", "long", "full"], { compact: true })
          : this.traceError
            ? renderMemoryNotice(this.traceError)
            : !this.traceData
              ? renderMemoryPlaceholder({
                  icon: icons.brain,
                  label: text.traceTitle,
                  compact: true,
                })
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

    return html`
      <style>
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
          gap: 12px;
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
          gap: 8px;
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
        .alisio-memory-notice {
          margin-bottom: 12px;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          background: color-mix(in srgb, var(--surface-elevated) 82%, transparent);
          color: var(--text-muted);
          font-size: 0.9rem;
          line-height: 1.45;
        }
        .alisio-memory-notice.is-danger {
          border-color: color-mix(in srgb, var(--danger) 32%, transparent);
          background: color-mix(in srgb, var(--danger) 8%, var(--surface-panel));
          color: color-mix(in srgb, var(--danger) 74%, white);
        }
        .alisio-memory-placeholder {
          display: grid;
          justify-items: center;
          align-content: center;
          gap: 12px;
          min-height: 240px;
          padding: 24px;
          border-radius: 20px;
          border: 1px dashed color-mix(in srgb, var(--border-subtle) 78%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 96%, transparent);
          text-align: center;
        }
        .alisio-memory-placeholder.is-compact {
          min-height: 140px;
          padding: 20px 16px;
        }
        .alisio-memory-placeholder__icon {
          display: inline-flex;
          width: 36px;
          height: 36px;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          opacity: 0.82;
        }
        .alisio-memory-placeholder strong {
          font-size: 0.95rem;
          font-weight: 600;
        }
        .alisio-memory-placeholder span:last-of-type {
          color: var(--text-muted);
        }
        .alisio-memory-skeleton-stack {
          display: grid;
          gap: 12px;
        }
        .alisio-memory-skeleton-copy {
          margin-top: 8px;
        }
        .alisio-memory-note--skeleton {
          min-height: 360px;
        }
        .alisio-memory-utilitybar {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 12px;
          align-items: center;
          margin-top: 16px;
          padding: 10px 12px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 96%, transparent);
        }
        .alisio-memory-utilitybar__meta,
        .alisio-memory-utilitybar__actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .alisio-memory-utilitybar__pill {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--surface-elevated) 84%, transparent);
          color: var(--text-muted);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }
        .alisio-memory-utilitybar__select {
          min-width: 92px;
        }
        .alisio-memory-utilitybar__message {
          grid-column: 1 / -1;
          color: var(--text-muted);
          font-size: 0.82rem;
          line-height: 1.4;
        }
        .alisio-memory-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 14px;
          padding: 14px 16px;
          border-radius: 18px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 98%, transparent);
        }
        .alisio-memory-toolbar__copy {
          display: grid;
          gap: 10px;
          min-width: min(100%, 340px);
        }
        .alisio-memory-note__eyebrow {
          color: var(--text-muted);
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .alisio-memory-toolbar__title-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .alisio-memory-toolbar__title-row h2,
        .alisio-memory-vault__header h3 {
          margin: 0;
        }
        .alisio-memory-sidebar__pane-head p {
          margin: 0;
          color: var(--text-muted);
          line-height: 1.55;
        }
        .alisio-memory-toolbar__count {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--surface-elevated) 84%, transparent);
          color: var(--text-muted);
          font-size: 0.82rem;
          font-weight: 600;
        }
        .alisio-memory-toolbar__controls {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-left: auto;
        }
        .alisio-memory-toolbar__tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .alisio-memory-group__lede {
          margin: 6px 0 0;
          color: var(--text-muted);
          line-height: 1.55;
        }
        .alisio-memory-layout {
          display: grid;
          grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(320px, 380px);
          gap: 16px;
          align-items: start;
        }
        .alisio-memory-layout.is-no-sidebar {
          grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
        }
        .alisio-memory-layout.is-graph-mode {
          grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(300px, 360px);
        }
        .alisio-memory-layout.is-graph-mode.is-no-sidebar {
          grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
        }
        .alisio-memory-notes__explorer {
          position: sticky;
          top: 12px;
        }
        .alisio-memory-vault {
          display: grid;
          gap: 12px;
          padding: 14px;
          border-radius: 18px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 98%, transparent);
        }
        .alisio-memory-vault__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .alisio-memory-vault__composer {
          padding-top: 6px;
          border-top: 1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent);
        }
        .alisio-memory-tree {
          display: grid;
          gap: 4px;
        }
        .alisio-memory-tree__folder {
          display: grid;
          gap: 4px;
        }
        .alisio-memory-tree__folder > summary {
          list-style: none;
        }
        .alisio-memory-tree__folder > summary::-webkit-details-marker {
          display: none;
        }
        .alisio-memory-tree__folder-summary,
        .alisio-memory-tree__note {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px 10px;
          padding-left: calc(10px + var(--tree-depth, 0) * 14px);
          border-radius: 12px;
          border: 0;
          background: transparent;
          color: inherit;
          text-align: left;
        }
        .alisio-memory-tree__folder-summary {
          cursor: pointer;
          color: var(--text-muted);
          font-size: 0.9rem;
          font-weight: 600;
        }
        .alisio-memory-tree__folder[open]
          > .alisio-memory-tree__folder-summary
          .alisio-memory-tree__chevron {
          transform: rotate(90deg);
        }
        .alisio-memory-tree__children {
          display: grid;
          gap: 4px;
        }
        .alisio-memory-tree__chevron,
        .alisio-memory-tree__glyph {
          display: inline-flex;
          width: 16px;
          height: 16px;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          flex: none;
        }
        .alisio-memory-tree__chevron {
          transition: transform 140ms ease;
        }
        .alisio-memory-tree__folder-label,
        .alisio-memory-tree__note-copy {
          min-width: 0;
          flex: 1 1 auto;
        }
        .alisio-memory-tree__folder-meta,
        .alisio-memory-tree__note-meta {
          color: var(--text-muted);
          font-size: 0.78rem;
          flex: none;
        }
        .alisio-memory-tree__note {
          cursor: pointer;
          transition:
            background 140ms ease,
            color 140ms ease;
        }
        .alisio-memory-tree__note:hover,
        .alisio-memory-tree__folder-summary:hover {
          background: color-mix(in srgb, var(--surface-elevated) 82%, transparent);
        }
        .alisio-memory-tree__note.is-active {
          background: color-mix(in srgb, var(--accent-primary) 18%, var(--surface-panel));
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 34%, transparent);
        }
        .alisio-memory-tree__note-copy {
          display: grid;
          gap: 2px;
        }
        .alisio-memory-tree__note-copy strong {
          font-size: 0.94rem;
          font-weight: 600;
        }
        .alisio-memory-tree__note-copy span {
          color: var(--text-muted);
          font-size: 0.8rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .alisio-memory-note-area {
          display: grid;
          gap: 18px;
          min-width: 0;
        }
        .alisio-memory-graph-workspace {
          display: grid;
          gap: 12px;
          min-width: 0;
        }
        .alisio-memory-graph-workspace__toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          padding: 12px 14px;
          border-radius: 18px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 98%, transparent);
        }
        .alisio-memory-graph-workspace__copy {
          display: grid;
          gap: 4px;
        }
        .alisio-memory-graph-workspace__copy h3 {
          margin: 0;
          font-size: 1rem;
        }
        .alisio-memory-graph-workspace__controls {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .alisio-memory-graph-workspace__depth {
          min-width: 180px;
        }
        .alisio-memory-sidebar {
          position: sticky;
          top: 12px;
          display: grid;
          gap: 10px;
          min-width: 0;
        }
        .alisio-memory-sidebar__toolbar {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          padding: 8px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 98%, transparent);
        }
        .alisio-memory-sidebar__body {
          display: grid;
          gap: 12px;
          min-width: 0;
        }
        .alisio-memory-sidebar__stack,
        .alisio-memory-sidebar__pane {
          display: grid;
          gap: 12px;
        }
        .alisio-memory-sidebar__group,
        .alisio-memory-sidebar__stack .alisio-memory-group {
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 98%, transparent);
          box-shadow: none;
        }
        .alisio-memory-sidebar__stack .alisio-memory-group__header h2,
        .alisio-memory-sidebar__pane-head h3 {
          margin: 0;
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .alisio-memory-sidebar__pane-head {
          display: grid;
          gap: 10px;
        }
        .alisio-memory-note {
          display: grid;
          gap: 14px;
          min-width: 0;
          padding: 16px 18px 18px;
          border-radius: 18px;
          border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 99%, transparent);
          box-shadow: none;
        }
        .alisio-memory-note__header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          flex-wrap: wrap;
        }
        .alisio-memory-note__copy {
          display: grid;
          gap: 10px;
          min-width: min(100%, 460px);
          flex: 1 1 auto;
        }
        .alisio-memory-note__title-input {
          width: 100%;
          border: 0;
          padding: 0;
          margin: 0;
          background: transparent;
          color: inherit;
          font:
            600 clamp(1.65rem, 2vw, 2.1rem) / 1.15 "Iowan Old Style",
            "Palatino Linotype",
            "Book Antiqua",
            Palatino,
            Georgia,
            serif;
        }
        .alisio-memory-note__meta {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .alisio-memory-note__meta span {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--surface-elevated) 86%, transparent);
          color: var(--text-muted);
          font-size: 0.8rem;
          font-weight: 600;
        }
        .alisio-memory-note__actions {
          display: grid;
          gap: 10px;
        }
        .alisio-memory-note__mode-switch,
        .alisio-memory-note__utility-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .alisio-memory-note__utility-actions .alisio-memory-native__result-actions {
          justify-content: flex-start;
        }
        .alisio-memory-note__textarea {
          min-height: 560px;
          width: 100%;
          resize: vertical;
          padding: 0;
          border: 0;
          background: transparent;
          color: inherit;
          font:
            500 0.98rem / 1.75 "SF Mono",
            "Monaco",
            "Cascadia Code",
            "Roboto Mono",
            "Courier New",
            monospace;
        }
        .alisio-memory-note__textarea:focus,
        .alisio-memory-note__title-input:focus {
          outline: none;
        }
        .alisio-memory-note__dirty {
          color: var(--text-muted);
          font-size: 0.92rem;
        }
        .alisio-memory-preview__body {
          line-height: 1.75;
          font-family:
            "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
        }
        .alisio-memory-files-preview__frame {
          min-height: 360px;
        }
        @media (max-width: 980px) {
          .alisio-memory-layout {
            grid-template-columns: 1fr;
          }
          .alisio-memory-notes__explorer,
          .alisio-memory-sidebar {
            position: static;
          }
        }
        @media (max-width: 720px) {
          .alisio-memory-toolbar {
            padding: 16px;
          }
          .alisio-memory-toolbar__controls {
            width: 100%;
            margin-left: 0;
            display: grid;
          }
          .alisio-memory-graph-workspace__toolbar {
            padding: 16px;
          }
          .alisio-memory-native__trace-grid {
            grid-template-columns: 1fr;
          }
          .alisio-memory-note__header {
            flex-direction: column;
          }
          .alisio-memory-note {
            padding: 16px;
          }
          .alisio-memory-note__textarea {
            min-height: 420px;
          }
          .alisio-memory-utilitybar {
            grid-template-columns: 1fr;
          }
        }
      </style>
      <section class="alisio-page alisio-memory-page">
        ${this.renderHeader(text)}
        ${props.agentsError ? renderMemoryNotice(props.agentsError, "danger") : nothing}
        ${props.memoryError ? renderMemoryNotice(props.memoryError, "danger") : nothing}
        ${props.memoryStatusError ? renderMemoryNotice(props.memoryStatusError) : nothing}
        <div
          class="alisio-memory-layout ${this.mainPaneMode === "graph"
            ? "is-graph-mode"
            : ""} ${this.hasSidePaneContent() ? "" : "is-no-sidebar"}"
        >
          ${this.renderExplorer(text)}
          <section class="alisio-memory-note-area">
            ${this.mainPaneMode === "graph"
              ? this.renderGraphWorkspace(text)
              : this.renderNoteBody(text)}
          </section>
          ${this.renderSidePane(text)}
        </div>
        ${renderSyncCard({
          text,
          sync: this.syncSurface,
          status: props.memoryStatus,
          noteCount: this.notesList?.notes.length ?? 0,
          syncing: props.memorySyncing,
          canSync: props.memorySyncAvailable && Boolean(props.memoryStatus?.enabled),
          exportBusy: this.exportBusy,
          exportFormat: this.exportFormat,
          exportFormats: resolveAllowedExportFormats(this.notesList),
          exportMessage: this.exportMessage,
          onSync: () => {
            props.onSync();
            void this.reloadAll();
          },
          onExportFormat: (value) => {
            this.exportFormat = value;
          },
          onExport: () => void this.exportMemory(),
        })}
        ${this.renderTraceDrawer(text)}
      </section>
    `;
  }
}

if (!customElements.get("alisio-memory-native-hub")) {
  customElements.define("alisio-memory-native-hub", AlisioMemoryNativeHub);
}
