import type { DatabaseSync } from "node:sqlite";
import { hashText, requireNodeSqlite } from "alisio/plugin-sdk/memory-core-host-engine-storage";
import type {
  CanonicalMemoryGraphMatch,
  CanonicalMemoryGraphProjection,
  CanonicalMemoryGraphRelation,
  CanonicalMemoryGraphResult,
  CanonicalMemoryStoreStatus,
} from "./canonical-store.js";

const MARKDOWN_PROJECTION_PREFIX = "md-path:";
const GLOBAL_GRAPH_DEFAULT_RELATION_LIMIT = 24;
const GLOBAL_GRAPH_DEFAULT_NODE_LIMIT = 120;
const GLOBAL_GRAPH_DEFAULT_EDGE_LIMIT = 240;

type GraphDirection = "incoming" | "outgoing";
type GraphScope = "global" | "local";
type GraphEdge = CanonicalMemoryGraphResult["edges"][number];
type GraphBranch = CanonicalMemoryGraphResult["branches"][number];
type GraphNode = CanonicalMemoryGraphResult["nodes"][number];

type GraphPageRow = {
  page_id: string;
  title: string;
  slug: string;
  updated_at_ms: number | bigint;
  projection_kind: string | null;
  markdown_body: string | null;
};

type GraphCatalogEntry = {
  pageId: string;
  title: string;
  slug: string;
  updatedAtMs: number;
  aliases: string[];
  tags: string[];
  projections: CanonicalMemoryGraphProjection[];
  sourcePath: string;
  body: string;
};

type GraphAttachmentEntry = {
  nodeId: string;
  attachmentId: string;
  fileName: string;
  mediaType: string;
  sha256: string;
  createdAtMs: number;
  sourcePath: string;
};

type RankedGraphEntry = GraphCatalogEntry & {
  score: number;
};

function normalizeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseMarkdownProjectionPath(kind: string): string | null {
  if (!kind.startsWith(MARKDOWN_PROJECTION_PREFIX)) {
    return null;
  }
  const relativePath = kind.slice(MARKDOWN_PROJECTION_PREFIX.length).trim();
  return relativePath ? relativePath.replace(/\\/g, "/").replace(/^\.?\//, "") : null;
}

function openCanonicalDb(status: CanonicalMemoryStoreStatus): DatabaseSync {
  const { DatabaseSync } = requireNodeSqlite();
  return new DatabaseSync(status.path, { readOnly: true });
}

function defaultProjectionPath(slug: string): string {
  return slug === "memory-root" ? "MEMORY.md" : `memory/${slug}.md`;
}

function buildAttachmentNodeId(attachmentId: string) {
  return `attachment:${attachmentId}`;
}

function attachmentSourcePath(fileName: string) {
  return `attachments/${fileName}`;
}

function slugifyAttachmentName(fileName: string) {
  const normalized = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "attachment";
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

function listProjections(
  db: DatabaseSync,
  pageId: string,
  slug: string,
): CanonicalMemoryGraphProjection[] {
  const rows = db
    .prepare(
      `SELECT kind
       FROM projections
       WHERE page_id = ?
       ORDER BY kind ASC`,
    )
    .all(pageId) as Array<{ kind: string }>;
  const projections = rows.flatMap((row) => {
    const projectionPath = parseMarkdownProjectionPath(row.kind);
    if (!projectionPath) {
      return [];
    }
    return [
      {
        projectionId: hashText(`${pageId}:${row.kind}`),
        path: projectionPath,
        sourceKind: "workspace-memory",
        editable: true,
      } satisfies CanonicalMemoryGraphProjection,
    ];
  });
  if (projections.length > 0) {
    return projections;
  }
  return [
    {
      projectionId: hashText(`${pageId}:projection`),
      path: defaultProjectionPath(slug),
      sourceKind: "workspace-memory",
      editable: true,
    },
  ];
}

function scoreGraphMatch(params: {
  query: string;
  title: string;
  aliases: string[];
  tags: string[];
  sourcePath: string;
  body: string;
  pageId: string;
  entityId?: string;
}): number {
  const query = params.query.trim().toLowerCase();
  if (!query) {
    return params.pageId === params.entityId ? 1 : 0;
  }
  if (params.pageId === params.entityId) {
    return 1;
  }
  const title = params.title.toLowerCase();
  const sourcePath = params.sourcePath.toLowerCase();
  const body = params.body.toLowerCase();
  const aliases = params.aliases.map((alias) => alias.toLowerCase());
  const tags = params.tags.map((tag) => tag.toLowerCase());

  if (title === query) {
    return 1;
  }
  if (aliases.includes(query)) {
    return 0.96;
  }
  if (title.startsWith(query)) {
    return 0.92;
  }
  if (title.includes(query)) {
    return 0.86;
  }
  if (aliases.some((alias) => alias.includes(query))) {
    return 0.8;
  }
  if (sourcePath.includes(query)) {
    return 0.74;
  }
  if (tags.includes(query)) {
    return 0.68;
  }
  if (body.includes(query)) {
    return 0.58;
  }
  return 0;
}

function listRelations(params: {
  db: DatabaseSync;
  pageId: string;
  direction: GraphDirection;
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
               l.type AS type,
               l.ordinal AS ordinal,
               p.page_id AS related_page_id,
               p.title AS related_title,
               p.slug AS related_slug,
               (
                 SELECT pr.kind
                 FROM projections pr
                 WHERE pr.page_id = p.page_id
                 ORDER BY pr.updated_at_ms DESC, pr.kind ASC
                 LIMIT 1
               ) AS related_projection_kind
             FROM links l
             INNER JOIN pages p
               ON p.page_id = l.to_page_id
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
               l.type AS type,
               l.ordinal AS ordinal,
               p.page_id AS related_page_id,
               p.title AS related_title,
               p.slug AS related_slug,
               (
                 SELECT pr.kind
                 FROM projections pr
                 WHERE pr.page_id = p.page_id
                 ORDER BY pr.updated_at_ms DESC, pr.kind ASC
                 LIMIT 1
               ) AS related_projection_kind
             FROM links l
             INNER JOIN pages p
               ON p.page_id = l.from_page_id
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
        defaultProjectionPath(row.related_slug),
      sourceKind: "workspace-memory",
    },
  }));
}

function resolveRelationLimits(params: {
  direction?: GraphDirection | "both";
  relationLimit?: number;
}) {
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

function resolveDepth(scope: GraphScope, depth?: number) {
  if (typeof depth === "number" && Number.isFinite(depth)) {
    return Math.max(1, Math.floor(depth));
  }
  return scope === "local" ? 2 : 1;
}

function buildStableEdgeId(params: {
  sourcePageId: string;
  targetPageId: string;
  relationType: string;
  ordinal: number;
}) {
  return [
    params.sourcePageId,
    params.relationType,
    String(params.ordinal),
    params.targetPageId,
  ].join(":");
}

function sortRankedEntries(left: RankedGraphEntry, right: RankedGraphEntry) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  const updatedDelta = right.updatedAtMs - left.updatedAtMs;
  if (updatedDelta !== 0) {
    return updatedDelta;
  }
  return left.title.localeCompare(right.title);
}

function sortCatalogEntries(left: GraphCatalogEntry, right: GraphCatalogEntry) {
  const updatedDelta = right.updatedAtMs - left.updatedAtMs;
  if (updatedDelta !== 0) {
    return updatedDelta;
  }
  return left.title.localeCompare(right.title);
}

function buildEmptyGraph(params: {
  status: CanonicalMemoryStoreStatus;
  query: string;
  scope: GraphScope;
}): CanonicalMemoryGraphResult {
  return {
    query: params.query,
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
    scope: params.scope,
    mode: params.scope === "global" ? "overview" : "focus",
    nodes: [],
    edges: [],
    branches: [],
    availableRelationTypes: [],
    availableTags: [],
    stats: {
      totalNodes: 0,
      totalEdges: 0,
      visibleNodes: 0,
      visibleEdges: 0,
    },
    truncated: {
      nodes: false,
      edges: false,
    },
    matches: [],
  };
}

function buildCatalog(db: DatabaseSync): GraphCatalogEntry[] {
  const pageRows = db
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
         ) AS markdown_body
       FROM pages p
       WHERE p.tombstoned = 0
       ORDER BY p.updated_at_ms DESC, p.title ASC`,
    )
    .all() as GraphPageRow[];

  return pageRows.map((row) => {
    const projections = listProjections(db, row.page_id, row.slug);
    return {
      pageId: row.page_id,
      title: row.title,
      slug: row.slug,
      updatedAtMs: normalizeNumber(row.updated_at_ms),
      aliases: listAliases(db, row.page_id),
      tags: listTags(db, row.page_id),
      projections,
      sourcePath: projections[0]?.path ?? defaultProjectionPath(row.slug),
      body: normalizeString(row.markdown_body),
    } satisfies GraphCatalogEntry;
  });
}

function buildAttachmentCatalog(db: DatabaseSync): GraphAttachmentEntry[] {
  const rows = db
    .prepare(
      `SELECT blob_id, mime, sha256, created_at_ms
       FROM attachments
       ORDER BY created_at_ms DESC, blob_id ASC`,
    )
    .all() as Array<{
    blob_id: string;
    mime: string;
    sha256: string;
    created_at_ms: number | bigint;
  }>;
  return rows.map((row) => {
    const fileName = normalizeString(row.blob_id) || "attachment";
    return {
      nodeId: buildAttachmentNodeId(fileName),
      attachmentId: fileName,
      fileName,
      mediaType: normalizeString(row.mime) || "application/octet-stream",
      sha256: normalizeString(row.sha256),
      createdAtMs: normalizeNumber(row.created_at_ms),
      sourcePath: attachmentSourcePath(fileName),
    } satisfies GraphAttachmentEntry;
  });
}

function noteReferencesAttachment(noteBody: string, attachment: GraphAttachmentEntry) {
  const loweredBody = noteBody.toLowerCase();
  const candidates = [attachment.attachmentId, attachment.fileName, attachment.sha256]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return candidates.some((candidate) => loweredBody.includes(candidate));
}

function buildMatches(params: {
  db: DatabaseSync;
  catalog: GraphCatalogEntry[];
  query: string;
  pageId?: string;
  entityId?: string;
  matchLimit: number;
  relationLimits: { incoming: number; outgoing: number };
}): CanonicalMemoryGraphMatch[] {
  const requestedFocusId = normalizeString(params.pageId) || normalizeString(params.entityId);
  const ranked = params.catalog
    .map((entry) => ({
      ...entry,
      score: scoreGraphMatch({
        query: params.query,
        title: entry.title,
        aliases: entry.aliases,
        tags: entry.tags,
        sourcePath: entry.sourcePath,
        body: entry.body,
        pageId: entry.pageId,
        entityId: requestedFocusId,
      }),
    }))
    .filter((entry) => {
      if (requestedFocusId) {
        return entry.pageId === requestedFocusId;
      }
      return params.query ? entry.score > 0 : false;
    })
    .toSorted(sortRankedEntries)
    .slice(0, params.matchLimit);

  return ranked.map((entry) => {
    const outgoing = listRelations({
      db: params.db,
      pageId: entry.pageId,
      direction: "outgoing",
      limit: params.relationLimits.outgoing,
    });
    const incoming = listRelations({
      db: params.db,
      pageId: entry.pageId,
      direction: "incoming",
      limit: params.relationLimits.incoming,
    });
    return {
      entityId: entry.pageId,
      title: entry.title,
      slug: entry.slug,
      sourcePath: entry.sourcePath,
      sourceKind: "workspace-memory",
      aliases: entry.aliases,
      tags: entry.tags,
      score: entry.score || 1,
      projections: entry.projections,
      relations: [...outgoing, ...incoming],
    } satisfies CanonicalMemoryGraphMatch;
  });
}

function buildBranches(params: {
  focusPageId: string | null;
  edges: GraphEdge[];
  nodeTitleById: Map<string, string>;
}): GraphBranch[] {
  if (!params.focusPageId) {
    return [];
  }

  const branchMap = new Map<string, GraphBranch>();
  for (const edge of params.edges) {
    if (edge.fromId === params.focusPageId) {
      const id = `outgoing:${edge.relationType}`;
      const branch = branchMap.get(id) ?? {
        id,
        direction: "outgoing",
        relationType: edge.relationType,
        nodeIds: [],
      };
      if (!branch.nodeIds.includes(edge.toId)) {
        branch.nodeIds.push(edge.toId);
      }
      branchMap.set(id, branch);
    }
    if (edge.toId === params.focusPageId) {
      const id = `incoming:${edge.relationType}`;
      const branch = branchMap.get(id) ?? {
        id,
        direction: "incoming",
        relationType: edge.relationType,
        nodeIds: [],
      };
      if (!branch.nodeIds.includes(edge.fromId)) {
        branch.nodeIds.push(edge.fromId);
      }
      branchMap.set(id, branch);
    }
  }

  return Array.from(branchMap.values())
    .map((branch) => ({
      ...branch,
      nodeIds: [...branch.nodeIds].toSorted((left, right) => {
        const leftTitle = params.nodeTitleById.get(left) ?? left;
        const rightTitle = params.nodeTitleById.get(right) ?? right;
        return leftTitle.localeCompare(rightTitle);
      }),
    }))
    .toSorted((left, right) => {
      if (left.direction !== right.direction) {
        return left.direction.localeCompare(right.direction);
      }
      return left.relationType.localeCompare(right.relationType);
    });
}

function withNodeMetrics<T extends GraphNode>(nodes: T[], edges: GraphEdge[]): T[] {
  return nodes.map((node) => {
    const incoming = edges.filter((edge) => edge.toId === node.id).length;
    const outgoing = edges.filter((edge) => edge.fromId === node.id).length;
    return {
      ...node,
      incoming,
      outgoing,
      degree: incoming + outgoing,
    };
  });
}

function augmentGraphWithAttachments(params: {
  graph: CanonicalMemoryGraphResult;
  catalogById: Map<string, GraphCatalogEntry>;
  attachmentCatalog: GraphAttachmentEntry[];
  nodeLimit: number;
  edgeLimit: number;
}): CanonicalMemoryGraphResult {
  if (params.attachmentCatalog.length === 0 || params.graph.nodes.length === 0) {
    return params.graph;
  }

  const noteNodes = params.graph.nodes.filter((node) => node.kind === "note");
  const candidateAttachmentNodes = new Map<string, GraphNode>();
  const candidateAttachmentEdges: GraphEdge[] = [];

  for (const noteNode of noteNodes) {
    const note = params.catalogById.get(noteNode.pageId);
    if (!note || !note.body.trim()) {
      continue;
    }
    let ordinal = 0;
    for (const attachment of params.attachmentCatalog) {
      if (!noteReferencesAttachment(note.body, attachment)) {
        continue;
      }

      if (!candidateAttachmentNodes.has(attachment.nodeId)) {
        candidateAttachmentNodes.set(attachment.nodeId, {
          id: attachment.nodeId,
          pageId: attachment.nodeId,
          entityId: attachment.nodeId,
          kind: "attachment",
          title: attachment.fileName,
          slug: slugifyAttachmentName(attachment.fileName),
          sourcePath: attachment.sourcePath,
          sourceKind: "workspace-memory",
          aliases: [attachment.attachmentId],
          tags: [attachment.mediaType],
          attachmentId: attachment.attachmentId,
          fileName: attachment.fileName,
          mediaType: attachment.mediaType,
          incoming: 0,
          outgoing: 0,
          degree: 0,
        });
      }

      candidateAttachmentEdges.push({
        id: buildStableEdgeId({
          sourcePageId: noteNode.id,
          targetPageId: attachment.nodeId,
          relationType: "references-attachment",
          ordinal,
        }),
        fromId: noteNode.id,
        toId: attachment.nodeId,
        fromPageId: noteNode.pageId,
        toPageId: attachment.nodeId,
        relationType: "references-attachment",
        ordinal,
        reason: {
          kind: "attachment-reference",
          sourcePageId: noteNode.pageId,
          targetPageId: attachment.nodeId,
          sourceTitle: noteNode.title,
          targetTitle: attachment.fileName,
          sourcePath: noteNode.sourcePath,
          targetPath: attachment.sourcePath,
          relationType: "references-attachment",
          ordinal,
          attachmentId: attachment.attachmentId,
          fileName: attachment.fileName,
          mediaType: attachment.mediaType,
        },
      });
      ordinal += 1;
    }
  }

  if (candidateAttachmentEdges.length === 0) {
    return params.graph;
  }

  const mergedNodes = [...params.graph.nodes];
  const mergedEdges = [...params.graph.edges];
  const visibleNodeIds = new Set(mergedNodes.map((node) => node.id));
  let attachmentNodesTruncated = false;
  let attachmentEdgesTruncated = false;

  for (const edge of candidateAttachmentEdges) {
    if (mergedEdges.length >= params.edgeLimit) {
      attachmentEdgesTruncated = true;
      continue;
    }
    if (!visibleNodeIds.has(edge.toId)) {
      if (mergedNodes.length >= params.nodeLimit) {
        attachmentNodesTruncated = true;
        attachmentEdgesTruncated = true;
        continue;
      }
      const attachmentNode = candidateAttachmentNodes.get(edge.toId);
      if (!attachmentNode) {
        continue;
      }
      mergedNodes.push(attachmentNode);
      visibleNodeIds.add(edge.toId);
    }
    mergedEdges.push(edge);
  }

  const nodesWithMetrics = withNodeMetrics(mergedNodes, mergedEdges);
  const nodeTitleById = new Map(nodesWithMetrics.map((node) => [node.id, node.title]));

  return {
    ...params.graph,
    nodes: nodesWithMetrics,
    edges: mergedEdges,
    branches: buildBranches({
      focusPageId: params.graph.focus?.nodeId ?? null,
      edges: mergedEdges,
      nodeTitleById,
    }),
    availableRelationTypes: [...new Set(mergedEdges.map((edge) => edge.relationType))].toSorted(
      (left, right) => left.localeCompare(right),
    ),
    availableTags: [...new Set(nodesWithMetrics.flatMap((node) => node.tags))].toSorted(
      (left, right) => left.localeCompare(right),
    ),
    stats: {
      totalNodes: params.graph.stats.totalNodes + candidateAttachmentNodes.size,
      totalEdges: params.graph.stats.totalEdges + candidateAttachmentEdges.length,
      visibleNodes: nodesWithMetrics.length,
      visibleEdges: mergedEdges.length,
    },
    truncated: {
      nodes: params.graph.truncated.nodes || attachmentNodesTruncated,
      edges: params.graph.truncated.edges || attachmentEdgesTruncated,
    },
  };
}

function buildSeedIds(params: {
  scope: GraphScope;
  catalog: GraphCatalogEntry[];
  matches: CanonicalMemoryGraphMatch[];
  requestedFocusId: string;
  focusId: string | null;
  nodeLimit: number;
}): string[] {
  if (params.scope === "local") {
    return uniqueStrings([params.focusId]);
  }

  return uniqueStrings(params.catalog.map((entry) => entry.pageId));
}

function finalizeGraph(params: {
  status: CanonicalMemoryStoreStatus;
  query: string;
  scope: GraphScope;
  focusId: string | null;
  seedIds: string[];
  catalogById: Map<string, GraphCatalogEntry>;
  encounteredNodeIds: string[];
  edgeMap: Map<string, GraphEdge>;
  nodeLimit: number;
  edgeLimit: number;
  matches: CanonicalMemoryGraphMatch[];
}): CanonicalMemoryGraphResult {
  const prioritizedNodeIds = uniqueStrings([
    params.focusId,
    ...params.seedIds,
    ...params.encounteredNodeIds,
  ]);
  const visibleNodeIds = new Set(prioritizedNodeIds.slice(0, params.nodeLimit));
  const visibleEdges = Array.from(params.edgeMap.values())
    .filter((edge) => visibleNodeIds.has(edge.fromId) && visibleNodeIds.has(edge.toId))
    .toSorted((left, right) => {
      if (left.fromId !== right.fromId) {
        return left.fromId.localeCompare(right.fromId);
      }
      if (left.relationType !== right.relationType) {
        return left.relationType.localeCompare(right.relationType);
      }
      if (left.ordinal !== right.ordinal) {
        return left.ordinal - right.ordinal;
      }
      return left.toId.localeCompare(right.toId);
    })
    .slice(0, params.edgeLimit);

  const visibleNodes = prioritizedNodeIds
    .filter((pageId) => visibleNodeIds.has(pageId))
    .map((pageId) => params.catalogById.get(pageId))
    .filter((entry): entry is GraphCatalogEntry => Boolean(entry))
    .map((entry) => {
      return {
        id: entry.pageId,
        pageId: entry.pageId,
        entityId: entry.pageId,
        kind: "note",
        title: entry.title,
        slug: entry.slug,
        sourcePath: entry.sourcePath,
        sourceKind: "workspace-memory",
        aliases: entry.aliases,
        tags: entry.tags,
        incoming: 0,
        outgoing: 0,
        degree: 0,
      } satisfies GraphNode;
    });

  const nodesWithMetrics = withNodeMetrics(visibleNodes, visibleEdges);
  const visibleNodeIdSet = new Set(visibleNodes.map((node) => node.id));
  const filteredEdges = visibleEdges.filter(
    (edge) => visibleNodeIdSet.has(edge.fromId) && visibleNodeIdSet.has(edge.toId),
  );
  const focusEntry = params.focusId ? params.catalogById.get(params.focusId) : null;
  const nodeTitleById = new Map(nodesWithMetrics.map((node) => [node.id, node.title]));

  return {
    query: params.query,
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
    scope: params.scope,
    mode: params.scope === "global" ? "overview" : "focus",
    ...(focusEntry
      ? {
          focus: {
            nodeId: focusEntry.pageId,
            pageId: focusEntry.pageId,
            entityId: focusEntry.pageId,
            title: focusEntry.title,
            sourcePath: focusEntry.sourcePath,
          },
        }
      : {}),
    nodes: nodesWithMetrics,
    edges: filteredEdges,
    branches: buildBranches({
      focusPageId: focusEntry?.pageId ?? null,
      edges: filteredEdges,
      nodeTitleById,
    }),
    availableRelationTypes: [...new Set(filteredEdges.map((edge) => edge.relationType))].toSorted(
      (left, right) => left.localeCompare(right),
    ),
    availableTags: [...new Set(visibleNodes.flatMap((node) => node.tags))].toSorted((left, right) =>
      left.localeCompare(right),
    ),
    stats: {
      totalNodes: params.encounteredNodeIds.length,
      totalEdges: params.edgeMap.size,
      visibleNodes: visibleNodes.length,
      visibleEdges: filteredEdges.length,
    },
    truncated: {
      nodes: params.encounteredNodeIds.length > visibleNodes.length,
      edges: params.edgeMap.size > filteredEdges.length,
    },
    matches: params.matches,
  };
}

export function queryCanonicalMemoryGraphFromStore(params: {
  status: CanonicalMemoryStoreStatus;
  query?: string;
  pageId?: string;
  entityId?: string;
  scope?: GraphScope;
  direction?: GraphDirection | "both";
  depth?: number;
  matchLimit?: number;
  relationLimit?: number;
  nodeLimit?: number;
  edgeLimit?: number;
  includeAttachments?: boolean;
}): CanonicalMemoryGraphResult {
  const query = normalizeString(params.query);
  const requestedFocusId = normalizeString(params.pageId) || normalizeString(params.entityId);
  const scope = params.scope ?? (requestedFocusId || query ? "local" : "global");
  const db = openCanonicalDb(params.status);

  try {
    const catalog = buildCatalog(db);
    if (catalog.length === 0) {
      return buildEmptyGraph({ status: params.status, query, scope });
    }

    const relationLimit =
      typeof params.relationLimit === "number" && Number.isFinite(params.relationLimit)
        ? Math.max(1, Math.floor(params.relationLimit))
        : scope === "global"
          ? GLOBAL_GRAPH_DEFAULT_RELATION_LIMIT
          : undefined;
    const relationLimits = resolveRelationLimits({
      direction: params.direction,
      relationLimit,
    });
    const matchLimit =
      typeof params.matchLimit === "number" && Number.isFinite(params.matchLimit)
        ? Math.max(1, Math.floor(params.matchLimit))
        : 5;
    const nodeLimit =
      typeof params.nodeLimit === "number" && Number.isFinite(params.nodeLimit)
        ? Math.max(1, Math.floor(params.nodeLimit))
        : scope === "global"
          ? GLOBAL_GRAPH_DEFAULT_NODE_LIMIT
          : 24;
    const edgeLimit =
      typeof params.edgeLimit === "number" && Number.isFinite(params.edgeLimit)
        ? Math.max(1, Math.floor(params.edgeLimit))
        : scope === "global"
          ? GLOBAL_GRAPH_DEFAULT_EDGE_LIMIT
          : 48;
    const maxDepth = resolveDepth(scope, params.depth);
    const catalogById = new Map(catalog.map((entry) => [entry.pageId, entry]));
    const matches = buildMatches({
      db,
      catalog,
      query,
      pageId: params.pageId,
      entityId: params.entityId,
      matchLimit,
      relationLimits,
    });

    const focusId =
      (requestedFocusId && catalogById.has(requestedFocusId) ? requestedFocusId : null) ??
      (query ? (matches[0]?.entityId ?? null) : null);

    if (scope === "local" && !focusId) {
      return buildEmptyGraph({ status: params.status, query, scope });
    }

    const seedIds = buildSeedIds({
      scope,
      catalog: catalog.toSorted(sortCatalogEntries),
      matches,
      requestedFocusId,
      focusId,
      nodeLimit,
    });
    if (seedIds.length === 0) {
      return buildEmptyGraph({ status: params.status, query, scope });
    }

    const encounteredNodeIds: string[] = [];
    const encounteredNodeSet = new Set<string>();
    const edgeMap = new Map<string, GraphEdge>();
    const queue: Array<{ pageId: string; depth: number }> = [];
    const scheduledDepth = new Map<string, number>();

    const rememberNode = (pageId: string) => {
      if (!catalogById.has(pageId) || encounteredNodeSet.has(pageId)) {
        return;
      }
      encounteredNodeSet.add(pageId);
      encounteredNodeIds.push(pageId);
    };

    const schedulePage = (pageId: string, depth: number) => {
      if (!catalogById.has(pageId) || depth < 0) {
        return;
      }
      rememberNode(pageId);
      const currentDepth = scheduledDepth.get(pageId);
      if (currentDepth != null && currentDepth >= depth) {
        return;
      }
      scheduledDepth.set(pageId, depth);
      queue.push({ pageId, depth });
    };

    for (const seedId of seedIds) {
      schedulePage(seedId, maxDepth);
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      const page = catalogById.get(current.pageId);
      if (!page) {
        continue;
      }

      const outgoing = listRelations({
        db,
        pageId: page.pageId,
        direction: "outgoing",
        limit: relationLimits.outgoing,
      });
      const incoming = listRelations({
        db,
        pageId: page.pageId,
        direction: "incoming",
        limit: relationLimits.incoming,
      });

      for (const relation of [...outgoing, ...incoming]) {
        const related = relation.relatedEntity;
        if (!related) {
          continue;
        }

        const sourcePageId = relation.direction === "outgoing" ? page.pageId : related.entityId;
        const targetPageId = relation.direction === "outgoing" ? related.entityId : page.pageId;
        rememberNode(sourcePageId);
        rememberNode(targetPageId);

        const source = catalogById.get(sourcePageId);
        const target = catalogById.get(targetPageId);
        const edgeId = buildStableEdgeId({
          sourcePageId,
          targetPageId,
          relationType: relation.relationType,
          ordinal: relation.ordinal,
        });
        if (!edgeMap.has(edgeId)) {
          edgeMap.set(edgeId, {
            id: edgeId,
            fromId: sourcePageId,
            toId: targetPageId,
            fromPageId: sourcePageId,
            toPageId: targetPageId,
            relationType: relation.relationType,
            ordinal: relation.ordinal,
            reason: {
              kind: "canonical-link",
              sourcePageId,
              targetPageId,
              sourceTitle:
                source?.title ?? (relation.direction === "outgoing" ? page.title : related.title),
              targetTitle:
                target?.title ?? (relation.direction === "outgoing" ? related.title : page.title),
              sourcePath:
                source?.sourcePath ??
                (relation.direction === "outgoing" ? page.sourcePath : related.sourcePath),
              targetPath:
                target?.sourcePath ??
                (relation.direction === "outgoing" ? related.sourcePath : page.sourcePath),
              relationType: relation.relationType,
              ordinal: relation.ordinal,
            },
          });
        }

        if (current.depth > 1) {
          schedulePage(related.entityId, current.depth - 1);
        }
      }
    }

    const graph = finalizeGraph({
      status: params.status,
      query,
      scope,
      focusId,
      seedIds,
      catalogById,
      encounteredNodeIds,
      edgeMap,
      nodeLimit,
      edgeLimit,
      matches,
    });
    if (params.includeAttachments !== true) {
      return graph;
    }
    return augmentGraphWithAttachments({
      graph,
      catalogById,
      attachmentCatalog: buildAttachmentCatalog(db),
      nodeLimit,
      edgeLimit,
    });
  } finally {
    db.close();
  }
}
