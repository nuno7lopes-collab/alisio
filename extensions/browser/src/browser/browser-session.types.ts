import type {
  BrowserActionLayer,
  BrowserActionRecoveryCode,
  BrowserSessionActionSnapshot,
  BrowserSessionAuthMethod,
  BrowserSessionAuthSnapshot,
  BrowserSessionRecoverySnapshot,
} from "./browser-action.types.js";

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
  lastAction: BrowserSessionActionSnapshot | null;
  lastRecovery: BrowserSessionRecoverySnapshot | null;
  auth: BrowserSessionAuthSnapshot | null;
};

export type BrowserSessionTimelineEventKind =
  | "profile.state"
  | "session.lease.acquired"
  | "session.lease.released"
  | "session.tab.tracked"
  | "session.tab.untracked"
  | "session.tab.taken"
  | "session.action"
  | "session.recovery"
  | "session.auth";

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
  actionKind?: string;
  layer?: BrowserActionLayer;
  recoveryCode?: BrowserActionRecoveryCode | null;
  recovered?: boolean;
  detail?: string | null;
  origin?: string | null;
  authMethod?: BrowserSessionAuthMethod;
  fields?: number;
  reusedAuth?: boolean;
  blindFilled?: boolean;
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
  ensureSessionLease: (params: {
    sessionKey: string;
    owner: string;
  }) => BrowserSessionLeaseSnapshot | null;
  releaseSessionLease: (params: {
    sessionKey: string;
    owner: string;
    fencingToken: number;
  }) => boolean;
  getSessionLease: (sessionKey: string) => BrowserSessionLeaseSnapshot | null;
  recordSessionAction: (params: {
    sessionKey: string;
    kind: string;
    layer: BrowserActionLayer;
    targetId?: string | null;
    recovered?: boolean;
    recoveryCode?: BrowserActionRecoveryCode | null;
    reusedAuth?: boolean;
    blindFilled?: boolean;
  }) => BrowserTrackedSessionSnapshot | null;
  recordSessionRecovery: (params: {
    sessionKey: string;
    code: BrowserActionRecoveryCode;
    targetId?: string | null;
    recovered?: boolean;
    detail?: string | null;
  }) => BrowserTrackedSessionSnapshot | null;
  recordSessionAuth: (params: {
    sessionKey: string;
    origin?: string | null;
    status: "none" | "primed" | "reused";
    method: BrowserSessionAuthMethod;
    targetId?: string | null;
    fields?: number;
  }) => BrowserTrackedSessionSnapshot | null;
  listTimeline: () => BrowserSessionTimelineEvent[];
  resetForTests: () => void;
};
