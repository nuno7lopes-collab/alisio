import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { GatewayRequestHandlerOptions } from "alisio/plugin-sdk/core";
import { resolveAgentWorkspaceDir } from "alisio/plugin-sdk/memory-core-host-engine-foundation";
import { requireNodeSqlite } from "alisio/plugin-sdk/memory-core-host-engine-storage";
import { loadConfig, resolveStateDir } from "alisio/plugin-sdk/memory-core-host-runtime-core";
import { resolveMemoryBackendConfig } from "alisio/plugin-sdk/memory-core-host-runtime-files";
import { syncCanonicalMemoryStore } from "../memory/canonical-store.js";
import { readAttachmentOriginsFromLedger } from "../memory/ledger-interop.js";
import { type CanonicalMemoryStoreStatus } from "./memory/canonical-store.js";
import { getMemorySearchManager } from "./memory/index.js";

type GatewayRespond = GatewayRequestHandlerOptions["respond"];

type MemoryReasonTag = {
  code: string;
  label: string;
  detail?: string;
};

type MemorySyncSurface = {
  lastSyncedLamport?: number;
  e2eeRequired?: true;
  state?: string;
  mode?: string;
  blockedReason?: string;
  lastSuccessAt?: string;
  lastAckLamport?: number;
  pendingBacklog?: number;
  detail?: string;
};

type NativeFileTrace = {
  kind: "files";
  query: string;
  candidateCount: number;
  hitCount: number;
  hits: Array<{
    id: string;
    name: string;
    mediaType: string;
    reasons: string[];
  }>;
  reasons: string[];
};

type NativeMemoryContext = {
  agentId: string;
  canonicalStore: CanonicalMemoryStoreStatus;
  close(): Promise<void>;
};

type AttachmentRow = {
  blob_id: string;
  mime: string;
  bytes: Uint8Array | Buffer;
  sha256: string;
  created_at_ms: number | bigint;
};

type AttachmentLedgerOrigin = {
  eventId: string;
  lamport: number;
  actorId: string;
  createdAt: string | null;
  pageId: string | null;
};

type NativeMemoryFileLink = {
  pageId: string;
  entityId: string;
  title: string;
  path: string;
  relation: "attached" | "mentioned";
};

type NativeMemoryFileOrigin = {
  eventId: string;
  lamport: number;
  actorId: string;
  createdAt?: string | null;
  pageId?: string | null;
  entityId?: string | null;
  pageTitle?: string | null;
  pagePath?: string | null;
};

type NativeMemoryFilePreviewKind =
  | "markdown"
  | "text"
  | "json"
  | "image"
  | "audio"
  | "pdf"
  | "binary";

type NativeMemoryFilePreview = {
  kind: NativeMemoryFilePreviewKind;
  mediaType: string;
  lineCount?: number;
  text?: string;
  bytesBase64?: string;
  truncated?: boolean;
  fallbackLabel?: string;
};

type NativeMemoryFileDownload = {
  fileName: string;
  mediaType: string;
  bytesBase64: string;
};

type NativeMemoryFileListEntry = {
  id: string;
  name: string;
  mediaType: string;
  previewKind: NativeMemoryFilePreviewKind;
  size: number;
  sha256: string;
  updatedAt: string | null;
  summary: string;
  provenanceSummary: string;
  relatedPagesCount: number;
  primaryPage?: NativeMemoryFileLink;
  origin?: NativeMemoryFileOrigin;
  provenance: Array<{ label: string; value: string }>;
  reasonTags?: MemoryReasonTag[];
  trace?: NativeFileTrace;
  traceSummary?: string[];
};

type NativeMemoryFileDetail = NativeMemoryFileListEntry & {
  preview: NativeMemoryFilePreview;
  download: NativeMemoryFileDownload;
  relatedPages: NativeMemoryFileLink[];
};

const MARKDOWN_PROJECTION_PREFIX_ALIASES = ["md-path:", "legacy-markdown:"] as const;
const INLINE_TEXT_PREVIEW_MAX_CHARS = 24_000;
const INLINE_BINARY_PREVIEW_MAX_BYTES = 1_500_000;

function respondGatewayError(respond: GatewayRespond, code: string, message: string) {
  respond(false, undefined, { code, message });
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIso(value: unknown): string | null {
  const numeric = normalizeNumber(value);
  return numeric == null || numeric <= 0 ? null : new Date(numeric).toISOString();
}

function asBuffer(value: Uint8Array | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function summarizeText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function normalizeDisplayPath(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\.?\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    normalized.startsWith("../") ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("memory path must stay within the configured roots");
  }
  return segments.join("/");
}

function parseMarkdownProjectionPath(kind: string): string | null {
  for (const prefix of MARKDOWN_PROJECTION_PREFIX_ALIASES) {
    if (!kind.startsWith(prefix)) {
      continue;
    }
    const relativePath = kind.slice(prefix.length);
    return relativePath ? normalizeDisplayPath(relativePath) : null;
  }
  return null;
}

function extensionForMediaType(mediaType: string): string {
  const normalized = mediaType.toLowerCase();
  if (normalized === "application/pdf") {
    return ".pdf";
  }
  if (normalized === "application/json") {
    return ".json";
  }
  if (normalized === "text/markdown") {
    return ".md";
  }
  if (normalized.startsWith("text/")) {
    return ".txt";
  }
  if (normalized === "image/png") {
    return ".png";
  }
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/webp") {
    return ".webp";
  }
  if (normalized.startsWith("audio/")) {
    return ".mp3";
  }
  return "";
}

function resolveAttachmentName(blobId: string, mediaType: string): string {
  const trimmed = blobId.trim();
  if (/^[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}$/.test(trimmed)) {
    return trimmed;
  }
  return `attachment-${trimmed.slice(0, 12) || "file"}${extensionForMediaType(mediaType)}`;
}

function resolvePreviewKind(name: string, mediaType: string): NativeMemoryFilePreviewKind {
  const normalizedMediaType = mediaType.toLowerCase();
  const extension = path.extname(name).toLowerCase();
  if (normalizedMediaType === "application/json" || extension === ".json") {
    return "json";
  }
  if (normalizedMediaType === "text/markdown" || extension === ".md") {
    return "markdown";
  }
  if (normalizedMediaType === "application/pdf" || extension === ".pdf") {
    return "pdf";
  }
  if (normalizedMediaType.startsWith("image/")) {
    return "image";
  }
  if (normalizedMediaType.startsWith("audio/")) {
    return "audio";
  }
  if (normalizedMediaType.startsWith("text/")) {
    return "text";
  }
  return "binary";
}

function uniqueByKey<T>(values: Iterable<T>, keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    const key = keyFor(value).trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

function scoreByQuery(
  query: string,
  fields: Record<string, string[]>,
  updatedAtMs?: number | null,
): { score: number; reasonTags: MemoryReasonTag[] } {
  const loweredQuery = query.trim().toLowerCase();
  if (!loweredQuery) {
    return { score: 0, reasonTags: [] };
  }
  const reasonTags: MemoryReasonTag[] = [];
  let score = 0;
  const containsTerm = (value: string) => value.toLowerCase().includes(loweredQuery);
  const exactTerm = (value: string) => value.toLowerCase() === loweredQuery;
  const startsTerm = (value: string) => value.toLowerCase().startsWith(loweredQuery);
  const addReason = (code: string, label: string, weight: number, detail?: string) => {
    if (!reasonTags.some((tag) => tag.code === code)) {
      reasonTags.push({ code, label, ...(detail ? { detail } : {}) });
    }
    score = Math.max(score, weight);
  };

  if (fields.title.some(exactTerm)) {
    addReason("exact_title", "Title", 1);
  } else if (fields.title.some(startsTerm)) {
    addReason("title_prefix", "Title", 0.92);
  } else if (fields.title.some(containsTerm)) {
    addReason("title", "Title", 0.84);
  }
  if (fields.alias.some(exactTerm)) {
    addReason("alias_exact", "Alias", 0.9);
  } else if (fields.alias.some(containsTerm)) {
    addReason("alias", "Alias", 0.78);
  }
  if (fields.path.some(exactTerm)) {
    addReason("path_exact", "Path", 0.88);
  } else if (fields.path.some(containsTerm)) {
    addReason("path", "Path", 0.74);
  }
  if (fields.tag.some(exactTerm)) {
    addReason("tag_exact", "Tag", 0.8);
  } else if (fields.tag.some(containsTerm)) {
    addReason("tag", "Tag", 0.68);
  }
  if (fields.body.some(containsTerm)) {
    addReason("content", "Content", 0.62);
  }

  if (updatedAtMs && Date.now() - updatedAtMs < 7 * 86_400_000) {
    reasonTags.push({ code: "recent", label: "Recent" });
    score = Math.max(score, 0.56);
  }

  return { score, reasonTags };
}

function buildTraceSummary(
  trace: { query?: string; hitCount?: number },
  reasonTags: MemoryReasonTag[],
): string[] {
  const query = normalizeString(trace.query);
  const hitCount = normalizeNumber(trace.hitCount);
  const lines: string[] = [];
  if (query) {
    lines.push(`Query: ${query}`);
  }
  if (reasonTags.length > 0) {
    lines.push(`Reasons: ${reasonTags.map((tag) => tag.label).join(", ")}`);
  }
  if (hitCount != null) {
    lines.push(`Hits: ${hitCount}`);
  }
  return lines;
}

function buildFileTrace(params: {
  query: string;
  file: { id: string; name: string; mediaType: string };
  reasonTags: MemoryReasonTag[];
  candidateCount: number;
  hitCount: number;
}): NativeFileTrace {
  const reasons = params.reasonTags.map((tag) => tag.code);
  return {
    kind: "files",
    query: params.query,
    candidateCount: params.candidateCount,
    hitCount: params.hitCount,
    hits: [
      {
        id: params.file.id,
        name: params.file.name,
        mediaType: params.file.mediaType,
        reasons,
      },
    ],
    reasons,
  };
}

function asCanonicalStoreStatus(value: unknown): CanonicalMemoryStoreStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<CanonicalMemoryStoreStatus>;
  if (
    !record.path ||
    !record.profileId ||
    !record.workspaceScope ||
    !record.workspaceDir ||
    !record.backend ||
    !record.projectionInterface ||
    !record.syncMode ||
    !record.cloudSync ||
    !record.state
  ) {
    return null;
  }
  return record as CanonicalMemoryStoreStatus;
}

async function resolveNativeMemoryContext(params: {
  method: string;
  request: Record<string, unknown>;
  respond: GatewayRespond;
  syncIfDirty?: boolean;
}): Promise<NativeMemoryContext | null> {
  const agentId = normalizeString(params.request.agentId);
  if (!agentId) {
    respondGatewayError(params.respond, "INVALID_REQUEST", `${params.method} requires agentId`);
    return null;
  }
  const cfg = loadConfig();
  const tryDirectCanonicalStore = async (): Promise<NativeMemoryContext | null> => {
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const backendConfig = resolveMemoryBackendConfig({ cfg, agentId });
    if (!workspaceDir || !backendConfig) {
      return null;
    }
    const canonicalStore = await syncCanonicalMemoryStore({
      cfg,
      agentId,
      workspaceDir,
      backend: backendConfig.backend,
      env: process.env,
    });
    return {
      agentId,
      canonicalStore,
      async close() {},
    };
  };
  const { manager, error } = await getMemorySearchManager({
    cfg,
    agentId,
    purpose: "status",
  });
  if (!manager) {
    const fallback = await tryDirectCanonicalStore().catch(() => null);
    if (fallback) {
      return fallback;
    }
    respondGatewayError(
      params.respond,
      "UNAVAILABLE",
      `${params.method} unavailable: ${error ?? "memory manager unavailable"}`,
    );
    return null;
  }
  try {
    const initialStatus = manager.status();
    let canonicalStore = asCanonicalStoreStatus(initialStatus.custom?.canonicalStore);
    if (canonicalStore && canReadCanonicalStore(canonicalStore)) {
      if (
        params.syncIfDirty !== false &&
        manager.sync &&
        (initialStatus.dirty || canonicalStore.state !== "ready")
      ) {
        await manager.sync({ reason: params.method, force: true });
        const syncedStore = asCanonicalStoreStatus(manager.status().custom?.canonicalStore);
        if (syncedStore && canReadCanonicalStore(syncedStore)) {
          canonicalStore = syncedStore;
        }
      }
      return {
        agentId,
        canonicalStore,
        async close() {
          await manager.close?.().catch(() => {});
        },
      };
    }
    if (params.syncIfDirty !== false && manager.sync) {
      await manager.sync({ reason: params.method, force: true });
      canonicalStore = asCanonicalStoreStatus(manager.status().custom?.canonicalStore);
      if (canonicalStore && canReadCanonicalStore(canonicalStore)) {
        return {
          agentId,
          canonicalStore,
          async close() {
            await manager.close?.().catch(() => {});
          },
        };
      }
    }
    const fallback = await tryDirectCanonicalStore().catch(() => null);
    if (fallback && canReadCanonicalStore(fallback.canonicalStore)) {
      await manager.close?.().catch(() => {});
      return fallback;
    }
    if (!canonicalStore) {
      respondGatewayError(
        params.respond,
        "UNAVAILABLE",
        `${params.method} unavailable: canonical memory store unavailable`,
      );
      return null;
    }
    respondGatewayError(
      params.respond,
      "UNAVAILABLE",
      `${params.method} unavailable: canonical memory store is not initialized yet`,
    );
    return null;
  } catch (error) {
    await manager.close?.().catch(() => {});
    const fallback = await tryDirectCanonicalStore().catch(() => null);
    if (fallback && canReadCanonicalStore(fallback.canonicalStore)) {
      return fallback;
    }
    respondGatewayError(
      params.respond,
      "UNAVAILABLE",
      `${params.method} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function openCanonicalDb(status: CanonicalMemoryStoreStatus): DatabaseSync {
  const { DatabaseSync } = requireNodeSqlite();
  return new DatabaseSync(status.path, { readOnly: true });
}

function canReadCanonicalStore(status: CanonicalMemoryStoreStatus): boolean {
  try {
    const db = openCanonicalDb(status);
    try {
      const row = db
        .prepare(
          `SELECT 1 AS found
           FROM sqlite_master
           WHERE type = 'table' AND name = 'pages'
           LIMIT 1`,
        )
        .get() as
        | {
            found?: number;
          }
        | undefined;
      return row?.found === 1;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

function buildSyncSurface(status: CanonicalMemoryStoreStatus): MemorySyncSurface {
  const detailParts = [
    `mode ${status.syncModeConfigured}`,
    ...(status.syncBlockedReason ? [`blocked ${status.syncBlockedReason}`] : []),
    ...(typeof status.lastAckLamport === "number" ? [`ack ${String(status.lastAckLamport)}`] : []),
    ...(typeof status.pendingBacklog === "number"
      ? [`backlog ${String(status.pendingBacklog)}`]
      : []),
    ...(status.lastSyncSuccessAt ? [`last success ${status.lastSyncSuccessAt}`] : []),
    ...(status.lastError ? [status.lastError] : []),
  ];
  return {
    lastSyncedLamport: status.lastSyncedLamport,
    e2eeRequired: true,
    state: status.syncAvailability,
    mode: status.syncModeConfigured,
    ...(status.syncBlockedReason ? { blockedReason: status.syncBlockedReason } : {}),
    ...(status.lastSyncSuccessAt ? { lastSuccessAt: status.lastSyncSuccessAt } : {}),
    ...(typeof status.lastAckLamport === "number" ? { lastAckLamport: status.lastAckLamport } : {}),
    ...(typeof status.pendingBacklog === "number" ? { pendingBacklog: status.pendingBacklog } : {}),
    ...(detailParts.length > 0 ? { detail: detailParts.join("; ") } : {}),
  };
}

function latestProjectionPathForPage(db: DatabaseSync, pageId: string): string | null {
  const row = db
    .prepare(
      `SELECT kind, slug
       FROM (
         SELECT pr.kind AS kind, p.slug AS slug, pr.updated_at_ms AS updated_at_ms
         FROM pages p
         INNER JOIN projections pr
           ON pr.page_id = p.page_id
         WHERE p.page_id = ? AND p.tombstoned = 0
         ORDER BY pr.updated_at_ms DESC, pr.kind ASC
         LIMIT 1
       )`,
    )
    .get(pageId) as
    | {
        kind: string;
        slug: string;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return parseMarkdownProjectionPath(row.kind) ?? `memory/${row.slug || pageId.toLowerCase()}.md`;
}

function readPageLink(db: DatabaseSync, pageId: string): NativeMemoryFileLink | null {
  const row = db
    .prepare(
      `SELECT page_id, title, slug
       FROM pages
       WHERE page_id = ? AND tombstoned = 0
       LIMIT 1`,
    )
    .get(pageId) as
    | {
        page_id: string;
        title: string;
        slug: string;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    pageId: row.page_id,
    entityId: row.page_id,
    title: row.title,
    path: latestProjectionPathForPage(db, row.page_id) ?? `memory/${row.slug || row.page_id}.md`,
    relation: "attached",
  };
}

function loadAttachmentOrigins(
  canonicalStore: CanonicalMemoryStoreStatus,
  attachment: AttachmentRow,
): AttachmentLedgerOrigin[] {
  return readAttachmentOriginsFromLedger({
    profileId: canonicalStore.profileId,
    stateDir: canonicalStore.replica?.stateDir ?? resolveStateDir(process.env),
    blobId: attachment.blob_id,
    sha256: attachment.sha256,
  }).map((origin) => ({
    ...origin,
    pageId: origin.pageId ?? null,
  }));
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function loadMentionedPagesForAttachment(
  db: DatabaseSync,
  attachment: AttachmentRow,
  limit = 8,
): NativeMemoryFileLink[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.page_id AS page_id, p.title AS title, p.slug AS slug
       FROM projections pr
       INNER JOIN pages p
         ON p.page_id = pr.page_id
       WHERE p.tombstoned = 0 AND (
         pr.markdown_body LIKE ? ESCAPE '\\' OR pr.markdown_body LIKE ? ESCAPE '\\'
       )
       ORDER BY p.title ASC
       LIMIT ?`,
    )
    .all(
      `%${escapeLike(attachment.blob_id)}%`,
      `%${escapeLike(attachment.sha256)}%`,
      limit,
    ) as Array<{
    page_id: string;
    title: string;
    slug: string;
  }>;
  return rows.map((row) => ({
    pageId: row.page_id,
    entityId: row.page_id,
    title: row.title,
    path: latestProjectionPathForPage(db, row.page_id) ?? `memory/${row.slug || row.page_id}.md`,
    relation: "mentioned",
  }));
}

function buildRelatedPages(
  db: DatabaseSync,
  attachment: AttachmentRow,
  origins: AttachmentLedgerOrigin[],
) {
  const linkedFromLedger = origins
    .map((origin) => (origin.pageId ? readPageLink(db, origin.pageId) : null))
    .filter((entry): entry is NativeMemoryFileLink => entry !== null);
  const merged = uniqueByKey(
    [...linkedFromLedger, ...loadMentionedPagesForAttachment(db, attachment)],
    (entry) => entry.pageId,
  );
  return merged.map((entry, index) =>
    index < linkedFromLedger.length ? entry : { ...entry, relation: "mentioned" as const },
  );
}

function buildPrimaryOrigin(
  db: DatabaseSync,
  origin: AttachmentLedgerOrigin | null,
): NativeMemoryFileOrigin | undefined {
  if (!origin) {
    return undefined;
  }
  const page = origin.pageId ? readPageLink(db, origin.pageId) : null;
  return {
    eventId: origin.eventId,
    lamport: origin.lamport,
    actorId: origin.actorId,
    ...(origin.createdAt ? { createdAt: origin.createdAt } : {}),
    ...(page
      ? {
          pageId: page.pageId,
          entityId: page.entityId,
          pageTitle: page.title,
          pagePath: page.path,
        }
      : {}),
  };
}

function buildPreview(name: string, mediaType: string, bytes: Buffer): NativeMemoryFilePreview {
  const kind = resolvePreviewKind(name, mediaType);
  if (kind === "image" || kind === "audio" || kind === "pdf") {
    if (bytes.byteLength > INLINE_BINARY_PREVIEW_MAX_BYTES) {
      return {
        kind,
        mediaType,
        fallbackLabel: "File is too large for inline preview. Open or download it instead.",
      };
    }
    return {
      kind,
      mediaType,
      bytesBase64: bytes.toString("base64"),
    };
  }

  if (kind === "binary") {
    return {
      kind,
      mediaType,
      fallbackLabel: "No safe inline preview is available for this attachment type.",
    };
  }

  const decoded = bytes.toString("utf8");
  const sourceText =
    kind === "json"
      ? (() => {
          try {
            return `${JSON.stringify(JSON.parse(decoded), null, 2)}\n`;
          } catch {
            return decoded;
          }
        })()
      : decoded;
  const truncated = sourceText.length > INLINE_TEXT_PREVIEW_MAX_CHARS;
  const text = truncated ? `${sourceText.slice(0, INLINE_TEXT_PREVIEW_MAX_CHARS)}\n…` : sourceText;
  return {
    kind,
    mediaType,
    text,
    truncated,
    lineCount: text.split(/\r?\n/).length,
  };
}

function buildSummary(params: {
  preview: NativeMemoryFilePreview;
  primaryPage?: NativeMemoryFileLink;
  sha256: string;
}) {
  if (params.preview.text) {
    return summarizeText(params.preview.text, 160);
  }
  if (params.primaryPage?.title) {
    return `Attached to ${params.primaryPage.title}`;
  }
  return `SHA-256 ${params.sha256.slice(0, 12)}`;
}

function buildProvenance(params: {
  canonicalStore: CanonicalMemoryStoreStatus;
  attachment: AttachmentRow;
  primaryOrigin?: NativeMemoryFileOrigin;
  relatedPages: NativeMemoryFileLink[];
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Blob", value: params.attachment.blob_id },
    { label: "SHA-256", value: params.attachment.sha256 },
    { label: "Media type", value: params.attachment.mime },
    { label: "Profile", value: params.canonicalStore.profileId },
    { label: "Lamport", value: String(params.canonicalStore.lastSyncedLamport) },
  ];
  if (params.primaryOrigin?.eventId) {
    rows.push({ label: "Attachment event", value: params.primaryOrigin.eventId });
  }
  if (typeof params.primaryOrigin?.lamport === "number") {
    rows.push({ label: "Attachment lamport", value: String(params.primaryOrigin.lamport) });
  }
  if (params.primaryOrigin?.actorId) {
    rows.push({ label: "Attached by", value: params.primaryOrigin.actorId });
  }
  if (params.primaryOrigin?.createdAt) {
    rows.push({ label: "Attached at", value: params.primaryOrigin.createdAt });
  }
  if (params.primaryOrigin?.pageTitle) {
    rows.push({
      label: "Source page",
      value: `${params.primaryOrigin.pageTitle} (${params.primaryOrigin.pageId})`,
    });
  }
  if (params.relatedPages.length > 1) {
    rows.push({
      label: "Related pages",
      value: params.relatedPages.map((entry) => entry.title).join(", "),
    });
  }
  return rows;
}

function buildFileEntry(params: {
  db: DatabaseSync;
  canonicalStore: CanonicalMemoryStoreStatus;
  attachment: AttachmentRow;
  query?: string;
  candidateCount: number;
  hitCount?: number;
  includeDetail?: boolean;
}) {
  const name = resolveAttachmentName(params.attachment.blob_id, params.attachment.mime);
  const updatedAtMs = normalizeNumber(params.attachment.created_at_ms);
  const query = normalizeString(params.query);
  const origins = loadAttachmentOrigins(params.canonicalStore, params.attachment);
  const relatedPages = buildRelatedPages(params.db, params.attachment, origins);
  const primaryOriginRaw = origins[0] ?? null;
  const primaryOrigin = buildPrimaryOrigin(params.db, primaryOriginRaw);
  const previewKind = resolvePreviewKind(name, params.attachment.mime);
  const preview =
    params.includeDetail === true
      ? buildPreview(name, params.attachment.mime, asBuffer(params.attachment.bytes))
      : null;
  const reason = query
    ? scoreByQuery(
        query,
        {
          title: [name],
          alias: [params.attachment.blob_id],
          path: [
            params.attachment.sha256,
            ...(relatedPages[0]?.path ? [relatedPages[0].path] : []),
          ],
          tag: [params.attachment.mime, previewKind, ...relatedPages.map((entry) => entry.title)],
          body: [
            params.attachment.sha256,
            ...(preview?.text ? [preview.text] : []),
            ...relatedPages.map((entry) => entry.path),
          ],
        },
        updatedAtMs,
      )
    : { score: 0.5, reasonTags: [] };
  const trace =
    query && reason.reasonTags.length > 0
      ? buildFileTrace({
          query,
          file: { id: params.attachment.blob_id, name, mediaType: params.attachment.mime },
          reasonTags: reason.reasonTags,
          candidateCount: params.candidateCount,
          hitCount: params.hitCount ?? 0,
        })
      : undefined;
  const provenance = buildProvenance({
    canonicalStore: params.canonicalStore,
    attachment: params.attachment,
    primaryOrigin,
    relatedPages,
  });
  const base: NativeMemoryFileListEntry = {
    id: params.attachment.blob_id,
    name,
    mediaType: params.attachment.mime,
    previewKind,
    size: asBuffer(params.attachment.bytes).byteLength,
    sha256: params.attachment.sha256,
    updatedAt: toIso(params.attachment.created_at_ms),
    summary: buildSummary({
      preview:
        preview ??
        ({
          kind: previewKind,
          mediaType: params.attachment.mime,
        } satisfies NativeMemoryFilePreview),
      primaryPage: relatedPages[0],
      sha256: params.attachment.sha256,
    }),
    provenanceSummary:
      primaryOrigin?.pageTitle || relatedPages[0]?.title
        ? `Attached to ${primaryOrigin?.pageTitle ?? relatedPages[0]!.title}`
        : `SHA-256 ${params.attachment.sha256.slice(0, 12)}`,
    relatedPagesCount: relatedPages.length,
    ...(relatedPages[0] ? { primaryPage: relatedPages[0] } : {}),
    ...(primaryOrigin ? { origin: primaryOrigin } : {}),
    provenance,
    ...(reason.reasonTags.length > 0 ? { reasonTags: reason.reasonTags } : {}),
    ...(trace ? { trace, traceSummary: buildTraceSummary(trace, reason.reasonTags) } : {}),
  };
  if (params.includeDetail !== true || !preview) {
    return {
      score: reason.score,
      file: base,
    };
  }
  return {
    score: reason.score,
    file: {
      ...base,
      preview,
      download: {
        fileName: name,
        mediaType: params.attachment.mime,
        bytesBase64: asBuffer(params.attachment.bytes).toString("base64"),
      },
      relatedPages,
    } satisfies NativeMemoryFileDetail,
  };
}

function loadAttachments(db: DatabaseSync): AttachmentRow[] {
  return db
    .prepare(
      `SELECT blob_id, mime, bytes, sha256, created_at_ms
       FROM attachments
       ORDER BY created_at_ms DESC, blob_id ASC`,
    )
    .all() as AttachmentRow[];
}

export function buildFilesListResult(params: {
  db: DatabaseSync;
  canonicalStore: CanonicalMemoryStoreStatus;
  query?: string;
}) {
  const attachments = loadAttachments(params.db);
  const query = normalizeString(params.query);
  const candidateCount = attachments.length;
  const files = attachments
    .map((attachment) =>
      buildFileEntry({
        db: params.db,
        canonicalStore: params.canonicalStore,
        attachment,
        query,
        candidateCount,
      }),
    )
    .filter((entry) => !query || entry.score > 0)
    .sort((left, right) => {
      if (query && right.score !== left.score) {
        return right.score - left.score;
      }
      if (query) {
        return left.file.name.localeCompare(right.file.name);
      }
      return 0;
    });
  const hitCount = files.length;
  return files.map((entry) => {
    if (query && entry.file.trace) {
      entry.file.trace = {
        ...entry.file.trace,
        hitCount,
      };
      entry.file.traceSummary = buildTraceSummary(entry.file.trace, entry.file.reasonTags ?? []);
    }
    return entry.file;
  });
}

export function buildFileDetailResult(params: {
  db: DatabaseSync;
  canonicalStore: CanonicalMemoryStoreStatus;
  fileId: string;
  query?: string;
}) {
  const attachments = loadAttachments(params.db);
  const candidateCount = attachments.length;
  const attachment = attachments.find((file) => file.blob_id === params.fileId);
  if (!attachment) {
    return null;
  }
  return buildFileEntry({
    db: params.db,
    canonicalStore: params.canonicalStore,
    attachment,
    query: params.query,
    candidateCount,
    hitCount: candidateCount,
    includeDetail: true,
  }).file as NativeMemoryFileDetail;
}

export async function handleMemoryFilesListGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const context = await resolveNativeMemoryContext({
    method: "memory.files.list",
    request: params,
    respond,
  });
  if (!context) {
    return;
  }
  const db = openCanonicalDb(context.canonicalStore);
  try {
    respond(
      true,
      {
        agentId: context.agentId,
        sync: buildSyncSurface(context.canonicalStore),
        files: buildFilesListResult({
          db,
          canonicalStore: context.canonicalStore,
          query: normalizeString(params.query),
        }),
      },
      undefined,
    );
  } finally {
    db.close();
    await context.close();
  }
}

export async function handleMemoryFilesGetGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const fileId = normalizeString(params.fileId);
  if (!fileId) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.files.get requires fileId");
    return;
  }
  const context = await resolveNativeMemoryContext({
    method: "memory.files.get",
    request: params,
    respond,
  });
  if (!context) {
    return;
  }
  const db = openCanonicalDb(context.canonicalStore);
  try {
    const detail = buildFileDetailResult({
      db,
      canonicalStore: context.canonicalStore,
      fileId,
      query: normalizeString(params.query),
    });
    if (!detail) {
      respondGatewayError(respond, "NOT_FOUND", `memory file not found: ${fileId}`);
      return;
    }
    respond(
      true,
      {
        agentId: context.agentId,
        sync: buildSyncSurface(context.canonicalStore),
        file: detail,
      },
      undefined,
    );
  } finally {
    db.close();
    await context.close();
  }
}
