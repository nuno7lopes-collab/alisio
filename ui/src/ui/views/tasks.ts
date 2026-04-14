import { html, nothing } from "lit";
import type { TaskRuntimeFilter, TaskStatusFilter } from "../controllers/tasks.ts";
import { formatMs, formatRelativeTimestamp } from "../format.ts";
import type { TaskNotifyPolicy, TaskRecord, TasksOverviewResult } from "../types.ts";

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
  onOpenRequesterSession?: (sessionKey: string) => void;
  onOpenChildSession?: (sessionKey: string) => void;
};

const TASK_RUNTIME_OPTIONS: Array<{ value: TaskRuntimeFilter; label: string }> = [
  { value: "all", label: "All runtimes" },
  { value: "subagent", label: "Subagents" },
  { value: "acp", label: "ACP" },
  { value: "cli", label: "CLI" },
  { value: "cron", label: "Cron" },
];

const TASK_STATUS_OPTIONS: Array<{ value: TaskStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "timed_out", label: "Timed out" },
  { value: "cancelled", label: "Cancelled" },
  { value: "lost", label: "Lost" },
];

function findSelectedTask(
  overview: TasksOverviewResult | null,
  selectedId: string | null,
): TaskRecord | null {
  const tasks = overview?.tasks ?? [];
  if (tasks.length === 0) {
    return null;
  }
  return tasks.find((task) => task.taskId === selectedId) ?? tasks[0] ?? null;
}

function describeTask(task: TaskRecord): string {
  return (
    task.terminalSummary?.trim() ||
    task.progressSummary?.trim() ||
    task.label?.trim() ||
    task.task.trim()
  );
}

function formatTaskDuration(task: TaskRecord): string {
  const start = task.startedAt ?? task.createdAt;
  const end = task.endedAt ?? Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "n/a";
  }
  return formatMs(end - start);
}

function renderSummaryCard(label: string, value: string | number, detail: string) {
  return html`
    <div class="card">
      <div class="card-title">${label}</div>
      <div style="font-size: 32px; font-weight: 700; margin-top: 8px;">${value}</div>
      <div class="card-sub" style="margin-top: 8px;">${detail}</div>
    </div>
  `;
}

function renderTaskRow(props: TasksViewProps, task: TaskRecord, selected: boolean) {
  return html`
    <button
      class="list-item"
      style=${selected ? "border-color: var(--accent-color, currentColor);" : ""}
      @click=${() => props.onSelectTask(task.taskId)}
    >
      <div class="list-title" style="display: flex; justify-content: space-between; gap: 12px;">
        <span>${describeTask(task)}</span>
        <span class="muted">${task.status}</span>
      </div>
      <div class="list-sub">
        ${task.runtime} · ${task.deliveryStatus} ·
        ${formatRelativeTimestamp(task.lastEventAt ?? task.createdAt)}
      </div>
      <div class="list-sub">${task.childSessionKey?.trim() || task.requesterSessionKey}</div>
    </button>
  `;
}

function renderTaskDetail(props: TasksViewProps, task: TaskRecord | null) {
  if (!task) {
    return html`
      <div class="card">
        <div class="card-title">Task detail</div>
        <div class="empty-state" style="margin-top: 16px;">No background task selected.</div>
      </div>
    `;
  }

  const taskCanCancel = task.status === "queued" || task.status === "running";
  return html`
    <div class="card">
      <div class="card-title">Task detail</div>
      <div class="card-sub">${describeTask(task)}</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Task ID</div>
          <div><code>${task.taskId}</code></div>
          <div class="agent-kv-sub">${task.runtime}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Status</div>
          <div>${task.status}</div>
          <div class="agent-kv-sub">${task.deliveryStatus}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Notify</div>
          <div>${task.notifyPolicy}</div>
          <div class="agent-kv-sub">${formatTaskDuration(task)}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Run</div>
          <div>${task.runId?.trim() || "n/a"}</div>
          <div class="agent-kv-sub">${task.agentId?.trim() || "No agent id"}</div>
        </div>
      </div>
      <div style="display: grid; gap: 8px; margin-top: 16px;">
        <div><strong>Task</strong>: ${task.task}</div>
        <div><strong>Requester</strong>: <code>${task.requesterSessionKey}</code></div>
        <div>
          <strong>Child session</strong>: <code>${task.childSessionKey?.trim() || "n/a"}</code>
        </div>
        ${task.error?.trim() ? html`<div><strong>Error</strong>: ${task.error}</div>` : nothing}
        ${task.progressSummary?.trim()
          ? html`<div><strong>Progress</strong>: ${task.progressSummary}</div>`
          : nothing}
        ${task.terminalSummary?.trim()
          ? html`<div><strong>Terminal</strong>: ${task.terminalSummary}</div>`
          : nothing}
      </div>
      <div class="row" style="margin-top: 18px; gap: 10px; flex-wrap: wrap;">
        <label class="field" style="min-width: 220px;">
          <span>Notify policy</span>
          <select
            .value=${task.notifyPolicy}
            ?disabled=${props.busy}
            @change=${(event: Event) => {
              props.onNotifyPolicyChange(
                task.taskId,
                (event.target as HTMLSelectElement).value as TaskNotifyPolicy,
              );
            }}
          >
            <option value="done_only">Done only</option>
            <option value="state_changes">State changes</option>
            <option value="silent">Silent</option>
          </select>
        </label>
        <button
          class="btn"
          ?disabled=${props.busy || !taskCanCancel}
          @click=${() => props.onCancelTask(task.taskId)}
        >
          Cancel task
        </button>
        ${task.requesterSessionKey.trim() && props.onOpenRequesterSession
          ? html`
              <button
                class="btn"
                @click=${() => props.onOpenRequesterSession?.(task.requesterSessionKey)}
              >
                Open requester chat
              </button>
            `
          : nothing}
        ${task.childSessionKey?.trim() && props.onOpenChildSession
          ? html`
              <button class="btn" @click=${() => props.onOpenChildSession?.(task.childSessionKey!)}>
                Open child chat
              </button>
            `
          : nothing}
      </div>
    </div>
  `;
}

export function renderTasks(props: TasksViewProps) {
  const overview = props.overview;
  const selectedTask = findSelectedTask(overview, props.selectedId);
  const tasks = overview?.tasks ?? [];
  const findings = overview?.findings ?? [];

  return html`
    <section class="grid">
      <div class="card">
        <div class="card-title">Background tasks</div>
        <div class="card-sub">
          Inspect queued and running work without changing how Alisio executes it.
        </div>
        <div class="row" style="margin-top: 18px; gap: 10px; flex-wrap: wrap;">
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Search</span>
            <input
              .value=${props.query}
              placeholder="task, session, run, or error"
              @input=${(event: Event) =>
                props.onQueryChange((event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field" style="min-width: 180px;">
            <span>Runtime</span>
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
            <span>Status</span>
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
          "Active",
          overview?.summary.active ?? 0,
          `${overview?.summary.byStatus.running ?? 0} running · ${overview?.summary.byStatus.queued ?? 0} queued`,
        )}
        ${renderSummaryCard(
          "Failures",
          overview?.summary.failures ?? 0,
          `${overview?.summary.byStatus.failed ?? 0} failed · ${overview?.summary.byStatus.lost ?? 0} lost`,
        )}
        ${renderSummaryCard(
          "Filtered",
          overview?.total ?? 0,
          `${overview?.filteredSummary.active ?? 0} active in the current view`,
        )}
        ${renderSummaryCard(
          "Audit",
          overview?.audit.total ?? 0,
          `${overview?.audit.errors ?? 0} errors · ${overview?.audit.warnings ?? 0} warnings`,
        )}
      </div>

      <div class="card">
        <div class="card-title">Needs attention</div>
        <div class="card-sub">Top registry findings from the current background task set.</div>
        ${findings.length === 0
          ? html`<div class="empty-state" style="margin-top: 16px;">
              No task findings right now.
            </div>`
          : html`
              <div style="display: grid; gap: 12px; margin-top: 16px;">
                ${findings.map(
                  (finding) => html`
                    <div class="list-item">
                      <div class="list-title">
                        ${finding.severity.toUpperCase()} · ${finding.code.replaceAll("_", " ")}
                      </div>
                      <div class="list-sub">${finding.detail}</div>
                      <div class="list-sub">
                        ${finding.task.taskId} · ${describeTask(finding.task)}
                      </div>
                    </div>
                  `,
                )}
              </div>
            `}
      </div>

      <div class="card">
        <div class="card-title">Current view</div>
        <div class="card-sub">
          ${overview
            ? `${overview.total} matching task${overview.total === 1 ? "" : "s"}`
            : "Load background task state from the gateway."}
        </div>
        ${props.loading
          ? html`<div class="empty-state" style="margin-top: 16px;">Loading tasks…</div>`
          : tasks.length === 0
            ? html`<div class="empty-state" style="margin-top: 16px;">
                No background tasks match the current filters.
              </div>`
            : html`
                <div style="display: grid; gap: 10px; margin-top: 16px;">
                  ${tasks.map((task) =>
                    renderTaskRow(props, task, task.taskId === selectedTask?.taskId),
                  )}
                </div>
              `}
      </div>

      ${renderTaskDetail(props, selectedTask)}
    </section>
  `;
}
