import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ensureCanonicalMemorySchemaForTests } from "./canonical.js";
import { createGaiaSleepWriteFacade, type GaiaSleepWriteFacade } from "./gaia.js";
import { openSqliteDatabase } from "./sqlite.js";

export async function withMemoryJobDb<T>(
  run: (params: {
    db: DatabaseSync;
    dbPath: string;
    workspaceDir: string;
    nowMs: number;
    gaia: GaiaSleepWriteFacade;
  }) => Promise<T> | T,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-memory-jobs-"));
  const workspaceDir = path.join(root, "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });
  const dbPath = path.join(root, "canonical.sqlite");
  const db = openSqliteDatabase(dbPath);
  ensureCanonicalMemorySchemaForTests(db);
  const gaia = createGaiaSleepWriteFacade({ db });
  gaia.ensureReady();
  const nowMs = Date.now();
  try {
    return await run({ db, dbPath, workspaceDir, nowMs, gaia });
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
