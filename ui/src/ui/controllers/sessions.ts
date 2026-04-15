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
};

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
    state.sessionMessageSubscribedKey = null;
    return;
  }
  if (targetKey === activeKey) {
    return;
  }

  try {
    if (activeKey) {
      await state.client.request("sessions.messages.unsubscribe", { key: activeKey });
      state.sessionMessageSubscribedKey = null;
    }
    if (!targetKey) {
      return;
    }
    const response = await state.client.request<{
      key?: string;
      subscribed?: boolean;
    }>("sessions.messages.subscribe", { key: targetKey });
    const canonicalKey = normalizeSessionSubscriptionKey(response?.key) ?? targetKey;
    state.sessionMessageSubscribedKey = canonicalKey;
    applyCanonicalSessionSelection(state, canonicalKey);
  } catch (err) {
    state.sessionsError = String(err);
  }
}

export async function loadSessions(
  state: SessionsState,
  overrides?: {
    activeMinutes?: number;
    limit?: number;
    includeGlobal?: boolean;
    includeUnknown?: boolean;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sessionsLoading) {
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
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
    const res = await state.client.request<SessionsListResult | undefined>("sessions.list", params);
    if (res) {
      state.sessionsResult = res;
    }
  } catch (err) {
    if (isMissingOperatorReadScopeError(err)) {
      state.sessionsResult = null;
      state.sessionsError = formatMissingOperatorReadScopeMessage("sessions");
    } else {
      state.sessionsError = String(err);
    }
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
  const noun = keys.length === 1 ? "session" : "sessions";
  const confirmed = window.confirm(
    `Delete ${keys.length} ${noun}?\n\nThis will delete the session entries and archive their transcripts.`,
  );
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
    await loadSessions(state);
  }
  if (deleteErrors.length > 0) {
    state.sessionsError = deleteErrors.join("; ");
  }
  return deleted;
}
