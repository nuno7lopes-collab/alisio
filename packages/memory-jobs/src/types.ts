export type MemoryJobKind = "consolidate" | "dedup" | "health";

export type MemoryJobStatus = "idle" | "running" | "paused" | "failed";

export type MemoryJobEventType =
  | "PROMOTED_TO_CLAIM"
  | "PROMOTED_TO_PROCEDURE"
  | "MERGE_PROPOSED"
  | "ENTITY_MERGED"
  | "ENTITY_DELETED"
  | "PROJECTION_MERGE_PROPOSED"
  | "PROJECTION_DELETED"
  | "RELATION_DELETED"
  | "CHECKPOINT_CREATED"
  | "DASHBOARD_UPDATED";

export type MemoryJobRecord = {
  jobId: string;
  profileId: string;
  kind: MemoryJobKind;
  status: MemoryJobStatus;
  cursorJson: string;
  updatedAtMs: number;
  lastError?: string;
};

export type MemoryJobEvent = {
  eventId: string;
  jobId: string;
  profileId: string;
  kind: MemoryJobKind;
  eventType: MemoryJobEventType;
  entityId?: string;
  targetEntityId?: string;
  payload: Record<string, unknown>;
  createdAtMs: number;
  dedupeKey?: string;
};

export type SleepFeatureFlags = {
  enabled?: boolean;
  maxWallTimeMs?: number;
  maxTokensPerRun?: number;
};

export type SleepClock = {
  now(): number;
};

export type SleepLogger = {
  debug?(message: string, meta?: unknown): void;
  info?(message: string, meta?: unknown): void;
  warn?(message: string, meta?: unknown): void;
};

export type SleepActivityMonitor = {
  isSessionActive(): boolean;
};

export type SleepTelemetrySnapshot = {
  counts: Record<string, number>;
};

export type HealthFindingSeverity = "warn" | "error";

export type HealthFinding = {
  id: string;
  severity: HealthFindingSeverity;
  itemType: "entity" | "projection" | "attachment";
  itemId: string;
  title: string;
  detail: string;
  path?: string;
  score?: number;
};

export type HealthDashboard = {
  generatedAtMs: number;
  staleClaims: HealthFinding[];
  contradictions: HealthFinding[];
  orphanPages: HealthFinding[];
  brokenAttachments: HealthFinding[];
  lowConfidenceItems: HealthFinding[];
};

export type SleepRunStatus =
  | "completed"
  | "budget-exhausted"
  | "preempted"
  | "skipped-active"
  | "disabled";

export type SleepRunResult = {
  status: SleepRunStatus;
  startedAtMs: number;
  endedAtMs: number;
  preemptedJob?: MemoryJobKind;
  workDoneCounts: Record<string, number>;
  telemetry: SleepTelemetrySnapshot;
  jobRecords: MemoryJobRecord[];
  healthDashboard?: HealthDashboard;
};

export type SleepSchedulerOptions = {
  dbPath: string;
  profileId: string;
  workspaceScope: string;
  workspaceDir: string;
  gaiaActorId?: string;
  featureFlags?: SleepFeatureFlags;
  autoMergeConfirmed?: boolean;
  sliceMs?: number;
  activityMonitor?: SleepActivityMonitor;
  clock?: SleepClock;
  logger?: SleepLogger;
};

export type CheckpointCursorState = {
  pendingEventCount: number;
  pendingPayloadBytes: number;
};

export type ConsolidateCursor = {
  lastPageId?: string;
  checkpoint: CheckpointCursorState;
};

export type DedupCursor = {
  lastPageId?: string;
  checkpoint: CheckpointCursorState;
};

export type HealthCursor = {
  phase:
    | "staleClaims"
    | "contradictions"
    | "orphanPages"
    | "brokenAttachments"
    | "lowConfidenceItems";
  lastItemId?: string;
  checkpoint: CheckpointCursorState;
  dashboard: HealthDashboard;
};

export type MemorySleepJobResult<TCursor> = {
  status: "completed" | "budget-exhausted" | "preempted";
  cursor: TCursor;
  workDoneCounts: Record<string, number>;
  healthDashboard?: HealthDashboard;
};
