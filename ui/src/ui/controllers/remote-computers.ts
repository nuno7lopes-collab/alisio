import type { NodeListNode } from "../../../../src/shared/node-list-types.js";
import { splitShellArgs } from "../../../../src/utils/shell-argv.js";
import { t } from "../../i18n/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { generateUUID } from "../uuid.ts";
import type { DevicePairingList } from "./devices.ts";
import type { AlisioSharingState } from "../types.ts";

type SharingTarget = AlisioSharingState["devices"]["owned"][number];
type SharingAccess = SharingTarget["execAccess"];
type RemoteComputerPhase =
  | "ready"
  | "needs-approval"
  | "request-pending"
  | "offline"
  | "limited"
  | "available";
type RemoteTaskPhase = "starting" | "running" | "succeeded" | "failed";

const MAX_REMOTE_TASKS_PER_COMPUTER = 4;

export type RemoteComputerDraft = {
  command: string;
  cwd: string;
};

export type RemoteComputerTaskRecord = {
  localId: string;
  taskId: string | null;
  computerId: string;
  nodeId: string;
  commandText: string;
  cwd: string | null;
  phase: RemoteTaskPhase;
  startedAtMs: number;
  updatedAtMs: number;
  completedAtMs: number | null;
  kind: string | null;
  stdout: string;
  stderr: string;
  error: string | null;
  exitCode: number | null;
  timedOut: boolean;
  success: boolean | null;
};

export type RemoteComputerRecord = {
  id: string;
  label: string;
  platform: string | null;
  sourceKind: SharingTarget["sourceKind"];
  ownerLabel: string | null;
  sameAccount: boolean;
  connected: boolean;
  supportsExec: boolean;
  trusted: boolean;
  pairingPending: boolean;
  deviceAccess: SharingTarget["deviceAccess"];
  modelAccess: SharingTarget["modelAccess"];
  execAccess: SharingAccess;
  requestStatus: SharingTarget["requestStatus"] | null;
  grantId: string | null;
  grantScopes: string[];
  phase: RemoteComputerPhase;
  nodeId: string | null;
};

export type RemoteComputersState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey?: string;
  remoteComputerDrafts: Record<string, RemoteComputerDraft>;
  remoteComputerBusy: Record<string, boolean>;
  remoteComputerErrors: Record<string, string | null>;
  remoteComputerTasks: Record<string, RemoteComputerTaskRecord[]>;
};

type RemoteComputerCatalogState = {
  sharing: AlisioSharingState | null;
  nodes: NodeListNode[];
  devicesList: DevicePairingList | null;
};

type TaskAcceptedPayload = {
  status?: string;
  taskId?: string;
};

type TaskUpdatedEventPayload =
  | {
      phase: "event";
      taskId: string;
      nodeId: string;
      capabilityId?: string;
      kind?: string;
      payload?: unknown;
    }
  | {
      phase: "result";
      taskId: string;
      nodeId: string;
      capabilityId?: string;
      ok?: boolean;
      payload?: unknown;
      error?: { message?: string } | null;
    };

type TaskPayloadRecord = {
  stdout?: unknown;
  stderr?: unknown;
  error?: unknown;
  exitCode?: unknown;
  timedOut?: unknown;
  success?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function supportsExec(node: Pick<NodeListNode, "commands" | "capabilities"> | null | undefined) {
  const commands = Array.isArray(node?.commands) ? node.commands : [];
  if (commands.includes("system.run")) {
    return true;
  }
  const capabilities = Array.isArray(node?.capabilities) ? node.capabilities : [];
  return capabilities.some((capability) => capability.id?.trim() === "exec.shell.v1");
}

function resolveTargetPhase(params: {
  target: SharingTarget;
  connected: boolean;
  supportsExec: boolean;
}): RemoteComputerPhase {
  if (params.target.requestStatus === "pending") {
    return "request-pending";
  }
  if (params.connected && params.supportsExec) {
    if (params.target.execAccess === "owner" || params.target.execAccess === "shared") {
      return "ready";
    }
    if (params.target.execAccess === "requestable") {
      return "needs-approval";
    }
    return "available";
  }
  if (params.connected) {
    return "limited";
  }
  if (params.target.execAccess === "owner" || params.target.execAccess === "shared") {
    return "offline";
  }
  if (params.target.execAccess === "requestable") {
    return "needs-approval";
  }
  return "available";
}

function resolveDraft(
  drafts: Record<string, RemoteComputerDraft>,
  computerId: string,
): RemoteComputerDraft {
  return drafts[computerId] ?? { command: "", cwd: "" };
}

function sortRemoteComputers(a: RemoteComputerRecord, b: RemoteComputerRecord) {
  const phaseOrder: Record<RemoteComputerPhase, number> = {
    ready: 0,
    "request-pending": 1,
    "needs-approval": 2,
    offline: 3,
    limited: 4,
    available: 5,
  };
  const phaseDiff = phaseOrder[a.phase] - phaseOrder[b.phase];
  if (phaseDiff !== 0) {
    return phaseDiff;
  }
  if (a.connected !== b.connected) {
    return a.connected ? -1 : 1;
  }
  return a.label.localeCompare(b.label);
}

function collectSharingTargets(sharing: AlisioSharingState | null): SharingTarget[] {
  if (!sharing) {
    return [];
  }
  const merged = new Map<string, SharingTarget>();
  const allTargets = [
    ...(sharing.devices.sharedWithMe ?? []),
    ...(sharing.devices.available ?? []),
    ...(sharing.devices.owned ?? []),
  ];
  for (const target of allTargets) {
    if (target.current || target.sourceKind !== "node") {
      continue;
    }
    merged.set(target.targetId, target);
  }
  return [...merged.values()];
}

function trimTaskList(tasks: readonly RemoteComputerTaskRecord[]) {
  return [...tasks].slice(0, MAX_REMOTE_TASKS_PER_COMPUTER);
}

function updateTaskRecord(
  state: RemoteComputersState,
  taskId: string,
  updater: (task: RemoteComputerTaskRecord) => RemoteComputerTaskRecord,
) {
  let matchedComputerId: string | null = null;
  const nextEntries = Object.entries(state.remoteComputerTasks).map(([computerId, tasks]) => {
    const nextTasks = tasks.map((task) => {
      if (task.taskId !== taskId) {
        return task;
      }
      matchedComputerId = computerId;
      return updater(task);
    });
    return [computerId, nextTasks] as const;
  });
  if (!matchedComputerId) {
    return null;
  }
  state.remoteComputerTasks = Object.fromEntries(nextEntries);
  return matchedComputerId;
}

function setRemoteComputerError(
  state: RemoteComputersState,
  computerId: string,
  value: string | null,
) {
  state.remoteComputerErrors = {
    ...state.remoteComputerErrors,
    [computerId]: value,
  };
}

function setRemoteComputerBusy(state: RemoteComputersState, computerId: string, value: boolean) {
  state.remoteComputerBusy = {
    ...state.remoteComputerBusy,
    [computerId]: value,
  };
}

function prependRemoteComputerTask(state: RemoteComputersState, task: RemoteComputerTaskRecord) {
  const current = state.remoteComputerTasks[task.computerId] ?? [];
  state.remoteComputerTasks = {
    ...state.remoteComputerTasks,
    [task.computerId]: trimTaskList([task, ...current]),
  };
}

function extractTaskPayload(payload: unknown): TaskPayloadRecord | null {
  return isRecord(payload) ? (payload as TaskPayloadRecord) : null;
}

export function resolveRemoteComputerRecords(state: RemoteComputerCatalogState): RemoteComputerRecord[] {
  const nodeById = new Map(
    state.nodes.map((node) => [node.nodeId.trim(), node] as const).filter(([nodeId]) => nodeId),
  );
  const pairedDevices = new Set(
    (state.devicesList?.paired ?? [])
      .map((entry) => entry.deviceId.trim())
      .filter((deviceId) => deviceId.length > 0),
  );
  const pendingDevices = new Set(
    (state.devicesList?.pending ?? [])
      .map((entry) => entry.deviceId.trim())
      .filter((deviceId) => deviceId.length > 0),
  );
  const viewerOwnerKey = state.sharing?.viewer.ownerKey ?? null;

  return collectSharingTargets(state.sharing)
    .map((target) => {
      const nodeId = target.targetId.trim();
      const node = nodeById.get(nodeId) ?? null;
      const connected = node?.connected === true;
      const execReady = supportsExec(node);
      return {
        id: target.targetId,
        label: target.label,
        platform: normalizeString(target.platform),
        sourceKind: target.sourceKind,
        ownerLabel: normalizeString(target.ownerLabel),
        sameAccount: viewerOwnerKey !== null && target.ownerKey === viewerOwnerKey,
        connected,
        supportsExec: execReady,
        trusted: pairedDevices.has(target.targetId),
        pairingPending: pendingDevices.has(target.targetId),
        deviceAccess: target.deviceAccess,
        modelAccess: target.modelAccess,
        execAccess: target.execAccess,
        requestStatus: target.requestStatus ?? null,
        grantId: normalizeString(target.grantId),
        grantScopes: [...(target.grantScopes ?? [])],
        phase: resolveTargetPhase({ target, connected, supportsExec: execReady }),
        nodeId: node ? node.nodeId : nodeId,
      } satisfies RemoteComputerRecord;
    })
    .toSorted(sortRemoteComputers);
}

export function updateRemoteComputerDraft(
  state: RemoteComputersState,
  params: {
    computerId: string;
    command?: string;
    cwd?: string;
  },
) {
  const current = resolveDraft(state.remoteComputerDrafts, params.computerId);
  state.remoteComputerDrafts = {
    ...state.remoteComputerDrafts,
    [params.computerId]: {
      command: params.command ?? current.command,
      cwd: params.cwd ?? current.cwd,
    },
  };
  setRemoteComputerError(state, params.computerId, null);
}

export async function runRemoteComputerCommand(
  state: RemoteComputersState,
  params: {
    computerId: string;
    nodeId: string;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const draft = resolveDraft(state.remoteComputerDrafts, params.computerId);
  const commandText = draft.command.trim();
  if (!commandText) {
    setRemoteComputerError(state, params.computerId, t("alisio.connections.remote.emptyCommand"));
    return;
  }
  const argv = splitShellArgs(commandText);
  if (!argv || argv.length === 0) {
    setRemoteComputerError(
      state,
      params.computerId,
      t("alisio.connections.remote.invalidCommand"),
    );
    return;
  }

  const cwd = draft.cwd.trim();
  const localId = generateUUID();
  const startedAtMs = Date.now();
  setRemoteComputerError(state, params.computerId, null);
  setRemoteComputerBusy(state, params.computerId, true);
  prependRemoteComputerTask(state, {
    localId,
    taskId: null,
    computerId: params.computerId,
    nodeId: params.nodeId,
    commandText,
    cwd: cwd || null,
    phase: "starting",
    startedAtMs,
    updatedAtMs: startedAtMs,
    completedAtMs: null,
    kind: null,
    stdout: "",
    stderr: "",
    error: null,
    exitCode: null,
    timedOut: false,
    success: null,
  });

  try {
    const result = await state.client.request<TaskAcceptedPayload>("node.task.start", {
      nodeId: params.nodeId,
      capabilityId: "exec.shell.v1",
      input: {
        command: argv,
        ...(cwd ? { cwd } : {}),
        ...(state.sessionKey?.trim() ? { sessionKey: state.sessionKey.trim() } : {}),
      },
      idempotencyKey: generateUUID(),
    });
    const acceptedTaskId = normalizeString(result?.taskId);
    if (!acceptedTaskId || result?.status !== "accepted") {
      throw new Error(t("alisio.connections.remote.startFailed"));
    }
    state.remoteComputerTasks = Object.fromEntries(
      Object.entries(state.remoteComputerTasks).map(([computerId, tasks]) => [
        computerId,
        tasks.map((task) =>
          task.localId === localId ?
            {
              ...task,
              taskId: acceptedTaskId,
              phase: "running",
              updatedAtMs: Date.now(),
            }
          : task,
        ),
      ]),
    );
  } catch (error) {
    setRemoteComputerBusy(state, params.computerId, false);
    const message = error instanceof Error ? error.message : String(error);
    state.remoteComputerTasks = Object.fromEntries(
      Object.entries(state.remoteComputerTasks).map(([computerId, tasks]) => [
        computerId,
        tasks.map((task) =>
          task.localId === localId ?
            {
              ...task,
              phase: "failed",
              updatedAtMs: Date.now(),
              completedAtMs: Date.now(),
              error: message,
            }
          : task,
        ),
      ]),
    );
    setRemoteComputerError(state, params.computerId, message);
  }
}

function coerceTaskUpdatedPayload(payload: unknown): TaskUpdatedEventPayload | null {
  if (!isRecord(payload)) {
    return null;
  }
  const taskId = normalizeString(payload.taskId);
  const nodeId = normalizeString(payload.nodeId);
  const phase = normalizeString(payload.phase);
  if (!taskId || !nodeId || (phase !== "event" && phase !== "result")) {
    return null;
  }
  if (phase === "event") {
    return {
      phase,
      taskId,
      nodeId,
      capabilityId: normalizeString(payload.capabilityId) ?? undefined,
      kind: normalizeString(payload.kind) ?? undefined,
      payload: payload.payload,
    };
  }
  return {
    phase,
    taskId,
    nodeId,
    capabilityId: normalizeString(payload.capabilityId) ?? undefined,
    ok: payload.ok === true,
    payload: payload.payload,
    error: isRecord(payload.error) ? { message: normalizeString(payload.error.message) ?? undefined } : null,
  };
}

export function applyRemoteComputerTaskUpdate(
  state: RemoteComputersState,
  payload: unknown,
): boolean {
  const update = coerceTaskUpdatedPayload(payload);
  if (!update || update.capabilityId !== "exec.shell.v1") {
    return false;
  }
  const updatedAtMs = Date.now();
  if (update.phase === "event") {
    updateTaskRecord(state, update.taskId, (task) => ({
      ...task,
      phase: update.kind === "started" ? "running" : task.phase,
      kind: update.kind ?? task.kind,
      updatedAtMs,
    }));
    return true;
  }

  const payloadRecord = extractTaskPayload(update.payload);
  const matchedComputerId = updateTaskRecord(state, update.taskId, (task) => {
    const stdout = typeof payloadRecord?.stdout === "string" ? payloadRecord.stdout : task.stdout;
    const stderr = typeof payloadRecord?.stderr === "string" ? payloadRecord.stderr : task.stderr;
    const errorMessage =
      normalizeString(payloadRecord?.error) ?? update.error?.message ?? task.error;
    const exitCode =
      typeof payloadRecord?.exitCode === "number" ? payloadRecord.exitCode : task.exitCode;
    const timedOut = payloadRecord?.timedOut === true;
    const success =
      typeof payloadRecord?.success === "boolean"
        ? payloadRecord.success
        : update.ok === true && exitCode === 0;
    return {
      ...task,
      phase: update.ok === true && success ? "succeeded" : "failed",
      updatedAtMs,
      completedAtMs: updatedAtMs,
      stdout,
      stderr,
      error: errorMessage,
      exitCode,
      timedOut,
      success,
      kind: "completed",
    };
  });
  if (!matchedComputerId) {
    return false;
  }
  setRemoteComputerBusy(state, matchedComputerId, false);
  return true;
}
