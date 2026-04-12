import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import { ensureMemoryStateSchema } from "../../packages/memory-state/src/schema.js";

export type SearchImpl = () => Promise<unknown[]>;
export type MemoryReadParams = { relPath: string; from?: number; lines?: number };
export type MemoryReadResult = { text: string; path: string };
type MemoryBackend = "builtin" | "qmd";
type CanonicalStorePayload = {
  state: "pending-sync" | "ready";
  path: string;
  profileId: string;
  profileSource: string;
  workspaceScope: string;
  workspaceDir: string;
  backend: MemoryBackend;
  entities: number;
  relations: number;
  projections: number;
  projectionInterface: "markdown-repo";
  syncMode: "local-first";
  cloudSync: "unavailable" | "enabled" | "error";
  projectionSources: Array<"workspace-memory">;
  lastSyncedAt?: string;
  lastError?: string;
};

export type CanonicalFixture = {
  tempDir: string;
  dbPath: string;
  profileId: string;
  atlasPageId: string;
  atlasProjectionId: string;
  atlasDisplayPath: string;
  atlasLocator: string;
  roadmapPageId: string;
  roadmapProjectionId: string;
  roadmapDisplayPath: string;
  roadmapLocator: string;
  privatePageId: string;
  privateProjectionId: string;
  privateDisplayPath: string;
};

let backend: MemoryBackend = "builtin";
let searchImpl: SearchImpl = async () => [];
let readFileImpl: (params: MemoryReadParams) => Promise<MemoryReadResult> = async (params) => ({
  text: "",
  path: params.relPath,
});
let canonicalStoreStatus: CanonicalStorePayload | null = null;
let canonicalFixture: CanonicalFixture | null = null;

function buildProjectionId(pageId: string, projectionKind: string): string {
  return `projection:${createHash("sha256").update(`${pageId}:${projectionKind}`).digest("hex").slice(0, 24)}`;
}

function buildProjectionLocator(profileId: string, pageId: string, projectionId: string): string {
  return `memory://profiles/${profileId}/pages/${pageId}/projections/${projectionId}`;
}

function cleanupCanonicalFixture(): void {
  if (!canonicalFixture) {
    return;
  }
  rmSync(canonicalFixture.tempDir, { recursive: true, force: true });
  canonicalFixture = null;
}

function createCanonicalFixture(currentBackend: MemoryBackend): {
  fixture: CanonicalFixture;
  status: CanonicalStorePayload;
} {
  const tempDir = mkdtempSync(path.join(tmpdir(), "alisio-memory-tools-"));
  const dbPath = path.join(tempDir, "canonical.sqlite");
  const db = new DatabaseSync(dbPath);
  const now = Date.now();
  const profileId = "local-main";
  const atlasPageId = "page-atlas";
  const roadmapPageId = "page-roadmap";
  const privatePageId = "page-private-direct";
  const projectionKind = "page";
  const privateProjectionKind = "legacy-markdown:sessions/direct-brief.md";
  const atlasProjectionId = buildProjectionId(atlasPageId, projectionKind);
  const roadmapProjectionId = buildProjectionId(roadmapPageId, projectionKind);
  const privateProjectionId = buildProjectionId(privatePageId, privateProjectionKind);
  const atlasDisplayPath = "memory/project-atlas.md";
  const roadmapDisplayPath = "memory/roadmap.md";
  const privateDisplayPath = "sessions/direct-brief.md";

  ensureMemoryStateSchema(db);
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
    CREATE TABLE IF NOT EXISTS imported_files (
      source_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      page_id TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);

  db.prepare(
    `INSERT INTO pages (page_id, title, slug, created_at_ms, updated_at_ms, tombstoned)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(atlasPageId, "Project Atlas", "project-atlas", now - 10_000, now - 1_000);
  db.prepare(
    `INSERT INTO pages (page_id, title, slug, created_at_ms, updated_at_ms, tombstoned)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(roadmapPageId, "Roadmap", "roadmap", now - 20_000, now - 2_000);
  db.prepare(
    `INSERT INTO pages (page_id, title, slug, created_at_ms, updated_at_ms, tombstoned)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(privatePageId, "Direct Brief", "direct-brief", now - 30_000, now - 3_000);

  db.prepare(
    `INSERT INTO projections (page_id, kind, markdown_body, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
  ).run(
    atlasPageId,
    projectionKind,
    "# Project Atlas\nProject Atlas notes and launch checklist.\nOwner: Alice",
    now - 1_000,
  );
  db.prepare(
    `INSERT INTO projections (page_id, kind, markdown_body, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
  ).run(
    roadmapPageId,
    projectionKind,
    "# Roadmap\nQuarterly roadmap and milestones.\nDepends on Atlas.",
    now - 2_000,
  );
  db.prepare(
    `INSERT INTO projections (page_id, kind, markdown_body, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
  ).run(
    privatePageId,
    privateProjectionKind,
    "# Direct Brief\nPrivate session follow-up and transcript summary.",
    now - 3_000,
  );

  db.prepare(
    `INSERT INTO imported_files (source_path, content_hash, page_id, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
  ).run(atlasDisplayPath, "hash-atlas", atlasPageId, now - 1_000);
  db.prepare(
    `INSERT INTO imported_files (source_path, content_hash, page_id, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
  ).run(roadmapDisplayPath, "hash-roadmap", roadmapPageId, now - 2_000);
  db.prepare(
    `INSERT INTO imported_files (source_path, content_hash, page_id, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
  ).run(privateDisplayPath, "hash-private", privatePageId, now - 3_000);

  db.prepare(
    `INSERT INTO page_aliases (page_id, alias_key, ordinal)
     VALUES (?, ?, ?)`,
  ).run(atlasPageId, "project atlas", 0);
  db.prepare(
    `INSERT INTO page_aliases (page_id, alias_key, ordinal)
     VALUES (?, ?, ?)`,
  ).run(atlasPageId, "atlas", 1);
  db.prepare(
    `INSERT INTO page_aliases (page_id, alias_key, ordinal)
     VALUES (?, ?, ?)`,
  ).run(roadmapPageId, "roadmap", 0);

  db.prepare(
    `INSERT INTO page_tags (page_id, tag, ordinal)
     VALUES (?, ?, ?)`,
  ).run(atlasPageId, "pinned", 0);
  db.prepare(
    `INSERT INTO page_tags (page_id, tag, ordinal)
     VALUES (?, ?, ?)`,
  ).run(atlasPageId, "project", 1);
  db.prepare(
    `INSERT INTO page_tags (page_id, tag, ordinal)
     VALUES (?, ?, ?)`,
  ).run(roadmapPageId, "plan", 0);

  db.prepare(
    `INSERT INTO links (from_page_id, to_page_id, type, ordinal)
     VALUES (?, ?, ?, ?)`,
  ).run(atlasPageId, roadmapPageId, "references", 0);
  db.prepare(
    `INSERT INTO links (from_page_id, to_page_id, type, ordinal)
     VALUES (?, ?, ?, ?)`,
  ).run(atlasPageId, privatePageId, "references", 1);

  db.prepare(
    `INSERT INTO claims (claim_id, subject, predicate, object, confidence, status, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("claim-atlas-status", "Project Atlas", "status", "active", 0.92, "active", now - 900);
  db.prepare(
    `INSERT INTO evidence (evidence_id, claim_id, source_locator, quote, hash, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "evidence-atlas-status",
    "claim-atlas-status",
    buildProjectionLocator(profileId, atlasPageId, atlasProjectionId),
    "Project Atlas notes and launch checklist.",
    "hash-atlas-status",
    now - 900,
  );

  db.prepare(
    `INSERT INTO ledger_events (
       event_id, lamport, actor_id, event_type, page_id, source, batch_id, created_at_ms, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "event-atlas-update",
    1,
    "actor-main",
    "PAGE_UPDATED",
    atlasPageId,
    "workspace-memory",
    null,
    now - 800,
    JSON.stringify({ markdownBody: "Project Atlas notes updated for launch readiness." }),
  );
  db.prepare(
    `INSERT INTO ledger_events (
       event_id, lamport, actor_id, event_type, page_id, source, batch_id, created_at_ms, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "event-roadmap-update",
    2,
    "actor-main",
    "PAGE_UPDATED",
    roadmapPageId,
    "workspace-memory",
    null,
    now - 700,
    JSON.stringify({ title: "Roadmap updated" }),
  );

  db.close();

  const fixture: CanonicalFixture = {
    tempDir,
    dbPath,
    profileId,
    atlasPageId,
    atlasProjectionId,
    atlasDisplayPath,
    atlasLocator: buildProjectionLocator(profileId, atlasPageId, atlasProjectionId),
    roadmapPageId,
    roadmapProjectionId,
    roadmapDisplayPath,
    roadmapLocator: buildProjectionLocator(profileId, roadmapPageId, roadmapProjectionId),
    privatePageId,
    privateProjectionId,
    privateDisplayPath,
  };
  const status: CanonicalStorePayload = {
    state: "ready",
    path: dbPath,
    profileId,
    profileSource: "local-profile",
    workspaceScope: "scope-main",
    workspaceDir: "/workspace",
    backend: currentBackend,
    entities: 2,
    relations: 1,
    projections: 2,
    projectionInterface: "markdown-repo",
    syncMode: "local-first",
    cloudSync: "unavailable",
    projectionSources: ["workspace-memory"],
    lastSyncedAt: "2026-04-08T10:00:00.000Z",
  };
  return { fixture, status };
}

const stubManager = {
  search: vi.fn(async () => await searchImpl()),
  readFile: vi.fn(async (params: MemoryReadParams) => await readFileImpl(params)),
  status: () => ({
    backend,
    files: 2,
    chunks: 2,
    dirty: false,
    workspaceDir: "/workspace",
    dbPath: "/workspace/.memory/index.sqlite",
    provider: "builtin",
    model: "builtin",
    requestedProvider: "builtin",
    sources: ["memory" as const],
    sourceCounts: [{ source: "memory" as const, files: 2, chunks: 2 }],
    custom: canonicalStoreStatus ? { canonicalStore: canonicalStoreStatus } : undefined,
  }),
  sync: vi.fn(),
  probeVectorAvailability: vi.fn(async () => true),
  close: vi.fn(),
};

const getMemorySearchManagerMock = vi.fn(async () => ({ manager: stubManager }));
const readAgentMemoryFileMock = vi.fn(
  async (params: MemoryReadParams) => await readFileImpl(params),
);

const { memoryIndexModuleId, memoryToolsRuntimeModuleId } = vi.hoisted(() => ({
  memoryIndexModuleId: "../../extensions/memory-core/src/memory/index.js",
  memoryToolsRuntimeModuleId: "../../extensions/memory-core/src/tools.runtime.js",
}));

vi.mock(memoryIndexModuleId, () => ({
  getMemorySearchManager: getMemorySearchManagerMock,
}));

vi.mock("../../packages/memory-host-sdk/src/host/read-file.js", () => ({
  readAgentMemoryFile: readAgentMemoryFileMock,
}));

vi.mock(memoryToolsRuntimeModuleId, () => ({
  resolveMemoryBackendConfig: ({
    cfg,
  }: {
    cfg?: { memory?: { backend?: string; qmd?: unknown } };
  }) => ({
    backend,
    qmd: cfg?.memory?.qmd,
  }),
  getMemorySearchManager: getMemorySearchManagerMock,
  readAgentMemoryFile: readAgentMemoryFileMock,
}));

export function setMemoryBackend(next: MemoryBackend): void {
  backend = next;
}

export function setMemorySearchImpl(next: SearchImpl): void {
  searchImpl = next;
}

export function setMemoryReadFileImpl(
  next: (params: MemoryReadParams) => Promise<MemoryReadResult>,
): void {
  readFileImpl = next;
}

export function getCanonicalFixture(): CanonicalFixture {
  if (!canonicalFixture) {
    throw new Error("canonical fixture not initialized");
  }
  return canonicalFixture;
}

export function resetMemoryToolMockState(overrides?: {
  backend?: MemoryBackend;
  searchImpl?: SearchImpl;
  readFileImpl?: (params: MemoryReadParams) => Promise<MemoryReadResult>;
  canonicalStoreStatus?: CanonicalStorePayload | null;
}): void {
  cleanupCanonicalFixture();
  backend = overrides?.backend ?? "builtin";
  searchImpl = overrides?.searchImpl ?? (async () => []);
  readFileImpl =
    overrides?.readFileImpl ??
    (async (params: MemoryReadParams) => ({ text: "", path: params.relPath }));
  if (overrides?.canonicalStoreStatus !== undefined) {
    canonicalStoreStatus = overrides.canonicalStoreStatus;
  } else {
    const seeded = createCanonicalFixture(backend);
    canonicalFixture = seeded.fixture;
    canonicalStoreStatus = seeded.status;
  }
  vi.clearAllMocks();
}

export function setCanonicalStoreStatus(next: CanonicalStorePayload | null): void {
  canonicalStoreStatus = next;
}

export function getMemorySearchManagerMockCalls(): number {
  return getMemorySearchManagerMock.mock.calls.length;
}

export function getReadAgentMemoryFileMockCalls(): number {
  return readAgentMemoryFileMock.mock.calls.length;
}
