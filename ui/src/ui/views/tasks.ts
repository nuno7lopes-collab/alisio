import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { TaskRuntimeFilter, TaskStatusFilter } from "../controllers/tasks.ts";
import { formatMs, formatRelativeTimestamp } from "../format.ts";
import type {
  Task,
  TaskApproval,
  TaskAssignment,
  TaskDependency,
  TaskEvent,
  TaskExecution,
  TaskProposalRecord,
  TasksOverviewResult,
} from "../types.ts";
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
};

type CanonicalTaskCollections = {
  tasks: Task[];
  executions: TaskExecution[];
  assignments: TaskAssignment[];
  approvals: TaskApproval[];
  events: TaskEvent[];
  dependencies: TaskDependency[];
};

type FlattenedTask = {
  task: Task;
  depth: number;
};

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

function getCollections(overview: TasksOverviewResult | null): CanonicalTaskCollections {
  return {
    tasks: overview?.canonicalTasks ?? [],
    executions: overview?.canonicalExecutions ?? [],
    assignments: overview?.canonicalAssignments ?? [],
    approvals: overview?.canonicalApprovals ?? [],
    events: overview?.canonicalEvents ?? [],
    dependencies: overview?.canonicalDependencies ?? [],
  };
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
  return (
    executions.toSorted((left, right) => {
      const leftAt = left.startedAt ?? left.createdAt;
      const rightAt = right.startedAt ?? right.createdAt;
      return rightAt - leftAt;
    })[0] ?? null
  );
}

function resolveDisplayStatus(task: Task, execution: TaskExecution | null): TaskStatusFilter {
  if (execution) {
    return execution.status;
  }
  switch (task.status) {
    case "draft":
    case "pending_approval":
    case "ready":
      return "queued";
    case "in_progress":
    case "awaiting_review":
      return "running";
    case "completed":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "blocked":
      return "failed";
  }
}

function filterCanonicalTasks(props: TasksViewProps, collections: CanonicalTaskCollections) {
  const executionMap = new Map<string, TaskExecution[]>();
  for (const execution of collections.executions) {
    const next = executionMap.get(execution.taskId) ?? [];
    next.push(execution);
    executionMap.set(execution.taskId, next);
  }
  const query = props.query.trim().toLowerCase();
  return collections.tasks.filter((task) => {
    const executions = executionMap.get(task.taskId) ?? [];
    const latestExecution = resolveLatestExecution(task, executions);
    if (
      props.runtimeFilter !== "all" &&
      !executions.some((execution) => execution.kind === props.runtimeFilter)
    ) {
      return false;
    }
    if (
      props.statusFilter !== "all" &&
      resolveDisplayStatus(task, latestExecution) !== props.statusFilter
    ) {
      return false;
    }
    if (!query) {
      return true;
    }
    const searchable = [
      task.taskId,
      task.rootTaskId,
      task.parentTaskId,
      task.title,
      task.summary,
      task.description,
      task.ownerAgentId,
      task.requesterSessionKey,
      task.orchestratorSessionKey,
      ...task.acceptance,
      ...executions.flatMap((execution) => [
        execution.executionId,
        execution.runId,
        execution.sessionKey,
        execution.agentId,
        execution.label,
        execution.summary,
        execution.error,
      ]),
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase());
    return searchable.some((value) => value.includes(query));
  });
}

function flattenTaskTree(tasks: Task[]): FlattenedTask[] {
  const byParent = new Map<string | undefined, Task[]>();
  const visibleTaskIds = new Set(tasks.map((task) => task.taskId));
  for (const task of tasks) {
    const parentKey =
      task.parentTaskId && visibleTaskIds.has(task.parentTaskId) ? task.parentTaskId : undefined;
    const bucket = byParent.get(parentKey) ?? [];
    bucket.push(task);
    byParent.set(parentKey, bucket);
  }
  const sortTasks = (entries: Task[]) =>
    entries.toSorted((left, right) => {
      if (left.rootTaskId !== right.rootTaskId && !left.parentTaskId && !right.parentTaskId) {
        return right.updatedAt - left.updatedAt;
      }
      return (right.startedAt ?? right.updatedAt) - (left.startedAt ?? left.updatedAt);
    });
  const flattened: FlattenedTask[] = [];
  const visit = (parentTaskId: string | undefined, depth: number) => {
    for (const task of sortTasks(byParent.get(parentTaskId) ?? [])) {
      flattened.push({ task, depth });
      visit(task.taskId, depth + 1);
    }
  };
  visit(undefined, 0);
  return flattened;
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

function renderEventTimeline(events: TaskEvent[]) {
  if (events.length === 0) {
    return renderTasksEmptyState(t("tasksView.timeline.empty"));
  }
  return html`
    <div style="display: grid; gap: 10px;">
      ${events
        .toSorted((left, right) => right.createdAt - left.createdAt)
        .slice(0, 10)
        .map(
          (event) => html`
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
        )}
    </div>
  `;
}

function renderCanonicalTaskDetail(
  props: TasksViewProps,
  selectedTask: Task | null,
  collections: CanonicalTaskCollections,
) {
  if (!selectedTask) {
    return html`
      <div class="card">
        <div class="card-title">${t("tasksView.detail.title")}</div>
        <div style="margin-top: 16px;">${renderTasksEmptyState(t("tasksView.detail.empty"))}</div>
      </div>
    `;
  }

  const executions = collections.executions.filter(
    (execution) => execution.taskId === selectedTask.taskId,
  );
  const assignments = collections.assignments.filter(
    (assignment) => assignment.taskId === selectedTask.taskId,
  );
  const approvals = collections.approvals.filter(
    (approval) => approval.taskId === selectedTask.taskId,
  );
  const events = collections.events.filter((event) => event.taskId === selectedTask.taskId);
  const dependencies = collections.dependencies.filter(
    (dependency) => dependency.taskId === selectedTask.taskId,
  );
  const children = collections.tasks.filter((task) => task.parentTaskId === selectedTask.taskId);
  const latestExecution = resolveLatestExecution(selectedTask, executions);
  const taskCanCancel =
    selectedTask.status !== "completed" &&
    selectedTask.status !== "cancelled" &&
    selectedTask.status !== "failed";
  const openSessionKey =
    latestExecution?.sessionKey?.trim() || selectedTask.orchestratorSessionKey?.trim() || null;

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
                  collections.executions.filter((execution) => execution.taskId === child.taskId),
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
      <div style="margin-top: 16px;">${renderEventTimeline(events)}</div>
    </div>
  `;
}

export function renderTasks(props: TasksViewProps) {
  const overview = props.overview;
  const showInitialLoading = props.loading && !overview;
  const collections = getCollections(overview);
  const visibleCanonicalTasks = filterCanonicalTasks(props, collections);
  const flattenedTasks = flattenTaskTree(visibleCanonicalTasks);
  const selectedCanonicalTask = findSelectedCanonicalTask(props, visibleCanonicalTasks);
  const taskById = new Map(collections.tasks.map((task) => [task.taskId, task]));
  const executionMap = new Map<string, TaskExecution[]>();
  for (const execution of collections.executions) {
    const next = executionMap.get(execution.taskId) ?? [];
    next.push(execution);
    executionMap.set(execution.taskId, next);
  }
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

                ${renderCanonicalTaskDetail(props, selectedCanonicalTask, collections)}
              </div>
            </div>
          `}
    </section>
  `;
}
