import { resolveAgentIdFromSessionKey } from "../../../../src/routing/session-key.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import { PRIMARY_MEMORY_FILE_NAME } from "../memory-files.ts";
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
  const longTerm = files.find((file) => file.name === PRIMARY_MEMORY_FILE_NAME) ?? files[0];
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
  if (!state.client || !state.connected || !resolvedAgentId || state.memoryLoading) {
    return;
  }
  if (state.memoryAgentId !== resolvedAgentId) {
    clearMemoryAgentData(state, resolvedAgentId);
  }
  state.memorySelectedAgentId = resolvedAgentId;
  state.memoryLoading = true;
  state.memoryError = null;

  let nextActiveName: string | null = null;
  try {
    const res = await state.client.request<AgentsFilesListResult | null>("agents.files.list", {
      agentId: resolvedAgentId,
      scope: "memory",
    });
    if (!res) {
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
    state.memoryError = String(err);
  } finally {
    state.memoryLoading = false;
  }

  if (nextActiveName) {
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
  if (
    !state.client ||
    !state.connected ||
    !resolvedAgentId ||
    !resolvedName ||
    state.memoryLoading
  ) {
    return;
  }
  if (state.memoryAgentId !== resolvedAgentId) {
    clearMemoryAgentData(state, resolvedAgentId);
  }
  if (!options?.force && Object.hasOwn(state.memoryContents, resolvedName)) {
    state.memoryActive = resolvedName;
    return;
  }

  state.memoryLoading = true;
  state.memoryError = null;
  try {
    const res = await state.client.request<AgentsFilesGetResult | null>("agents.files.get", {
      agentId: resolvedAgentId,
      name: resolvedName,
    });
    if (!res?.file) {
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
    state.memoryError = String(err);
  } finally {
    state.memoryLoading = false;
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
  if (
    !state.client ||
    !state.connected ||
    !resolvedAgentId ||
    !resolvedName ||
    state.memorySaving
  ) {
    return;
  }
  state.memorySaving = true;
  state.memoryError = null;
  try {
    const res = await state.client.request<AgentsFilesSetResult | null>("agents.files.set", {
      agentId: resolvedAgentId,
      name: resolvedName,
      content,
    });
    if (!res?.file) {
      return;
    }
    state.memoryAgentId = resolvedAgentId;
    state.memoryList = mergeFileEntry(state.memoryList, res.file);
    state.memoryContents = { ...state.memoryContents, [resolvedName]: content };
    state.memoryDrafts = { ...state.memoryDrafts, [resolvedName]: content };
    state.memoryActive = resolvedName;
  } catch (err) {
    state.memoryError = String(err);
  } finally {
    state.memorySaving = false;
  }
}

export async function deleteAgentMemoryFile(
  state: AgentMemoryState,
  agentId: string,
  name: string,
) {
  const resolvedAgentId = agentId.trim();
  const resolvedName = name.trim();
  if (
    !state.client ||
    !state.connected ||
    !resolvedAgentId ||
    !resolvedName ||
    state.memoryDeleting
  ) {
    return;
  }
  state.memoryDeleting = true;
  state.memoryError = null;
  try {
    const res = await state.client.request<AgentsFilesDeleteResult | null>("agents.files.delete", {
      agentId: resolvedAgentId,
      name: resolvedName,
    });
    if (!res?.ok) {
      return;
    }
    delete state.memoryContents[resolvedName];
    delete state.memoryDrafts[resolvedName];
    if (state.memoryActive === resolvedName) {
      state.memoryActive = null;
    }
  } catch (err) {
    state.memoryError = String(err);
  } finally {
    state.memoryDeleting = false;
  }
}
