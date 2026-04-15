import { html, nothing } from "lit";
import type { TaskRuntimeFilter, TaskStatusFilter } from "../controllers/tasks.ts";
import { formatMs, formatRelativeTimestamp } from "../format.ts";
import type {
  Task,
  TaskApproval,
  TaskAssignment,
  TaskDependency,
  TaskEvent,
  TaskExecution,
  TaskNotifyPolicy,
  TaskProposalRecord,
  TaskRecord,
  TasksOverviewResult,
} from "../types.ts";

type TasksViewProps = {
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
  onNotifyPolicyChange: (taskId: string, notify: TaskNotifyPolicy) => void;
  onResolveProposal: (proposal: TaskProposalRecord, decision: "approved" | "rejected") => void;
  onLaunchProposal: (proposal: TaskProposalRecord) => void;
  onOpenRequesterSession?: (sessionKey: string) => void;
  onOpenChildSession?: (sessionKey: string) => void;
};

const TASK_RUNTIME_OPTIONS: Array<{ value: TaskRuntimeFilter; label: string }> = [
  { value: "all", label: "All executors" },
  { value: "subagent", label: "Subagents" },
  { value: "acp", label: "ACP" },
  { value: "cli", label: "CLI" },
  { value: "cron", label: "Cron" },
];

const TASK_STATUS_OPTIONS: Array<{ value: TaskStatusFilter; label: string }> = [
  { value: "all", label: "All run states" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "timed_out", label: "Timed out" },
  { value: "cancelled", label: "Cancelled" },
  { value: "lost", label: "Lost" },
];

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

function renderSummaryCard(label: string, value: string | number, detail: string) {
  return html`
    <div class="card">
      <div class="card-title">${label}</div>
      <div style="font-size: 32px; font-weight: 700; margin-top: 8px;">${value}</div>
      <div class="card-sub" style="margin-top: 8px;">${detail}</div>
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
  const className = variant === "primary" ? "btn btn--primary" : "btn";
  return html`
    <button class=${className} ?disabled=${disabled} @click=${onClick}>${label}</button>
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
            proposal.decision,
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
        ${proposal.createdBy === "assistant" ? "proposed by assistant" : "created by user"}
      </div>
      <div style="margin-top: 10px; display: grid; gap: 8px;">
        <div>${describeTaskProposal(proposal)}</div>
        ${proposal.acceptance.length > 0
          ? html` <div class="list-sub">${proposal.acceptance.slice(0, 3).join(" · ")}</div> `
          : nothing}
        ${linkedTask
          ? html`
              <div class="list-sub">Linked task · ${linkedTask.taskId} · ${linkedTask.status}</div>
            `
          : proposal.launchedTaskId?.trim()
            ? html`<div class="list-sub">Linked task · ${proposal.launchedTaskId}</div>`
            : nothing}
      </div>
      <div class="row" style="margin-top: 14px; gap: 10px; flex-wrap: wrap;">
        ${proposal.decision === "pending"
          ? [
              renderProposalActionButton(
                "Approve",
                props.busy,
                () => props.onResolveProposal(proposal, "approved"),
                "primary",
              ),
              renderProposalActionButton("Reject", props.busy, () =>
                props.onResolveProposal(proposal, "rejected"),
              ),
            ]
          : nothing}
        ${launchable
          ? renderProposalActionButton(
              "Launch",
              props.busy,
              () => props.onLaunchProposal(proposal),
              "primary",
            )
          : nothing}
        ${proposal.requesterSessionKey.trim() && props.onOpenRequesterSession
          ? renderProposalActionButton("Open source chat", props.busy, () =>
              props.onOpenRequesterSession?.(proposal.requesterSessionKey),
            )
          : nothing}
        ${launchedSessionKey && props.onOpenChildSession
          ? renderProposalActionButton("Open task chat", props.busy, () =>
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
      class="list-item"
      style=${[
        selected ? "border-color: var(--accent-color, currentColor);" : "",
        `padding-left: ${16 + depth * 18}px;`,
      ].join(" ")}
      @click=${() => props.onSelectTask(task.taskId)}
    >
      <div
        class="list-title"
        style="display: flex; justify-content: space-between; gap: 12px; align-items: center;"
      >
        <span>${task.title}</span>
        <span style="display: inline-flex; gap: 8px; flex-wrap: wrap;">
          ${renderBadge(task.status.replaceAll("_", " "), taskStatusTone(task))}
          ${latestExecution
            ? renderBadge(latestExecution.kind.replaceAll("_", " "), "neutral")
            : nothing}
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
    return html`<div class="empty-state">No executions yet.</div>`;
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
                <span>Attempt ${execution.attempt} · ${execution.kind.replaceAll("_", " ")}</span>
                ${renderBadge(execution.status, executionStatusTone(execution.status))}
              </div>
              <div class="list-sub">
                ${execution.runId?.trim() || execution.executionId} ·
                ${formatExecutionDuration(execution)}
              </div>
              <div class="list-sub">
                ${execution.sessionKey?.trim() || execution.agentId?.trim() || "No linked session"}
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
    return html`<div class="empty-state">No approvals recorded.</div>`;
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
                  approval.status,
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
                Requested ${formatRelativeTimestamp(approval.requestedAt)}
                ${approval.requestedBy?.trim() ? ` · ${approval.requestedBy}` : ""}
              </div>
              ${approval.decidedAt
                ? html`
                    <div class="list-sub">
                      Decided ${formatRelativeTimestamp(approval.decidedAt)}
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
                  assignment.status,
                  assignment.status === "active"
                    ? "running"
                    : assignment.status === "released"
                      ? "neutral"
                      : "warn",
                )}
              </div>
              <div class="list-sub">
                Claimed ${formatRelativeTimestamp(assignment.claimedAt)} · lease until
                ${formatRelativeTimestamp(assignment.leaseExpiresAt)}
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
    return html`<div class="empty-state">No task events yet.</div>`;
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
        <div class="card-title">Task detail</div>
        <div class="empty-state" style="margin-top: 16px;">No canonical task selected.</div>
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
      <div
        style="display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap;"
      >
        <div>
          <div class="card-title">Task detail</div>
          <div class="card-sub">${selectedTask.title}</div>
        </div>
        <div style="display: inline-flex; gap: 8px; flex-wrap: wrap;">
          ${renderBadge(selectedTask.status.replaceAll("_", " "), taskStatusTone(selectedTask))}
          ${latestExecution
            ? renderBadge(latestExecution.kind.replaceAll("_", " "), "neutral")
            : nothing}
        </div>
      </div>

      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Task ID</div>
          <div><code>${selectedTask.taskId}</code></div>
          <div class="agent-kv-sub">${selectedTask.kind}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Owner</div>
          <div>${selectedTask.ownerAgentId?.trim() || "Unassigned"}</div>
          <div class="agent-kv-sub">${selectedTask.rootTaskId}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Requester</div>
          <div>${selectedTask.requesterSessionKey?.trim() || "n/a"}</div>
          <div class="agent-kv-sub">
            ${children.length} child task${children.length === 1 ? "" : "s"}
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">Latest run</div>
          <div>${latestExecution?.runId?.trim() || "n/a"}</div>
          <div class="agent-kv-sub">
            ${latestExecution ? formatExecutionDuration(latestExecution) : "No execution yet"}
          </div>
        </div>
      </div>

      <div style="display: grid; gap: 8px; margin-top: 16px;">
        ${selectedTask.summary?.trim()
          ? html`<div><strong>Summary</strong>: ${selectedTask.summary}</div>`
          : nothing}
        ${selectedTask.description?.trim()
          ? html`<div><strong>Description</strong>: ${selectedTask.description}</div>`
          : nothing}
        ${selectedTask.acceptance.length > 0
          ? html` <div><strong>Acceptance</strong>: ${selectedTask.acceptance.join(" · ")}</div> `
          : nothing}
        ${selectedTask.blockedReason?.trim()
          ? html`<div><strong>Blocked</strong>: ${selectedTask.blockedReason}</div>`
          : nothing}
      </div>

      <div class="row" style="margin-top: 18px; gap: 10px; flex-wrap: wrap;">
        <button
          class="btn"
          ?disabled=${props.busy || !taskCanCancel}
          @click=${() => props.onCancelTask(selectedTask.taskId)}
        >
          Cancel task
        </button>
        ${selectedTask.requesterSessionKey?.trim() && props.onOpenRequesterSession
          ? html`
              <button
                class="btn"
                @click=${() => props.onOpenRequesterSession?.(selectedTask.requesterSessionKey!)}
              >
                Open requester chat
              </button>
            `
          : nothing}
        ${openSessionKey && props.onOpenChildSession
          ? html`
              <button class="btn" @click=${() => props.onOpenChildSession?.(openSessionKey)}>
                Open task chat
              </button>
            `
          : nothing}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Approvals</div>
      <div class="card-sub">Human decisions and review state for this task.</div>
      <div style="margin-top: 16px;">${renderApprovalList(approvals)}</div>
    </div>

    <div class="card">
      <div class="card-title">Executions</div>
      <div class="card-sub">Each execution attempt linked to this task.</div>
      <div style="margin-top: 16px;">${renderExecutionList(executions)}</div>
    </div>

    ${assignments.length > 0
      ? html`
          <div class="card">
            <div class="card-title">Assignments</div>
            <div class="card-sub">Current and historical agent claims.</div>
            <div style="margin-top: 16px;">${renderAssignmentList(assignments)}</div>
          </div>
        `
      : nothing}
    ${children.length > 0
      ? html`
          <div class="card">
            <div class="card-title">Child tasks</div>
            <div class="card-sub">Delegated work created from this task.</div>
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
            <div class="card-title">Dependencies</div>
            <div class="card-sub">Explicit task blockers.</div>
            <div style="margin-top: 16px;">${renderDependencyList(dependencies)}</div>
          </div>
        `
      : nothing}

    <div class="card">
      <div class="card-title">Timeline</div>
      <div class="card-sub">Most recent task events.</div>
      <div style="margin-top: 16px;">${renderEventTimeline(events)}</div>
    </div>
  `;
}

function describeLegacyTask(task: TaskRecord): string {
  return (
    task.terminalSummary?.trim() ||
    task.progressSummary?.trim() ||
    task.label?.trim() ||
    task.task.trim()
  );
}

function renderLegacyTaskList(props: TasksViewProps, tasks: TaskRecord[]) {
  if (tasks.length === 0) {
    return html`<div class="empty-state">
      No legacy task ledger entries match the current filters.
    </div>`;
  }
  return html`
    <div style="display: grid; gap: 10px;">
      ${tasks.map(
        (task) => html`
          <button class="list-item" @click=${() => props.onSelectTask(task.taskId)}>
            <div
              class="list-title"
              style="display: flex; justify-content: space-between; gap: 12px; align-items: center;"
            >
              <span>${describeLegacyTask(task)}</span>
              ${renderBadge(
                task.status,
                task.status === "running"
                  ? "running"
                  : task.status === "succeeded"
                    ? "good"
                    : task.status === "failed"
                      ? "bad"
                      : "neutral",
              )}
            </div>
            <div class="list-sub">${task.runtime} · ${task.taskId}</div>
          </button>
        `,
      )}
    </div>
  `;
}

export function renderTasks(props: TasksViewProps) {
  const overview = props.overview;
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
  const legacyTasks = overview?.tasks ?? [];
  const findings = overview?.findings ?? [];

  return html`
    <section class="grid">
      <div class="card">
        <div class="card-title">Tasks</div>
        <div class="card-sub">
          Human tasks first. Executions, approvals, hierarchy, and orchestration all stay attached
          to the canonical task.
        </div>
        <div class="row" style="margin-top: 18px; gap: 10px; flex-wrap: wrap;">
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Search</span>
            <input
              .value=${props.query}
              placeholder="task, agent, session, run, or approval"
              @input=${(event: Event) =>
                props.onQueryChange((event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field" style="min-width: 180px;">
            <span>Executor</span>
            <select
              .value=${props.runtimeFilter}
              @change=${(event: Event) =>
                props.onRuntimeFilterChange(
                  (event.target as HTMLSelectElement).value as TaskRuntimeFilter,
                )}
            >
              ${TASK_RUNTIME_OPTIONS.map(
                (option) => html`<option value=${option.value}>${option.label}</option>`,
              )}
            </select>
          </label>
          <label class="field" style="min-width: 180px;">
            <span>Run state</span>
            <select
              .value=${props.statusFilter}
              @change=${(event: Event) =>
                props.onStatusFilterChange(
                  (event.target as HTMLSelectElement).value as TaskStatusFilter,
                )}
            >
              ${TASK_STATUS_OPTIONS.map(
                (option) => html`<option value=${option.value}>${option.label}</option>`,
              )}
            </select>
          </label>
          <button class="btn" ?disabled=${props.loading || props.busy} @click=${props.onRefresh}>
            Refresh
          </button>
        </div>
        ${props.error
          ? html`<div class="empty-state" style="margin-top: 16px;">${props.error}</div>`
          : nothing}
      </div>

      <div class="agents-overview-grid">
        ${renderSummaryCard(
          "Inbox",
          overview?.proposalSummary.pending ?? 0,
          `${overview?.proposalSummary.approved ?? 0} approved · ${overview?.proposalSummary.launched ?? 0} launched`,
        )}
        ${renderSummaryCard(
          "Canonical",
          overview?.canonicalSummary?.total ?? 0,
          `${overview?.canonicalSummary?.inProgress ?? 0} in progress · ${overview?.canonicalSummary?.ready ?? 0} ready`,
        )}
        ${renderSummaryCard(
          "Blocked",
          overview?.canonicalSummary?.blocked ?? 0,
          `${overview?.canonicalSummary?.pendingApproval ?? 0} pending approval`,
        )}
        ${renderSummaryCard(
          "Done",
          overview?.canonicalSummary?.completed ?? 0,
          `${overview?.canonicalSummary?.failed ?? 0} failed · ${overview?.canonicalSummary?.cancelled ?? 0} cancelled`,
        )}
      </div>

      <div class="card">
        <div class="card-title">Task inbox</div>
        <div class="card-sub">
          Proposals that can be approved, rejected, or launched into canonical tasks.
        </div>
        ${props.loading && !overview
          ? html`<div class="empty-state" style="margin-top: 16px;">Loading proposals…</div>`
          : proposals.length === 0
            ? html`<div class="empty-state" style="margin-top: 16px;">
                No saved task proposals right now.
              </div>`
            : html`
                <div style="display: grid; gap: 12px; margin-top: 16px;">
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

      <div class="card">
        <div class="card-title">Task tree</div>
        <div class="card-sub">
          ${visibleCanonicalTasks.length > 0
            ? `${visibleCanonicalTasks.length} visible canonical task${visibleCanonicalTasks.length === 1 ? "" : "s"}`
            : "No canonical tasks match the current filters yet."}
        </div>
        ${props.loading && !overview
          ? html`<div class="empty-state" style="margin-top: 16px;">Loading tasks…</div>`
          : flattenedTasks.length === 0
            ? html`<div class="empty-state" style="margin-top: 16px;">
                No canonical tasks match the current filters.
              </div>`
            : html`
                <div style="display: grid; gap: 10px; margin-top: 16px;">
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
      ${collections.tasks.length === 0 && legacyTasks.length > 0
        ? html`
            <div class="card">
              <div class="card-title">Legacy background runs</div>
              <div class="card-sub">Temporary compatibility view for the old runtime ledger.</div>
              <div style="margin-top: 16px;">${renderLegacyTaskList(props, legacyTasks)}</div>
            </div>
          `
        : nothing}
      ${findings.length > 0
        ? html`
            <div class="card">
              <div class="card-title">Legacy diagnostics</div>
              <div class="card-sub">
                Compatibility signals coming from the old background-task ledger.
              </div>
              <div style="display: grid; gap: 12px; margin-top: 16px;">
                ${findings.slice(0, 6).map(
                  (finding) => html`
                    <div class="list-item">
                      <div class="list-title">
                        ${finding.severity.toUpperCase()} · ${finding.code.replaceAll("_", " ")}
                      </div>
                      <div class="list-sub">${finding.detail}</div>
                    </div>
                  `,
                )}
              </div>
            </div>
          `
        : nothing}
    </section>
  `;
}
