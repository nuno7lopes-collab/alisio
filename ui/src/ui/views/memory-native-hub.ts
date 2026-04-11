import { LitElement, html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import {
  MemoryEndpointUnavailableError,
  type MemoryClaimItem,
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
  requestMemoryTrace,
  requestMemoryWikiHistory,
  requestMemoryWikiList,
  requestMemoryWikiPage,
  requestMemoryWikiUpdate,
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
} from "./loading-skeleton.ts";
import { renderLegacyMemoryEditor } from "./memory-legacy.ts";
import { renderMemorySettings } from "./memory-settings.ts";

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
    shellTitle: t("alisio.memory.shell.title"),
    shellSubtitle: t("alisio.memory.shell.subtitle"),
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
    wikiHistory: t("alisio.memory.wiki.history"),
    wikiContext: t("alisio.memory.wiki.context"),
    wikiRevision: t("alisio.memory.wiki.revision"),
    wikiOpenPage: t("alisio.memory.wiki.openPage"),
    wikiNoSelection: t("alisio.memory.wiki.noSelection"),
    wikiHistoryEmpty: t("alisio.memory.wiki.historyEmpty"),
    wikiBacklinksEmpty: t("alisio.memory.wiki.backlinksEmpty"),
    wikiClaimsEmpty: t("alisio.memory.wiki.claimsEmpty"),
    wikiEvidenceEmpty: t("alisio.memory.wiki.evidenceEmpty"),
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
    reasonTags: t("alisio.memory.trace.reasonTags"),
    whySurfaced: t("alisio.memory.trace.whySurfaced"),
    viewTrace: t("alisio.memory.trace.view"),
    traceTitle: t("alisio.memory.trace.title"),
    traceSummary: t("alisio.memory.trace.summary"),
    traceRaw: t("alisio.memory.trace.raw"),
    traceClose: t("alisio.memory.trace.close"),
    traceUnavailable: t("alisio.memory.trace.unavailable"),
    legacyTitle: t("alisio.memory.legacy.title"),
    legacyBody: t("alisio.memory.legacy.body"),
    graphHint: t("alisio.memory.graph.hint"),
    graphFocus: t("alisio.memory.graph.focus"),
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
  return tag.label?.trim() || tag.code.trim();
}

function normalizeSummaryLines(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function buildTraceSummary(trace: MemoryTraceResult | null) {
  const explicit = normalizeSummaryLines(trace?.summary);
  if (explicit.length > 0) {
    return explicit;
  }
  if (!trace?.raw || typeof trace.raw !== "object") {
    return [] as string[];
  }
  const raw = trace.raw as Record<string, unknown>;
  const lines: string[] = [];
  const query = typeof raw.query === "string" ? raw.query.trim() : "";
  if (query) {
    lines.push(`Query: ${query}`);
  }
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  if (reasons.length > 0) {
    lines.push(`Reasons: ${reasons.join(", ")}`);
  }
  const hits = Array.isArray(raw.hits) ? raw.hits.length : null;
  if (typeof hits === "number") {
    lines.push(`Hits: ${hits}`);
  }
  return lines;
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
  return html`
    <section class="alisio-memory-runtime">
      <div class="alisio-memory-runtime__header">
        <div class="alisio-memory-runtime__copy">
          <h3>${params.text.shellTitle}</h3>
          <p>${params.text.shellSubtitle}</p>
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
          <strong class="alisio-memory-stat__value">${params.text.syncE2eeRequired}</strong>
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
  @state() private pageDrafts: Record<string, string> = {};
  @state() private pageTitleDrafts: Record<string, string> = {};
  @state() private pageSaving = false;
  @state() private createOpen = false;
  @state() private createTitle = "";
  @state() private filesLoading = false;
  @state() private filesError: string | null = null;
  @state() private filesList: MemoryFilesListResult | null = null;
  @state() private selectedFileId: string | null = null;
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

  private wikiListToken = 0;
  private pageToken = 0;
  private historyToken = 0;
  private filesListToken = 0;
  private fileToken = 0;
  private traceToken = 0;
  private syncedGraphPath: string | null = null;

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
    this.pageDrafts = {};
    this.pageTitleDrafts = {};
    this.filesLoading = false;
    this.filesError = null;
    this.filesList = null;
    this.selectedFileId = null;
    this.fileLoading = false;
    this.fileError = null;
    this.fileDetail = null;
    this.traceOpen = false;
    this.traceLoading = false;
    this.traceError = null;
    this.traceData = null;
    this.exportMessage = null;
    this.syncedGraphPath = null;
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
    return this.wikiList?.sync ?? this.filesList?.sync ?? null;
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
        : (result.pages[0]?.id ?? null);
      this.selectedPageId = nextPageId;
      if (nextPageId) {
        await Promise.allSettled([
          this.loadWikiPage(nextPageId, { preserveDraft: true }),
          this.loadWikiHistory(nextPageId),
        ]);
      } else {
        this.page = null;
        this.history = [];
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
      });
      if (token !== this.pageToken) {
        return;
      }
      const preserveDraft =
        options?.preserveDraft && this.page?.id === result.page.id && this.pageDirty;
      this.page = result.page;
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
      this.syncGraphSelection(result.page.path ?? null);
    } catch (err) {
      if (token !== this.pageToken) {
        return;
      }
      this.pageError = describeMemoryError(err);
      this.page = null;
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
      });
      if (token !== this.fileToken) {
        return;
      }
      this.fileDetail = result.file;
    } catch (err) {
      if (token !== this.fileToken) {
        return;
      }
      this.fileError = describeMemoryError(err);
      this.fileDetail = null;
    } finally {
      if (token === this.fileToken) {
        this.fileLoading = false;
      }
    }
  }

  private async selectPage(pageId: string) {
    this.selectedPageId = pageId;
    this.activeView = "wiki";
    emitMemoryTelemetry("ui_memory_view_opened", { view: "wiki" });
    await Promise.allSettled([
      this.loadWikiPage(pageId, { preserveDraft: true }),
      this.loadWikiHistory(pageId),
    ]);
  }

  private syncGraphSelection(path: string | null) {
    if (!path || !this.props || this.syncedGraphPath === path) {
      return;
    }
    this.syncedGraphPath = path;
    this.props.onSelectFile(path);
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
      this.createOpen = false;
      this.createTitle = "";
      await this.loadWikiList();
      const nextId =
        result.page?.id ??
        this.wikiList?.pages.find((page) => page.title.trim() === title)?.id ??
        null;
      if (nextId) {
        await this.selectPage(nextId);
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

  private openGraphTarget(path: string | null | undefined) {
    if (!path) {
      return;
    }
    const match = this.wikiList?.pages.find((page) => page.path === path) ?? null;
    if (match) {
      void this.selectPage(match.id);
      return;
    }
    this.activeView = "wiki";
    emitMemoryTelemetry("ui_memory_view_opened", { view: "wiki" });
    this.props?.onSelectFile(path);
  }

  private setView(view: MemoryView) {
    this.activeView = view;
    emitMemoryTelemetry("ui_memory_view_opened", { view });
    if (view === "files" && this.selectedFileId) {
      void this.loadFileDetail(this.selectedFileId);
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
        <div class="alisio-memory-native__tabs" role="tablist" aria-label="Memory views">
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
                              confidence ${String(claim.confidence)}
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
                    ${preview.summary?.trim() || text.na}
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
    const page = this.page;
    return html`
      <div class="alisio-memory-shell">
        <aside class="alisio-memory-sidebar">${this.renderWikiSidebar(text)}</aside>
        <div class="alisio-memory-main">
          ${this.pageError ? html`<div class="callout info">${this.pageError}</div>` : nothing}
          ${!page
            ? html`<div class="alisio-memory-panel alisio-memory-panel--empty">
                ${text.wikiNoSelection}
              </div>`
            : html`
                <section class="alisio-memory-runtime">
                  <div class="alisio-memory-runtime__header">
                    <div class="alisio-memory-runtime__copy">
                      <h3>${this.currentPageTitleDraft || page.title}</h3>
                      <p>${page.path?.trim() || text.na}</p>
                    </div>
                    <div class="alisio-memory-runtime__actions">
                      ${this.pageDirty
                        ? html`<span class="alisio-memory-badge">${text.unsaved}</span>`
                        : nothing}
                      ${this.tracesEnabled && (page.traceId || page.trace)
                        ? html`
                            <button
                              class="btn btn--sm"
                              @click=${() =>
                                void this.openTrace({
                                  label: page.title,
                                  traceId: page.traceId,
                                  trace: page.trace,
                                  summary: page.traceSummary,
                                  reasonTags: page.reasonTags,
                                })}
                            >
                              ${text.viewTrace}
                            </button>
                          `
                        : nothing}
                      <button
                        class="btn btn--sm"
                        ?disabled=${!this.pageDirty || this.pageSaving}
                        @click=${() => {
                          if (!page.id) {
                            return;
                          }
                          this.pageDrafts = { ...this.pageDrafts, [page.id]: page.content };
                          this.pageTitleDrafts = { ...this.pageTitleDrafts, [page.id]: page.title };
                        }}
                      >
                        ${text.reset}
                      </button>
                      <button
                        class="btn btn--sm primary"
                        ?disabled=${this.pageSaving || !this.pageDirty}
                        @click=${() => void this.savePage()}
                      >
                        ${this.pageSaving ? text.saving : text.save}
                      </button>
                    </div>
                  </div>
                  ${renderReasonTags(page.reasonTags)}
                  <div class="alisio-memory-native__editor">
                    <label class="field">
                      <span>${text.wikiEditorTitle}</span>
                      <input
                        .value=${this.currentPageTitleDraft}
                        @input=${(event: Event) => {
                          if (!page.id) {
                            return;
                          }
                          this.pageTitleDrafts = {
                            ...this.pageTitleDrafts,
                            [page.id]: (event.target as HTMLInputElement).value,
                          };
                        }}
                      />
                    </label>
                    <div class="alisio-memory-editor">
                      <label class="field alisio-memory-editor__pane">
                        <span>${text.wikiPath}</span>
                        <textarea
                          class="alisio-memory-textarea"
                          .value=${this.currentPageDraft}
                          @input=${(event: Event) => {
                            if (!page.id) {
                              return;
                            }
                            this.pageDrafts = {
                              ...this.pageDrafts,
                              [page.id]: (event.target as HTMLTextAreaElement).value,
                            };
                          }}
                        ></textarea>
                      </label>
                      <section class="alisio-memory-preview">
                        <div class="alisio-memory-preview__label">${text.preview}</div>
                        ${this.currentPageDraft.trim()
                          ? html`
                              <div class="alisio-memory-preview__body sidebar-markdown">
                                ${unsafeHTML(toSanitizedMarkdownHtml(this.currentPageDraft))}
                              </div>
                            `
                          : html`<div class="alisio-memory-preview__empty">
                              ${text.previewEmpty}
                            </div>`}
                      </section>
                    </div>
                  </div>
                </section>
                <div class="alisio-memory-native__panels">
                  ${this.renderContext(text)} ${this.renderBacklinks(text, page.backlinks)}
                  ${this.renderClaims(text, page.claims)}
                  <section class="alisio-memory-group">
                    <div class="alisio-memory-group__header"><h2>${text.wikiEvidence}</h2></div>
                    ${renderProvenanceRows(page.provenance, text.wikiEvidenceEmpty)}
                  </section>
                  ${this.renderHistory(text)}
                  ${this.legacyEditorEnabled
                    ? html`
                        <details class="alisio-memory-runtime">
                          <summary>${text.legacyTitle}</summary>
                          <p>${text.legacyBody}</p>
                          ${renderLegacyMemoryEditor(this.props!, { compact: true })}
                        </details>
                      `
                    : nothing}
                </div>
              `}
        </div>
      </div>
    `;
  }

  private renderFilesView(text: ReturnType<typeof memoryText>) {
    const files = this.filesList?.files ?? [];
    return html`
      <div class="alisio-memory-shell">
        <aside class="alisio-memory-sidebar">
          <section class="alisio-memory-group">
            <div class="alisio-memory-group__header"><h2>${text.filesTitle}</h2></div>
            ${this.filesLoading && files.length === 0
              ? html`${renderSkeletonListItem({
                  lines: ["short", "medium"],
                })}${renderSkeletonListItem({ lines: ["short", "medium"] })}`
              : this.filesError
                ? html`<div class="callout info">${this.filesError}</div>`
                : files.length === 0
                  ? html`<div class="alisio-memory-empty">${text.filesEmpty}</div>`
                  : html`
                      <div class="alisio-memory-file-list">
                        ${files.map(
                          (file) => html`
                            <button
                              type="button"
                              class="alisio-memory-file ${this.selectedFileId === file.id
                                ? "is-active"
                                : ""}"
                              @click=${() => {
                                this.selectedFileId = file.id;
                                void this.loadFileDetail(file.id);
                              }}
                            >
                              <span class="alisio-memory-file__copy">
                                <span class="alisio-memory-file__title">${file.name}</span>
                                <span class="alisio-memory-file__meta">
                                  ${file.provenanceSummary?.trim() || text.na}
                                </span>
                                ${renderReasonTags(file.reasonTags)}
                              </span>
                            </button>
                          `,
                        )}
                      </div>
                    `}
          </section>
        </aside>
        <div class="alisio-memory-main">
          ${this.fileLoading && !this.fileDetail
            ? html`
                <section class="alisio-memory-runtime">
                  ${renderSkeletonLines(["short", "medium", "long"], { compact: true })}
                </section>
              `
            : this.fileError
              ? html`<div class="callout info">${this.fileError}</div>`
              : !this.fileDetail
                ? html`<div class="alisio-memory-panel alisio-memory-panel--empty">
                    ${text.filesNoSelection}
                  </div>`
                : html`
                    <section class="alisio-memory-runtime">
                      <div class="alisio-memory-runtime__header">
                        <div class="alisio-memory-runtime__copy">
                          <h3>${this.fileDetail.name}</h3>
                          <p>${this.fileDetail.provenanceSummary?.trim() || text.na}</p>
                        </div>
                        ${this.tracesEnabled && (this.fileDetail.traceId || this.fileDetail.trace)
                          ? html`
                              <div class="alisio-memory-runtime__actions">
                                <button
                                  class="btn btn--sm"
                                  @click=${() =>
                                    void this.openTrace({
                                      label: this.fileDetail?.name ?? text.traceTitle,
                                      traceId: this.fileDetail?.traceId,
                                      trace: this.fileDetail?.trace,
                                      summary: this.fileDetail?.traceSummary,
                                      reasonTags: this.fileDetail?.reasonTags,
                                    })}
                                >
                                  ${text.viewTrace}
                                </button>
                              </div>
                            `
                          : nothing}
                      </div>
                      ${renderReasonTags(this.fileDetail.reasonTags)}
                      <div class="alisio-memory-runtime__meta">
                        <div class="alisio-memory-runtime__meta-item">
                          <span class="alisio-memory-runtime__meta-label"
                            >${text.filesMediaType}</span
                          >
                          <strong class="alisio-memory-runtime__meta-value">
                            ${this.fileDetail.mediaType?.trim() || text.na}
                          </strong>
                        </div>
                        <div class="alisio-memory-runtime__meta-item">
                          <span class="alisio-memory-runtime__meta-label">${text.filesSize}</span>
                          <strong class="alisio-memory-runtime__meta-value">
                            ${formatBytes(this.fileDetail.size) ?? text.na}
                          </strong>
                        </div>
                        <div class="alisio-memory-runtime__meta-item">
                          <span class="alisio-memory-runtime__meta-label"
                            >${text.filesUpdated}</span
                          >
                          <strong class="alisio-memory-runtime__meta-value">
                            ${formatTimestamp(this.fileDetail.updatedAt) ?? text.na}
                          </strong>
                        </div>
                      </div>
                    </section>
                    <div class="alisio-memory-native__panels">
                      <section class="alisio-memory-group">
                        <div class="alisio-memory-group__header">
                          <h2>${text.filesProvenance}</h2>
                        </div>
                        ${renderProvenanceRows(this.fileDetail.provenance, text.na)}
                      </section>
                      <section class="alisio-memory-group">
                        <div class="alisio-memory-group__header">
                          <h2>${text.filesRelatedPages}</h2>
                        </div>
                        ${(this.fileDetail.relatedPages?.length ?? 0) === 0
                          ? html`<div class="alisio-memory-empty">${text.none}</div>`
                          : html`
                              <div class="alisio-memory-file-list">
                                ${this.fileDetail.relatedPages!.map(
                                  (page) => html`
                                    <button
                                      type="button"
                                      class="alisio-memory-file"
                                      @click=${() =>
                                        page.id
                                          ? void this.selectPage(page.id)
                                          : this.openGraphTarget(page.path)}
                                    >
                                      <span class="alisio-memory-file__copy">
                                        <span class="alisio-memory-file__title">${page.title}</span>
                                        <span class="alisio-memory-file__meta">
                                          ${page.path?.trim() || text.na}
                                        </span>
                                      </span>
                                    </button>
                                  `,
                                )}
                              </div>
                            `}
                      </section>
                    </div>
                  `}
        </div>
      </div>
    `;
  }

  private buildGraphModel(graph: MemoryGraphState | null) {
    if (!graph || graph.matches.length === 0) {
      return null;
    }
    const focus = graph.matches[0];
    const seen = new Set<string>();
    const nodes: Array<{
      key: string;
      label: string;
      path?: string | null;
      x: number;
      y: number;
      active?: boolean;
    }> = [];
    const edges: Array<{ from: string; to: string; label: string }> = [];
    nodes.push({
      key: focus.entityId,
      label: focus.title,
      path: focus.sourcePath,
      x: 360,
      y: 210,
      active: true,
    });
    seen.add(focus.entityId);
    const relations = focus.relations.slice(0, 8);
    const radius = 140;
    relations.forEach((relation, index) => {
      const related = relation.relatedEntity;
      if (!related || seen.has(related.entityId)) {
        return;
      }
      const angle = (Math.PI * 2 * index) / Math.max(relations.length, 1) - Math.PI / 2;
      nodes.push({
        key: related.entityId,
        label: related.title,
        path: related.sourcePath,
        x: 360 + Math.cos(angle) * radius,
        y: 210 + Math.sin(angle) * radius,
      });
      seen.add(related.entityId);
      edges.push({
        from: focus.entityId,
        to: related.entityId,
        label: relation.relationType,
      });
    });
    return { focus, nodes, edges };
  }

  private renderGraphView(text: ReturnType<typeof memoryText>) {
    const model = this.buildGraphModel(this.props?.memoryGraph ?? null);
    return html`
      <div class="alisio-memory-shell">
        <aside class="alisio-memory-sidebar">
          <section class="alisio-memory-group">
            <div class="alisio-memory-group__header"><h2>${text.graphTitle}</h2></div>
            ${this.props?.memoryGraphError
              ? html`<div class="callout info">${this.props.memoryGraphError}</div>`
              : !model
                ? html`<div class="alisio-memory-empty">${text.graphHint}</div>`
                : html`
                    <div class="alisio-memory-native__stack">
                      <div class="alisio-memory-runtime__meta-item">
                        <span class="alisio-memory-runtime__meta-label">${text.graphFocus}</span>
                        <strong class="alisio-memory-runtime__meta-value"
                          >${model.focus.title}</strong
                        >
                        <span class="alisio-memory-runtime__meta-detail"
                          >${model.focus.sourcePath}</span
                        >
                      </div>
                      ${renderReasonTags(
                        this.wikiList?.pages.find((page) => page.path === model.focus.sourcePath)
                          ?.reasonTags,
                      )}
                    </div>
                  `}
          </section>
          <section class="alisio-memory-group">
            <div class="alisio-memory-group__header"><h2>${text.graphRelations}</h2></div>
            ${!model
              ? html`<div class="alisio-memory-empty">${text.graphEmpty}</div>`
              : html`
                  <div class="alisio-memory-native__stack">
                    ${model.edges.map(
                      (edge) => html`
                        <button
                          type="button"
                          class="alisio-memory-file"
                          @click=${() =>
                            this.openGraphTarget(
                              model.nodes.find((node) => node.key === edge.to)?.path,
                            )}
                        >
                          <span class="alisio-memory-file__copy">
                            <span class="alisio-memory-file__title">
                              ${edge.label} →
                              ${model.nodes.find((node) => node.key === edge.to)?.label ?? text.na}
                            </span>
                          </span>
                        </button>
                      `,
                    )}
                  </div>
                `}
          </section>
        </aside>
        <div class="alisio-memory-main">
          ${this.props?.memoryGraphLoading
            ? html`
                <section class="alisio-memory-runtime">
                  <div class="alisio-memory-empty">${text.graphLoading}</div>
                </section>
              `
            : !model
              ? html`<div class="alisio-memory-panel alisio-memory-panel--empty">
                  ${text.graphUnavailable}
                </div>`
              : html`
                  <section class="alisio-memory-runtime">
                    <svg
                      class="alisio-memory-native__graph"
                      viewBox="0 0 720 420"
                      role="img"
                      aria-label=${text.graphTitle}
                    >
                      ${model.edges.map((edge) => {
                        const from = model.nodes.find((node) => node.key === edge.from)!;
                        const to = model.nodes.find((node) => node.key === edge.to)!;
                        const midX = (from.x + to.x) / 2;
                        const midY = (from.y + to.y) / 2;
                        return html`
                          <line
                            x1=${from.x}
                            y1=${from.y}
                            x2=${to.x}
                            y2=${to.y}
                            stroke="currentColor"
                            opacity="0.25"
                          ></line>
                          <text
                            x=${midX}
                            y=${midY}
                            text-anchor="middle"
                            class="alisio-memory-native__edge-label"
                          >
                            ${edge.label}
                          </text>
                        `;
                      })}
                      ${model.nodes.map(
                        (node) => html`
                          <g
                            class="alisio-memory-native__graph-node ${node.active
                              ? "is-active"
                              : ""}"
                            @click=${() => this.openGraphTarget(node.path)}
                          >
                            <circle cx=${node.x} cy=${node.y} r=${node.active ? 48 : 34}></circle>
                            <text x=${node.x} y=${node.y} text-anchor="middle">
                              ${node.label}
                            </text>
                          </g>
                        `,
                      )}
                    </svg>
                  </section>
                `}
        </div>
      </div>
    `;
  }

  private renderTraceDrawer(text: ReturnType<typeof memoryText>) {
    if (!this.traceOpen) {
      return nothing;
    }
    const summary = buildTraceSummary(this.traceData);
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
        ${renderMemorySettings({
          loading: props.configLoading,
          saving: props.configSaving,
          dirty: props.configDirty,
          schema: props.configSchema,
          uiHints: props.configUiHints,
          value: props.configForm,
          selectedAgentId: props.selectedAgentId,
          selectedAgentLabel:
            props.agentsList?.agents.find((agent) => agent.id === props.selectedAgentId)?.name ??
            props.selectedAgentId,
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
