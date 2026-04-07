import { resolveAgentIdFromSessionKey } from "../../../../src/routing/session-key.js";
import { GatewayRequestError } from "../gateway.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  getLongTermMemoryFilePriority,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
} from "../memory-files.ts";
import type {
  AgentsFilesDeleteResult,
  AgentsFilesGetResult,
  AgentsFilesListResult,
  AgentsFilesSetResult,
} from "../types.ts";

export type AgentMemoryState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  memorySelectedAgentId: string | null;
  memoryAgentId: string | null;
  memoryLoading: boolean;
  memoryError: string | null;
  memoryList: AgentsFilesListResult | null;
  memoryContents: Record<string, string>;
  memoryDrafts: Record<string, string>;
  memoryActive: string | null;
  memorySaving: boolean;
  memoryDeleting: boolean;
};

type TrackedRequest = {
  client: GatewayBrowserClient;
  token: symbol;
};

const listRequests = new WeakMap<AgentMemoryState, TrackedRequest>();
const contentRequests = new WeakMap<AgentMemoryState, TrackedRequest>();
const saveRequests = new WeakMap<AgentMemoryState, TrackedRequest>();
const deleteRequests = new WeakMap<AgentMemoryState, TrackedRequest>();

function beginTrackedRequest(
  state: AgentMemoryState,
  requests: WeakMap<AgentMemoryState, TrackedRequest>,
): TrackedRequest | null {
  if (!state.client || !state.connected) {
    return null;
  }
  const request: TrackedRequest = {
    client: state.client,
    token: Symbol("agent-memory-request"),
  };
  requests.set(state, request);
  return request;
}

function isTrackedRequestCurrent(
  state: AgentMemoryState,
  requests: WeakMap<AgentMemoryState, TrackedRequest>,
  request: TrackedRequest,
): boolean {
  const current = requests.get(state);
  return current?.token === request.token && state.client === request.client;
}

function finishTrackedRequest(
  state: AgentMemoryState,
  requests: WeakMap<AgentMemoryState, TrackedRequest>,
  request: TrackedRequest,
) {
  if (requests.get(state)?.token === request.token) {
    requests.delete(state);
  }
}

function syncMemoryLoadingState(state: AgentMemoryState) {
  state.memoryLoading = listRequests.has(state) || contentRequests.has(state);
}

function isSelectedMemoryAgent(state: AgentMemoryState, agentId: string) {
  return !state.memorySelectedAgentId || state.memorySelectedAgentId === agentId;
}

function compareMemoryFiles(
  left: AgentsFilesListResult["files"][number],
  right: AgentsFilesListResult["files"][number],
) {
  const leftLongTerm = isLongTermMemoryFileName(left.name);
  const rightLongTerm = isLongTermMemoryFileName(right.name);
  if (leftLongTerm || rightLongTerm) {
    if (leftLongTerm && rightLongTerm) {
      const priorityDiff =
        getLongTermMemoryFilePriority(left.name) - getLongTermMemoryFilePriority(right.name);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return left.name.localeCompare(right.name);
    }
    return leftLongTerm ? -1 : 1;
  }
  const leftUpdatedAt = left.updatedAtMs ?? 0;
  const rightUpdatedAt = right.updatedAtMs ?? 0;
  if (leftUpdatedAt !== rightUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt;
  }
  return left.name.localeCompare(right.name);
}

function isMemoryScopeUnsupportedError(err: unknown) {
  if (!(err instanceof GatewayRequestError)) {
    return false;
  }
  const message = err.message.toLowerCase();
  return (
    message.includes("invalid agents.files.list params") &&
    message.includes("unexpected property") &&
    message.includes("scope")
  );
}

function filterMemoryFiles(files: AgentsFilesListResult["files"]): AgentsFilesListResult["files"] {
  return files
    .filter((file) => isLongTermMemoryFileName(file.name) || isMemoryNoteFileName(file.name))
    .toSorted(compareMemoryFiles);
}

function mergeCompatibilityMemoryFiles(params: {
  nextList: AgentsFilesListResult;
  previousList: AgentsFilesListResult | null;
}): AgentsFilesListResult {
  if (params.previousList?.agentId !== params.nextList.agentId) {
    return params.nextList;
  }
  const files = new Map(params.nextList.files.map((file) => [file.name, file]));
  for (const file of params.previousList.files) {
    if (isMemoryNoteFileName(file.name) && !files.has(file.name)) {
      files.set(file.name, file);
    }
  }
  return {
    ...params.nextList,
    files: [...files.values()].toSorted(compareMemoryFiles),
  };
}

async function requestMemoryFileList(
  client: GatewayBrowserClient,
  agentId: string,
  previousList: AgentsFilesListResult | null,
): Promise<AgentsFilesListResult | null> {
  try {
    return await client.request<AgentsFilesListResult | null>("agents.files.list", {
      agentId,
      scope: "memory",
    });
  } catch (err) {
    if (!isMemoryScopeUnsupportedError(err)) {
      throw err;
    }
    const fallback = await client.request<AgentsFilesListResult | null>("agents.files.list", {
      agentId,
    });
    if (!fallback) {
      return fallback;
    }
    return mergeCompatibilityMemoryFiles({
      nextList: {
        ...fallback,
        files: filterMemoryFiles(fallback.files),
      },
      previousList,
    });
  }
}

function mergeFileEntry(
  list: AgentsFilesListResult | null,
  entry: AgentsFilesGetResult["file"],
): AgentsFilesListResult | null {
  if (!list) {
    return list;
  }
  const hasEntry = list.files.some((file) => file.name === entry.name);
  const nextFiles = hasEntry
    ? list.files.map((file) => (file.name === entry.name ? entry : file))
    : [...list.files, entry];
  nextFiles.sort(compareMemoryFiles);
  return { ...list, files: nextFiles };
}

function clearMemoryAgentData(state: AgentMemoryState, agentId: string) {
  state.memoryAgentId = agentId;
  state.memoryList = null;
  state.memoryContents = {};
  state.memoryDrafts = {};
  state.memoryActive = null;
}

function resolvePreferredMemoryFileName(
  files: AgentsFilesListResult["files"],
  preferredName: string | null | undefined,
): string | null {
  if (!files.length) {
    return null;
  }
  if (preferredName && files.some((file) => file.name === preferredName)) {
    return preferredName;
  }
  const longTerm =
    files
      .filter((file) => isLongTermMemoryFileName(file.name))
      .toSorted(
        (left, right) =>
          getLongTermMemoryFilePriority(left.name) - getLongTermMemoryFilePriority(right.name),
      )[0] ?? files[0];
  return longTerm?.name ?? null;
}

export function resolvePreferredMemoryAgentId(state: {
  memorySelectedAgentId: string | null;
  sessionKey?: string;
  assistantAgentId?: string | null;
  agentsList?: { defaultId?: string | null; agents: Array<{ id: string }> } | null;
}) {
  const agents = state.agentsList?.agents ?? [];
  const known = new Set(agents.map((agent) => agent.id));
  const sessionAgentId =
    typeof state.sessionKey === "string" ? resolveAgentIdFromSessionKey(state.sessionKey) : null;
  for (const candidate of [
    state.memorySelectedAgentId,
    sessionAgentId,
    state.assistantAgentId,
    state.agentsList?.defaultId ?? null,
    agents[0]?.id ?? null,
  ]) {
    if (candidate && known.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function loadAgentMemoryFiles(
  state: AgentMemoryState,
  agentId: string,
  options?: { preferredName?: string | null },
) {
  const resolvedAgentId = agentId.trim();
  if (!resolvedAgentId) {
    return;
  }
  const request = beginTrackedRequest(state, listRequests);
  if (!request) {
    return;
  }
  if (state.memoryAgentId !== resolvedAgentId) {
    clearMemoryAgentData(state, resolvedAgentId);
  }
  state.memorySelectedAgentId = resolvedAgentId;
  syncMemoryLoadingState(state);
  state.memoryError = null;

  let nextActiveName: string | null = null;
  try {
    const res = await requestMemoryFileList(request.client, resolvedAgentId, state.memoryList);
    if (!res || !isTrackedRequestCurrent(state, listRequests, request)) {
      return;
    }
    state.memoryAgentId = resolvedAgentId;
    state.memoryList = res;
    nextActiveName = resolvePreferredMemoryFileName(
      res.files,
      options?.preferredName ?? state.memoryActive,
    );
    state.memoryActive = nextActiveName;
  } catch (err) {
    if (isTrackedRequestCurrent(state, listRequests, request)) {
      state.memoryError = String(err);
    }
  } finally {
    finishTrackedRequest(state, listRequests, request);
    syncMemoryLoadingState(state);
  }

  if (nextActiveName && isSelectedMemoryAgent(state, resolvedAgentId)) {
    await loadAgentMemoryFileContent(state, resolvedAgentId, nextActiveName, {
      preserveDraft: true,
    });
  }
}

export async function loadAgentMemoryFileContent(
  state: AgentMemoryState,
  agentId: string,
  name: string,
  options?: { force?: boolean; preserveDraft?: boolean },
) {
  const resolvedAgentId = agentId.trim();
  const resolvedName = name.trim();
  if (!resolvedAgentId || !resolvedName) {
    return;
  }
  const request = beginTrackedRequest(state, contentRequests);
  if (!request) {
    return;
  }
  if (state.memoryAgentId !== resolvedAgentId) {
    clearMemoryAgentData(state, resolvedAgentId);
  }
  state.memoryActive = resolvedName;
  if (!options?.force && Object.hasOwn(state.memoryContents, resolvedName)) {
    finishTrackedRequest(state, contentRequests, request);
    syncMemoryLoadingState(state);
    return;
  }

  syncMemoryLoadingState(state);
  state.memoryError = null;
  try {
    const res = await request.client.request<AgentsFilesGetResult | null>("agents.files.get", {
      agentId: resolvedAgentId,
      name: resolvedName,
    });
    if (
      !res?.file ||
      !isTrackedRequestCurrent(state, contentRequests, request) ||
      !isSelectedMemoryAgent(state, resolvedAgentId)
    ) {
      return;
    }
    const content = res.file.content ?? "";
    const previousBase = state.memoryContents[resolvedName] ?? "";
    const currentDraft = state.memoryDrafts[resolvedName];
    const preserveDraft = options?.preserveDraft ?? true;

    state.memoryAgentId = resolvedAgentId;
    state.memoryList = mergeFileEntry(state.memoryList, res.file);
    state.memoryContents = { ...state.memoryContents, [resolvedName]: content };
    if (
      !preserveDraft ||
      !Object.hasOwn(state.memoryDrafts, resolvedName) ||
      currentDraft === previousBase
    ) {
      state.memoryDrafts = { ...state.memoryDrafts, [resolvedName]: content };
    }
    state.memoryActive = resolvedName;
  } catch (err) {
    if (isTrackedRequestCurrent(state, contentRequests, request)) {
      state.memoryError = String(err);
    }
  } finally {
    finishTrackedRequest(state, contentRequests, request);
    syncMemoryLoadingState(state);
  }
}

export async function saveAgentMemoryFile(
  state: AgentMemoryState,
  agentId: string,
  name: string,
  content: string,
) {
  const resolvedAgentId = agentId.trim();
  const resolvedName = name.trim();
  if (!resolvedAgentId || !resolvedName || state.memorySaving) {
    return;
  }
  const request = beginTrackedRequest(state, saveRequests);
  if (!request) {
    return;
  }
  state.memorySaving = true;
  state.memoryError = null;
  try {
    const res = await request.client.request<AgentsFilesSetResult | null>("agents.files.set", {
      agentId: resolvedAgentId,
      name: resolvedName,
      content,
    });
    if (
      !res?.file ||
      !isTrackedRequestCurrent(state, saveRequests, request) ||
      !isSelectedMemoryAgent(state, resolvedAgentId)
    ) {
      return;
    }
    state.memoryAgentId = resolvedAgentId;
    state.memoryList = mergeFileEntry(state.memoryList, res.file);
    state.memoryContents = { ...state.memoryContents, [resolvedName]: content };
    state.memoryDrafts = { ...state.memoryDrafts, [resolvedName]: content };
    state.memoryActive = resolvedName;
  } catch (err) {
    if (isTrackedRequestCurrent(state, saveRequests, request)) {
      state.memoryError = String(err);
    }
  } finally {
    finishTrackedRequest(state, saveRequests, request);
    if (!saveRequests.has(state)) {
      state.memorySaving = false;
    }
  }
}

export async function deleteAgentMemoryFile(
  state: AgentMemoryState,
  agentId: string,
  name: string,
) {
  const resolvedAgentId = agentId.trim();
  const resolvedName = name.trim();
  if (!resolvedAgentId || !resolvedName || state.memoryDeleting) {
    return;
  }
  const request = beginTrackedRequest(state, deleteRequests);
  if (!request) {
    return;
  }
  state.memoryDeleting = true;
  state.memoryError = null;
  try {
    const res = await request.client.request<AgentsFilesDeleteResult | null>(
      "agents.files.delete",
      {
        agentId: resolvedAgentId,
        name: resolvedName,
      },
    );
    if (
      !res?.ok ||
      !isTrackedRequestCurrent(state, deleteRequests, request) ||
      !isSelectedMemoryAgent(state, resolvedAgentId)
    ) {
      return;
    }
    if (state.memoryList?.agentId === resolvedAgentId) {
      state.memoryList = {
        ...state.memoryList,
        files: state.memoryList.files.filter((file) => file.name !== resolvedName),
      };
    }
    delete state.memoryContents[resolvedName];
    delete state.memoryDrafts[resolvedName];
    if (state.memoryActive === resolvedName) {
      state.memoryActive = null;
    }
  } catch (err) {
    if (isTrackedRequestCurrent(state, deleteRequests, request)) {
      state.memoryError = String(err);
    }
  } finally {
    finishTrackedRequest(state, deleteRequests, request);
    if (!deleteRequests.has(state)) {
      state.memoryDeleting = false;
    }
  }
}
