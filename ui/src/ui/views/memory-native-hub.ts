import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { I18nController, t } from "../../i18n/index.ts";
import {
  buildMemoryFileActionModel,
  buildMemoryFilePreviewModel,
} from "../controllers/memory-files-preview.ts";
import {
  MemoryEndpointUnavailableError,
  type MemoryFileDetail,
  type MemoryNote,
  type MemoryNoteAttachment,
  type MemoryNoteBacklink,
  type MemoryNoteListEntry,
  type MemoryNoteRole,
  type MemoryNotesListResult,
  requestMemoryFile,
  requestMemoryGraph,
  requestMemoryNote,
  requestMemoryNotesList,
  requestMemoryNoteUpdate,
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
  renderSurfaceEmptyState,
} from "./loading-skeleton.ts";
import "./memory-graph-view.ts";
import { renderMemoryFilePreview } from "./memory/files-preview.ts";

type MemoryHubProps = import("./memory.ts").MemoryHubProps;
type NoteMode = "markdown" | "reading";

function memoryText() {
  return {
    agent: t("alisio.memory.agent"),
    cancelCreate: t("alisio.memory.cancelCreate"),
    filesAttached: t("alisio.memory.files.attached"),
    filesDownload: t("alisio.memory.files.download"),
    filesFocusGraph: t("alisio.memory.files.focusGraph"),
    filesMediaType: t("alisio.memory.files.mediaType"),
    filesMentioned: t("alisio.memory.files.mentioned"),
    filesOpen: t("alisio.memory.files.open"),
    filesOpenPage: t("alisio.memory.files.openPage"),
    filesPreviewTruncated: t("alisio.memory.files.previewTruncated"),
    filesPreviewUnavailable: t("alisio.memory.files.previewUnavailable"),
    filesRelatedPages: t("alisio.memory.files.relatedPages"),
    filesSize: t("alisio.memory.files.size"),
    filesTitle: t("alisio.memory.files.title"),
    filesUnlinked: t("alisio.memory.files.unlinked"),
    graphCenterFocus: t("alisio.memory.graph.centerFocus"),
    graphColorBy: t("alisio.memory.graph.colorBy"),
    graphContextMenuCenter: t("alisio.memory.graph.contextMenuCenter"),
    graphContextMenuLocal: t("alisio.memory.graph.contextMenuLocal"),
    graphContextMenuOpen: t("alisio.memory.graph.contextMenuOpen"),
    graphDepth: t("alisio.memory.graph.depth"),
    graphEdgesCount: t("alisio.memory.graph.edgesCount"),
    graphTitle: t("alisio.memory.graphTitle"),
    graphLoading: t("alisio.memory.graphLoading"),
    graphEmpty: t("alisio.memory.graphEmpty"),
    graphUnavailable: t("alisio.memory.graphUnavailable"),
    graphCanvasHint: t("alisio.memory.graph.canvasHint"),
    graphFocus: t("alisio.memory.graph.focus"),
    graphGlobal: t("alisio.memory.graph.global"),
    graphLocal: t("alisio.memory.graph.local"),
    graphNodesCount: t("alisio.memory.graph.nodesCount"),
    graphRelationType: t("alisio.memory.graph.relationType"),
    graphResetView: t("alisio.memory.graph.resetView"),
    graphShowAttachments: t("alisio.memory.graph.showAttachments"),
    graphSource: t("alisio.memory.graph.source"),
    graphTarget: t("alisio.memory.graph.target"),
    graphFilterTags: t("alisio.memory.graph.filterTags"),
    graphGroups: t("alisio.memory.graph.groups"),
    graphGroupNone: t("alisio.memory.graph.groupNone"),
    graphGroupFolder: t("alisio.memory.graph.groupFolder"),
    graphGroupTag: t("alisio.memory.graph.groupTag"),
    graphGroupKind: t("alisio.memory.graph.groupKind"),
    graphGroupSource: t("alisio.memory.graph.groupSource"),
    graphGroupNote: t("alisio.memory.graph.groupNote"),
    graphGroupAttachment: t("alisio.memory.graph.groupAttachment"),
    graphZoomIn: t("alisio.memory.graph.zoomIn"),
    graphZoomOut: t("alisio.memory.graph.zoomOut"),
    none: t("common.none"),
    na: t("common.na"),
    noteBacklinks: t("alisio.memory.notes.backlinks"),
    noteBacklinksEmpty: t("alisio.memory.notes.backlinksEmpty"),
    noteMarkdown: t("alisio.memory.notes.editorTitle"),
    noteNoSelection: t("alisio.memory.notes.noSelection"),
    notePath: t("alisio.memory.notes.path"),
    noteRole: t("alisio.memory.notes.roleLabel"),
    noteUpdated: t("alisio.memory.notes.updated"),
    notesCreate: t("alisio.memory.notes.create"),
    notesCreateConfirm: t("alisio.memory.notes.createConfirm"),
    notesCreatePlaceholder: t("alisio.memory.notes.createPlaceholder"),
    notesListTitle: t("alisio.memory.notes.listTitle"),
    noteRoles: {
      main: t("alisio.memory.notes.roles.main"),
      topic: t("alisio.memory.notes.roles.topic"),
      daily: t("alisio.memory.notes.roles.daily"),
      backlog: t("alisio.memory.notes.roles.backlog"),
    },
    preview: t("alisio.memory.preview"),
    previewEmpty: t("alisio.memory.previewEmpty"),
    refresh: t("common.refresh"),
    reset: t("alisio.memory.reset"),
    save: t("alisio.memory.save"),
    saving: t("alisio.memory.saving"),
    searchPlaceholder: t("alisio.memory.searchPlaceholder"),
    unsaved: t("alisio.memory.unsaved"),
    views: {
      notes: t("alisio.memory.views.notes"),
      graph: t("alisio.memory.views.graph"),
    },
    workspaceExplorer: t("alisio.memory.workspace.explorer"),
    workspaceVault: t("alisio.memory.workspace.vault"),
  };
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

function isMemoryBusyError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("memória está temporariamente ocupada") ||
    normalized.includes("database is locked") ||
    normalized.includes("sqlite_busy") ||
    normalized.includes("err_sqlite_error") ||
    normalized.includes("database busy")
  );
}

function describeMemoryError(err: unknown) {
  if (err instanceof MemoryEndpointUnavailableError) {
    return err.message;
  }
  if (isMemoryBusyError(err)) {
    return "A memória está temporariamente ocupada.";
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error:\s*/i, "").trim();
}

function sanitizeMemoryNotice(message: string | null | undefined) {
  if (!message) {
    return null;
  }
  const normalized = describeMemoryError(message).trim();
  return normalized || null;
}

function emitMemoryTelemetry(event: string, detail: Record<string, unknown> = {}) {
  window.dispatchEvent(
    new CustomEvent("alisio-ui-telemetry", {
      detail: { event, ...detail },
    }),
  );
}

function formatReasonLabel(tag: NonNullable<MemoryNote["reasonTags"]>[number]) {
  const localized = t(`alisio.memory.trace.codes.${tag.code}`);
  if (localized && localized !== `alisio.memory.trace.codes.${tag.code}`) {
    return localized;
  }
  return tag.label?.trim() || tag.code.trim();
}

function resolveSyncInvalidationMarker(
  props: Pick<MemoryHubProps, "memoryStatus" | "memoryGraph"> | null | undefined,
) {
  const runtime = props?.memoryStatus?.runtime?.canonicalStore ?? null;
  const graph = props?.memoryGraph ?? null;
  if (!runtime && !graph) {
    return null;
  }
  return [
    runtime?.syncAvailability?.trim() ?? graph?.state?.trim() ?? "",
    runtime?.lastSyncedLamport == null
      ? graph?.lastSyncedLamport == null
        ? ""
        : String(graph.lastSyncedLamport)
      : String(runtime.lastSyncedLamport),
    runtime?.lastError?.trim() ?? graph?.lastError?.trim() ?? "",
  ].join(":");
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

function renderReasonTags(tags: MemoryNote["reasonTags"] | null | undefined) {
  const entries = tags?.filter((tag) => tag.code.trim() || tag.label?.trim()) ?? [];
  if (entries.length === 0) {
    return nothing;
  }
  return entries.map(
    (tag) => html`<span class="alisio-memory-badge">${formatReasonLabel(tag)}</span>`,
  );
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
  return renderSurfaceEmptyState({
    icon: params.icon,
    title: params.detail ? (params.label ?? null) : null,
    body: params.detail ?? params.label ?? "",
    actions: params.action ?? null,
    className: "alisio-memory-placeholder",
    compact: params.compact,
    centered: true,
  });
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

type NoteRoleGroup = {
  role: MemoryNoteRole;
  label: string;
  icon: unknown;
  notes: MemoryNoteListEntry[];
};

function resolveNoteRole(note: Pick<MemoryNoteListEntry, "memoryRole">): MemoryNoteRole {
  return note.memoryRole ?? "topic";
}

function parseUpdatedAtMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareExplorerNotes(left: MemoryNoteListEntry, right: MemoryNoteListEntry) {
  const role = resolveNoteRole(left);
  if (role !== resolveNoteRole(right)) {
    return left.title.localeCompare(right.title);
  }
  if (role === "daily" || role === "backlog") {
    const updatedDiff =
      (parseUpdatedAtMs(right.updatedAt) ?? 0) - (parseUpdatedAtMs(left.updatedAt) ?? 0);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    const pathDiff = (right.path ?? "").localeCompare(left.path ?? "");
    if (pathDiff !== 0) {
      return pathDiff;
    }
  }
  return left.title.localeCompare(right.title);
}

function resolveRoleGroupLabel(text: ReturnType<typeof memoryText>, role: MemoryNoteRole) {
  return text.noteRoles[role];
}

function resolveRoleGroupIcon(role: MemoryNoteRole) {
  switch (role) {
    case "main":
      return icons.bookmark;
    case "topic":
      return icons.folder;
    case "daily":
      return icons.clock3;
    case "backlog":
      return icons.pin;
  }
}

function buildNoteRoleGroups(
  notes: MemoryNoteListEntry[],
  text: ReturnType<typeof memoryText>,
): NoteRoleGroup[] {
  const roles: MemoryNoteRole[] = ["main", "topic", "daily", "backlog"];
  return roles
    .map((role) => ({
      role,
      label: resolveRoleGroupLabel(text, role),
      icon: resolveRoleGroupIcon(role),
      notes: notes.filter((note) => resolveNoteRole(note) === role).toSorted(compareExplorerNotes),
    }))
    .filter((group) => group.notes.length > 0);
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

function buildMarkdownPreviewHtml(markdown: string) {
  return toSanitizedMarkdownHtml(convertWikiLinks(stripFrontmatter(markdown)));
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

function renderMemoryRoleChip(
  text: Pick<ReturnType<typeof memoryText>, "noteRole" | "noteRoles">,
  note: Pick<MemoryNote, "memoryRole">,
) {
  const role = resolveNoteRole(note);
  return html`
    <span class="alisio-memory-badge alisio-memory-badge--role" title=${text.noteRole}>
      ${text.noteRoles[role]}
    </span>
  `;
}

export class AlisioMemoryNativeHub extends LitElement {
  private i18nController = new I18nController(this);

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
  @state() private noteMode: NoteMode = "reading";
  @state() private noteSaving = false;
  @state() private noteDrafts: Record<string, string> = {};
  @state() private noteTitleDrafts: Record<string, string> = {};
  @state() private createOpen = false;
  @state() private createTitle = "";
  @state() private selectedAttachmentId: string | null = null;
  @state() private attachmentLoading = false;
  @state() private attachmentError: string | null = null;
  @state() private attachmentDetail: MemoryFileDetail | null = null;
  @state() private graphLoading = false;
  @state() private graphError: string | null = null;
  @state() private graphData: MemoryGraphState | null = null;
  @state() private graphScope: "global" | "local" = "global";
  @state() private graphIncludeAttachments = false;
  @state() private graphDepth = 2;
  @state() private mainPaneMode: "note" | "graph" = "note";

  private notesListToken = 0;
  private noteToken = 0;
  private attachmentToken = 0;
  private graphToken = 0;
  private searchReloadTimer: number | null = null;
  private notePreviewMarkdown = "";
  private notePreviewHtml = "";

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
    const previousSyncMarker = resolveSyncInvalidationMarker(previous);
    const syncChanged = previousSyncMarker !== resolveSyncInvalidationMarker(this.props);

    if (clientChanged || agentChanged) {
      if (this.props.connected && this.props.client && this.props.selectedAgentId) {
        void this.reloadAll({ refreshGraph: false });
      }
      return;
    }
    if (queryChanged && this.props.connected && this.props.client && this.props.selectedAgentId) {
      this.scheduleSearchReload();
      return;
    }
    if (syncChanged && this.props.connected && this.props.client && this.props.selectedAgentId) {
      if (!previousSyncMarker) {
        return;
      }
      if (!this.notesList && !this.note && !this.graphData) {
        return;
      }
      void this.reloadAll({
        force: true,
        refreshGraph: this.shouldRefreshGraphForCurrentView(),
      });
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
    this.noteMode = "reading";
    this.noteSaving = false;
    this.noteDrafts = {};
    this.noteTitleDrafts = {};
    this.createOpen = false;
    this.createTitle = "";
    this.selectedAttachmentId = null;
    this.attachmentLoading = false;
    this.attachmentError = null;
    this.attachmentDetail = null;
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
    this.attachmentToken += 1;
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
      void this.reloadAll({
        refreshGraph: this.shouldRefreshGraphForCurrentView(),
      });
    }, 180);
  }

  private get client(): GatewayBrowserClient | null {
    return this.props?.connected ? (this.props.client ?? null) : null;
  }

  private get selectedAgentId() {
    return this.props?.selectedAgentId?.trim() ?? "";
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

  private shouldRefreshGraphForCurrentView() {
    return this.mainPaneMode === "graph";
  }

  private getNotePreviewHtml() {
    const markdown = this.note?.content ?? "";
    if (this.notePreviewMarkdown === markdown) {
      return this.notePreviewHtml;
    }
    const nextHtml = buildMarkdownPreviewHtml(markdown);
    this.notePreviewMarkdown = markdown;
    this.notePreviewHtml = nextHtml;
    return nextHtml;
  }

  private async reloadGraphForCurrentContext(
    focusNoteId?: string | null,
    options?: { force?: boolean },
  ) {
    if (!this.shouldRefreshGraphForCurrentView()) {
      return;
    }
    const noteId = focusNoteId ?? this.note?.id ?? this.selectedNoteId ?? null;
    const keepLocal = this.mainPaneMode === "graph" && this.graphScope === "local" && noteId;
    await this.loadGraph({
      scope: keepLocal ? "local" : "global",
      focusNoteId: keepLocal ? noteId : null,
      includeAttachments: this.graphIncludeAttachments,
      depth: this.graphDepth,
      force: options?.force,
    });
  }

  private async reloadAll(options?: { force?: boolean; refreshGraph?: boolean }) {
    await this.loadNotesList({ force: options?.force });
    if (options?.refreshGraph ?? this.shouldRefreshGraphForCurrentView()) {
      await this.reloadGraphForCurrentContext(this.selectedNoteId, {
        force: options?.force,
      });
    }
  }

  private async loadNotesList(options?: { force?: boolean }) {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.notesListToken;
    const hadVisibleState = Boolean(this.notesList || this.note);
    this.notesLoading = true;
    this.notesError = null;
    try {
      const result = await requestMemoryNotesList(
        this.client,
        {
          agentId: this.selectedAgentId,
          query: this.props?.searchQuery.trim() || undefined,
        },
        options,
      );
      if (token !== this.notesListToken) {
        return;
      }
      this.notesList = result;
      const nextNoteId = result.notes.some((note) => note.id === this.selectedNoteId)
        ? this.selectedNoteId
        : (result.notes[0]?.id ?? null);
      this.selectedNoteId = nextNoteId;
      if (!nextNoteId) {
        this.note = null;
        this.noteError = null;
        this.selectedAttachmentId = null;
        this.attachmentDetail = null;
        this.attachmentError = null;
        return;
      }
      await this.loadNote(nextNoteId, {
        preserveDraft: true,
        force: options?.force,
      });
    } catch (err) {
      if (token !== this.notesListToken) {
        return;
      }
      this.notesError = describeMemoryError(err);
      if (!hadVisibleState) {
        this.notesList = null;
        this.selectedNoteId = null;
        this.note = null;
        this.attachmentDetail = null;
        this.attachmentError = null;
      }
    } finally {
      if (token === this.notesListToken) {
        this.notesLoading = false;
      }
    }
  }

  private async loadNote(noteId: string, options?: { preserveDraft?: boolean; force?: boolean }) {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.noteToken;
    this.noteLoading = true;
    this.noteError = null;
    try {
      const result = await requestMemoryNote(
        this.client,
        {
          agentId: this.selectedAgentId,
          noteId,
          query: this.props?.searchQuery.trim() || undefined,
        },
        { force: options?.force },
      );
      if (token !== this.noteToken) {
        return;
      }
      const preserveDraft =
        options?.preserveDraft && this.note?.id === result.note.id && this.noteDirty;
      this.note = result.note;
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
    } finally {
      if (token === this.noteToken) {
        this.noteLoading = false;
      }
    }
  }

  private async loadAttachment(fileId: string, options?: { force?: boolean }) {
    if (!this.client || !this.selectedAgentId) {
      return;
    }
    const token = ++this.attachmentToken;
    this.selectedAttachmentId = fileId;
    this.attachmentLoading = true;
    this.attachmentError = null;
    try {
      const result = await requestMemoryFile(
        this.client,
        {
          agentId: this.selectedAgentId,
          fileId,
          query: this.props?.searchQuery.trim() || undefined,
        },
        options,
      );
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
    force?: boolean;
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
    const pageId = scope === "local" ? focusNoteId : null;
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
      const result = await requestMemoryGraph(
        this.client,
        {
          agentId: this.selectedAgentId,
          scope,
          query: this.props?.searchQuery.trim() || undefined,
          ...(pageId ? { pageId } : {}),
          direction: "both",
          depth,
          ...(scope === "local"
            ? {
                nodeLimit: 48,
                edgeLimit: 120,
              }
            : {
                nodeLimit: 96,
                edgeLimit: 192,
                relationLimit: 24,
              }),
          ...(includeAttachments ? { includeAttachments: true } : {}),
        },
        { force: options?.force },
      );
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
      this.noteMode = "reading";
    }
    if (!options?.preservePane) {
      this.mainPaneMode = "note";
      this.graphScope = "global";
    }
    emitMemoryTelemetry("ui_memory_note_opened", { noteId });
    await Promise.allSettled([
      this.loadNote(noteId, { preserveDraft: true }),
      this.reloadGraphForCurrentContext(noteId),
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
      this.noteDrafts = {
        ...this.noteDrafts,
        [savedNoteId]: this.currentNoteDraft,
      };
      this.noteTitleDrafts = {
        ...this.noteTitleDrafts,
        [savedNoteId]: this.currentNoteTitleDraft,
      };
      await Promise.allSettled([
        this.loadNotesList({ force: true }),
        this.loadNote(savedNoteId, { preserveDraft: false, force: true }),
        this.reloadGraphForCurrentContext(savedNoteId, { force: true }),
      ]);
      this.noteMode = "reading";
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
      this.createOpen = false;
      this.createTitle = "";
      await this.loadNotesList({ force: true });
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

  private resolveGraphPrimaryNoteId(nodeId: string) {
    const graph = this.graphData ?? this.props?.memoryGraph ?? null;
    if (!graph) {
      return null;
    }
    const nodesById = new Map(graph.nodes.map((entry) => [entry.id, entry]));
    for (const edge of graph.edges) {
      if (edge.fromId !== nodeId && edge.toId !== nodeId) {
        continue;
      }
      const linkedNodeId = edge.fromId === nodeId ? edge.toId : edge.fromId;
      const linkedNode = nodesById.get(linkedNodeId);
      if (linkedNode?.kind === "note") {
        return linkedNode.pageId;
      }
    }
    return null;
  }

  private async openGraphNode(nodeId: string) {
    const graph = this.graphData ?? this.props?.memoryGraph ?? null;
    const node = graph?.nodes.find((entry) => entry.id === nodeId) ?? null;
    if (!node) {
      return;
    }
    if (node.kind === "attachment" && node.attachmentId) {
      const noteId = this.resolveGraphPrimaryNoteId(node.id);
      if (noteId) {
        await this.selectNote(noteId, {
          preserveMode: true,
          preservePane: false,
        });
      }
      await this.loadAttachment(node.attachmentId);
      return;
    }
    await this.selectNote(node.pageId, {
      preserveMode: true,
      preservePane: false,
    });
  }

  private async focusGraphNode(nodeId: string) {
    const graph = this.graphData ?? this.props?.memoryGraph ?? null;
    const node = graph?.nodes.find((entry) => entry.id === nodeId) ?? null;
    if (!node) {
      return;
    }
    const pageId =
      node.kind === "attachment" ? (this.resolveGraphPrimaryNoteId(node.id) ?? null) : node.pageId;
    if (!pageId) {
      return;
    }
    await this.selectNote(pageId, {
      preserveMode: true,
      preservePane: true,
    });
    this.mainPaneMode = "graph";
    await this.loadGraph({
      scope: "local",
      focusNoteId: pageId,
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
      preservePane: false,
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
    const showAgentPicker = agents.length > 1;
    const visibleNotes = this.notesList ? this.notesList.notes.length : null;
    return html`
      <section class="alisio-memory-toolbar">
        <div class="alisio-memory-toolbar__copy">
          <div class="alisio-memory-toolbar__title-row">
            <h2>${text.views.notes}</h2>
            ${visibleNotes == null
              ? nothing
              : html`
                  <span class="alisio-memory-toolbar__count">
                    ${String(visibleNotes)} ${text.notesListTitle.toLowerCase()}
                  </span>
                `}
          </div>
          <div class="alisio-memory-toolbar__tabs">
            <button
              type="button"
              class="btn btn--sm ${this.mainPaneMode === "note" ? "primary" : ""}"
              @click=${() => (this.mainPaneMode = "note")}
            >
              ${text.views.notes}
            </button>
            <button
              type="button"
              class="btn btn--sm ${this.mainPaneMode === "graph" ? "primary" : ""}"
              @click=${() => {
                this.mainPaneMode = "graph";
                this.graphScope = "global";
                void this.loadGraph({
                  scope: "global",
                  focusNoteId: null,
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
          ${showAgentPicker
            ? html`
                <label class="field field--inline">
                  <span>${text.agent}</span>
                  <select
                    .value=${this.props?.selectedAgentId ?? ""}
                    ?disabled=${agents.length === 0}
                    @change=${(event: Event) =>
                      this.props?.onSelectAgent((event.target as HTMLSelectElement).value)}
                  >
                    ${agents.map(
                      (agent) => html`<option value=${agent.id}>${agent.name ?? agent.id}</option>`,
                    )}
                  </select>
                </label>
              `
            : nothing}
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
              void this.reloadAll({
                force: true,
                refreshGraph: this.shouldRefreshGraphForCurrentView(),
              });
            }}
          >
            ${icons.refresh}
          </button>
        </div>
      </section>
    `;
  }

  private renderExplorerNote(note: MemoryNoteListEntry, text: ReturnType<typeof memoryText>) {
    const isActive = this.selectedNoteId === note.id;
    const subtitle = formatNoteSubtitle(text, note);
    const role = resolveNoteRole(note);
    return html`
      <button
        type="button"
        class="alisio-memory-role-card ${isActive ? "is-active" : ""}"
        aria-current=${isActive ? "true" : "false"}
        @click=${() => void this.selectNote(note.id)}
      >
        <span class="alisio-memory-role-card__glyph">${resolveRoleGroupIcon(role)}</span>
        <span class="alisio-memory-role-card__copy">
          <strong>${note.title}</strong>
          <span>${subtitle}</span>
        </span>
        <span class="alisio-memory-role-card__meta">
          ${typeof note.backlinks === "number" ? `${note.backlinks}` : ""}
        </span>
      </button>
    `;
  }

  private renderExplorerGroup(
    group: NoteRoleGroup,
    text: ReturnType<typeof memoryText>,
  ): TemplateResult {
    return html`
      <section class="alisio-memory-role-group" data-role=${group.role}>
        <div class="alisio-memory-role-group__header">
          <span class="alisio-memory-role-group__title">
            <span class="alisio-memory-role-group__icon">${group.icon}</span>
            <strong>${group.label}</strong>
          </span>
          <span class="alisio-memory-role-group__count">${String(group.notes.length)}</span>
        </div>
        <div class="alisio-memory-role-group__list">
          ${group.notes.map((note) => this.renderExplorerNote(note, text))}
        </div>
      </section>
    `;
  }

  private renderExplorer(text: ReturnType<typeof memoryText>) {
    const groups = buildNoteRoleGroups(this.notesList?.notes ?? [], text);
    const explorerError =
      this.notesError && !isMemoryBusyError(this.notesError) ? this.notesError : null;
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
          ${explorerError ? renderMemoryNotice(explorerError) : nothing}
          ${this.notesLoading && !this.notesList
            ? renderExplorerSkeleton()
            : (this.notesList?.notes.length ?? 0) === 0
              ? renderMemoryPlaceholder({
                  icon: icons.folder,
                  label: text.notesListTitle,
                  action: emptyAction,
                  compact: true,
                })
              : html`
                  <div class="alisio-memory-role-groups">
                    ${groups.map((group) => this.renderExplorerGroup(group, text))}
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
              ? renderSurfaceEmptyState({
                  title: text.none,
                  body: text.filesRelatedPages,
                  compact: true,
                  centered: true,
                })
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
        label: text.noteNoSelection,
        detail: text.notesListTitle,
      });
    }
    const revisionTime = formatTimestamp(this.note.revision?.updatedAt);
    return html`
      <article class="alisio-memory-note">
        <header class="alisio-memory-note__header">
          <div class="alisio-memory-note__copy">
            <div class="alisio-memory-note__eyebrow">
              ${this.note.path?.trim() || text.notePath}
            </div>
            ${this.noteMode === "markdown"
              ? html`
                  <label class="sr-only" for="memory-note-title"
                    >${text.notesCreatePlaceholder}</label
                  >
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
                `
              : html`<h1 class="alisio-memory-note__title">${this.note.title}</h1>`}
            <div class="alisio-memory-note__meta">
              ${[revisionTime ? `${text.noteUpdated}: ${revisionTime}` : null]
                .filter(Boolean)
                .map((item) => html`<span>${item}</span>`)}
            </div>
            <span class="alisio-memory-native__chips">
              ${renderMemoryRoleChip(text, this.note)} ${renderReasonTags(this.note.reasonTags)}
            </span>
          </div>
          <div class="alisio-memory-note__actions">
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
                ${text.graphLocal}
              </button>
              ${this.noteMode === "reading"
                ? html`
                    <button
                      class="btn btn--icon btn--ghost"
                      title=${text.noteMarkdown}
                      aria-label=${text.noteMarkdown}
                      @click=${() => (this.noteMode = "markdown")}
                    >
                      ${icons.edit}
                    </button>
                  `
                : html`
                    <button
                      class="btn btn--icon btn--ghost"
                      title=${text.reset}
                      aria-label=${text.reset}
                      @click=${() => {
                        if (!this.note?.id) {
                          return;
                        }
                        this.noteDrafts = { ...this.noteDrafts, [this.note.id]: this.note.content };
                        this.noteTitleDrafts = {
                          ...this.noteTitleDrafts,
                          [this.note.id]: this.note.title,
                        };
                        this.noteMode = "reading";
                      }}
                    >
                      ${icons.x}
                    </button>
                    <button
                      class="btn btn--icon primary"
                      ?disabled=${this.noteSaving}
                      title=${text.save}
                      aria-label=${text.save}
                      @click=${() => {
                        if (this.noteDirty) {
                          void this.saveNote();
                          return;
                        }
                        this.noteMode = "reading";
                      }}
                    >
                      ${this.noteSaving ? icons.refresh : icons.check}
                    </button>
                  `}
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
                <div
                  class="alisio-memory-preview__body sidebar-markdown memory-note__article-markdown"
                  @click=${this.handlePreviewClick}
                >
                  ${unsafeHTML(this.getNotePreviewHtml())}
                </div>
              </div>
            `}
        ${this.renderBacklinks(text, this.note.backlinks)}
        ${this.renderAttachments(text, this.note.attachments)} ${this.renderAttachmentPreview(text)}
      </article>
    `;
  }

  private renderGraphView(text: ReturnType<typeof memoryText>, options?: { compact?: boolean }) {
    const resolvedGraph = this.graphData ?? this.props?.memoryGraph ?? null;
    const resolvedError = resolvedGraph
      ? null
      : sanitizeMemoryNotice(this.graphError ?? this.props?.memoryGraphError ?? null);
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
          graphLoading: text.graphLoading,
          graphUnavailable: text.graphUnavailable,
          graphEmpty: text.graphEmpty,
          graphFocus: text.graphFocus,
          graphGlobal: text.graphGlobal,
          graphLocal: text.graphLocal,
          graphDepth: text.graphDepth,
          graphResetView: text.graphResetView,
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
          graphNodesCount: text.graphNodesCount,
          graphEdgesCount: text.graphEdgesCount,
          graphCenterFocus: text.graphCenterFocus,
          graphShowAttachments: text.graphShowAttachments,
          graphZoomIn: text.graphZoomIn,
          graphZoomOut: text.graphZoomOut,
          graphRelationType: text.graphRelationType,
          graphSource: text.graphSource,
          graphTarget: text.graphTarget,
          graphCanvasHint: text.graphCanvasHint,
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
    return html`
      <section class="alisio-memory-graph-workspace">${this.renderGraphView(text)}</section>
    `;
  }

  render() {
    const props = this.props;
    const text = memoryText();
    if (!props) {
      return nothing;
    }
    const agentsError = sanitizeMemoryNotice(props.agentsError);
    const memoryStatusError = sanitizeMemoryNotice(props.memoryStatusError);

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
          min-height: 240px;
        }
        .alisio-memory-placeholder.empty-state--compact {
          min-height: 140px;
        }
        .alisio-memory-placeholder .empty-state__icon {
          width: 2.5rem;
          height: 2.5rem;
          opacity: 0.82;
        }
        .alisio-memory-placeholder .empty-state__body {
          max-width: 32ch;
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
          grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
          gap: 16px;
          align-items: start;
        }
        .alisio-memory-layout.is-graph-mode {
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
        .alisio-memory-role-groups {
          display: grid;
          gap: 14px;
        }
        .alisio-memory-role-group {
          display: grid;
          gap: 8px;
        }
        .alisio-memory-role-group__header,
        .alisio-memory-role-card {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid transparent;
          color: inherit;
          text-align: left;
        }
        .alisio-memory-role-group__header {
          background: color-mix(in srgb, var(--surface-elevated) 72%, transparent);
          color: var(--text-muted);
          font-size: 0.86rem;
          font-weight: 600;
        }
        .alisio-memory-role-group__title,
        .alisio-memory-role-card__copy {
          min-width: 0;
          flex: 1 1 auto;
        }
        .alisio-memory-role-group__title {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .alisio-memory-role-group__list {
          display: grid;
          gap: 4px;
        }
        .alisio-memory-role-group__icon,
        .alisio-memory-role-card__glyph {
          display: inline-flex;
          width: 16px;
          height: 16px;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          flex: none;
        }
        .alisio-memory-role-group__count,
        .alisio-memory-role-card__meta {
          color: var(--text-muted);
          font-size: 0.78rem;
          flex: none;
        }
        .alisio-memory-role-card {
          cursor: pointer;
          border-color: color-mix(in srgb, var(--border-subtle) 62%, transparent);
          background: color-mix(in srgb, var(--surface-panel) 96%, transparent);
          transition:
            background 140ms ease,
            color 140ms ease,
            border-color 140ms ease;
        }
        .alisio-memory-role-card:hover {
          background: color-mix(in srgb, var(--surface-elevated) 82%, transparent);
        }
        .alisio-memory-role-card.is-active {
          background: color-mix(in srgb, var(--accent-primary) 18%, var(--surface-panel));
          border-color: color-mix(in srgb, var(--accent-primary) 34%, transparent);
        }
        .alisio-memory-role-card__copy {
          display: grid;
          gap: 2px;
        }
        .alisio-memory-role-card__copy strong {
          font-size: 0.94rem;
          font-weight: 600;
        }
        .alisio-memory-role-card__copy span {
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
        .alisio-memory-note__title {
          margin: 0;
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
        .alisio-memory-note__utility-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
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
          .alisio-memory-notes__explorer {
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
          .alisio-memory-note__header {
            flex-direction: column;
          }
          .alisio-memory-note {
            padding: 16px;
          }
          .alisio-memory-note__textarea {
            min-height: 420px;
          }
        }
      </style>
      <section class="alisio-page alisio-memory-page">
        ${this.renderHeader(text)}
        ${agentsError ? renderMemoryNotice(agentsError, "danger") : nothing}
        ${memoryStatusError ? renderMemoryNotice(memoryStatusError) : nothing}
        <div class="alisio-memory-layout ${this.mainPaneMode === "graph" ? "is-graph-mode" : ""}">
          ${this.renderExplorer(text)}
          <section class="alisio-memory-note-area">
            ${this.mainPaneMode === "graph"
              ? this.renderGraphWorkspace(text)
              : this.renderNoteBody(text)}
          </section>
        </div>
      </section>
    `;
  }
}

if (!customElements.get("alisio-memory-native-hub")) {
  customElements.define("alisio-memory-native-hub", AlisioMemoryNativeHub);
}
