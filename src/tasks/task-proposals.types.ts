import type { TaskRecord } from "./task-registry.types.js";

export type TaskProposalKind = "task" | "project";

export type TaskProposalDecision = "pending" | "approved" | "rejected";

export type TaskProposalCreatedBy = "assistant" | "user";

export type TaskProposalRecord = {
  proposalId: string;
  clientKey: string;
  requesterSessionKey: string;
  sourceMessageId?: string;
  kind: TaskProposalKind;
  title: string;
  summary?: string;
  rationale?: string;
  acceptance: string[];
  launchPrompt?: string;
  agentId?: string;
  createdBy: TaskProposalCreatedBy;
  decision: TaskProposalDecision;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  launchedRunId?: string;
  launchedSessionKey?: string;
  launchedAt?: number;
};

export type TaskProposalView = TaskProposalRecord & {
  linkedTask?: TaskRecord;
};

export type TaskProposalSummary = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  launched: number;
};
