import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export function requireNodeSqlite(): typeof import("node:sqlite") {
  const candidate = globalThis.process?.getBuiltinModule?.("node:sqlite");
  if (candidate) {
    return candidate;
  }
  throw new Error("node:sqlite is unavailable in this runtime");
}

export function openSqliteDatabase(dbPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export function withImmediateTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
