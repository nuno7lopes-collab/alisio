import { t } from "../../i18n/index.ts";
import { GatewayRequestError } from "../gateway.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { MemoryGraphState, MemoryStatusState, MemorySyncResult } from "../types.ts";

export type MemoryReasonTag = {
  code: string;
  label?: string;
  detail?: string;
};

export type MemoryNoteTaxonomyFields = {
  summary?: string | null;
  tags?: string[] | null;
  categories?: string[] | null;
  collections?: string[] | null;
  featured?: boolean | null;
};

export type MemorySyncSurface = {
  lastSyncedLamport?: string | number | null;
  e2eeRequired?: boolean | null;
  state?: string | null;
  mode?: string | null;
  blockedReason?: string | null;
  lastSuccessAt?: string | null;
  lastAckLamport?: string | number | null;
  pendingBacklog?: number | null;
  detail?: string | null;
};

export type MemoryNoteListEntry = MemoryNoteTaxonomyFields & {
  id: string;
  title: string;
  slug?: string | null;
  path?: string | null;
  excerpt?: string | null;
  updatedAt?: string | null;
  reasonTags?: MemoryReasonTag[] | null;
  traceId?: string | null;
  trace?: unknown;
  traceSummary?: string[] | null;
  backlinks?: number | null;
  claims?: number | null;
  evidence?: number | null;
};

export type MemoryNotesListResult = {
  agentId: string;
  notes: MemoryNoteListEntry[];
  sync?: MemorySyncSurface | null;
  exportFormats?: string[] | null;
};

export type MemoryNoteBacklink = {
  id?: string | null;
  title: string;
  path?: string | null;
  excerpt?: string | null;
};

export type MemoryEvidenceItem = {
  id?: string | null;
  title?: string | null;
  excerpt?: string | null;
  source?: string | null;
  provenance?: Array<{ label: string; value: string }> | null;
};

export type MemoryClaimItem = {
  id?: string | null;
  claim: string;
  confidence?: number | string | null;
  evidence?: MemoryEvidenceItem[] | null;
};

export type MemoryNoteAttachment = {
  id?: string | null;
  name: string;
  mediaType?: string | null;
  updatedAt?: string | null;
  provenanceSummary?: string | null;
};

export type MemoryNote = MemoryNoteTaxonomyFields & {
  id: string;
  title: string;
  slug?: string | null;
  path?: string | null;
  content: string;
  backlinks?: MemoryNoteBacklink[] | null;
  claims?: MemoryClaimItem[] | null;
  evidence?: MemoryEvidenceItem[] | null;
  attachments?: MemoryNoteAttachment[] | null;
  provenance?: Array<{ label: string; value: string }> | null;
  reasonTags?: MemoryReasonTag[] | null;
  traceId?: string | null;
  trace?: unknown;
  traceSummary?: string[] | null;
  contextPreview?: {
    summary?: string | null;
    reasonTags?: MemoryReasonTag[] | null;
    traceId?: string | null;
    trace?: unknown;
    traceSummary?: string[] | null;
  } | null;
  revision?: {
    eventId?: string | null;
    lamport?: string | number | null;
    updatedAt?: string | null;
    author?: string | null;
    summary?: string | null;
  } | null;
};

export type MemoryNotesGetResult = {
  agentId: string;
  note: MemoryNote;
  sync?: MemorySyncSurface | null;
};

export type MemoryNoteHistoryEntry = {
  eventId: string;
  lamport?: string | number | null;
  at?: string | null;
  author?: string | null;
  operation?: string | null;
  summary?: string | null;
  diffSummary?: string | null;
};

export type MemoryNotesHistoryResult = {
  agentId: string;
  noteId: string;
  history: MemoryNoteHistoryEntry[];
};

export type MemoryNotesUpdateResult = {
  ok: boolean;
  agentId: string;
  note?: MemoryNote | null;
  revision?: MemoryNote["revision"] | null;
  sync?: MemorySyncSurface | null;
};

export type MemoryWikiTaxonomyFields = MemoryNoteTaxonomyFields;
export type MemoryWikiListPage = MemoryNoteListEntry;
export type MemoryWikiListResult = {
  agentId: string;
  pages: MemoryWikiListPage[];
  sync?: MemorySyncSurface | null;
  exportFormats?: string[] | null;
};
export type MemoryWikiBacklink = MemoryNoteBacklink;
export type MemoryWikiRelatedFile = MemoryNoteAttachment;
export type MemoryWikiPage = Omit<MemoryNote, "attachments"> & {
  relatedFiles?: MemoryWikiRelatedFile[] | null;
};
export type MemoryWikiGetResult = {
  agentId: string;
  page: MemoryWikiPage;
  sync?: MemorySyncSurface | null;
};
export type MemoryWikiHistoryEntry = MemoryNoteHistoryEntry;
export type MemoryWikiHistoryResult = {
  agentId: string;
  pageId: string;
  history: MemoryWikiHistoryEntry[];
};
export type MemoryWikiUpdateResult = {
  ok: boolean;
  agentId: string;
  page?: MemoryWikiPage | null;
  revision?: MemoryWikiPage["revision"] | null;
  sync?: MemorySyncSurface | null;
};

export type MemoryFilePreviewKind =
  | "markdown"
  | "text"
  | "json"
  | "image"
  | "audio"
  | "pdf"
  | "binary";

export type MemoryFileLink = {
  pageId: string;
  entityId: string;
  title: string;
  path: string;
  relation: "attached" | "mentioned";
};

export type MemoryFileOrigin = {
  eventId: string;
  lamport: number;
  actorId: string;
  createdAt?: string | null;
  pageId?: string | null;
  entityId?: string | null;
  pageTitle?: string | null;
  pagePath?: string | null;
};

export type MemoryFilePreview = {
  kind: MemoryFilePreviewKind;
  mediaType: string;
  lineCount?: number | null;
  text?: string | null;
  bytesBase64?: string | null;
  truncated?: boolean | null;
  fallbackLabel?: string | null;
};

export type MemoryFileDownload = {
  fileName: string;
  mediaType: string;
  bytesBase64: string;
};

export type MemoryFileListEntry = {
  id: string;
  name: string;
  mediaType: string;
  previewKind: MemoryFilePreviewKind;
  size: number;
  sha256: string;
  updatedAt?: string | null;
  summary: string;
  provenanceSummary: string;
  relatedPagesCount: number;
  primaryPage?: MemoryFileLink | null;
  origin?: MemoryFileOrigin | null;
  provenance: Array<{ label: string; value: string }>;
  reasonTags?: MemoryReasonTag[] | null;
  trace?: unknown;
  traceSummary?: string[] | null;
};

export type MemoryFilesListResult = {
  agentId: string;
  files: MemoryFileListEntry[];
  sync?: MemorySyncSurface | null;
};

export type MemoryFileDetail = MemoryFileListEntry & {
  preview: MemoryFilePreview;
  download: MemoryFileDownload;
  relatedPages: MemoryFileLink[];
};

export type MemoryFilesGetResult = {
  agentId: string;
  file: MemoryFileDetail;
  sync?: MemorySyncSurface | null;
};

export type MemoryTraceResult = {
  traceId?: string | null;
  summary?: string[] | null;
  reasonTags?: MemoryReasonTag[] | null;
  raw: unknown;
};

export type MemoryExportFormat = "zip" | "json" | "markdown";

export type MemoryExportResult = {
  format: string;
  fileName?: string | null;
  mediaType?: string | null;
  content?: string | null;
  bytesBase64?: string | null;
  downloadUrl?: string | null;
  savedPath?: string | null;
  message?: string | null;
};

export class MemoryEndpointUnavailableError extends Error {
  readonly method: string;

  constructor(method: string, message: string) {
    super(message);
    this.name = "MemoryEndpointUnavailableError";
    this.method = method;
  }
}

type CacheableMemoryRequestOptions = {
  force?: boolean;
};

type MemoryRequestCacheEntry<T> = {
  value?: T;
  cachedAt?: number;
  inFlight?: Promise<T>;
};

type MemoryStatusCacheEntry = {
  agentId: string;
  value: MemoryStatusState | null;
  cachedAt: number;
};

const NOTES_LIST_CACHE_TTL_MS = 30_000;
const NOTE_CACHE_TTL_MS = 30_000;
const FILE_CACHE_TTL_MS = 30_000;
const GRAPH_CACHE_TTL_MS = 20_000;
const MEMORY_STATUS_CACHE_TTL_MS = 10_000;

const endpointRequestCache = new WeakMap<
  GatewayBrowserClient,
  Map<string, MemoryRequestCacheEntry<unknown>>
>();
const memoryStatusCache = new WeakMap<MemoryRuntimeState, MemoryStatusCacheEntry>();

function getClientRequestCache(client: GatewayBrowserClient) {
  let cache = endpointRequestCache.get(client);
  if (!cache) {
    cache = new Map();
    endpointRequestCache.set(client, cache);
  }
  return cache;
}

function buildMemoryRequestCacheKey(
  method: string,
  params: {
    agentId: string;
    query?: string;
    noteId?: string;
    fileId?: string;
    pageId?: string;
    entityId?: string;
    scope?: "global" | "local";
    depth?: number;
    direction?: "incoming" | "outgoing" | "both";
    matchLimit?: number;
    relationLimit?: number;
    nodeLimit?: number;
    edgeLimit?: number;
    includeAttachments?: boolean;
  },
) {
  return `${params.agentId}::${method}::${JSON.stringify(params)}`;
}

async function requestWithMemoryCache<T>(
  client: GatewayBrowserClient,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  options?: CacheableMemoryRequestOptions,
): Promise<T> {
  const cache = getClientRequestCache(client);
  const cached = cache.get(key) as MemoryRequestCacheEntry<T> | undefined;
  const now = Date.now();
  const hasFreshValue =
    cached &&
    Object.prototype.hasOwnProperty.call(cached, "value") &&
    typeof cached.cachedAt === "number" &&
    now - cached.cachedAt < ttlMs;
  if (!options?.force && hasFreshValue) {
    return cached.value as T;
  }
  if (!options?.force && cached?.inFlight) {
    return cached.inFlight;
  }
  const request = loader()
    .then((value) => {
      cache.set(key, {
        value,
        cachedAt: Date.now(),
      });
      return value;
    })
    .catch((error) => {
      const current = cache.get(key) as MemoryRequestCacheEntry<T> | undefined;
      if (current?.inFlight === request) {
        if (Object.prototype.hasOwnProperty.call(current, "value")) {
          cache.set(key, {
            value: current.value,
            cachedAt: current.cachedAt,
          });
        } else {
          cache.delete(key);
        }
      }
      throw error;
    });
  cache.set(key, {
    ...(hasFreshValue ? { value: cached?.value, cachedAt: cached?.cachedAt } : {}),
    inFlight: request,
  });
  return request;
}

function invalidateClientMemoryRequestCache(
  client: GatewayBrowserClient,
  params?: { agentId?: string | null },
) {
  const cache = endpointRequestCache.get(client);
  if (!cache) {
    return;
  }
  const agentId = params?.agentId?.trim();
  if (!agentId) {
    cache.clear();
    return;
  }
  const prefix = `${agentId}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

function toMemoryNote(page: MemoryWikiPage): MemoryNote {
  const { relatedFiles, ...rest } = page;
  return {
    ...rest,
    ...(relatedFiles ? { attachments: relatedFiles } : {}),
  };
}

function toMemoryNotesListResult(result: MemoryWikiListResult): MemoryNotesListResult {
  return {
    agentId: result.agentId,
    notes: result.pages,
    ...(result.sync ? { sync: result.sync } : {}),
    ...(result.exportFormats ? { exportFormats: result.exportFormats } : {}),
  };
}

export type MemoryRuntimeState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  memorySelectedAgentId?: string | null;
  memoryStatusLoading: boolean;
  memoryStatusError: string | null;
  memoryStatus: MemoryStatusState | null;
  memorySyncing: boolean;
  memorySyncAvailable: boolean;
  memoryGraphLoading: boolean;
  memoryGraphError: string | null;
  memoryGraph: MemoryGraphState | null;
};

type TrackedRequest = {
  client: GatewayBrowserClient;
  token: symbol;
};

const statusRequests = new WeakMap<MemoryRuntimeState, TrackedRequest>();
const syncRequests = new WeakMap<MemoryRuntimeState, TrackedRequest>();
const graphRequests = new WeakMap<MemoryRuntimeState, TrackedRequest>();

function beginTrackedRequest(
  state: MemoryRuntimeState,
  requests: WeakMap<MemoryRuntimeState, TrackedRequest>,
): TrackedRequest | null {
  if (!state.client || !state.connected) {
    return null;
  }
  const request: TrackedRequest = {
    client: state.client,
    token: Symbol("memory-runtime-request"),
  };
  requests.set(state, request);
  return request;
}

function isTrackedRequestCurrent(
  state: MemoryRuntimeState,
  requests: WeakMap<MemoryRuntimeState, TrackedRequest>,
  request: TrackedRequest,
): boolean {
  const current = requests.get(state);
  return current?.token === request.token && state.client === request.client;
}

function finishTrackedRequest(
  state: MemoryRuntimeState,
  requests: WeakMap<MemoryRuntimeState, TrackedRequest>,
  request: TrackedRequest,
) {
  if (requests.get(state)?.token === request.token) {
    requests.delete(state);
  }
}

function isSelectedMemoryAgent(state: MemoryRuntimeState, agentId: string) {
  return !state.memorySelectedAgentId || state.memorySelectedAgentId === agentId;
}

function clearMemoryRuntimeState(state: MemoryRuntimeState) {
  state.memoryStatus = null;
  state.memoryStatusError = null;
  state.memorySyncAvailable = false;
  state.memoryGraph = null;
  state.memoryGraphError = null;
}

function isUnknownMethodError(err: unknown, method: string) {
  return err instanceof GatewayRequestError && err.message.includes(`unknown method: ${method}`);
}

function isRetriableMemoryError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("database is locked") ||
    normalized.includes("sqlite_busy") ||
    normalized.includes("err_sqlite_error") ||
    normalized.includes("database busy")
  );
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestMemoryEndpoint<T>(
  client: GatewayBrowserClient,
  method: string,
  params: unknown,
  unavailableMessage: string,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await client.request<T>(method, params);
    } catch (err) {
      if (isUnknownMethodError(err, method)) {
        throw new MemoryEndpointUnavailableError(method, unavailableMessage);
      }
      if (!isRetriableMemoryError(err) || attempt >= 2) {
        throw err;
      }
      attempt += 1;
      await delay(80 * attempt);
    }
  }
}

export function isMemoryEndpointUnavailableError(
  err: unknown,
): err is MemoryEndpointUnavailableError {
  return err instanceof MemoryEndpointUnavailableError;
}

export async function requestMemoryNotesList(
  client: GatewayBrowserClient,
  params: { agentId: string; query?: string },
  options?: CacheableMemoryRequestOptions,
) {
  return requestWithMemoryCache(
    client,
    buildMemoryRequestCacheKey("memory.notes.list", params),
    NOTES_LIST_CACHE_TTL_MS,
    async () => {
      try {
        return await requestMemoryEndpoint<MemoryNotesListResult>(
          client,
          "memory.notes.list",
          params,
          "This version of Alisio does not expose native memory notes yet.",
        );
      } catch (err) {
        if (!isMemoryEndpointUnavailableError(err)) {
          throw err;
        }
        try {
          return toMemoryNotesListResult(await requestMemoryWikiList(client, params));
        } catch (fallbackErr) {
          if (isMemoryEndpointUnavailableError(fallbackErr)) {
            throw new MemoryEndpointUnavailableError(
              "memory.notes.list",
              "This version of Alisio does not expose native memory notes yet.",
            );
          }
          throw fallbackErr;
        }
      }
    },
    options,
  );
}

export async function requestMemoryNote(
  client: GatewayBrowserClient,
  params: { agentId: string; noteId: string; query?: string },
  options?: CacheableMemoryRequestOptions,
) {
  return requestWithMemoryCache(
    client,
    buildMemoryRequestCacheKey("memory.notes.get", params),
    NOTE_CACHE_TTL_MS,
    async () => {
      try {
        return await requestMemoryEndpoint<MemoryNotesGetResult>(
          client,
          "memory.notes.get",
          params,
          "This version of Alisio does not expose native memory note loading yet.",
        );
      } catch (err) {
        if (!isMemoryEndpointUnavailableError(err)) {
          throw err;
        }
        try {
          const legacy = await requestMemoryWikiPage(client, {
            agentId: params.agentId,
            pageId: params.noteId,
            ...(params.query ? { query: params.query } : {}),
          });
          return {
            agentId: legacy.agentId,
            note: toMemoryNote(legacy.page),
            ...(legacy.sync ? { sync: legacy.sync } : {}),
          } satisfies MemoryNotesGetResult;
        } catch (fallbackErr) {
          if (isMemoryEndpointUnavailableError(fallbackErr)) {
            throw new MemoryEndpointUnavailableError(
              "memory.notes.get",
              "This version of Alisio does not expose native memory note loading yet.",
            );
          }
          throw fallbackErr;
        }
      }
    },
    options,
  );
}

export async function requestMemoryNoteUpdate(
  client: GatewayBrowserClient,
  params: {
    agentId: string;
    noteId?: string;
    title: string;
    content: string;
    query?: string;
  },
) {
  try {
    const result = await requestMemoryEndpoint<MemoryNotesUpdateResult>(
      client,
      "memory.notes.update",
      params,
      "This version of Alisio does not expose native memory note editing yet.",
    );
    invalidateClientMemoryRequestCache(client, { agentId: params.agentId });
    return result;
  } catch (err) {
    if (!isMemoryEndpointUnavailableError(err)) {
      throw err;
    }
    try {
      const legacy = await requestMemoryWikiUpdate(client, {
        agentId: params.agentId,
        ...(params.noteId ? { pageId: params.noteId } : {}),
        title: params.title,
        content: params.content,
      });
      invalidateClientMemoryRequestCache(client, { agentId: params.agentId });
      return {
        ok: legacy.ok,
        agentId: legacy.agentId,
        ...(legacy.page ? { note: toMemoryNote(legacy.page) } : {}),
        ...(legacy.revision ? { revision: legacy.revision } : {}),
        ...(legacy.sync ? { sync: legacy.sync } : {}),
      } satisfies MemoryNotesUpdateResult;
    } catch (fallbackErr) {
      if (isMemoryEndpointUnavailableError(fallbackErr)) {
        throw new MemoryEndpointUnavailableError(
          "memory.notes.update",
          "This version of Alisio does not expose native memory note editing yet.",
        );
      }
      throw fallbackErr;
    }
  }
}

export async function requestMemoryNoteHistory(
  client: GatewayBrowserClient,
  params: { agentId: string; noteId: string },
) {
  try {
    return await requestMemoryEndpoint<MemoryNotesHistoryResult>(
      client,
      "memory.notes.history",
      params,
      "This version of Alisio does not expose ledger-backed memory history yet.",
    );
  } catch (err) {
    if (!isMemoryEndpointUnavailableError(err)) {
      throw err;
    }
    try {
      const legacy = await requestMemoryWikiHistory(client, {
        agentId: params.agentId,
        pageId: params.noteId,
      });
      return {
        agentId: legacy.agentId,
        noteId: legacy.pageId,
        history: legacy.history,
      } satisfies MemoryNotesHistoryResult;
    } catch (fallbackErr) {
      if (isMemoryEndpointUnavailableError(fallbackErr)) {
        throw new MemoryEndpointUnavailableError(
          "memory.notes.history",
          "This version of Alisio does not expose ledger-backed memory history for notes yet.",
        );
      }
      throw fallbackErr;
    }
  }
}

export async function requestMemoryWikiList(
  client: GatewayBrowserClient,
  params: { agentId: string; query?: string },
) {
  return requestMemoryEndpoint<MemoryWikiListResult>(
    client,
    "memory.wiki.list",
    params,
    "This version of Alisio does not expose the native memory wiki yet.",
  );
}

export async function requestMemoryWikiPage(
  client: GatewayBrowserClient,
  params: { agentId: string; pageId: string; query?: string },
) {
  return requestMemoryEndpoint<MemoryWikiGetResult>(
    client,
    "memory.wiki.get",
    params,
    "This version of Alisio does not expose native memory page loading yet.",
  );
}

export async function requestMemoryWikiUpdate(
  client: GatewayBrowserClient,
  params: {
    agentId: string;
    pageId?: string;
    title: string;
    content: string;
  },
) {
  return requestMemoryEndpoint<MemoryWikiUpdateResult>(
    client,
    "memory.wiki.update",
    params,
    "This version of Alisio does not expose native memory editing yet.",
  );
}

export async function requestMemoryWikiHistory(
  client: GatewayBrowserClient,
  params: { agentId: string; pageId: string },
) {
  return requestMemoryEndpoint<MemoryWikiHistoryResult>(
    client,
    "memory.wiki.history",
    params,
    "This version of Alisio does not expose ledger-backed memory history yet.",
  );
}

export async function requestMemoryFilesList(
  client: GatewayBrowserClient,
  params: { agentId: string; query?: string },
) {
  return requestMemoryEndpoint<MemoryFilesListResult>(
    client,
    "memory.files.list",
    params,
    "This version of Alisio does not expose native memory files yet.",
  );
}

export async function requestMemoryFile(
  client: GatewayBrowserClient,
  params: { agentId: string; fileId: string; query?: string },
  options?: CacheableMemoryRequestOptions,
) {
  return requestWithMemoryCache(
    client,
    buildMemoryRequestCacheKey("memory.files.get", params),
    FILE_CACHE_TTL_MS,
    () =>
      requestMemoryEndpoint<MemoryFilesGetResult>(
        client,
        "memory.files.get",
        params,
        "This version of Alisio does not expose native memory file details yet.",
      ),
    options,
  );
}

export async function requestMemoryTrace(
  client: GatewayBrowserClient,
  params: { agentId: string; traceId: string },
) {
  return requestMemoryEndpoint<MemoryTraceResult>(
    client,
    "memory.trace.get",
    params,
    "This version of Alisio does not expose retrieval traces yet.",
  );
}

export async function requestMemoryExport(
  client: GatewayBrowserClient,
  params: { agentId: string; format: MemoryExportFormat },
) {
  return requestMemoryEndpoint<MemoryExportResult>(
    client,
    "memory.export",
    params,
    "This version of Alisio does not expose native memory export yet.",
  );
}

export async function requestMemoryGraph(
  client: GatewayBrowserClient,
  params: {
    agentId: string;
    query?: string;
    pageId?: string;
    entityId?: string;
    scope?: "global" | "local";
    depth?: number;
    direction?: "incoming" | "outgoing" | "both";
    matchLimit?: number;
    relationLimit?: number;
    nodeLimit?: number;
    edgeLimit?: number;
    includeAttachments?: boolean;
  },
  options?: CacheableMemoryRequestOptions,
) {
  return requestWithMemoryCache(
    client,
    buildMemoryRequestCacheKey("memory.graph", params),
    GRAPH_CACHE_TTL_MS,
    () =>
      requestMemoryEndpoint<MemoryGraphState>(
        client,
        "memory.graph",
        params,
        "This version of Alisio does not expose the canonical memory graph yet.",
      ),
    options,
  );
}

export async function loadMemoryStatus(
  state: MemoryRuntimeState,
  agentId: string,
  options?: { reset?: boolean; force?: boolean },
) {
  const resolvedAgentId = agentId.trim();
  if (!resolvedAgentId) {
    return;
  }
  const cached = memoryStatusCache.get(state);
  if (
    !options?.force &&
    cached?.agentId === resolvedAgentId &&
    Date.now() - cached.cachedAt < MEMORY_STATUS_CACHE_TTL_MS
  ) {
    if (options?.reset) {
      clearMemoryRuntimeState(state);
    }
    state.memoryStatus = cached.value;
    state.memoryStatusError = null;
    state.memorySyncAvailable = true;
    state.memoryStatusLoading = false;
    return;
  }
  const request = beginTrackedRequest(state, statusRequests);
  if (!request) {
    return;
  }
  if (options?.reset) {
    clearMemoryRuntimeState(state);
  }
  state.memoryStatusLoading = true;
  state.memoryStatusError = null;
  try {
    const res = await request.client.request<MemoryStatusState | null>("memory.status", {
      agentId: resolvedAgentId,
    });
    if (
      !res ||
      !isTrackedRequestCurrent(state, statusRequests, request) ||
      !isSelectedMemoryAgent(state, resolvedAgentId)
    ) {
      return;
    }
    state.memoryStatus = res;
    state.memorySyncAvailable = true;
    memoryStatusCache.set(state, {
      agentId: resolvedAgentId,
      value: res,
      cachedAt: Date.now(),
    });
  } catch (err) {
    if (isUnknownMethodError(err, "memory.status")) {
      if (isTrackedRequestCurrent(state, statusRequests, request)) {
        state.memoryStatus = null;
        state.memoryStatusError = t("alisio.memory.statusUnavailableVersion");
        state.memorySyncAvailable = false;
      }
      return;
    }
    if (isTrackedRequestCurrent(state, statusRequests, request)) {
      state.memoryStatusError = String(err);
      state.memorySyncAvailable = false;
    }
  } finally {
    finishTrackedRequest(state, statusRequests, request);
    if (!statusRequests.has(state)) {
      state.memoryStatusLoading = false;
    }
  }
}

export async function syncMemoryNow(state: MemoryRuntimeState, agentId: string) {
  const resolvedAgentId = agentId.trim();
  if (!resolvedAgentId || state.memorySyncing) {
    return;
  }
  const request = beginTrackedRequest(state, syncRequests);
  if (!request) {
    return;
  }
  state.memorySyncing = true;
  state.memoryStatusError = null;
  try {
    const res = await request.client.request<MemorySyncResult | null>("memory.sync", {
      agentId: resolvedAgentId,
    });
    if (
      !res?.status ||
      !isTrackedRequestCurrent(state, syncRequests, request) ||
      !isSelectedMemoryAgent(state, resolvedAgentId)
    ) {
      return;
    }
    state.memoryStatus = res.status;
    state.memorySyncAvailable = true;
    memoryStatusCache.set(state, {
      agentId: resolvedAgentId,
      value: res.status,
      cachedAt: Date.now(),
    });
    invalidateClientMemoryRequestCache(request.client, { agentId: resolvedAgentId });
  } catch (err) {
    if (isTrackedRequestCurrent(state, syncRequests, request)) {
      state.memoryStatusError = isUnknownMethodError(err, "memory.sync")
        ? t("alisio.memory.syncUnavailableVersion")
        : String(err);
      state.memorySyncAvailable = false;
    }
  } finally {
    finishTrackedRequest(state, syncRequests, request);
    if (!syncRequests.has(state)) {
      state.memorySyncing = false;
    }
  }
}

export async function loadMemoryGraph(
  state: MemoryRuntimeState,
  params: {
    agentId: string;
    query?: string | null;
    pageId?: string | null;
    entityId?: string | null;
    scope?: "global" | "local";
    depth?: number;
    direction?: "incoming" | "outgoing" | "both";
    matchLimit?: number;
    relationLimit?: number;
    nodeLimit?: number;
    edgeLimit?: number;
    includeAttachments?: boolean;
  },
) {
  const agentId = params.agentId.trim();
  const query = params.query?.trim() ?? "";
  const pageId = params.pageId?.trim() ?? "";
  const entityId = params.entityId?.trim() ?? "";
  if (!agentId) {
    return;
  }
  if (!query && !pageId && !entityId && params.scope !== "global") {
    state.memoryGraph = null;
    state.memoryGraphError = null;
    state.memoryGraphLoading = false;
    return;
  }
  const request = beginTrackedRequest(state, graphRequests);
  if (!request) {
    return;
  }
  state.memoryGraphLoading = true;
  state.memoryGraphError = null;
  try {
    const res = await requestMemoryGraph(request.client, {
      agentId,
      ...(query ? { query } : {}),
      ...(pageId ? { pageId } : {}),
      ...(entityId ? { entityId } : {}),
      ...(params.scope ? { scope: params.scope } : {}),
      direction: params.direction ?? "both",
      matchLimit: params.matchLimit ?? 4,
      relationLimit: params.relationLimit ?? 8,
      ...(typeof params.depth === "number" ? { depth: params.depth } : {}),
      ...(typeof params.nodeLimit === "number" ? { nodeLimit: params.nodeLimit } : {}),
      ...(typeof params.edgeLimit === "number" ? { edgeLimit: params.edgeLimit } : {}),
      ...(params.includeAttachments === true ? { includeAttachments: true } : {}),
    });
    if (
      !res ||
      !isTrackedRequestCurrent(state, graphRequests, request) ||
      !isSelectedMemoryAgent(state, agentId)
    ) {
      return;
    }
    state.memoryGraph = res;
  } catch (err) {
    if (isTrackedRequestCurrent(state, graphRequests, request)) {
      state.memoryGraph = null;
      state.memoryGraphError = isUnknownMethodError(err, "memory.graph")
        ? t("alisio.memory.graphUnavailableVersion")
        : String(err);
    }
  } finally {
    finishTrackedRequest(state, graphRequests, request);
    if (!graphRequests.has(state)) {
      state.memoryGraphLoading = false;
    }
  }
}
