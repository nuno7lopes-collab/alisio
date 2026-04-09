import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import {
  buildMemoryNoteName,
  humanizeMemoryNoteTitle,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  LEGACY_MEMORY_FILE_NAME,
  parseMemoryNoteFileName,
  PRIMARY_MEMORY_FILE_NAME,
} from "../memory-files.ts";
import type {
  AgentFileEntry,
  AlisioAiState,
  AgentsFilesListResult,
  AgentsListResult,
  ConfigUiHints,
  MemoryGraphState,
  MemoryStatusState,
} from "../types.ts";
import { normalizeAgentLabel } from "./agents-utils.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
} from "./loading-skeleton.ts";
import { renderMemorySettings } from "./memory-settings.ts";

type MemoryHubProps = {
  aiState: AlisioAiState | null;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  memoryLoading: boolean;
  memoryError: string | null;
  memoryList: AgentsFilesListResult | null;
  memoryActive: string | null;
  memoryContents: Record<string, string>;
  memoryDrafts: Record<string, string>;
  memorySaving: boolean;
  memoryDeleting: boolean;
  memoryStatusLoading: boolean;
  memoryStatusError: string | null;
  memoryStatus: MemoryStatusState | null;
  memorySyncing: boolean;
  memorySyncAvailable: boolean;
  memoryGraphLoading: boolean;
  memoryGraphError: string | null;
  memoryGraph: MemoryGraphState | null;
  memoryGraphQuery: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  configSchema: unknown;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  searchQuery: string;
  composerOpen: boolean;
  composerDate: string;
  composerTitle: string;
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onSelectFile: (name: string) => void;
  onDraftChange: (name: string, content: string) => void;
  onResetFile: (name: string) => void;
  onSaveFile: (name: string) => void;
  onDeleteFile: (name: string) => void;
  onComposerOpenChange: (open: boolean) => void;
  onComposerDateChange: (value: string) => void;
  onComposerTitleChange: (value: string) => void;
  onCreateNote: () => void;
  onSync: () => void;
  onConfigPatch: (path: Array<string | number>, value: unknown) => void;
  onSaveSettings: () => void;
  onUseLocalEmbeddings: () => void;
};

function memoryText() {
  return {
    agent: t("alisio.memory.agent"),
    loading: t("alisio.memory.loading"),
    workspace: t("alisio.memory.workspace"),
    longTerm: t("alisio.memory.longTerm"),
    notes: t("alisio.memory.notes"),
    noteCount: t("alisio.memory.noteCount"),
    longTermCount: t("alisio.memory.longTermCount"),
    lastUpdated: t("alisio.memory.lastUpdated"),
    updatedNever: t("alisio.memory.updatedNever"),
    searchPlaceholder: t("alisio.memory.searchPlaceholder"),
    mainMemory: t("alisio.memory.mainMemory"),
    legacyMemory: t("alisio.memory.legacyMemory"),
    note: t("alisio.memory.note"),
    missing: t("alisio.memory.missing"),
    unsaved: t("alisio.memory.unsaved"),
    refresh: t("common.refresh"),
    newNote: t("alisio.memory.newNote"),
    noteDate: t("alisio.memory.noteDate"),
    noteTitle: t("alisio.memory.noteTitle"),
    noteTitlePlaceholder: t("alisio.memory.noteTitlePlaceholder"),
    notePath: t("alisio.memory.notePath"),
    createNote: t("alisio.memory.createNote"),
    cancelCreate: t("alisio.memory.cancelCreate"),
    content: t("alisio.memory.content"),
    preview: t("alisio.memory.preview"),
    reset: t("alisio.memory.reset"),
    save: t("alisio.memory.save"),
    saving: t("alisio.memory.saving"),
    delete: t("alisio.memory.delete"),
    deleting: t("alisio.memory.deleting"),
    previewEmpty: t("alisio.memory.previewEmpty"),
    missingHint: t("alisio.memory.missingHint"),
    noNotes: t("alisio.memory.noNotes"),
    noMatches: t("alisio.memory.noMatches"),
    emptyAgents: t("alisio.memory.emptyAgents"),
    deleteConfirm: t("alisio.memory.deleteConfirm"),
    syncNow: t("alisio.memory.syncNow"),
    syncing: t("alisio.memory.syncing"),
    statusLoading: t("alisio.memory.statusLoading"),
    enabled: t("common.enabled"),
    disabled: t("common.disabled"),
    backend: t("alisio.memory.backend"),
    provider: t("alisio.memory.provider"),
    indexed: t("alisio.memory.indexed"),
    embedding: t("alisio.memory.embedding"),
    sourcesLabel: t("alisio.memory.sourcesLabel"),
    extraPaths: t("alisio.memory.extraPaths"),
    clean: t("alisio.memory.clean"),
    dirty: t("alisio.memory.dirty"),
    ready: t("alisio.memory.ready"),
    unavailable: t("alisio.memory.unavailable"),
    runtimeUnavailable: t("alisio.memory.runtimeUnavailable"),
    runtimeTitle: t("alisio.memory.runtimeTitle"),
    runtimeSubtitle: t("alisio.memory.runtimeSubtitle"),
    watch: t("alisio.memory.watch"),
    watchOn: t("alisio.memory.watchOn"),
    watchOff: t("alisio.memory.watchOff"),
    searchSync: t("alisio.memory.searchSync"),
    searchSyncOn: t("alisio.memory.searchSyncOn"),
    searchSyncOff: t("alisio.memory.searchSyncOff"),
    store: t("alisio.memory.store"),
    canonicalStore: t("alisio.memory.canonicalStore"),
    canonicalProfile: t("alisio.memory.canonicalProfile"),
    canonicalGraph: t("alisio.memory.canonicalGraph"),
    graphTitle: t("alisio.memory.graphTitle"),
    graphLoading: t("alisio.memory.graphLoading"),
    graphUnavailable: t("alisio.memory.graphUnavailable"),
    graphEmpty: t("alisio.memory.graphEmpty"),
    graphAliases: t("alisio.memory.graphAliases"),
    graphTags: t("alisio.memory.graphTags"),
    graphRelations: t("alisio.memory.graphRelations"),
    vector: t("alisio.memory.vector"),
    fts: t("alisio.memory.fts"),
    obsidianVault: t("alisio.memory.obsidianVault"),
    localFirst: t("alisio.memory.localFirst"),
    localOnly: t("alisio.memory.localOnly"),
    cloudSyncEnabled: t("alisio.memory.cloudSyncEnabled"),
    cloudSyncUnavailable: t("alisio.memory.cloudSyncUnavailable"),
    cloudSyncError: t("alisio.memory.cloudSyncError"),
    entitiesUnit: t("alisio.memory.entitiesUnit"),
    relationsUnit: t("alisio.memory.relationsUnit"),
    projectionsUnit: t("alisio.memory.projectionsUnit"),
    filesUnit: t("alisio.memory.filesUnit"),
    skippedLarge: t("alisio.memory.skippedLarge"),
    builtin: t("alisio.memory.builtin"),
    none: t("common.none"),
    na: t("common.na"),
    sessions: t("tabs.sessions"),
    guidance: {
      oauthTitle: t("alisio.memory.guidance.oauthTitle"),
      oauthBody: t("alisio.memory.guidance.oauthBody"),
      genericTitle: t("alisio.memory.guidance.genericTitle"),
      genericBody: t("alisio.memory.guidance.genericBody"),
      providerTitle: t("alisio.memory.guidance.providerTitle"),
      providerBody: t("alisio.memory.guidance.providerBody"),
      localTitle: t("alisio.memory.guidance.localTitle"),
      localBody: t("alisio.memory.guidance.localBody"),
      useLocal: t("alisio.memory.guidance.useLocal"),
    },
  };
}

function resolveEntryTitle(entry: AgentFileEntry, text: ReturnType<typeof memoryText>) {
  if (entry.name === PRIMARY_MEMORY_FILE_NAME) {
    return text.mainMemory;
  }
  if (entry.name === LEGACY_MEMORY_FILE_NAME) {
    return text.legacyMemory;
  }
  if (isLongTermMemoryFileName(entry.name)) {
    return text.longTerm;
  }
  return humanizeMemoryNoteTitle(entry.name);
}

function resolveEntryMeta(entry: AgentFileEntry, text: ReturnType<typeof memoryText>) {
  if (isLongTermMemoryFileName(entry.name)) {
    return entry.name;
  }
  const parsed = parseMemoryNoteFileName(entry.name);
  if (parsed.date) {
    return parsed.date;
  }
  return text.note;
}

function renderStatsCard(label: string, value: string, detail?: string) {
  return html`
    <div class="alisio-memory-stat">
      <span class="alisio-memory-stat__label">${label}</span>
      <strong class="alisio-memory-stat__value">${value}</strong>
      ${detail ? html`<span class="alisio-memory-stat__detail">${detail}</span>` : nothing}
    </div>
  `;
}

function renderRuntimeMetaItem(label: string, value: string, detail?: string) {
  return html`
    <div class="alisio-memory-runtime__meta-item">
      <span class="alisio-memory-runtime__meta-label">${label}</span>
      <strong class="alisio-memory-runtime__meta-value">${value}</strong>
      ${detail ? html`<span class="alisio-memory-runtime__meta-detail">${detail}</span>` : nothing}
    </div>
  `;
}

function renderGraphPreview(params: {
  query: string | null;
  graph: MemoryGraphState | null;
  loading: boolean;
  error: string | null;
  text: ReturnType<typeof memoryText>;
  onSelectFile: (name: string) => void;
}) {
  if (!params.query && !params.loading && !params.error && !params.graph) {
    return nothing;
  }
  return html`
    <section class="alisio-memory-runtime">
      <div class="alisio-memory-runtime__header">
        <div class="alisio-memory-runtime__copy"><h3>${params.text.graphTitle}</h3></div>
        ${params.query
          ? html`
              <div class="alisio-memory-runtime__actions">
                <span class="alisio-memory-badge">${params.query}</span>
              </div>
            `
          : nothing}
      </div>
      ${params.loading
        ? html`
            <div class="alisio-memory-runtime__empty">
              ${renderSkeletonLines(["short", "medium"], { compact: true })}
              <span>${params.text.graphLoading}</span>
            </div>
          `
        : params.error
          ? html`<div class="alisio-memory-runtime__empty">${params.error}</div>`
          : !params.graph || params.graph.matches.length === 0
            ? html`<div class="alisio-memory-runtime__empty">${params.text.graphEmpty}</div>`
            : html`
                <div class="alisio-memory-runtime__stats">
                  ${params.graph.matches.map(
                    (match) => html`
                      <div class="alisio-memory-stat">
                        <span class="alisio-memory-stat__label">${match.sourcePath}</span>
                        <button
                          type="button"
                          class="alisio-memory-graph-node alisio-memory-graph-node--active"
                          @click=${() => params.onSelectFile(match.sourcePath)}
                        >
                          ${match.title}
                        </button>
                        <span class="alisio-memory-stat__detail">
                          ${params.text.graphAliases}:
                          ${joinValues(match.aliases, params.text.none)}
                        </span>
                        <span class="alisio-memory-stat__detail">
                          ${params.text.graphTags}: ${joinValues(match.tags, params.text.none)}
                        </span>
                        <div class="alisio-memory-graph">
                          <span class="alisio-memory-stat__detail">
                            ${params.text.graphRelations}:
                          </span>
                          ${match.relations.length === 0
                            ? html`
                                <span class="alisio-memory-stat__detail">${params.text.none}</span>
                              `
                            : match.relations.map(
                                (relation) => html`
                                  <div class="alisio-memory-graph__edge">
                                    <span class="alisio-memory-graph__direction">
                                      ${relation.direction === "outgoing" ? "→" : "←"}
                                    </span>
                                    <span class="alisio-memory-graph__relation">
                                      ${relation.relationType}
                                    </span>
                                    ${relation.relatedEntity?.sourcePath
                                      ? html`
                                          <button
                                            type="button"
                                            class="alisio-memory-graph-node"
                                            @click=${() =>
                                              params.onSelectFile(
                                                relation.relatedEntity!.sourcePath,
                                              )}
                                          >
                                            ${relation.relatedEntity.title}
                                          </button>
                                        `
                                      : html`
                                          <span class="alisio-memory-graph__locator">
                                            ${relation.targetLocator ?? params.text.na}
                                          </span>
                                        `}
                                  </div>
                                `,
                              )}
                        </div>
                      </div>
                    `,
                  )}
                </div>
              `}
    </section>
  `;
}

function joinValues(values: readonly string[], fallback: string) {
  const filtered = values.map((value) => value.trim()).filter(Boolean);
  return filtered.length > 0 ? filtered.join(", ") : fallback;
}

function resolveSourceLabel(source: "memory" | "sessions", text: ReturnType<typeof memoryText>) {
  return source === "memory" ? text.longTerm : text.sessions;
}

function resolveEmbeddingLabel(
  embedding: MemoryStatusState["embedding"] | null | undefined,
  text: ReturnType<typeof memoryText>,
) {
  if (!embedding) {
    return text.unavailable;
  }
  return embedding.ok ? text.ready : text.unavailable;
}

function sanitizeLegacyStatePath(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value.replace(/(^|[\\/])\.(openclaw|clawdbot)(?=([\\/]|$))/g, "$1.alisio");
}

function resolveCloudSyncLabel(
  cloudSync: "enabled" | "error" | "unavailable" | null | undefined,
  text: ReturnType<typeof memoryText>,
) {
  switch (cloudSync) {
    case "enabled":
      return text.cloudSyncEnabled;
    case "error":
      return text.cloudSyncError;
    case "unavailable":
    default:
      return text.cloudSyncUnavailable;
  }
}

function isCodexOAuthActive(aiState: AlisioAiState | null | undefined): boolean {
  return (
    aiState?.provider === "openai" &&
    (aiState.status === "connected" || aiState.status === "limits_unavailable")
  );
}

function formatProviderName(provider: string | null | undefined): string {
  const normalized = provider?.trim().toLowerCase() ?? "";
  switch (normalized) {
    case "openai":
      return "OpenAI";
    case "gemini":
      return "Gemini";
    case "voyage":
      return "Voyage";
    case "mistral":
      return "Mistral";
    case "ollama":
      return "Ollama";
    case "local":
      return "Local embeddings";
    default:
      return provider?.trim() || "embeddings";
  }
}

type MemoryGuidance = {
  tone: "info" | "warning";
  title: string;
  body: string;
  actionLabel?: string;
};

function buildEmbeddingGuidance(params: {
  aiState: AlisioAiState | null;
  status: MemoryStatusState | null;
  text: ReturnType<typeof memoryText>;
}): MemoryGuidance | null {
  const status = params.status;
  if (!status?.enabled || status.embedding.ok) {
    return null;
  }

  const rawError = sanitizeLegacyStatePath(status.embedding.error ?? "");
  if (!rawError) {
    return null;
  }

  const missingApiKey = rawError.includes("No API key found for provider");
  const missingProvider =
    rawError.includes("No embedding provider available") ||
    rawError.includes("No embeddings provider available");
  const localUnavailable = rawError.includes("Local embeddings unavailable.");
  const requestedProvider = status.runtime?.requestedProvider ?? status.config?.provider ?? null;
  const explicitProvider =
    requestedProvider && requestedProvider !== "auto" ? requestedProvider : null;

  if (
    isCodexOAuthActive(params.aiState) &&
    !explicitProvider &&
    (missingApiKey || missingProvider)
  ) {
    return {
      tone: "warning",
      title: params.text.guidance.oauthTitle,
      body: params.text.guidance.oauthBody,
      actionLabel: params.text.guidance.useLocal,
    };
  }

  if (explicitProvider && explicitProvider !== "local" && missingApiKey) {
    return {
      tone: "warning",
      title: params.text.guidance.providerTitle,
      body: params.text.guidance.providerBody.replace(
        "{provider}",
        formatProviderName(explicitProvider),
      ),
    };
  }

  if (explicitProvider === "local" && localUnavailable) {
    return {
      tone: "warning",
      title: params.text.guidance.localTitle,
      body: params.text.guidance.localBody,
    };
  }

  if (!explicitProvider && (missingApiKey || missingProvider)) {
    return {
      tone: "info",
      title: params.text.guidance.genericTitle,
      body: params.text.guidance.genericBody,
    };
  }

  return null;
}

function resolveBackendLabel(
  status: MemoryStatusState | null | undefined,
  text: ReturnType<typeof memoryText>,
) {
  const backend = status?.backend?.backend ?? status?.runtime?.backend ?? null;
  if (backend === "builtin") {
    return text.builtin;
  }
  if (backend === "qmd") {
    return "QMD";
  }
  return text.na;
}

function renderRuntimeCard(params: {
  text: ReturnType<typeof memoryText>;
  status: MemoryStatusState | null;
  loading: boolean;
  error: string | null;
  aiState: AlisioAiState | null;
  syncing: boolean;
  canSync: boolean;
  onSync: () => void;
  onUseLocalEmbeddings: () => void;
}) {
  const { text, status } = params;
  const config = status?.config;
  const runtime = status?.runtime;
  const embeddingError = !status?.embedding.ok ? (status?.embedding.error ?? null) : null;
  const runtimeErrorRaw =
    params.error ?? status?.configError ?? status?.managerError ?? embeddingError;
  const runtimeError = sanitizeLegacyStatePath(runtimeErrorRaw);
  const guidance =
    runtimeErrorRaw && runtimeErrorRaw === embeddingError
      ? buildEmbeddingGuidance({
          aiState: params.aiState,
          status,
          text,
        })
      : null;
  const runtimeErrorTone =
    runtimeError && runtimeError.includes("não expõe")
      ? "info"
      : status?.enabled
        ? "danger"
        : "info";
  const sourceValues = runtime?.sourceCounts?.length
    ? runtime.sourceCounts.map(
        (entry) => `${resolveSourceLabel(entry.source, text)} ${entry.files}/${entry.chunks}`,
      )
    : (config?.sources ?? []).map((source) => resolveSourceLabel(source, text));
  const indexedValue =
    typeof runtime?.files === "number"
      ? String(runtime.files)
      : status
        ? text.na
        : text.unavailable;
  const indexedDetail = joinValues(
    [
      typeof runtime?.chunks === "number" ? `${runtime.chunks} chunks` : "",
      typeof runtime?.dirty === "boolean" ? (runtime.dirty ? text.dirty : text.clean) : "",
    ],
    text.na,
  );
  const sourceDetail = config?.extraPaths.length
    ? `${text.extraPaths}: ${joinValues(
        config.extraPaths.map((entry) => sanitizeLegacyStatePath(entry)),
        text.none,
      )}`
    : undefined;
  const storeDetail = sanitizeLegacyStatePath(runtime?.dbPath ?? config?.store.path ?? text.na);
  const obsidianVaultDetail = runtime?.obsidianReadOnly
    ? sanitizeLegacyStatePath(
        joinValues(
          [
            runtime.obsidianReadOnly.vaultPath,
            `${runtime.obsidianReadOnly.indexedFiles} ${text.filesUnit}`,
            runtime.obsidianReadOnly.skippedLargeFiles > 0
              ? `${runtime.obsidianReadOnly.skippedLargeFiles} ${text.skippedLarge}`
              : "",
            runtime.obsidianReadOnly.error ?? "",
          ],
          text.na,
        ),
      )
    : undefined;
  const canonicalStoreDetail = runtime?.canonicalStore
    ? sanitizeLegacyStatePath(runtime.canonicalStore.path)
    : undefined;
  const canonicalProfileDetail = runtime?.canonicalStore
    ? `${runtime.canonicalStore.syncMode === "local-first" ? text.localFirst : text.localOnly} · ${resolveCloudSyncLabel(runtime.canonicalStore.cloudSync, text)}`
    : undefined;
  const canonicalGraphDetail = runtime?.canonicalStore
    ? `${runtime.canonicalStore.relations} ${text.relationsUnit} · ${runtime.canonicalStore.projections} ${text.projectionsUnit}`
    : undefined;
  const embeddingDetail =
    guidance || !embeddingError ? undefined : sanitizeLegacyStatePath(embeddingError);
  const backendDetail =
    status?.backend?.backend === "qmd"
      ? sanitizeLegacyStatePath(status.backend.command ?? undefined)
      : undefined;
  const providerValue = runtime?.provider ?? config?.provider ?? text.na;
  const providerLabel = providerValue === text.na ? text.na : formatProviderName(providerValue);
  const runtimeSummaryItems = [
    {
      label: text.backend,
      value: resolveBackendLabel(status, text),
      detail:
        providerLabel === text.na
          ? backendDetail
          : joinValues(
              [providerLabel, runtime?.model ?? config?.model ?? "", config?.fallback ?? ""],
              "",
            ) || backendDetail,
    },
    {
      label: text.indexed,
      value: indexedValue,
      detail: indexedDetail === text.na ? undefined : indexedDetail,
    },
    {
      label: text.embedding,
      value: resolveEmbeddingLabel(status?.embedding, text),
      detail: guidance
        ? guidance.title
        : (embeddingDetail ?? (providerLabel === text.na ? undefined : providerLabel)),
    },
    ...(runtime?.canonicalStore
      ? [
          {
            label: text.canonicalProfile,
            value: runtime.canonicalStore.profileId,
            detail: canonicalProfileDetail,
          },
          {
            label: text.canonicalGraph,
            value: `${runtime.canonicalStore.entities} ${text.entitiesUnit}`,
            detail: canonicalGraphDetail,
          },
        ]
      : []),
  ];
  const runtimeMetaItems = [
    {
      label: text.sourcesLabel,
      value: joinValues(sourceValues, text.none),
      detail: sourceDetail,
    },
    {
      label: text.store,
      value: config ? `${config.store.driver} · ${config.store.ftsTokenizer}` : text.na,
      detail: storeDetail === text.na ? undefined : storeDetail,
    },
    ...(runtime?.canonicalStore
      ? [
          {
            label: text.canonicalStore,
            value: runtime.canonicalStore.state === "ready" ? text.ready : text.unavailable,
            detail: canonicalStoreDetail === text.na ? undefined : canonicalStoreDetail,
          },
        ]
      : []),
    ...(runtime?.obsidianReadOnly
      ? [
          {
            label: text.obsidianVault,
            value: runtime.obsidianReadOnly.active ? text.ready : text.unavailable,
            detail: obsidianVaultDetail === text.na ? undefined : obsidianVaultDetail,
          },
        ]
      : []),
  ];

  return html`
    <section class="alisio-memory-runtime">
      <div class="alisio-memory-runtime__header">
        <div class="alisio-memory-runtime__copy"><h3>${text.runtimeTitle}</h3></div>
        <div class="alisio-memory-runtime__actions">
          ${status
            ? html`
                <span class="alisio-memory-badge">
                  ${status.enabled ? text.enabled : text.disabled}
                </span>
                ${typeof runtime?.dirty === "boolean"
                  ? html`
                      <span class="alisio-memory-badge">
                        ${runtime.dirty ? text.dirty : text.clean}
                      </span>
                    `
                  : nothing}
              `
            : nothing}
          <button
            class="btn btn--sm"
            ?disabled=${params.loading || params.syncing || !params.canSync}
            @click=${params.onSync}
          >
            ${params.syncing ? text.syncing : text.syncNow}
          </button>
        </div>
      </div>

      ${params.loading
        ? html`
            <div class="alisio-memory-runtime__empty">
              ${renderSkeletonLines(["short", "medium"], { compact: true })}
              <span>${text.statusLoading}</span>
            </div>
          `
        : !status
          ? html`
              <div class="alisio-memory-runtime__empty">
                ${sanitizeLegacyStatePath(params.error) || text.runtimeUnavailable}
              </div>
            `
          : html`
              <div class="alisio-memory-runtime__stats">
                ${runtimeSummaryItems.map((item) =>
                  renderStatsCard(item.label, item.value, item.detail),
                )}
              </div>

              ${guidance
                ? html`
                    <div class="callout ${guidance.tone}">
                      <strong>${guidance.title}</strong>
                      <p>${guidance.body}</p>
                      ${guidance.actionLabel
                        ? html`
                            <div class="alisio-memory-runtime__actions" style="margin-top: 12px;">
                              <button class="btn btn--sm" @click=${params.onUseLocalEmbeddings}>
                                ${guidance.actionLabel}
                              </button>
                            </div>
                          `
                        : nothing}
                    </div>
                  `
                : runtimeError
                  ? html` <div class="callout ${runtimeErrorTone}">${runtimeError}</div> `
                  : nothing}

              <div class="alisio-memory-runtime__meta">
                ${runtimeMetaItems.map((item) =>
                  renderRuntimeMetaItem(item.label, item.value, item.detail),
                )}
              </div>
            `}
    </section>
  `;
}

function renderFileList(params: {
  title: string;
  files: AgentFileEntry[];
  activeName: string | null;
  text: ReturnType<typeof memoryText>;
  emptyLabel: string;
  onSelectFile: (name: string) => void;
}) {
  return html`
    <section class="alisio-memory-group">
      <div class="alisio-memory-group__header">
        <h2>${params.title}</h2>
      </div>
      ${params.files.length === 0
        ? html`<div class="alisio-memory-empty">${params.emptyLabel}</div>`
        : html`
            <div class="alisio-memory-file-list">
              ${params.files.map((entry) => {
                const active = params.activeName === entry.name;
                return html`
                  <button
                    type="button"
                    class="alisio-memory-file ${active ? "is-active" : ""}"
                    aria-current=${active ? "true" : "false"}
                    @click=${() => params.onSelectFile(entry.name)}
                  >
                    <span class="alisio-memory-file__copy">
                      <span class="alisio-memory-file__title">
                        ${resolveEntryTitle(entry, params.text)}
                      </span>
                      <span class="alisio-memory-file__meta">
                        ${resolveEntryMeta(entry, params.text)}
                      </span>
                    </span>
                    <span class="alisio-memory-file__status">
                      ${entry.missing
                        ? html`<span class="alisio-memory-badge">${params.text.missing}</span>`
                        : entry.updatedAtMs
                          ? formatRelativeTimestamp(entry.updatedAtMs)
                          : params.text.updatedNever}
                    </span>
                  </button>
                `;
              })}
            </div>
          `}
    </section>
  `;
}

export function renderMemoryHub(props: MemoryHubProps) {
  const text = memoryText();
  const agents = props.agentsList?.agents ?? [];
  const selectedAgentId = props.selectedAgentId;
  const selectedAgent = selectedAgentId
    ? (agents.find((agent) => agent.id === selectedAgentId) ?? null)
    : null;
  const selectedAgentLabel = selectedAgent ? normalizeAgentLabel(selectedAgent) : null;
  const list = props.memoryList?.agentId === selectedAgentId ? props.memoryList : null;
  const status = props.memoryStatus?.agentId === selectedAgentId ? props.memoryStatus : null;
  const files = list?.files ?? [];
  const longTermFiles = files.filter((entry) => isLongTermMemoryFileName(entry.name));
  const noteFiles = files.filter((entry) => isMemoryNoteFileName(entry.name));
  const activeName = props.memoryActive;
  const activeEntry = activeName ? (files.find((file) => file.name === activeName) ?? null) : null;
  const displayedEntry =
    activeEntry ??
    longTermFiles.find((entry) => !entry.missing) ??
    noteFiles.find((entry) => !entry.missing) ??
    files[0] ??
    null;
  const displayedName = displayedEntry?.name ?? null;
  const baseContent = displayedName ? (props.memoryContents[displayedName] ?? "") : "";
  const draft = displayedName ? (props.memoryDrafts[displayedName] ?? baseContent) : "";
  const isDirty = displayedName ? draft !== baseContent : false;
  const availableNoteCount = noteFiles.filter((entry) => !entry.missing).length;
  const filteredNoteFiles = props.searchQuery.trim()
    ? noteFiles.filter((entry) => {
        const query = props.searchQuery.trim().toLowerCase();
        return (
          entry.name.toLowerCase().includes(query) ||
          humanizeMemoryNoteTitle(entry.name).toLowerCase().includes(query)
        );
      })
    : noteFiles;
  const updatedAtValues = files
    .map((entry) => entry.updatedAtMs ?? 0)
    .filter((value) => value > 0)
    .toSorted((left, right) => right - left);
  const latestUpdatedAt = updatedAtValues[0] ?? null;
  const composerPath = buildMemoryNoteName(
    props.composerDate,
    props.composerTitle,
    files.map((entry) => entry.name),
  );

  if (props.agentsLoading && agents.length === 0) {
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
            ${renderSkeletonListItem({ lines: ["short", "medium"] })}
          </div>
        </div>
      </section>
    `;
  }

  return html`
    <section class="alisio-page alisio-memory-page">
      <div class="alisio-memory-shell">
        <aside class="alisio-memory-sidebar">
          <div class="alisio-memory-sidebar__top">
            <div class="alisio-memory-sidebar__agent-row">
              <label class="field">
                <span>${text.agent}</span>
                <select
                  .value=${selectedAgentId ?? ""}
                  ?disabled=${agents.length === 0}
                  @change=${(event: Event) =>
                    props.onSelectAgent((event.target as HTMLSelectElement).value)}
                >
                  ${agents.length === 0
                    ? html`<option value="">${text.emptyAgents}</option>`
                    : agents.map(
                        (agent) =>
                          html`<option value=${agent.id}>${normalizeAgentLabel(agent)}</option>`,
                      )}
                </select>
              </label>
              <button
                class="btn btn--icon btn--ghost alisio-memory-refresh"
                title=${text.refresh}
                aria-label=${text.refresh}
                @click=${props.onRefresh}
              >
                ${icons.refresh}
              </button>
            </div>
            <div class="alisio-memory-toolbar">
              <label class="field field--with-icon alisio-memory-search">
                <span class="sr-only">${t("common.search")}</span>
                <span class="field__icon" aria-hidden="true">${icons.search}</span>
                <input
                  .value=${props.searchQuery}
                  placeholder=${text.searchPlaceholder}
                  @input=${(event: Event) =>
                    props.onSearchChange((event.target as HTMLInputElement).value)}
                />
              </label>
              <button
                class="btn btn--sm primary"
                ?disabled=${!selectedAgentId}
                @click=${() => props.onComposerOpenChange(!props.composerOpen)}
              >
                ${icons.plus} ${text.newNote}
              </button>
            </div>
            ${props.agentsError
              ? html`<div class="callout danger">${props.agentsError}</div>`
              : nothing}
            ${props.memoryError
              ? html`<div class="callout danger">${props.memoryError}</div>`
              : nothing}
            ${props.composerOpen
              ? html`
                  <div class="alisio-memory-composer">
                    <label class="field">
                      <span>${text.noteDate}</span>
                      <input
                        type="date"
                        .value=${props.composerDate}
                        @input=${(event: Event) =>
                          props.onComposerDateChange((event.target as HTMLInputElement).value)}
                      />
                    </label>
                    <label class="field">
                      <span>${text.noteTitle}</span>
                      <input
                        .value=${props.composerTitle}
                        placeholder=${text.noteTitlePlaceholder}
                        @input=${(event: Event) =>
                          props.onComposerTitleChange((event.target as HTMLInputElement).value)}
                      />
                    </label>
                    <div class="alisio-memory-composer__path">
                      <span>${text.notePath}</span>
                      <code>${composerPath}</code>
                    </div>
                    <div class="alisio-memory-composer__actions">
                      <button class="btn btn--sm" @click=${() => props.onComposerOpenChange(false)}>
                        ${text.cancelCreate}
                      </button>
                      <button
                        class="btn btn--sm primary"
                        ?disabled=${!selectedAgentId}
                        @click=${props.onCreateNote}
                      >
                        ${text.createNote}
                      </button>
                    </div>
                  </div>
                `
              : nothing}
          </div>

          <div class="alisio-memory-stats">
            ${renderStatsCard(
              text.longTermCount,
              String(longTermFiles.filter((file) => !file.missing).length),
            )}
            ${renderStatsCard(text.noteCount, String(availableNoteCount))}
            ${renderStatsCard(
              text.lastUpdated,
              latestUpdatedAt ? formatRelativeTimestamp(latestUpdatedAt) : text.updatedNever,
            )}
          </div>

          ${renderFileList({
            title: text.longTerm,
            files: longTermFiles,
            activeName: displayedName,
            text,
            emptyLabel: text.missing,
            onSelectFile: props.onSelectFile,
          })}
          ${renderFileList({
            title: text.notes,
            files: filteredNoteFiles,
            activeName: displayedName,
            text,
            emptyLabel: props.searchQuery.trim() ? text.noMatches : text.noNotes,
            onSelectFile: props.onSelectFile,
          })}
        </aside>

        <div class="alisio-memory-main">
          ${selectedAgentId
            ? renderRuntimeCard({
                text,
                status,
                loading: props.memoryStatusLoading,
                error: props.memoryStatusError,
                aiState: props.aiState,
                syncing: props.memorySyncing,
                canSync: props.memorySyncAvailable && Boolean(status?.enabled),
                onSync: props.onSync,
                onUseLocalEmbeddings: props.onUseLocalEmbeddings,
              })
            : nothing}
          ${selectedAgentId
            ? renderGraphPreview({
                query: props.memoryGraphQuery,
                graph: props.memoryGraph,
                loading: props.memoryGraphLoading,
                error: props.memoryGraphError,
                text,
                onSelectFile: props.onSelectFile,
              })
            : nothing}
          ${!selectedAgentId
            ? html`
                <div class="alisio-memory-panel alisio-memory-panel--empty">
                  <div class="card-title">${text.emptyAgents}</div>
                </div>
              `
            : props.memoryLoading && !list
              ? html`
                  <div class="alisio-memory-panel alisio-memory-panel--empty">
                    <div class="card-title">${text.loading}</div>
                  </div>
                `
              : !displayedEntry
                ? html`
                    <div class="alisio-memory-panel alisio-memory-panel--empty">
                      <div class="card-title">${text.noNotes}</div>
                    </div>
                  `
                : html`
                    <header class="alisio-memory-header">
                      <div class="alisio-memory-header__copy">
                        <div class="alisio-memory-header__eyebrow">
                          ${isLongTermMemoryFileName(displayedEntry.name)
                            ? text.longTerm
                            : text.note}
                          ${displayedEntry.missing
                            ? html`<span class="alisio-memory-badge">${text.missing}</span>`
                            : nothing}
                          ${isDirty
                            ? html`<span class="alisio-memory-badge">${text.unsaved}</span>`
                            : nothing}
                        </div>
                        <h2>${resolveEntryTitle(displayedEntry, text)}</h2>
                        <p>
                          <span>${sanitizeLegacyStatePath(displayedEntry.name)}</span>
                          <span>
                            ${displayedEntry.updatedAtMs
                              ? formatRelativeTimestamp(displayedEntry.updatedAtMs)
                              : text.updatedNever}
                          </span>
                        </p>
                      </div>
                      <div class="alisio-memory-header__actions">
                        ${isMemoryNoteFileName(displayedEntry.name)
                          ? html`
                              <button
                                class="btn btn--sm danger"
                                ?disabled=${props.memoryDeleting}
                                @click=${() => {
                                  if (window.confirm(text.deleteConfirm)) {
                                    props.onDeleteFile(displayedEntry.name);
                                  }
                                }}
                              >
                                ${props.memoryDeleting ? text.deleting : text.delete}
                              </button>
                            `
                          : nothing}
                        <button
                          class="btn btn--sm"
                          ?disabled=${!isDirty}
                          @click=${() => props.onResetFile(displayedEntry.name)}
                        >
                          ${text.reset}
                        </button>
                        <button
                          class="btn btn--sm primary"
                          ?disabled=${props.memorySaving || !isDirty}
                          @click=${() => props.onSaveFile(displayedEntry.name)}
                        >
                          ${props.memorySaving ? text.saving : text.save}
                        </button>
                      </div>
                    </header>

                    ${displayedEntry.missing
                      ? html`<div class="callout info">${text.missingHint}</div>`
                      : nothing}

                    <div class="alisio-memory-editor">
                      <label class="field alisio-memory-editor__pane">
                        <span>${text.content}</span>
                        <textarea
                          class="alisio-memory-textarea"
                          .value=${draft}
                          @input=${(event: Event) =>
                            props.onDraftChange(
                              displayedEntry.name,
                              (event.target as HTMLTextAreaElement).value,
                            )}
                        ></textarea>
                      </label>
                      <section class="alisio-memory-preview">
                        <div class="alisio-memory-preview__label">${text.preview}</div>
                        ${draft.trim()
                          ? html`
                              <div class="alisio-memory-preview__body sidebar-markdown">
                                ${unsafeHTML(toSanitizedMarkdownHtml(draft))}
                              </div>
                            `
                          : html`
                              <div class="alisio-memory-preview__empty">
                                ${renderSkeletonLines(["medium"], { compact: true })}
                                <span>${text.previewEmpty}</span>
                              </div>
                            `}
                      </section>
                    </div>
                  `}
          ${selectedAgentId
            ? renderMemorySettings({
                loading: props.configLoading,
                saving: props.configSaving,
                dirty: props.configDirty,
                schema: props.configSchema,
                uiHints: props.configUiHints,
                value: props.configForm,
                selectedAgentId,
                selectedAgentLabel,
                onPatch: props.onConfigPatch,
                onSave: props.onSaveSettings,
              })
            : nothing}
        </div>
      </div>
    </section>
  `;
}
