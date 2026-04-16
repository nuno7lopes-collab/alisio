import path from "node:path";
import {
  loadWorkspaceBootstrapSnapshot,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

type BootstrapCacheEntry = {
  sessionKey: string;
  fingerprint: string;
  files: WorkspaceBootstrapFile[];
};

const cache = new Map<string, BootstrapCacheEntry>();

function resolveBootstrapCacheKey(workspaceDir: string, sessionKey: string): string {
  return `${path.resolve(workspaceDir)}\x00${sessionKey}`;
}

export async function getOrLoadBootstrapFiles(params: {
  workspaceDir: string;
  sessionKey: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const cacheKey = resolveBootstrapCacheKey(params.workspaceDir, params.sessionKey);
  const snapshot = await loadWorkspaceBootstrapSnapshot(params.workspaceDir);
  const existing = cache.get(cacheKey);
  if (existing?.fingerprint === snapshot.fingerprint) {
    return existing.files;
  }

  cache.set(cacheKey, {
    sessionKey: params.sessionKey,
    fingerprint: snapshot.fingerprint,
    files: snapshot.files,
  });
  return snapshot.files;
}

export function clearBootstrapSnapshot(sessionKey: string): void {
  for (const [cacheKey, entry] of cache.entries()) {
    if (entry.sessionKey === sessionKey) {
      cache.delete(cacheKey);
    }
  }
}

export function clearBootstrapSnapshotOnSessionRollover(params: {
  sessionKey?: string;
  previousSessionId?: string;
}): void {
  if (!params.sessionKey || !params.previousSessionId) {
    return;
  }

  clearBootstrapSnapshot(params.sessionKey);
}

export function clearAllBootstrapSnapshots(): void {
  cache.clear();
}
