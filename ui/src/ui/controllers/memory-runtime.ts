import { GatewayRequestError } from "../gateway.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { MemoryGraphState, MemoryStatusState, MemorySyncResult } from "../types.ts";

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

type DoctorMemoryStatusPayload = {
  agentId: string;
  provider?: string;
  embedding: {
    ok: boolean;
    error?: string;
  };
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

async function loadLegacyMemoryStatus(
  request: TrackedRequest,
  state: MemoryRuntimeState,
  agentId: string,
): Promise<boolean> {
  try {
    const legacy = await request.client.request<DoctorMemoryStatusPayload | null>(
      "doctor.memory.status",
      {},
    );
    if (
      !isTrackedRequestCurrent(state, statusRequests, request) ||
      !isSelectedMemoryAgent(state, agentId)
    ) {
      return true;
    }
    if (!legacy || legacy.agentId !== agentId) {
      state.memoryStatus = null;
      state.memoryStatusError =
        "Este Alisio ainda não expõe o estado detalhado da memória para este agente.";
      state.memorySyncAvailable = false;
      return true;
    }
    state.memoryStatus = {
      agentId,
      enabled: Boolean(legacy.provider) || legacy.embedding.ok,
      embedding: legacy.embedding,
    };
    state.memoryStatusError =
      "Este Alisio ainda não expõe o estado detalhado da memória. Mostro um estado básico até actualizares ou reiniciares o Alisio.";
    state.memorySyncAvailable = false;
    return true;
  } catch {
    if (isTrackedRequestCurrent(state, statusRequests, request)) {
      state.memoryStatus = null;
      state.memoryStatusError =
        "Este Alisio ainda não expõe o estado detalhado da memória nesta versão.";
      state.memorySyncAvailable = false;
    }
    return true;
  }
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
      await loadLegacyMemoryStatus(request, state, resolvedAgentId);
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
  },
) {
  const agentId = params.agentId.trim();
  const query = params.query?.trim() ?? "";
  if (!agentId) {
    return;
  }
  if (!query) {
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
    const res = await request.client.request<MemoryGraphState | null>("memory.graph", {
      agentId,
      query,
      direction: "both",
      matchLimit: 4,
      relationLimit: 8,
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
