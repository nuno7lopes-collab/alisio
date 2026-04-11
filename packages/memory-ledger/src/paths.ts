import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LEDGER_DIR_MODE = 0o700;
export const LEDGER_FILE_MODE = 0o600;
export const LEDGER_FILENAME = "ledger.sqlite";
export const LEDGER_SIDECAR_SUFFIXES = ["", "-shm", "-wal"] as const;

function resolveHomeDir(env: NodeJS.ProcessEnv): string {
  const explicitHome = env.ALISIO_HOME?.trim();
  if (explicitHome) {
    return expandHomeRelativePath(explicitHome, env);
  }
  return os.homedir();
}

function expandHomeRelativePath(input: string, env: NodeJS.ProcessEnv): string {
  if (!input.startsWith("~")) {
    return path.resolve(input);
  }
  const home = env.HOME?.trim() || os.homedir();
  if (input === "~") {
    return home;
  }
  return path.join(home, input.slice(2));
}

export function resolveLedgerStateDir(
  env: NodeJS.ProcessEnv = process.env,
  explicitStateDir?: string,
): string {
  const override = explicitStateDir?.trim() || env.ALISIO_STATE_DIR?.trim();
  if (override) {
    return expandHomeRelativePath(override, env);
  }
  return path.join(resolveHomeDir(env), ".alisio");
}

export function resolveLedgerSqlitePath(params: {
  profileId: string;
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  dbPath?: string;
}): string {
  if (params.dbPath?.trim()) {
    return path.resolve(params.dbPath);
  }
  const stateDir = resolveLedgerStateDir(params.env, params.stateDir);
  return path.join(stateDir, "state", params.profileId, "memory", LEDGER_FILENAME);
}

export function ensureLedgerFilesystem(pathname: string): void {
  const directory = path.dirname(pathname);
  fs.mkdirSync(directory, { recursive: true, mode: LEDGER_DIR_MODE });
  fs.chmodSync(directory, LEDGER_DIR_MODE);
  for (const suffix of LEDGER_SIDECAR_SUFFIXES) {
    const candidate = `${pathname}${suffix}`;
    if (!fs.existsSync(candidate)) {
      continue;
    }
    fs.chmodSync(candidate, LEDGER_FILE_MODE);
  }
}
