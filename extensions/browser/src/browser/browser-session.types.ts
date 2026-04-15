export type BrowserProfileSessionStateKind = "idle" | "active" | "reconciling";

export type BrowserTrackedSessionStateKind = "idle" | "active" | "leased";

export type BrowserSessionLeaseSnapshot = {
  sessionKey: string;
  owner: string;
  fencingToken: number;
  acquiredAt: number;
};

export type BrowserTrackedSessionBrowserTab = {
  sessionKey: string;
  targetId: string;
  baseUrl?: string;
  profile?: string;
  trackedAt: number;
};

export type BrowserProfileSessionSnapshot = {
  profileName: string;
  state: BrowserProfileSessionStateKind;
  lastTargetId: string | null;
  updatedAt: number;
  reason?: string | null;
};

export type BrowserTrackedSessionSnapshot = {
  sessionKey: string;
  state: BrowserTrackedSessionStateKind;
  lastTargetId: string | null;
  updatedAt: number;
  lease: BrowserSessionLeaseSnapshot | null;
  trackedTabs: BrowserTrackedSessionBrowserTab[];
};

export type BrowserSessionTimelineEventKind =
  | "profile.state"
  | "session.lease.acquired"
  | "session.lease.released"
  | "session.tab.tracked"
  | "session.tab.untracked"
  | "session.tab.taken";

export type BrowserSessionTimelineEvent = {
  at: number;
  kind: BrowserSessionTimelineEventKind;
  profileName?: string;
  sessionKey?: string;
  targetId?: string | null;
  owner?: string;
  fencingToken?: number;
  state?: string;
  reason?: string | null;
};

export type BrowserSessionSupervisor = {
  getProfileSession: (profileName: string) => BrowserProfileSessionSnapshot;
  listProfileSessions: () => BrowserProfileSessionSnapshot[];
  readProfileLastTargetId: (profileName: string) => string | null;
  writeProfileLastTargetId: (
    profileName: string,
    targetId: string | null,
    params?: {
      reason?: string | null;
      state?: BrowserProfileSessionStateKind;
    },
  ) => BrowserProfileSessionSnapshot;
  markProfileSessionState: (
    profileName: string,
    state: BrowserProfileSessionStateKind,
    params?: {
      lastTargetId?: string | null;
      reason?: string | null;
    },
  ) => BrowserProfileSessionSnapshot;
  trackSessionTab: (params: {
    sessionKey?: string;
    targetId?: string;
    baseUrl?: string;
    profile?: string;
  }) => BrowserTrackedSessionSnapshot | null;
  untrackSessionTab: (params: {
    sessionKey?: string;
    targetId?: string;
    baseUrl?: string;
    profile?: string;
  }) => BrowserTrackedSessionSnapshot | null;
  takeTrackedTabsForSessions: (
    sessionKeys: Array<string | undefined>,
  ) => BrowserTrackedSessionBrowserTab[];
  getTrackedSession: (sessionKey: string) => BrowserTrackedSessionSnapshot | null;
  listTrackedSessions: () => BrowserTrackedSessionSnapshot[];
  acquireSessionLease: (params: {
    sessionKey: string;
    owner: string;
  }) => BrowserSessionLeaseSnapshot;
  releaseSessionLease: (params: {
    sessionKey: string;
    owner: string;
    fencingToken: number;
  }) => boolean;
  getSessionLease: (sessionKey: string) => BrowserSessionLeaseSnapshot | null;
  listTimeline: () => BrowserSessionTimelineEvent[];
  resetForTests: () => void;
};
