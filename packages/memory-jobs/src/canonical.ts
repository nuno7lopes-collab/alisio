import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { normalizeTextKey, textSimilarity } from "./text.js";
import { normalizeNumber, uniqueStrings } from "./utils.js";

const MARKDOWN_PROJECTION_PREFIX_ALIASES = ["md-path:", "legacy-markdown:"] as const;

export type SleepClaimSnapshot = {
  claimId: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: string;
  updatedAtMs: number;
};

export type SleepPageSnapshot = {
  pageId: string;
  title: string;
  slug: string;
  aliases: string[];
  tags: string[];
  createdAtMs: number;
  updatedAtMs: number;
  tombstoned: boolean;
  claim?: SleepClaimSnapshot;
};

export type SleepProjectionSnapshot = {
  pageId: string;
  kind: string;
  markdownBody: string;
  updatedAtMs: number;
  relativePath: string;
  absolutePath: string;
};

type PageRow = {
  page_id: string;
  title: string;
  slug: string;
  created_at_ms: number | bigint;
  updated_at_ms: number | bigint;
  tombstoned: number | bigint;
};

type ClaimRow = {
  claim_id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: string;
  updated_at_ms: number | bigint;
};

type ProjectionRow = {
  page_id: string;
  kind: string;
  markdown_body: string;
  updated_at_ms: number | bigint;
};

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function listPageAliases(db: DatabaseSync, pageId: string): string[] {
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
  return rows.map((row) => row.alias_key);
}

function listPageTags(db: DatabaseSync, pageId: string): string[] {
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
  return rows.map((row) => row.tag);
}

function readClaim(db: DatabaseSync, pageId: string): SleepClaimSnapshot | undefined {
  const row = db
    .prepare(
      `SELECT claim_id, subject, predicate, object, confidence, status, updated_at_ms
       FROM claims
       WHERE claim_id = ?
       LIMIT 1`,
    )
    .get(pageId) as ClaimRow | undefined;
  if (!row) {
    return undefined;
  }
  return {
    claimId: row.claim_id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    confidence: row.confidence,
    status: row.status,
    updatedAtMs: toNumber(row.updated_at_ms),
  };
}

function toPageSnapshot(db: DatabaseSync, row: PageRow): SleepPageSnapshot {
  return {
    pageId: row.page_id,
    title: row.title,
    slug: row.slug,
    aliases: listPageAliases(db, row.page_id),
    tags: listPageTags(db, row.page_id),
    createdAtMs: toNumber(row.created_at_ms),
    updatedAtMs: toNumber(row.updated_at_ms),
    tombstoned: toNumber(row.tombstoned) === 1,
    ...(readClaim(db, row.page_id) ? { claim: readClaim(db, row.page_id) } : {}),
  };
}

function toProjectionSnapshot(params: {
  row: ProjectionRow;
  workspaceDir: string;
}): SleepProjectionSnapshot {
  const relativePath = parseProjectionPath(params.row.kind, params.row.page_id);
  return {
    pageId: params.row.page_id,
    kind: params.row.kind,
    markdownBody: params.row.markdown_body,
    updatedAtMs: toNumber(params.row.updated_at_ms),
    relativePath,
    absolutePath: path.join(params.workspaceDir, relativePath),
  };
}

export function listPagesAfter(params: {
  db: DatabaseSync;
  afterPageId?: string;
  limit: number;
  taggedAnyOf?: readonly string[];
  excludeTaggedAnyOf?: readonly string[];
  includeTombstoned?: boolean;
}): SleepPageSnapshot[] {
  const filters = [params.includeTombstoned ? "1 = 1" : "tombstoned = 0"];
  const bindings: Array<string | number> = [];
  if (params.afterPageId) {
    filters.push(`page_id > ?`);
    bindings.push(params.afterPageId);
  }
  bindings.push(params.limit);
  const rows = params.db
    .prepare(
      `SELECT page_id, title, slug, created_at_ms, updated_at_ms, tombstoned
       FROM pages
       WHERE ${filters.join(" AND ")}
       ORDER BY page_id ASC
       LIMIT ?`,
    )
    .all(...bindings) as PageRow[];
  return rows
    .map((row) => toPageSnapshot(params.db, row))
    .filter((page) => {
      if (
        params.taggedAnyOf?.length &&
        !page.tags.some((tag) => params.taggedAnyOf!.includes(tag))
      ) {
        return false;
      }
      if (
        params.excludeTaggedAnyOf?.length &&
        page.tags.some((tag) => params.excludeTaggedAnyOf!.includes(tag))
      ) {
        return false;
      }
      return true;
    });
}

export function listClaimsAfter(params: {
  db: DatabaseSync;
  afterClaimId?: string;
  limit: number;
  statuses?: readonly string[];
}): SleepClaimSnapshot[] {
  const filters: string[] = [];
  const bindings: Array<string | number> = [];
  if (params.afterClaimId) {
    filters.push(`claim_id > ?`);
    bindings.push(params.afterClaimId);
  }
  if (params.statuses?.length) {
    filters.push(`status IN (${params.statuses.map(() => "?").join(", ")})`);
    bindings.push(...params.statuses);
  }
  bindings.push(params.limit);
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = params.db
    .prepare(
      `SELECT claim_id, subject, predicate, object, confidence, status, updated_at_ms
       FROM claims
       ${where}
       ORDER BY claim_id ASC
       LIMIT ?`,
    )
    .all(...bindings) as ClaimRow[];
  return rows.map((row) => ({
    claimId: row.claim_id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    confidence: row.confidence,
    status: row.status,
    updatedAtMs: toNumber(row.updated_at_ms),
  }));
}

export function listProjectionsAfter(params: {
  db: DatabaseSync;
  afterProjectionKey?: string;
  limit: number;
  workspaceDir: string;
}): SleepProjectionSnapshot[] {
  const rows = params.db
    .prepare(
      `SELECT page_id, kind, markdown_body, updated_at_ms
       FROM projections
       ORDER BY page_id ASC, kind ASC`,
    )
    .all() as ProjectionRow[];
  const projected = rows.map((row) =>
    toProjectionSnapshot({
      row,
      workspaceDir: params.workspaceDir,
    }),
  );
  const filtered = params.afterProjectionKey
    ? projected.filter(
        (projection) => `${projection.pageId}:${projection.kind}` > params.afterProjectionKey!,
      )
    : projected;
  return filtered.slice(0, params.limit);
}

export function readPage(db: DatabaseSync, pageId: string): SleepPageSnapshot | undefined {
  const row = db
    .prepare(
      `SELECT page_id, title, slug, created_at_ms, updated_at_ms, tombstoned
       FROM pages
       WHERE page_id = ?
       LIMIT 1`,
    )
    .get(pageId) as PageRow | undefined;
  return row ? toPageSnapshot(db, row) : undefined;
}

export function readPrimaryProjection(
  db: DatabaseSync,
  pageId: string,
  workspaceDir: string,
): SleepProjectionSnapshot | undefined {
  const row = db
    .prepare(
      `SELECT page_id, kind, markdown_body, updated_at_ms
       FROM projections
       WHERE page_id = ?
       ORDER BY kind ASC
       LIMIT 1`,
    )
    .get(pageId) as ProjectionRow | undefined;
  return row
    ? toProjectionSnapshot({
        row,
        workspaceDir,
      })
    : undefined;
}

export function readPageByRelativePath(
  db: DatabaseSync,
  relativePath: string,
): SleepPageSnapshot | undefined {
  const row = db
    .prepare(
      `SELECT page_id
       FROM projections
       WHERE kind IN (?, ?)
       ORDER BY updated_at_ms DESC
       LIMIT 1`,
    )
    .get(`md-path:${relativePath}`, `legacy-markdown:${relativePath}`) as
    | {
        page_id: string;
      }
    | undefined;
  return row?.page_id ? readPage(db, row.page_id) : undefined;
}

export function readProjectionByRelativePath(params: {
  db: DatabaseSync;
  relativePath: string;
  workspaceDir: string;
}): SleepProjectionSnapshot | undefined {
  const row = params.db
    .prepare(
      `SELECT page_id, kind, markdown_body, updated_at_ms
       FROM projections
       WHERE kind IN (?, ?)
       ORDER BY updated_at_ms DESC
       LIMIT 1`,
    )
    .get(
      `md-path:${params.relativePath}`,
      `legacy-markdown:${params.relativePath}`,
    ) as ProjectionRow | undefined;
  return row
    ? toProjectionSnapshot({
        row,
        workspaceDir: params.workspaceDir,
      })
    : undefined;
}

export function countPageProjections(db: DatabaseSync, pageId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM projections
       WHERE page_id = ?`,
    )
    .get(pageId) as
    | {
        count: number;
      }
    | undefined;
  return row?.count ?? 0;
}

export function countPageAliases(db: DatabaseSync, pageId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM page_aliases
       WHERE page_id = ?`,
    )
    .get(pageId) as
    | {
        count: number;
      }
    | undefined;
  return row?.count ?? 0;
}

export function choosePageMergeWinner(params: {
  db: DatabaseSync;
  left: SleepPageSnapshot;
  right: SleepPageSnapshot;
}): {
  winner: SleepPageSnapshot;
  loser: SleepPageSnapshot;
} {
  const candidates = [params.left, params.right].map((page) => ({
    page,
    score:
      countPageProjections(params.db, page.pageId) * 3 +
      countPageAliases(params.db, page.pageId) * 2 +
      (page.claim?.confidence ?? 0) * 10 +
      page.title.length / 200 +
      page.updatedAtMs / 1_000_000_000_000,
  }));
  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.page.pageId.localeCompare(right.page.pageId);
  });
  return {
    winner: candidates[0].page,
    loser: candidates[1].page,
  };
}

export function mergePageMetadata(params: {
  winner: SleepPageSnapshot;
  loser: SleepPageSnapshot;
}): {
  aliases: string[];
  tags: string[];
} {
  return {
    aliases: uniqueStrings([
      ...params.winner.aliases,
      ...params.loser.aliases,
      params.loser.slug,
      params.loser.title,
    ]),
    tags: uniqueStrings([...params.winner.tags, ...params.loser.tags]),
  };
}

export function chooseProjectionWinner(
  left: SleepProjectionSnapshot,
  right: SleepProjectionSnapshot,
): {
  winner: SleepProjectionSnapshot;
  loser: SleepProjectionSnapshot;
} {
  const leftScore = left.markdownBody.length + left.updatedAtMs / 1_000_000_000_000;
  const rightScore = right.markdownBody.length + right.updatedAtMs / 1_000_000_000_000;
  if (rightScore > leftScore) {
    return {
      winner: right,
      loser: left,
    };
  }
  return {
    winner: left,
    loser: right,
  };
}

export function findPotentialPageDuplicates(params: {
  db: DatabaseSync;
  page: SleepPageSnapshot;
  workspaceDir: string;
}): Array<{
  candidate: SleepPageSnapshot;
  similarity: number;
  reason: string;
}> {
  const projection = readPrimaryProjection(params.db, params.page.pageId, params.workspaceDir);
  const projectionBody = normalizeTextKey(projection?.markdownBody ?? "");
  const others = listPagesAfter({
    db: params.db,
    limit: 512,
    includeTombstoned: false,
  }).filter((candidate) => candidate.pageId !== params.page.pageId);
  const matches: Array<{
    candidate: SleepPageSnapshot;
    similarity: number;
    reason: string;
  }> = [];
  for (const candidate of others) {
    const titleScore = textSimilarity(params.page.title, candidate.title);
    const candidateProjection = readPrimaryProjection(
      params.db,
      candidate.pageId,
      params.workspaceDir,
    );
    const bodyScore = textSimilarity(
      projectionBody,
      normalizeTextKey(candidateProjection?.markdownBody ?? ""),
    );
    const score = Math.max(titleScore, (titleScore + bodyScore) / 2);
    const titleKey = normalizeTextKey(params.page.title);
    const candidateKey = normalizeTextKey(candidate.title);
    if (titleKey && titleKey === candidateKey) {
      matches.push({
        candidate,
        similarity: Math.max(score, 0.95),
        reason: "same-normalized-title",
      });
      continue;
    }
    if (titleScore >= 0.85 || (titleScore >= 0.72 && bodyScore >= 0.72)) {
      matches.push({
        candidate,
        similarity: score,
        reason: titleScore >= 0.85 ? "title-similarity" : "title-and-body-similarity",
      });
    }
  }
  return matches.toSorted((left, right) => right.similarity - left.similarity);
}

function parseProjectionPath(kind: string, pageId: string): string {
  for (const prefix of MARKDOWN_PROJECTION_PREFIX_ALIASES) {
    if (kind.startsWith(prefix)) {
      return kind.slice(prefix.length);
    }
  }
  return path.join("memory", `${pageId}.md`);
}

export function extractAttachmentPaths(params: {
  projection: SleepProjectionSnapshot;
  workspaceDir: string;
}): string[] {
  const matches = Array.from(
    params.projection.markdownBody.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g),
    (match) => match[1]?.trim() ?? "",
  )
    .filter(Boolean)
    .filter((value) => !/^https?:\/\//i.test(value));
  return uniqueStrings(
    matches.map((attachmentPath) =>
      path.isAbsolute(attachmentPath)
        ? attachmentPath
        : path.resolve(
            params.workspaceDir,
            path.dirname(params.projection.relativePath),
            attachmentPath,
          ),
    ),
  );
}

export function attachmentExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function resolveClaimPolarity(
  claim: SleepClaimSnapshot,
  projection?: SleepProjectionSnapshot,
): boolean | undefined {
  const text = `${claim.predicate} ${claim.object} ${projection?.markdownBody ?? ""}`.toLowerCase();
  if (/\b(not|never|false|disabled|deny|denied|doesn't|does not)\b/.test(text)) {
    return false;
  }
  if (/\b(true|enabled|allow|allowed|works|required)\b/.test(text)) {
    return true;
  }
  return undefined;
}

export function readContradictingClaims(params: {
  db: DatabaseSync;
  claim: SleepClaimSnapshot;
  polarity: boolean;
  workspaceDir: string;
}): SleepClaimSnapshot[] {
  const candidates = listClaimsAfter({
    db: params.db,
    limit: 512,
    statuses: ["active"],
  }).filter((candidate) => candidate.claimId !== params.claim.claimId);
  return candidates.filter((candidate) => {
    if (
      normalizeTextKey(candidate.subject) !== normalizeTextKey(params.claim.subject) ||
      normalizeTextKey(candidate.predicate) !== normalizeTextKey(params.claim.predicate)
    ) {
      return false;
    }
    const projection = readPrimaryProjection(params.db, candidate.claimId, params.workspaceDir);
    const candidatePolarity = resolveClaimPolarity(candidate, projection);
    return candidatePolarity != null && candidatePolarity !== params.polarity;
  });
}

export function isLowConfidence(page: SleepPageSnapshot): number | undefined {
  return page.claim ? normalizeNumber(page.claim.confidence) : undefined;
}

export function isLikelyCandidate(page: SleepPageSnapshot): boolean {
  return (
    !page.tombstoned &&
    !page.tags.includes("claim") &&
    !page.tags.includes("procedure") &&
    !page.claim
  );
}
