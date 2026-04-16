import type { DatabaseSync } from "node:sqlite";
import type { AlisioConfig } from "alisio/plugin-sdk/config-runtime";
import {
  buildCanonicalMemoryStoreStatus,
  memoryWriteEvent,
  type CanonicalMemoryStoreStatus,
  type CanonicalStoreBackend,
} from "alisio/plugin-sdk/memory-core-engine-runtime";
import type {
  MemoryStateEventDraft,
  MemoryStateEventEnvelopePlain,
} from "alisio/plugin-sdk/memory-core-state";
import { openLedger } from "../../memory-ledger/src/index.js";
import type { MemoryJobCheckpointReason } from "./types.js";
import { createEventId, parseJsonValue, stableStringify } from "./utils.js";

export type GaiaSleepRuntime = {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  env?: NodeJS.ProcessEnv;
  actorId?: string;
  db?: DatabaseSync;
};

export type JobCheckpointRecord = {
  jobId: string;
  profileId: string;
  kind: string;
  reason: MemoryJobCheckpointReason;
  cursor: unknown;
  pendingEventCount: number;
  pendingPayloadBytes: number;
  requestCheckpoint?: boolean;
};

export type GaiaWriteResult = {
  status: CanonicalMemoryStoreStatus;
  events: MemoryStateEventEnvelopePlain[];
  stateHash: string;
};

export type GaiaCheckpointResult = {
  status: CanonicalMemoryStoreStatus;
  checkpointEventId: string;
  checkpointId?: string;
  stateHash: string;
};

export type GaiaSleepWriteFacade = {
  status: CanonicalMemoryStoreStatus;
  ensureReady(): Promise<CanonicalMemoryStoreStatus>;
  writeEvents(
    events: readonly MemoryStateEventDraft[],
    options?: {
      materializeMarkdown?: boolean;
      forceCheckpoint?: boolean;
    },
  ): Promise<GaiaWriteResult>;
  recordJobCheckpoint(record: JobCheckpointRecord): Promise<GaiaCheckpointResult>;
  readDashboard<T>(kind: string): T | undefined;
};

function readDashboard<T>(db: DatabaseSync, kind: string): T | undefined {
  const row = db
    .prepare(
      `SELECT json
       FROM dashboards
       WHERE kind = ?
       LIMIT 1`,
    )
    .get(kind) as
    | {
        json: string;
      }
    | undefined;
  return row ? parseJsonValue<T | undefined>(row.json, undefined) : undefined;
}

function readLatestCheckpointId(profileId: string, env?: NodeJS.ProcessEnv): string | undefined {
  const ledger = openLedger(profileId, { env });
  try {
    return ledger.getLatestCheckpoint()?.checkpointId;
  } finally {
    ledger.close();
  }
}

export function resolveGaiaSleepStatus(params: {
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  env?: NodeJS.ProcessEnv;
}): CanonicalMemoryStoreStatus {
  return buildCanonicalMemoryStoreStatus({
    env: params.env,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    backend: params.backend,
  });
}

export function createGaiaSleepWriteFacade(params: GaiaSleepRuntime): GaiaSleepWriteFacade {
  const actorId = params.actorId?.trim() || "gaia-sleep";
  const status = resolveGaiaSleepStatus({
    env: params.env,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    backend: params.backend,
  });
  let readyPromise: Promise<CanonicalMemoryStoreStatus> | undefined;

  const ensureReady = async () => {
    readyPromise ??= memoryWriteEvent({
      cfg: params.cfg,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      backend: params.backend,
      env: params.env,
      events: [],
      materializeMarkdown: false,
    }).then((result) => result.status);
    return readyPromise;
  };

  const writeEvents = async (
    events: readonly MemoryStateEventDraft[],
    options?: {
      materializeMarkdown?: boolean;
      forceCheckpoint?: boolean;
    },
  ): Promise<GaiaWriteResult> => {
    await ensureReady();
    const result = await memoryWriteEvent({
      cfg: params.cfg,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      backend: params.backend,
      env: params.env,
      events: [...events],
      materializeMarkdown: options?.materializeMarkdown === true,
      forceCheckpoint: options?.forceCheckpoint,
    });
    readyPromise = Promise.resolve(result.status);
    return {
      status: result.status,
      events: result.events,
      stateHash: result.stateHash,
    };
  };

  return {
    status,

    ensureReady,

    writeEvents(events) {
      return writeEvents(events);
    },

    async recordJobCheckpoint(record) {
      const checkpointEventId = createEventId(
        "sleep-job-checkpoint",
        stableStringify([
          record.profileId,
          record.jobId,
          record.kind,
          record.reason,
          record.cursor,
          record.pendingEventCount,
          record.pendingPayloadBytes,
        ]),
      );
      const result = await writeEvents(
        [
          {
            actorId,
            eventId: checkpointEventId,
            source: `sleep/${record.kind}`,
            batchId: record.jobId,
            type: "JOB_CHECKPOINT_UPDATED",
            payload: {
              profileId: record.profileId,
              jobId: record.jobId,
              kind: record.kind,
              reason: record.reason,
              cursor: record.cursor as Record<string, unknown>,
              pendingEventCount: record.pendingEventCount,
              pendingPayloadBytes: record.pendingPayloadBytes,
            },
          },
        ],
        {
          forceCheckpoint: record.requestCheckpoint === true,
        },
      );

      return {
        status: result.status,
        checkpointEventId,
        ...(params.db
          ? { checkpointId: readLatestCheckpointId(record.profileId, params.env) }
          : {}),
        stateHash: result.stateHash,
      };
    },

    readDashboard(kind) {
      return params.db ? readDashboard(params.db, kind) : undefined;
    },
  };
}
