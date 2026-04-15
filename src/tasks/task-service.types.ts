export type TaskKind = "task" | "project";

export type TaskStatus =
  | "draft"
  | "pending_approval"
  | "ready"
  | "in_progress"
  | "blocked"
  | "awaiting_review"
  | "completed"
  | "cancelled"
  | "failed";

export type TaskExecutionKind = "subagent" | "acp" | "cron" | "cli" | "orchestrator_session";

export type TaskExecutionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "lost";

export type TaskExecutionTerminalOutcome = "succeeded" | "blocked";

export type TaskAssignmentStatus = "active" | "released" | "expired";

export type TaskApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type TaskEventKind =
  | "created"
  | "updated"
  | "claimed"
  | "released"
  | "child_spawned"
  | "approval_requested"
  | "approval_decided"
  | "execution_started"
  | "execution_ended"
  | "execution_cancelled";

export type TaskDependencyKind = "blocks";

export type Task = {
  taskId: string;
  rootTaskId: string;
  parentTaskId?: string;
  proposalId?: string;
  kind: TaskKind;
  title: string;
  summary?: string;
  description?: string;
  acceptance: string[];
  requesterSessionKey?: string;
  requestedBy?: string;
  ownerAgentId?: string;
  orchestratorSessionKey?: string;
  status: TaskStatus;
  blockedReason?: string;
  activeExecutionId?: string;
  latestExecutionId?: string;
  latestApprovalId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
};

export type TaskExecution = {
  executionId: string;
  taskId: string;
  kind: TaskExecutionKind;
  attempt: number;
  sourceId?: string;
  runId?: string;
  sessionKey?: string;
  agentId?: string;
  label?: string;
  status: TaskExecutionStatus;
  summary?: string;
  error?: string;
  terminalOutcome?: TaskExecutionTerminalOutcome;
  cancellationReason?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
};

export type TaskAssignment = {
  assignmentId: string;
  taskId: string;
  agentId: string;
  sessionKey?: string;
  claimedBy?: string;
  status: TaskAssignmentStatus;
  claimedAt: number;
  leaseExpiresAt: number;
  releasedAt?: number;
};

export type TaskApproval = {
  approvalId: string;
  taskId: string;
  status: TaskApprovalStatus;
  requestedAt: number;
  requestedBy?: string;
  decidedAt?: number;
  decidedBy?: string;
  note?: string;
};

export type TaskEvent = {
  eventId: string;
  taskId: string;
  executionId?: string;
  assignmentId?: string;
  approvalId?: string;
  kind: TaskEventKind;
  actor?: string;
  summary?: string;
  dataJson?: string;
  createdAt: number;
};

export type TaskDependency = {
  dependencyId: string;
  taskId: string;
  dependsOnTaskId: string;
  kind: TaskDependencyKind;
  createdAt: number;
};
