import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  createSubsystemLogger,
  loadOrCreateDeviceIdentity,
  resolveAlisioCanonicalMemoryStorePath,
  resolveAlisioMemoryOwnerProfile,
  resolveStateDir,
  type AlisioMemoryOwnerProfile,
  type AlisioConfig,
} from "alisio/plugin-sdk/memory-core-host-engine-foundation";
import {
  buildFileEntry,
  ensureDir,
  hashText,
  listMemoryFiles,
  requireNodeSqlite,
  runWithConcurrency,
  type MemoryFileEntry,
} from "alisio/plugin-sdk/memory-core-host-engine-storage";
import {
  applyEventToDerivedState,
  captureMemoryStateCheckpoint,
  computeMemoryStateHash,
  createDocStateFromMarkdown,
  createDocUpdateForMarkdown,
  ensureMemoryStateSchema,
  readMarkdownFromDocState,
  readMemoryStateMeta,
  rebuildDerivedStateFromEvents,
  restoreMemoryStateCheckpoint,
  sortMemoryStateEvents,
  writeMemoryStateMeta,
  type MemoryPageLink,
  type MemoryStateCheckpointSnapshot,
  type MemoryStateEventDraft,
  type MemoryStateEventEnvelopePlain,
} from "alisio/plugin-sdk/memory-core-state";

const log = createSubsystemLogger("memory/canonical");

type CanonicalStoreBackend = "builtin" | "qmd";
type CanonicalProjectionSource = "workspace-memory";
type CanonicalRelationType = string;
type CanonicalRelationDirection = "incoming" | "outgoing";
type CanonicalStoreStatusState = "pending-sync" | "ready";
type CanonicalStoreSyncMode = "local-first";
type CanonicalCloudSyncState = "unavailable" | "enabled" | "error";

const CANONICAL_STORE_SYNC_MODE: CanonicalStoreSyncMode = "local-first";
const CANONICAL_STORE_CLOUD_SYNC: CanonicalCloudSyncState = "unavailable";
const LEGACY_PROJECTION_PREFIX = "legacy-markdown:";
const LEDGER_EVENT_SCHEMA_VERSION = 1 as const;
const DERIVED_STATE_MIGRATION_VERSION = 1;
const CHECKPOINT_EVENT_INTERVAL = 50;

type ParsedFrontmatter = {
  raw?: string;
  body: string;
  aliases: string[];
  tags: string[];
  title?: string;
};

type ParsedMemoryReference = {
  relationType: CanonicalRelationType;
  ordinal: number;
  targetKey: string;
};

type CanonicalImportedPage = {
  pageId: string;
  title: string;
  slug: string;
  aliases: string[];
  tags: string[];
  relativePath: string;
  markdown: string;
  references: ParsedMemoryReference[];
  updatedAtMs: number;
  contentHash: string;
};

type ImportedFileRow = {
  source_path: string;
  content_hash: string;
  page_id: string;
  updated_at_ms: number;
};

type LegacyEntityRow = {
  entity_id: string;
  title: string;
  slug: string;
  source_path: string;
  metadata: string;
};

type LegacyRelationRow = {
  from_entity_id: string;
  to_entity_id: string | null;
  target_locator: string | null;
  relation_type: string;
  ordinal: number;
};

type LegacyProjectionRow = {
  entity_id: string;
  relative_path: string;
  frontmatter_json: string;
  markdown_body: string;
};

type CanonicalStoreFeatureFlags = {
  ledgerEnabled: boolean;
  legacyMarkdownProjectionEnabled: boolean;
  crdtPagesEnabled: boolean;
};

type CanonicalStoreSyncRow = {
  last_synced_at?: number | bigint;
  last_synced_lamport?: number | bigint;
  cloud_state?: string;
};

type CanonicalStoreContext = {
  env: NodeJS.ProcessEnv;
  baseStatus: CanonicalMemoryStoreStatus;
  ownerProfile: AlisioMemoryOwnerProfile;
  deviceId: string;
  stateDir: string;
  db: DatabaseSync;
  flags: CanonicalStoreFeatureFlags;
  backend: CanonicalStoreBackend;
  workspaceDir: string;
};

type MemorySyncEncryptedEvent = {
  eventId?: string;
  ciphertext: string;
  metadata?: Record<string, unknown>;
};

export type CanonicalMemoryStructuredProjectionInput = {
  projectionId?: string;
  relativePath: string;
  sourceKind?: CanonicalProjectionSource;
  editable?: boolean;
  frontmatter?: Record<string, unknown>;
  markdownBody?: string;
  metadata?: Record<string, unknown>;
};

export type CanonicalMemoryStructuredRelationInput = {
  relationType: CanonicalRelationType;
  targetEntityId?: string;
  targetAlias?: string;
  targetLocator?: string;
  ordinal?: number;
  metadata?: Record<string, unknown>;
};

export type CanonicalMemoryStructuredEntityInput = {
  entityId?: string;
  kind?: string;
  slug?: string;
  title: string;
  aliases?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  projections: CanonicalMemoryStructuredProjectionInput[];
  relations?: CanonicalMemoryStructuredRelationInput[];
};

export type CanonicalMemoryStoreStatus = {
  state: CanonicalStoreStatusState;
  path: string;
  profileId: string;
  profileSource: AlisioMemoryOwnerProfile["source"];
  displayName?: string;
  workspaceScope: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  entities: number;
  relations: number;
  projections: number;
  projectionInterface: "markdown-vault";
  syncMode: CanonicalStoreSyncMode;
  cloudSync: CanonicalCloudSyncState;
  projectionSources: CanonicalProjectionSource[];
  ledgerEventsCount: number;
  lastSyncedLamport: number;
  checkpointsCount: number;
  e2eeRequired: true;
  lastSyncedAt?: string;
  lastError?: string;
  replica?: {
    deviceId: string;
    stateDir: string;
  };
};

export type CanonicalMemoryGraphProjection = {
  projectionId: string;
  path: string;
  sourceKind: CanonicalProjectionSource;
  editable: boolean;
};

export type CanonicalMemoryGraphRelation = {
  direction: CanonicalRelationDirection;
  relationType: CanonicalRelationType;
  ordinal: number;
  metadata: Record<string, unknown>;
  relatedEntity?: {
    entityId: string;
    title: string;
    slug: string;
    sourcePath: string;
    sourceKind: CanonicalProjectionSource;
  };
};

export type CanonicalMemoryGraphMatch = {
  entityId: string;
  title: string;
  slug: string;
  sourcePath: string;
  sourceKind: CanonicalProjectionSource;
  aliases: string[];
  tags: string[];
  score: number;
  projections: CanonicalMemoryGraphProjection[];
  relations: CanonicalMemoryGraphRelation[];
};

export type CanonicalMemoryGraphResult = {
  query: string;
  profileId: string;
  workspaceScope: string;
  storePath: string;
  backend: CanonicalStoreBackend;
  state: CanonicalStoreStatusState;
  projectionInterface: "markdown-vault";
  syncMode: CanonicalStoreSyncMode;
  cloudSync: CanonicalCloudSyncState;
  lastSyncedLamport: number;
  e2eeRequired: true;
  lastSyncedAt?: string;
  lastError?: string;
  matches: CanonicalMemoryGraphMatch[];
};

export type MemoryWriteEventResult = {
  status: CanonicalMemoryStoreStatus;
  events: MemoryStateEventEnvelopePlain[];
  stateHash: string;
};

export type MemoryPullApplySyncResult = {
  status: CanonicalMemoryStoreStatus;
  appliedCount: number;
  stateHash: string;
};

function normalizeNumber(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return typeof value === "number" ? value : 0;
}

function normalizePosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeReferenceKey(value: string): string {
  return normalizePosixPath(value)
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\.md$/i, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function normalizeDisplayPath(value: string): string {
  const normalized = normalizePosixPath(value)
    .trim()
    .replace(/^\.?\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (
    !normalized ||
    normalized.startsWith("../") ||
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("canonical projection path must stay within the configured roots");
  }
  return segments.join("/");
}

function normalizeSlug(value: string): string {
  const cleaned = normalizeReferenceKey(value);
  if (cleaned) {
    return cleaned;
  }
  return hashText(`slug:${value}`).slice(0, 16);
}

function extractFrontmatter(markdown: string): ParsedFrontmatter {
  if (!markdown.startsWith("---\n")) {
    return {
      body: markdown,
      aliases: [],
      tags: [],
    };
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) {
    return {
      body: markdown,
      aliases: [],
      tags: [],
    };
  }
  const raw = markdown.slice(4, end);
  const body = markdown.slice(end + 5);
  return {
    raw,
    body,
    aliases: extractYamlList(raw, "aliases"),
    tags: extractYamlList(raw, "tags"),
    title: extractYamlScalar(raw, "title"),
  };
}

function extractYamlScalar(frontmatter: string, key: string): string | undefined {
  const lines = frontmatter.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`^${key}:\\s*(.+)$`));
    if (!match?.[1]) {
      continue;
    }
    const value = match[1].trim().replace(/^['"]|['"]$/g, "");
    return value || undefined;
  }
  return undefined;
}

function extractYamlList(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith(`${key}:`)) {
      continue;
    }
    const inline = line.slice(key.length + 1).trim();
    if (inline.startsWith("[") && inline.endsWith("]")) {
      return inline
        .slice(1, -1)
        .split(",")
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j];
      if (!candidate.startsWith("  - ") && !candidate.startsWith("\t- ")) {
        break;
      }
      const value = candidate
        .replace(/^\s*-\s+/, "")
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (value) {
        out.push(value);
      }
    }
    break;
  }
  return out;
}

function parseEditableFrontmatterObject(raw?: string): Record<string, unknown> {
  if (!raw?.trim()) {
    return {};
  }
  const out: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim() || /^\s/.test(line)) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9._-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, inlineValue] = match;
    if (inlineValue.startsWith("[") && inlineValue.endsWith("]")) {
      out[key] = inlineValue
        .slice(1, -1)
        .split(",")
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      continue;
    }
    if (inlineValue) {
      out[key] = inlineValue.trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return out;
}

function serializeYamlScalar(value: string | number | boolean): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (/^[A-Za-z0-9._/@-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function appendYamlField(lines: string[], key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    const entries = value
      .filter(
        (entry): entry is string | number | boolean =>
          typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean",
      )
      .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
      .filter((entry) => entry !== "");
    if (entries.length === 0) {
      return;
    }
    lines.push(`${key}:`);
    for (const entry of entries) {
      lines.push(`  - ${serializeYamlScalar(entry)}`);
    }
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    lines.push(`${key}: ${serializeYamlScalar(value)}`);
  }
}

function extractTitle(params: {
  parsedFrontmatter: ParsedFrontmatter;
  markdown: string;
  absolutePath: string;
}): string {
  const explicitTitle = params.parsedFrontmatter.title?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  const heading = params.markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }
  return path.basename(params.absolutePath, path.extname(params.absolutePath));
}

function stripAnchor(raw: string): { target: string; anchor?: string } {
  const [target, ...rest] = raw.split("#");
  const anchor = rest.length > 0 ? rest.join("#").trim() : undefined;
  return {
    target: target.trim(),
    ...(anchor ? { anchor } : {}),
  };
}

function parseWikiReferences(markdown: string): ParsedMemoryReference[] {
  const refs: ParsedMemoryReference[] = [];
  const matches = markdown.matchAll(/!?\[\[([^\]]+)\]\]/g);
  let ordinal = 0;
  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }
    const [targetPart] = raw.split("|", 2);
    const { target } = stripAnchor(targetPart ?? "");
    const key = normalizeReferenceKey(target);
    if (!key) {
      continue;
    }
    refs.push({
      relationType: "references",
      ordinal,
      targetKey: key,
    });
    ordinal += 1;
  }
  return refs;
}

function parseMarkdownReferences(
  markdown: string,
  currentReferencePath: string,
): ParsedMemoryReference[] {
  const refs: ParsedMemoryReference[] = [];
  const matches = markdown.matchAll(/\[[^\]]*]\(([^)]+)\)/g);
  let ordinal = 0;
  for (const match of matches) {
    const rawTarget = match[1]?.trim().replace(/^<|>$/g, "");
    if (!rawTarget) {
      continue;
    }
    if (
      rawTarget.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(rawTarget) ||
      rawTarget.startsWith("//")
    ) {
      continue;
    }
    const { target } = stripAnchor(rawTarget);
    if (!target || path.extname(target).toLowerCase() !== ".md") {
      continue;
    }
    const resolved = normalizeReferenceKey(
      path.posix.normalize(path.posix.join(path.posix.dirname(currentReferencePath), target)),
    );
    if (!resolved) {
      continue;
    }
    refs.push({
      relationType: "references",
      ordinal,
      targetKey: resolved,
    });
    ordinal += 1;
  }
  return refs;
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function parseJsonRecord(value: string | undefined | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return {};
}

function createWorkspaceScope(agentId: string, workspaceDir: string): string {
  return hashText(
    JSON.stringify({
      agentId,
      workspaceDir: path.resolve(workspaceDir),
    }),
  ).slice(0, 16);
}

function resolveLegacyProjectionKind(relativePath: string): string {
  return `${LEGACY_PROJECTION_PREFIX}${normalizeDisplayPath(relativePath)}`;
}

function parseLegacyProjectionPath(kind: string): string | null {
  if (!kind.startsWith(LEGACY_PROJECTION_PREFIX)) {
    return null;
  }
  const relativePath = kind.slice(LEGACY_PROJECTION_PREFIX.length);
  return relativePath ? normalizeDisplayPath(relativePath) : null;
}

function resolveCompatibilityProjectionRoot(env: NodeJS.ProcessEnv): string {
  return path.join(resolveStateDir(env), "workspace");
}

function resolveCompatibilityProjectionPath(env: NodeJS.ProcessEnv, relativePath: string): string {
  return path.join(resolveCompatibilityProjectionRoot(env), normalizeDisplayPath(relativePath));
}

function readFeatureFlags(cfg: AlisioConfig): CanonicalStoreFeatureFlags {
  const rawMemory = (cfg as { memory?: unknown }).memory as
    | {
        legacyMarkdownProjection?: { enabled?: boolean };
        crdt?: { pages?: { enabled?: boolean } };
        ledger?: { enabled?: boolean };
      }
    | undefined;
  return {
    legacyMarkdownProjectionEnabled: rawMemory?.legacyMarkdownProjection?.enabled ?? true,
    crdtPagesEnabled: rawMemory?.crdt?.pages?.enabled ?? true,
    ledgerEnabled: rawMemory?.ledger?.enabled ?? true,
  };
}

function canonicalStoreTelemetry(
  name: string,
  value: number,
  extra?: Record<string, unknown>,
): void {
  log.info(`canonical memory metric ${name}`, {
    metric: name,
    value,
    ...(extra ?? {}),
  });
}

function createStatusBase(params: {
  env?: NodeJS.ProcessEnv;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
}): CanonicalMemoryStoreStatus {
  const env = params.env ?? process.env;
  const profile = resolveAlisioMemoryOwnerProfile(env);
  return {
    state: "pending-sync",
    path: resolveAlisioCanonicalMemoryStorePath({ env, profileId: profile.profileId }),
    profileId: profile.profileId,
    profileSource: profile.source,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    workspaceScope: createWorkspaceScope(params.agentId, params.workspaceDir),
    workspaceDir: path.resolve(params.workspaceDir),
    backend: params.backend,
    entities: 0,
    relations: 0,
    projections: 0,
    projectionInterface: "markdown-vault",
    syncMode: CANONICAL_STORE_SYNC_MODE,
    cloudSync: CANONICAL_STORE_CLOUD_SYNC,
    projectionSources: [],
    ledgerEventsCount: 0,
    lastSyncedLamport: 0,
    checkpointsCount: 0,
    e2eeRequired: true,
  };
}

function hasTable(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = ?`,
    )
    .get(table) as
    | {
        name?: string;
      }
    | undefined;
  return row?.name === table;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  if (!hasTable(db, table)) {
    return false;
  }
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function renameLegacyProjectionTableIfNeeded(db: DatabaseSync): void {
  if (!hasTable(db, "projections")) {
    return;
  }
  if (!hasColumn(db, "projections", "projection_id")) {
    return;
  }
  if (hasTable(db, "legacy_projections_v0")) {
    return;
  }
  db.exec(`ALTER TABLE projections RENAME TO legacy_projections_v0`);
}

function ensureSyncStateColumn(db: DatabaseSync, column: string, definition: string): void {
  if (hasColumn(db, "sync_state", column)) {
    return;
  }
  db.exec(`ALTER TABLE sync_state ADD COLUMN ${column} ${definition}`);
}

function ensureCanonicalStoreSchema(db: DatabaseSync): void {
  renameLegacyProjectionTableIfNeeded(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      profile_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      display_name TEXT,
      email_hash TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS replicas (
      replica_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      workspace_scope TEXT NOT NULL,
      device_id TEXT NOT NULL,
      state_dir TEXT NOT NULL,
      last_synced_at INTEGER NOT NULL,
      sync_mode TEXT NOT NULL,
      UNIQUE(profile_id, workspace_scope, device_id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      profile_id TEXT NOT NULL,
      workspace_scope TEXT NOT NULL,
      backend TEXT NOT NULL,
      sync_mode TEXT NOT NULL,
      cloud_state TEXT NOT NULL,
      last_synced_at INTEGER NOT NULL,
      PRIMARY KEY(profile_id, workspace_scope)
    );
  `);
  ensureSyncStateColumn(db, "last_synced_lamport", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_events (
      event_id TEXT PRIMARY KEY,
      lamport INTEGER NOT NULL UNIQUE,
      actor_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page_id TEXT,
      source TEXT,
      batch_id TEXT,
      created_at_ms INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      lamport INTEGER NOT NULL,
      state_hash TEXT NOT NULL,
      snapshot_json TEXT,
      encrypted_snapshot TEXT,
      created_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_acks (
      peer_id TEXT PRIMARY KEY,
      last_acked_lamport INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS imported_files (
      source_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      page_id TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  ensureMemoryStateSchema(db);
}

function openCanonicalStore(dbPath: string): DatabaseSync {
  ensureDir(path.dirname(dbPath));
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  ensureCanonicalStoreSchema(db);
  return db;
}

function upsertCanonicalOwnerProfile(params: {
  db: DatabaseSync;
  ownerProfile: AlisioMemoryOwnerProfile;
  now: number;
}): void {
  params.db
    .prepare(
      `INSERT INTO profiles (profile_id, source, user_id, username, display_name, email_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         source = excluded.source,
         user_id = excluded.user_id,
         username = excluded.username,
         display_name = excluded.display_name,
         email_hash = excluded.email_hash,
         updated_at = excluded.updated_at`,
    )
    .run(
      params.ownerProfile.profileId,
      params.ownerProfile.source,
      params.ownerProfile.userId ?? null,
      params.ownerProfile.username ?? null,
      params.ownerProfile.displayName ?? null,
      params.ownerProfile.emailHash ?? null,
      params.now,
    );
}

function upsertCanonicalReplica(params: {
  db: DatabaseSync;
  ownerProfile: AlisioMemoryOwnerProfile;
  workspaceScope: string;
  deviceId: string;
  stateDir: string;
  now: number;
}): void {
  params.db
    .prepare(
      `INSERT INTO replicas (replica_id, profile_id, workspace_scope, device_id, state_dir, last_synced_at, sync_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, workspace_scope, device_id) DO UPDATE SET
         state_dir = excluded.state_dir,
         last_synced_at = excluded.last_synced_at,
         sync_mode = excluded.sync_mode`,
    )
    .run(
      hashText(`${params.ownerProfile.profileId}:${params.workspaceScope}:${params.deviceId}`),
      params.ownerProfile.profileId,
      params.workspaceScope,
      params.deviceId,
      params.stateDir,
      params.now,
      CANONICAL_STORE_SYNC_MODE,
    );
}

function upsertCanonicalSyncState(params: {
  db: DatabaseSync;
  profileId: string;
  workspaceScope: string;
  backend: CanonicalStoreBackend;
  now: number;
  cloudState?: CanonicalCloudSyncState;
  lastSyncedLamport?: number;
}): void {
  params.db
    .prepare(
      `INSERT INTO sync_state (
         profile_id, workspace_scope, backend, sync_mode, cloud_state, last_synced_at, last_synced_lamport
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, workspace_scope) DO UPDATE SET
         backend = excluded.backend,
         sync_mode = excluded.sync_mode,
         cloud_state = excluded.cloud_state,
         last_synced_at = excluded.last_synced_at,
         last_synced_lamport = excluded.last_synced_lamport`,
    )
    .run(
      params.profileId,
      params.workspaceScope,
      params.backend,
      CANONICAL_STORE_SYNC_MODE,
      params.cloudState ?? CANONICAL_STORE_CLOUD_SYNC,
      params.now,
      params.lastSyncedLamport ?? 0,
    );
}

function readSyncState(
  db: DatabaseSync,
  params: { profileId: string; workspaceScope: string },
): CanonicalStoreSyncRow {
  return (
    (db
      .prepare(
        `SELECT last_synced_at, last_synced_lamport, cloud_state
         FROM sync_state
         WHERE profile_id = ? AND workspace_scope = ?`,
      )
      .get(params.profileId, params.workspaceScope) as CanonicalStoreSyncRow | undefined) ?? {}
  );
}

function readScopeCounts(db: DatabaseSync) {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM pages WHERE tombstoned = 0) AS entities,
        (SELECT COUNT(*) FROM links) AS relations,
        (SELECT COUNT(*) FROM projections) AS projections,
        (SELECT COUNT(*) FROM ledger_events) AS ledger_events_count,
        (SELECT COUNT(*) FROM checkpoints) AS checkpoints_count`,
    )
    .get() as
    | {
        entities: number;
        relations: number;
        projections: number;
        ledger_events_count: number;
        checkpoints_count: number;
      }
    | undefined;
  return {
    entities: row?.entities ?? 0,
    relations: row?.relations ?? 0,
    projections: row?.projections ?? 0,
    ledgerEventsCount: row?.ledger_events_count ?? 0,
    checkpointsCount: row?.checkpoints_count ?? 0,
  };
}

function buildReadyCanonicalStoreStatus(params: {
  baseStatus: CanonicalMemoryStoreStatus;
  db: DatabaseSync;
  profileId: string;
  workspaceScope: string;
  deviceId: string;
  stateDir: string;
}): CanonicalMemoryStoreStatus {
  const counts = readScopeCounts(params.db);
  const meta = readMemoryStateMeta(params.db);
  const syncState = readSyncState(params.db, {
    profileId: params.profileId,
    workspaceScope: params.workspaceScope,
  });
  return {
    ...params.baseStatus,
    state: "ready",
    entities: counts.entities,
    relations: counts.relations,
    projections: counts.projections,
    projectionSources: counts.projections > 0 ? ["workspace-memory"] : [],
    ledgerEventsCount: counts.ledgerEventsCount,
    checkpointsCount: counts.checkpointsCount,
    lastSyncedLamport: normalizeNumber(syncState.last_synced_lamport) || meta.lastAppliedLamport,
    cloudSync:
      syncState.cloud_state === "enabled" || syncState.cloud_state === "error"
        ? (syncState.cloud_state as CanonicalCloudSyncState)
        : CANONICAL_STORE_CLOUD_SYNC,
    ...(normalizeNumber(syncState.last_synced_at) > 0
      ? { lastSyncedAt: new Date(normalizeNumber(syncState.last_synced_at)).toISOString() }
      : {}),
    replica: {
      deviceId: params.deviceId,
      stateDir: params.stateDir,
    },
  };
}

function sanitizeAliases(params: {
  title: string;
  slug: string;
  relativePath: string;
  aliases?: string[];
}): string[] {
  return uniqueStrings([
    params.slug,
    normalizeReferenceKey(params.title),
    normalizeReferenceKey(params.relativePath),
    normalizeReferenceKey(path.basename(params.relativePath, ".md")),
    ...(params.aliases ?? []).map((alias) => normalizeReferenceKey(alias)),
  ]);
}

function eventBinaryPayloadKey(eventType: string): "yjsState" | "update" | "bytes" | null {
  switch (eventType) {
    case "DOC_CRDT_SNAPSHOT":
      return "yjsState";
    case "DOC_CRDT_UPDATE":
      return "update";
    case "ATTACHMENT_ADDED":
      return "bytes";
    default:
      return null;
  }
}

function serializeLedgerEventPayload(event: MemoryStateEventEnvelopePlain): string {
  const payload = { ...event.payload } as Record<string, unknown>;
  const binaryKey = eventBinaryPayloadKey(event.type);
  if (binaryKey && payload[binaryKey] instanceof Uint8Array) {
    payload[binaryKey] = Buffer.from(payload[binaryKey] as Uint8Array).toString("base64");
  }
  return JSON.stringify(payload);
}

function deserializeLedgerEventRow(row: {
  event_id: string;
  lamport: number | bigint;
  actor_id: string;
  event_type: MemoryStateEventEnvelopePlain["type"];
  page_id: string | null;
  source: string | null;
  batch_id: string | null;
  created_at_ms: number | bigint;
  payload_json: string;
}): MemoryStateEventEnvelopePlain {
  const payload = parseJsonRecord(row.payload_json);
  const binaryKey = eventBinaryPayloadKey(row.event_type);
  if (binaryKey && typeof payload[binaryKey] === "string") {
    payload[binaryKey] = Buffer.from(String(payload[binaryKey]), "base64");
  }
  return {
    schemaVersion: LEDGER_EVENT_SCHEMA_VERSION,
    eventId: row.event_id,
    lamport: normalizeNumber(row.lamport),
    actorId: row.actor_id,
    createdAtMs: normalizeNumber(row.created_at_ms),
    type: row.event_type,
    payload: payload as never,
    ...(row.page_id ? { pageId: row.page_id } : {}),
    ...(row.source ? { source: row.source } : {}),
    ...(row.batch_id ? { batchId: row.batch_id } : {}),
  };
}

function readLedgerEvents(db: DatabaseSync, afterLamport = 0): MemoryStateEventEnvelopePlain[] {
  const rows = db
    .prepare(
      `SELECT event_id, lamport, actor_id, event_type, page_id, source, batch_id, created_at_ms, payload_json
       FROM ledger_events
       WHERE lamport > ?
       ORDER BY lamport ASC, event_id ASC`,
    )
    .all(afterLamport) as Array<{
    event_id: string;
    lamport: number | bigint;
    actor_id: string;
    event_type: MemoryStateEventEnvelopePlain["type"];
    page_id: string | null;
    source: string | null;
    batch_id: string | null;
    created_at_ms: number | bigint;
    payload_json: string;
  }>;
  return rows.map((row) => deserializeLedgerEventRow(row));
}

function readLatestLamport(db: DatabaseSync): number {
  const row = db.prepare(`SELECT MAX(lamport) AS lamport FROM ledger_events`).get() as
    | {
        lamport?: number | bigint | null;
      }
    | undefined;
  return normalizeNumber(row?.lamport);
}

function readCurrentPageMarkdown(db: DatabaseSync, pageId: string): string {
  return readMarkdownFromDocState(readCurrentPageDocState(db, pageId));
}

function readCurrentPageDocState(db: DatabaseSync, pageId: string): Uint8Array | undefined {
  const row = db
    .prepare(
      `SELECT yjs_state
       FROM page_doc_state
       WHERE page_id = ?`,
    )
    .get(pageId) as
    | {
        yjs_state: Uint8Array;
      }
    | undefined;
  return row?.yjs_state;
}

function readCurrentPageLinks(db: DatabaseSync, pageId: string): MemoryPageLink[] {
  const rows = db
    .prepare(
      `SELECT to_page_id, type, ordinal
       FROM links
       WHERE from_page_id = ?
       ORDER BY ordinal ASC, to_page_id ASC`,
    )
    .all(pageId) as Array<{
    to_page_id: string;
    type: string;
    ordinal: number;
  }>;
  return rows.map((row) => ({
    toPageId: row.to_page_id,
    type: row.type,
    ordinal: row.ordinal,
  }));
}

function readCurrentPageAliases(db: DatabaseSync, pageId: string): string[] {
  const rows = db
    .prepare(
      `SELECT alias_key
       FROM page_aliases
       WHERE page_id = ?
       ORDER BY ordinal ASC, alias_key ASC`,
    )
    .all(pageId) as Array<{
    alias_key: string;
  }>;
  return rows.map((row) => row.alias_key).filter(Boolean);
}

function readCurrentPageTags(db: DatabaseSync, pageId: string): string[] {
  const rows = db
    .prepare(
      `SELECT tag
       FROM page_tags
       WHERE page_id = ?
       ORDER BY ordinal ASC, tag ASC`,
    )
    .all(pageId) as Array<{
    tag: string;
  }>;
  return rows.map((row) => row.tag).filter(Boolean);
}

function readCurrentPageRow(
  db: DatabaseSync,
  pageId: string,
): {
  page_id: string;
  title: string;
  slug: string;
  tombstoned: number;
} | null {
  return (
    (db
      .prepare(
        `SELECT page_id, title, slug, tombstoned
         FROM pages
         WHERE page_id = ?`,
      )
      .get(pageId) as
      | {
          page_id: string;
          title: string;
          slug: string;
          tombstoned: number;
        }
      | undefined) ?? null
  );
}

function resolvePageIdForAlias(db: DatabaseSync, aliasKey: string): string | null {
  const rows = db
    .prepare(
      `SELECT page_id
       FROM page_aliases
       WHERE alias_key = ?
       ORDER BY page_id ASC`,
    )
    .all(aliasKey) as Array<{
    page_id: string;
  }>;
  if (rows.length !== 1) {
    return null;
  }
  return rows[0]?.page_id ?? null;
}

function resolvePageIdForProjectionPath(db: DatabaseSync, relativePath: string): string | null {
  const row = db
    .prepare(
      `SELECT page_id
       FROM projections
       WHERE kind = ?`,
    )
    .get(resolveLegacyProjectionKind(relativePath)) as
    | {
        page_id: string;
      }
    | undefined;
  return row?.page_id ?? null;
}

function buildLegacyPageFromFile(params: {
  entry: MemoryFileEntry;
  workspaceDir: string;
  markdown: string;
  existingPageId?: string | null;
}): CanonicalImportedPage {
  const parsedFrontmatter = extractFrontmatter(params.markdown);
  const title = extractTitle({
    parsedFrontmatter,
    markdown: parsedFrontmatter.body,
    absolutePath: params.entry.absPath,
  });
  const relativePath = normalizeDisplayPath(params.entry.path);
  const slug = normalizeSlug(
    relativePath === "MEMORY.md" ? "memory-root" : normalizeReferenceKey(relativePath),
  );
  const aliases = sanitizeAliases({
    title,
    slug,
    relativePath,
    aliases: parsedFrontmatter.aliases,
  });
  const references = [
    ...parseWikiReferences(parsedFrontmatter.body),
    ...parseMarkdownReferences(parsedFrontmatter.body, relativePath),
  ];
  return {
    pageId:
      params.existingPageId?.trim() ||
      hashText(`page:${normalizeReferenceKey(relativePath) || relativePath}`),
    title,
    slug,
    aliases,
    tags: uniqueStrings(parsedFrontmatter.tags),
    relativePath,
    markdown: params.markdown,
    references,
    updatedAtMs: params.entry.mtimeMs,
    contentHash: params.entry.hash,
  };
}

async function collectWorkspaceMarkdownPages(params: {
  workspaceDir: string;
  importedPageIdByPath: ReadonlyMap<string, string>;
}): Promise<CanonicalImportedPage[]> {
  const discoveredFiles = await listMemoryFiles(params.workspaceDir);
  const entries = (
    await runWithConcurrency(
      discoveredFiles.map((file) => async () => await buildFileEntry(file, params.workspaceDir)),
      8,
    )
  ).filter((entry): entry is MemoryFileEntry => entry !== null);
  const pages = await Promise.all(
    entries.map(async (entry) => {
      const markdown = await fs.readFile(entry.absPath, "utf8");
      return buildLegacyPageFromFile({
        entry,
        workspaceDir: params.workspaceDir,
        markdown,
        existingPageId: params.importedPageIdByPath.get(normalizeDisplayPath(entry.path)),
      });
    }),
  );
  return pages.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function renderLegacyProjectionMarkdown(params: {
  frontmatterJson?: string;
  markdownBody?: string;
}): string {
  const frontmatter = parseJsonRecord(params.frontmatterJson);
  const body = params.markdownBody?.trimEnd() ?? "";
  if (Object.keys(frontmatter).length === 0) {
    return body ? `${body}\n` : "";
  }
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    appendYamlField(lines, key, value);
  }
  lines.push("---", "");
  if (body) {
    lines.push(body);
  }
  return lines.join("\n").trimEnd().concat("\n");
}

function collectLegacyCanonicalPages(db: DatabaseSync): CanonicalImportedPage[] {
  if (!hasTable(db, "entities") || !hasTable(db, "entity_aliases") || !hasTable(db, "relations")) {
    return [];
  }
  const entityRows = db
    .prepare(`SELECT entity_id, title, slug, source_path, metadata FROM entities`)
    .all() as LegacyEntityRow[];
  if (entityRows.length === 0) {
    return [];
  }
  const aliasRows = db
    .prepare(`SELECT alias_key, entity_id FROM entity_aliases ORDER BY alias_key ASC`)
    .all() as Array<{ alias_key: string; entity_id: string }>;
  const relationRows = db
    .prepare(
      `SELECT from_entity_id, to_entity_id, target_locator, relation_type, ordinal
       FROM relations
       ORDER BY from_entity_id ASC, ordinal ASC`,
    )
    .all() as LegacyRelationRow[];
  const projectionTable = hasTable(db, "legacy_projections_v0")
    ? "legacy_projections_v0"
    : hasTable(db, "projections") && hasColumn(db, "projections", "projection_id")
      ? "projections"
      : null;
  const projectionRows = projectionTable
    ? (db
        .prepare(
          `SELECT entity_id, relative_path, frontmatter_json, markdown_body
           FROM ${projectionTable}
           ORDER BY relative_path ASC`,
        )
        .all() as LegacyProjectionRow[])
    : [];
  const projectionByEntityId = new Map<string, LegacyProjectionRow[]>();
  for (const row of projectionRows) {
    const entry = projectionByEntityId.get(row.entity_id) ?? [];
    entry.push(row);
    projectionByEntityId.set(row.entity_id, entry);
  }
  const aliasByEntityId = new Map<string, string[]>();
  for (const row of aliasRows) {
    const entry = aliasByEntityId.get(row.entity_id) ?? [];
    entry.push(row.alias_key);
    aliasByEntityId.set(row.entity_id, entry);
  }
  const entityPathById = new Map(entityRows.map((row) => [row.entity_id, row.source_path]));
  const relationByEntityId = new Map<string, LegacyRelationRow[]>();
  for (const row of relationRows) {
    const entry = relationByEntityId.get(row.from_entity_id) ?? [];
    entry.push(row);
    relationByEntityId.set(row.from_entity_id, entry);
  }
  return entityRows.flatMap((entity) => {
    const projection = projectionByEntityId.get(entity.entity_id)?.[0];
    const relativePath = normalizeDisplayPath(
      projection?.relative_path?.trim() || entity.source_path || `memory/${entity.slug}.md`,
    );
    const metadata = parseJsonRecord(entity.metadata);
    const tags = Array.isArray(metadata.tags)
      ? metadata.tags.filter((value): value is string => typeof value === "string")
      : [];
    const markdown = renderLegacyProjectionMarkdown({
      frontmatterJson: projection?.frontmatter_json,
      markdownBody: projection?.markdown_body ?? `# ${entity.title}\n`,
    });
    const parsed = extractFrontmatter(markdown);
    const referencesFromMarkdown = [
      ...parseWikiReferences(parsed.body),
      ...parseMarkdownReferences(parsed.body, relativePath),
    ];
    const referencesFromRelations = (relationByEntityId.get(entity.entity_id) ?? []).map(
      (relation) => ({
        relationType: relation.relation_type || "references",
        ordinal: relation.ordinal,
        targetKey: normalizeReferenceKey(
          relation.target_locator ??
            entityPathById.get(relation.to_entity_id ?? "") ??
            relation.to_entity_id ??
            "",
        ),
      }),
    );
    return [
      {
        pageId: entity.entity_id,
        title: entity.title,
        slug: normalizeSlug(entity.slug || relativePath),
        aliases: uniqueStrings([
          ...sanitizeAliases({
            title: entity.title,
            slug: normalizeSlug(entity.slug || relativePath),
            relativePath,
            aliases: [],
          }),
          ...(aliasByEntityId.get(entity.entity_id) ?? []),
        ]),
        tags: uniqueStrings(tags),
        relativePath,
        markdown,
        references: uniqueStrings(
          [...referencesFromMarkdown, ...referencesFromRelations].map(
            (reference) => `${reference.relationType}:${reference.ordinal}:${reference.targetKey}`,
          ),
        ).map((entry) => {
          const [, ordinal, targetKey] = entry.split(":", 3);
          return {
            relationType: "references",
            ordinal: Number(ordinal) || 0,
            targetKey,
          };
        }),
        updatedAtMs: Date.now(),
        contentHash: hashText(markdown),
      },
    ];
  });
}

function mergeImportedPages(
  workspacePages: CanonicalImportedPage[],
  legacyPages: CanonicalImportedPage[],
): CanonicalImportedPage[] {
  const byPath = new Map<string, CanonicalImportedPage>();
  for (const legacyPage of legacyPages) {
    byPath.set(legacyPage.relativePath, legacyPage);
  }
  for (const workspacePage of workspacePages) {
    const existing = byPath.get(workspacePage.relativePath);
    if (!existing) {
      byPath.set(workspacePage.relativePath, workspacePage);
      continue;
    }
    byPath.set(workspacePage.relativePath, {
      ...workspacePage,
      pageId: existing.pageId,
      aliases: uniqueStrings([...existing.aliases, ...workspacePage.aliases]),
      tags: uniqueStrings([...existing.tags, ...workspacePage.tags]),
      references:
        workspacePage.references.length > 0 ? workspacePage.references : existing.references,
    });
  }
  return Array.from(byPath.values()).toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function buildReferenceLookup(params: {
  db: DatabaseSync;
  importedPages: CanonicalImportedPage[];
}): Map<string, string> {
  const lookup = new Map<string, string>();
  const currentAliasRows = params.db
    .prepare(`SELECT alias_key, page_id FROM page_aliases ORDER BY alias_key ASC`)
    .all() as Array<{ alias_key: string; page_id: string }>;
  const aliasCounts = new Map<string, Set<string>>();
  for (const row of currentAliasRows) {
    const entry = aliasCounts.get(row.alias_key) ?? new Set<string>();
    entry.add(row.page_id);
    aliasCounts.set(row.alias_key, entry);
  }
  for (const [alias, pageIds] of aliasCounts) {
    if (pageIds.size === 1) {
      lookup.set(alias, Array.from(pageIds)[0]!);
    }
  }
  for (const page of params.importedPages) {
    for (const alias of page.aliases) {
      lookup.set(alias, page.pageId);
    }
    lookup.set(normalizeReferenceKey(page.relativePath), page.pageId);
  }
  return lookup;
}

function buildPageEventDrafts(params: {
  db: DatabaseSync;
  page: CanonicalImportedPage;
  lookupByAlias: ReadonlyMap<string, string>;
  actorId: string;
  source: string;
  batchId: string;
  crdtPagesEnabled: boolean;
}): MemoryStateEventDraft[] {
  const current = readCurrentPageRow(params.db, params.page.pageId);
  const currentDocState = readCurrentPageDocState(params.db, params.page.pageId);
  const currentMarkdown = readCurrentPageMarkdown(params.db, params.page.pageId);
  const currentAliases = readCurrentPageAliases(params.db, params.page.pageId);
  const currentTags = readCurrentPageTags(params.db, params.page.pageId);
  const currentLinks = JSON.stringify(readCurrentPageLinks(params.db, params.page.pageId));
  const nextLinks: MemoryPageLink[] = [];
  for (const reference of params.page.references) {
    const toPageId = params.lookupByAlias.get(reference.targetKey);
    if (!toPageId || toPageId === params.page.pageId) {
      continue;
    }
    nextLinks.push({
      toPageId,
      type: reference.relationType,
      ordinal: reference.ordinal,
    });
  }
  const drafts: MemoryStateEventDraft[] = [];
  if (!current) {
    drafts.push({
      actorId: params.actorId,
      batchId: params.batchId,
      source: params.source,
      type: "PAGE_CREATED",
      pageId: params.page.pageId,
      payload: {
        pageId: params.page.pageId,
        title: params.page.title,
        slug: params.page.slug,
        aliases: params.page.aliases,
        tags: params.page.tags,
        createdAtMs: params.page.updatedAtMs,
        updatedAtMs: params.page.updatedAtMs,
      },
    });
  } else {
    const aliasesChanged = JSON.stringify(currentAliases) !== JSON.stringify(params.page.aliases);
    const tagsChanged = JSON.stringify(currentTags) !== JSON.stringify(params.page.tags);
    if (
      current.title !== params.page.title ||
      current.slug !== params.page.slug ||
      aliasesChanged ||
      tagsChanged ||
      current.tombstoned === 1
    ) {
      drafts.push({
        actorId: params.actorId,
        batchId: params.batchId,
        source: params.source,
        type: "PAGE_METADATA_UPDATED",
        pageId: params.page.pageId,
        payload: {
          pageId: params.page.pageId,
          title: params.page.title,
          slug: params.page.slug,
          aliases: params.page.aliases,
          tags: params.page.tags,
          updatedAtMs: params.page.updatedAtMs,
        },
      });
    }
  }
  if (currentMarkdown !== params.page.markdown) {
    drafts.push({
      actorId: params.actorId,
      batchId: params.batchId,
      source: params.source,
      type: params.crdtPagesEnabled && currentMarkdown ? "DOC_CRDT_UPDATE" : "DOC_CRDT_SNAPSHOT",
      pageId: params.page.pageId,
      payload:
        params.crdtPagesEnabled && currentDocState
          ? {
              pageId: params.page.pageId,
              update: createDocUpdateForMarkdown({
                currentState: currentDocState,
                markdown: params.page.markdown,
              }),
            }
          : {
              pageId: params.page.pageId,
              yjsState: createDocStateFromMarkdown(params.page.markdown),
            },
    });
  }
  if (currentLinks !== JSON.stringify(nextLinks)) {
    drafts.push({
      actorId: params.actorId,
      batchId: params.batchId,
      source: params.source,
      type: "LINKS_REPLACED",
      pageId: params.page.pageId,
      payload: {
        pageId: params.page.pageId,
        links: nextLinks,
      },
    });
  }
  const projectionKind = resolveLegacyProjectionKind(params.page.relativePath);
  const projectionExists = Boolean(
    params.db
      .prepare(`SELECT 1 AS found FROM projections WHERE page_id = ? AND kind = ?`)
      .get(params.page.pageId, projectionKind) as
      | {
          found?: number;
        }
      | undefined,
  );
  if (!projectionExists || currentMarkdown !== params.page.markdown) {
    drafts.push({
      actorId: params.actorId,
      batchId: params.batchId,
      source: params.source,
      type: "PROJECTION_SET",
      pageId: params.page.pageId,
      payload: {
        pageId: params.page.pageId,
        kind: projectionKind,
        markdownBody: params.page.markdown,
      },
    });
  }
  return drafts;
}

function assignLedgerEvents(params: {
  db: DatabaseSync;
  drafts: MemoryStateEventDraft[];
}): MemoryStateEventEnvelopePlain[] {
  let lamport = readLatestLamport(params.db);
  return params.drafts.map((draft, index) => {
    lamport += 1;
    return {
      schemaVersion: LEDGER_EVENT_SCHEMA_VERSION,
      eventId:
        draft.eventId ??
        hashText(
          JSON.stringify({
            lamport,
            index,
            type: draft.type,
            pageId: draft.pageId,
            source: draft.source,
            payload: draft.payload,
          }),
        ),
      lamport,
      actorId: draft.actorId,
      createdAtMs: draft.createdAtMs ?? Date.now(),
      type: draft.type,
      payload: draft.payload as never,
      ...(draft.pageId ? { pageId: draft.pageId } : {}),
      ...(draft.source ? { source: draft.source } : {}),
      ...(draft.batchId ? { batchId: draft.batchId } : {}),
    };
  });
}

function insertLedgerEvents(
  db: DatabaseSync,
  events: MemoryStateEventEnvelopePlain[],
): MemoryStateEventEnvelopePlain[] {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ledger_events (
       event_id, lamport, actor_id, event_type, page_id, source, batch_id, created_at_ms, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const inserted: MemoryStateEventEnvelopePlain[] = [];
  for (const event of events) {
    const result = insert.run(
      event.eventId,
      event.lamport,
      event.actorId,
      event.type,
      event.pageId ?? null,
      event.source ?? null,
      event.batchId ?? null,
      event.createdAtMs,
      serializeLedgerEventPayload(event),
    ) as { changes?: number };
    if ((result?.changes ?? 0) > 0) {
      inserted.push(event);
    }
  }
  return inserted;
}

function readLatestCheckpoint(
  db: DatabaseSync,
  checkpointId?: string,
): {
  checkpoint_id: string;
  lamport: number | bigint;
  snapshot_json: string | null;
} | null {
  if (checkpointId) {
    return (
      (db
        .prepare(
          `SELECT checkpoint_id, lamport, snapshot_json
           FROM checkpoints
           WHERE checkpoint_id = ?`,
        )
        .get(checkpointId) as
        | {
            checkpoint_id: string;
            lamport: number | bigint;
            snapshot_json: string | null;
          }
        | undefined) ?? null
    );
  }
  return (
    (db
      .prepare(
        `SELECT checkpoint_id, lamport, snapshot_json
         FROM checkpoints
         ORDER BY lamport DESC
         LIMIT 1`,
      )
      .get() as
      | {
          checkpoint_id: string;
          lamport: number | bigint;
          snapshot_json: string | null;
        }
      | undefined) ?? null
  );
}

function maybeRestoreCheckpoint(db: DatabaseSync): number {
  const meta = readMemoryStateMeta(db);
  const checkpoint = readLatestCheckpoint(db, meta.lastCheckpointId);
  if (!checkpoint?.snapshot_json) {
    return 0;
  }
  try {
    const snapshot = JSON.parse(checkpoint.snapshot_json) as MemoryStateCheckpointSnapshot;
    restoreMemoryStateCheckpoint(db, snapshot);
    return normalizeNumber(checkpoint.lamport);
  } catch (error) {
    log.warn(`failed to restore memory checkpoint ${checkpoint.checkpoint_id}: ${String(error)}`);
    return 0;
  }
}

function bootstrapDerivedState(db: DatabaseSync): void {
  ensureCanonicalStoreSchema(db);
  const latestLamport = readLatestLamport(db);
  const checkpointLamport = maybeRestoreCheckpoint(db);
  if (checkpointLamport > 0) {
    const tailEvents = readLedgerEvents(db, checkpointLamport);
    if (tailEvents.length > 0) {
      for (const event of tailEvents) {
        applyEventToDerivedState({
          db,
          event,
          migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
        });
      }
    }
    return;
  }
  if (latestLamport > 0) {
    rebuildDerivedStateFromEvents({
      db,
      events: readLedgerEvents(db),
      migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
    });
  } else {
    const meta = readMemoryStateMeta(db);
    writeMemoryStateMeta(db, {
      migrationVersion: Math.max(meta.migrationVersion, DERIVED_STATE_MIGRATION_VERSION),
      lastAppliedLamport: 0,
      lastCheckpointId: meta.lastCheckpointId,
    });
  }
}

function readImportedFileRows(db: DatabaseSync): Map<string, ImportedFileRow> {
  const rows = db
    .prepare(
      `SELECT source_path, content_hash, page_id, updated_at_ms
       FROM imported_files
       ORDER BY source_path ASC`,
    )
    .all() as ImportedFileRow[];
  return new Map(rows.map((row) => [row.source_path, row]));
}

function updateImportedFileRow(db: DatabaseSync, page: CanonicalImportedPage): void {
  db.prepare(
    `INSERT INTO imported_files (source_path, content_hash, page_id, updated_at_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_path) DO UPDATE SET
       content_hash = excluded.content_hash,
       page_id = excluded.page_id,
       updated_at_ms = excluded.updated_at_ms`,
  ).run(page.relativePath, page.contentHash, page.pageId, page.updatedAtMs);
}

function deleteImportedFileRow(db: DatabaseSync, relativePath: string): void {
  db.prepare(`DELETE FROM imported_files WHERE source_path = ?`).run(relativePath);
}

function createCheckpointIfNeeded(params: { db: DatabaseSync; lastAppliedLamport: number }): void {
  const latestCheckpoint = readLatestCheckpoint(params.db);
  const lastCheckpointLamport = normalizeNumber(latestCheckpoint?.lamport);
  if (params.lastAppliedLamport === 0) {
    return;
  }
  if (params.lastAppliedLamport - lastCheckpointLamport < CHECKPOINT_EVENT_INTERVAL) {
    return;
  }
  const snapshot = captureMemoryStateCheckpoint(params.db);
  const stateHash = computeMemoryStateHash(params.db);
  const checkpointId = hashText(`checkpoint:${params.lastAppliedLamport}:${stateHash}`).slice(
    0,
    24,
  );
  params.db
    .prepare(
      `INSERT OR REPLACE INTO checkpoints (
         checkpoint_id, lamport, state_hash, snapshot_json, encrypted_snapshot, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      checkpointId,
      params.lastAppliedLamport,
      stateHash,
      JSON.stringify(snapshot),
      null,
      Date.now(),
    );
  const checkpointEvent: MemoryStateEventEnvelopePlain = {
    schemaVersion: LEDGER_EVENT_SCHEMA_VERSION,
    eventId: hashText(`checkpoint-event:${checkpointId}`).slice(0, 24),
    lamport: readLatestLamport(params.db) + 1,
    actorId: "gaia-checkpoint",
    createdAtMs: Date.now(),
    type: "CHECKPOINT_CREATED",
    payload: {
      checkpointId,
      stateHash,
      encryptedSnapshot: null,
    },
    source: "checkpoint",
  };
  const inserted = insertLedgerEvents(params.db, [checkpointEvent]);
  for (const event of inserted) {
    applyEventToDerivedState({
      db: params.db,
      event,
      migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
    });
  }
  canonicalStoreTelemetry("checkpoint_created_count", 1, {
    checkpointId,
    lastAppliedLamport: params.lastAppliedLamport,
  });
}

async function materializeLegacyMarkdownProjections(params: {
  db: DatabaseSync;
  env: NodeJS.ProcessEnv;
}): Promise<number> {
  const root = resolveCompatibilityProjectionRoot(params.env);
  await fs.mkdir(root, { recursive: true });
  const rows = params.db
    .prepare(
      `SELECT page_id, kind, markdown_body
       FROM projections
       ORDER BY kind ASC`,
    )
    .all() as Array<{
    page_id: string;
    kind: string;
    markdown_body: string;
  }>;
  let written = 0;
  const expectedPaths = new Set<string>();
  for (const row of rows) {
    const relativePath = parseLegacyProjectionPath(row.kind);
    if (!relativePath) {
      continue;
    }
    const target = resolveCompatibilityProjectionPath(params.env, relativePath);
    expectedPaths.add(target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, row.markdown_body, "utf8");
    written += 1;
  }
  const compatibilityFiles = await listMemoryFiles(root);
  for (const absolutePath of compatibilityFiles) {
    if (!expectedPaths.has(absolutePath)) {
      await fs.rm(absolutePath, { force: true }).catch(() => {});
    }
  }
  canonicalStoreTelemetry("projections_written_count", written, { root });
  return written;
}

function buildImportPageIdMap(
  importedRows: ReadonlyMap<string, ImportedFileRow>,
): Map<string, string> {
  return new Map(
    Array.from(importedRows.entries()).map(([relativePath, row]) => [relativePath, row.page_id]),
  );
}

function buildReadyStatusFromContext(params: CanonicalStoreContext): CanonicalMemoryStoreStatus {
  return buildReadyCanonicalStoreStatus({
    baseStatus: params.baseStatus,
    db: params.db,
    profileId: params.ownerProfile.profileId,
    workspaceScope: params.baseStatus.workspaceScope,
    deviceId: params.deviceId,
    stateDir: params.stateDir,
  });
}

async function applyEventDrafts(params: {
  context: CanonicalStoreContext;
  drafts: MemoryStateEventDraft[];
  cloudState?: CanonicalCloudSyncState;
  materializeMarkdown?: boolean;
}): Promise<MemoryWriteEventResult> {
  const events = assignLedgerEvents({
    db: params.context.db,
    drafts: params.drafts,
  });
  if (events.length === 0) {
    const status = buildReadyStatusFromContext(params.context);
    return {
      status,
      events: [],
      stateHash: computeMemoryStateHash(params.context.db),
    };
  }
  const inserted = insertLedgerEvents(params.context.db, events);
  for (const event of inserted) {
    applyEventToDerivedState({
      db: params.context.db,
      event,
      migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
    });
  }
  const meta = readMemoryStateMeta(params.context.db);
  createCheckpointIfNeeded({
    db: params.context.db,
    lastAppliedLamport: meta.lastAppliedLamport,
  });
  upsertCanonicalSyncState({
    db: params.context.db,
    profileId: params.context.ownerProfile.profileId,
    workspaceScope: params.context.baseStatus.workspaceScope,
    backend: params.context.backend,
    now: Date.now(),
    cloudState: params.cloudState,
    lastSyncedLamport: readMemoryStateMeta(params.context.db).lastAppliedLamport,
  });
  if (
    params.materializeMarkdown !== false &&
    params.context.flags.legacyMarkdownProjectionEnabled
  ) {
    await materializeLegacyMarkdownProjections({
      db: params.context.db,
      env: params.context.env,
    });
  }
  const applyDurationMs = Math.max(
    0,
    Date.now() - Math.min(...inserted.map((event) => event.createdAtMs)),
  );
  canonicalStoreTelemetry("ledger_to_state_apply_ms", applyDurationMs, {
    events: inserted.length,
  });
  return {
    status: buildReadyStatusFromContext(params.context),
    events: inserted,
    stateHash: computeMemoryStateHash(params.context.db),
  };
}

async function migrateLegacyStateIfNeeded(params: CanonicalStoreContext): Promise<void> {
  const latestLamport = readLatestLamport(params.db);
  const meta = readMemoryStateMeta(params.db);
  if (latestLamport > 0 || meta.migrationVersion >= DERIVED_STATE_MIGRATION_VERSION) {
    return;
  }
  const startedAt = Date.now();
  const importedRows = readImportedFileRows(params.db);
  const workspacePages = await collectWorkspaceMarkdownPages({
    workspaceDir: params.workspaceDir,
    importedPageIdByPath: buildImportPageIdMap(importedRows),
  });
  const legacyPages = collectLegacyCanonicalPages(params.db);
  const mergedPages = mergeImportedPages(workspacePages, legacyPages);
  if (mergedPages.length === 0) {
    writeMemoryStateMeta(params.db, {
      migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
      lastAppliedLamport: 0,
      lastCheckpointId: meta.lastCheckpointId,
    });
    return;
  }
  const lookupByAlias = buildReferenceLookup({
    db: params.db,
    importedPages: mergedPages,
  });
  const batchId = `genesis:${hashText(JSON.stringify(mergedPages.map((page) => page.relativePath))).slice(0, 16)}`;
  const drafts = mergedPages.flatMap((page) =>
    buildPageEventDrafts({
      db: params.db,
      page,
      lookupByAlias,
      actorId: "gaia-migration",
      source: "genesis",
      batchId,
      crdtPagesEnabled: params.flags.crdtPagesEnabled,
    }),
  );
  if (drafts.length > 0) {
    await applyEventDrafts({
      context: params,
      drafts,
      materializeMarkdown: false,
    });
  }
  for (const page of workspacePages) {
    updateImportedFileRow(params.db, page);
  }
  writeMemoryStateMeta(params.db, {
    migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
    lastAppliedLamport: readMemoryStateMeta(params.db).lastAppliedLamport,
    lastCheckpointId: readMemoryStateMeta(params.db).lastCheckpointId,
  });
  canonicalStoreTelemetry("migration_duration_ms", Date.now() - startedAt, {
    pages: mergedPages.length,
  });
}

async function syncWorkspaceImports(params: CanonicalStoreContext): Promise<void> {
  const importedRows = readImportedFileRows(params.db);
  const pages = await collectWorkspaceMarkdownPages({
    workspaceDir: params.workspaceDir,
    importedPageIdByPath: buildImportPageIdMap(importedRows),
  });
  const lookupByAlias = buildReferenceLookup({
    db: params.db,
    importedPages: pages,
  });
  const batchId = `workspace:${Date.now()}`;
  const drafts = pages.flatMap((page) =>
    buildPageEventDrafts({
      db: params.db,
      page,
      lookupByAlias,
      actorId: params.deviceId,
      source: "workspace-import",
      batchId,
      crdtPagesEnabled: params.flags.crdtPagesEnabled,
    }),
  );
  if (drafts.length > 0) {
    await applyEventDrafts({
      context: params,
      drafts,
      materializeMarkdown: false,
    });
  }
  const seenPaths = new Set<string>();
  for (const page of pages) {
    seenPaths.add(page.relativePath);
    updateImportedFileRow(params.db, page);
  }
  for (const relativePath of importedRows.keys()) {
    if (seenPaths.has(relativePath)) {
      continue;
    }
    const pageId = importedRows.get(relativePath)?.page_id;
    if (pageId) {
      await applyEventDrafts({
        context: params,
        drafts: [
          {
            actorId: params.deviceId,
            batchId: `workspace-delete:${Date.now()}`,
            source: "workspace-import",
            pageId,
            type: "PAGE_TOMBSTONED",
            payload: {
              pageId,
              tombstoned: true,
              updatedAtMs: Date.now(),
            },
          },
        ],
        materializeMarkdown: false,
      });
    }
    deleteImportedFileRow(params.db, relativePath);
  }
  if (params.flags.legacyMarkdownProjectionEnabled) {
    await materializeLegacyMarkdownProjections({
      db: params.db,
      env: params.env,
    });
  }
}

function currentProjectionPathsForPage(db: DatabaseSync, pageId: string): string[] {
  const rows = db
    .prepare(
      `SELECT kind
       FROM projections
       WHERE page_id = ?
       ORDER BY kind ASC`,
    )
    .all(pageId) as Array<{
    kind: string;
  }>;
  return rows
    .map((row) => parseLegacyProjectionPath(row.kind))
    .filter((value): value is string => Boolean(value));
}

function buildStructuredMarkdown(params: {
  title: string;
  aliases: string[];
  tags: string[];
  projection: CanonicalMemoryStructuredProjectionInput;
}): string {
  const body = params.projection.markdownBody?.trimEnd() || `# ${params.title}\n`;
  const frontmatterObject = {
    title: params.title,
    ...(params.aliases.length > 0 ? { aliases: params.aliases } : {}),
    ...(params.tags.length > 0 ? { tags: params.tags } : {}),
    ...(params.projection.frontmatter ?? {}),
  };
  if (Object.keys(frontmatterObject).length === 0) {
    return body.endsWith("\n") ? body : `${body}\n`;
  }
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatterObject)) {
    appendYamlField(lines, key, value);
  }
  lines.push("---", "", body);
  return lines.join("\n").trimEnd().concat("\n");
}

function buildStructuredEntityEvents(params: {
  db: DatabaseSync;
  entity: CanonicalMemoryStructuredEntityInput;
  actorId: string;
  batchId: string;
  crdtPagesEnabled: boolean;
}): MemoryStateEventDraft[] {
  const primaryProjection = params.entity.projections[0];
  if (!primaryProjection) {
    return [];
  }
  const relativePath = normalizeDisplayPath(primaryProjection.relativePath);
  const slug = normalizeSlug(params.entity.slug ?? relativePath);
  const pageId =
    params.entity.entityId?.trim() ||
    resolvePageIdForProjectionPath(params.db, relativePath) ||
    hashText(`page:${slug}`);
  const aliases = sanitizeAliases({
    title: params.entity.title,
    slug,
    relativePath,
    aliases: params.entity.aliases,
  });
  const tags = uniqueStrings(params.entity.tags ?? []);
  const markdown = buildStructuredMarkdown({
    title: params.entity.title,
    aliases,
    tags,
    projection: primaryProjection,
  });
  const drafts: MemoryStateEventDraft[] = [];
  const current = readCurrentPageRow(params.db, pageId);
  const currentDocState = readCurrentPageDocState(params.db, pageId);
  if (!current) {
    drafts.push({
      actorId: params.actorId,
      batchId: params.batchId,
      source: "structured-write",
      pageId,
      type: "PAGE_CREATED",
      payload: {
        pageId,
        title: params.entity.title,
        slug,
        aliases,
        tags,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
    });
  } else {
    drafts.push({
      actorId: params.actorId,
      batchId: params.batchId,
      source: "structured-write",
      pageId,
      type: "PAGE_METADATA_UPDATED",
      payload: {
        pageId,
        title: params.entity.title,
        slug,
        aliases,
        tags,
        updatedAtMs: Date.now(),
      },
    });
  }
  const currentMarkdown = readCurrentPageMarkdown(params.db, pageId);
  drafts.push({
    actorId: params.actorId,
    batchId: params.batchId,
    source: "structured-write",
    pageId,
    type: params.crdtPagesEnabled && currentMarkdown ? "DOC_CRDT_UPDATE" : "DOC_CRDT_SNAPSHOT",
    payload:
      params.crdtPagesEnabled && currentDocState
        ? {
            pageId,
            update: createDocUpdateForMarkdown({
              currentState: currentDocState,
              markdown,
            }),
          }
        : {
            pageId,
            yjsState: createDocStateFromMarkdown(markdown),
          },
  });
  const relationLinks: MemoryPageLink[] = [];
  for (const [index, relation] of (params.entity.relations ?? []).entries()) {
    const toPageId =
      relation.targetEntityId?.trim() ||
      resolvePageIdForAlias(params.db, normalizeReferenceKey(relation.targetAlias ?? "")) ||
      resolvePageIdForAlias(params.db, normalizeReferenceKey(relation.targetLocator ?? ""));
    if (!toPageId || toPageId === pageId) {
      continue;
    }
    relationLinks.push({
      toPageId,
      type: relation.relationType,
      ordinal:
        typeof relation.ordinal === "number" && Number.isFinite(relation.ordinal)
          ? Math.max(0, Math.floor(relation.ordinal))
          : index,
    });
  }
  drafts.push({
    actorId: params.actorId,
    batchId: params.batchId,
    source: "structured-write",
    pageId,
    type: "LINKS_REPLACED",
    payload: {
      pageId,
      links: relationLinks,
    },
  });
  for (const projection of params.entity.projections) {
    drafts.push({
      actorId: params.actorId,
      batchId: params.batchId,
      source: "structured-write",
      pageId,
      type: "PROJECTION_SET",
      payload: {
        pageId,
        kind: resolveLegacyProjectionKind(projection.relativePath),
        markdownBody: buildStructuredMarkdown({
          title: params.entity.title,
          aliases,
          tags,
          projection,
        }),
      },
    });
  }
  return drafts;
}

function createCanonicalContext(params: {
  cfg: AlisioConfig;
  env?: NodeJS.ProcessEnv;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
}): CanonicalStoreContext {
  const env = params.env ?? process.env;
  const baseStatus = createStatusBase({
    env,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    backend: params.backend,
  });
  const ownerProfile = resolveAlisioMemoryOwnerProfile(env);
  const deviceIdentity = loadOrCreateDeviceIdentity();
  const stateDir = resolveStateDir(env);
  const db = openCanonicalStore(baseStatus.path);
  const flags = readFeatureFlags(params.cfg);
  upsertCanonicalOwnerProfile({
    db,
    ownerProfile,
    now: Date.now(),
  });
  upsertCanonicalReplica({
    db,
    ownerProfile,
    workspaceScope: baseStatus.workspaceScope,
    deviceId: deviceIdentity.deviceId,
    stateDir,
    now: Date.now(),
  });
  return {
    env,
    baseStatus,
    ownerProfile,
    deviceId: deviceIdentity.deviceId,
    stateDir,
    db,
    flags,
    backend: params.backend,
    workspaceDir: params.workspaceDir,
  };
}

export function buildCanonicalMarkdownProjection(params: {
  profileId: string;
  entity: CanonicalMemoryStructuredEntityInput;
  projection: CanonicalMemoryStructuredProjectionInput;
}): string {
  return buildStructuredMarkdown({
    title: params.entity.title,
    aliases: sanitizeAliases({
      title: params.entity.title,
      slug: normalizeSlug(params.entity.slug ?? params.projection.relativePath),
      relativePath: params.projection.relativePath,
      aliases: params.entity.aliases,
    }),
    tags: uniqueStrings(params.entity.tags ?? []),
    projection: params.projection,
  });
}

export function buildCanonicalMemoryStoreStatus(params: {
  env?: NodeJS.ProcessEnv;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
}): CanonicalMemoryStoreStatus {
  return createStatusBase(params);
}

export async function memoryWriteEvent(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  events: MemoryStateEventDraft[];
  env?: NodeJS.ProcessEnv;
  materializeMarkdown?: boolean;
}): Promise<MemoryWriteEventResult> {
  const context = createCanonicalContext(params);
  try {
    if (context.flags.ledgerEnabled) {
      bootstrapDerivedState(context.db);
      await migrateLegacyStateIfNeeded(context);
    }
    return await applyEventDrafts({
      context,
      drafts: params.events,
      materializeMarkdown: params.materializeMarkdown,
    });
  } finally {
    context.db.close();
  }
}

export async function memoryPullApplySync(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  plainEvents?: MemoryStateEventEnvelopePlain[];
  encryptedEvents?: MemorySyncEncryptedEvent[];
  decryptEvent?: (event: MemorySyncEncryptedEvent) => Promise<MemoryStateEventEnvelopePlain>;
  env?: NodeJS.ProcessEnv;
  materializeMarkdown?: boolean;
}): Promise<MemoryPullApplySyncResult> {
  const context = createCanonicalContext(params);
  try {
    bootstrapDerivedState(context.db);
    await migrateLegacyStateIfNeeded(context);
    const plainEvents = params.plainEvents
      ? [...params.plainEvents]
      : params.encryptedEvents && params.decryptEvent
        ? await Promise.all(params.encryptedEvents.map((event) => params.decryptEvent!(event)))
        : [];
    if (params.encryptedEvents && !params.decryptEvent) {
      throw new Error("E2EE sync requires a decryptEvent callback");
    }
    const inserted = insertLedgerEvents(context.db, sortMemoryStateEvents(plainEvents));
    if (
      inserted.some((event) => event.lamport <= readMemoryStateMeta(context.db).lastAppliedLamport)
    ) {
      rebuildDerivedStateFromEvents({
        db: context.db,
        events: readLedgerEvents(context.db),
        migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
      });
    } else {
      for (const event of inserted) {
        applyEventToDerivedState({
          db: context.db,
          event,
          migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
        });
      }
    }
    createCheckpointIfNeeded({
      db: context.db,
      lastAppliedLamport: readMemoryStateMeta(context.db).lastAppliedLamport,
    });
    upsertCanonicalSyncState({
      db: context.db,
      profileId: context.ownerProfile.profileId,
      workspaceScope: context.baseStatus.workspaceScope,
      backend: context.backend,
      now: Date.now(),
      cloudState: inserted.length > 0 ? "enabled" : CANONICAL_STORE_CLOUD_SYNC,
      lastSyncedLamport: readMemoryStateMeta(context.db).lastAppliedLamport,
    });
    if (params.materializeMarkdown !== false && context.flags.legacyMarkdownProjectionEnabled) {
      await materializeLegacyMarkdownProjections({
        db: context.db,
        env: context.env,
      });
    }
    return {
      status: buildReadyStatusFromContext(context),
      appliedCount: inserted.length,
      stateHash: computeMemoryStateHash(context.db),
    };
  } finally {
    context.db.close();
  }
}

export async function upsertCanonicalMemoryStructuredEntities(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  entities: CanonicalMemoryStructuredEntityInput[];
  env?: NodeJS.ProcessEnv;
  materializeMarkdown?: boolean;
}): Promise<CanonicalMemoryStoreStatus> {
  const context = createCanonicalContext(params);
  try {
    if (context.flags.ledgerEnabled) {
      bootstrapDerivedState(context.db);
      await migrateLegacyStateIfNeeded(context);
    }
    const batchId = `structured:${Date.now()}`;
    const drafts = params.entities.flatMap((entity) =>
      buildStructuredEntityEvents({
        db: context.db,
        entity,
        actorId: context.deviceId,
        batchId,
        crdtPagesEnabled: context.flags.crdtPagesEnabled,
      }),
    );
    const result = await applyEventDrafts({
      context,
      drafts,
      materializeMarkdown: params.materializeMarkdown,
    });
    return result.status;
  } finally {
    context.db.close();
  }
}

function listEntityAliases(db: DatabaseSync, pageId: string): string[] {
  return readCurrentPageAliases(db, pageId);
}

function listEntityTags(db: DatabaseSync, pageId: string): string[] {
  return readCurrentPageTags(db, pageId);
}

function listEntityProjections(db: DatabaseSync, pageId: string): CanonicalMemoryGraphProjection[] {
  const rows = db
    .prepare(
      `SELECT kind
       FROM projections
       WHERE page_id = ?
       ORDER BY kind ASC`,
    )
    .all(pageId) as Array<{
    kind: string;
  }>;
  return rows.flatMap((row) => {
    const relativePath = parseLegacyProjectionPath(row.kind);
    if (!relativePath) {
      return [];
    }
    return [
      {
        projectionId: hashText(`${pageId}:${row.kind}`),
        path: relativePath,
        sourceKind: "workspace-memory",
        editable: true,
      } satisfies CanonicalMemoryGraphProjection,
    ];
  });
}

function listEntityRelations(params: {
  db: DatabaseSync;
  pageId: string;
  direction: CanonicalRelationDirection;
  limit: number;
}): CanonicalMemoryGraphRelation[] {
  if (params.limit <= 0) {
    return [];
  }
  const rows =
    params.direction === "outgoing"
      ? (params.db
          .prepare(
            `SELECT
               l.type,
               l.ordinal,
               p.page_id AS related_page_id,
               p.title AS related_title,
               p.slug AS related_slug,
               pr.kind AS related_projection_kind
             FROM links l
             INNER JOIN pages p
               ON p.page_id = l.to_page_id
             LEFT JOIN projections pr
               ON pr.page_id = p.page_id
             WHERE l.from_page_id = ? AND p.tombstoned = 0
             ORDER BY l.ordinal ASC, p.title ASC
             LIMIT ?`,
          )
          .all(params.pageId, params.limit) as Array<{
          type: string;
          ordinal: number;
          related_page_id: string;
          related_title: string;
          related_slug: string;
          related_projection_kind: string | null;
        }>)
      : (params.db
          .prepare(
            `SELECT
               l.type,
               l.ordinal,
               p.page_id AS related_page_id,
               p.title AS related_title,
               p.slug AS related_slug,
               pr.kind AS related_projection_kind
             FROM links l
             INNER JOIN pages p
               ON p.page_id = l.from_page_id
             LEFT JOIN projections pr
               ON pr.page_id = p.page_id
             WHERE l.to_page_id = ? AND p.tombstoned = 0
             ORDER BY l.ordinal ASC, p.title ASC
             LIMIT ?`,
          )
          .all(params.pageId, params.limit) as Array<{
          type: string;
          ordinal: number;
          related_page_id: string;
          related_title: string;
          related_slug: string;
          related_projection_kind: string | null;
        }>);
  return rows.map((row) => ({
    direction: params.direction,
    relationType: row.type,
    ordinal: row.ordinal,
    metadata: {},
    relatedEntity: {
      entityId: row.related_page_id,
      title: row.related_title,
      slug: row.related_slug,
      sourcePath:
        parseLegacyProjectionPath(row.related_projection_kind ?? "") ??
        `memory/${row.related_slug}.md`,
      sourceKind: "workspace-memory",
    },
  }));
}

function resolveRelationDirectionLimits(params: {
  direction: CanonicalRelationDirection | "both";
  relationLimit?: number;
}): { incoming: number; outgoing: number } {
  const totalLimit =
    typeof params.relationLimit === "number" && Number.isFinite(params.relationLimit)
      ? Math.max(0, Math.floor(params.relationLimit))
      : 10;
  if (params.direction === "incoming") {
    return { incoming: totalLimit, outgoing: 0 };
  }
  if (params.direction === "outgoing") {
    return { incoming: 0, outgoing: totalLimit };
  }
  return {
    outgoing: Math.ceil(totalLimit / 2),
    incoming: Math.floor(totalLimit / 2),
  };
}

export function queryCanonicalMemoryGraph(params: {
  status: CanonicalMemoryStoreStatus;
  query: string;
  direction?: CanonicalRelationDirection | "both";
  matchLimit?: number;
  relationLimit?: number;
}): CanonicalMemoryGraphResult {
  const trimmedQuery = params.query.trim();
  const direction = params.direction ?? "both";
  const matchLimit =
    typeof params.matchLimit === "number" && Number.isFinite(params.matchLimit)
      ? Math.max(1, Math.floor(params.matchLimit))
      : 3;
  const emptyResult: CanonicalMemoryGraphResult = {
    query: trimmedQuery,
    profileId: params.status.profileId,
    workspaceScope: params.status.workspaceScope,
    storePath: params.status.path,
    backend: params.status.backend,
    state: params.status.state,
    projectionInterface: params.status.projectionInterface,
    syncMode: params.status.syncMode,
    cloudSync: params.status.cloudSync,
    lastSyncedLamport: params.status.lastSyncedLamport,
    e2eeRequired: true,
    ...(params.status.lastSyncedAt ? { lastSyncedAt: params.status.lastSyncedAt } : {}),
    ...(params.status.lastError ? { lastError: params.status.lastError } : {}),
    matches: [],
  };
  if (!trimmedQuery) {
    return emptyResult;
  }
  const normalizedQuery = normalizeReferenceKey(trimmedQuery);
  const loweredQuery = trimmedQuery.toLowerCase();
  const db = openCanonicalStore(params.status.path);
  try {
    const candidates = new Map<
      string,
      {
        page_id: string;
        title: string;
        slug: string;
        projection_kind: string | null;
        score: number;
      }
    >();
    const pushCandidate = (
      rows: Array<{ page_id: string; title: string; slug: string; projection_kind: string | null }>,
      score: number,
    ) => {
      for (const row of rows) {
        const existing = candidates.get(row.page_id);
        if (!existing || score > existing.score) {
          candidates.set(row.page_id, { ...row, score });
        }
      }
    };
    if (normalizedQuery) {
      pushCandidate(
        db
          .prepare(
            `SELECT DISTINCT p.page_id, p.title, p.slug, pr.kind AS projection_kind
             FROM pages p
             LEFT JOIN projections pr ON pr.page_id = p.page_id
             INNER JOIN page_aliases a ON a.page_id = p.page_id
             WHERE p.tombstoned = 0 AND a.alias_key = ?`,
          )
          .all(normalizedQuery) as Array<{
          page_id: string;
          title: string;
          slug: string;
          projection_kind: string | null;
        }>,
        1,
      );
      pushCandidate(
        db
          .prepare(
            `SELECT DISTINCT p.page_id, p.title, p.slug, pr.kind AS projection_kind
             FROM pages p
             LEFT JOIN projections pr ON pr.page_id = p.page_id
             INNER JOIN page_aliases a ON a.page_id = p.page_id
             WHERE p.tombstoned = 0 AND a.alias_key LIKE ?
             ORDER BY a.alias_key ASC
             LIMIT ?`,
          )
          .all(`${normalizedQuery}%`, matchLimit * 3) as Array<{
          page_id: string;
          title: string;
          slug: string;
          projection_kind: string | null;
        }>,
        0.8,
      );
    }
    pushCandidate(
      db
        .prepare(
          `SELECT p.page_id, p.title, p.slug, pr.kind AS projection_kind
           FROM pages p
           LEFT JOIN projections pr ON pr.page_id = p.page_id
           WHERE p.tombstoned = 0 AND LOWER(p.title) = ?`,
        )
        .all(loweredQuery) as Array<{
        page_id: string;
        title: string;
        slug: string;
        projection_kind: string | null;
      }>,
      0.95,
    );
    pushCandidate(
      db
        .prepare(
          `SELECT p.page_id, p.title, p.slug, pr.kind AS projection_kind
           FROM pages p
           LEFT JOIN projections pr ON pr.page_id = p.page_id
           WHERE p.tombstoned = 0 AND LOWER(p.title) LIKE ?
           ORDER BY p.title ASC
           LIMIT ?`,
        )
        .all(`%${loweredQuery}%`, matchLimit * 3) as Array<{
        page_id: string;
        title: string;
        slug: string;
        projection_kind: string | null;
      }>,
      0.6,
    );
    const limits = resolveRelationDirectionLimits({
      direction,
      relationLimit: params.relationLimit,
    });
    const matches = Array.from(candidates.values())
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.title.localeCompare(right.title);
      })
      .slice(0, matchLimit)
      .map((row) => ({
        entityId: row.page_id,
        title: row.title,
        slug: row.slug,
        sourcePath: parseLegacyProjectionPath(row.projection_kind ?? "") ?? `memory/${row.slug}.md`,
        sourceKind: "workspace-memory" as const,
        aliases: listEntityAliases(db, row.page_id),
        tags: listEntityTags(db, row.page_id),
        score: row.score,
        projections: listEntityProjections(db, row.page_id),
        relations: [
          ...listEntityRelations({
            db,
            pageId: row.page_id,
            direction: "outgoing",
            limit: limits.outgoing,
          }),
          ...listEntityRelations({
            db,
            pageId: row.page_id,
            direction: "incoming",
            limit: limits.incoming,
          }),
        ],
      }));
    return {
      ...emptyResult,
      matches,
    };
  } finally {
    db.close();
  }
}

export async function syncCanonicalMemoryStore(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  env?: NodeJS.ProcessEnv;
}): Promise<CanonicalMemoryStoreStatus> {
  const context = createCanonicalContext(params);
  try {
    if (!context.flags.ledgerEnabled) {
      if (context.flags.legacyMarkdownProjectionEnabled) {
        await materializeLegacyMarkdownProjections({
          db: context.db,
          env: context.env,
        });
      }
      return buildReadyStatusFromContext(context);
    }
    bootstrapDerivedState(context.db);
    await migrateLegacyStateIfNeeded(context);
    await syncWorkspaceImports(context);
    upsertCanonicalSyncState({
      db: context.db,
      profileId: context.ownerProfile.profileId,
      workspaceScope: context.baseStatus.workspaceScope,
      backend: context.backend,
      now: Date.now(),
      cloudState: CANONICAL_STORE_CLOUD_SYNC,
      lastSyncedLamport: readMemoryStateMeta(context.db).lastAppliedLamport,
    });
    return buildReadyStatusFromContext(context);
  } finally {
    context.db.close();
  }
}
