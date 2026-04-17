import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { BrowserPanePreviewState } from "../controllers/browser-pane.ts";
import type { TaskRuntimeFilter, TaskStatusFilter } from "../controllers/tasks.ts";
import { formatMs, formatRelativeTimestamp } from "../format.ts";
import type {
  Task,
  TaskApproval,
  TaskAssignment,
  TaskDependency,
  TasksDetailResult,
  TaskEvent,
  TaskExecution,
  TaskExecutionStep,
  TaskProposalRecord,
  TasksOverviewResult,
} from "../types.ts";
import { renderBrowserPane } from "./browser-pane.ts";
import {
  renderSkeletonButton,
  renderSkeletonInput,
  renderSkeletonLines,
  renderSkeletonListItem,
  renderSkeletonStatCards,
  renderSurfaceEmptyState,
} from "./loading-skeleton.ts";

export type TasksViewProps = {
  loading: boolean;
  busy: boolean;
  error: string | null;
  overview: TasksOverviewResult | null;
  detailLoading: boolean;
  detail: TasksDetailResult | null;
  selectedId: string | null;
  query: string;
  runtimeFilter: TaskRuntimeFilter;
  statusFilter: TaskStatusFilter;
  onRefresh: () => void;
  onQueryChange: (value: string) => void;
  onRuntimeFilterChange: (value: TaskRuntimeFilter) => void;
  onStatusFilterChange: (value: TaskStatusFilter) => void;
  onSelectTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
  onResolveProposal: (proposal: TaskProposalRecord, decision: "approved" | "rejected") => void;
  onLaunchProposal: (proposal: TaskProposalRecord) => void;
  onOpenRequesterSession?: (sessionKey: string) => void;
  onOpenChildSession?: (sessionKey: string) => void;
  resolveSessionBrowserPanePreview?: (sessionKey: string) => BrowserPanePreviewState | null;
};

type CanonicalTaskListCollections = {
  tasks: Task[];
  executions: TaskExecution[];
};

type FlattenedTask = {
  task: Task;
  depth: number;
};

type TaskExecutionMap = Map<string, TaskExecution[]>;
const executionMapCache = new WeakMap<TaskExecution[], TaskExecutionMap>();
const taskIndexCache = new WeakMap<Task[], Map<string, Task>>();
const flattenedTasksCache = new WeakMap<Task[], FlattenedTask[]>();

function getTaskRuntimeOptions(): Array<{ value: TaskRuntimeFilter; label: string }> {
  return [
    { value: "all", label: t("tasksView.filters.executorsAll") },
    { value: "orchestrator_session", label: t("tasksView.runtime.orchestrator") },
    { value: "subagent", label: t("tasksView.runtime.subagent") },
    { value: "acp", label: t("tasksView.runtime.acp") },
    { value: "cli", label: t("tasksView.runtime.cli") },
    { value: "cron", label: t("tasksView.runtime.cron") },
  ];
}

function getTaskStatusOptions(): Array<{ value: TaskStatusFilter; label: string }> {
  return [
    { value: "all", label: t("tasksView.filters.runStatesAll") },
    { value: "queued", label: t("tasksView.executionStatus.queued") },
    { value: "running", label: t("tasksView.executionStatus.running") },
    { value: "succeeded", label: t("tasksView.executionStatus.succeeded") },
    { value: "failed", label: t("tasksView.executionStatus.failed") },
    { value: "timed_out", label: t("tasksView.executionStatus.timedOut") },
    { value: "cancelled", label: t("tasksView.executionStatus.cancelled") },
    { value: "lost", label: t("tasksView.executionStatus.lost") },
  ];
}

function renderSummaryCard(label: string, value: string | number, detail: string) {
  return html`
    <div class="stat stat-card alisio-tasks__summary-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      <div class="alisio-tasks__summary-detail">${detail}</div>
    </div>
  `;
}

function renderBadge(
  label: string,
  tone: "neutral" | "running" | "good" | "warn" | "bad" = "neutral",
) {
  const palette =
    tone === "running"
      ? "color: #0b5fff; background: rgba(11,95,255,0.12);"
      : tone === "good"
        ? "color: #0f7b3f; background: rgba(15,123,63,0.12);"
        : tone === "warn"
          ? "color: #8a5b00; background: rgba(138,91,0,0.14);"
          : tone === "bad"
            ? "color: #9c1c1c; background: rgba(156,28,28,0.12);"
            : "color: var(--text-muted, #666); background: rgba(127,127,127,0.12);";
  return html`
    <span
      style="display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; ${palette}"
    >
      ${label}
    </span>
  `;
}

function runtimeLabel(value: string) {
  switch (value) {
    case "orchestrator_session":
      return t("tasksView.runtime.orchestrator");
    case "subagent":
      return t("tasksView.runtime.subagent");
    case "acp":
      return t("tasksView.runtime.acp");
    case "cli":
      return t("tasksView.runtime.cli");
    case "cron":
      return t("tasksView.runtime.cron");
    default:
      return value.replaceAll("_", " ");
  }
}

function proposalDecisionLabel(value: string) {
  switch (value) {
    case "pending":
      return t("tasksView.proposals.pending");
    case "approved":
      return t("tasksView.proposals.approved");
    case "rejected":
      return t("tasksView.proposals.rejected");
    default:
      return value.replaceAll("_", " ");
  }
}

function taskStatusLabel(value: Task["status"]) {
  switch (value) {
    case "draft":
      return t("tasksView.taskStatus.draft");
    case "pending_approval":
      return t("tasksView.taskStatus.pendingApproval");
    case "ready":
      return t("tasksView.taskStatus.ready");
    case "in_progress":
      return t("tasksView.taskStatus.inProgress");
    case "awaiting_review":
      return t("tasksView.taskStatus.awaitingReview");
    case "completed":
      return t("tasksView.taskStatus.completed");
    case "blocked":
      return t("tasksView.taskStatus.blocked");
    case "failed":
      return t("tasksView.taskStatus.failed");
    case "cancelled":
      return t("tasksView.taskStatus.cancelled");
  }
}

function executionStatusLabel(value: TaskExecution["status"]) {
  switch (value) {
    case "queued":
      return t("tasksView.executionStatus.queued");
    case "running":
      return t("tasksView.executionStatus.running");
    case "succeeded":
      return t("tasksView.executionStatus.succeeded");
    case "failed":
      return t("tasksView.executionStatus.failed");
    case "timed_out":
      return t("tasksView.executionStatus.timedOut");
    case "cancelled":
      return t("tasksView.executionStatus.cancelled");
    case "lost":
      return t("tasksView.executionStatus.lost");
  }
}

function approvalStatusLabel(value: string) {
  switch (value) {
    case "approved":
      return t("tasksView.proposals.approved");
    case "rejected":
      return t("tasksView.proposals.rejected");
    case "cancelled":
      return t("tasksView.executionStatus.cancelled");
    case "pending":
      return t("tasksView.proposals.pending");
    default:
      return value.replaceAll("_", " ");
  }
}

function assignmentStatusLabel(value: string) {
  switch (value) {
    case "active":
      return t("tasksView.assignments.active");
    case "released":
      return t("tasksView.assignments.released");
    case "expired":
      return t("tasksView.assignments.expired");
    default:
      return value.replaceAll("_", " ");
  }
}

function childTasksCountLabel(count: number) {
  return count === 1
    ? t("tasksView.detail.childTaskOne", { count: String(count) })
    : t("tasksView.detail.childTaskMany", { count: String(count) });
}

function visibleTasksCountLabel(count: number) {
  return count === 1
    ? t("tasksView.tree.visibleOne", { count: String(count) })
    : t("tasksView.tree.visibleMany", { count: String(count) });
}

function renderTasksEmptyState(body: string, className?: string) {
  return renderSurfaceEmptyState({
    body,
    compact: true,
    className,
  });
}

function renderTasksToolbarSkeleton() {
  return html`
    <div class="loading-state__toolbar alisio-tasks__toolbar" aria-hidden="true">
      <div class="loading-state__toolbar-main">${renderSkeletonInput()}</div>
      <div class="loading-state__toolbar-filter">${renderSkeletonInput()}</div>
      <div class="loading-state__toolbar-filter">${renderSkeletonInput()}</div>
      <div class="loading-state__toolbar-actions">${renderSkeletonButton()}</div>
    </div>
  `;
}

function renderTasksSectionSkeleton(params: {
  title: string;
  subtitle: string;
  rows?: number;
  aside?: "none" | "pill" | "button";
}) {
  return html`
    <div class="card">
      <div class="card-title">${params.title}</div>
      <div class="card-sub">${params.subtitle}</div>
      <div class="loading-state__list" style="margin-top: 16px;" aria-hidden="true">
        ${Array.from({ length: params.rows ?? 3 }, (_, index) =>
          renderSkeletonListItem({
            lines:
              index === 0
                ? ["medium", "long", "short"]
                : index % 2 === 0
                  ? ["long", "medium"]
                  : ["short", "medium"],
            aside: params.aside ?? "button",
          }),
        )}
      </div>
    </div>
  `;
}

function renderTasksDetailSkeleton() {
  return html`
    <div class="card">
      <div class="card-title">${t("tasksView.detail.title")}</div>
      <div class="card-sub">${t("tasksView.detail.empty")}</div>
      <div style="display: grid; gap: 16px; margin-top: 16px;" aria-hidden="true">
        ${renderSkeletonLines(["medium", "full", "long"])}
        <div class="alisio-tasks__detail-grid">${renderSkeletonStatCards(3)}</div>
        <div class="loading-state__list">
          ${renderSkeletonListItem({ lines: ["medium", "long"], aside: "pill" })}
          ${renderSkeletonListItem({ lines: ["short", "medium", "long"] })}
          ${renderSkeletonListItem({ lines: ["medium", "short"], aside: "button" })}
        </div>
      </div>
    </div>
  `;
}

function taskStatusTone(task: Task): "neutral" | "running" | "good" | "warn" | "bad" {
  switch (task.status) {
    case "ready":
    case "pending_approval":
    case "draft":
      return "warn";
    case "in_progress":
    case "awaiting_review":
      return "running";
    case "completed":
      return "good";
    case "blocked":
      return "warn";
    case "failed":
      return "bad";
    case "cancelled":
      return "neutral";
  }
}

function executionStatusTone(status: TaskExecution["status"]) {
  switch (status) {
    case "queued":
      return "warn";
    case "running":
      return "running";
    case "succeeded":
      return "good";
    case "failed":
    case "timed_out":
    case "lost":
      return "bad";
    case "cancelled":
      return "neutral";
  }
}

function describeTaskProposal(proposal: TaskProposalRecord): string {
  return proposal.summary?.trim() || proposal.rationale?.trim() || proposal.title.trim();
}

function renderProposalActionButton(
  label: string,
  disabled: boolean,
  onClick: () => void,
  variant?: "primary" | "quiet",
) {
  const className = variant === "primary" ? "btn primary" : "btn btn--ghost";
  return html`
    <button type="button" class=${className} ?disabled=${disabled} @click=${onClick}>
      ${label}
    </button>
  `;
}

function getCollections(overview: TasksOverviewResult | null): CanonicalTaskListCollections {
  return {
    tasks: overview?.canonicalTasks ?? [],
    executions: overview?.canonicalExecutions ?? [],
  };
}

function buildExecutionMap(executions: TaskExecution[]): TaskExecutionMap {
  const cached = executionMapCache.get(executions);
  if (cached) {
    return cached;
  }
  const value: TaskExecutionMap = new Map();
  for (const execution of executions) {
    const next = value.get(execution.taskId) ?? [];
    next.push(execution);
    value.set(execution.taskId, next);
  }
  executionMapCache.set(executions, value);
  return value;
}

function buildTaskIndex(tasks: Task[]): Map<string, Task> {
  const cached = taskIndexCache.get(tasks);
  if (cached) {
    return cached;
  }
  const value = new Map(tasks.map((task) => [task.taskId, task]));
  taskIndexCache.set(tasks, value);
  return value;
}

function resolveLatestExecution(task: Task, executions: TaskExecution[]): TaskExecution | null {
  if (executions.length === 0) {
    return null;
  }
  if (task.activeExecutionId) {
    const active = executions.find((execution) => execution.executionId === task.activeExecutionId);
    if (active) {
      return active;
    }
  }
  if (task.latestExecutionId) {
    const latest = executions.find((execution) => execution.executionId === task.latestExecutionId);
    if (latest) {
      return latest;
    }
  }
  let latestExecution: TaskExecution | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const execution of executions) {
    const executionAt = execution.startedAt ?? execution.createdAt;
    if (executionAt > latestAt) {
      latestExecution = execution;
      latestAt = executionAt;
    }
  }
  return latestExecution;
}

function annotateTaskDepths(tasks: Task[]): FlattenedTask[] {
  const cached = flattenedTasksCache.get(tasks);
  if (cached) {
    return cached;
  }
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const depthCache = new Map<string, number>();
  const resolveDepth = (task: Task, seen = new Set<string>()): number => {
    const cached = depthCache.get(task.taskId);
    if (typeof cached === "number") {
      return cached;
    }
    const parentTaskId = task.parentTaskId?.trim();
    if (!parentTaskId || seen.has(task.taskId)) {
      depthCache.set(task.taskId, 0);
      return 0;
    }
    const parent = taskById.get(parentTaskId);
    if (!parent) {
      depthCache.set(task.taskId, 0);
      return 0;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(task.taskId);
    const depth = resolveDepth(parent, nextSeen) + 1;
    depthCache.set(task.taskId, depth);
    return depth;
  };
  const value = tasks.map((task) => ({ task, depth: resolveDepth(task) }));
  flattenedTasksCache.set(tasks, value);
  return value;
}

function findSelectedCanonicalTask(props: TasksViewProps, visibleTasks: Task[]): Task | null {
  if (visibleTasks.length === 0) {
    return null;
  }
  return visibleTasks.find((task) => task.taskId === props.selectedId) ?? visibleTasks[0] ?? null;
}

function formatExecutionDuration(execution: TaskExecution): string {
  const start = execution.startedAt ?? execution.createdAt;
  const end = execution.endedAt ?? Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "n/a";
  }
  return formatMs(end - start);
}

function renderProposalCard(
  props: TasksViewProps,
  proposal: TaskProposalRecord,
  linkedTask: Task | null,
) {
  const launchable = proposal.decision !== "rejected" && !proposal.launchedTaskId?.trim();
  const launchedSessionKey =
    proposal.launchedSessionKey?.trim() || linkedTask?.orchestratorSessionKey?.trim() || null;
  return html`
    <div class="list-item">
      <div
        class="list-title"
        style="display: flex; justify-content: space-between; gap: 12px; align-items: center;"
      >
        <span>${proposal.title}</span>
        <span style="display: inline-flex; gap: 8px; flex-wrap: wrap;">
          ${renderBadge(proposal.kind, "neutral")}
          ${renderBadge(
            proposalDecisionLabel(proposal.decision),
            proposal.decision === "approved"
              ? "good"
              : proposal.decision === "rejected"
                ? "bad"
                : "warn",
          )}
        </span>
      </div>
      <div class="list-sub">
        ${formatRelativeTimestamp(proposal.updatedAt || proposal.createdAt)} ·
        ${proposal.createdBy === "assistant"
          ? t("tasksView.proposals.createdByAssistant")
          : t("tasksView.proposals.createdByUser")}
      </div>
      <div style="margin-top: 10px; display: grid; gap: 8px;">
        <div>${describeTaskProposal(proposal)}</div>
        ${proposal.acceptance.length > 0
          ? html` <div class="list-sub">${proposal.acceptance.slice(0, 3).join(" · ")}</div> `
          : nothing}
        ${linkedTask
          ? html`
              <div class="list-sub">
                ${t("tasksView.proposals.linkedTask")} · ${linkedTask.taskId} ·
                ${taskStatusLabel(linkedTask.status)}
              </div>
            `
          : proposal.launchedTaskId?.trim()
            ? html`
                <div class="list-sub">
                  ${t("tasksView.proposals.linkedTask")} · ${proposal.launchedTaskId}
                </div>
              `
            : nothing}
      </div>
      <div class="row" style="margin-top: 14px; gap: 10px; flex-wrap: wrap;">
        ${proposal.decision === "pending"
          ? [
              renderProposalActionButton(
                t("tasksView.proposals.approve"),
                props.busy,
                () => props.onResolveProposal(proposal, "approved"),
                "primary",
              ),
              renderProposalActionButton(t("tasksView.proposals.reject"), props.busy, () =>
                props.onResolveProposal(proposal, "rejected"),
              ),
            ]
          : nothing}
        ${launchable
          ? renderProposalActionButton(
              t("tasksView.proposals.launch"),
              props.busy,
              () => props.onLaunchProposal(proposal),
              "primary",
            )
          : nothing}
        ${proposal.requesterSessionKey.trim() && props.onOpenRequesterSession
          ? renderProposalActionButton(t("tasksView.proposals.openSourceChat"), props.busy, () =>
              props.onOpenRequesterSession?.(proposal.requesterSessionKey),
            )
          : nothing}
        ${launchedSessionKey && props.onOpenChildSession
          ? renderProposalActionButton(t("tasksView.proposals.openTaskChat"), props.busy, () =>
              props.onOpenChildSession?.(launchedSessionKey),
            )
          : nothing}
      </div>
    </div>
  `;
}

function renderCanonicalTaskRow(
  props: TasksViewProps,
  task: Task,
  latestExecution: TaskExecution | null,
  depth: number,
  selected: boolean,
) {
  const secondary =
    latestExecution?.summary?.trim() ||
    task.summary?.trim() ||
    task.description?.trim() ||
    task.acceptance[0] ||
    "";
  return html`
    <button
      type="button"
      class=${`list-item list-item-clickable alisio-tasks__row ${selected ? "list-item-selected" : ""}`}
      style=${[`padding-left: ${16 + depth * 18}px;`].join(" ")}
      @click=${() => props.onSelectTask(task.taskId)}
    >
      <div class="list-title alisio-tasks__row-title">
        <span>${task.title}</span>
        <span class="alisio-tasks__badge-row">
          ${renderBadge(taskStatusLabel(task.status), taskStatusTone(task))}
          ${latestExecution ? renderBadge(runtimeLabel(latestExecution.kind), "neutral") : nothing}
        </span>
      </div>
      <div class="list-sub">${task.taskId} · ${formatRelativeTimestamp(task.updatedAt)}</div>
      ${secondary
        ? html`<div class="list-sub" style="margin-top: 6px;">${secondary}</div>`
        : nothing}
    </button>
  `;
}

function renderExecutionList(executions: TaskExecution[]) {
  if (executions.length === 0) {
    return renderTasksEmptyState(t("tasksView.executions.empty"));
  }
  return html`
    <div style="display: grid; gap: 10px;">
      ${executions
        .toSorted((left, right) => right.attempt - left.attempt)
        .map(
          (execution) => html`
            <div class="list-item">
              <div
                class="list-title"
                style="display: flex; justify-content: space-between; gap: 12px; align-items: center;"
              >
                <span>
                  ${t("tasksView.executions.attempt", { count: String(execution.attempt) })} ·
                  ${runtimeLabel(execution.kind)}
                </span>
                ${renderBadge(
                  executionStatusLabel(execution.status),
                  executionStatusTone(execution.status),
                )}
              </div>
              <div class="list-sub">
                ${execution.runId?.trim() || execution.executionId} ·
                ${formatExecutionDuration(execution)}
              </div>
              <div class="list-sub">
                ${execution.sessionKey?.trim() ||
                execution.agentId?.trim() ||
                t("tasksView.executions.noLinkedSession")}
              </div>
              ${execution.summary?.trim()
                ? html`<div class="list-sub" style="margin-top: 6px;">${execution.summary}</div>`
                : nothing}
              ${execution.error?.trim()
                ? html`<div class="list-sub" style="margin-top: 6px;">${execution.error}</div>`
                : nothing}
            </div>
          `,
        )}
    </div>
  `;
}

function renderApprovalList(approvals: TaskApproval[]) {
  if (approvals.length === 0) {
    return renderTasksEmptyState(t("tasksView.approvals.empty"));
  }
  return html`
    <div style="display: grid; gap: 10px;">
      ${approvals
        .toSorted((left, right) => right.requestedAt - left.requestedAt)
        .map(
          (approval) => html`
            <div class="list-item">
              <div
                class="list-title"
                style="display: flex; justify-content: space-between; gap: 12px; align-items: center;"
              >
                <span>${approval.approvalId}</span>
                ${renderBadge(
                  approvalStatusLabel(approval.status),
                  approval.status === "approved"
                    ? "good"
                    : approval.status === "rejected"
                      ? "bad"
                      : approval.status === "cancelled"
                        ? "neutral"
                        : "warn",
                )}
              </div>
              <div class="list-sub">
                ${t("tasksView.approvals.requested", {
                  time: formatRelativeTimestamp(approval.requestedAt),
                })}
                ${approval.requestedBy?.trim() ? ` · ${approval.requestedBy}` : ""}
              </div>
              ${approval.decidedAt
                ? html`
                    <div class="list-sub">
                      ${t("tasksView.approvals.decided", {
                        time: formatRelativeTimestamp(approval.decidedAt),
                      })}
                      ${approval.decidedBy?.trim() ? ` · ${approval.decidedBy}` : ""}
                    </div>
                  `
                : nothing}
              ${approval.note?.trim()
                ? html`<div class="list-sub" style="margin-top: 6px;">${approval.note}</div>`
                : nothing}
            </div>
          `,
        )}
    </div>
  `;
}

function renderAssignmentList(assignments: TaskAssignment[]) {
  if (assignments.length === 0) {
    return nothing;
  }
  return html`
    <div style="display: grid; gap: 10px;">
      ${assignments
        .toSorted((left, right) => right.claimedAt - left.claimedAt)
        .map(
          (assignment) => html`
            <div class="list-item">
              <div
                class="list-title"
                style="display: flex; justify-content: space-between; gap: 12px; align-items: center;"
              >
                <span>${assignment.agentId}</span>
                ${renderBadge(
                  assignmentStatusLabel(assignment.status),
                  assignment.status === "active"
                    ? "running"
                    : assignment.status === "released"
                      ? "neutral"
                      : "warn",
                )}
              </div>
              <div class="list-sub">
                ${t("tasksView.assignments.claimed", {
                  claimed: formatRelativeTimestamp(assignment.claimedAt),
                  lease: formatRelativeTimestamp(assignment.leaseExpiresAt),
                })}
              </div>
            </div>
          `,
        )}
    </div>
  `;
}

function renderDependencyList(dependencies: TaskDependency[]) {
  if (dependencies.length === 0) {
    return nothing;
  }
  return html`
    <div style="display: grid; gap: 10px;">
      ${dependencies.map(
        (dependency) => html`
          <div class="list-item">
            <div class="list-title">${dependency.kind}</div>
            <div class="list-sub">${dependency.dependsOnTaskId}</div>
          </div>
        `,
      )}
    </div>
  `;
}

function stepStatusTone(status: TaskExecutionStep["status"]) {
  switch (status) {
    case "running":
      return "running";
    case "succeeded":
      return "good";
    case "failed":
    case "cancelled":
      return "bad";
    case "pending":
      return "warn";
    case "info":
    default:
      return "neutral";
  }
}

function parseStepData(step: TaskExecutionStep): Record<string, unknown> | null {
  if (!step.dataJson?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(step.dataJson) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveStepPrimaryDetail(step: TaskExecutionStep, data: Record<string, unknown> | null) {
  const candidates = [
    typeof data?.command === "string" ? data.command : null,
    typeof data?.path === "string" ? data.path : null,
    typeof data?.url === "string" ? data.url : null,
    typeof data?.query === "string" ? data.query : null,
  ];
  return candidates.find((candidate) => typeof candidate === "string" && candidate.trim()) ?? null;
}

function resolveStepSummary(step: TaskExecutionStep, data: Record<string, unknown> | null) {
  if (step.summary?.trim()) {
    return step.summary;
  }
  const primary = resolveStepPrimaryDetail(step, data);
  if (primary) {
    return primary;
  }
  return step.kind.replaceAll("_", " ");
}

function renderStepTimeline(steps: TaskExecutionStep[], events: TaskEvent[]) {
  const mirroredEventKinds = new Set<TaskEvent["kind"]>([
    "approval_requested",
    "approval_decided",
    "claimed",
    "released",
    "child_spawned",
    "execution_started",
    "execution_ended",
    "execution_cancelled",
  ]);
  const items = [
    ...steps.map((step) => {
      const data = parseStepData(step);
      const primary = resolveStepPrimaryDetail(step, data);
      const metaParts = [
        step.tool?.trim() || null,
        typeof data?.toolCallId === "string" ? data.toolCallId : null,
        typeof data?.phase === "string" ? data.phase : null,
        step.actor?.trim() || null,
      ].filter((value): value is string => Boolean(value));
      return {
        key: step.stepId,
        createdAt: step.createdAt,
        node: html`
          <div class="list-item">
            <div
              class="list-title"
              style="display: flex; justify-content: space-between; gap: 12px; align-items: center;"
            >
              <span style="display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                ${renderBadge(step.kind.replaceAll("_", " "), "neutral")}
                ${renderBadge(step.status.replaceAll("_", " "), stepStatusTone(step.status))}
              </span>
              <span class="muted">${formatRelativeTimestamp(step.createdAt)}</span>
            </div>
            <div class="list-sub">${resolveStepSummary(step, data)}</div>
            ${primary && primary !== step.summary
              ? html`<div class="agent-kv-sub" style="margin-top: 6px;">${primary}</div>`
              : nothing}
            ${metaParts.length > 0
              ? html`
                  <div class="agent-kv-sub" style="margin-top: 6px;">${metaParts.join(" · ")}</div>
                `
              : nothing}
          </div>
        `,
      };
    }),
    ...events
      .filter((event) => !mirroredEventKinds.has(event.kind))
      .map((event) => ({
        key: event.eventId,
        createdAt: event.createdAt,
        node: html`
          <div class="list-item">
            <div
              class="list-title"
              style="display: flex; justify-content: space-between; gap: 12px; align-items: center;"
            >
              <span>${event.kind.replaceAll("_", " ")}</span>
              <span class="muted">${formatRelativeTimestamp(event.createdAt)}</span>
            </div>
            <div class="list-sub">
              ${event.summary?.trim() || event.actor?.trim() || event.eventId}
            </div>
          </div>
        `,
      })),
  ]
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, 25);

  if (items.length === 0) {
    return renderTasksEmptyState(t("tasksView.timeline.empty"));
  }

  return html`<div style="display: grid; gap: 10px;">${items.map((item) => item.node)}</div>`;
}

function renderCanonicalTaskDetail(props: TasksViewProps, detail: TasksDetailResult | null) {
  if (!detail) {
    return html`
      <div class="card">
        <div class="card-title">${t("tasksView.detail.title")}</div>
        <div style="margin-top: 16px;">${renderTasksEmptyState(t("tasksView.detail.empty"))}</div>
      </div>
    `;
  }

  const selectedTask = detail.task;
  const executions = detail.executions;
  const assignments = detail.assignments;
  const approvals = detail.approvals;
  const events = detail.events;
  const steps = detail.steps;
  const dependencies = detail.dependencies;
  const children = detail.children;
  const childExecutions = detail.childExecutions;
  const latestExecution = resolveLatestExecution(selectedTask, executions);
  const taskCanCancel =
    selectedTask.status !== "completed" &&
    selectedTask.status !== "cancelled" &&
    selectedTask.status !== "failed";
  const openSessionKey =
    latestExecution?.sessionKey?.trim() || selectedTask.orchestratorSessionKey?.trim() || null;
  const sessionPreview =
    openSessionKey && props.resolveSessionBrowserPanePreview
      ? props.resolveSessionBrowserPanePreview(openSessionKey)
      : null;
  const hasSessionPreview = Boolean(
    sessionPreview?.observer ||
    sessionPreview?.computer ||
    sessionPreview?.markdown.content ||
    sessionPreview?.markdown.error,
  );
  const childExecutionMap = buildExecutionMap(childExecutions);

  return html`
    <div class="card">
      <div class="alisio-tasks__detail-header">
        <div>
          <div class="card-title">${t("tasksView.detail.title")}</div>
          <div class="card-sub">${selectedTask.title}</div>
        </div>
        <div class="alisio-tasks__badge-row">
          ${renderBadge(taskStatusLabel(selectedTask.status), taskStatusTone(selectedTask))}
          ${latestExecution ? renderBadge(runtimeLabel(latestExecution.kind), "neutral") : nothing}
        </div>
      </div>

      <div class="alisio-tasks__detail-grid">
        <div class="agent-kv">
          <div class="label">${t("tasksView.detail.taskId")}</div>
          <div><code>${selectedTask.taskId}</code></div>
          <div class="agent-kv-sub">${selectedTask.kind}</div>
        </div>
        <div class="agent-kv">
          <div class="label">${t("tasksView.detail.owner")}</div>
          <div>${selectedTask.ownerAgentId?.trim() || t("tasksView.detail.unassigned")}</div>
          <div class="agent-kv-sub">${selectedTask.rootTaskId}</div>
        </div>
        <div class="agent-kv">
          <div class="label">${t("tasksView.detail.requester")}</div>
          <div>${selectedTask.requesterSessionKey?.trim() || t("common.na")}</div>
          <div class="agent-kv-sub">${childTasksCountLabel(children.length)}</div>
        </div>
        <div class="agent-kv">
          <div class="label">${t("tasksView.detail.latestRun")}</div>
          <div>${latestExecution?.runId?.trim() || t("common.na")}</div>
          <div class="agent-kv-sub">
            ${latestExecution
              ? formatExecutionDuration(latestExecution)
              : t("tasksView.detail.noExecutionYet")}
          </div>
        </div>
      </div>

      <div class="alisio-tasks__detail-stack">
        ${selectedTask.summary?.trim()
          ? html`<div>
              <strong>${t("tasksView.detail.summary")}</strong>: ${selectedTask.summary}
            </div>`
          : nothing}
        ${selectedTask.description?.trim()
          ? html`
              <div>
                <strong>${t("tasksView.detail.description")}</strong>: ${selectedTask.description}
              </div>
            `
          : nothing}
        ${selectedTask.acceptance.length > 0
          ? html`
              <div>
                <strong>${t("tasksView.detail.acceptance")}</strong>:
                ${selectedTask.acceptance.join(" · ")}
              </div>
            `
          : nothing}
        ${selectedTask.blockedReason?.trim()
          ? html`<div>
              <strong>${t("tasksView.detail.blocked")}</strong>: ${selectedTask.blockedReason}
            </div>`
          : nothing}
      </div>

      <div class="alisio-tasks__detail-actions">
        <button
          type="button"
          class="btn"
          ?disabled=${props.busy || !taskCanCancel}
          @click=${() => props.onCancelTask(selectedTask.taskId)}
        >
          ${t("tasksView.detail.cancelTask")}
        </button>
        ${selectedTask.requesterSessionKey?.trim() && props.onOpenRequesterSession
          ? html`
              <button
                type="button"
                class="btn"
                @click=${() => props.onOpenRequesterSession?.(selectedTask.requesterSessionKey!)}
              >
                ${t("tasksView.detail.openRequesterChat")}
              </button>
            `
          : nothing}
        ${openSessionKey && props.onOpenChildSession
          ? html`
              <button
                type="button"
                class="btn"
                @click=${() => props.onOpenChildSession?.(openSessionKey)}
              >
                ${t("tasksView.detail.openOrchestratorChat")}
              </button>
            `
          : nothing}
      </div>
    </div>

    <div class="card">
      <div class="card-title">${t("tasksView.approvals.title")}</div>
      <div class="card-sub">${t("tasksView.approvals.subtitle")}</div>
      <div style="margin-top: 16px;">${renderApprovalList(approvals)}</div>
    </div>

    <div class="card">
      <div class="card-title">${t("tasksView.executions.title")}</div>
      <div class="card-sub">${t("tasksView.executions.subtitle")}</div>
      <div style="margin-top: 16px;">${renderExecutionList(executions)}</div>
    </div>

    ${hasSessionPreview
      ? html`
          <div class="card">
            <div class="card-title">${t("tasksView.browser.title")}</div>
            <div class="card-sub">${t("tasksView.browser.subtitle")}</div>
            <div style="margin-top: 16px;">
              ${renderBrowserPane({
                observer: sessionPreview?.observer ?? null,
                computer: sessionPreview?.computer ?? null,
                markdown: sessionPreview?.markdown ?? null,
                selectedSurface: sessionPreview?.selectedSurface ?? "observer",
                embedded: true,
              })}
            </div>
          </div>
        `
      : nothing}
    ${assignments.length > 0
      ? html`
          <div class="card">
            <div class="card-title">${t("tasksView.assignments.title")}</div>
            <div class="card-sub">${t("tasksView.assignments.subtitle")}</div>
            <div style="margin-top: 16px;">${renderAssignmentList(assignments)}</div>
          </div>
        `
      : nothing}
    ${children.length > 0
      ? html`
          <div class="card">
            <div class="card-title">${t("tasksView.children.title")}</div>
            <div class="card-sub">${t("tasksView.children.subtitle")}</div>
            <div style="display: grid; gap: 10px; margin-top: 16px;">
              ${children.map((child) => {
                const childLatestExecution = resolveLatestExecution(
                  child,
                  childExecutionMap.get(child.taskId) ?? [],
                );
                return renderCanonicalTaskRow(props, child, childLatestExecution, 0, false);
              })}
            </div>
          </div>
        `
      : nothing}
    ${dependencies.length > 0
      ? html`
          <div class="card">
            <div class="card-title">${t("tasksView.dependencies.title")}</div>
            <div class="card-sub">${t("tasksView.dependencies.subtitle")}</div>
            <div style="margin-top: 16px;">${renderDependencyList(dependencies)}</div>
          </div>
        `
      : nothing}

    <div class="card">
      <div class="card-title">${t("tasksView.timeline.title")}</div>
      <div class="card-sub">${t("tasksView.timeline.subtitle")}</div>
      <div style="margin-top: 16px;">${renderStepTimeline(steps, events)}</div>
    </div>
  `;
}

export function renderTasks(props: TasksViewProps) {
  const overview = props.overview;
  const showInitialLoading = props.loading && !overview;
  const collections = getCollections(overview);
  const visibleCanonicalTasks = collections.tasks;
  const flattenedTasks = annotateTaskDepths(visibleCanonicalTasks);
  const selectedCanonicalTask = findSelectedCanonicalTask(props, visibleCanonicalTasks);
  const selectedDetail =
    props.detail?.task.taskId === selectedCanonicalTask?.taskId ? props.detail : null;
  const taskById = buildTaskIndex(collections.tasks);
  const executionMap = buildExecutionMap(collections.executions);
  const proposals = overview?.proposals ?? [];
  const showSummary =
    Boolean(overview) &&
    ((overview?.proposalSummary.total ?? 0) > 0 || (overview?.canonicalSummary?.total ?? 0) > 0);

  return html`
    <section class="grid alisio-tasks">
      <div class="card">
        <div class="card-title">${t("tasksView.page.title")}</div>
        <div class="card-sub">${t("tasksView.page.subtitle")}</div>
        ${showInitialLoading
          ? renderTasksToolbarSkeleton()
          : html`
              <div class="alisio-tasks__toolbar">
                <label class="field alisio-tasks__search">
                  <span>${t("common.search")}</span>
                  <input
                    .value=${props.query}
                    placeholder=${t("tasksView.page.searchPlaceholder")}
                    @input=${(event: Event) =>
                      props.onQueryChange((event.target as HTMLInputElement).value)}
                  />
                </label>
                <label class="field alisio-tasks__filter">
                  <span>${t("tasksView.filters.executor")}</span>
                  <select
                    .value=${props.runtimeFilter}
                    @change=${(event: Event) =>
                      props.onRuntimeFilterChange(
                        (event.target as HTMLSelectElement).value as TaskRuntimeFilter,
                      )}
                  >
                    ${getTaskRuntimeOptions().map(
                      (option) => html`<option value=${option.value}>${option.label}</option>`,
                    )}
                  </select>
                </label>
                <label class="field alisio-tasks__filter">
                  <span>${t("tasksView.filters.runState")}</span>
                  <select
                    .value=${props.statusFilter}
                    @change=${(event: Event) =>
                      props.onStatusFilterChange(
                        (event.target as HTMLSelectElement).value as TaskStatusFilter,
                      )}
                  >
                    ${getTaskStatusOptions().map(
                      (option) => html`<option value=${option.value}>${option.label}</option>`,
                    )}
                  </select>
                </label>
                <button
                  type="button"
                  class="btn"
                  ?disabled=${props.loading || props.busy}
                  @click=${props.onRefresh}
                >
                  ${props.loading ? t("common.loading") : t("common.refresh")}
                </button>
              </div>
            `}
        ${props.error
          ? html`<div class="callout danger alisio-tasks__callout">${props.error}</div>`
          : nothing}
      </div>

      ${showInitialLoading
        ? html`
            <div class="agents-overview-grid alisio-tasks__summary-grid" aria-hidden="true">
              ${renderSkeletonStatCards(4)}
            </div>
          `
        : showSummary
          ? html`
              <div class="agents-overview-grid alisio-tasks__summary-grid">
                ${renderSummaryCard(
                  t("tasksView.summary.inbox"),
                  overview?.proposalSummary.pending ?? 0,
                  t("tasksView.summary.inboxDetail", {
                    approved: String(overview?.proposalSummary.approved ?? 0),
                    launched: String(overview?.proposalSummary.launched ?? 0),
                  }),
                )}
                ${renderSummaryCard(
                  t("tasksView.summary.canonical"),
                  overview?.canonicalSummary?.total ?? 0,
                  t("tasksView.summary.canonicalDetail", {
                    inProgress: String(overview?.canonicalSummary?.inProgress ?? 0),
                    ready: String(overview?.canonicalSummary?.ready ?? 0),
                  }),
                )}
                ${renderSummaryCard(
                  t("tasksView.summary.blocked"),
                  overview?.canonicalSummary?.blocked ?? 0,
                  t("tasksView.summary.blockedDetail", {
                    pendingApproval: String(overview?.canonicalSummary?.pendingApproval ?? 0),
                  }),
                )}
                ${renderSummaryCard(
                  t("tasksView.summary.done"),
                  overview?.canonicalSummary?.completed ?? 0,
                  t("tasksView.summary.doneDetail", {
                    failed: String(overview?.canonicalSummary?.failed ?? 0),
                    cancelled: String(overview?.canonicalSummary?.cancelled ?? 0),
                  }),
                )}
              </div>
            `
          : nothing}
      ${showInitialLoading
        ? html`
            <div class="alisio-tasks__workspace">
              <div class="alisio-tasks__column">
                ${renderTasksSectionSkeleton({
                  title: t("tasksView.inbox.title"),
                  subtitle: t("tasksView.inbox.subtitle"),
                  rows: 3,
                })}
              </div>
              <div class="alisio-tasks__column">
                ${renderTasksSectionSkeleton({
                  title: t("tasksView.tree.title"),
                  subtitle: t("tasksView.tree.loading"),
                  rows: 4,
                  aside: "pill",
                })}
                ${renderTasksDetailSkeleton()}
              </div>
            </div>
          `
        : html`
            <div class="alisio-tasks__workspace">
              <div class="alisio-tasks__column">
                <div class="card">
                  <div class="card-title">${t("tasksView.inbox.title")}</div>
                  <div class="card-sub">${t("tasksView.inbox.subtitle")}</div>
                  ${proposals.length === 0
                    ? html`
                        <div class="alisio-tasks__empty" style="margin-top: 16px;">
                          ${renderTasksEmptyState(t("tasksView.inbox.empty"))}
                        </div>
                      `
                    : html`
                        <div class="alisio-tasks__list">
                          ${proposals.map((proposal) =>
                            renderProposalCard(
                              props,
                              proposal,
                              proposal.launchedTaskId
                                ? (taskById.get(proposal.launchedTaskId) ?? null)
                                : null,
                            ),
                          )}
                        </div>
                      `}
                </div>
              </div>

              <div class="alisio-tasks__column">
                <div class="card">
                  <div class="card-title">${t("tasksView.tree.title")}</div>
                  <div class="card-sub">
                    ${visibleCanonicalTasks.length > 0
                      ? visibleTasksCountLabel(visibleCanonicalTasks.length)
                      : t("tasksView.tree.noMatchYet")}
                  </div>
                  ${flattenedTasks.length === 0
                    ? html`
                        <div class="alisio-tasks__empty" style="margin-top: 16px;">
                          ${renderTasksEmptyState(t("tasksView.tree.empty"))}
                        </div>
                      `
                    : html`
                        <div class="alisio-tasks__list">
                          ${flattenedTasks.map(({ task, depth }) =>
                            renderCanonicalTaskRow(
                              props,
                              task,
                              resolveLatestExecution(task, executionMap.get(task.taskId) ?? []),
                              depth,
                              task.taskId === selectedCanonicalTask?.taskId,
                            ),
                          )}
                        </div>
                      `}
                </div>

                ${props.detailLoading && selectedCanonicalTask && !selectedDetail
                  ? renderTasksDetailSkeleton()
                  : renderCanonicalTaskDetail(props, selectedDetail)}
              </div>
            </div>
          `}
    </section>
  `;
}
