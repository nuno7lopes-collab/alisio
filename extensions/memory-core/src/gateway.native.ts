import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { GatewayRequestHandlerOptions } from "alisio/plugin-sdk/core";
import { resolveAgentWorkspaceDir } from "alisio/plugin-sdk/memory-core-host-engine-foundation";
import { hashText, requireNodeSqlite } from "alisio/plugin-sdk/memory-core-host-engine-storage";
import { loadConfig, resolveStateDir } from "alisio/plugin-sdk/memory-core-host-runtime-core";
import { resolveMemoryBackendConfig } from "alisio/plugin-sdk/memory-core-host-runtime-files";
import JSZip from "jszip";
import {
  buildCanonicalMarkdownProjection,
  type CanonicalMemoryStructuredEntityInput,
  type CanonicalMemoryStoreStatus,
  syncCanonicalMemoryStore,
  upsertCanonicalMemoryStructuredEntities,
} from "./memory/canonical-store.js";
import { getMemorySearchManager } from "./memory/index.js";
import { readRecentMemoryLedgerEvents } from "./memory/ledger-interop.js";

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

type NativeWikiTrace = {
  kind: "wiki";
  query: string;
  candidateCount: number;
  hitCount: number;
  hits: Array<{
    id: string;
    title: string;
    path: string;
    reasons: string[];
    backlinks: number;
    claims: number;
    evidence: number;
  }>;
  reasons: string[];
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

type NativeWikiListPage = {
  id: string;
  title: string;
  slug: string;
  path: string;
  excerpt: string;
  summary?: string;
  updatedAt: string | null;
  backlinks: number;
  claims: number;
  evidence: number;
  tags?: string[];
  categories?: string[];
  collections?: string[];
  featured?: boolean;
  reasonTags?: MemoryReasonTag[];
  trace?: NativeWikiTrace;
  traceSummary?: string[];
};

type NativeWikiRelatedFile = {
  id: string;
  name: string;
  mediaType?: string;
  updatedAt?: string | null;
  provenanceSummary?: string;
};

type NativeWikiPage = {
  id: string;
  title: string;
  slug: string;
  path: string;
  content: string;
  summary?: string;
  tags?: string[];
  categories?: string[];
  collections?: string[];
  featured?: boolean;
  backlinks: Array<{ id: string; title: string; path: string; excerpt?: string }>;
  claims: Array<{
    id: string;
    claim: string;
    confidence?: number;
    evidence?: Array<{
      id: string;
      title?: string;
      excerpt?: string;
      source?: string;
      provenance?: Array<{ label: string; value: string }>;
    }>;
  }>;
  evidence: Array<{
    id: string;
    title?: string;
    excerpt?: string;
    source?: string;
    provenance?: Array<{ label: string; value: string }>;
  }>;
  relatedFiles?: NativeWikiRelatedFile[];
  provenance: Array<{ label: string; value: string }>;
  reasonTags?: MemoryReasonTag[];
  trace?: NativeWikiTrace;
  traceSummary?: string[];
  contextPreview?: {
    summary?: string;
    reasonTags?: MemoryReasonTag[];
    trace?: NativeWikiTrace;
    traceSummary?: string[];
  };
  revision?: {
    eventId?: string | null;
    lamport?: number | null;
    updatedAt?: string | null;
    author?: string | null;
    summary?: string | null;
  };
};

type NativeHistoryEntry = {
  eventId: string;
  lamport: number;
  at: string;
  author: string;
  operation: string;
  summary: string;
  diffSummary?: string;
};

type NativeFileEntry = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  updatedAt: string | null;
  provenanceSummary: string;
  provenance: Array<{ label: string; value: string }>;
  relatedPages: Array<{ id: string; title: string; path: string }>;
  reasonTags?: MemoryReasonTag[];
  trace?: NativeFileTrace;
  traceSummary?: string[];
};

type NativeMemoryContext = {
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
  canonicalStore: CanonicalMemoryStoreStatus;
  close(): Promise<void>;
};

type PageIdentity = {
  pageId: string;
  title: string;
  slug: string;
  path: string;
  aliases: string[];
};

type AttachmentRow = {
  blob_id: string;
  mime: string;
  bytes: Uint8Array | Buffer;
  sha256: string;
  created_at_ms: number | bigint;
};

const MARKDOWN_PROJECTION_PREFIX = "md-path:";
const MARKDOWN_PROJECTION_PREFIX_ALIASES = [
  MARKDOWN_PROJECTION_PREFIX,
  "legacy-markdown:",
] as const;

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

function normalizeReferenceKey(value: string): string {
  return value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\.md$/i, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
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

function resolveMarkdownProjectionKinds(relativePath: string): [string, string] {
  const normalizedPath = normalizeDisplayPath(relativePath);
  return [
    `${MARKDOWN_PROJECTION_PREFIX_ALIASES[0]}${normalizedPath}`,
    `${MARKDOWN_PROJECTION_PREFIX_ALIASES[1]}${normalizedPath}`,
  ];
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
  if (normalized === "text/plain") {
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
  if (normalized === "audio/mpeg") {
    return ".mp3";
  }
  return "";
}

function summarizeText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function toIso(value: unknown): string | null {
  const numeric = normalizeNumber(value);
  return numeric == null || numeric <= 0 ? null : new Date(numeric).toISOString();
}

function asBuffer(value: Uint8Array | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : [];
  } catch {
    return [];
  }
}

function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function stripAnchor(raw: string): { target: string; anchor?: string } {
  const [target, ...rest] = raw.split("#");
  const anchor = rest.length > 0 ? rest.join("#").trim() : undefined;
  return {
    target: target.trim(),
    ...(anchor ? { anchor } : {}),
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
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
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
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next] ?? "";
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

function parseFrontmatter(markdown: string): {
  raw?: string;
  body: string;
  title?: string;
  aliases: string[];
  tags: string[];
  rest: Record<string, unknown>;
} {
  if (!markdown.startsWith("---\n")) {
    return { body: markdown, aliases: [], tags: [], rest: {} };
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) {
    return { body: markdown, aliases: [], tags: [], rest: {} };
  }
  const raw = markdown.slice(4, end);
  const body = markdown.slice(end + 5);
  const rest: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim() || /^\s/.test(line)) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9._-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, inlineValue] = match;
    if (key === "title" || key === "aliases" || key === "tags") {
      continue;
    }
    if (inlineValue.startsWith("[") && inlineValue.endsWith("]")) {
      rest[key] = inlineValue
        .slice(1, -1)
        .split(",")
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      continue;
    }
    if (inlineValue) {
      const trimmed = inlineValue.trim().replace(/^['"]|['"]$/g, "");
      if (trimmed) {
        rest[key] = trimmed;
      }
    }
  }
  return {
    raw,
    body,
    title: extractYamlScalar(raw, "title"),
    aliases: extractYamlList(raw, "aliases"),
    tags: extractYamlList(raw, "tags"),
    rest,
  };
}

function normalizeFrontmatterStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((entry) => normalizeString(entry)).filter(Boolean));
  }
  const single = normalizeString(value);
  return single ? [single] : [];
}

function normalizeFrontmatterBoolean(value: unknown): boolean {
  return value === true || normalizeString(value).toLowerCase() === "true";
}

function buildWikiTaxonomy(params: {
  parsed: ReturnType<typeof parseFrontmatter>;
  fallbackTags?: string[];
  fallbackSummary?: string;
}) {
  const rest = params.parsed.rest;
  const tags = uniqueStrings([...(params.parsed.tags ?? []), ...(params.fallbackTags ?? [])]);
  const categories = uniqueStrings([
    ...normalizeFrontmatterStringList(rest.categories),
    ...normalizeFrontmatterStringList(rest.category),
  ]);
  const collections = uniqueStrings([
    ...normalizeFrontmatterStringList(rest.collections),
    ...normalizeFrontmatterStringList(rest.collection),
  ]);
  const summary =
    normalizeString(rest.summary) ||
    normalizeString(rest.description) ||
    normalizeString(rest.dek) ||
    normalizeString(params.fallbackSummary) ||
    summarizeText(params.parsed.body, 180);
  const featured =
    normalizeFrontmatterBoolean(rest.featured) ||
    collections.some((collection) => collection.toLowerCase() === "featured");
  return {
    ...(summary ? { summary } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(collections.length > 0 ? { collections } : {}),
    ...(featured ? { featured: true } : {}),
  };
}

function parseWikiReferences(markdown: string) {
  const refs: Array<{ targetKey: string; ordinal: number }> = [];
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
    refs.push({ targetKey: key, ordinal });
    ordinal += 1;
  }
  return refs;
}

function parseMarkdownReferences(markdown: string, currentReferencePath: string) {
  const refs: Array<{ targetKey: string; ordinal: number }> = [];
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
    refs.push({ targetKey: resolved, ordinal });
    ordinal += 1;
  }
  return refs;
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
      cfg,
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
    if (
      params.syncIfDirty !== false &&
      manager.sync &&
      (initialStatus.dirty || canonicalStore?.state !== "ready")
    ) {
      await manager.sync({ reason: params.method, force: true });
      canonicalStore = asCanonicalStoreStatus(manager.status().custom?.canonicalStore);
    }
    if (!canonicalStore) {
      respondGatewayError(
        params.respond,
        "UNAVAILABLE",
        `${params.method} unavailable: canonical memory store unavailable`,
      );
      return null;
    }
    return {
      cfg,
      agentId,
      canonicalStore,
      async close() {
        await manager.close?.().catch(() => {});
      },
    };
  } catch (error) {
    await manager.close?.().catch(() => {});
    const fallback = await tryDirectCanonicalStore().catch(() => null);
    if (fallback) {
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

function openCanonicalDb(status: CanonicalMemoryStoreStatus, readOnly = true): DatabaseSync {
  const { DatabaseSync } = requireNodeSqlite();
  return new DatabaseSync(status.path, readOnly ? { readOnly: true } : undefined);
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

function latestProjectionForPage(
  db: DatabaseSync,
  pageId: string,
): { kind: string; markdown_body: string; updated_at_ms: number | bigint } | null {
  return (
    (db
      .prepare(
        `SELECT kind, markdown_body, updated_at_ms
         FROM projections
         WHERE page_id = ?
         ORDER BY updated_at_ms DESC, kind ASC
         LIMIT 1`,
      )
      .get(pageId) as
      | {
          kind: string;
          markdown_body: string;
          updated_at_ms: number | bigint;
        }
      | undefined) ?? null
  );
}

function listAliases(db: DatabaseSync, pageId: string): string[] {
  const rows = db
    .prepare(
      `SELECT alias_key
       FROM page_aliases
       WHERE page_id = ?
       ORDER BY ordinal ASC, alias_key ASC`,
    )
    .all(pageId) as Array<{ alias_key: string }>;
  return rows.map((row) => row.alias_key).filter(Boolean);
}

function listTags(db: DatabaseSync, pageId: string): string[] {
  const rows = db
    .prepare(
      `SELECT tag
       FROM page_tags
       WHERE page_id = ?
       ORDER BY ordinal ASC, tag ASC`,
    )
    .all(pageId) as Array<{ tag: string }>;
  return rows.map((row) => row.tag).filter(Boolean);
}

function readPageIdentity(db: DatabaseSync, pageId: string): PageIdentity | null {
  const row = db
    .prepare(
      `SELECT page_id, title, slug
       FROM pages
       WHERE page_id = ? AND tombstoned = 0`,
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
  const projection = latestProjectionForPage(db, pageId);
  return {
    pageId: row.page_id,
    title: row.title,
    slug: row.slug,
    path:
      parseMarkdownProjectionPath(projection?.kind ?? "") ??
      `memory/${row.slug || row.page_id.toLowerCase()}.md`,
    aliases: listAliases(db, pageId),
  };
}

function findRelevantClaimIds(
  db: DatabaseSync,
  identity: PageIdentity,
  _body: string,
): Set<string> {
  const needles = uniqueStrings([
    identity.pageId.toLowerCase(),
    identity.title.toLowerCase(),
    identity.slug.toLowerCase(),
    identity.path.toLowerCase(),
    ...identity.aliases.map((alias) => alias.toLowerCase()),
    path.posix.basename(identity.path, ".md").toLowerCase(),
  ]);
  const claims = db
    .prepare(
      `SELECT claim_id, subject, predicate, object
       FROM claims
       WHERE status IS NULL OR status != 'retracted'
       ORDER BY updated_at_ms DESC, claim_id ASC`,
    )
    .all() as Array<{
    claim_id: string;
    subject: string;
    predicate: string;
    object: string;
  }>;
  const evidenceRows = db
    .prepare(
      `SELECT claim_id, source_locator, quote
       FROM evidence
       ORDER BY created_at_ms DESC, evidence_id ASC`,
    )
    .all() as Array<{
    claim_id: string;
    source_locator: string;
    quote: string;
  }>;
  const evidenceByClaim = new Map<string, string[]>();
  for (const row of evidenceRows) {
    const entry = evidenceByClaim.get(row.claim_id) ?? [];
    entry.push(`${row.source_locator} ${row.quote}`.toLowerCase());
    evidenceByClaim.set(row.claim_id, entry);
  }
  const relevant = new Set<string>();
  for (const claim of claims) {
    const haystack = [
      claim.subject,
      claim.predicate,
      claim.object,
      ...(evidenceByClaim.get(claim.claim_id) ?? []),
    ]
      .join(" ")
      .toLowerCase();
    if (needles.some((needle) => haystack.includes(needle))) {
      relevant.add(claim.claim_id);
    }
  }
  return relevant;
}

function loadClaims(
  db: DatabaseSync,
  identity: PageIdentity,
  body: string,
  limit = 6,
): NativeWikiPage["claims"] {
  const claimIds = findRelevantClaimIds(db, identity, body);
  if (claimIds.size === 0) {
    return [];
  }
  const rows = db
    .prepare(
      `SELECT claim_id, subject, predicate, object, confidence
       FROM claims
       WHERE status IS NULL OR status != 'retracted'
       ORDER BY updated_at_ms DESC, claim_id ASC`,
    )
    .all() as Array<{
    claim_id: string;
    subject: string;
    predicate: string;
    object: string;
    confidence: number | bigint;
  }>;
  const evidenceRows = db
    .prepare(
      `SELECT evidence_id, claim_id, source_locator, quote
       FROM evidence
       ORDER BY created_at_ms DESC, evidence_id ASC`,
    )
    .all() as Array<{
    evidence_id: string;
    claim_id: string;
    source_locator: string;
    quote: string;
  }>;
  const evidenceByClaim = new Map<string, NativeWikiPage["evidence"]>();
  for (const row of evidenceRows) {
    const entry = evidenceByClaim.get(row.claim_id) ?? [];
    entry.push({
      id: row.evidence_id,
      title: row.source_locator,
      excerpt: summarizeText(row.quote, 180),
      source: row.source_locator,
      provenance: [{ label: "Source", value: row.source_locator }],
    });
    evidenceByClaim.set(row.claim_id, entry);
  }
  return rows
    .filter((row) => claimIds.has(row.claim_id))
    .slice(0, limit)
    .map((row) => ({
      id: row.claim_id,
      claim: `${row.subject} ${row.predicate} ${row.object}`.trim(),
      confidence: normalizeNumber(row.confidence) ?? undefined,
      evidence: evidenceByClaim.get(row.claim_id) ?? [],
    }));
}

function loadEvidence(
  db: DatabaseSync,
  identity: PageIdentity,
  body: string,
  limit = 6,
): NativeWikiPage["evidence"] {
  const claimIds = findRelevantClaimIds(db, identity, body);
  const rows = db
    .prepare(
      `SELECT evidence_id, claim_id, source_locator, quote
       FROM evidence
       ORDER BY created_at_ms DESC, evidence_id ASC`,
    )
    .all() as Array<{
    evidence_id: string;
    claim_id: string;
    source_locator: string;
    quote: string;
  }>;
  const needles = uniqueStrings([
    identity.pageId.toLowerCase(),
    identity.title.toLowerCase(),
    identity.slug.toLowerCase(),
    identity.path.toLowerCase(),
    ...identity.aliases.map((alias) => alias.toLowerCase()),
  ]);
  return rows
    .filter((row) => {
      const haystack = `${row.source_locator} ${row.quote}`.toLowerCase();
      return claimIds.has(row.claim_id) || needles.some((needle) => haystack.includes(needle));
    })
    .slice(0, limit)
    .map((row) => ({
      id: row.evidence_id,
      title: row.source_locator,
      excerpt: summarizeText(row.quote, 180),
      source: row.source_locator,
      provenance: [
        { label: "Claim", value: row.claim_id },
        { label: "Source", value: row.source_locator },
      ],
    }));
}

function loadBacklinks(db: DatabaseSync, pageId: string, limit = 8): NativeWikiPage["backlinks"] {
  const rows = db
    .prepare(
      `SELECT DISTINCT
         p.page_id AS page_id,
         p.title AS title,
         p.slug AS slug
       FROM links l
       INNER JOIN pages p
         ON p.page_id = l.from_page_id
       WHERE l.to_page_id = ? AND p.tombstoned = 0
       ORDER BY p.title ASC
       LIMIT ?`,
    )
    .all(pageId, limit) as Array<{
    page_id: string;
    title: string;
    slug: string;
  }>;
  return rows.map((row) => {
    const projection = latestProjectionForPage(db, row.page_id);
    const pagePath =
      parseMarkdownProjectionPath(projection?.kind ?? "") ??
      `memory/${row.slug || row.page_id.toLowerCase()}.md`;
    return {
      id: row.page_id,
      title: row.title,
      path: pagePath,
      excerpt: summarizeText(parseFrontmatter(projection?.markdown_body ?? "").body, 120),
    };
  });
}

function summarizeLedgerEvent(eventType: string, payloadJson: string): string {
  const payload = parseJsonRecord(payloadJson);
  const markdown =
    typeof payload.markdownBody === "string" ? summarizeText(payload.markdownBody, 180) : "";
  if (markdown) {
    return markdown;
  }
  if (typeof payload.title === "string" && payload.title.trim()) {
    return payload.title.trim();
  }
  if (typeof payload.object === "string" && payload.object.trim()) {
    return payload.object.trim();
  }
  if (Array.isArray(payload.links)) {
    return `${payload.links.length} links`;
  }
  if (typeof payload.kind === "string" && payload.kind.trim()) {
    return payload.kind.trim();
  }
  return eventType.replace(/_/g, " ").toLowerCase();
}

function summarizeStateEvent(event: { type: string; payload: Record<string, unknown> }): string {
  return summarizeLedgerEvent(event.type, JSON.stringify(event.payload));
}

function loadLatestRevision(
  canonicalStore: CanonicalMemoryStoreStatus,
  pageId: string,
): NativeWikiPage["revision"] | undefined {
  const row = readRecentMemoryLedgerEvents({
    profileId: canonicalStore.profileId,
    stateDir: canonicalStore.replica?.stateDir ?? resolveStateDir(process.env),
    limit: 1,
    pageId,
    excludeTypes: new Set(["CHECKPOINT_CREATED"]),
  })[0];
  if (!row) {
    return undefined;
  }
  return {
    eventId: row.eventId,
    lamport: row.lamport,
    updatedAt: toIso(row.createdAtMs),
    author: row.actorId,
    summary: summarizeStateEvent(row),
  };
}

function loadHistoryEntries(
  canonicalStore: CanonicalMemoryStoreStatus,
  pageId: string,
  limit = 40,
): NativeHistoryEntry[] {
  const rows = readRecentMemoryLedgerEvents({
    profileId: canonicalStore.profileId,
    stateDir: canonicalStore.replica?.stateDir ?? resolveStateDir(process.env),
    limit,
    pageId,
    excludeTypes: new Set(["CHECKPOINT_CREATED"]),
  });
  return rows.map((row) => ({
    eventId: row.eventId,
    lamport: row.lamport,
    at: toIso(row.createdAtMs) ?? new Date(0).toISOString(),
    author: row.actorId,
    operation: row.type.toLowerCase(),
    summary: summarizeStateEvent(row),
    diffSummary: summarizeStateEvent(row),
  }));
}

function buildPageTrace(params: {
  query: string;
  page: { id: string; title: string; path: string };
  reasonTags: MemoryReasonTag[];
  candidateCount: number;
  hitCount: number;
  backlinks: number;
  claims: number;
  evidence: number;
}): NativeWikiTrace {
  const reasons = params.reasonTags.map((tag) => tag.code);
  return {
    kind: "wiki",
    query: params.query,
    candidateCount: params.candidateCount,
    hitCount: params.hitCount,
    hits: [
      {
        id: params.page.id,
        title: params.page.title,
        path: params.page.path,
        reasons,
        backlinks: params.backlinks,
        claims: params.claims,
        evidence: params.evidence,
      },
    ],
    reasons,
  };
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

function resolveAttachmentName(blobId: string, mediaType: string): string {
  const trimmed = blobId.trim();
  if (/^[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}$/.test(trimmed)) {
    return trimmed;
  }
  return `attachment-${trimmed.slice(0, 12) || "file"}${extensionForMediaType(mediaType)}`;
}

function loadRelatedPagesForAttachment(
  db: DatabaseSync,
  attachment: AttachmentRow,
  limit = 5,
): NativeFileEntry["relatedPages"] {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.page_id AS page_id, p.title AS title, p.slug AS slug
       FROM projections pr
       INNER JOIN pages p
         ON p.page_id = pr.page_id
       WHERE p.tombstoned = 0 AND (
         pr.markdown_body LIKE ? OR pr.markdown_body LIKE ?
       )
       ORDER BY p.title ASC
       LIMIT ?`,
    )
    .all(`%${attachment.blob_id}%`, `%${attachment.sha256}%`, limit) as Array<{
    page_id: string;
    title: string;
    slug: string;
  }>;
  return rows.map((row) => {
    const projection = latestProjectionForPage(db, row.page_id);
    return {
      id: row.page_id,
      title: row.title,
      path:
        parseMarkdownProjectionPath(projection?.kind ?? "") ??
        `memory/${row.slug || row.page_id.toLowerCase()}.md`,
    };
  });
}

function formatAttachmentProvenance(
  attachment: AttachmentRow,
): Array<{ label: string; value: string }> {
  return [
    { label: "Blob", value: attachment.blob_id },
    { label: "SHA-256", value: attachment.sha256 },
    { label: "Media type", value: attachment.mime },
  ];
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

function loadRelatedFilesForPage(
  db: DatabaseSync,
  body: string,
  limit = 6,
): NativeWikiPage["relatedFiles"] {
  const loweredBody = body.toLowerCase();
  return loadAttachments(db)
    .filter((attachment) => {
      const attachmentName = resolveAttachmentName(
        attachment.blob_id,
        attachment.mime,
      ).toLowerCase();
      return (
        loweredBody.includes(String(attachment.blob_id).toLowerCase()) ||
        loweredBody.includes(String(attachment.sha256).toLowerCase()) ||
        loweredBody.includes(attachmentName)
      );
    })
    .slice(0, limit)
    .map((attachment) => ({
      id: attachment.blob_id,
      name: resolveAttachmentName(attachment.blob_id, attachment.mime),
      mediaType: attachment.mime,
      updatedAt: toIso(attachment.created_at_ms),
      provenanceSummary: `Blob ${attachment.blob_id}`,
    }));
}

function buildWikiPageDetail(params: {
  db: DatabaseSync;
  canonicalStore: CanonicalMemoryStoreStatus;
  pageId: string;
  query?: string;
}): NativeWikiPage | null {
  const identity = readPageIdentity(params.db, params.pageId);
  if (!identity) {
    return null;
  }
  const projection = latestProjectionForPage(params.db, params.pageId);
  const content = projection?.markdown_body ?? "";
  const parsed = parseFrontmatter(content);
  const body = parsed.body;
  const claims = loadClaims(params.db, identity, body);
  const evidence = loadEvidence(params.db, identity, body);
  const backlinks = loadBacklinks(params.db, params.pageId);
  const relatedFiles = loadRelatedFilesForPage(params.db, body) ?? [];
  const revision = loadLatestRevision(params.canonicalStore, params.pageId);
  const provenance = [
    { label: "Path", value: identity.path },
    { label: "Page ID", value: identity.pageId },
    { label: "Profile", value: params.canonicalStore.profileId },
    { label: "Lamport", value: String(params.canonicalStore.lastSyncedLamport) },
  ];

  const query = normalizeString(params.query);
  const updatedAtMs = normalizeNumber(projection?.updated_at_ms);
  const { reasonTags } =
    query.length > 0
      ? scoreByQuery(
          query,
          {
            title: [identity.title],
            alias: identity.aliases,
            path: [identity.path],
            tag: listTags(params.db, params.pageId),
            body: [body],
          },
          updatedAtMs,
        )
      : { reasonTags: [] };
  const trace =
    query.length > 0
      ? buildPageTrace({
          query,
          page: {
            id: identity.pageId,
            title: identity.title,
            path: identity.path,
          },
          reasonTags,
          candidateCount: 1,
          hitCount: 1,
          backlinks: backlinks.length,
          claims: claims.length,
          evidence: evidence.length,
        })
      : undefined;
  const traceSummary = trace ? buildTraceSummary(trace, reasonTags) : undefined;
  const contextSummaryParts = [
    backlinks.length > 0 ? `${backlinks.length} backlinks` : "",
    claims.length > 0 ? `${claims.length} claims` : "",
    evidence.length > 0 ? `${evidence.length} evidence` : "",
  ].filter(Boolean);
  const taxonomy = buildWikiTaxonomy({
    parsed,
    fallbackTags: listTags(params.db, params.pageId),
    fallbackSummary: summarizeText(body, 220),
  });

  return {
    id: identity.pageId,
    title: identity.title,
    slug: identity.slug,
    path: identity.path,
    content,
    ...taxonomy,
    backlinks,
    claims,
    evidence,
    ...(relatedFiles.length > 0 ? { relatedFiles } : {}),
    provenance,
    ...(reasonTags.length > 0 ? { reasonTags } : {}),
    ...(trace ? { trace } : {}),
    ...(traceSummary ? { traceSummary } : {}),
    contextPreview: {
      ...(contextSummaryParts.length > 0 ? { summary: contextSummaryParts.join(" • ") } : {}),
      ...(reasonTags.length > 0 ? { reasonTags } : {}),
      ...(trace ? { trace } : {}),
      ...(traceSummary ? { traceSummary } : {}),
    },
    ...(revision ? { revision } : {}),
  };
}

function slugifyTitle(title: string): string {
  const normalized = normalizeReferenceKey(title)
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || hashText(`slug:${title}`).slice(0, 16);
}

function candidatePagePath(title: string): string {
  const slug = slugifyTitle(title).replace(/\//g, "-");
  return slug === "memory-root" ? "MEMORY.md" : `memory/${slug}.md`;
}

function projectionExists(db: DatabaseSync, relativePath: string): boolean {
  const [canonicalKind, compatKind] = resolveMarkdownProjectionKinds(relativePath);
  const row = db
    .prepare(
      `SELECT 1 AS found
       FROM projections
       WHERE kind IN (?, ?)
       LIMIT 1`,
    )
    .get(canonicalKind, compatKind) as
    | {
        found?: number;
      }
    | undefined;
  return Boolean(row?.found);
}

function resolveAvailablePagePath(db: DatabaseSync, title: string): string {
  const basePath = candidatePagePath(title);
  if (!projectionExists(db, basePath)) {
    return basePath;
  }
  const ext = path.posix.extname(basePath) || ".md";
  const stem = basePath.slice(0, -ext.length);
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem}-${index}${ext}`;
    if (!projectionExists(db, candidate)) {
      return candidate;
    }
  }
  return `${stem}-${hashText(title).slice(0, 8)}${ext}`;
}

function buildPageEntityInput(params: {
  db: DatabaseSync;
  pageId?: string;
  title: string;
  content: string;
}): CanonicalMemoryStructuredEntityInput {
  const existing = params.pageId ? readPageIdentity(params.db, params.pageId) : null;
  if (params.pageId && !existing) {
    throw new Error(`page not found: ${params.pageId}`);
  }
  const parsed = parseFrontmatter(params.content);
  const title = normalizeString(params.title) || parsed.title || existing?.title || "Untitled";
  const relativePath = existing?.path ?? resolveAvailablePagePath(params.db, title);
  const pageId =
    existing?.pageId ?? hashText(`page:${normalizeReferenceKey(relativePath) || relativePath}`);
  const aliases = parsed.aliases;
  const tags = parsed.tags;
  const relations = uniqueStrings(
    [
      ...parseWikiReferences(parsed.body),
      ...parseMarkdownReferences(parsed.body, relativePath),
    ].map((entry) => `${entry.ordinal}:${entry.targetKey}`),
  ).map((entry) => {
    const [ordinalRaw, targetLocator] = entry.split(":", 2);
    return {
      relationType: "references",
      targetLocator,
      ordinal: Number(ordinalRaw) || 0,
    };
  });
  return {
    entityId: pageId,
    slug: existing?.slug ?? slugifyTitle(title).replace(/\//g, "-"),
    title,
    aliases,
    tags,
    relations,
    projections: [
      {
        relativePath,
        frontmatter: parsed.rest,
        markdownBody: parsed.body,
      },
    ],
  };
}

async function persistWorkspaceProjection(params: {
  profileId: string;
  workspaceDir: string;
  entity: CanonicalMemoryStructuredEntityInput;
}) {
  const projection = params.entity.projections[0];
  if (!projection) {
    return;
  }
  const relativePath = normalizeDisplayPath(projection.relativePath);
  const filePath = path.join(params.workspaceDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const markdown = buildCanonicalMarkdownProjection({
    profileId: params.profileId,
    entity: params.entity,
    projection,
  });
  await fs.writeFile(filePath, markdown, "utf8");
}

function resolveLedgerPath(status: CanonicalMemoryStoreStatus): string {
  const stateDir = status.replica?.stateDir ?? resolveStateDir(process.env);
  return path.join(stateDir, "state", status.profileId, "memory", "ledger.sqlite");
}

function loadTraceById(
  status: CanonicalMemoryStoreStatus,
  traceId: string,
): { trace: Record<string, unknown>; reasonTags: MemoryReasonTag[]; summary: string[] } | null {
  try {
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(resolveLedgerPath(status), { readOnly: true });
    try {
      const row = db
        .prepare(
          `SELECT event_type, payload_plain
           FROM memory_events
           WHERE profile_id = ? AND event_id = ?
           LIMIT 1`,
        )
        .get(status.profileId, traceId) as
        | {
            event_type: string;
            payload_plain: Uint8Array | Buffer | null;
          }
        | undefined;
      if (!row || row.event_type !== "RETRIEVAL_TRACE_RECORDED" || !row.payload_plain) {
        return null;
      }
      const payload = parseJsonRecord(asBuffer(row.payload_plain).toString("utf8"));
      const trace =
        payload.trace && typeof payload.trace === "object" && !Array.isArray(payload.trace)
          ? (payload.trace as Record<string, unknown>)
          : payload;
      const topFactors = Array.isArray(trace.topFactors)
        ? trace.topFactors
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return null;
              }
              const factor = normalizeString((entry as { factor?: unknown }).factor);
              return factor ? { code: factor, label: factor.replace(/_/g, " ") } : null;
            })
            .filter((entry): entry is MemoryReasonTag => entry !== null)
        : [];
      return {
        trace,
        reasonTags: topFactors,
        summary: buildTraceSummary(trace, topFactors),
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function buildWikiListResult(params: { db: DatabaseSync; query?: string }) {
  const rows = params.db
    .prepare(
      `SELECT
         p.page_id AS page_id,
         p.title AS title,
         p.slug AS slug,
         p.updated_at_ms AS updated_at_ms,
         (
           SELECT pr.kind
           FROM projections pr
           WHERE pr.page_id = p.page_id
           ORDER BY pr.updated_at_ms DESC, pr.kind ASC
           LIMIT 1
         ) AS projection_kind,
         (
           SELECT pr.markdown_body
           FROM projections pr
           WHERE pr.page_id = p.page_id
           ORDER BY pr.updated_at_ms DESC, pr.kind ASC
           LIMIT 1
         ) AS markdown_body,
         (
           SELECT COUNT(*)
           FROM links l
           WHERE l.to_page_id = p.page_id
         ) AS backlink_count,
         COALESCE(
           (SELECT json_group_array(alias_key) FROM page_aliases a WHERE a.page_id = p.page_id),
           '[]'
         ) AS aliases_json,
         COALESCE(
           (SELECT json_group_array(tag) FROM page_tags t WHERE t.page_id = p.page_id),
           '[]'
         ) AS tags_json
       FROM pages p
       WHERE p.tombstoned = 0
       ORDER BY p.updated_at_ms DESC, p.title ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  const query = normalizeString(params.query);
  const candidateCount = rows.length;
  const pages = rows
    .map((row) => {
      const pageId = normalizeString(row.page_id);
      const title = normalizeString(row.title) || pageId;
      const slug = normalizeString(row.slug) || pageId.toLowerCase();
      const pagePath =
        parseMarkdownProjectionPath(normalizeString(row.projection_kind)) ?? `memory/${slug}.md`;
      const markdown = normalizeString(row.markdown_body);
      const parsed = parseFrontmatter(markdown);
      const body = parsed.body;
      const tags = uniqueStrings([...parseJsonStringArray(row.tags_json), ...(parsed.tags ?? [])]);
      const claims = loadClaims(
        params.db,
        {
          pageId,
          title,
          slug,
          path: pagePath,
          aliases: parseJsonStringArray(row.aliases_json),
        },
        body,
        3,
      );
      const evidence = loadEvidence(
        params.db,
        {
          pageId,
          title,
          slug,
          path: pagePath,
          aliases: parseJsonStringArray(row.aliases_json),
        },
        body,
        3,
      );
      const updatedAtMs = normalizeNumber(row.updated_at_ms);
      const reason = query
        ? scoreByQuery(
            query,
            {
              title: [title],
              alias: parseJsonStringArray(row.aliases_json),
              path: [pagePath],
              tag: tags,
              body: [body],
            },
            updatedAtMs,
          )
        : { score: 0.5, reasonTags: [] };
      const trace =
        query && reason.reasonTags.length > 0
          ? buildPageTrace({
              query,
              page: { id: pageId, title, path: pagePath },
              reasonTags: reason.reasonTags,
              candidateCount,
              hitCount: 0,
              backlinks: normalizeNumber(row.backlink_count) ?? 0,
              claims: claims.length,
              evidence: evidence.length,
            })
          : undefined;
      return {
        score: reason.score,
        page: {
          id: pageId,
          title,
          slug,
          path: pagePath,
          excerpt: summarizeText(body, 160),
          ...buildWikiTaxonomy({
            parsed,
            fallbackTags: tags,
            fallbackSummary: summarizeText(body, 180),
          }),
          updatedAt: toIso(row.updated_at_ms),
          backlinks: normalizeNumber(row.backlink_count) ?? 0,
          claims: claims.length,
          evidence: evidence.length,
          ...(reason.reasonTags.length > 0 ? { reasonTags: reason.reasonTags } : {}),
          ...(trace ? { trace, traceSummary: buildTraceSummary(trace, reason.reasonTags) } : {}),
        } satisfies NativeWikiListPage,
      };
    })
    .filter((entry) => !query || entry.score > 0)
    .sort((left, right) => {
      if (query && right.score !== left.score) {
        return right.score - left.score;
      }
      if (query) {
        return left.page.title.localeCompare(right.page.title);
      }
      return 0;
    });
  const hitCount = pages.length;
  return pages.map((entry) => {
    if (query && entry.page.trace) {
      entry.page.trace = {
        ...entry.page.trace,
        hitCount,
      };
      entry.page.traceSummary = buildTraceSummary(entry.page.trace, entry.page.reasonTags ?? []);
    }
    return entry.page;
  });
}

function buildFileEntry(params: {
  db: DatabaseSync;
  attachment: AttachmentRow;
  query?: string;
  candidateCount: number;
  hitCount?: number;
}) {
  const name = resolveAttachmentName(params.attachment.blob_id, params.attachment.mime);
  const updatedAtMs = normalizeNumber(params.attachment.created_at_ms);
  const query = normalizeString(params.query);
  const reason = query
    ? scoreByQuery(
        query,
        {
          title: [name],
          alias: [params.attachment.blob_id],
          path: [params.attachment.sha256],
          tag: [params.attachment.mime],
          body: [params.attachment.sha256],
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
  return {
    score: reason.score,
    file: {
      id: params.attachment.blob_id,
      name,
      mediaType: params.attachment.mime,
      size: asBuffer(params.attachment.bytes).byteLength,
      updatedAt: toIso(params.attachment.created_at_ms),
      provenanceSummary: `SHA-256 ${params.attachment.sha256.slice(0, 12)}`,
      provenance: formatAttachmentProvenance(params.attachment),
      relatedPages: loadRelatedPagesForAttachment(params.db, params.attachment),
      ...(reason.reasonTags.length > 0 ? { reasonTags: reason.reasonTags } : {}),
      ...(trace ? { trace, traceSummary: buildTraceSummary(trace, reason.reasonTags) } : {}),
    } satisfies NativeFileEntry,
  };
}

function buildFilesListResult(params: { db: DatabaseSync; query?: string }) {
  const attachments = loadAttachments(params.db);
  const query = normalizeString(params.query);
  const candidateCount = attachments.length;
  const files = attachments
    .map((attachment) =>
      buildFileEntry({
        db: params.db,
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

async function buildExportResult(params: {
  db: DatabaseSync;
  agentId: string;
  canonicalStore: CanonicalMemoryStoreStatus;
  format: "zip" | "json" | "markdown";
}) {
  const pages = buildWikiListResult({
    db: params.db,
  })
    .map((page) => {
      const detail = buildWikiPageDetail({
        db: params.db,
        canonicalStore: params.canonicalStore,
        pageId: page.id,
      });
      return detail
        ? {
            id: detail.id,
            title: detail.title,
            path: detail.path,
            content: detail.content,
            backlinks: detail.backlinks.map((entry) => entry.path),
            claims: detail.claims.map((entry) => entry.claim),
            evidence: detail.evidence.map((entry) => entry.source ?? entry.id ?? ""),
          }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const attachments = loadAttachments(params.db).map((attachment) => ({
    id: attachment.blob_id,
    name: resolveAttachmentName(attachment.blob_id, attachment.mime),
    mediaType: attachment.mime,
    sha256: attachment.sha256,
    size: asBuffer(attachment.bytes).byteLength,
    bytes: asBuffer(attachment.bytes),
  }));

  if (params.format === "json") {
    return {
      format: "json",
      fileName: `alisio-memory-${params.agentId}.json`,
      mediaType: "application/json",
      content: JSON.stringify(
        {
          agentId: params.agentId,
          exportedAt: new Date().toISOString(),
          sync: buildSyncSurface(params.canonicalStore),
          pages: pages.map((page) => ({
            ...page,
            contentPreview: summarizeText(page.content, 240),
          })),
          files: attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            mediaType: attachment.mediaType,
            sha256: attachment.sha256,
            size: attachment.size,
          })),
        },
        null,
        2,
      ),
    };
  }

  if (params.format === "markdown") {
    const content = [
      "# Alisio Memory Export",
      "",
      `- Agent: ${params.agentId}`,
      `- Profile: ${params.canonicalStore.profileId}`,
      `- Last synced lamport: ${params.canonicalStore.lastSyncedLamport}`,
      "",
      "## Wiki",
      "",
      ...pages.flatMap((page) => [
        `### ${page.title}`,
        "",
        `Path: \`${page.path}\``,
        "",
        page.content.trimEnd(),
        "",
      ]),
      "## Files",
      "",
      ...attachments.flatMap((attachment) => [
        `- ${attachment.name} (${attachment.mediaType}, ${attachment.size} bytes, ${attachment.sha256})`,
      ]),
      "",
    ].join("\n");
    return {
      format: "markdown",
      fileName: `alisio-memory-${params.agentId}.md`,
      mediaType: "text/markdown",
      content,
    };
  }

  const zip = new JSZip();
  zip.file(
    "memory-export.json",
    JSON.stringify(
      {
        agentId: params.agentId,
        exportedAt: new Date().toISOString(),
        sync: buildSyncSurface(params.canonicalStore),
        pages: pages.map((page) => ({
          id: page.id,
          title: page.title,
          path: page.path,
          backlinks: page.backlinks,
        })),
        files: attachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mediaType: attachment.mediaType,
          sha256: attachment.sha256,
          size: attachment.size,
        })),
      },
      null,
      2,
    ),
  );
  for (const page of pages) {
    zip.file(page.path, page.content);
  }
  for (const attachment of attachments) {
    zip.file(path.posix.join("attachments", attachment.name), attachment.bytes);
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return {
    format: "zip",
    fileName: `alisio-memory-${params.agentId}.zip`,
    mediaType: "application/zip",
    bytesBase64: buffer.toString("base64"),
  };
}

export async function handleMemoryWikiListGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const context = await resolveNativeMemoryContext({
    method: "memory.wiki.list",
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
        exportFormats: ["zip", "json", "markdown"],
        pages: buildWikiListResult({
          db,
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

export async function handleMemoryWikiGetGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const pageId = normalizeString(params.pageId);
  if (!pageId) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.wiki.get requires pageId");
    return;
  }
  const context = await resolveNativeMemoryContext({
    method: "memory.wiki.get",
    request: params,
    respond,
  });
  if (!context) {
    return;
  }
  const db = openCanonicalDb(context.canonicalStore);
  try {
    const page = buildWikiPageDetail({
      db,
      canonicalStore: context.canonicalStore,
      pageId,
      query: normalizeString(params.query),
    });
    if (!page) {
      respondGatewayError(respond, "NOT_FOUND", `memory page not found: ${pageId}`);
      return;
    }
    respond(
      true,
      {
        agentId: context.agentId,
        sync: buildSyncSurface(context.canonicalStore),
        page,
      },
      undefined,
    );
  } finally {
    db.close();
    await context.close();
  }
}

export async function handleMemoryWikiUpdateGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const title = normalizeString(params.title);
  const content = typeof params.content === "string" ? params.content : "";
  if (!title) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.wiki.update requires title");
    return;
  }
  if (typeof params.content !== "string") {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.wiki.update requires content");
    return;
  }
  const context = await resolveNativeMemoryContext({
    method: "memory.wiki.update",
    request: params,
    respond,
    syncIfDirty: false,
  });
  if (!context) {
    return;
  }
  const db = openCanonicalDb(context.canonicalStore);
  const pageId = normalizeString(params.pageId) || undefined;
  let dbClosed = false;
  try {
    const entity = buildPageEntityInput({
      db,
      pageId,
      title,
      content,
    });
    db.close();
    dbClosed = true;
    const updatedStatus = await upsertCanonicalMemoryStructuredEntities({
      cfg: context.cfg,
      agentId: context.agentId,
      workspaceDir: context.canonicalStore.workspaceDir,
      backend: context.canonicalStore.backend,
      env: process.env,
      entities: [entity],
    });
    await persistWorkspaceProjection({
      profileId: context.canonicalStore.profileId,
      workspaceDir: context.canonicalStore.workspaceDir,
      entity,
    });
    const refreshedDb = openCanonicalDb(updatedStatus);
    try {
      const page = buildWikiPageDetail({
        db: refreshedDb,
        canonicalStore: updatedStatus,
        pageId: entity.entityId ?? pageId ?? "",
        query: normalizeString(params.query),
      });
      respond(
        true,
        {
          ok: true,
          agentId: context.agentId,
          page,
          revision: page?.revision ?? null,
          sync: buildSyncSurface(updatedStatus),
        },
        undefined,
      );
    } finally {
      refreshedDb.close();
    }
  } catch (error) {
    if (!dbClosed) {
      db.close();
    }
    respondGatewayError(
      respond,
      "UNAVAILABLE",
      `memory.wiki.update failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await context.close();
    return;
  }
  await context.close();
}

export async function handleMemoryWikiHistoryGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const pageId = normalizeString(params.pageId);
  if (!pageId) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.wiki.history requires pageId");
    return;
  }
  const context = await resolveNativeMemoryContext({
    method: "memory.wiki.history",
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
        pageId,
        history: loadHistoryEntries(context.canonicalStore, pageId),
      },
      undefined,
    );
  } finally {
    db.close();
    await context.close();
  }
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
    const query = normalizeString(params.query);
    const detail =
      buildFilesListResult({
        db,
        query,
      }).find((file) => file.id === fileId) ??
      (() => {
        const attachments = loadAttachments(db);
        const attachment = attachments.find((file) => file.blob_id === fileId);
        if (!attachment) {
          return null;
        }
        return buildFileEntry({
          db,
          attachment,
          candidateCount: attachments.length,
        }).file;
      })();
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

export async function handleMemoryTraceGetGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const traceId = normalizeString(params.traceId);
  if (!traceId) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.trace.get requires traceId");
    return;
  }
  const context = await resolveNativeMemoryContext({
    method: "memory.trace.get",
    request: params,
    respond,
    syncIfDirty: false,
  });
  if (!context) {
    return;
  }
  try {
    const trace = loadTraceById(context.canonicalStore, traceId);
    if (!trace) {
      respondGatewayError(respond, "NOT_FOUND", `retrieval trace not found: ${traceId}`);
      return;
    }
    respond(
      true,
      {
        traceId,
        summary: trace.summary,
        reasonTags: trace.reasonTags,
        raw: trace.trace,
      },
      undefined,
    );
  } finally {
    await context.close();
  }
}

export async function handleMemoryExportGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const format = normalizeString(params.format);
  if (format !== "zip" && format !== "json" && format !== "markdown") {
    respondGatewayError(
      respond,
      "INVALID_REQUEST",
      "memory.export requires format=zip|json|markdown",
    );
    return;
  }
  const context = await resolveNativeMemoryContext({
    method: "memory.export",
    request: params,
    respond,
  });
  if (!context) {
    return;
  }
  const db = openCanonicalDb(context.canonicalStore);
  try {
    const result = await buildExportResult({
      db,
      agentId: context.agentId,
      canonicalStore: context.canonicalStore,
      format,
    });
    respond(true, result, undefined);
  } finally {
    db.close();
    await context.close();
  }
}
