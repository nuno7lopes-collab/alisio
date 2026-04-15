import { chmodSync, existsSync, mkdirSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import type { DeliveryContext } from "../utils/delivery-context.js";
import type { TaskProposalRecord } from "./task-proposals.types.js";
import { resolveTaskRegistryDir, resolveTaskRegistrySqlitePath } from "./task-registry.paths.js";
import type { TaskRegistryStoreSnapshot } from "./task-registry.store.js";
import type { TaskDeliveryState, TaskRecord } from "./task-registry.types.js";

type TaskRegistryRow = {
  task_id: string;
  runtime: TaskRecord["runtime"];
  source_id: string | null;
  requester_session_key: string;
  child_session_key: string | null;
  parent_task_id: string | null;
  agent_id: string | null;
  run_id: string | null;
  label: string | null;
  task: string;
  status: TaskRecord["status"];
  delivery_status: TaskRecord["deliveryStatus"];
  notify_policy: TaskRecord["notifyPolicy"];
  created_at: number | bigint;
  started_at: number | bigint | null;
  ended_at: number | bigint | null;
  last_event_at: number | bigint | null;
  cleanup_after: number | bigint | null;
  error: string | null;
  progress_summary: string | null;
  terminal_summary: string | null;
  terminal_outcome: TaskRecord["terminalOutcome"] | null;
};

type TaskDeliveryStateRow = {
  task_id: string;
  requester_origin_json: string | null;
  last_notified_event_at: number | bigint | null;
};

type TaskProposalRow = {
  proposal_id: string;
  client_key: string;
  requester_session_key: string;
  source_message_id: string | null;
  kind: TaskProposalRecord["kind"];
  title: string;
  summary: string | null;
  rationale: string | null;
  acceptance_json: string | null;
  launch_prompt: string | null;
  agent_id: string | null;
  created_by: TaskProposalRecord["createdBy"];
  decision: TaskProposalRecord["decision"];
  created_at: number | bigint;
  updated_at: number | bigint;
  resolved_at: number | bigint | null;
  resolved_by: string | null;
  launched_run_id: string | null;
  launched_session_key: string | null;
  launched_at: number | bigint | null;
};

type TaskRegistryStatements = {
  selectAll: StatementSync;
  selectAllDeliveryStates: StatementSync;
  selectAllProposals: StatementSync;
  selectProposalById: StatementSync;
  selectProposalByClientKey: StatementSync;
  upsertRow: StatementSync;
  replaceDeliveryState: StatementSync;
  upsertProposal: StatementSync;
  deleteRow: StatementSync;
  deleteDeliveryState: StatementSync;
  clearRows: StatementSync;
  clearDeliveryStates: StatementSync;
};

type TaskRegistryDatabase = {
  db: DatabaseSync;
  path: string;
  statements: TaskRegistryStatements;
};

let cachedDatabase: TaskRegistryDatabase | null = null;
const TASK_REGISTRY_DIR_MODE = 0o700;
const TASK_REGISTRY_FILE_MODE = 0o600;
const TASK_REGISTRY_SIDEcar_SUFFIXES = ["", "-shm", "-wal"] as const;

function normalizeNumber(value: number | bigint | null): number | undefined {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return typeof value === "number" ? value : undefined;
}

function serializeJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function parseJsonValue<T>(raw: string | null): T | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function rowToTaskRecord(row: TaskRegistryRow): TaskRecord {
  const startedAt = normalizeNumber(row.started_at);
  const endedAt = normalizeNumber(row.ended_at);
  const lastEventAt = normalizeNumber(row.last_event_at);
  const cleanupAfter = normalizeNumber(row.cleanup_after);
  return {
    taskId: row.task_id,
    runtime: row.runtime,
    ...(row.source_id ? { sourceId: row.source_id } : {}),
    requesterSessionKey: row.requester_session_key,
    ...(row.child_session_key ? { childSessionKey: row.child_session_key } : {}),
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.label ? { label: row.label } : {}),
    task: row.task,
    status: row.status,
    deliveryStatus: row.delivery_status,
    notifyPolicy: row.notify_policy,
    createdAt: normalizeNumber(row.created_at) ?? 0,
    ...(startedAt != null ? { startedAt } : {}),
    ...(endedAt != null ? { endedAt } : {}),
    ...(lastEventAt != null ? { lastEventAt } : {}),
    ...(cleanupAfter != null ? { cleanupAfter } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.progress_summary ? { progressSummary: row.progress_summary } : {}),
    ...(row.terminal_summary ? { terminalSummary: row.terminal_summary } : {}),
    ...(row.terminal_outcome ? { terminalOutcome: row.terminal_outcome } : {}),
  };
}

function rowToTaskDeliveryState(row: TaskDeliveryStateRow): TaskDeliveryState {
  const requesterOrigin = parseJsonValue<DeliveryContext>(row.requester_origin_json);
  const lastNotifiedEventAt = normalizeNumber(row.last_notified_event_at);
  return {
    taskId: row.task_id,
    ...(requesterOrigin ? { requesterOrigin } : {}),
    ...(lastNotifiedEventAt != null ? { lastNotifiedEventAt } : {}),
  };
}

function rowToTaskProposalRecord(row: TaskProposalRow): TaskProposalRecord {
  const resolvedAt = normalizeNumber(row.resolved_at);
  const launchedAt = normalizeNumber(row.launched_at);
  return {
    proposalId: row.proposal_id,
    clientKey: row.client_key,
    requesterSessionKey: row.requester_session_key,
    ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
    kind: row.kind,
    title: row.title,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.rationale ? { rationale: row.rationale } : {}),
    acceptance: parseJsonValue<string[]>(row.acceptance_json) ?? [],
    ...(row.launch_prompt ? { launchPrompt: row.launch_prompt } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    createdBy: row.created_by,
    decision: row.decision,
    createdAt: normalizeNumber(row.created_at) ?? 0,
    updatedAt: normalizeNumber(row.updated_at) ?? 0,
    ...(resolvedAt != null ? { resolvedAt } : {}),
    ...(row.resolved_by ? { resolvedBy: row.resolved_by } : {}),
    ...(row.launched_run_id ? { launchedRunId: row.launched_run_id } : {}),
    ...(row.launched_session_key ? { launchedSessionKey: row.launched_session_key } : {}),
    ...(launchedAt != null ? { launchedAt } : {}),
  };
}

function bindTaskRecord(record: TaskRecord) {
  return {
    task_id: record.taskId,
    runtime: record.runtime,
    source_id: record.sourceId ?? null,
    requester_session_key: record.requesterSessionKey,
    child_session_key: record.childSessionKey ?? null,
    parent_task_id: record.parentTaskId ?? null,
    agent_id: record.agentId ?? null,
    run_id: record.runId ?? null,
    label: record.label ?? null,
    task: record.task,
    status: record.status,
    delivery_status: record.deliveryStatus,
    notify_policy: record.notifyPolicy,
    created_at: record.createdAt,
    started_at: record.startedAt ?? null,
    ended_at: record.endedAt ?? null,
    last_event_at: record.lastEventAt ?? null,
    cleanup_after: record.cleanupAfter ?? null,
    error: record.error ?? null,
    progress_summary: record.progressSummary ?? null,
    terminal_summary: record.terminalSummary ?? null,
    terminal_outcome: record.terminalOutcome ?? null,
  };
}

function bindTaskDeliveryState(state: TaskDeliveryState) {
  return {
    task_id: state.taskId,
    requester_origin_json: serializeJson(state.requesterOrigin),
    last_notified_event_at: state.lastNotifiedEventAt ?? null,
  };
}

function bindTaskProposalRecord(record: TaskProposalRecord) {
  return {
    proposal_id: record.proposalId,
    client_key: record.clientKey,
    requester_session_key: record.requesterSessionKey,
    source_message_id: record.sourceMessageId ?? null,
    kind: record.kind,
    title: record.title,
    summary: record.summary ?? null,
    rationale: record.rationale ?? null,
    acceptance_json: serializeJson(record.acceptance),
    launch_prompt: record.launchPrompt ?? null,
    agent_id: record.agentId ?? null,
    created_by: record.createdBy,
    decision: record.decision,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    resolved_at: record.resolvedAt ?? null,
    resolved_by: record.resolvedBy ?? null,
    launched_run_id: record.launchedRunId ?? null,
    launched_session_key: record.launchedSessionKey ?? null,
    launched_at: record.launchedAt ?? null,
  };
}

function createStatements(db: DatabaseSync): TaskRegistryStatements {
  return {
    selectAll: db.prepare(`
      SELECT
        task_id,
        runtime,
        source_id,
        requester_session_key,
        child_session_key,
        parent_task_id,
        agent_id,
        run_id,
        label,
        task,
        status,
        delivery_status,
        notify_policy,
        created_at,
        started_at,
        ended_at,
        last_event_at,
        cleanup_after,
        error,
        progress_summary,
        terminal_summary,
        terminal_outcome
      FROM task_runs
      ORDER BY created_at ASC, task_id ASC
    `),
    selectAllDeliveryStates: db.prepare(`
      SELECT
        task_id,
        requester_origin_json,
        last_notified_event_at
      FROM task_delivery_state
      ORDER BY task_id ASC
    `),
    selectAllProposals: db.prepare(`
      SELECT
        proposal_id,
        client_key,
        requester_session_key,
        source_message_id,
        kind,
        title,
        summary,
        rationale,
        acceptance_json,
        launch_prompt,
        agent_id,
        created_by,
        decision,
        created_at,
        updated_at,
        resolved_at,
        resolved_by,
        launched_run_id,
        launched_session_key,
        launched_at
      FROM task_proposals
      ORDER BY updated_at DESC, created_at DESC, proposal_id DESC
    `),
    selectProposalById: db.prepare(`
      SELECT
        proposal_id,
        client_key,
        requester_session_key,
        source_message_id,
        kind,
        title,
        summary,
        rationale,
        acceptance_json,
        launch_prompt,
        agent_id,
        created_by,
        decision,
        created_at,
        updated_at,
        resolved_at,
        resolved_by,
        launched_run_id,
        launched_session_key,
        launched_at
      FROM task_proposals
      WHERE proposal_id = ?
      LIMIT 1
    `),
    selectProposalByClientKey: db.prepare(`
      SELECT
        proposal_id,
        client_key,
        requester_session_key,
        source_message_id,
        kind,
        title,
        summary,
        rationale,
        acceptance_json,
        launch_prompt,
        agent_id,
        created_by,
        decision,
        created_at,
        updated_at,
        resolved_at,
        resolved_by,
        launched_run_id,
        launched_session_key,
        launched_at
      FROM task_proposals
      WHERE requester_session_key = ? AND client_key = ?
      LIMIT 1
    `),
    upsertRow: db.prepare(`
      INSERT INTO task_runs (
        task_id,
        runtime,
        source_id,
        requester_session_key,
        child_session_key,
        parent_task_id,
        agent_id,
        run_id,
        label,
        task,
        status,
        delivery_status,
        notify_policy,
        created_at,
        started_at,
        ended_at,
        last_event_at,
        cleanup_after,
        error,
        progress_summary,
        terminal_summary,
        terminal_outcome
      ) VALUES (
        @task_id,
        @runtime,
        @source_id,
        @requester_session_key,
        @child_session_key,
        @parent_task_id,
        @agent_id,
        @run_id,
        @label,
        @task,
        @status,
        @delivery_status,
        @notify_policy,
        @created_at,
        @started_at,
        @ended_at,
        @last_event_at,
        @cleanup_after,
        @error,
        @progress_summary,
        @terminal_summary,
        @terminal_outcome
      )
      ON CONFLICT(task_id) DO UPDATE SET
        runtime = excluded.runtime,
        source_id = excluded.source_id,
        requester_session_key = excluded.requester_session_key,
        child_session_key = excluded.child_session_key,
        parent_task_id = excluded.parent_task_id,
        agent_id = excluded.agent_id,
        run_id = excluded.run_id,
        label = excluded.label,
        task = excluded.task,
        status = excluded.status,
        delivery_status = excluded.delivery_status,
        notify_policy = excluded.notify_policy,
        created_at = excluded.created_at,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        last_event_at = excluded.last_event_at,
        cleanup_after = excluded.cleanup_after,
        error = excluded.error,
        progress_summary = excluded.progress_summary,
        terminal_summary = excluded.terminal_summary,
        terminal_outcome = excluded.terminal_outcome
    `),
    replaceDeliveryState: db.prepare(`
      INSERT OR REPLACE INTO task_delivery_state (
        task_id,
        requester_origin_json,
        last_notified_event_at
      ) VALUES (
        @task_id,
        @requester_origin_json,
        @last_notified_event_at
      )
    `),
    upsertProposal: db.prepare(`
      INSERT INTO task_proposals (
        proposal_id,
        client_key,
        requester_session_key,
        source_message_id,
        kind,
        title,
        summary,
        rationale,
        acceptance_json,
        launch_prompt,
        agent_id,
        created_by,
        decision,
        created_at,
        updated_at,
        resolved_at,
        resolved_by,
        launched_run_id,
        launched_session_key,
        launched_at
      ) VALUES (
        @proposal_id,
        @client_key,
        @requester_session_key,
        @source_message_id,
        @kind,
        @title,
        @summary,
        @rationale,
        @acceptance_json,
        @launch_prompt,
        @agent_id,
        @created_by,
        @decision,
        @created_at,
        @updated_at,
        @resolved_at,
        @resolved_by,
        @launched_run_id,
        @launched_session_key,
        @launched_at
      )
      ON CONFLICT(proposal_id) DO UPDATE SET
        client_key = excluded.client_key,
        requester_session_key = excluded.requester_session_key,
        source_message_id = excluded.source_message_id,
        kind = excluded.kind,
        title = excluded.title,
        summary = excluded.summary,
        rationale = excluded.rationale,
        acceptance_json = excluded.acceptance_json,
        launch_prompt = excluded.launch_prompt,
        agent_id = excluded.agent_id,
        created_by = excluded.created_by,
        decision = excluded.decision,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        resolved_at = excluded.resolved_at,
        resolved_by = excluded.resolved_by,
        launched_run_id = excluded.launched_run_id,
        launched_session_key = excluded.launched_session_key,
        launched_at = excluded.launched_at
    `),
    deleteRow: db.prepare(`DELETE FROM task_runs WHERE task_id = ?`),
    deleteDeliveryState: db.prepare(`DELETE FROM task_delivery_state WHERE task_id = ?`),
    clearRows: db.prepare(`DELETE FROM task_runs`),
    clearDeliveryStates: db.prepare(`DELETE FROM task_delivery_state`),
  };
}

function ensureSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_runs (
      task_id TEXT PRIMARY KEY,
      runtime TEXT NOT NULL,
      source_id TEXT,
      requester_session_key TEXT NOT NULL,
      child_session_key TEXT,
      parent_task_id TEXT,
      agent_id TEXT,
      run_id TEXT,
      label TEXT,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      notify_policy TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      last_event_at INTEGER,
      cleanup_after INTEGER,
      error TEXT,
      progress_summary TEXT,
      terminal_summary TEXT,
      terminal_outcome TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_delivery_state (
      task_id TEXT PRIMARY KEY,
      requester_origin_json TEXT,
      last_notified_event_at INTEGER
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_proposals (
      proposal_id TEXT PRIMARY KEY,
      client_key TEXT NOT NULL,
      requester_session_key TEXT NOT NULL,
      source_message_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      rationale TEXT,
      acceptance_json TEXT,
      launch_prompt TEXT,
      agent_id TEXT,
      created_by TEXT NOT NULL,
      decision TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolved_by TEXT,
      launched_run_id TEXT,
      launched_session_key TEXT,
      launched_at INTEGER
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_run_id ON task_runs(run_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_runtime_status ON task_runs(runtime, status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_cleanup_after ON task_runs(cleanup_after);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_last_event_at ON task_runs(last_event_at);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_runs_child_session_key ON task_runs(child_session_key);`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_task_proposals_session_client ON task_proposals(requester_session_key, client_key);`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_proposals_decision ON task_proposals(decision);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_proposals_updated_at ON task_proposals(updated_at DESC);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_proposals_launched_run_id ON task_proposals(launched_run_id);`,
  );
}

function ensureTaskRegistryPermissions(pathname: string) {
  const dir = resolveTaskRegistryDir(process.env);
  mkdirSync(dir, { recursive: true, mode: TASK_REGISTRY_DIR_MODE });
  chmodSync(dir, TASK_REGISTRY_DIR_MODE);
  for (const suffix of TASK_REGISTRY_SIDEcar_SUFFIXES) {
    const candidate = `${pathname}${suffix}`;
    if (!existsSync(candidate)) {
      continue;
    }
    chmodSync(candidate, TASK_REGISTRY_FILE_MODE);
  }
}

function openTaskRegistryDatabase(): TaskRegistryDatabase {
  const pathname = resolveTaskRegistrySqlitePath(process.env);
  if (cachedDatabase && cachedDatabase.path === pathname) {
    return cachedDatabase;
  }
  if (cachedDatabase) {
    cachedDatabase.db.close();
    cachedDatabase = null;
  }
  ensureTaskRegistryPermissions(pathname);
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(pathname);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA synchronous = NORMAL;`);
  db.exec(`PRAGMA busy_timeout = 5000;`);
  ensureSchema(db);
  ensureTaskRegistryPermissions(pathname);
  cachedDatabase = {
    db,
    path: pathname,
    statements: createStatements(db),
  };
  return cachedDatabase;
}

function withWriteTransaction(write: (statements: TaskRegistryStatements) => void) {
  const { db, path, statements } = openTaskRegistryDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    write(statements);
    db.exec("COMMIT");
    ensureTaskRegistryPermissions(path);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function loadTaskRegistryStateFromSqlite(): TaskRegistryStoreSnapshot {
  const { statements } = openTaskRegistryDatabase();
  const taskRows = statements.selectAll.all() as TaskRegistryRow[];
  const deliveryRows = statements.selectAllDeliveryStates.all() as TaskDeliveryStateRow[];
  return {
    tasks: new Map(taskRows.map((row) => [row.task_id, rowToTaskRecord(row)])),
    deliveryStates: new Map(deliveryRows.map((row) => [row.task_id, rowToTaskDeliveryState(row)])),
  };
}

export function saveTaskRegistryStateToSqlite(snapshot: TaskRegistryStoreSnapshot) {
  withWriteTransaction((statements) => {
    statements.clearDeliveryStates.run();
    statements.clearRows.run();
    for (const task of snapshot.tasks.values()) {
      statements.upsertRow.run(bindTaskRecord(task));
    }
    for (const state of snapshot.deliveryStates.values()) {
      statements.replaceDeliveryState.run(bindTaskDeliveryState(state));
    }
  });
}

export function upsertTaskRegistryRecordToSqlite(task: TaskRecord) {
  const store = openTaskRegistryDatabase();
  store.statements.upsertRow.run(bindTaskRecord(task));
  ensureTaskRegistryPermissions(store.path);
}

export function deleteTaskRegistryRecordFromSqlite(taskId: string) {
  const store = openTaskRegistryDatabase();
  store.statements.deleteRow.run(taskId);
  store.statements.deleteDeliveryState.run(taskId);
  ensureTaskRegistryPermissions(store.path);
}

export function upsertTaskDeliveryStateToSqlite(state: TaskDeliveryState) {
  const store = openTaskRegistryDatabase();
  store.statements.replaceDeliveryState.run(bindTaskDeliveryState(state));
  ensureTaskRegistryPermissions(store.path);
}

export function listTaskProposalRecordsFromSqlite(): TaskProposalRecord[] {
  const { statements } = openTaskRegistryDatabase();
  const proposalRows = statements.selectAllProposals.all() as TaskProposalRow[];
  return proposalRows.map((row) => rowToTaskProposalRecord(row));
}

export function getTaskProposalRecordByIdFromSqlite(
  taskProposalId: string,
): TaskProposalRecord | null {
  const { statements } = openTaskRegistryDatabase();
  const row = statements.selectProposalById.get(taskProposalId) as TaskProposalRow | undefined;
  return row ? rowToTaskProposalRecord(row) : null;
}

export function getTaskProposalRecordByClientKeyFromSqlite(params: {
  requesterSessionKey: string;
  clientKey: string;
}): TaskProposalRecord | null {
  const { statements } = openTaskRegistryDatabase();
  const row = statements.selectProposalByClientKey.get(
    params.requesterSessionKey,
    params.clientKey,
  ) as TaskProposalRow | undefined;
  return row ? rowToTaskProposalRecord(row) : null;
}

export function upsertTaskProposalRecordToSqlite(record: TaskProposalRecord) {
  const store = openTaskRegistryDatabase();
  store.statements.upsertProposal.run(bindTaskProposalRecord(record));
  ensureTaskRegistryPermissions(store.path);
}

export function deleteTaskDeliveryStateFromSqlite(taskId: string) {
  const store = openTaskRegistryDatabase();
  store.statements.deleteDeliveryState.run(taskId);
  ensureTaskRegistryPermissions(store.path);
}

export function closeTaskRegistrySqliteStore() {
  if (!cachedDatabase) {
    return;
  }
  cachedDatabase.db.close();
  cachedDatabase = null;
}
