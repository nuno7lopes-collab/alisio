import type {
  BrowserSessionActionSnapshot,
  BrowserSessionAuthSnapshot,
  BrowserSessionRecoverySnapshot,
} from "./browser-action.types.js";
import {
  BrowserSessionLeaseConflictError,
  createBrowserSessionLeaseRegistry,
  type BrowserSessionLeaseRegistry,
} from "./browser-session-lease.js";
import { createBrowserSessionTimeline } from "./browser-session-timeline.js";
import type {
  BrowserProfileSessionSnapshot,
  BrowserProfileSessionStateKind,
  BrowserSessionLeaseSnapshot,
  BrowserSessionSupervisor,
  BrowserTrackedSessionBrowserTab,
  BrowserTrackedSessionSnapshot,
  BrowserTrackedSessionStateKind,
} from "./browser-session.types.js";

type InternalTrackedSession = {
  sessionKey: string;
  state: BrowserTrackedSessionStateKind;
  lastTargetId: string | null;
  updatedAt: number;
  lease: BrowserSessionLeaseSnapshot | null;
  trackedTabs: Map<string, BrowserTrackedSessionBrowserTab>;
  lastAction: BrowserSessionActionSnapshot | null;
  lastRecovery: BrowserSessionRecoverySnapshot | null;
  auth: BrowserSessionAuthSnapshot | null;
};

const runtimeLinkState = new WeakMap<
  object,
  { supervisor: BrowserSessionSupervisor; profile: string }
>();

function normalizeProfileName(raw: string): string {
  return raw.trim();
}

function normalizeSessionKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeOwner(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeTargetId(raw?: string | null): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function normalizeBaseUrl(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTrackedProfile(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function toTrackedTabId(params: { targetId: string; baseUrl?: string; profile?: string }): string {
  return `${params.targetId}\u0000${params.baseUrl ?? ""}\u0000${params.profile ?? ""}`;
}

function cloneTrackedSession(session: InternalTrackedSession): BrowserTrackedSessionSnapshot {
  return {
    sessionKey: session.sessionKey,
    state: session.state,
    lastTargetId: session.lastTargetId,
    updatedAt: session.updatedAt,
    lease: session.lease ? { ...session.lease } : null,
    trackedTabs: [...session.trackedTabs.values()].map((tab) => ({ ...tab })),
    lastAction: session.lastAction ? { ...session.lastAction } : null,
    lastRecovery: session.lastRecovery ? { ...session.lastRecovery } : null,
    auth: session.auth ? { ...session.auth } : null,
  };
}

function deriveTrackedSessionState(
  session: InternalTrackedSession,
): BrowserTrackedSessionStateKind {
  if (session.lease) {
    return "leased";
  }
  if (session.trackedTabs.size > 0) {
    return "active";
  }
  return "idle";
}

function deriveLastTrackedTargetId(session: InternalTrackedSession): string | null {
  let latest: BrowserTrackedSessionBrowserTab | null = null;
  for (const tracked of session.trackedTabs.values()) {
    if (!latest || tracked.trackedAt >= latest.trackedAt) {
      latest = tracked;
    }
  }
  return latest?.targetId ?? null;
}

export function createBrowserSessionSupervisor(params?: {
  now?: () => number;
  timelineLimit?: number;
}): BrowserSessionSupervisor {
  const now = params?.now ?? Date.now;
  const profileSessions = new Map<string, BrowserProfileSessionSnapshot>();
  const trackedSessions = new Map<string, InternalTrackedSession>();
  const timeline = createBrowserSessionTimeline({ limit: params?.timelineLimit });
  const leases: BrowserSessionLeaseRegistry = createBrowserSessionLeaseRegistry({
    now,
    onEvent: (event) => timeline.append(event),
  });

  const ensureProfileSession = (rawProfileName: string): BrowserProfileSessionSnapshot => {
    const profileName = normalizeProfileName(rawProfileName);
    let current = profileSessions.get(profileName);
    if (!current) {
      current = {
        profileName,
        state: "idle",
        lastTargetId: null,
        updatedAt: now(),
        reason: null,
      };
      profileSessions.set(profileName, current);
    }
    return current;
  };

  const ensureTrackedSession = (rawSessionKey: string): InternalTrackedSession => {
    const sessionKey = normalizeSessionKey(rawSessionKey);
    let current = trackedSessions.get(sessionKey);
    if (!current) {
      current = {
        sessionKey,
        state: "idle",
        lastTargetId: null,
        updatedAt: now(),
        lease: null,
        trackedTabs: new Map(),
        lastAction: null,
        lastRecovery: null,
        auth: null,
      };
      trackedSessions.set(sessionKey, current);
    }
    return current;
  };

  const updateTrackedSession = (session: InternalTrackedSession) => {
    session.lease = leases.current(session.sessionKey);
    session.lastTargetId = deriveLastTrackedTargetId(session);
    session.state = deriveTrackedSessionState(session);
    session.updatedAt = now();
    return cloneTrackedSession(session);
  };

  const markProfileSessionState = (
    rawProfileName: string,
    state: BrowserProfileSessionStateKind,
    params?: {
      lastTargetId?: string | null;
      reason?: string | null;
    },
  ): BrowserProfileSessionSnapshot => {
    const current = ensureProfileSession(rawProfileName);
    const next: BrowserProfileSessionSnapshot = {
      profileName: current.profileName,
      state,
      lastTargetId:
        params && Object.hasOwn(params, "lastTargetId")
          ? normalizeTargetId(params.lastTargetId ?? null)
          : current.lastTargetId,
      updatedAt: now(),
      reason: params?.reason ?? null,
    };
    profileSessions.set(current.profileName, next);
    timeline.append({
      at: next.updatedAt,
      kind: "profile.state",
      profileName: next.profileName,
      targetId: next.lastTargetId,
      state: next.state,
      reason: next.reason ?? null,
    });
    return { ...next };
  };

  return {
    getProfileSession(profileName) {
      return { ...ensureProfileSession(profileName) };
    },
    listProfileSessions() {
      return [...profileSessions.values()].map((session) => ({ ...session }));
    },
    readProfileLastTargetId(profileName) {
      return ensureProfileSession(profileName).lastTargetId;
    },
    writeProfileLastTargetId(profileName, targetId, params) {
      const normalizedTargetId = normalizeTargetId(targetId);
      return markProfileSessionState(
        profileName,
        params?.state ?? (normalizedTargetId ? "active" : "idle"),
        {
          lastTargetId: normalizedTargetId,
          reason: params?.reason ?? null,
        },
      );
    },
    markProfileSessionState,
    trackSessionTab(params) {
      const rawSessionKey = params.sessionKey?.trim();
      const targetId = normalizeTargetId(params.targetId);
      if (!rawSessionKey || !targetId) {
        return null;
      }
      const session = ensureTrackedSession(rawSessionKey);
      const tracked: BrowserTrackedSessionBrowserTab = {
        sessionKey: session.sessionKey,
        targetId,
        baseUrl: normalizeBaseUrl(params.baseUrl),
        profile: normalizeTrackedProfile(params.profile),
        trackedAt: now(),
      };
      session.trackedTabs.set(toTrackedTabId(tracked), tracked);
      const next = updateTrackedSession(session);
      timeline.append({
        at: next.updatedAt,
        kind: "session.tab.tracked",
        sessionKey: session.sessionKey,
        targetId,
        state: next.state,
      });
      return next;
    },
    untrackSessionTab(params) {
      const rawSessionKey = params.sessionKey?.trim();
      const targetId = normalizeTargetId(params.targetId);
      if (!rawSessionKey || !targetId) {
        return null;
      }
      const sessionKey = normalizeSessionKey(rawSessionKey);
      const session = trackedSessions.get(sessionKey);
      if (!session) {
        return null;
      }
      session.trackedTabs.delete(
        toTrackedTabId({
          targetId,
          baseUrl: normalizeBaseUrl(params.baseUrl),
          profile: normalizeTrackedProfile(params.profile),
        }),
      );
      const next = updateTrackedSession(session);
      timeline.append({
        at: next.updatedAt,
        kind: "session.tab.untracked",
        sessionKey,
        targetId,
        state: next.state,
      });
      return next;
    },
    takeTrackedTabsForSessions(rawSessionKeys) {
      const sessionKeys = new Set<string>();
      for (const rawSessionKey of rawSessionKeys) {
        if (!rawSessionKey?.trim()) {
          continue;
        }
        sessionKeys.add(normalizeSessionKey(rawSessionKey));
      }
      if (sessionKeys.size === 0) {
        return [];
      }
      const seenTrackedIds = new Set<string>();
      const tabs: BrowserTrackedSessionBrowserTab[] = [];
      for (const sessionKey of sessionKeys) {
        const session = trackedSessions.get(sessionKey);
        if (!session || session.trackedTabs.size === 0) {
          continue;
        }
        const currentTabs = [...session.trackedTabs.values()];
        session.trackedTabs.clear();
        const next = updateTrackedSession(session);
        timeline.append({
          at: next.updatedAt,
          kind: "session.tab.taken",
          sessionKey,
          state: next.state,
        });
        for (const tracked of currentTabs) {
          const trackedId = toTrackedTabId(tracked);
          if (seenTrackedIds.has(trackedId)) {
            continue;
          }
          seenTrackedIds.add(trackedId);
          tabs.push({ ...tracked });
        }
      }
      return tabs;
    },
    getTrackedSession(rawSessionKey) {
      const sessionKey = normalizeSessionKey(rawSessionKey);
      const session = trackedSessions.get(sessionKey);
      return session ? cloneTrackedSession(session) : null;
    },
    listTrackedSessions() {
      return [...trackedSessions.values()].map((session) => cloneTrackedSession(session));
    },
    acquireSessionLease(params) {
      const session = ensureTrackedSession(params.sessionKey);
      const lease = leases.acquire({
        sessionKey: session.sessionKey,
        owner: normalizeOwner(params.owner),
      });
      session.lease = { ...lease };
      session.state = deriveTrackedSessionState(session);
      session.updatedAt = now();
      return { ...lease };
    },
    ensureSessionLease(params) {
      const rawSessionKey = params.sessionKey?.trim();
      const rawOwner = params.owner?.trim();
      if (!rawSessionKey || !rawOwner) {
        return null;
      }
      const session = ensureTrackedSession(rawSessionKey);
      const currentLease = leases.current(session.sessionKey);
      if (currentLease) {
        if (currentLease.owner !== normalizeOwner(rawOwner)) {
          throw new BrowserSessionLeaseConflictError(currentLease);
        }
        session.lease = currentLease;
        session.state = deriveTrackedSessionState(session);
        session.updatedAt = now();
        return currentLease;
      }
      return this.acquireSessionLease({
        sessionKey: rawSessionKey,
        owner: rawOwner,
      });
    },
    releaseSessionLease(params) {
      const sessionKey = normalizeSessionKey(params.sessionKey);
      const released = leases.release({
        sessionKey,
        owner: normalizeOwner(params.owner),
        fencingToken: params.fencingToken,
      });
      if (!released) {
        return false;
      }
      const session = trackedSessions.get(sessionKey);
      if (session) {
        session.lease = leases.current(sessionKey);
        session.state = deriveTrackedSessionState(session);
        session.updatedAt = now();
      }
      return true;
    },
    getSessionLease(sessionKey) {
      return leases.current(sessionKey);
    },
    recordSessionAction(params) {
      const rawSessionKey = params.sessionKey?.trim();
      if (!rawSessionKey) {
        return null;
      }
      const session = ensureTrackedSession(rawSessionKey);
      const at = now();
      session.lastAction = {
        kind: params.kind.trim(),
        layer: params.layer,
        recovered: params.recovered === true,
        recoveryCode: params.recoveryCode ?? null,
        reusedAuth: params.reusedAuth === true,
        blindFilled: params.blindFilled === true,
        targetId: normalizeTargetId(params.targetId ?? null),
        updatedAt: at,
      };
      session.updatedAt = at;
      timeline.append({
        at,
        kind: "session.action",
        sessionKey: session.sessionKey,
        targetId: session.lastAction.targetId ?? null,
        actionKind: session.lastAction.kind,
        layer: session.lastAction.layer,
        recovered: session.lastAction.recovered,
        recoveryCode: session.lastAction.recoveryCode ?? null,
        reusedAuth: session.lastAction.reusedAuth,
        blindFilled: session.lastAction.blindFilled,
      });
      return cloneTrackedSession(session);
    },
    recordSessionRecovery(params) {
      const rawSessionKey = params.sessionKey?.trim();
      if (!rawSessionKey) {
        return null;
      }
      const session = ensureTrackedSession(rawSessionKey);
      const at = now();
      session.lastRecovery = {
        code: params.code,
        targetId: normalizeTargetId(params.targetId ?? null),
        recovered: params.recovered === true,
        detail: params.detail?.trim() || null,
        updatedAt: at,
      };
      session.updatedAt = at;
      timeline.append({
        at,
        kind: "session.recovery",
        sessionKey: session.sessionKey,
        targetId: session.lastRecovery.targetId ?? null,
        recoveryCode: session.lastRecovery.code,
        recovered: session.lastRecovery.recovered,
        detail: session.lastRecovery.detail ?? null,
      });
      return cloneTrackedSession(session);
    },
    recordSessionAuth(params) {
      const rawSessionKey = params.sessionKey?.trim();
      if (!rawSessionKey) {
        return null;
      }
      const session = ensureTrackedSession(rawSessionKey);
      const at = now();
      session.auth = {
        origin: params.origin?.trim() || null,
        status: params.status,
        method: params.method,
        targetId: normalizeTargetId(params.targetId ?? null),
        fields:
          typeof params.fields === "number" && Number.isFinite(params.fields)
            ? Math.max(0, Math.floor(params.fields))
            : undefined,
        updatedAt: at,
      };
      session.updatedAt = at;
      timeline.append({
        at,
        kind: "session.auth",
        sessionKey: session.sessionKey,
        targetId: session.auth.targetId ?? null,
        origin: session.auth.origin,
        authMethod: session.auth.method,
        state: session.auth.status,
        fields: session.auth.fields,
      });
      return cloneTrackedSession(session);
    },
    listTimeline() {
      return timeline.list();
    },
    resetForTests() {
      profileSessions.clear();
      trackedSessions.clear();
      leases.clear();
      timeline.clear();
    },
  };
}

export function bindProfileRuntimeLastTargetId(params: {
  runtime: { lastTargetId?: string | null };
  profileName: string;
  supervisor: BrowserSessionSupervisor;
}): void {
  const linked = runtimeLinkState.get(params.runtime as object);
  if (
    linked?.supervisor === params.supervisor &&
    linked.profile === normalizeProfileName(params.profileName)
  ) {
    return;
  }

  const existingLastTargetId = Object.hasOwn(params.runtime, "lastTargetId")
    ? normalizeTargetId(params.runtime.lastTargetId ?? null)
    : null;
  if (existingLastTargetId) {
    params.supervisor.writeProfileLastTargetId(params.profileName, existingLastTargetId, {
      state: "active",
    });
  } else {
    params.supervisor.getProfileSession(params.profileName);
  }

  Object.defineProperty(params.runtime, "lastTargetId", {
    configurable: true,
    enumerable: true,
    get() {
      return params.supervisor.readProfileLastTargetId(params.profileName);
    },
    set(value: string | null | undefined) {
      params.supervisor.writeProfileLastTargetId(params.profileName, value ?? null);
    },
  });
  runtimeLinkState.set(params.runtime as object, {
    supervisor: params.supervisor,
    profile: normalizeProfileName(params.profileName),
  });
}
