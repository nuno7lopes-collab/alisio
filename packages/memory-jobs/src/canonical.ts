import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { normalizeTextKey, textSimilarity } from "./text.js";
import {
  normalizeBoolean,
  normalizeNumber,
  parseJsonRecord,
  stableStringify,
  uniqueStrings,
} from "./utils.js";

export type CanonicalEntitySnapshot = {
  entityId: string;
  profileId: string;
  workspaceScope: string;
  kind: string;
  slug: string;
  title: string;
  sourcePath: string;
  sourceKind: string;
  contentHash: string;
  updatedAtMs: number;
  metadata: Record<string, unknown>;
};

export type CanonicalProjectionSnapshot = {
  projectionId: string;
  profileId: string;
  workspaceScope: string;
  entityId: string;
  projectionKind: string;
  relativePath: string;
  absolutePath: string;
  editable: boolean;
  sourceKind: string;
  contentHash: string;
  frontmatter: Record<string, unknown>;
  markdownBody: string;
  updatedAtMs: number;
  metadata: Record<string, unknown>;
};

type EntityRow = {
  entity_id: string;
  profile_id: string;
  workspace_scope: string;
  kind: string;
  slug: string;
  title: string;
  source_path: string;
  source_kind: string;
  content_hash: string;
  updated_at: number;
  metadata: string;
};

type ProjectionRow = {
  projection_id: string;
  profile_id: string;
  workspace_scope: string;
  entity_id: string;
  projection_kind: string;
  relative_path: string;
  absolute_path: string;
  editable: number;
  source_kind: string;
  content_hash: string;
  frontmatter_json: string;
  markdown_body: string;
  updated_at: number;
  metadata: string;
};

export function ensureCanonicalMemorySchemaForTests(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      entity_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      workspace_scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'markdown-import'
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_aliases (
      profile_id TEXT NOT NULL,
      workspace_scope TEXT NOT NULL,
      alias_key TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      origin TEXT NOT NULL DEFAULT 'markdown-import',
      PRIMARY KEY(profile_id, workspace_scope, alias_key, entity_id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS relations (
      relation_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      workspace_scope TEXT NOT NULL,
      from_entity_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      to_entity_id TEXT,
      target_locator TEXT,
      ordinal INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'markdown-import'
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS projections (
      projection_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      workspace_scope TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      projection_kind TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      editable INTEGER NOT NULL,
      source_kind TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      frontmatter_json TEXT NOT NULL,
      markdown_body TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'markdown-import'
    );
  `);
}

function toEntitySnapshot(row: EntityRow): CanonicalEntitySnapshot {
  return {
    entityId: row.entity_id,
    profileId: row.profile_id,
    workspaceScope: row.workspace_scope,
    kind: row.kind,
    slug: row.slug,
    title: row.title,
    sourcePath: row.source_path,
    sourceKind: row.source_kind,
    contentHash: row.content_hash,
    updatedAtMs: row.updated_at,
    metadata: parseJsonRecord(row.metadata),
  };
}

function toProjectionSnapshot(row: ProjectionRow): CanonicalProjectionSnapshot {
  return {
    projectionId: row.projection_id,
    profileId: row.profile_id,
    workspaceScope: row.workspace_scope,
    entityId: row.entity_id,
    projectionKind: row.projection_kind,
    relativePath: row.relative_path,
    absolutePath: row.absolute_path,
    editable: row.editable === 1,
    sourceKind: row.source_kind,
    contentHash: row.content_hash,
    frontmatter: parseJsonRecord(row.frontmatter_json),
    markdownBody: row.markdown_body,
    updatedAtMs: row.updated_at,
    metadata: parseJsonRecord(row.metadata),
  };
}

export function listEntitiesAfter(params: {
  db: DatabaseSync;
  profileId: string;
  workspaceScope: string;
  afterEntityId?: string;
  limit: number;
  kinds?: readonly string[];
}): CanonicalEntitySnapshot[] {
  const filters = [`profile_id = ?`, `workspace_scope = ?`];
  const bindings: Array<string | number> = [params.profileId, params.workspaceScope];
  if (params.afterEntityId) {
    filters.push(`entity_id > ?`);
    bindings.push(params.afterEntityId);
  }
  if (params.kinds?.length) {
    filters.push(`kind IN (${params.kinds.map(() => "?").join(", ")})`);
    bindings.push(...params.kinds);
  }
  bindings.push(params.limit);
  const rows = params.db
    .prepare(
      `SELECT entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind, content_hash, updated_at, metadata
       FROM entities
       WHERE ${filters.join(" AND ")}
       ORDER BY entity_id ASC
       LIMIT ?`,
    )
    .all(...bindings) as EntityRow[];
  return rows.map(toEntitySnapshot);
}

export function listProjectionsAfter(params: {
  db: DatabaseSync;
  profileId: string;
  workspaceScope: string;
  afterProjectionId?: string;
  limit: number;
}): CanonicalProjectionSnapshot[] {
  const filters = [`profile_id = ?`, `workspace_scope = ?`];
  const bindings: Array<string | number> = [params.profileId, params.workspaceScope];
  if (params.afterProjectionId) {
    filters.push(`projection_id > ?`);
    bindings.push(params.afterProjectionId);
  }
  bindings.push(params.limit);
  const rows = params.db
    .prepare(
      `SELECT
         projection_id,
         profile_id,
         workspace_scope,
         entity_id,
         projection_kind,
         relative_path,
         absolute_path,
         editable,
         source_kind,
         content_hash,
         frontmatter_json,
         markdown_body,
         updated_at,
         metadata
       FROM projections
       WHERE ${filters.join(" AND ")}
       ORDER BY projection_id ASC
       LIMIT ?`,
    )
    .all(...bindings) as ProjectionRow[];
  return rows.map(toProjectionSnapshot);
}

export function readPrimaryProjection(
  db: DatabaseSync,
  profileId: string,
  workspaceScope: string,
  entityId: string,
): CanonicalProjectionSnapshot | undefined {
  const row = db
    .prepare(
      `SELECT
         projection_id,
         profile_id,
         workspace_scope,
         entity_id,
         projection_kind,
         relative_path,
         absolute_path,
         editable,
         source_kind,
         content_hash,
         frontmatter_json,
         markdown_body,
         updated_at,
         metadata
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?
       ORDER BY relative_path ASC, projection_id ASC
       LIMIT 1`,
    )
    .get(profileId, workspaceScope, entityId) as ProjectionRow | undefined;
  return row ? toProjectionSnapshot(row) : undefined;
}

export function listEntityAliases(
  db: DatabaseSync,
  profileId: string,
  workspaceScope: string,
  entityId: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT alias_key
       FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?
       ORDER BY alias_key ASC`,
    )
    .all(profileId, workspaceScope, entityId) as Array<{ alias_key: string }>;
  return rows.map((row) => row.alias_key);
}

export function countEntityProjections(
  db: DatabaseSync,
  profileId: string,
  workspaceScope: string,
  entityId: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?`,
    )
    .get(profileId, workspaceScope, entityId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function countEntityAliases(
  db: DatabaseSync,
  profileId: string,
  workspaceScope: string,
  entityId: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?`,
    )
    .get(profileId, workspaceScope, entityId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function updateEntityKind(params: {
  db: DatabaseSync;
  entity: CanonicalEntitySnapshot;
  nextKind: string;
  score: number;
  reason: string;
  nowMs: number;
}): void {
  const metadata = {
    ...params.entity.metadata,
    sleepPromotionScore: params.score,
    sleepPromotedAtMs: params.nowMs,
    sleepPromotedFrom: params.entity.kind,
    sleepPromotionReason: params.reason,
  };
  params.db
    .prepare(`UPDATE entities SET kind = ?, updated_at = ?, metadata = ? WHERE entity_id = ?`)
    .run(params.nextKind, params.nowMs, stableStringify(metadata), params.entity.entityId);
}

type MergePlan = {
  winner: CanonicalEntitySnapshot;
  loser: CanonicalEntitySnapshot;
};

export function chooseEntityMergeWinner(params: {
  db: DatabaseSync;
  left: CanonicalEntitySnapshot;
  right: CanonicalEntitySnapshot;
}): MergePlan {
  const candidates = [params.left, params.right].map((entity) => ({
    entity,
    score:
      countEntityProjections(params.db, entity.profileId, entity.workspaceScope, entity.entityId) *
        3 +
      countEntityAliases(params.db, entity.profileId, entity.workspaceScope, entity.entityId) * 2 +
      (normalizeNumber(entity.metadata.confidence) ?? 0) * 10 +
      entity.title.length / 200,
  }));
  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.entity.entityId.localeCompare(right.entity.entityId);
  });
  return {
    winner: candidates[0].entity,
    loser: candidates[1].entity,
  };
}

export function mergeEntities(params: {
  db: DatabaseSync;
  winner: CanonicalEntitySnapshot;
  loser: CanonicalEntitySnapshot;
  nowMs: number;
}): {
  deletedProjectionIds: string[];
  deletedRelationIds: string[];
} {
  const winnerProjectionPaths = new Set(
    params.db
      .prepare(
        `SELECT relative_path
         FROM projections
         WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?`,
      )
      .all(params.winner.profileId, params.winner.workspaceScope, params.winner.entityId)
      .map((row) => (row as { relative_path: string }).relative_path),
  );
  const loserProjectionRows = params.db
    .prepare(
      `SELECT projection_id, relative_path
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?
       ORDER BY relative_path ASC`,
    )
    .all(params.loser.profileId, params.loser.workspaceScope, params.loser.entityId) as Array<{
    projection_id: string;
    relative_path: string;
  }>;

  const deletedProjectionIds: string[] = [];
  for (const projection of loserProjectionRows) {
    if (winnerProjectionPaths.has(projection.relative_path)) {
      params.db
        .prepare(`DELETE FROM projections WHERE projection_id = ?`)
        .run(projection.projection_id);
      deletedProjectionIds.push(projection.projection_id);
      continue;
    }
    params.db
      .prepare(`UPDATE projections SET entity_id = ?, updated_at = ? WHERE projection_id = ?`)
      .run(params.winner.entityId, params.nowMs, projection.projection_id);
  }

  params.db
    .prepare(
      `INSERT OR IGNORE INTO entity_aliases (
         profile_id,
         workspace_scope,
         alias_key,
         entity_id,
         updated_at,
         origin
       )
       SELECT profile_id, workspace_scope, alias_key, ?, ?, origin
       FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?`,
    )
    .run(
      params.winner.entityId,
      params.nowMs,
      params.loser.profileId,
      params.loser.workspaceScope,
      params.loser.entityId,
    );
  params.db
    .prepare(
      `DELETE FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?`,
    )
    .run(params.loser.profileId, params.loser.workspaceScope, params.loser.entityId);

  params.db
    .prepare(
      `UPDATE relations
       SET from_entity_id = ?, updated_at = ?
       WHERE profile_id = ? AND workspace_scope = ? AND from_entity_id = ?`,
    )
    .run(
      params.winner.entityId,
      params.nowMs,
      params.loser.profileId,
      params.loser.workspaceScope,
      params.loser.entityId,
    );
  params.db
    .prepare(
      `UPDATE relations
       SET to_entity_id = ?, updated_at = ?
       WHERE profile_id = ? AND workspace_scope = ? AND to_entity_id = ?`,
    )
    .run(
      params.winner.entityId,
      params.nowMs,
      params.loser.profileId,
      params.loser.workspaceScope,
      params.loser.entityId,
    );

  const relationRows = params.db
    .prepare(
      `SELECT relation_id, from_entity_id, relation_type, COALESCE(to_entity_id, '') AS to_entity_id,
              COALESCE(target_locator, '') AS target_locator, ordinal, metadata
       FROM relations
       WHERE profile_id = ? AND workspace_scope = ?
       ORDER BY updated_at DESC, relation_id ASC`,
    )
    .all(params.winner.profileId, params.winner.workspaceScope) as Array<{
    relation_id: string;
    from_entity_id: string;
    relation_type: string;
    to_entity_id: string;
    target_locator: string;
    ordinal: number;
    metadata: string;
  }>;
  const deletedRelationIds: string[] = [];
  const seenRelations = new Set<string>();
  for (const relation of relationRows) {
    const dedupeKey = [
      relation.from_entity_id,
      relation.relation_type,
      relation.to_entity_id,
      relation.target_locator,
      relation.ordinal,
      relation.metadata,
    ].join("\u0000");
    if (seenRelations.has(dedupeKey)) {
      params.db.prepare(`DELETE FROM relations WHERE relation_id = ?`).run(relation.relation_id);
      deletedRelationIds.push(relation.relation_id);
      continue;
    }
    seenRelations.add(dedupeKey);
  }

  const winnerMetadata = {
    ...params.loser.metadata,
    ...params.winner.metadata,
    sleepMergedAtMs: params.nowMs,
    sleepMergedFromIds: uniqueStrings([
      ...(Array.isArray(params.winner.metadata.sleepMergedFromIds)
        ? params.winner.metadata.sleepMergedFromIds.map((value) =>
            typeof value === "string" ? value : undefined,
          )
        : []),
      params.loser.entityId,
      ...(Array.isArray(params.loser.metadata.sleepMergedFromIds)
        ? params.loser.metadata.sleepMergedFromIds.map((value) =>
            typeof value === "string" ? value : undefined,
          )
        : []),
    ]),
  };
  params.db
    .prepare(`UPDATE entities SET updated_at = ?, metadata = ? WHERE entity_id = ?`)
    .run(params.nowMs, stableStringify(winnerMetadata), params.winner.entityId);
  params.db.prepare(`DELETE FROM entities WHERE entity_id = ?`).run(params.loser.entityId);

  return {
    deletedProjectionIds,
    deletedRelationIds,
  };
}

export function deleteProjection(db: DatabaseSync, projectionId: string): void {
  db.prepare(`DELETE FROM projections WHERE projection_id = ?`).run(projectionId);
}

export function findPotentialEntityDuplicates(params: {
  db: DatabaseSync;
  entity: CanonicalEntitySnapshot;
}): Array<{ candidate: CanonicalEntitySnapshot; similarity: number; reason: string }> {
  const primaryProjection = readPrimaryProjection(
    params.db,
    params.entity.profileId,
    params.entity.workspaceScope,
    params.entity.entityId,
  );
  const baseText = [params.entity.title, primaryProjection?.markdownBody ?? ""].join("\n");
  const normalizedTitle = normalizeTextKey(params.entity.title);
  const rows = params.db
    .prepare(
      `SELECT entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind, content_hash, updated_at, metadata
       FROM entities
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id > ?
         AND kind = ?
         AND (
           lower(trim(title)) = lower(trim(?))
           OR slug = ?
           OR content_hash = ?
         )
       ORDER BY entity_id ASC`,
    )
    .all(
      params.entity.profileId,
      params.entity.workspaceScope,
      params.entity.entityId,
      params.entity.kind,
      params.entity.title,
      params.entity.slug,
      params.entity.contentHash,
    ) as EntityRow[];

  return rows
    .map((row) => toEntitySnapshot(row))
    .map((candidate) => {
      const candidateProjection = readPrimaryProjection(
        params.db,
        candidate.profileId,
        candidate.workspaceScope,
        candidate.entityId,
      );
      const candidateText = [candidate.title, candidateProjection?.markdownBody ?? ""].join("\n");
      const sameTitle = normalizeTextKey(candidate.title) === normalizedTitle;
      const similarity = sameTitle ? 1 : textSimilarity(baseText, candidateText);
      const reason = sameTitle
        ? "same-title"
        : candidate.contentHash === params.entity.contentHash
          ? "same-content-hash"
          : candidate.slug === params.entity.slug
            ? "same-slug"
            : "text-similarity";
      return { candidate, similarity, reason };
    })
    .filter((entry) => entry.similarity >= 0.88);
}

export function findPotentialProjectionDuplicates(params: {
  db: DatabaseSync;
  projection: CanonicalProjectionSnapshot;
}): Array<{ candidate: CanonicalProjectionSnapshot; similarity: number; reason: string }> {
  const basename = path.posix.basename(params.projection.relativePath).toLowerCase();
  const rows = params.db
    .prepare(
      `SELECT
         projection_id,
         profile_id,
         workspace_scope,
         entity_id,
         projection_kind,
         relative_path,
         absolute_path,
         editable,
         source_kind,
         content_hash,
         frontmatter_json,
         markdown_body,
         updated_at,
         metadata
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND projection_id > ?
         AND entity_id = ?
         AND (
           content_hash = ?
           OR lower(relative_path) = lower(?)
         )
       ORDER BY projection_id ASC`,
    )
    .all(
      params.projection.profileId,
      params.projection.workspaceScope,
      params.projection.projectionId,
      params.projection.entityId,
      params.projection.contentHash,
      params.projection.relativePath,
    ) as ProjectionRow[];

  return rows
    .map(toProjectionSnapshot)
    .map((candidate) => {
      const samePath =
        candidate.relativePath.toLowerCase() === params.projection.relativePath.toLowerCase();
      const sameBase = path.posix.basename(candidate.relativePath).toLowerCase() === basename;
      const similarity =
        samePath || candidate.contentHash === params.projection.contentHash
          ? 1
          : textSimilarity(params.projection.markdownBody, candidate.markdownBody);
      const reason = samePath
        ? "same-path"
        : sameBase
          ? "same-basename"
          : candidate.contentHash === params.projection.contentHash
            ? "same-content-hash"
            : "text-similarity";
      return { candidate, similarity, reason };
    })
    .filter((entry) => entry.similarity >= 0.92);
}

export function chooseProjectionWinner(
  left: CanonicalProjectionSnapshot,
  right: CanonicalProjectionSnapshot,
) {
  const score = (projection: CanonicalProjectionSnapshot) =>
    projection.markdownBody.length +
    stableStringify(projection.frontmatter).length * 2 +
    stableStringify(projection.metadata).length;
  if (score(left) === score(right)) {
    return left.projectionId.localeCompare(right.projectionId) <= 0
      ? { winner: left, loser: right }
      : { winner: right, loser: left };
  }
  return score(left) > score(right)
    ? { winner: left, loser: right }
    : { winner: right, loser: left };
}

export function extractAttachmentPaths(params: {
  projection: CanonicalProjectionSnapshot;
  workspaceDir: string;
}): string[] {
  const attachmentValues: unknown[] = [];
  for (const source of [params.projection.metadata, params.projection.frontmatter]) {
    const attachments = source.attachments;
    if (Array.isArray(attachments)) {
      attachmentValues.push(...attachments);
    }
  }

  const projectionDir = path.dirname(params.projection.absolutePath);
  const paths = attachmentValues.flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      return [record.absolutePath, record.path, record.filePath, record.relativePath].flatMap(
        (value) => (typeof value === "string" ? [value] : []),
      );
    }
    return [];
  });

  return uniqueStrings(paths).map((filePath) => {
    if (path.isAbsolute(filePath)) {
      return path.resolve(filePath);
    }
    if (filePath.startsWith("./") || filePath.startsWith("../")) {
      return path.resolve(projectionDir, filePath);
    }
    return path.resolve(params.workspaceDir, filePath);
  });
}

export function attachmentExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function resolveClaimPolarity(
  entity: CanonicalEntitySnapshot,
  projection?: CanonicalProjectionSnapshot,
): "positive" | "negative" | undefined {
  for (const source of [entity.metadata, projection?.frontmatter, projection?.metadata]) {
    if (!source) {
      continue;
    }
    for (const key of ["polarity", "truthValue", "value", "stance", "state"]) {
      const raw = source[key];
      const boolValue = normalizeBoolean(raw);
      if (boolValue === true) {
        return "positive";
      }
      if (boolValue === false) {
        return "negative";
      }
      if (typeof raw === "string") {
        const normalized = raw.trim().toLowerCase();
        if (
          ["positive", "confirmed", "supports", "support", "for", "present"].includes(normalized)
        ) {
          return "positive";
        }
        if (["negative", "contradicts", "against", "absent", "denied"].includes(normalized)) {
          return "negative";
        }
      }
    }
  }
  return undefined;
}

export function readContradictingClaims(params: {
  db: DatabaseSync;
  entity: CanonicalEntitySnapshot;
  polarity: "positive" | "negative";
}): CanonicalEntitySnapshot[] {
  const opposing = params.polarity === "positive" ? "negative" : "positive";
  const rows = params.db
    .prepare(
      `SELECT entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind, content_hash, updated_at, metadata
       FROM entities
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id > ? AND kind = 'claim'
         AND lower(trim(title)) = lower(trim(?))
       ORDER BY entity_id ASC`,
    )
    .all(
      params.entity.profileId,
      params.entity.workspaceScope,
      params.entity.entityId,
      params.entity.title,
    ) as EntityRow[];
  return rows.map(toEntitySnapshot).filter((entity) => {
    const projection = readPrimaryProjection(
      params.db,
      entity.profileId,
      entity.workspaceScope,
      entity.entityId,
    );
    return resolveClaimPolarity(entity, projection) === opposing;
  });
}

export function isLowConfidence(entity: CanonicalEntitySnapshot): number | undefined {
  const confidence =
    normalizeNumber(entity.metadata.confidence) ??
    normalizeNumber(entity.metadata.score) ??
    normalizeNumber(entity.metadata.claimConfidence);
  if (confidence == null) {
    return undefined;
  }
  return Math.max(0, Math.min(1, confidence));
}

export function isLikelyCandidate(entity: CanonicalEntitySnapshot): boolean {
  return entity.kind === "candidate" || entity.metadata.sleepCandidate === true;
}
