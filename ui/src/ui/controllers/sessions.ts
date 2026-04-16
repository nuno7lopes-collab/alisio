import { toNumber } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionsListResult } from "../types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type SessionsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey?: string;
  sessionMessageSubscribedKey?: string | null;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
  confirmDeleteSessions?: (keys: string[]) => boolean | Promise<boolean>;
};

type SessionsListOverrides = {
  activeMinutes?: number;
  limit?: number;
  includeGlobal?: boolean;
  includeUnknown?: boolean;
};

type SessionMessageSubscriptionRequest = {
  client: NonNullable<SessionsState["client"]>;
  promise: Promise<void>;
  targetKey: string | null;
  token: number;
};

const sessionMessageSubscriptionSeq = new WeakMap<object, number>();
const pendingSessionMessageSubscriptions = new WeakMap<object, SessionMessageSubscriptionRequest>();

function normalizeSessionSubscriptionKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function applyCanonicalSessionSelection(state: SessionsState, canonicalKey: string | null): void {
  const nextKey = normalizeSessionSubscriptionKey(canonicalKey);
  if (!nextKey) {
    return;
  }
  const previousKey = normalizeSessionSubscriptionKey(state.sessionKey);
  if (previousKey === nextKey) {
    return;
  }
  state.sessionKey = nextKey;
  const host = state as SessionsState & {
    settings?: {
      sessionKey?: string;
      lastActiveSessionKey?: string;
    } & Record<string, unknown>;
    applySettings?: (next: unknown) => void;
  };
  const settings = host.settings;
  if (!settings || typeof host.applySettings !== "function") {
    return;
  }
  const settingsSessionKey = normalizeSessionSubscriptionKey(settings.sessionKey);
  const settingsLastActiveKey = normalizeSessionSubscriptionKey(settings.lastActiveSessionKey);
  if (
    settingsSessionKey !== previousKey &&
    settingsLastActiveKey !== previousKey &&
    settingsSessionKey === nextKey &&
    settingsLastActiveKey === nextKey
  ) {
    return;
  }
  host.applySettings({
    ...settings,
    sessionKey: nextKey,
    lastActiveSessionKey: nextKey,
  });
}

export async function subscribeSessions(state: SessionsState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("sessions.subscribe", {});
  } catch (err) {
    state.sessionsError = String(err);
  }
}

export async function syncSessionMessageSubscription(state: SessionsState) {
  const targetKey = normalizeSessionSubscriptionKey(state.sessionKey);
  const activeKey = normalizeSessionSubscriptionKey(state.sessionMessageSubscribedKey);
  if (!state.client || !state.connected) {
    pendingSessionMessageSubscriptions.delete(state as object);
    state.sessionMessageSubscribedKey = null;
    return;
  }
  if (targetKey === activeKey) {
    return;
  }
  const pending = pendingSessionMessageSubscriptions.get(state as object);
  if (pending && pending.client === state.client && pending.targetKey === targetKey) {
    return await pending.promise;
  }

  const token = (sessionMessageSubscriptionSeq.get(state as object) ?? 0) + 1;
  sessionMessageSubscriptionSeq.set(state as object, token);
  const client = state.client;
  const promise = (async () => {
    try {
      if (activeKey) {
        await client.request("sessions.messages.unsubscribe", { key: activeKey });
        if (!isCurrentSessionMessageSubscription(state, client, token)) {
          return;
        }
        if (normalizeSessionSubscriptionKey(state.sessionMessageSubscribedKey) === activeKey) {
          state.sessionMessageSubscribedKey = null;
        }
      }
      if (!targetKey) {
        return;
      }
      const response = await client.request<{
        key?: string;
        subscribed?: boolean;
      }>("sessions.messages.subscribe", { key: targetKey });
      if (!isCurrentSessionMessageSubscription(state, client, token)) {
        return;
      }
      const canonicalKey = normalizeSessionSubscriptionKey(response?.key) ?? targetKey;
      state.sessionMessageSubscribedKey = canonicalKey;
      applyCanonicalSessionSelection(state, canonicalKey);
    } catch (err) {
      if (isCurrentSessionMessageSubscription(state, client, token)) {
        state.sessionsError = String(err);
      }
    } finally {
      const currentPending = pendingSessionMessageSubscriptions.get(state as object);
      if (currentPending?.token === token) {
        pendingSessionMessageSubscriptions.delete(state as object);
      }
    }
  })();
  pendingSessionMessageSubscriptions.set(state as object, {
    client,
    promise,
    targetKey,
    token,
  });
  await promise;
}

function isCurrentSessionMessageSubscription(
  state: SessionsState,
  client: NonNullable<SessionsState["client"]>,
  token: number,
): boolean {
  return state.client === client && sessionMessageSubscriptionSeq.get(state as object) === token;
}

function buildSessionsListParams(
  state: SessionsState,
  overrides?: SessionsListOverrides,
): Record<string, unknown> {
  const includeGlobal = overrides?.includeGlobal ?? state.sessionsIncludeGlobal;
  const includeUnknown = overrides?.includeUnknown ?? state.sessionsIncludeUnknown;
  const activeMinutes = overrides?.activeMinutes ?? toNumber(state.sessionsFilterActive, 0);
  const limit = overrides?.limit ?? toNumber(state.sessionsFilterLimit, 0);
  const params: Record<string, unknown> = {
    includeGlobal,
    includeUnknown,
    includeDerivedTitles: true,
  };
  if (activeMinutes > 0) {
    params.activeMinutes = activeMinutes;
  }
  if (limit > 0) {
    params.limit = limit;
  }
  return params;
}

async function requestSessionsList(
  state: SessionsState,
  overrides?: SessionsListOverrides,
): Promise<SessionsListResult | undefined> {
  if (!state.client || !state.connected) {
    return undefined;
  }
  return await state.client.request<SessionsListResult | undefined>(
    "sessions.list",
    buildSessionsListParams(state, overrides),
  );
}

function applySessionsLoadError(state: SessionsState, err: unknown): void {
  if (isMissingOperatorReadScopeError(err)) {
    state.sessionsResult = null;
    state.sessionsError = formatMissingOperatorReadScopeMessage("sessions");
    return;
  }
  state.sessionsError = String(err);
}

async function refreshSessionsQuietly(
  state: SessionsState,
  overrides?: SessionsListOverrides,
): Promise<void> {
  try {
    const res = await requestSessionsList(state, overrides);
    if (res) {
      state.sessionsResult = res;
    }
  } catch (err) {
    applySessionsLoadError(state, err);
  }
}

function buildSessionDeleteConfirmMessage(keys: string[]): string {
  const noun = keys.length === 1 ? "session" : "sessions";
  return `Delete ${keys.length} ${noun}?\n\nThis will delete the session entries and archive their transcripts.`;
}

async function confirmSessionDelete(state: SessionsState, keys: string[]): Promise<boolean> {
  if (typeof state.confirmDeleteSessions === "function") {
    return Boolean(await state.confirmDeleteSessions(keys));
  }
  if (typeof window === "undefined") {
    return true;
  }
  return window.confirm(buildSessionDeleteConfirmMessage(keys));
}

function applyOptimisticSessionDeletion(state: SessionsState, deleted: string[]): void {
  if (deleted.length === 0) {
    return;
  }
  const deletedKeys = new Set(deleted.map((value) => value.trim()).filter(Boolean));
  if (deletedKeys.size === 0) {
    return;
  }

  if (state.sessionsResult) {
    const nextSessions = state.sessionsResult.sessions.filter((row) => !deletedKeys.has(row.key));
    if (nextSessions.length !== state.sessionsResult.sessions.length) {
      state.sessionsResult = {
        ...state.sessionsResult,
        count: nextSessions.length,
        sessions: nextSessions,
      };
    }
  }

  const host = state as SessionsState & { sessionsSelectedKeys?: Set<string> };
  if (!(host.sessionsSelectedKeys instanceof Set)) {
    return;
  }
  let changed = false;
  const nextSelected = new Set(host.sessionsSelectedKeys);
  for (const key of deletedKeys) {
    changed = nextSelected.delete(key) || changed;
  }
  if (changed) {
    host.sessionsSelectedKeys = nextSelected;
  }
}

export async function loadSessions(state: SessionsState, overrides?: SessionsListOverrides) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sessionsLoading) {
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    const res = await requestSessionsList(state, overrides);
    if (res) {
      state.sessionsResult = res;
    }
  } catch (err) {
    applySessionsLoadError(state, err);
  } finally {
    state.sessionsLoading = false;
  }
}

export async function patchSession(
  state: SessionsState,
  key: string,
  patch: {
    label?: string | null;
    thinkingLevel?: string | null;
    fastMode?: boolean | null;
    verboseLevel?: string | null;
    reasoningLevel?: string | null;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const params: Record<string, unknown> = { key };
  if ("label" in patch) {
    params.label = patch.label;
  }
  if ("thinkingLevel" in patch) {
    params.thinkingLevel = patch.thinkingLevel;
  }
  if ("fastMode" in patch) {
    params.fastMode = patch.fastMode;
  }
  if ("verboseLevel" in patch) {
    params.verboseLevel = patch.verboseLevel;
  }
  if ("reasoningLevel" in patch) {
    params.reasoningLevel = patch.reasoningLevel;
  }
  try {
    await state.client.request("sessions.patch", params);
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  }
}

export async function deleteSessionsAndRefresh(
  state: SessionsState,
  keys: string[],
): Promise<string[]> {
  if (!state.client || !state.connected || keys.length === 0) {
    return [];
  }
  if (state.sessionsLoading) {
    return [];
  }
  const confirmed = await confirmSessionDelete(state, keys);
  if (!confirmed) {
    return [];
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  const deleted: string[] = [];
  const deleteErrors: string[] = [];
  try {
    for (const key of keys) {
      try {
        await state.client.request("sessions.delete", { key, deleteTranscript: true });
        deleted.push(key);
      } catch (err) {
        deleteErrors.push(String(err));
      }
    }
  } finally {
    state.sessionsLoading = false;
  }
  if (deleted.length > 0) {
    applyOptimisticSessionDeletion(state, deleted);
    if (state.sessionsResult) {
      void refreshSessionsQuietly(state);
    } else {
      await loadSessions(state);
    }
  }
  if (deleteErrors.length > 0) {
    state.sessionsError = deleteErrors.join("; ");
  }
  return deleted;
}
