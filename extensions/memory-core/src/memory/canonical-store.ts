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
  createCloudRelayMemoryTransport,
  createDirectMemoryTransportStub,
  createMemoryCrypto,
  decodeBase64,
  encodeBase64,
  getAlisioActiveCloudAccessSession,
  importProfileKeyFromPairingCode,
  loadProfileRootKey,
  resolveMemorySyncAvailability,
  type EncryptedMemoryEvent,
  type MemoryBlobMeta,
  type MemoryCipherBytes,
  type MemorySyncAvailability,
  type MemorySyncMode,
  type MemorySyncTransport,
} from "alisio/plugin-sdk/memory-core-host-runtime-core";
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
  writeMemoryStateMeta,
  type MemoryPageLink,
  type MemoryStateCheckpointSnapshot,
  type MemoryStateEventDraft,
  type MemoryStateEventEnvelopePlain,
} from "alisio/plugin-sdk/memory-core-state";
import type { MemoryLedger } from "../../../../packages/memory-ledger/src/index.js";
import {
  createCanonicalStableId,
  isCanonicalStableId,
  type MemoryEventType,
} from "../../../../packages/memory-schema/src/index.js";
import { queryCanonicalMemoryGraphFromStore } from "./graph.js";
import {
  appendMemoryStateEvents,
  assignMemoryStateLedgerEvents,
  deserializeMemoryStateLedgerEvent,
  listMemoryStateEventsSince,
  openProfileMemoryLedger,
  serializeMemoryStateLedgerEvent,
} from "./ledger-interop.js";

const log = createSubsystemLogger("memory/canonical");

export type CanonicalStoreBackend = "builtin" | "qmd";
type CanonicalProjectionSource = "workspace-memory";
type CanonicalRelationType = string;
type CanonicalRelationDirection = "incoming" | "outgoing";
type CanonicalStoreStatusState = "pending-sync" | "ready";
type CanonicalStoreSyncMode = "local-first";
type CanonicalCloudSyncState = "unavailable" | "enabled" | "error";
type CanonicalSyncAvailabilityState = MemorySyncAvailability["state"];
type CanonicalSyncBlockedReason = NonNullable<MemorySyncAvailability["reason"]>;

const CANONICAL_STORE_SYNC_MODE: CanonicalStoreSyncMode = "local-first";
const CANONICAL_STORE_CLOUD_SYNC: CanonicalCloudSyncState = "unavailable";
const MARKDOWN_PROJECTION_PREFIX = "md-path:";
const LEDGER_EVENT_SCHEMA_VERSION = 1 as const;
const DERIVED_STATE_MIGRATION_VERSION = 1;
const CHECKPOINT_EVENT_INTERVAL = 50;
const MAX_ULID_TIMESTAMP = 0xffff_ffff_ffff;
const SYNC_PULL_BATCH_LIMIT = 200;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

type ProjectedFileRootKind = "workspace";

type ProjectedFileRow = {
  root_kind: ProjectedFileRootKind;
  relative_path: string;
  content_hash: string;
  updated_at_ms: number;
};

type CanonicalStoreFeatureFlags = {
  markdownProjectionEnabled: boolean;
  crdtPagesEnabled: boolean;
};

type CanonicalStoreSyncRow = {
  last_synced_at?: number | bigint;
  last_synced_lamport?: number | bigint;
  cloud_state?: string;
  sync_availability_state?: string;
  sync_mode_configured?: string;
  sync_blocked_reason?: string | null;
  last_sync_success_at?: number | bigint;
  last_ack_lamport?: number | bigint;
  last_pushed_local_lamport?: number | bigint;
};

type CanonicalStoreSyncConfig = {
  enabled: boolean;
  mode: MemorySyncMode;
  relayBaseUrl?: string;
  pairingCode?: string;
  pairingPassphrase?: string;
};

type CanonicalSyncRuntime = {
  config: CanonicalStoreSyncConfig;
  availability: MemorySyncAvailability;
  transport: MemorySyncTransport | null;
  crypto: ReturnType<typeof createMemoryCrypto> | null;
  profileRootKey: Uint8Array | null;
  lastError?: string;
};

type CanonicalSyncBlobRef = {
  blobId: string;
  kind: "attachment";
};

type CanonicalSyncEventEnvelope = Omit<MemoryStateEventEnvelopePlain, "type" | "payload"> & {
  type: string;
  payload: Record<string, unknown>;
};

type CanonicalAttachmentBlobEnvelope = {
  version: 1;
  event: CanonicalSyncEventEnvelope;
  blob: CanonicalSyncBlobRef;
};

type MemoryAttachmentAddedPayload = MemoryStateEventEnvelopePlain<"ATTACHMENT_ADDED">["payload"];
type MemoryCheckpointCreatedPayload =
  MemoryStateEventEnvelopePlain<"CHECKPOINT_CREATED">["payload"];

type CanonicalStoreContext = {
  cfg: AlisioConfig;
  env: NodeJS.ProcessEnv;
  baseStatus: CanonicalMemoryStoreStatus;
  ownerProfile: AlisioMemoryOwnerProfile;
  deviceId: string;
  stateDir: string;
  db: DatabaseSync;
  ledger: MemoryLedger;
  flags: CanonicalStoreFeatureFlags;
  backend: CanonicalStoreBackend;
  workspaceDir: string;
  sync: CanonicalSyncRuntime;
  encryptCheckpointSnapshot?: (
    snapshot: MemoryStateCheckpointSnapshot,
  ) => Promise<string | null | undefined>;
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
  projectionInterface: "markdown-repo";
  syncMode: CanonicalStoreSyncMode;
  cloudSync: CanonicalCloudSyncState;
  projectionSources: CanonicalProjectionSource[];
  ledgerEventsCount: number;
  lastSyncedLamport: number;
  checkpointsCount: number;
  e2eeRequired: true;
  syncAvailability: CanonicalSyncAvailabilityState;
  syncModeConfigured: MemorySyncMode;
  syncBlockedReason?: CanonicalSyncBlockedReason;
  lastSyncSuccessAt?: string;
  lastAckLamport?: number;
  pendingBacklog?: number;
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
  projectionInterface: "markdown-repo";
  syncMode: CanonicalStoreSyncMode;
  cloudSync: CanonicalCloudSyncState;
  lastSyncedLamport: number;
  e2eeRequired: true;
  lastSyncedAt?: string;
  lastError?: string;
  scope: "global" | "local";
  mode: "overview" | "focus";
  focus?: {
    nodeId: string;
    pageId: string;
    entityId: string;
    title: string;
    sourcePath: string;
  };
  nodes: Array<{
    id: string;
    pageId: string;
    entityId: string;
    kind: "note" | "attachment";
    title: string;
    slug: string;
    sourcePath: string;
    sourceKind: CanonicalProjectionSource;
    aliases: string[];
    tags: string[];
    attachmentId?: string;
    fileName?: string;
    mediaType?: string;
    incoming: number;
    outgoing: number;
    degree: number;
  }>;
  edges: Array<{
    id: string;
    fromId: string;
    toId: string;
    fromPageId: string;
    toPageId: string;
    relationType: string;
    ordinal: number;
    reason: {
      kind: "canonical-link" | "attachment-reference";
      sourcePageId?: string;
      targetPageId?: string;
      sourceTitle: string;
      targetTitle: string;
      sourcePath: string;
      targetPath: string;
      relationType: string;
      ordinal: number;
      attachmentId?: string;
      fileName?: string;
      mediaType?: string;
    };
  }>;
  branches: Array<{
    id: string;
    direction: CanonicalRelationDirection;
    relationType: string;
    nodeIds: string[];
  }>;
  availableRelationTypes: string[];
  availableTags: string[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    visibleNodes: number;
    visibleEdges: number;
  };
  truncated: {
    nodes: boolean;
    edges: boolean;
  };
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

function resolveMarkdownProjectionKind(relativePath: string): string {
  return `${MARKDOWN_PROJECTION_PREFIX}${normalizeDisplayPath(relativePath)}`;
}

function parseMarkdownProjectionPath(kind: string): string | null {
  if (!kind.startsWith(MARKDOWN_PROJECTION_PREFIX)) {
    return null;
  }
  const relativePath = kind.slice(MARKDOWN_PROJECTION_PREFIX.length);
  return relativePath ? normalizeDisplayPath(relativePath) : null;
}

function resolveProjectionPath(params: { rootDir: string; relativePath: string }): string {
  return path.join(params.rootDir, normalizeDisplayPath(params.relativePath));
}

function shouldMaterializeAnyMarkdown(flags: CanonicalStoreFeatureFlags): boolean {
  return flags.markdownProjectionEnabled;
}

function readFeatureFlags(cfg: AlisioConfig): CanonicalStoreFeatureFlags {
  const rawMemory = cfg.memory;
  return {
    markdownProjectionEnabled: rawMemory?.markdownProjection?.enabled ?? true,
    crdtPagesEnabled: rawMemory?.crdt?.pages?.enabled ?? true,
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

function normalizeSyncMode(value: string | undefined): MemorySyncMode | undefined {
  switch (value?.trim().toLowerCase()) {
    case "cloud":
    case "direct":
    case "off":
      return value.trim().toLowerCase() as MemorySyncMode;
    default:
      return undefined;
  }
}

function resolveCanonicalSyncConfig(
  cfg: AlisioConfig,
  env: NodeJS.ProcessEnv,
): CanonicalStoreSyncConfig {
  const rawMemory = (cfg as { memory?: unknown }).memory as
    | {
        sync?: {
          mode?: string;
          relayBaseUrl?: string;
        };
      }
    | undefined;
  const relayBaseUrl = rawMemory?.sync?.relayBaseUrl?.trim() || undefined;
  const mode = normalizeSyncMode(rawMemory?.sync?.mode) ?? "off";
  return {
    enabled: mode !== "off",
    mode,
    ...(relayBaseUrl ? { relayBaseUrl } : {}),
    ...(env.ALISIO_MEMORY_SYNC_PAIRING_CODE?.trim()
      ? { pairingCode: env.ALISIO_MEMORY_SYNC_PAIRING_CODE.trim() }
      : {}),
    ...(env.ALISIO_MEMORY_SYNC_PAIRING_PASSPHRASE?.trim()
      ? { pairingPassphrase: env.ALISIO_MEMORY_SYNC_PAIRING_PASSPHRASE.trim() }
      : {}),
  };
}

function normalizeSyncBlockedReason(value: unknown): CanonicalSyncBlockedReason | undefined {
  switch (value) {
    case "disabled":
    case "mode_off":
    case "missing_profile_key":
    case "missing_relay_base_url":
    case "missing_access_token":
    case "direct_disabled":
      return value;
    default:
      return undefined;
  }
}

function describeSyncBlockedReason(
  reason: CanonicalSyncBlockedReason | undefined,
): string | undefined {
  switch (reason) {
    case "disabled":
      return "memory sync disabled";
    case "mode_off":
      return "memory sync mode is off";
    case "missing_profile_key":
      return "memory sync blocked: missing profile root key";
    case "missing_relay_base_url":
      return "memory sync blocked: relay base URL missing";
    case "missing_access_token":
      return "memory sync blocked: cloud access token missing";
    case "direct_disabled":
      return "memory sync blocked: direct mode not enabled";
    default:
      return undefined;
  }
}

function encodeJsonBytes(value: unknown): Uint8Array {
  return Uint8Array.from(textEncoder.encode(JSON.stringify(value)));
}

function decodeJsonValue<T>(bytes: Uint8Array): T {
  return JSON.parse(textDecoder.decode(bytes)) as T;
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
    projectionInterface: "markdown-repo",
    syncMode: CANONICAL_STORE_SYNC_MODE,
    cloudSync: CANONICAL_STORE_CLOUD_SYNC,
    projectionSources: [],
    ledgerEventsCount: 0,
    lastSyncedLamport: 0,
    checkpointsCount: 0,
    e2eeRequired: true,
    syncAvailability: "inactive",
    syncModeConfigured: "off",
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

function ensureSyncStateColumn(db: DatabaseSync, column: string, definition: string): void {
  if (hasColumn(db, "sync_state", column)) {
    return;
  }
  db.exec(`ALTER TABLE sync_state ADD COLUMN ${column} ${definition}`);
}

function ensureCanonicalStoreSchema(db: DatabaseSync): void {
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
  ensureSyncStateColumn(db, "sync_availability_state", "TEXT NOT NULL DEFAULT 'inactive'");
  ensureSyncStateColumn(db, "sync_mode_configured", "TEXT NOT NULL DEFAULT 'off'");
  ensureSyncStateColumn(db, "sync_blocked_reason", "TEXT");
  ensureSyncStateColumn(db, "last_sync_success_at", "INTEGER");
  ensureSyncStateColumn(db, "last_ack_lamport", "INTEGER NOT NULL DEFAULT 0");
  ensureSyncStateColumn(db, "last_pushed_local_lamport", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS imported_files (
      source_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      page_id TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS projected_files (
      root_kind TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY(root_kind, relative_path)
    );
  `);
  if (!hasColumn(db, "projected_files", "content_hash")) {
    db.exec(`ALTER TABLE projected_files ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''`);
  }
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
  syncAvailability?: CanonicalSyncAvailabilityState;
  syncModeConfigured?: MemorySyncMode;
  syncBlockedReason?: CanonicalSyncBlockedReason;
  lastSyncSuccessAt?: number;
  lastAckLamport?: number;
  lastPushedLocalLamport?: number;
}): void {
  params.db
    .prepare(
      `INSERT INTO sync_state (
         profile_id,
         workspace_scope,
         backend,
         sync_mode,
         cloud_state,
         last_synced_at,
         last_synced_lamport,
         sync_availability_state,
         sync_mode_configured,
         sync_blocked_reason,
         last_sync_success_at,
         last_ack_lamport,
         last_pushed_local_lamport
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, workspace_scope) DO UPDATE SET
         backend = excluded.backend,
         sync_mode = excluded.sync_mode,
         cloud_state = excluded.cloud_state,
         last_synced_at = excluded.last_synced_at,
         last_synced_lamport = excluded.last_synced_lamport,
         sync_availability_state = excluded.sync_availability_state,
         sync_mode_configured = excluded.sync_mode_configured,
         sync_blocked_reason = excluded.sync_blocked_reason,
         last_sync_success_at = excluded.last_sync_success_at,
         last_ack_lamport = excluded.last_ack_lamport,
         last_pushed_local_lamport = excluded.last_pushed_local_lamport`,
    )
    .run(
      params.profileId,
      params.workspaceScope,
      params.backend,
      CANONICAL_STORE_SYNC_MODE,
      params.cloudState ?? CANONICAL_STORE_CLOUD_SYNC,
      params.now,
      params.lastSyncedLamport ?? 0,
      params.syncAvailability ?? "inactive",
      params.syncModeConfigured ?? "off",
      params.syncBlockedReason ?? null,
      params.lastSyncSuccessAt ?? null,
      params.lastAckLamport ?? 0,
      params.lastPushedLocalLamport ?? 0,
    );
}

function readSyncState(
  db: DatabaseSync,
  params: { profileId: string; workspaceScope: string },
): CanonicalStoreSyncRow {
  return (
    (db
      .prepare(
        `SELECT
           last_synced_at,
           last_synced_lamport,
           cloud_state,
           sync_availability_state,
           sync_mode_configured,
           sync_blocked_reason,
           last_sync_success_at,
           last_ack_lamport,
           last_pushed_local_lamport
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
        (SELECT COUNT(*) FROM projections) AS projections`,
    )
    .get() as
    | {
        entities: number;
        relations: number;
        projections: number;
      }
    | undefined;
  return {
    entities: row?.entities ?? 0,
    relations: row?.relations ?? 0,
    projections: row?.projections ?? 0,
  };
}

function countPendingBacklog(ledger: MemoryLedger, lastAckLamport: number): number {
  const lastLamport = ledger.getStats().lastLamport;
  return Math.max(0, lastLamport - Math.max(0, lastAckLamport));
}

function buildReadyCanonicalStoreStatus(params: {
  baseStatus: CanonicalMemoryStoreStatus;
  db: DatabaseSync;
  ledger: MemoryLedger;
  profileId: string;
  workspaceScope: string;
  deviceId: string;
  stateDir: string;
}): CanonicalMemoryStoreStatus {
  const counts = readScopeCounts(params.db);
  const ledgerStats = params.ledger.getStats();
  const meta = readMemoryStateMeta(params.db);
  const syncState = readSyncState(params.db, {
    profileId: params.profileId,
    workspaceScope: params.workspaceScope,
  });
  const syncAvailability =
    syncState.sync_availability_state === "active" ||
    syncState.sync_availability_state === "inactive" ||
    syncState.sync_availability_state === "blocked"
      ? syncState.sync_availability_state
      : "inactive";
  const syncModeConfigured =
    syncState.sync_mode_configured === "cloud" ||
    syncState.sync_mode_configured === "direct" ||
    syncState.sync_mode_configured === "off"
      ? syncState.sync_mode_configured
      : "off";
  const syncBlockedReason = normalizeSyncBlockedReason(syncState.sync_blocked_reason);
  const lastAckLamport = normalizeNumber(syncState.last_ack_lamport);
  return {
    ...params.baseStatus,
    state: "ready",
    entities: counts.entities,
    relations: counts.relations,
    projections: counts.projections,
    projectionSources: counts.projections > 0 ? ["workspace-memory"] : [],
    ledgerEventsCount: ledgerStats.eventCount,
    checkpointsCount: ledgerStats.checkpointCount,
    lastSyncedLamport: normalizeNumber(syncState.last_synced_lamport) || meta.lastAppliedLamport,
    cloudSync:
      syncState.cloud_state === "enabled" || syncState.cloud_state === "error"
        ? (syncState.cloud_state as CanonicalCloudSyncState)
        : CANONICAL_STORE_CLOUD_SYNC,
    syncAvailability,
    syncModeConfigured,
    ...(syncBlockedReason ? { syncBlockedReason } : {}),
    ...(normalizeNumber(syncState.last_sync_success_at) > 0
      ? {
          lastSyncSuccessAt: new Date(
            normalizeNumber(syncState.last_sync_success_at),
          ).toISOString(),
        }
      : {}),
    ...(lastAckLamport > 0 ? { lastAckLamport } : {}),
    ...(syncAvailability === "active" || lastAckLamport > 0
      ? { pendingBacklog: countPendingBacklog(params.ledger, lastAckLamport) }
      : {}),
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

function toCanonicalCheckpointId(seed: string, createdAtMs: number): string {
  if (isCanonicalStableId(seed)) {
    return seed;
  }
  const digest = Buffer.from(hashText(seed), "hex");
  return createCanonicalStableId({
    nowMs: Math.max(0, Math.min(Math.trunc(createdAtMs), MAX_ULID_TIMESTAMP)),
    random: new Uint8Array(digest.subarray(0, 10)),
  });
}

function normalizeCheckpointEvent(
  event: MemoryStateEventEnvelopePlain,
): MemoryStateEventEnvelopePlain {
  if (event.type !== "CHECKPOINT_CREATED") {
    return event;
  }
  const payload = event.payload as MemoryCheckpointCreatedPayload;
  const checkpointId = toCanonicalCheckpointId(
    `${payload.checkpointId}:${payload.stateHash}`,
    event.createdAtMs,
  );
  if (checkpointId === payload.checkpointId) {
    return event;
  }
  return {
    ...event,
    payload: {
      ...payload,
      checkpointId,
    } as MemoryCheckpointCreatedPayload,
  };
}

function normalizeCheckpointEvents(
  events: readonly MemoryStateEventEnvelopePlain[],
): MemoryStateEventEnvelopePlain[] {
  return events.map((event) => normalizeCheckpointEvent(event));
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
  const canonicalKind = resolveMarkdownProjectionKind(relativePath);
  const row = db
    .prepare(
      `SELECT page_id
       FROM projections
       WHERE kind = ?
       ORDER BY page_id ASC
       LIMIT 1`,
    )
    .get(canonicalKind) as
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
  projectedFileRowsByPath?: ReadonlyMap<string, ProjectedFileRow>;
  tombstonedPageIdByPath?: ReadonlyMap<string, string>;
}): Promise<CanonicalImportedPage[]> {
  const collectPagesFromRoot = async (
    rootDir: string,
    projectedFilesByPath?: ReadonlyMap<string, ProjectedFileRow>,
  ) => {
    const discoveredFiles = await listMemoryFiles(rootDir);
    const entries = (
      await runWithConcurrency(
        discoveredFiles.map((file) => async () => await buildFileEntry(file, rootDir)),
        8,
      )
    )
      .filter((entry): entry is MemoryFileEntry => entry !== null)
      .filter((entry) => {
        const relativePath = normalizeDisplayPath(entry.path);
        const tombstonedPageId = params.tombstonedPageIdByPath?.get(relativePath);
        if (tombstonedPageId) {
          return true;
        }
        const existingPageId = params.importedPageIdByPath.get(relativePath);
        if (existingPageId) {
          return true;
        }
        const projected = projectedFilesByPath?.get(relativePath);
        return !projected || projected.content_hash !== entry.hash;
      });
    // Files that already belong to imported workspace pages must stay in the
    // import set even when their bytes match the last materialized projection.
    // Otherwise the delete pass treats live pages as removed and tombstones them.
    const pages = await Promise.all(
      entries.map(async (entry) => {
        const markdown = await fs.readFile(entry.absPath, "utf8");
        return buildLegacyPageFromFile({
          entry,
          workspaceDir: rootDir,
          markdown,
          existingPageId: params.importedPageIdByPath.get(normalizeDisplayPath(entry.path)),
        });
      }),
    );
    return pages.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  };

  return await collectPagesFromRoot(params.workspaceDir, params.projectedFileRowsByPath);
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
  const projectionKind = resolveMarkdownProjectionKind(params.page.relativePath);
  const projectionExists = Boolean(
    params.db
      .prepare(
        `SELECT 1 AS found
         FROM projections
         WHERE page_id = ? AND kind = ?
         LIMIT 1`,
      )
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

function readTombstonedPageIds(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(
      `SELECT page_id
       FROM pages
       WHERE tombstoned = 1
       ORDER BY page_id ASC`,
    )
    .all() as Array<{
    page_id: string;
  }>;
  return new Set(rows.map((row) => row.page_id));
}

function readTombstonedProjectionPageIdsByPath(db: DatabaseSync): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT p.page_id, pr.kind
       FROM pages p
       INNER JOIN projections pr
         ON pr.page_id = p.page_id
       WHERE p.tombstoned = 1
       ORDER BY p.page_id ASC, pr.kind ASC`,
    )
    .all() as Array<{
    page_id: string;
    kind: string;
  }>;
  const byPath = new Map<string, string>();
  for (const row of rows) {
    const relativePath = parseMarkdownProjectionPath(row.kind);
    if (!relativePath || byPath.has(relativePath)) {
      continue;
    }
    byPath.set(relativePath, row.page_id);
  }
  return byPath;
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

function readProjectedFileRows(
  db: DatabaseSync,
  rootKind: ProjectedFileRootKind,
): Map<string, ProjectedFileRow> {
  const rows = db
    .prepare(
      `SELECT root_kind, relative_path, content_hash, updated_at_ms
       FROM projected_files
       WHERE root_kind = ?
       ORDER BY relative_path ASC`,
    )
    .all(rootKind) as ProjectedFileRow[];
  return new Map(rows.map((row) => [row.relative_path, row]));
}

function updateProjectedFileRow(
  db: DatabaseSync,
  params: {
    rootKind: ProjectedFileRootKind;
    relativePath: string;
    contentHash: string;
    updatedAtMs: number;
  },
): void {
  db.prepare(
    `INSERT INTO projected_files (root_kind, relative_path, content_hash, updated_at_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(root_kind, relative_path) DO UPDATE SET
       content_hash = excluded.content_hash,
       updated_at_ms = excluded.updated_at_ms`,
  ).run(params.rootKind, params.relativePath, params.contentHash, params.updatedAtMs);
}

function deleteProjectedFileRow(
  db: DatabaseSync,
  params: { rootKind: ProjectedFileRootKind; relativePath: string },
): void {
  db.prepare(`DELETE FROM projected_files WHERE root_kind = ? AND relative_path = ?`).run(
    params.rootKind,
    params.relativePath,
  );
}

async function writeFileIfChanged(target: string, content: string): Promise<boolean> {
  try {
    const existing = await fs.readFile(target, "utf8");
    if (existing === content) {
      return false;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return true;
}

async function createCheckpointIfNeeded(params: {
  context: CanonicalStoreContext;
  lastAppliedLamport: number;
  force?: boolean;
}): Promise<void> {
  const latestCheckpoint = params.context.ledger.getLatestCheckpoint();
  const lastCheckpointLamport = latestCheckpoint?.coveredUntilLamport ?? 0;
  if (params.lastAppliedLamport === 0) {
    return;
  }
  const memoryEventsSinceCheckpoint = listMemoryStateEventsSince({
    ledger: params.context.ledger,
    lamportExclusive: lastCheckpointLamport,
  }).filter((event) => event.type !== "CHECKPOINT_CREATED").length;
  if (params.force !== true && memoryEventsSinceCheckpoint < CHECKPOINT_EVENT_INTERVAL) {
    return;
  }
  const checkpointLamport = params.context.ledger.getStats().lastLamport + 1;
  const snapshot = captureMemoryStateCheckpoint(params.context.db);
  const checkpointId = toCanonicalCheckpointId(
    `checkpoint:${checkpointLamport}:${computeMemoryStateHash(params.context.db)}`,
    checkpointLamport,
  );
  snapshot.meta = {
    migrationVersion: snapshot.meta.migrationVersion,
    lastAppliedLamport: checkpointLamport,
    lastCheckpointId: checkpointId,
  };
  const stateHash = hashText(JSON.stringify(snapshot));
  const encryptedSnapshot = (await params.context.encryptCheckpointSnapshot?.(snapshot)) ?? null;
  params.context.ledger.createCheckpoint(checkpointId, checkpointLamport, stateHash, {
    plain: Buffer.from(JSON.stringify(snapshot), "utf8"),
    ...(encryptedSnapshot
      ? {
          cipher: Buffer.from(encryptedSnapshot, "utf8"),
        }
      : {}),
  });
  const inserted = appendMemoryStateEvents({
    ledger: params.context.ledger,
    profileId: params.context.ownerProfile.profileId,
    events: [
      {
        schemaVersion: LEDGER_EVENT_SCHEMA_VERSION,
        eventId: hashText(`checkpoint-event:${checkpointId}`).slice(0, 24),
        lamport: checkpointLamport,
        actorId: "gaia-checkpoint",
        createdAtMs: Date.now(),
        type: "CHECKPOINT_CREATED",
        payload: {
          checkpointId,
          stateHash,
          encryptedSnapshot,
        },
        source: "checkpoint",
      },
    ],
  });
  for (const event of inserted) {
    applyEventToDerivedState({
      db: params.context.db,
      event,
      migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
    });
  }
  canonicalStoreTelemetry("checkpoint_created_count", 1, {
    checkpointId,
    lastAppliedLamport: params.lastAppliedLamport,
  });
}

function bootstrapDerivedState(params: { db: DatabaseSync; ledger: MemoryLedger }): void {
  ensureCanonicalStoreSchema(params.db);
  const latestCheckpoint = params.ledger.getLatestCheckpoint();
  const checkpointLamport = latestCheckpoint?.coveredUntilLamport ?? 0;
  if (latestCheckpoint?.payloadPlain) {
    try {
      const snapshot = JSON.parse(
        Buffer.from(latestCheckpoint.payloadPlain).toString("utf8"),
      ) as MemoryStateCheckpointSnapshot;
      restoreMemoryStateCheckpoint(params.db, snapshot);
      const tailEvents = listMemoryStateEventsSince({
        ledger: params.ledger,
        lamportExclusive: checkpointLamport,
      });
      if (tailEvents.length > 0) {
        for (const event of tailEvents) {
          applyEventToDerivedState({
            db: params.db,
            event,
            migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
          });
        }
      }
      return;
    } catch (error) {
      log.warn(
        `failed to restore memory checkpoint ${latestCheckpoint.checkpointId}: ${String(error)}`,
      );
    }
  }
  const events = listMemoryStateEventsSince({
    ledger: params.ledger,
    lamportExclusive: 0,
  });
  if (events.length > 0) {
    rebuildDerivedStateFromEvents({
      db: params.db,
      events,
      migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
    });
    return;
  }
  const meta = readMemoryStateMeta(params.db);
  writeMemoryStateMeta(params.db, {
    migrationVersion: Math.max(meta.migrationVersion, DERIVED_STATE_MIGRATION_VERSION),
    lastAppliedLamport: 0,
    ...(latestCheckpoint?.checkpointId ? { lastCheckpointId: latestCheckpoint.checkpointId } : {}),
  });
}

async function materializeMarkdownProjections(params: {
  db: DatabaseSync;
  workspaceDir: string;
  env: NodeJS.ProcessEnv;
  flags: CanonicalStoreFeatureFlags;
}): Promise<number> {
  const rows = params.db
    .prepare(
      `SELECT projections.page_id, projections.kind, projections.markdown_body
       FROM projections
       JOIN pages ON pages.page_id = projections.page_id
       WHERE pages.tombstoned = 0
       ORDER BY kind ASC`,
    )
    .all() as Array<{
    page_id: string;
    kind: string;
    markdown_body: string;
  }>;
  const expectedContentByPath = new Map<string, string>();
  for (const row of rows) {
    const relativePath = parseMarkdownProjectionPath(row.kind);
    if (!relativePath) {
      continue;
    }
    expectedContentByPath.set(relativePath, row.markdown_body);
  }

  const roots = params.flags.markdownProjectionEnabled
    ? [{ kind: "workspace" as const, rootDir: path.resolve(params.workspaceDir) }]
    : [];

  let written = 0;
  for (const root of roots) {
    await fs.mkdir(root.rootDir, { recursive: true });
    const previouslyProjected = readProjectedFileRows(params.db, root.kind);
    for (const [relativePath, markdownBody] of expectedContentByPath) {
      const target = resolveProjectionPath({ rootDir: root.rootDir, relativePath });
      const contentHash = hashText(markdownBody);
      if (await writeFileIfChanged(target, markdownBody)) {
        written += 1;
      }
      updateProjectedFileRow(params.db, {
        rootKind: root.kind,
        relativePath,
        contentHash,
        updatedAtMs: Date.now(),
      });
      previouslyProjected.delete(relativePath);
    }
    for (const staleRelativePath of previouslyProjected.keys()) {
      const target = resolveProjectionPath({
        rootDir: root.rootDir,
        relativePath: staleRelativePath,
      });
      await fs.rm(target, { force: true }).catch(() => {});
      deleteProjectedFileRow(params.db, {
        rootKind: root.kind,
        relativePath: staleRelativePath,
      });
    }
  }
  canonicalStoreTelemetry("projections_written_count", written, {
    roots: roots.map((root) => root.rootDir),
  });
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
  const status = buildReadyCanonicalStoreStatus({
    baseStatus: params.baseStatus,
    db: params.db,
    ledger: params.ledger,
    profileId: params.ownerProfile.profileId,
    workspaceScope: params.baseStatus.workspaceScope,
    deviceId: params.deviceId,
    stateDir: params.stateDir,
  });
  return params.sync.lastError ? { ...status, lastError: params.sync.lastError } : status;
}

async function applyEventDrafts(params: {
  context: CanonicalStoreContext;
  drafts: MemoryStateEventDraft[];
  cloudState?: CanonicalCloudSyncState;
  materializeMarkdown?: boolean;
  forceCheckpoint?: boolean;
}): Promise<MemoryWriteEventResult> {
  const events = normalizeCheckpointEvents(
    assignMemoryStateLedgerEvents({
      ledger: params.context.ledger,
      drafts: params.drafts,
    }),
  );
  if (events.length === 0) {
    const status = buildReadyStatusFromContext(params.context);
    return {
      status,
      events: [],
      stateHash: computeMemoryStateHash(params.context.db),
    };
  }
  const inserted = appendMemoryStateEvents({
    ledger: params.context.ledger,
    profileId: params.context.ownerProfile.profileId,
    events,
  });
  if (inserted.length === 0) {
    const status = buildReadyStatusFromContext(params.context);
    return {
      status,
      events: [],
      stateHash: computeMemoryStateHash(params.context.db),
    };
  }
  for (const event of inserted) {
    applyEventToDerivedState({
      db: params.context.db,
      event,
      migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
    });
  }
  const meta = readMemoryStateMeta(params.context.db);
  await createCheckpointIfNeeded({
    context: params.context,
    lastAppliedLamport: meta.lastAppliedLamport,
    force: params.forceCheckpoint,
  });
  persistCanonicalSyncRuntimeState(params.context, {
    cloudState: params.cloudState ?? resolveSyncCloudState(params.context),
    lastSyncedLamport: readMemoryStateMeta(params.context.db).lastAppliedLamport,
  });
  if (params.materializeMarkdown !== false && shouldMaterializeAnyMarkdown(params.context.flags)) {
    await materializeMarkdownProjections({
      db: params.context.db,
      workspaceDir: params.context.workspaceDir,
      env: params.context.env,
      flags: params.context.flags,
    });
  }
  const applyDurationMs = Math.max(
    0,
    Date.now() - Math.min(...inserted.map((event) => event.createdAtMs)),
  );
  canonicalStoreTelemetry("ledger_to_state_apply_ms", applyDurationMs, {
    events: inserted.length,
  });
  if (params.context.sync.availability.state === "active") {
    try {
      await pushPendingEncryptedEvents(params.context);
      await pullRelayAckVector(params.context);
      persistCanonicalSyncRuntimeState(params.context, {
        cloudState: resolveSyncCloudState(params.context),
        lastSyncSuccessAt: Date.now(),
        lastSyncedLamport: readMemoryStateMeta(params.context.db).lastAppliedLamport,
        lastError: null,
      });
    } catch (error) {
      persistCanonicalSyncRuntimeState(params.context, {
        cloudState: resolveSyncCloudState(params.context, true),
        lastSyncedLamport: readMemoryStateMeta(params.context.db).lastAppliedLamport,
        lastError: `memory sync push failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return {
    status: buildReadyStatusFromContext(params.context),
    events: inserted,
    stateHash: computeMemoryStateHash(params.context.db),
  };
}

async function syncWorkspaceImports(params: CanonicalStoreContext): Promise<void> {
  const importedRows = readImportedFileRows(params.db);
  const pages = await collectWorkspaceMarkdownPages({
    workspaceDir: params.workspaceDir,
    importedPageIdByPath: buildImportPageIdMap(importedRows),
    projectedFileRowsByPath: readProjectedFileRows(params.db, "workspace"),
    tombstonedPageIdByPath: readTombstonedProjectionPageIdsByPath(params.db),
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
  const seenPageIds = new Set<string>();
  for (const page of pages) {
    seenPaths.add(page.relativePath);
    seenPageIds.add(page.pageId);
    updateImportedFileRow(params.db, page);
  }
  for (const relativePath of importedRows.keys()) {
    if (seenPaths.has(relativePath)) {
      continue;
    }
    const pageId = importedRows.get(relativePath)?.page_id;
    if (pageId && seenPageIds.has(pageId)) {
      deleteImportedFileRow(params.db, relativePath);
      continue;
    }
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
  if (shouldMaterializeAnyMarkdown(params.flags)) {
    await materializeMarkdownProjections({
      db: params.db,
      workspaceDir: params.workspaceDir,
      env: params.env,
      flags: params.flags,
    });
  }
}

async function initializeCanonicalLedgerState(context: CanonicalStoreContext): Promise<void> {
  bootstrapDerivedState({
    db: context.db,
    ledger: context.ledger,
  });
}

function createInactiveSyncRuntime(
  cfg: AlisioConfig,
  env: NodeJS.ProcessEnv,
): CanonicalSyncRuntime {
  const config = resolveCanonicalSyncConfig(cfg, env);
  return {
    config,
    availability: {
      state: "inactive",
      mode: config.mode,
      ...(config.enabled ? {} : { reason: "disabled" as const }),
    },
    transport: null,
    crypto: null,
    profileRootKey: null,
  };
}

function resolveSyncCloudState(
  context: CanonicalStoreContext,
  failed = false,
): CanonicalCloudSyncState {
  if (failed) {
    return "error";
  }
  return context.sync.availability.state === "active" && context.sync.config.mode === "cloud"
    ? "enabled"
    : CANONICAL_STORE_CLOUD_SYNC;
}

function persistCanonicalSyncRuntimeState(
  context: CanonicalStoreContext,
  patch: {
    cloudState?: CanonicalCloudSyncState;
    lastSyncedLamport?: number;
    lastSyncSuccessAt?: number;
    lastAckLamport?: number;
    lastPushedLocalLamport?: number;
    syncAvailability?: CanonicalSyncAvailabilityState;
    syncBlockedReason?: CanonicalSyncBlockedReason;
    syncModeConfigured?: MemorySyncMode;
    lastError?: string | null;
  } = {},
): void {
  const existing = readSyncState(context.db, {
    profileId: context.ownerProfile.profileId,
    workspaceScope: context.baseStatus.workspaceScope,
  });
  if ("lastError" in patch) {
    context.sync.lastError = patch.lastError ?? undefined;
  }
  const resolvedBlockedReason =
    patch.syncBlockedReason ?? normalizeSyncBlockedReason(context.sync.availability.reason);
  upsertCanonicalSyncState({
    db: context.db,
    profileId: context.ownerProfile.profileId,
    workspaceScope: context.baseStatus.workspaceScope,
    backend: context.backend,
    now: Date.now(),
    cloudState:
      patch.cloudState ??
      (existing.cloud_state === "enabled" || existing.cloud_state === "error"
        ? (existing.cloud_state as CanonicalCloudSyncState)
        : resolveSyncCloudState(context)),
    lastSyncedLamport:
      patch.lastSyncedLamport ?? readMemoryStateMeta(context.db).lastAppliedLamport,
    syncAvailability: patch.syncAvailability ?? context.sync.availability.state,
    syncModeConfigured: patch.syncModeConfigured ?? context.sync.config.mode,
    syncBlockedReason: resolvedBlockedReason,
    lastSyncSuccessAt:
      patch.lastSyncSuccessAt ??
      (normalizeNumber(existing.last_sync_success_at) > 0
        ? normalizeNumber(existing.last_sync_success_at)
        : undefined),
    lastAckLamport: patch.lastAckLamport ?? normalizeNumber(existing.last_ack_lamport),
    lastPushedLocalLamport:
      patch.lastPushedLocalLamport ?? normalizeNumber(existing.last_pushed_local_lamport),
  });
}

function buildSyncEventCryptoMeta(
  profileId: string,
  event: Pick<
    EncryptedMemoryEvent,
    "eventId" | "deviceId" | "lamport" | "eventType" | "schemaVersion"
  >,
) {
  return {
    profileId,
    deviceId: event.deviceId,
    lamport: event.lamport,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
  };
}

function toMemoryCipherBytes(cipher: {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  algorithm?: "AES-256-GCM";
}): MemoryCipherBytes {
  return {
    algorithm: cipher.algorithm ?? "AES-256-GCM",
    ciphertext: Uint8Array.from(cipher.ciphertext),
    nonce: Uint8Array.from(cipher.nonce),
  };
}

function toLedgerEventTypeForSync(eventType: string): MemoryEventType {
  switch (eventType) {
    case "PAGE_METADATA_UPDATED":
      return "PAGE_CREATED";
    case "LINKS_REPLACED":
      return "LINK_ADDED";
    case "PROJECTION_SET":
      return "DOC_CRDT_SNAPSHOT";
    case "DASHBOARD_SET":
      return "JOB_CHECKPOINT_UPDATED";
    case "PAGE_CREATED":
    case "PAGE_TOMBSTONED":
    case "DOC_CRDT_SNAPSHOT":
    case "DOC_CRDT_UPDATE":
    case "CLAIM_UPSERTED":
    case "EVIDENCE_ADDED":
    case "ATTACHMENT_ADDED":
    case "CHECKPOINT_CREATED":
    case "JOB_CHECKPOINT_UPDATED":
      return eventType;
    default:
      throw new Error(`unsupported synced memory event type: ${eventType}`);
  }
}

function requireBinaryPayload(value: unknown, fieldName: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return Uint8Array.from(value);
  }
  if (Buffer.isBuffer(value)) {
    return Uint8Array.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return Uint8Array.from(new Uint8Array(value));
  }
  throw new Error(`${fieldName} must be binary data`);
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readBlobNonce(meta: MemoryBlobMeta, blobId: string): Uint8Array {
  const nonceBase64 = typeof meta.nonceBase64 === "string" ? meta.nonceBase64 : "";
  if (!nonceBase64) {
    throw new Error(`memory sync blob ${blobId} is missing nonce metadata`);
  }
  return Uint8Array.from(decodeBase64(nonceBase64));
}

function isLocalMemoryStateEventType(
  eventType: string,
): eventType is MemoryStateEventEnvelopePlain["type"] {
  switch (eventType) {
    case "PAGE_CREATED":
    case "PAGE_METADATA_UPDATED":
    case "PAGE_TOMBSTONED":
    case "DOC_CRDT_SNAPSHOT":
    case "DOC_CRDT_UPDATE":
    case "LINKS_REPLACED":
    case "PROJECTION_SET":
    case "CLAIM_UPSERTED":
    case "EVIDENCE_ADDED":
    case "ATTACHMENT_ADDED":
    case "DASHBOARD_SET":
    case "JOB_CHECKPOINT_UPDATED":
    case "CHECKPOINT_CREATED":
      return true;
    default:
      return false;
  }
}

function normalizeLedgerMemoryEventType(eventType: string): MemoryEventType {
  switch (eventType) {
    case "PAGE_CREATED":
    case "PAGE_METADATA_UPDATED":
    case "PAGE_TOMBSTONED":
    case "DOC_CRDT_SNAPSHOT":
    case "DOC_CRDT_UPDATE":
    case "LINKS_REPLACED":
    case "PROJECTION_SET":
    case "CLAIM_UPSERTED":
    case "EVIDENCE_ADDED":
    case "ATTACHMENT_ADDED":
    case "DASHBOARD_SET":
    case "JOB_CHECKPOINT_UPDATED":
    case "CHECKPOINT_CREATED":
    case "RETRIEVAL_TRACE_RECORDED":
      return eventType;
    default:
      throw new Error(`unsupported memory sync event type: ${eventType}`);
  }
}

function buildCanonicalSyncEventEnvelope(
  event: MemoryStateEventEnvelopePlain,
): CanonicalSyncEventEnvelope {
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    lamport: event.lamport,
    actorId: event.actorId,
    createdAtMs: event.createdAtMs,
    type: event.type,
    payload: { ...(event.payload as Record<string, unknown>) },
    ...(event.pageId ? { pageId: event.pageId } : {}),
    ...(event.source ? { source: event.source } : {}),
    ...(event.batchId ? { batchId: event.batchId } : {}),
  };
}

async function encryptLedgerEventForRelay(
  context: CanonicalStoreContext,
  event: ReturnType<MemoryLedger["listEventsSince"]>[number],
): Promise<EncryptedMemoryEvent> {
  if (!context.sync.crypto || !context.sync.transport) {
    throw new Error("memory sync runtime is not active");
  }
  if (event.payload.kind !== "plain") {
    throw new Error(`memory sync cannot relay encrypted local payloads (${event.meta.eventId})`);
  }

  let plaintextBytes: Uint8Array = Uint8Array.from(event.payload.bytes);
  if (event.meta.eventType === "ATTACHMENT_ADDED") {
    const attachmentEvent = deserializeMemoryStateLedgerEvent(event.payload.bytes, {
      lamport: event.meta.lamport,
      eventType: event.meta.eventType,
      createdAtMs: event.meta.createdAtMs,
    });
    if (!attachmentEvent || attachmentEvent.type !== "ATTACHMENT_ADDED") {
      throw new Error(`failed to decode attachment event ${event.meta.eventId} for relay sync`);
    }
    const attachmentPayload = attachmentEvent.payload as MemoryAttachmentAddedPayload;
    const blobBytes = requireBinaryPayload(attachmentPayload.bytes, "attachment payload bytes");
    const blobCipher = await context.sync.crypto.encryptBlob(attachmentPayload.blobId, blobBytes);
    await context.sync.transport.pushBlob(
      context.ownerProfile.profileId,
      attachmentPayload.blobId,
      blobCipher.ciphertext,
      {
        kind: "attachment",
        version: 1,
        nonceBase64: encodeBase64(blobCipher.nonce),
        mime: attachmentPayload.mime,
        sha256: attachmentPayload.sha256,
        createdAtMs: attachmentPayload.createdAtMs ?? attachmentEvent.createdAtMs,
      },
    );
    const attachmentEnvelope: CanonicalAttachmentBlobEnvelope = {
      version: 1,
      event: {
        ...buildCanonicalSyncEventEnvelope(attachmentEvent),
        payload: {
          ...(attachmentPayload as Record<string, unknown>),
          bytes: undefined,
        },
      },
      blob: {
        blobId: attachmentPayload.blobId,
        kind: "attachment",
      },
    };
    delete attachmentEnvelope.event.payload.bytes;
    plaintextBytes = encodeJsonBytes(attachmentEnvelope);
  }

  const cipher = await context.sync.crypto.encryptEventPayload(
    buildSyncEventCryptoMeta(context.ownerProfile.profileId, event.meta),
    plaintextBytes,
  );
  return {
    eventId: event.meta.eventId,
    deviceId: event.meta.deviceId,
    lamport: event.meta.lamport,
    eventType: event.meta.eventType,
    schemaVersion: event.meta.schemaVersion,
    createdAtMs: event.meta.createdAtMs,
    ciphertext: new Uint8Array(cipher.ciphertext),
    nonce: new Uint8Array(cipher.nonce),
    algorithm: cipher.algorithm,
  };
}

async function decryptRelayEventToPlainPayload(
  context: CanonicalStoreContext,
  event: EncryptedMemoryEvent,
): Promise<Uint8Array> {
  if (!context.sync.crypto) {
    throw new Error("memory sync root key unavailable");
  }
  const plainBytes = await context.sync.crypto.decryptEventPayload(
    buildSyncEventCryptoMeta(context.ownerProfile.profileId, event),
    toMemoryCipherBytes({
      algorithm: event.algorithm,
      ciphertext: new Uint8Array(event.ciphertext),
      nonce: new Uint8Array(event.nonce),
    }),
  );
  if (event.eventType !== "ATTACHMENT_ADDED") {
    return Uint8Array.from(plainBytes);
  }
  if (!context.sync.transport) {
    throw new Error("memory sync transport unavailable for attachment replay");
  }
  const attachmentEnvelope = decodeJsonValue<CanonicalAttachmentBlobEnvelope>(plainBytes);
  if (attachmentEnvelope.event.type !== "ATTACHMENT_ADDED") {
    throw new Error(`attachment relay envelope mismatch for ${event.eventId}`);
  }
  const pulledBlob = await context.sync.transport.pullBlob(
    context.ownerProfile.profileId,
    attachmentEnvelope.blob.blobId,
  );
  if (!pulledBlob) {
    throw new Error(`attachment blob ${attachmentEnvelope.blob.blobId} is missing on the relay`);
  }
  const blobBytes = await context.sync.crypto.decryptBlob(
    attachmentEnvelope.blob.blobId,
    toMemoryCipherBytes({
      ciphertext: new Uint8Array(pulledBlob.cipherBytes),
      nonce: new Uint8Array(readBlobNonce(pulledBlob.meta, attachmentEnvelope.blob.blobId)),
    }),
  );
  const payloadRecord = asJsonRecord(attachmentEnvelope.event.payload);
  if (!payloadRecord) {
    throw new Error(`attachment relay payload is invalid for ${event.eventId}`);
  }
  const plainEvent: MemoryStateEventEnvelopePlain<"ATTACHMENT_ADDED"> = {
    schemaVersion: LEDGER_EVENT_SCHEMA_VERSION,
    eventId: event.eventId,
    lamport: event.lamport,
    actorId: event.deviceId,
    createdAtMs: event.createdAtMs,
    type: "ATTACHMENT_ADDED",
    payload: {
      blobId: String(payloadRecord.blobId ?? attachmentEnvelope.blob.blobId),
      mime: String(payloadRecord.mime ?? "application/octet-stream"),
      bytes: blobBytes,
      sha256: String(payloadRecord.sha256 ?? ""),
      createdAtMs:
        typeof payloadRecord.createdAtMs === "number"
          ? payloadRecord.createdAtMs
          : event.createdAtMs,
    },
    ...(attachmentEnvelope.event.pageId ? { pageId: attachmentEnvelope.event.pageId } : {}),
    ...(attachmentEnvelope.event.source ? { source: attachmentEnvelope.event.source } : {}),
    ...(attachmentEnvelope.event.batchId ? { batchId: attachmentEnvelope.event.batchId } : {}),
  };
  return serializeMemoryStateLedgerEvent(plainEvent);
}

async function appendPulledEncryptedEvents(params: {
  context: CanonicalStoreContext;
  encryptedEvents: readonly EncryptedMemoryEvent[];
  materializeMarkdown?: boolean;
}): Promise<{ insertedCount: number; appliedCount: number }> {
  if (params.encryptedEvents.length === 0) {
    return { insertedCount: 0, appliedCount: 0 };
  }
  const sortedEvents = [...params.encryptedEvents].toSorted((left, right) => {
    if (left.lamport !== right.lamport) {
      return left.lamport - right.lamport;
    }
    if (left.createdAtMs !== right.createdAtMs) {
      return left.createdAtMs - right.createdAtMs;
    }
    return left.eventId.localeCompare(right.eventId);
  });
  const decryptedPayloads = await Promise.all(
    sortedEvents.map(async (event) => ({
      event,
      payload: await decryptRelayEventToPlainPayload(params.context, event),
    })),
  );
  const normalizedPayloads = decryptedPayloads;
  const lastAppliedBefore = readMemoryStateMeta(params.context.db).lastAppliedLamport;
  const appendResults = params.context.ledger.appendBatch(
    normalizedPayloads.map(({ event, payload }) => ({
      meta: {
        eventId: event.eventId,
        profileId: params.context.ownerProfile.profileId,
        deviceId: event.deviceId,
        lamport: event.lamport,
        eventType: normalizeLedgerMemoryEventType(event.eventType),
        createdAtMs: event.createdAtMs,
        schemaVersion: event.schemaVersion,
      },
      payload: new Uint8Array(payload),
    })),
  );
  let insertedCount = 0;
  let appliedCount = 0;
  let requiresRebuild = false;
  for (const [index, result] of appendResults.entries()) {
    if (result?.status !== "inserted") {
      continue;
    }
    insertedCount += 1;
    const decrypted = normalizedPayloads[index];
    if (!isLocalMemoryStateEventType(decrypted.event.eventType)) {
      continue;
    }
    const parsedPlainEvent = deserializeMemoryStateLedgerEvent(decrypted.payload, {
      lamport: decrypted.event.lamport,
      eventType: decrypted.event.eventType,
      createdAtMs: decrypted.event.createdAtMs,
    });
    const plainEvent = parsedPlainEvent
      ? {
          ...parsedPlainEvent,
          eventId: decrypted.event.eventId,
          actorId: decrypted.event.deviceId,
          lamport: decrypted.event.lamport,
          createdAtMs: decrypted.event.createdAtMs,
          schemaVersion: LEDGER_EVENT_SCHEMA_VERSION,
        }
      : null;
    if (!plainEvent) {
      continue;
    }
    if (plainEvent.lamport <= lastAppliedBefore) {
      requiresRebuild = true;
      continue;
    }
    applyEventToDerivedState({
      db: params.context.db,
      event: plainEvent,
      migrationVersion: DERIVED_STATE_MIGRATION_VERSION,
    });
    appliedCount += 1;
  }
  if (requiresRebuild) {
    bootstrapDerivedState({
      db: params.context.db,
      ledger: params.context.ledger,
    });
  }
  await createCheckpointIfNeeded({
    context: params.context,
    lastAppliedLamport: readMemoryStateMeta(params.context.db).lastAppliedLamport,
  });
  if (params.materializeMarkdown !== false && shouldMaterializeAnyMarkdown(params.context.flags)) {
    await materializeMarkdownProjections({
      db: params.context.db,
      workspaceDir: params.context.workspaceDir,
      env: params.context.env,
      flags: params.context.flags,
    });
  }
  return { insertedCount, appliedCount };
}

function readLatestLocalLedgerEvent(context: CanonicalStoreContext) {
  const lastLamport = context.ledger.getStats().lastLamport;
  if (lastLamport <= 0) {
    return null;
  }
  return context.ledger.listEventsSince(Math.max(0, lastLamport - 1), 1)[0] ?? null;
}

async function pushLocalAck(context: CanonicalStoreContext): Promise<void> {
  if (!context.sync.transport) {
    return;
  }
  const latestEvent = readLatestLocalLedgerEvent(context);
  if (!latestEvent) {
    return;
  }
  await context.sync.transport.pushAck(
    context.ownerProfile.profileId,
    context.deviceId,
    latestEvent.meta.lamport,
    latestEvent.meta.eventId,
  );
  context.ledger.recordAck(context.deviceId, latestEvent.meta.lamport, latestEvent.meta.eventId);
  persistCanonicalSyncRuntimeState(context, {
    lastAckLamport: latestEvent.meta.lamport,
  });
}

async function pullRelayAckVector(context: CanonicalStoreContext): Promise<void> {
  if (!context.sync.transport) {
    return;
  }
  const ackVector = await context.sync.transport.pullAckVector(context.ownerProfile.profileId);
  let localAckLamport: number | undefined;
  for (const [replicaId, ack] of Object.entries(ackVector)) {
    context.ledger.recordAck(replicaId, ack.ackLamport, ack.ackEventId);
    if (replicaId === context.deviceId) {
      localAckLamport = ack.ackLamport;
    }
  }
  if (typeof localAckLamport === "number") {
    persistCanonicalSyncRuntimeState(context, {
      lastAckLamport: localAckLamport,
    });
  }
}

async function pushPendingEncryptedEvents(context: CanonicalStoreContext): Promise<number> {
  if (!context.sync.transport || !context.sync.crypto) {
    return 0;
  }
  const syncState = readSyncState(context.db, {
    profileId: context.ownerProfile.profileId,
    workspaceScope: context.baseStatus.workspaceScope,
  });
  let lastPushedLocalLamport = normalizeNumber(syncState.last_pushed_local_lamport);
  let scanCursor = lastPushedLocalLamport;
  while (true) {
    const scannedBatch = context.ledger.listEventsSince(scanCursor, SYNC_PULL_BATCH_LIMIT);
    if (scannedBatch.length === 0) {
      break;
    }
    scanCursor = scannedBatch.at(-1)?.meta.lamport ?? scanCursor;
    const localBatch = scannedBatch.filter((event) => event.meta.deviceId === context.deviceId);
    if (localBatch.length === 0) {
      if (scannedBatch.length < SYNC_PULL_BATCH_LIMIT) {
        break;
      }
      continue;
    }
    if (localBatch.at(-1)?.meta.lamport === lastPushedLocalLamport) {
      break;
    }
    const encryptedBatch = await Promise.all(
      localBatch.map((event) => encryptLedgerEventForRelay(context, event)),
    );
    await context.sync.transport.pushEncryptedEvents(
      context.ownerProfile.profileId,
      encryptedBatch,
    );
    lastPushedLocalLamport = localBatch.at(-1)?.meta.lamport ?? lastPushedLocalLamport;
    persistCanonicalSyncRuntimeState(context, {
      lastPushedLocalLamport,
      cloudState: resolveSyncCloudState(context),
    });
    if (scannedBatch.length < SYNC_PULL_BATCH_LIMIT) {
      break;
    }
  }
  await pushLocalAck(context);
  return lastPushedLocalLamport;
}

async function pullEncryptedEventsFromRelay(context: CanonicalStoreContext): Promise<number> {
  if (!context.sync.transport || !context.sync.crypto) {
    return 0;
  }
  let cursor = Math.max(
    context.ledger.getStats().lastLamport,
    readMemoryStateMeta(context.db).lastAppliedLamport,
  );
  let insertedTotal = 0;
  while (true) {
    const pulledBatch = await context.sync.transport.pullEncryptedEvents(
      context.ownerProfile.profileId,
      cursor,
      SYNC_PULL_BATCH_LIMIT,
    );
    if (pulledBatch.length === 0) {
      break;
    }
    const result = await appendPulledEncryptedEvents({
      context,
      encryptedEvents: pulledBatch,
      materializeMarkdown: false,
    });
    insertedTotal += result.insertedCount;
    cursor = pulledBatch.at(-1)?.lamport ?? cursor;
    if (pulledBatch.length < SYNC_PULL_BATCH_LIMIT) {
      break;
    }
  }
  if (insertedTotal > 0 && shouldMaterializeAnyMarkdown(context.flags)) {
    await materializeMarkdownProjections({
      db: context.db,
      workspaceDir: context.workspaceDir,
      env: context.env,
      flags: context.flags,
    });
  }
  return insertedTotal;
}

async function initializeCanonicalSyncRuntime(context: CanonicalStoreContext): Promise<void> {
  const config = resolveCanonicalSyncConfig(context.cfg, context.env);
  let profileRootKey =
    (await loadProfileRootKey({
      profileId: context.ownerProfile.profileId,
      env: context.env,
      stateDir: context.stateDir,
    })) ?? null;
  let lastError: string | undefined;
  if (!profileRootKey && config.pairingCode) {
    if (!config.pairingPassphrase) {
      lastError = "memory sync pairing code requires a pairing passphrase";
    } else {
      try {
        const imported = await importProfileKeyFromPairingCode({
          pairingCode: config.pairingCode,
          passphrase: config.pairingPassphrase,
          env: context.env,
          stateDir: context.stateDir,
        });
        if (imported.profileId !== context.ownerProfile.profileId) {
          lastError =
            `memory sync pairing code targets ${imported.profileId},` +
            ` expected ${context.ownerProfile.profileId}`;
        } else {
          profileRootKey = imported.profileRootKey;
        }
      } catch (error) {
        lastError = `memory sync pairing import failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
  const accessSession =
    config.mode === "cloud" ? await getAlisioActiveCloudAccessSession(context.env) : null;
  const availability = resolveMemorySyncAvailability({
    enabled: config.enabled,
    mode: config.mode,
    directEnabled: false,
    profileRootKeyAvailable: Boolean(profileRootKey),
    relayBaseUrlConfigured: Boolean(config.relayBaseUrl),
    accessTokenAvailable: Boolean(accessSession?.accessToken),
  });
  const runtimeLastError =
    lastError ??
    (availability.state === "blocked" ? describeSyncBlockedReason(availability.reason) : undefined);
  context.sync = {
    config,
    availability,
    transport:
      availability.state === "active" && availability.mode === "cloud" && config.relayBaseUrl
        ? createCloudRelayMemoryTransport({
            baseUrl: config.relayBaseUrl,
            getAccessToken: async () =>
              (
                (await getAlisioActiveCloudAccessSession(context.env))?.accessToken ??
                accessSession?.accessToken
              )?.trim() || undefined,
          })
        : availability.mode === "direct"
          ? createDirectMemoryTransportStub()
          : null,
    crypto: profileRootKey ? createMemoryCrypto({ profileRootKey }) : null,
    profileRootKey,
    ...(runtimeLastError ? { lastError: runtimeLastError } : {}),
  };
  persistCanonicalSyncRuntimeState(context, {
    cloudState: resolveSyncCloudState(context),
    syncAvailability: availability.state,
    syncModeConfigured: config.mode,
    syncBlockedReason: normalizeSyncBlockedReason(availability.reason),
    lastError: context.sync.lastError ?? null,
  });
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
  return uniqueStrings(
    rows
      .map((row) => parseMarkdownProjectionPath(row.kind))
      .filter((value): value is string => Boolean(value)),
  );
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
        kind: resolveMarkdownProjectionKind(projection.relativePath),
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
  encryptCheckpointSnapshot?: (
    snapshot: MemoryStateCheckpointSnapshot,
  ) => Promise<string | null | undefined>;
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
  const ledger = openProfileMemoryLedger(ownerProfile.profileId, stateDir);
  try {
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
      cfg: params.cfg,
      env,
      baseStatus,
      ownerProfile,
      deviceId: deviceIdentity.deviceId,
      stateDir,
      db,
      ledger,
      flags,
      backend: params.backend,
      workspaceDir: params.workspaceDir,
      sync: createInactiveSyncRuntime(params.cfg, env),
      encryptCheckpointSnapshot: params.encryptCheckpointSnapshot,
    };
  } catch (error) {
    ledger.close();
    db.close();
    throw error;
  }
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
  forceCheckpoint?: boolean;
  encryptCheckpointSnapshot?: (
    snapshot: MemoryStateCheckpointSnapshot,
  ) => Promise<string | null | undefined>;
}): Promise<MemoryWriteEventResult> {
  const context = createCanonicalContext(params);
  try {
    await initializeCanonicalLedgerState(context);
    await initializeCanonicalSyncRuntime(context);
    return await applyEventDrafts({
      context,
      drafts: params.events,
      materializeMarkdown: params.materializeMarkdown,
      forceCheckpoint: params.forceCheckpoint,
    });
  } finally {
    context.db.close();
    context.ledger.close();
  }
}

export async function memoryPullApplySync(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  encryptedEvents: EncryptedMemoryEvent[];
  env?: NodeJS.ProcessEnv;
  materializeMarkdown?: boolean;
  encryptCheckpointSnapshot?: (
    snapshot: MemoryStateCheckpointSnapshot,
  ) => Promise<string | null | undefined>;
}): Promise<MemoryPullApplySyncResult> {
  const context = createCanonicalContext(params);
  try {
    await initializeCanonicalLedgerState(context);
    await initializeCanonicalSyncRuntime(context);
    if (!context.sync.crypto) {
      throw new Error("memory sync blocked: missing profile root key");
    }
    const result = await appendPulledEncryptedEvents({
      context,
      encryptedEvents: params.encryptedEvents,
      materializeMarkdown: params.materializeMarkdown,
    });
    persistCanonicalSyncRuntimeState(context, {
      cloudState: params.encryptedEvents.length > 0 ? "enabled" : resolveSyncCloudState(context),
      lastSyncedLamport: readMemoryStateMeta(context.db).lastAppliedLamport,
      lastSyncSuccessAt: Date.now(),
      lastError: null,
    });
    return {
      status: buildReadyStatusFromContext(context),
      appliedCount: result.appliedCount,
      stateHash: computeMemoryStateHash(context.db),
    };
  } finally {
    context.db.close();
    context.ledger.close();
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
  encryptCheckpointSnapshot?: (
    snapshot: MemoryStateCheckpointSnapshot,
  ) => Promise<string | null | undefined>;
}): Promise<CanonicalMemoryStoreStatus> {
  const context = createCanonicalContext(params);
  try {
    await initializeCanonicalLedgerState(context);
    await initializeCanonicalSyncRuntime(context);
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
    context.ledger.close();
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
  return uniqueStrings(
    rows
      .map((row) => parseMarkdownProjectionPath(row.kind))
      .filter((value): value is string => Boolean(value)),
  ).map(
    (relativePath) =>
      ({
        projectionId: hashText(`${pageId}:${relativePath}`),
        path: relativePath,
        sourceKind: "workspace-memory",
        editable: true,
      }) satisfies CanonicalMemoryGraphProjection,
  );
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
        parseMarkdownProjectionPath(row.related_projection_kind ?? "") ??
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
  query?: string;
  pageId?: string;
  entityId?: string;
  scope?: "global" | "local";
  direction?: CanonicalRelationDirection | "both";
  depth?: number;
  matchLimit?: number;
  relationLimit?: number;
  nodeLimit?: number;
  edgeLimit?: number;
  includeAttachments?: boolean;
}): CanonicalMemoryGraphResult {
  return queryCanonicalMemoryGraphFromStore(params);
}

export async function syncCanonicalMemoryStore(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  env?: NodeJS.ProcessEnv;
  encryptCheckpointSnapshot?: (
    snapshot: MemoryStateCheckpointSnapshot,
  ) => Promise<string | null | undefined>;
}): Promise<CanonicalMemoryStoreStatus> {
  const context = createCanonicalContext(params);
  try {
    await initializeCanonicalLedgerState(context);
    await initializeCanonicalSyncRuntime(context);
    let syncFailed = false;
    if (context.sync.availability.state === "active") {
      try {
        await pullEncryptedEventsFromRelay(context);
        await pullRelayAckVector(context);
      } catch (error) {
        syncFailed = true;
        persistCanonicalSyncRuntimeState(context, {
          cloudState: resolveSyncCloudState(context, true),
          lastSyncedLamport: readMemoryStateMeta(context.db).lastAppliedLamport,
          lastError: `memory sync pull failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else {
      persistCanonicalSyncRuntimeState(context, {
        cloudState: resolveSyncCloudState(context),
        lastSyncedLamport: readMemoryStateMeta(context.db).lastAppliedLamport,
        lastError: context.sync.lastError ?? null,
      });
    }
    await syncWorkspaceImports(context);
    if (context.sync.availability.state === "active") {
      syncFailed = syncFailed || Boolean(context.sync.lastError);
      if (!syncFailed) {
        try {
          await pushPendingEncryptedEvents(context);
          await pullRelayAckVector(context);
        } catch (error) {
          syncFailed = true;
          persistCanonicalSyncRuntimeState(context, {
            cloudState: resolveSyncCloudState(context, true),
            lastSyncedLamport: readMemoryStateMeta(context.db).lastAppliedLamport,
            lastError: `memory sync finalization failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      if (!syncFailed) {
        persistCanonicalSyncRuntimeState(context, {
          cloudState: resolveSyncCloudState(context),
          lastSyncedLamport: readMemoryStateMeta(context.db).lastAppliedLamport,
          lastSyncSuccessAt: Date.now(),
          lastError: null,
        });
      }
    }
    return buildReadyStatusFromContext(context);
  } finally {
    context.db.close();
    context.ledger.close();
  }
}
