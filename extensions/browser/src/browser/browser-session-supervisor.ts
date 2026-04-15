import {
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
