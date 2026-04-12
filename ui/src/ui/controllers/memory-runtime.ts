import { GatewayRequestError } from "../gateway.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { MemoryGraphState, MemoryStatusState, MemorySyncResult } from "../types.ts";

export type MemoryReasonTag = {
  code: string;
  label?: string;
  detail?: string;
};

export type MemorySyncSurface = {
  lastSyncedLamport?: string | number | null;
  e2eeRequired?: boolean | null;
  state?: string | null;
  detail?: string | null;
};

export type MemoryWikiListPage = {
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

export type MemoryWikiListResult = {
  agentId: string;
  pages: MemoryWikiListPage[];
  sync?: MemorySyncSurface | null;
  exportFormats?: string[] | null;
};

export type MemoryWikiBacklink = {
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

export type MemoryWikiPage = {
  id: string;
  title: string;
  slug?: string | null;
  path?: string | null;
  content: string;
  backlinks?: MemoryWikiBacklink[] | null;
  claims?: MemoryClaimItem[] | null;
  evidence?: MemoryEvidenceItem[] | null;
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

export type MemoryWikiGetResult = {
  agentId: string;
  page: MemoryWikiPage;
  sync?: MemorySyncSurface | null;
};

export type MemoryWikiHistoryEntry = {
  eventId: string;
  lamport?: string | number | null;
  at?: string | null;
  author?: string | null;
  operation?: string | null;
  summary?: string | null;
  diffSummary?: string | null;
};

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
  traceId?: string | null;
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

async function requestMemoryEndpoint<T>(
  client: GatewayBrowserClient,
  method: string,
  params: unknown,
  unavailableMessage: string,
): Promise<T> {
  try {
    return await client.request<T>(method, params);
  } catch (err) {
    if (isUnknownMethodError(err, method)) {
      throw new MemoryEndpointUnavailableError(method, unavailableMessage);
    }
    throw err;
  }
}

export function isMemoryEndpointUnavailableError(
  err: unknown,
): err is MemoryEndpointUnavailableError {
  return err instanceof MemoryEndpointUnavailableError;
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
) {
  return requestMemoryEndpoint<MemoryFilesGetResult>(
    client,
    "memory.files.get",
    params,
    "This version of Alisio does not expose native memory file details yet.",
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
  },
) {
  return requestMemoryEndpoint<MemoryGraphState>(
    client,
    "memory.graph",
    params,
    "This version of Alisio does not expose the canonical memory graph yet.",
  );
}

export async function loadMemoryStatus(
  state: MemoryRuntimeState,
  agentId: string,
  options?: { reset?: boolean },
) {
  const resolvedAgentId = agentId.trim();
  if (!resolvedAgentId) {
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
  } catch (err) {
    if (isUnknownMethodError(err, "memory.status")) {
      if (isTrackedRequestCurrent(state, statusRequests, request)) {
        state.memoryStatus = null;
        state.memoryStatusError =
          "Este Alisio ainda não expõe o estado detalhado da memória nesta versão.";
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
  } catch (err) {
    if (isTrackedRequestCurrent(state, syncRequests, request)) {
      state.memoryStatusError = isUnknownMethodError(err, "memory.sync")
        ? "Este Alisio ainda não expõe sincronização manual da memória."
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
        ? "Este Alisio ainda não expõe o grafo canónico da memória nesta versão."
        : String(err);
    }
  } finally {
    finishTrackedRequest(state, graphRequests, request);
    if (!graphRequests.has(state)) {
      state.memoryGraphLoading = false;
    }
  }
}
