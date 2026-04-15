import type {
  BrowserSessionLeaseSnapshot,
  BrowserSessionTimelineEvent,
} from "./browser-session.types.js";

type InternalLeaseState = {
  current: BrowserSessionLeaseSnapshot | null;
  lastFencingToken: number;
};

export type BrowserSessionLeaseRegistry = {
  acquire: (params: { sessionKey: string; owner: string }) => BrowserSessionLeaseSnapshot;
  current: (sessionKey: string) => BrowserSessionLeaseSnapshot | null;
  release: (params: { sessionKey: string; owner: string; fencingToken: number }) => boolean;
  clear: () => void;
};

function normalizeSessionKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeOwner(raw: string): string {
  return raw.trim().toLowerCase();
}

export function createBrowserSessionLeaseRegistry(params?: {
  now?: () => number;
  onEvent?: (event: BrowserSessionTimelineEvent) => void;
}): BrowserSessionLeaseRegistry {
  const now = params?.now ?? Date.now;
  const onEvent = params?.onEvent;
  const leases = new Map<string, InternalLeaseState>();

  const getLeaseState = (rawSessionKey: string): InternalLeaseState => {
    const sessionKey = normalizeSessionKey(rawSessionKey);
    let current = leases.get(sessionKey);
    if (!current) {
      current = { current: null, lastFencingToken: 0 };
      leases.set(sessionKey, current);
    }
    return current;
  };

  return {
    acquire(leaseParams) {
      const sessionKey = normalizeSessionKey(leaseParams.sessionKey);
      const owner = normalizeOwner(leaseParams.owner);
      const state = getLeaseState(sessionKey);
      const next: BrowserSessionLeaseSnapshot = {
        sessionKey,
        owner,
        fencingToken: state.lastFencingToken + 1,
        acquiredAt: now(),
      };
      state.lastFencingToken = next.fencingToken;
      state.current = next;
      onEvent?.({
        at: next.acquiredAt,
        kind: "session.lease.acquired",
        sessionKey,
        owner,
        fencingToken: next.fencingToken,
      });
      return { ...next };
    },
    current(rawSessionKey) {
      const current = leases.get(normalizeSessionKey(rawSessionKey))?.current;
      return current ? { ...current } : null;
    },
    release(leaseParams) {
      const sessionKey = normalizeSessionKey(leaseParams.sessionKey);
      const owner = normalizeOwner(leaseParams.owner);
      const state = leases.get(sessionKey);
      if (!state?.current) {
        return false;
      }
      const current = state.current;
      if (current.owner !== owner || current.fencingToken !== leaseParams.fencingToken) {
        return false;
      }
      state.current = null;
      onEvent?.({
        at: now(),
        kind: "session.lease.released",
        sessionKey,
        owner,
        fencingToken: current.fencingToken,
      });
      return true;
    },
    clear() {
      leases.clear();
    },
  };
}
