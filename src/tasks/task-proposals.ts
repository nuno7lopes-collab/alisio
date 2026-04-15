import crypto from "node:crypto";
import type {
  TaskProposalCreatedBy,
  TaskProposalDecision,
  TaskProposalKind,
  TaskProposalRecord,
  TaskProposalSummary,
  TaskProposalView,
} from "./task-proposals.types.js";
import { findTaskByRunId } from "./task-registry.js";
import {
  getTaskProposalRecordByClientKeyFromSqlite,
  getTaskProposalRecordByIdFromSqlite,
  listTaskProposalRecordsFromSqlite,
  upsertTaskProposalRecordToSqlite,
} from "./task-registry.store.sqlite.js";

const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 800;
const MAX_RATIONALE_LENGTH = 1_600;
const MAX_LAUNCH_PROMPT_LENGTH = 8_000;
const MAX_ACCEPTANCE_ITEMS = 12;
const MAX_ACCEPTANCE_ITEM_LENGTH = 240;

function trimToUndefined(value: string | null | undefined, maxLength?: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (typeof maxLength === "number" && maxLength > 0) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
}

function normalizeAcceptance(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => trimToUndefined(value, MAX_ACCEPTANCE_ITEM_LENGTH))
    .filter((value): value is string => Boolean(value))
    .slice(0, MAX_ACCEPTANCE_ITEMS);
}

function buildProposalContentFields(params: {
  existing?: TaskProposalRecord | null;
  sourceMessageId?: string;
  kind?: TaskProposalKind | null;
  title: string;
  summary?: string;
  rationale?: string;
  acceptance?: string[] | null;
  launchPrompt?: string;
  agentId?: string;
}) {
  if (params.existing?.launchedRunId?.trim()) {
    return {
      ...(params.existing.sourceMessageId
        ? { sourceMessageId: params.existing.sourceMessageId }
        : {}),
      kind: params.existing.kind,
      title: params.existing.title,
      ...(params.existing.summary ? { summary: params.existing.summary } : {}),
      ...(params.existing.rationale ? { rationale: params.existing.rationale } : {}),
      acceptance: [...params.existing.acceptance],
      ...(params.existing.launchPrompt ? { launchPrompt: params.existing.launchPrompt } : {}),
      ...(params.existing.agentId ? { agentId: params.existing.agentId } : {}),
    };
  }
  return {
    ...(params.sourceMessageId ? { sourceMessageId: params.sourceMessageId } : {}),
    kind: params.kind === "project" ? "project" : "task",
    title: params.title,
    ...(params.summary ? { summary: params.summary } : {}),
    ...(params.rationale ? { rationale: params.rationale } : {}),
    acceptance: normalizeAcceptance(params.acceptance),
    ...(params.launchPrompt ? { launchPrompt: params.launchPrompt } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
  };
}

function cloneTaskProposalRecord(record: TaskProposalRecord): TaskProposalRecord {
  return {
    ...record,
    acceptance: [...record.acceptance],
  };
}

function toTaskProposalView(record: TaskProposalRecord): TaskProposalView {
  const linkedTask =
    typeof record.launchedRunId === "string" && record.launchedRunId.trim()
      ? findTaskByRunId(record.launchedRunId)
      : undefined;
  return {
    ...cloneTaskProposalRecord(record),
    ...(linkedTask ? { linkedTask } : {}),
  };
}

function compareTaskProposalViews(left: TaskProposalView, right: TaskProposalView): number {
  const leftPending = left.decision === "pending" ? 0 : left.decision === "approved" ? 1 : 2;
  const rightPending = right.decision === "pending" ? 0 : right.decision === "approved" ? 1 : 2;
  if (leftPending !== rightPending) {
    return leftPending - rightPending;
  }
  const leftLaunched = left.launchedAt ?? 0;
  const rightLaunched = right.launchedAt ?? 0;
  if (leftPending === 1 && Boolean(leftLaunched) !== Boolean(rightLaunched)) {
    return leftLaunched ? 1 : -1;
  }
  return (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt);
}

export function createEmptyTaskProposalSummary(): TaskProposalSummary {
  return {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    launched: 0,
  };
}

export function summarizeTaskProposals(records: Iterable<TaskProposalRecord>): TaskProposalSummary {
  const summary = createEmptyTaskProposalSummary();
  for (const record of records) {
    summary.total += 1;
    summary[record.decision] += 1;
    if (record.launchedRunId?.trim()) {
      summary.launched += 1;
    }
  }
  return summary;
}

export function listTaskProposalViews(): TaskProposalView[] {
  return listTaskProposalRecordsFromSqlite()
    .map(toTaskProposalView)
    .toSorted(compareTaskProposalViews);
}

export function getTaskProposalViewById(proposalId: string): TaskProposalView | null {
  const record = getTaskProposalRecordByIdFromSqlite(proposalId.trim());
  return record ? toTaskProposalView(record) : null;
}

type UpsertTaskProposalParams = {
  clientKey: string;
  requesterSessionKey: string;
  sourceMessageId?: string | null;
  kind?: TaskProposalKind | null;
  title: string;
  summary?: string | null;
  rationale?: string | null;
  acceptance?: string[] | null;
  launchPrompt?: string | null;
  agentId?: string | null;
  createdBy?: TaskProposalCreatedBy | null;
};

export function upsertTaskProposal(params: UpsertTaskProposalParams): TaskProposalView {
  const clientKey = trimToUndefined(params.clientKey, 240);
  const requesterSessionKey = trimToUndefined(params.requesterSessionKey, 240);
  const title = trimToUndefined(params.title, MAX_TITLE_LENGTH);
  const sourceMessageId = trimToUndefined(params.sourceMessageId, 240);
  const summary = trimToUndefined(params.summary, MAX_SUMMARY_LENGTH);
  const rationale = trimToUndefined(params.rationale, MAX_RATIONALE_LENGTH);
  const launchPrompt = trimToUndefined(params.launchPrompt, MAX_LAUNCH_PROMPT_LENGTH);
  const agentId = trimToUndefined(params.agentId, 120);
  if (!clientKey || !requesterSessionKey || !title) {
    throw new Error("Task proposal requires clientKey, requesterSessionKey, and title.");
  }

  const existing = getTaskProposalRecordByClientKeyFromSqlite({
    requesterSessionKey,
    clientKey,
  });
  const now = Date.now();
  const launched = Boolean(existing?.launchedRunId?.trim());
  const next: TaskProposalRecord = {
    proposalId: existing?.proposalId ?? crypto.randomUUID(),
    clientKey,
    requesterSessionKey,
    ...buildProposalContentFields({
      existing,
      sourceMessageId,
      kind: params.kind,
      title,
      summary,
      rationale,
      acceptance: params.acceptance,
      launchPrompt,
      agentId,
    }),
    createdBy: existing?.createdBy ?? (params.createdBy === "user" ? "user" : "assistant"),
    decision: existing?.decision ?? "pending",
    createdAt: existing?.createdAt ?? now,
    updatedAt: launched ? (existing?.updatedAt ?? now) : now,
    ...(existing?.resolvedAt != null ? { resolvedAt: existing.resolvedAt } : {}),
    ...(existing?.resolvedBy ? { resolvedBy: existing.resolvedBy } : {}),
    ...(existing?.launchedRunId ? { launchedRunId: existing.launchedRunId } : {}),
    ...(existing?.launchedSessionKey ? { launchedSessionKey: existing.launchedSessionKey } : {}),
    ...(existing?.launchedAt != null ? { launchedAt: existing.launchedAt } : {}),
  };
  upsertTaskProposalRecordToSqlite(next);
  return toTaskProposalView(next);
}

export function resolveTaskProposalDecision(params: {
  proposalId: string;
  decision: Exclude<TaskProposalDecision, "pending">;
  resolvedBy?: string | null;
}): TaskProposalView {
  const current = getTaskProposalRecordByIdFromSqlite(params.proposalId.trim());
  if (!current) {
    throw new Error(`Task proposal not found: ${params.proposalId}`);
  }
  if (current.decision === params.decision) {
    return toTaskProposalView(current);
  }
  if (current.launchedRunId?.trim() && params.decision === "rejected") {
    throw new Error("Cannot reject a task proposal after it has launched.");
  }
  const resolvedBy = trimToUndefined(params.resolvedBy, 160);
  const resolvedAt = Date.now();
  const updated: TaskProposalRecord = {
    ...current,
    decision: params.decision,
    updatedAt: resolvedAt,
    resolvedAt,
    ...(resolvedBy ? { resolvedBy } : {}),
  };
  upsertTaskProposalRecordToSqlite(updated);
  return toTaskProposalView(updated);
}

export function attachTaskProposalLaunch(params: {
  proposalId: string;
  runId: string;
  sessionKey?: string | null;
}): TaskProposalView {
  const current = getTaskProposalRecordByIdFromSqlite(params.proposalId.trim());
  if (!current) {
    throw new Error(`Task proposal not found: ${params.proposalId}`);
  }
  if (current.decision === "rejected") {
    throw new Error("Cannot launch a rejected task proposal.");
  }
  const runId = trimToUndefined(params.runId, 240);
  const sessionKey = trimToUndefined(params.sessionKey, 240);
  if (!runId) {
    throw new Error("Task proposal launch requires runId.");
  }
  if (current.launchedRunId?.trim() && current.launchedRunId !== runId) {
    throw new Error("Task proposal is already linked to another launched run.");
  }
  if (
    current.launchedSessionKey?.trim() &&
    sessionKey &&
    current.launchedSessionKey !== sessionKey
  ) {
    throw new Error("Task proposal is already linked to another launched session.");
  }
  if (current.launchedRunId === runId) {
    if (!sessionKey || current.launchedSessionKey?.trim() === sessionKey) {
      return toTaskProposalView(current);
    }
    const backfilled: TaskProposalRecord = {
      ...current,
      decision: "approved",
      updatedAt: Date.now(),
      ...(current.resolvedAt != null ? { resolvedAt: current.resolvedAt } : {}),
      launchedRunId: runId,
      launchedSessionKey: sessionKey,
      launchedAt: current.launchedAt ?? Date.now(),
    };
    upsertTaskProposalRecordToSqlite(backfilled);
    return toTaskProposalView(backfilled);
  }
  const launchedAt = Date.now();
  const updated: TaskProposalRecord = {
    ...current,
    decision: "approved",
    updatedAt: launchedAt,
    ...(current.resolvedAt != null
      ? { resolvedAt: current.resolvedAt }
      : { resolvedAt: launchedAt }),
    launchedRunId: runId,
    ...(sessionKey ? { launchedSessionKey: sessionKey } : {}),
    launchedAt,
  };
  upsertTaskProposalRecordToSqlite(updated);
  return toTaskProposalView(updated);
}
