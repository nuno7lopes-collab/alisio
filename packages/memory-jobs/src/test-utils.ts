import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AlisioConfig } from "alisio/plugin-sdk/config-runtime";
import type { CanonicalMemoryStoreStatus } from "alisio/plugin-sdk/memory-core-engine-runtime";
import {
  createGaiaSleepWriteFacade,
  resolveGaiaSleepStatus,
  type GaiaSleepRuntime,
  type GaiaSleepWriteFacade,
} from "./gaia.js";
import { openSqliteDatabase } from "./sqlite.js";

type MemoryJobTestRuntime = GaiaSleepRuntime & {
  env: NodeJS.ProcessEnv;
};

export async function withMemoryJobDb<T>(
  run: (params: {
    db: DatabaseSync;
    dbPath: string;
    workspaceDir: string;
    stateDir: string;
    nowMs: number;
    gaia: GaiaSleepWriteFacade;
    runtime: MemoryJobTestRuntime;
    status: CanonicalMemoryStoreStatus;
  }) => Promise<T> | T,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-memory-jobs-"));
  const stateDir = path.join(root, "state");
  const workspaceDir = path.join(root, "workspace");
  const agentId = "main";
  const backend = "builtin" as const;
  await fs.mkdir(path.join(stateDir, "alisio"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "alisio", "state.json"),
    JSON.stringify(
      {
        account: {
          profile: {
            username: "nuno",
            displayName: "Nuno Lopes",
            email: "nuno@example.com",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const env = {
    ...process.env,
    ALISIO_STATE_DIR: stateDir,
  };
  const cfg = {
    agents: {
      defaults: {
        workspace: workspaceDir,
      },
    },
  } as AlisioConfig;
  const runtime: MemoryJobTestRuntime = {
    cfg,
    agentId,
    workspaceDir,
    backend,
    env,
  };
  const status = resolveGaiaSleepStatus(runtime);
  const db = openSqliteDatabase(status.path);
  const gaia = createGaiaSleepWriteFacade({
    ...runtime,
    db,
  });
  await gaia.ensureReady();
  const nowMs = Date.now();
  try {
    return await run({
      db,
      dbPath: status.path,
      workspaceDir,
      stateDir,
      nowMs,
      gaia,
      runtime,
      status,
    });
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
