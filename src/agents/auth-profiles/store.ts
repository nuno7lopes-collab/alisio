import fs from "node:fs";
import { withFileLock } from "../../infra/file-lock.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import {
  AUTH_STORE_LOCK_OPTIONS,
  AUTH_STORE_VERSION,
  EXTERNAL_CLI_SYNC_TTL_MS,
  log,
} from "./constants.js";
import { syncExternalCliCredentials } from "./external-cli-sync.js";
import { ensureAuthStoreFile, resolveAuthStorePath } from "./paths.js";
import type {
  ApiKeyCredential,
  AuthProfileCredential,
  AuthProfileStore,
  OAuthCredential,
  ProfileUsageStats,
  TokenCredential,
} from "./types.js";

type CredentialRejectReason = "non_object" | "invalid_shape" | "invalid_type" | "missing_provider";
type RejectedCredentialEntry = { key: string; reason: CredentialRejectReason };
type LoadAuthProfileStoreOptions = {
  allowKeychainPrompt?: boolean;
  readOnly?: boolean;
};

const AUTH_PROFILE_TYPES = new Set<AuthProfileCredential["type"]>(["api_key", "oauth", "token"]);
const API_KEY_FIELDS = ["key", "keyRef", "email", "displayName", "metadata"] as const;
const TOKEN_FIELDS = ["token", "tokenRef", "expires", "email", "displayName"] as const;
const OAUTH_OPTIONAL_FIELDS = [
  "clientId",
  "email",
  "displayName",
  "enterpriseUrl",
  "projectId",
  "accountId",
] as const;

const runtimeAuthStoreSnapshots = new Map<string, AuthProfileStore>();
const loadedAuthStoreCache = new Map<
  string,
  { mtimeMs: number | null; syncedAtMs: number; store: AuthProfileStore }
>();

function resolveRuntimeStoreKey(agentDir?: string): string {
  return resolveAuthStorePath(agentDir);
}

function cloneAuthProfileStore(store: AuthProfileStore): AuthProfileStore {
  return structuredClone(store);
}

function resolveRuntimeAuthProfileStore(agentDir?: string): AuthProfileStore | null {
  if (runtimeAuthStoreSnapshots.size === 0) {
    return null;
  }

  const mainKey = resolveRuntimeStoreKey(undefined);
  const requestedKey = resolveRuntimeStoreKey(agentDir);
  const mainStore = runtimeAuthStoreSnapshots.get(mainKey);
  const requestedStore = runtimeAuthStoreSnapshots.get(requestedKey);

  if (!agentDir || requestedKey === mainKey) {
    if (!mainStore) {
      return null;
    }
    return cloneAuthProfileStore(mainStore);
  }

  if (mainStore && requestedStore) {
    return mergeAuthProfileStores(
      cloneAuthProfileStore(mainStore),
      cloneAuthProfileStore(requestedStore),
    );
  }
  if (requestedStore) {
    return cloneAuthProfileStore(requestedStore);
  }
  if (mainStore) {
    return cloneAuthProfileStore(mainStore);
  }

  return null;
}

export function replaceRuntimeAuthProfileStoreSnapshots(
  entries: Array<{ agentDir?: string; store: AuthProfileStore }>,
): void {
  runtimeAuthStoreSnapshots.clear();
  for (const entry of entries) {
    runtimeAuthStoreSnapshots.set(
      resolveRuntimeStoreKey(entry.agentDir),
      cloneAuthProfileStore(entry.store),
    );
  }
}

export function updateRuntimeAuthProfileStoreSnapshot(params: {
  agentDir?: string;
  updater: (store: AuthProfileStore) => void;
}): AuthProfileStore {
  const runtimeKey = resolveRuntimeStoreKey(params.agentDir);
  const baseStore =
    runtimeAuthStoreSnapshots.get(runtimeKey) ??
    loadAuthProfileStoreForAgent(params.agentDir, {
      readOnly: true,
      allowKeychainPrompt: false,
    });
  const nextStore = cloneAuthProfileStore(baseStore);
  params.updater(nextStore);
  runtimeAuthStoreSnapshots.set(runtimeKey, nextStore);
  return cloneAuthProfileStore(nextStore);
}

export function clearRuntimeAuthProfileStoreSnapshots(): void {
  runtimeAuthStoreSnapshots.clear();
  loadedAuthStoreCache.clear();
}

function readAuthStoreMtimeMs(authPath: string): number | null {
  try {
    return fs.statSync(authPath).mtimeMs;
  } catch {
    return null;
  }
}

function readCachedAuthProfileStore(
  authPath: string,
  mtimeMs: number | null,
): AuthProfileStore | null {
  const cached = loadedAuthStoreCache.get(authPath);
  if (!cached || cached.mtimeMs !== mtimeMs) {
    return null;
  }
  if (Date.now() - cached.syncedAtMs >= EXTERNAL_CLI_SYNC_TTL_MS) {
    return null;
  }
  return cloneAuthProfileStore(cached.store);
}

function writeCachedAuthProfileStore(
  authPath: string,
  mtimeMs: number | null,
  store: AuthProfileStore,
): void {
  loadedAuthStoreCache.set(authPath, {
    mtimeMs,
    syncedAtMs: Date.now(),
    store: cloneAuthProfileStore(store),
  });
}

export async function updateAuthProfileStoreWithLock(params: {
  agentDir?: string;
  updater: (store: AuthProfileStore) => boolean;
}): Promise<AuthProfileStore | null> {
  const authPath = resolveAuthStorePath(params.agentDir);
  ensureAuthStoreFile(authPath);

  try {
    return await withFileLock(authPath, AUTH_STORE_LOCK_OPTIONS, async () => {
      // Locked writers must reload from disk, not from any runtime snapshot.
      // Otherwise a live gateway can overwrite fresher CLI/config-auth writes
      // with stale in-memory auth state during usage/cooldown updates.
      const store = loadAuthProfileStoreForAgent(params.agentDir);
      const shouldSave = params.updater(store);
      if (shouldSave) {
        saveAuthProfileStore(store, params.agentDir);
      }
      return store;
    });
  } catch {
    return null;
  }
}

function pickCredentialFields<T extends object>(
  raw: Record<string, unknown>,
  fields: readonly string[],
): Partial<T> {
  const entries = fields.flatMap((field) =>
    raw[field] !== undefined ? [[field, raw[field]]] : [],
  );
  return Object.fromEntries(entries) as Partial<T>;
}

function parseCredentialEntry(
  raw: unknown,
): { ok: true; credential: AuthProfileCredential } | { ok: false; reason: CredentialRejectReason } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "non_object" };
  }
  const record = raw as Record<string, unknown>;
  const type = record["type"];
  if (!AUTH_PROFILE_TYPES.has(type as AuthProfileCredential["type"])) {
    return { ok: false, reason: "invalid_type" };
  }
  const provider = record["provider"];
  if (typeof provider !== "string" || provider.trim().length === 0) {
    return { ok: false, reason: "missing_provider" };
  }
  const normalizedProvider = provider.trim();
  if (type === "api_key") {
    return {
      ok: true,
      credential: {
        type,
        provider: normalizedProvider,
        ...pickCredentialFields<ApiKeyCredential>(record, API_KEY_FIELDS),
      },
    };
  }
  if (type === "token") {
    return {
      ok: true,
      credential: {
        type,
        provider: normalizedProvider,
        ...pickCredentialFields<TokenCredential>(record, TOKEN_FIELDS),
      },
    };
  }
  const access = typeof record["access"] === "string" ? record["access"].trim() : "";
  const refresh = typeof record["refresh"] === "string" ? record["refresh"].trim() : "";
  const expires = record["expires"];
  if (!access || !refresh || typeof expires !== "number" || !Number.isFinite(expires)) {
    return { ok: false, reason: "invalid_shape" };
  }
  return {
    ok: true,
    credential: {
      type: "oauth",
      provider: normalizedProvider,
      access,
      refresh,
      expires,
      ...pickCredentialFields<OAuthCredential>(record, OAUTH_OPTIONAL_FIELDS),
    },
  };
}

function warnRejectedCredentialEntries(source: string, rejected: RejectedCredentialEntry[]): void {
  if (rejected.length === 0) {
    return;
  }
  const reasons = rejected.reduce(
    (acc, current) => {
      acc[current.reason] = (acc[current.reason] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<CredentialRejectReason, number>>,
  );
  log.warn("ignored invalid auth profile entries during store load", {
    source,
    dropped: rejected.length,
    reasons,
    keys: rejected.slice(0, 10).map((entry) => entry.key),
  });
}

function coerceAuthStore(raw: unknown): AuthProfileStore | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!record.profiles || typeof record.profiles !== "object") {
    return null;
  }
  const profiles = record.profiles as Record<string, unknown>;
  const normalized: Record<string, AuthProfileCredential> = {};
  const rejected: RejectedCredentialEntry[] = [];
  for (const [key, value] of Object.entries(profiles)) {
    const parsed = parseCredentialEntry(value);
    if (!parsed.ok) {
      rejected.push({ key, reason: parsed.reason });
      continue;
    }
    normalized[key] = parsed.credential;
  }
  warnRejectedCredentialEntries("auth-profiles.json", rejected);
  const order =
    record.order && typeof record.order === "object"
      ? Object.entries(record.order as Record<string, unknown>).reduce(
          (acc, [provider, value]) => {
            if (!Array.isArray(value)) {
              return acc;
            }
            const list = value
              .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
              .filter(Boolean);
            if (list.length === 0) {
              return acc;
            }
            acc[provider] = list;
            return acc;
          },
          {} as Record<string, string[]>,
        )
      : undefined;
  return {
    version: Number(record.version ?? AUTH_STORE_VERSION),
    profiles: normalized,
    order,
    lastGood:
      record.lastGood && typeof record.lastGood === "object"
        ? (record.lastGood as Record<string, string>)
        : undefined,
    usageStats:
      record.usageStats && typeof record.usageStats === "object"
        ? (record.usageStats as Record<string, ProfileUsageStats>)
        : undefined,
  };
}

function mergeRecord<T>(
  base?: Record<string, T>,
  override?: Record<string, T>,
): Record<string, T> | undefined {
  if (!base && !override) {
    return undefined;
  }
  if (!base) {
    return { ...override };
  }
  if (!override) {
    return { ...base };
  }
  return { ...base, ...override };
}

function mergeAuthProfileStores(
  base: AuthProfileStore,
  override: AuthProfileStore,
): AuthProfileStore {
  if (
    Object.keys(override.profiles).length === 0 &&
    !override.order &&
    !override.lastGood &&
    !override.usageStats
  ) {
    return base;
  }
  return {
    version: Math.max(base.version, override.version ?? base.version),
    profiles: { ...base.profiles, ...override.profiles },
    order: mergeRecord(base.order, override.order),
    lastGood: mergeRecord(base.lastGood, override.lastGood),
    usageStats: mergeRecord(base.usageStats, override.usageStats),
  };
}

function loadCoercedStore(authPath: string): AuthProfileStore | null {
  const raw = loadJsonFile(authPath);
  return coerceAuthStore(raw);
}

function shouldLogAuthStoreTiming(): boolean {
  return process.env.ALISIO_DEBUG_INGRESS_TIMING === "1";
}

function shouldSyncExternalCliCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALISIO_DISABLE_EXTERNAL_CLI_SYNC !== "1";
}

function syncExternalCliCredentialsTimed(
  store: AuthProfileStore,
  options?: Parameters<typeof syncExternalCliCredentials>[1],
): boolean {
  if (!shouldSyncExternalCliCredentials()) {
    return false;
  }
  if (!shouldLogAuthStoreTiming()) {
    return syncExternalCliCredentials(store, options);
  }
  const startMs = Date.now();
  const mutated = syncExternalCliCredentials(store, options);
  log.info(
    `auth-store stage=external-cli-sync elapsedMs=${Date.now() - startMs} mutated=${mutated}`,
  );
  return mutated;
}

export function loadAuthProfileStore(): AuthProfileStore {
  const authPath = resolveAuthStorePath();
  const asStore = loadCoercedStore(authPath);
  if (asStore) {
    // Sync from external CLI tools on every load.
    const synced = syncExternalCliCredentialsTimed(asStore);
    if (synced) {
      saveJsonFile(authPath, asStore);
    }
    return asStore;
  }

  const store: AuthProfileStore = { version: AUTH_STORE_VERSION, profiles: {} };
  syncExternalCliCredentialsTimed(store);
  return store;
}

function loadAuthProfileStoreForAgent(
  agentDir?: string,
  options?: LoadAuthProfileStoreOptions,
): AuthProfileStore {
  const readOnly = options?.readOnly === true;
  const authPath = resolveAuthStorePath(agentDir);
  if (!readOnly) {
    const cached = readCachedAuthProfileStore(authPath, readAuthStoreMtimeMs(authPath));
    if (cached) {
      return cached;
    }
  }
  const asStore = loadCoercedStore(authPath);
  if (asStore) {
    // Runtime secret activation must remain read-only:
    // sync external CLI credentials in-memory, but never persist while readOnly.
    const synced = syncExternalCliCredentialsTimed(asStore, {
      log: !readOnly,
      allowKeychainPrompt: options?.allowKeychainPrompt,
    });
    if (synced && !readOnly) {
      saveJsonFile(authPath, asStore);
    }
    if (!readOnly) {
      writeCachedAuthProfileStore(authPath, readAuthStoreMtimeMs(authPath), asStore);
    }
    return asStore;
  }

  // Fallback: inherit auth-profiles from main agent if subagent has none
  if (agentDir && !readOnly) {
    const mainAuthPath = resolveAuthStorePath(); // without agentDir = main
    const mainRaw = loadJsonFile(mainAuthPath);
    const mainStore = coerceAuthStore(mainRaw);
    if (mainStore && Object.keys(mainStore.profiles).length > 0) {
      // Clone main store to subagent directory for auth inheritance
      saveJsonFile(authPath, mainStore);
      log.info("inherited auth-profiles from main agent", { agentDir });
      writeCachedAuthProfileStore(authPath, readAuthStoreMtimeMs(authPath), mainStore);
      return mainStore;
    }
  }

  const store: AuthProfileStore = {
    version: AUTH_STORE_VERSION,
    profiles: {},
  };
  // Keep external CLI credentials visible in runtime even during read-only loads.
  const syncedCli = syncExternalCliCredentialsTimed(store, {
    log: !readOnly,
    allowKeychainPrompt: options?.allowKeychainPrompt,
  });
  const forceReadOnly = process.env.ALISIO_AUTH_STORE_READONLY === "1";
  const shouldWrite = !readOnly && !forceReadOnly && syncedCli;
  if (shouldWrite) {
    saveJsonFile(authPath, store);
  }

  if (!readOnly) {
    writeCachedAuthProfileStore(authPath, readAuthStoreMtimeMs(authPath), store);
  }
  return store;
}

export function loadAuthProfileStoreForRuntime(
  agentDir?: string,
  options?: LoadAuthProfileStoreOptions,
): AuthProfileStore {
  const store = loadAuthProfileStoreForAgent(agentDir, options);
  const authPath = resolveAuthStorePath(agentDir);
  const mainAuthPath = resolveAuthStorePath();
  if (!agentDir || authPath === mainAuthPath) {
    return store;
  }

  const mainStore = loadAuthProfileStoreForAgent(undefined, options);
  return mergeAuthProfileStores(mainStore, store);
}

export function loadAuthProfileStoreForSecretsRuntime(agentDir?: string): AuthProfileStore {
  return loadAuthProfileStoreForRuntime(agentDir, { readOnly: true, allowKeychainPrompt: false });
}

export function ensureAuthProfileStore(
  agentDir?: string,
  options?: { allowKeychainPrompt?: boolean },
): AuthProfileStore {
  const runtimeStore = resolveRuntimeAuthProfileStore(agentDir);
  if (runtimeStore) {
    return runtimeStore;
  }

  const store = loadAuthProfileStoreForAgent(agentDir, options);
  const authPath = resolveAuthStorePath(agentDir);
  const mainAuthPath = resolveAuthStorePath();
  if (!agentDir || authPath === mainAuthPath) {
    return store;
  }

  const mainStore = loadAuthProfileStoreForAgent(undefined, options);
  const merged = mergeAuthProfileStores(mainStore, store);

  return merged;
}

export function saveAuthProfileStore(store: AuthProfileStore, agentDir?: string): void {
  const authPath = resolveAuthStorePath(agentDir);
  const runtimeKey = resolveRuntimeStoreKey(agentDir);
  const profiles = Object.fromEntries(
    Object.entries(store.profiles).map(([profileId, credential]) => {
      if (credential.type === "api_key" && credential.keyRef && credential.key !== undefined) {
        const sanitized = { ...credential } as Record<string, unknown>;
        delete sanitized.key;
        return [profileId, sanitized];
      }
      if (credential.type === "token" && credential.tokenRef && credential.token !== undefined) {
        const sanitized = { ...credential } as Record<string, unknown>;
        delete sanitized.token;
        return [profileId, sanitized];
      }
      return [profileId, credential];
    }),
  ) as AuthProfileStore["profiles"];
  const payload = {
    version: AUTH_STORE_VERSION,
    profiles,
    order: store.order ?? undefined,
    lastGood: store.lastGood ?? undefined,
    usageStats: store.usageStats ?? undefined,
  } satisfies AuthProfileStore;
  saveJsonFile(authPath, payload);
  writeCachedAuthProfileStore(authPath, readAuthStoreMtimeMs(authPath), payload);
  if (runtimeAuthStoreSnapshots.has(runtimeKey)) {
    runtimeAuthStoreSnapshots.set(runtimeKey, cloneAuthProfileStore(payload));
  }
}
