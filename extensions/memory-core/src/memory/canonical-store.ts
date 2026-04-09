import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  createSubsystemLogger,
  getAlisioActiveCloudAccessSession,
  loadOrCreateDeviceIdentity,
  resolveAlisioCanonicalMemoryStorePath,
  resolveAlisioMemoryOwnerProfile,
  resolveStateDir,
  type AlisioCloudAccessSession,
  type AlisioMemoryOwnerProfile,
  type OpenClawConfig,
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
import { resolveObsidianMemoryLayout } from "alisio/plugin-sdk/memory-core-host-runtime-files";

const log = createSubsystemLogger("memory/canonical");

type CanonicalStoreBackend = "builtin" | "qmd";
type CanonicalProjectionSource = "workspace-memory" | "obsidian-memory";
type CanonicalRelationType = string;
type CanonicalRelationDirection = "incoming" | "outgoing";
type CanonicalStoreStatusState = "pending-sync" | "ready";
type CanonicalStoreSyncMode = "local-first";
type CanonicalCloudSyncState = "unavailable" | "enabled" | "error";
type CanonicalRecordOrigin = "markdown-import" | "structured-store";

const CANONICAL_STORE_SYNC_MODE: CanonicalStoreSyncMode = "local-first";
const CANONICAL_STORE_CLOUD_SYNC: CanonicalCloudSyncState = "unavailable";
const MARKDOWN_IMPORT_ORIGIN: CanonicalRecordOrigin = "markdown-import";
const STRUCTURED_STORE_ORIGIN: CanonicalRecordOrigin = "structured-store";
const CANONICAL_CLOUD_SNAPSHOT_SCHEMA_VERSION = 1;
const CANONICAL_FRONTMATTER_KEYS = new Set([
  "alisio-memory",
  "alisio-profile-id",
  "alisio-entity-id",
  "alisio-projection-id",
  "alisio-source-of-truth",
  "alisio-kind",
]);
const CANONICAL_RELATIONS_START = "<!-- alisio-relations:start -->";
const CANONICAL_RELATIONS_END = "<!-- alisio-relations:end -->";

type ParsedFrontmatter = {
  raw?: string;
  body: string;
  aliases: string[];
  tags: string[];
  title?: string;
  kind?: string;
  sourceOfTruth?: string;
  entityId?: string;
  projectionId?: string;
};

type ParsedMemoryReference = {
  relationType: CanonicalRelationType;
  ordinal: number;
  targetKey: string;
  targetLocator: string;
  metadata: Record<string, unknown>;
};

type ParsedCanonicalProjection = {
  entityId: string;
  projectionId: string;
  title: string;
  slug: string;
  displayPath: string;
  absolutePath: string;
  workspaceReferencePath: string;
  source: CanonicalProjectionSource;
  contentHash: string;
  frontmatterRaw?: string;
  frontmatterJson: string;
  markdownBody: string;
  aliasKeys: string[];
  references: ParsedMemoryReference[];
  metadataJson: string;
};

type StructuredRoundTripProjectionEdit = {
  entityId?: string;
  projectionId?: string;
  title: string;
  kind?: string;
  frontmatterPresent: boolean;
  displayPath: string;
  absolutePath: string;
  source: CanonicalProjectionSource;
  frontmatterJson: string;
  markdownBody: string;
  relations: CanonicalMemoryStructuredRelationInput[];
  aliases: string[];
  tags: string[];
};

type CollectedOwnedMemoryProjections = {
  markdownImports: ParsedCanonicalProjection[];
  structuredEdits: StructuredRoundTripProjectionEdit[];
};

type CanonicalCloudEntitySnapshotRow = {
  entityId: string;
  kind: string;
  slug: string;
  title: string;
  sourcePath: string;
  sourceKind: CanonicalProjectionSource;
  contentHash: string;
  updatedAt: number;
  metadataJson: string;
  origin: CanonicalRecordOrigin;
};

type CanonicalCloudAliasSnapshotRow = {
  aliasKey: string;
  entityId: string;
  updatedAt: number;
  origin: CanonicalRecordOrigin;
};

type CanonicalCloudRelationSnapshotRow = {
  relationId: string;
  fromEntityId: string;
  relationType: string;
  toEntityId: string | null;
  targetLocator: string | null;
  ordinal: number;
  updatedAt: number;
  metadataJson: string;
  origin: CanonicalRecordOrigin;
};

type CanonicalCloudProjectionSnapshotRow = {
  projectionId: string;
  entityId: string;
  projectionKind: string;
  relativePath: string;
  editable: boolean;
  sourceKind: CanonicalProjectionSource;
  contentHash: string;
  frontmatterJson: string;
  markdownBody: string;
  updatedAt: number;
  metadataJson: string;
  origin: CanonicalRecordOrigin;
};

type CanonicalCloudScopeSnapshot = {
  schemaVersion: typeof CANONICAL_CLOUD_SNAPSHOT_SCHEMA_VERSION;
  profileId: string;
  workspaceScope: string;
  backend: CanonicalStoreBackend;
  projectionInterface: "markdown-vault";
  syncMode: CanonicalStoreSyncMode;
  exportedAt: string;
  exportedBy: {
    deviceId: string;
    stateDir: string;
  };
  entities: CanonicalCloudEntitySnapshotRow[];
  aliases: CanonicalCloudAliasSnapshotRow[];
  relations: CanonicalCloudRelationSnapshotRow[];
  projections: CanonicalCloudProjectionSnapshotRow[];
};

type StructuredRelationTarget = {
  targetEntityId?: string;
  targetAliasKey?: string;
  targetLocator?: string;
};

type StructuredNormalizedRelation = StructuredRelationTarget & {
  relationType: CanonicalRelationType;
  ordinal: number;
  metadataJson: string;
};

type StructuredNormalizedProjection = {
  projectionId: string;
  relativePath: string;
  absolutePath: string;
  sourceKind: CanonicalProjectionSource;
  editable: boolean;
  frontmatterJson: string;
  markdownBody: string;
  contentHash: string;
  metadataJson: string;
};

type StructuredNormalizedEntity = {
  entityId: string;
  kind: string;
  slug: string;
  title: string;
  primarySourcePath: string;
  primarySourceKind: CanonicalProjectionSource;
  aliasKeys: string[];
  metadataJson: string;
  projections: StructuredNormalizedProjection[];
  relations: StructuredNormalizedRelation[];
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
  targetLocator?: string;
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
  lastSyncedAt?: string;
  lastError?: string;
  matches: CanonicalMemoryGraphMatch[];
};

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

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
    kind: extractYamlScalar(raw, "alisio-kind"),
    sourceOfTruth: extractYamlScalar(raw, "alisio-source-of-truth"),
    entityId: extractYamlScalar(raw, "alisio-entity-id"),
    projectionId: extractYamlScalar(raw, "alisio-projection-id"),
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

function parseYamlInlineValue(value: string): unknown {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) {
    return "";
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
  }
  return trimmed;
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
        .map((entry) => parseYamlInlineValue(entry))
        .filter((entry) => entry !== "");
      continue;
    }
    if (inlineValue) {
      out[key] = parseYamlInlineValue(inlineValue);
      continue;
    }
    const listValues: unknown[] = [];
    let consumedList = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j] ?? "";
      if (/^\s*-\s+/.test(candidate)) {
        listValues.push(parseYamlInlineValue(candidate.replace(/^\s*-\s+/, "")));
        consumedList = true;
        i = j;
        continue;
      }
      if (!candidate.trim()) {
        i = j;
        continue;
      }
      break;
    }
    if (consumedList) {
      out[key] = listValues;
    }
  }
  for (const key of CANONICAL_FRONTMATTER_KEYS) {
    delete out[key];
  }
  return out;
}

function extractTitle(params: {
  parsedFrontmatter: ParsedFrontmatter;
  markdownBody: string;
  absolutePath: string;
}): string {
  const explicitTitle = params.parsedFrontmatter.title?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  const heading = params.markdownBody.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
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
    const [targetPart, labelPart] = raw.split("|", 2);
    const { target, anchor } = stripAnchor(targetPart ?? "");
    const key = normalizeReferenceKey(target);
    if (!key) {
      continue;
    }
    refs.push({
      relationType: "references",
      ordinal,
      targetKey: key,
      targetLocator: key,
      metadata: {
        syntax: "wiki",
        ...(labelPart?.trim() ? { label: labelPart.trim() } : {}),
        ...(anchor ? { anchor } : {}),
      },
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
    const { target, anchor } = stripAnchor(rawTarget);
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
      targetLocator: resolved,
      metadata: {
        syntax: "markdown",
        ...(anchor ? { anchor } : {}),
      },
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

function createCloudWorkspaceScope(agentId: string): string {
  return hashText(
    JSON.stringify({
      scope: "canonical-cloud-v1",
      agentId: agentId.trim() || "main",
    }),
  ).slice(0, 16);
}

function stringifyCanonicalJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? ({ ...value } as Record<string, unknown>)
    : {};
}

function toWikiTarget(displayPath: string): string {
  return displayPath.replace(/^obsidian\//, "").replace(/\.md$/i, "");
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
    return;
  }
  lines.push(`${key}: ${serializeYamlScalar(JSON.stringify(value))}`);
}

function buildProjectionFrontmatterObject(params: {
  profileId: string;
  entity: StructuredNormalizedEntity;
  projection: StructuredNormalizedProjection;
}): Record<string, unknown> {
  const projectionFrontmatter = parseJsonRecord(params.projection.frontmatterJson);
  const entityMetadata = parseJsonRecord(params.entity.metadataJson);
  const aliases = Array.isArray(entityMetadata.aliases)
    ? entityMetadata.aliases.filter((entry): entry is string => typeof entry === "string")
    : params.entity.aliasKeys;
  const tags = Array.isArray(entityMetadata.tags)
    ? entityMetadata.tags.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    "alisio-memory": "canonical-projection",
    "alisio-profile-id": params.profileId,
    "alisio-entity-id": params.entity.entityId,
    "alisio-projection-id": params.projection.projectionId,
    "alisio-source-of-truth": "canonical-store",
    "alisio-kind": params.entity.kind,
    title: params.entity.title,
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...projectionFrontmatter,
  };
}

function stripManagedRelationsSection(markdownBody: string): {
  markdownBody: string;
  relationSection: string;
} {
  const explicitStart = markdownBody.indexOf(CANONICAL_RELATIONS_START);
  const explicitEnd = markdownBody.indexOf(CANONICAL_RELATIONS_END);
  if (explicitStart >= 0 && explicitEnd > explicitStart) {
    const before = markdownBody.slice(0, explicitStart).trimEnd();
    const relationSection = markdownBody
      .slice(explicitStart + CANONICAL_RELATIONS_START.length, explicitEnd)
      .trim();
    return {
      markdownBody: before ? `${before}\n` : "",
      relationSection,
    };
  }

  const fallbackStart = markdownBody.lastIndexOf("\n## Relations\n");
  if (fallbackStart < 0) {
    return {
      markdownBody,
      relationSection: "",
    };
  }
  const before = markdownBody.slice(0, fallbackStart).trimEnd();
  const relationSection = markdownBody.slice(fallbackStart).trim();
  if (!relationSection.match(/^##\s+Relations\b/m)) {
    return {
      markdownBody,
      relationSection: "",
    };
  }
  return {
    markdownBody: before ? `${before}\n` : "",
    relationSection,
  };
}

function parseRoundTripRelationTarget(
  rawTarget: string,
  currentReferencePath: string,
): Pick<CanonicalMemoryStructuredRelationInput, "targetAlias" | "targetLocator"> {
  const trimmed = rawTarget.trim();
  const wikiMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
  if (wikiMatch?.[1]) {
    return { targetAlias: normalizeReferenceKey(wikiMatch[1]) };
  }
  const codeMatch = trimmed.match(/^`([^`]+)`$/);
  if (codeMatch?.[1]) {
    return { targetLocator: normalizeReferenceKey(codeMatch[1]) || codeMatch[1].trim() };
  }
  const markdownMatch = trimmed.match(/^\[[^\]]*]\(([^)]+)\)$/);
  if (markdownMatch?.[1]) {
    const { target } = stripAnchor(markdownMatch[1].replace(/^<|>$/g, ""));
    if (target && path.extname(target).toLowerCase() === ".md") {
      return {
        targetAlias: normalizeReferenceKey(
          path.posix.normalize(path.posix.join(path.posix.dirname(currentReferencePath), target)),
        ),
      };
    }
  }
  return { targetLocator: normalizeReferenceKey(trimmed) || trimmed };
}

function parseStructuredRoundTripRelations(params: {
  relationSection: string;
  markdownBody: string;
  currentReferencePath: string;
}): CanonicalMemoryStructuredRelationInput[] {
  const explicitLines = params.relationSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("## "));
  const explicitRelations = explicitLines.flatMap((line, index) => {
    const match = line.match(/^-\s*([^:]+):\s+(.+)$/);
    if (!match?.[1] || !match[2]) {
      return [];
    }
    const relationType = match[1].trim() || "references";
    return [
      {
        relationType,
        ordinal: index,
        ...parseRoundTripRelationTarget(match[2], params.currentReferencePath),
      } satisfies CanonicalMemoryStructuredRelationInput,
    ];
  });
  const referenceRelations = [
    ...parseWikiReferences(params.markdownBody),
    ...parseMarkdownReferences(params.markdownBody, params.currentReferencePath),
  ].map(
    (reference, index) =>
      ({
        relationType: reference.relationType,
        ordinal: explicitRelations.length + index,
        targetAlias: reference.targetKey,
        metadata: reference.metadata,
      }) satisfies CanonicalMemoryStructuredRelationInput,
  );
  return [...explicitRelations, ...referenceRelations];
}

function renderStructuredRelationLines(params: {
  relations: StructuredNormalizedRelation[];
  projectionPathByEntityId: ReadonlyMap<string, string>;
}): string[] {
  const lines: string[] = [];
  for (const relation of params.relations) {
    const knownPath = relation.targetEntityId
      ? params.projectionPathByEntityId.get(relation.targetEntityId)
      : undefined;
    const targetToken = knownPath
      ? `[[${toWikiTarget(knownPath)}]]`
      : relation.targetLocator
        ? relation.targetLocator.endsWith(".md") || relation.targetLocator.includes("/")
          ? `[[${toWikiTarget(relation.targetLocator)}]]`
          : `\`${relation.targetLocator}\``
        : relation.targetAliasKey
          ? relation.targetAliasKey.endsWith(".md") || relation.targetAliasKey.includes("/")
            ? `[[${toWikiTarget(relation.targetAliasKey)}]]`
            : `\`${relation.targetAliasKey}\``
          : relation.targetEntityId
            ? `\`${relation.targetEntityId}\``
            : null;
    if (!targetToken) {
      continue;
    }
    lines.push(`- ${relation.relationType}: ${targetToken}`);
  }
  return lines;
}

export function buildCanonicalMarkdownProjection(params: {
  profileId: string;
  entity: StructuredNormalizedEntity;
  projection: StructuredNormalizedProjection;
  projectionPathByEntityId?: ReadonlyMap<string, string>;
}): string {
  const frontmatterObject = buildProjectionFrontmatterObject({
    profileId: params.profileId,
    entity: params.entity,
    projection: params.projection,
  });
  const frontmatterLines = ["---"];
  for (const [key, value] of Object.entries(frontmatterObject)) {
    appendYamlField(frontmatterLines, key, value);
  }
  frontmatterLines.push("---", "");
  const body = params.projection.markdownBody.trim();
  const bodyLines = body ? [body] : [`# ${params.entity.title}`];
  const relationLines = renderStructuredRelationLines({
    relations: params.entity.relations,
    projectionPathByEntityId: params.projectionPathByEntityId ?? new Map<string, string>(),
  });
  if (relationLines.length > 0) {
    bodyLines.push(
      "",
      CANONICAL_RELATIONS_START,
      "## Relations",
      "",
      ...relationLines,
      CANONICAL_RELATIONS_END,
    );
  }
  return [...frontmatterLines, ...bodyLines].join("\n").trimEnd().concat("\n");
}

function resolveCanonicalProjectionAbsolutePath(params: {
  cfg: OpenClawConfig;
  workspaceDir: string;
  relativePath: string;
  sourceKind: CanonicalProjectionSource;
}): string {
  const normalizedPath = normalizeDisplayPath(params.relativePath);
  if (params.sourceKind === "obsidian-memory") {
    const obsidianLayout = resolveObsidianMemoryLayout({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
    });
    if (!obsidianLayout) {
      throw new Error("obsidian memory projection requires memory.vaultPath or memory.memoryPath");
    }
    if (!normalizedPath.startsWith("obsidian/")) {
      throw new Error('obsidian memory projection path must start with "obsidian/"');
    }
    const vaultRelative = normalizedPath.slice("obsidian/".length);
    if (!vaultRelative) {
      throw new Error("obsidian memory projection path must not be empty");
    }
    return path.resolve(obsidianLayout.vaultRoot, vaultRelative);
  }
  if (normalizedPath.startsWith("obsidian/")) {
    throw new Error('workspace memory projection path must not start with "obsidian/"');
  }
  return path.resolve(params.workspaceDir, normalizedPath);
}

function normalizeStructuredProjectionInput(params: {
  cfg: OpenClawConfig;
  workspaceDir: string;
  entityTitle: string;
  entitySlug: string;
  projection: CanonicalMemoryStructuredProjectionInput;
}): StructuredNormalizedProjection {
  const relativePath = normalizeDisplayPath(params.projection.relativePath);
  if (!relativePath.toLowerCase().endsWith(".md")) {
    throw new Error("canonical projection path must end with .md");
  }
  const sourceKind =
    params.projection.sourceKind ??
    (relativePath.startsWith("obsidian/") ? "obsidian-memory" : "workspace-memory");
  const absolutePath = resolveCanonicalProjectionAbsolutePath({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    relativePath,
    sourceKind,
  });
  const editable = params.projection.editable ?? true;
  const projectionMetadata = {
    ...asJsonRecord(params.projection.metadata),
    relativePath,
    absolutePath,
    sourceKind,
    projectionOrigin: STRUCTURED_STORE_ORIGIN,
  };
  const frontmatter = {
    ...asJsonRecord(params.projection.frontmatter),
    title: params.entityTitle,
  };
  const markdownBody = params.projection.markdownBody?.trim()
    ? params.projection.markdownBody.trim()
    : `# ${params.entityTitle}\n`;
  return {
    projectionId:
      params.projection.projectionId ??
      hashText(`projection:structured:${params.entitySlug}:${relativePath}`),
    relativePath,
    absolutePath,
    sourceKind,
    editable,
    frontmatterJson: stringifyCanonicalJson(frontmatter),
    markdownBody,
    contentHash: hashText(markdownBody),
    metadataJson: stringifyCanonicalJson(projectionMetadata),
  };
}

function normalizeStructuredEntityInput(params: {
  cfg: OpenClawConfig;
  workspaceDir: string;
  entity: CanonicalMemoryStructuredEntityInput;
}): StructuredNormalizedEntity {
  const title = params.entity.title.trim();
  if (!title) {
    throw new Error("canonical structured entity title must not be empty");
  }
  if (!params.entity.projections.length) {
    throw new Error("canonical structured entity requires at least one projection");
  }
  const slug =
    normalizeReferenceKey(params.entity.slug ?? "") ||
    normalizeReferenceKey(params.entity.projections[0]?.relativePath ?? "") ||
    normalizeReferenceKey(title);
  if (!slug) {
    throw new Error("canonical structured entity slug could not be resolved");
  }
  const projections = params.entity.projections.map((projection) =>
    normalizeStructuredProjectionInput({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      entityTitle: title,
      entitySlug: slug,
      projection,
    }),
  );
  const primaryProjection = projections[0]!;
  const aliasKeys = uniqueStrings([
    slug,
    normalizeReferenceKey(title),
    normalizeReferenceKey(primaryProjection.relativePath),
    normalizeReferenceKey(path.basename(primaryProjection.relativePath, ".md")),
    ...(params.entity.aliases ?? []).map((alias) => normalizeReferenceKey(alias)),
  ]);
  const tags = uniqueStrings(params.entity.tags ?? []);
  const metadata = {
    ...asJsonRecord(params.entity.metadata),
    title,
    aliases: params.entity.aliases ?? [],
    tags,
    structuredStore: true,
    projectionCount: projections.length,
  };
  const relations = (params.entity.relations ?? []).map((relation, index) => ({
    relationType: relation.relationType.trim() || "references",
    ordinal:
      typeof relation.ordinal === "number" && Number.isFinite(relation.ordinal)
        ? Math.max(0, Math.floor(relation.ordinal))
        : index,
    ...(relation.targetEntityId?.trim() ? { targetEntityId: relation.targetEntityId.trim() } : {}),
    ...(normalizeReferenceKey(relation.targetAlias ?? "")
      ? { targetAliasKey: normalizeReferenceKey(relation.targetAlias ?? "") }
      : {}),
    ...(normalizeReferenceKey(relation.targetLocator ?? "")
      ? { targetLocator: normalizeReferenceKey(relation.targetLocator ?? "") }
      : {}),
    metadataJson: stringifyCanonicalJson(relation.metadata),
  }));
  return {
    entityId: params.entity.entityId ?? hashText(`entity:structured:${slug}`),
    kind: params.entity.kind?.trim() || "note",
    slug,
    title,
    primarySourcePath: primaryProjection.relativePath,
    primarySourceKind: primaryProjection.sourceKind,
    aliasKeys,
    metadataJson: stringifyCanonicalJson(metadata),
    projections,
    relations,
  };
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
  };
}

function normalizeCanonicalCloudSyncState(value: unknown): CanonicalCloudSyncState {
  switch (value) {
    case "enabled":
    case "error":
    case "unavailable":
      return value;
    case "not_implemented":
    default:
      return "unavailable";
  }
}

type CanonicalMemoryCloudConfig = {
  url: string;
  anonKey: string;
  snapshotsTable: string;
  backupsTable: string;
};

type CanonicalMemoryCloudSnapshotRecord = {
  ownerUserId: string;
  profileId: string;
  workspaceScope: string;
  contentHash: string;
  updatedAt: string;
  snapshot: CanonicalCloudScopeSnapshot;
};

function resolveSupabaseClientKey(env: NodeJS.ProcessEnv) {
  return env.ALISIO_SUPABASE_ANON_KEY?.trim() || env.ALISIO_SUPABASE_PUBLISHABLE_KEY?.trim() || "";
}

function resolveCanonicalMemoryCloudConfig(
  env: NodeJS.ProcessEnv,
): CanonicalMemoryCloudConfig | null {
  const url = env.ALISIO_SUPABASE_URL?.trim() || "";
  const anonKey = resolveSupabaseClientKey(env);
  if (!url || !anonKey) {
    return null;
  }
  return {
    url: url.replace(/\/+$/, ""),
    anonKey,
    snapshotsTable: env.ALISIO_SUPABASE_MEMORY_SNAPSHOTS_TABLE?.trim() || "alisio_memory_snapshots",
    backupsTable:
      env.ALISIO_SUPABASE_MEMORY_BACKUPS_TABLE?.trim() || "alisio_memory_snapshot_backups",
  };
}

function supabaseCloudHeaders(
  config: CanonicalMemoryCloudConfig,
  session: AlisioCloudAccessSession,
) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

async function fetchCloudJson(
  input: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function readCloudErrorMessage(body: unknown) {
  if (!body || typeof body !== "object") {
    return "";
  }
  const record = body as Record<string, unknown>;
  for (const key of ["message", "hint", "details", "error_description", "msg"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function createCloudRestUrl(
  config: CanonicalMemoryCloudConfig,
  table: string,
  params?: Record<string, string>,
) {
  const url = new URL(`/rest/v1/${table}`, config.url);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

function parseCloudScopeSnapshot(value: unknown): CanonicalCloudScopeSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<CanonicalCloudScopeSnapshot>;
  if (
    record.schemaVersion !== CANONICAL_CLOUD_SNAPSHOT_SCHEMA_VERSION ||
    !record.profileId ||
    !record.workspaceScope ||
    !record.backend ||
    !record.projectionInterface ||
    !record.syncMode ||
    !record.exportedAt ||
    !record.exportedBy?.deviceId ||
    !record.exportedBy?.stateDir ||
    !Array.isArray(record.entities) ||
    !Array.isArray(record.aliases) ||
    !Array.isArray(record.relations) ||
    !Array.isArray(record.projections)
  ) {
    return null;
  }
  return record as CanonicalCloudScopeSnapshot;
}

function parseCloudSnapshotRecord(value: unknown): CanonicalMemoryCloudSnapshotRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const ownerUserId = typeof record.owner_user_id === "string" ? record.owner_user_id.trim() : "";
  const profileId = typeof record.profile_id === "string" ? record.profile_id.trim() : "";
  const workspaceScope =
    typeof record.workspace_scope === "string" ? record.workspace_scope.trim() : "";
  const contentHash = typeof record.content_hash === "string" ? record.content_hash.trim() : "";
  const updatedAt = typeof record.updated_at === "string" ? record.updated_at.trim() : "";
  const snapshot = parseCloudScopeSnapshot(record.snapshot);
  if (!ownerUserId || !profileId || !workspaceScope || !contentHash || !updatedAt || !snapshot) {
    return null;
  }
  return {
    ownerUserId,
    profileId,
    workspaceScope,
    contentHash,
    updatedAt,
    snapshot,
  };
}

async function collectOwnedMemoryProjections(params: {
  cfg: OpenClawConfig;
  workspaceDir: string;
  structuredProjectionPaths?: ReadonlySet<string>;
}): Promise<CollectedOwnedMemoryProjections> {
  const obsidianLayout = resolveObsidianMemoryLayout({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
  });
  const discoveredFiles = await listMemoryFiles(
    params.workspaceDir,
    undefined,
    undefined,
    obsidianLayout,
  );
  const entries = (
    await runWithConcurrency(
      discoveredFiles.map(
        (file) => async () =>
          await buildFileEntry(file, params.workspaceDir, undefined, obsidianLayout, null),
      ),
      8,
    )
  ).filter((entry): entry is MemoryFileEntry => entry !== null);

  const parsed = await Promise.all(
    entries.map(async (entry) => {
      const markdown = await fs.readFile(entry.absPath, "utf8");
      const parsedFrontmatter = extractFrontmatter(markdown);
      const title = extractTitle({
        parsedFrontmatter,
        markdownBody: parsedFrontmatter.body,
        absolutePath: entry.absPath,
      });
      const workspaceRelativePath = normalizePosixPath(
        path.relative(params.workspaceDir, entry.absPath),
      );
      const vaultRelativePath =
        obsidianLayout && isWithinRoot(obsidianLayout.vaultRoot, entry.absPath)
          ? normalizePosixPath(path.relative(obsidianLayout.vaultRoot, entry.absPath))
          : workspaceRelativePath;
      const memoryRelativePath =
        obsidianLayout && isWithinRoot(obsidianLayout.memoryDir, entry.absPath)
          ? normalizePosixPath(path.relative(obsidianLayout.memoryDir, entry.absPath))
          : undefined;
      const projectionSource: CanonicalProjectionSource =
        obsidianLayout && isWithinRoot(obsidianLayout.memoryDir, entry.absPath)
          ? "obsidian-memory"
          : "workspace-memory";
      const aliasKeys = uniqueStrings([
        normalizeReferenceKey(entry.path),
        normalizeReferenceKey(workspaceRelativePath),
        normalizeReferenceKey(vaultRelativePath),
        normalizeReferenceKey(memoryRelativePath ?? ""),
        normalizeReferenceKey(path.basename(entry.absPath, path.extname(entry.absPath))),
        normalizeReferenceKey(title),
        ...parsedFrontmatter.aliases.map((alias) => normalizeReferenceKey(alias)),
        ...(workspaceRelativePath.startsWith("memory/")
          ? [normalizeReferenceKey(workspaceRelativePath.slice("memory/".length))]
          : []),
      ]);
      const slug =
        aliasKeys.find((key) => key === normalizeReferenceKey(vaultRelativePath)) ??
        aliasKeys.find((key) => key === normalizeReferenceKey(workspaceRelativePath)) ??
        normalizeReferenceKey(entry.path);
      const references = [
        ...parseWikiReferences(parsedFrontmatter.body),
        ...parseMarkdownReferences(parsedFrontmatter.body, vaultRelativePath),
      ];
      const entityId = hashText(`entity:${entry.absPath}`);
      const projectionId = hashText(`projection:${entry.absPath}`);
      const claimedByStructuredStore = params.structuredProjectionPaths?.has(entry.path) ?? false;
      if (parsedFrontmatter.sourceOfTruth === "canonical-store" || claimedByStructuredStore) {
        const editableFrontmatter = parseEditableFrontmatterObject(parsedFrontmatter.raw);
        const { markdownBody, relationSection } = stripManagedRelationsSection(
          parsedFrontmatter.body,
        );
        return {
          kind: "structured-edit" as const,
          edit: {
            ...(parsedFrontmatter.entityId?.trim()
              ? { entityId: parsedFrontmatter.entityId.trim() }
              : {}),
            ...(parsedFrontmatter.projectionId?.trim()
              ? { projectionId: parsedFrontmatter.projectionId.trim() }
              : {}),
            title,
            ...(parsedFrontmatter.kind?.trim() ? { kind: parsedFrontmatter.kind.trim() } : {}),
            frontmatterPresent: Boolean(parsedFrontmatter.raw?.trim()),
            displayPath: entry.path,
            absolutePath: entry.absPath,
            source: projectionSource,
            frontmatterJson: stringifyCanonicalJson(editableFrontmatter),
            markdownBody: markdownBody.trim() ? markdownBody.trimEnd().concat("\n") : "",
            relations: parseStructuredRoundTripRelations({
              relationSection,
              markdownBody,
              currentReferencePath: vaultRelativePath,
            }),
            aliases: parsedFrontmatter.aliases,
            tags: parsedFrontmatter.tags,
          } satisfies StructuredRoundTripProjectionEdit,
        };
      }
      return {
        kind: "markdown-import" as const,
        projection: {
          entityId,
          projectionId,
          title,
          slug,
          displayPath: entry.path,
          absolutePath: entry.absPath,
          workspaceReferencePath: vaultRelativePath,
          source: projectionSource,
          contentHash: entry.hash,
          ...(parsedFrontmatter.raw ? { frontmatterRaw: parsedFrontmatter.raw } : {}),
          frontmatterJson: JSON.stringify({
            aliases: parsedFrontmatter.aliases,
            tags: parsedFrontmatter.tags,
            ...(parsedFrontmatter.title ? { title: parsedFrontmatter.title } : {}),
          }),
          markdownBody: parsedFrontmatter.body,
          aliasKeys,
          references,
          metadataJson: JSON.stringify({
            title,
            aliases: parsedFrontmatter.aliases,
            tags: parsedFrontmatter.tags,
            workspaceRelativePath,
            vaultRelativePath,
            ...(memoryRelativePath ? { memoryRelativePath } : {}),
          }),
        } satisfies ParsedCanonicalProjection,
      };
    }),
  );
  const markdownImports = parsed
    .flatMap((entry) => (entry?.kind === "markdown-import" ? [entry.projection] : []))
    .toSorted((left, right) => left.displayPath.localeCompare(right.displayPath));
  const structuredEdits = parsed
    .flatMap((entry) => (entry?.kind === "structured-edit" ? [entry.edit] : []))
    .toSorted((left, right) => left.displayPath.localeCompare(right.displayPath));
  return {
    markdownImports,
    structuredEdits,
  };
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
      metadata TEXT NOT NULL
    );
  `);
  ensureCanonicalStoreColumn(
    db,
    "entities",
    "origin",
    `TEXT NOT NULL DEFAULT '${MARKDOWN_IMPORT_ORIGIN}'`,
  );
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_entities_source
    ON entities(profile_id, workspace_scope, source_path);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_canonical_entities_origin
    ON entities(profile_id, workspace_scope, origin);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_aliases (
      profile_id TEXT NOT NULL,
      workspace_scope TEXT NOT NULL,
      alias_key TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(profile_id, workspace_scope, alias_key, entity_id)
    );
  `);
  ensureCanonicalStoreColumn(
    db,
    "entity_aliases",
    "origin",
    `TEXT NOT NULL DEFAULT '${MARKDOWN_IMPORT_ORIGIN}'`,
  );
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_canonical_entity_aliases_entity
    ON entity_aliases(profile_id, workspace_scope, entity_id);
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
      metadata TEXT NOT NULL
    );
  `);
  ensureCanonicalStoreColumn(
    db,
    "relations",
    "origin",
    `TEXT NOT NULL DEFAULT '${MARKDOWN_IMPORT_ORIGIN}'`,
  );
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_canonical_relations_origin
    ON relations(profile_id, workspace_scope, origin);
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
      metadata TEXT NOT NULL
    );
  `);
  ensureCanonicalStoreColumn(
    db,
    "projections",
    "origin",
    `TEXT NOT NULL DEFAULT '${MARKDOWN_IMPORT_ORIGIN}'`,
  );
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_projections_path
    ON projections(profile_id, workspace_scope, relative_path);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_canonical_projections_origin
    ON projections(profile_id, workspace_scope, origin);
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
}

function ensureCanonicalStoreColumn(
  db: DatabaseSync,
  table: "entities" | "entity_aliases" | "relations" | "projections",
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function openCanonicalStore(dbPath: string): DatabaseSync {
  ensureDir(path.dirname(dbPath));
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  ensureCanonicalStoreSchema(db);
  return db;
}

function readScopeCounts(db: DatabaseSync, params: { profileId: string; workspaceScope: string }) {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM entities WHERE profile_id = ? AND workspace_scope = ?) AS entities,
        (SELECT COUNT(*) FROM relations WHERE profile_id = ? AND workspace_scope = ?) AS relations,
        (SELECT COUNT(*) FROM projections WHERE profile_id = ? AND workspace_scope = ?) AS projections,
        (SELECT last_synced_at FROM sync_state WHERE profile_id = ? AND workspace_scope = ?) AS last_synced_at,
        (SELECT cloud_state FROM sync_state WHERE profile_id = ? AND workspace_scope = ?) AS cloud_state`,
    )
    .get(
      params.profileId,
      params.workspaceScope,
      params.profileId,
      params.workspaceScope,
      params.profileId,
      params.workspaceScope,
      params.profileId,
      params.workspaceScope,
      params.profileId,
      params.workspaceScope,
    ) as
    | {
        entities: number;
        relations: number;
        projections: number;
        last_synced_at?: number;
        cloud_state?: string;
      }
    | undefined;
  return {
    entities: row?.entities ?? 0,
    relations: row?.relations ?? 0,
    projections: row?.projections ?? 0,
    cloudSync: normalizeCanonicalCloudSyncState(row?.cloud_state),
    lastSyncedAt:
      typeof row?.last_synced_at === "number"
        ? new Date(row.last_synced_at).toISOString()
        : undefined,
  };
}

function readScopeProjectionSources(
  db: DatabaseSync,
  params: {
    profileId: string;
    workspaceScope: string;
  },
): CanonicalProjectionSource[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT source_kind
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ?
       ORDER BY source_kind ASC`,
    )
    .all(params.profileId, params.workspaceScope) as Array<{
    source_kind: CanonicalProjectionSource;
  }>;
  return uniqueStrings(rows.map((row) => row.source_kind)) as CanonicalProjectionSource[];
}

function readScopeAliasMap(
  db: DatabaseSync,
  params: {
    profileId: string;
    workspaceScope: string;
  },
): Map<string, Set<string>> {
  const rows = db
    .prepare(
      `SELECT alias_key, entity_id
       FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ?`,
    )
    .all(params.profileId, params.workspaceScope) as Array<{
    alias_key: string;
    entity_id: string;
  }>;
  const aliasMap = new Map<string, Set<string>>();
  for (const row of rows) {
    const entry = aliasMap.get(row.alias_key) ?? new Set<string>();
    entry.add(row.entity_id);
    aliasMap.set(row.alias_key, entry);
  }
  return aliasMap;
}

function readOriginScopedProjectionPaths(
  db: DatabaseSync,
  params: {
    profileId: string;
    workspaceScope: string;
    origin: CanonicalRecordOrigin;
  },
): Set<string> {
  const rows = db
    .prepare(
      `SELECT relative_path
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ?`,
    )
    .all(params.profileId, params.workspaceScope, params.origin) as Array<{
    relative_path: string;
  }>;
  return new Set(rows.map((row) => row.relative_path).filter(Boolean));
}

function readStructuredProjectionEntityIdsByPath(
  db: DatabaseSync,
  params: {
    profileId: string;
    workspaceScope: string;
  },
): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT relative_path, entity_id
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ?`,
    )
    .all(params.profileId, params.workspaceScope, STRUCTURED_STORE_ORIGIN) as Array<{
    relative_path: string;
    entity_id: string;
  }>;
  return new Map(
    rows
      .filter((row) => row.relative_path && row.entity_id)
      .map((row) => [row.relative_path, row.entity_id]),
  );
}

function readStructuredEntityInputs(
  db: DatabaseSync,
  params: {
    profileId: string;
    workspaceScope: string;
    entityIds: readonly string[];
  },
): CanonicalMemoryStructuredEntityInput[] {
  if (params.entityIds.length === 0) {
    return [];
  }
  return params.entityIds.flatMap((entityId) => {
    const entityRow = db
      .prepare(
        `SELECT entity_id, kind, slug, title, metadata
         FROM entities
         WHERE profile_id = ? AND workspace_scope = ? AND origin = ? AND entity_id = ?`,
      )
      .get(params.profileId, params.workspaceScope, STRUCTURED_STORE_ORIGIN, entityId) as
      | {
          entity_id: string;
          kind: string;
          slug: string;
          title: string;
          metadata: string;
        }
      | undefined;
    if (!entityRow) {
      return [];
    }
    const metadata = parseJsonRecord(entityRow.metadata);
    const projectionRows = db
      .prepare(
        `SELECT projection_id, relative_path, source_kind, editable, frontmatter_json, markdown_body, metadata
         FROM projections
         WHERE profile_id = ? AND workspace_scope = ? AND origin = ? AND entity_id = ?
         ORDER BY relative_path ASC`,
      )
      .all(params.profileId, params.workspaceScope, STRUCTURED_STORE_ORIGIN, entityId) as Array<{
      projection_id: string;
      relative_path: string;
      source_kind: CanonicalProjectionSource;
      editable: number;
      frontmatter_json: string;
      markdown_body: string;
      metadata: string;
    }>;
    const relationRows = db
      .prepare(
        `SELECT relation_type, to_entity_id, target_locator, ordinal, metadata
         FROM relations
         WHERE profile_id = ? AND workspace_scope = ? AND origin = ? AND from_entity_id = ?
         ORDER BY ordinal ASC, relation_type ASC`,
      )
      .all(params.profileId, params.workspaceScope, STRUCTURED_STORE_ORIGIN, entityId) as Array<{
      relation_type: string;
      to_entity_id: string | null;
      target_locator: string | null;
      ordinal: number;
      metadata: string;
    }>;
    const aliases =
      Array.isArray(metadata.aliases) &&
      metadata.aliases.every((entry): entry is string => typeof entry === "string")
        ? metadata.aliases
        : listEntityAliases(db, {
            profileId: params.profileId,
            workspaceScope: params.workspaceScope,
            entityId,
          });
    const tags =
      Array.isArray(metadata.tags) &&
      metadata.tags.every((entry): entry is string => typeof entry === "string")
        ? metadata.tags
        : [];
    return [
      {
        entityId: entityRow.entity_id,
        kind: entityRow.kind,
        slug: entityRow.slug,
        title: entityRow.title,
        aliases,
        tags,
        metadata,
        projections: projectionRows.map((row) => ({
          projectionId: row.projection_id,
          relativePath: row.relative_path,
          sourceKind: row.source_kind,
          editable: row.editable === 1,
          frontmatter: parseJsonRecord(row.frontmatter_json),
          markdownBody: row.markdown_body,
          metadata: parseJsonRecord(row.metadata),
        })),
        relations: relationRows.map((row) => ({
          relationType: row.relation_type,
          ...(row.to_entity_id ? { targetEntityId: row.to_entity_id } : {}),
          ...(row.target_locator ? { targetLocator: row.target_locator } : {}),
          ordinal: row.ordinal,
          metadata: parseJsonRecord(row.metadata),
        })),
      } satisfies CanonicalMemoryStructuredEntityInput,
    ];
  });
}

function mergeStructuredRoundTripEdits(params: {
  entities: CanonicalMemoryStructuredEntityInput[];
  edits: StructuredRoundTripProjectionEdit[];
}): CanonicalMemoryStructuredEntityInput[] {
  const editsByEntityId = new Map<string, StructuredRoundTripProjectionEdit[]>();
  for (const edit of params.edits) {
    const entityId = edit.entityId?.trim();
    if (!entityId) {
      continue;
    }
    const entry = editsByEntityId.get(entityId) ?? [];
    entry.push(edit);
    editsByEntityId.set(entityId, entry);
  }

  return params.entities.map((entity) => {
    const edits = editsByEntityId.get(entity.entityId ?? "");
    if (!edits?.length) {
      return entity;
    }
    const projections = entity.projections.map((projection) => ({ ...projection }));
    let nextTitle = entity.title;
    let nextKind = entity.kind;
    let nextAliases = [...(entity.aliases ?? [])];
    let nextTags = [...(entity.tags ?? [])];
    let nextRelations = entity.relations ? [...entity.relations] : [];

    for (const edit of edits) {
      const projectionIndex = projections.findIndex(
        (projection) => projection.relativePath === edit.displayPath,
      );
      if (projectionIndex < 0) {
        continue;
      }
      const currentProjection = projections[projectionIndex]!;
      projections[projectionIndex] = {
        ...currentProjection,
        ...(edit.projectionId ? { projectionId: edit.projectionId } : {}),
        sourceKind: edit.source,
        frontmatter: parseJsonRecord(edit.frontmatterJson),
        markdownBody: edit.markdownBody,
      };
      const isPrimaryProjection =
        projectionIndex === 0 || currentProjection.relativePath === projections[0]?.relativePath;
      if (!isPrimaryProjection) {
        continue;
      }
      nextTitle = edit.title;
      if (edit.frontmatterPresent) {
        nextKind = edit.kind ?? nextKind;
        nextAliases = [...edit.aliases];
        nextTags = [...edit.tags];
      }
      nextRelations = [...edit.relations];
    }

    return {
      ...entity,
      title: nextTitle,
      ...(nextKind ? { kind: nextKind } : {}),
      aliases: nextAliases,
      tags: nextTags,
      projections,
      relations: nextRelations,
    } satisfies CanonicalMemoryStructuredEntityInput;
  });
}

type CanonicalEntityRow = {
  entity_id: string;
  title: string;
  slug: string;
  source_path: string;
  source_kind: CanonicalProjectionSource;
  metadata: string;
};

type CanonicalRelationRow = {
  relation_type: CanonicalRelationType;
  ordinal: number;
  target_locator?: string | null;
  metadata: string;
  related_entity_id?: string | null;
  related_title?: string | null;
  related_slug?: string | null;
  related_source_path?: string | null;
  related_source_kind?: CanonicalProjectionSource | null;
};

function listEntityAliases(
  db: DatabaseSync,
  params: {
    profileId: string;
    workspaceScope: string;
    entityId: string;
  },
): string[] {
  const rows = db
    .prepare(
      `SELECT alias_key
       FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?
       ORDER BY alias_key ASC`,
    )
    .all(params.profileId, params.workspaceScope, params.entityId) as Array<{
    alias_key: string;
  }>;
  return rows.map((row) => row.alias_key).filter(Boolean);
}

function listEntityProjections(
  db: DatabaseSync,
  params: {
    profileId: string;
    workspaceScope: string;
    entityId: string;
  },
): CanonicalMemoryGraphProjection[] {
  const rows = db
    .prepare(
      `SELECT projection_id, relative_path, source_kind, editable
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?
       ORDER BY relative_path ASC`,
    )
    .all(params.profileId, params.workspaceScope, params.entityId) as Array<{
    projection_id: string;
    relative_path: string;
    source_kind: CanonicalProjectionSource;
    editable: number;
  }>;
  return rows.map((row) => ({
    projectionId: row.projection_id,
    path: row.relative_path,
    sourceKind: row.source_kind,
    editable: row.editable === 1,
  }));
}

function listEntityRelations(
  db: DatabaseSync,
  params: {
    profileId: string;
    workspaceScope: string;
    entityId: string;
    direction: CanonicalRelationDirection;
    limit: number;
  },
): CanonicalMemoryGraphRelation[] {
  if (params.limit <= 0) {
    return [];
  }
  const rows =
    params.direction === "outgoing"
      ? (db
          .prepare(
            `SELECT
               r.relation_type,
               r.ordinal,
               r.target_locator,
               r.metadata,
               e.entity_id AS related_entity_id,
               e.title AS related_title,
               e.slug AS related_slug,
               e.source_path AS related_source_path,
               e.source_kind AS related_source_kind
             FROM relations r
             LEFT JOIN entities e
               ON e.profile_id = r.profile_id
              AND e.workspace_scope = r.workspace_scope
              AND e.entity_id = r.to_entity_id
             WHERE r.profile_id = ? AND r.workspace_scope = ? AND r.from_entity_id = ?
             ORDER BY r.ordinal ASC, COALESCE(e.title, r.target_locator, '') ASC
             LIMIT ?`,
          )
          .all(
            params.profileId,
            params.workspaceScope,
            params.entityId,
            params.limit,
          ) as CanonicalRelationRow[])
      : (db
          .prepare(
            `SELECT
               r.relation_type,
               r.ordinal,
               r.target_locator,
               r.metadata,
               e.entity_id AS related_entity_id,
               e.title AS related_title,
               e.slug AS related_slug,
               e.source_path AS related_source_path,
               e.source_kind AS related_source_kind
             FROM relations r
             INNER JOIN entities e
               ON e.profile_id = r.profile_id
              AND e.workspace_scope = r.workspace_scope
              AND e.entity_id = r.from_entity_id
             WHERE r.profile_id = ? AND r.workspace_scope = ? AND r.to_entity_id = ?
             ORDER BY r.ordinal ASC, e.title ASC
             LIMIT ?`,
          )
          .all(
            params.profileId,
            params.workspaceScope,
            params.entityId,
            params.limit,
          ) as CanonicalRelationRow[]);

  return rows.map((row) => ({
    direction: params.direction,
    relationType: row.relation_type,
    ordinal: row.ordinal,
    metadata: parseJsonRecord(row.metadata),
    ...(row.related_entity_id &&
    row.related_title &&
    row.related_slug &&
    row.related_source_path &&
    row.related_source_kind
      ? {
          relatedEntity: {
            entityId: row.related_entity_id,
            title: row.related_title,
            slug: row.related_slug,
            sourcePath: row.related_source_path,
            sourceKind: row.related_source_kind,
          },
        }
      : {}),
    ...(row.target_locator ? { targetLocator: row.target_locator } : {}),
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

function upsertGraphCandidate(
  candidates: Map<string, CanonicalEntityRow & { score: number }>,
  rows: CanonicalEntityRow[],
  score: number,
): void {
  for (const row of rows) {
    const existing = candidates.get(row.entity_id);
    if (!existing || score > existing.score) {
      candidates.set(row.entity_id, { ...row, score });
    }
  }
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
}): void {
  params.db
    .prepare(
      `INSERT INTO sync_state (profile_id, workspace_scope, backend, sync_mode, cloud_state, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, workspace_scope) DO UPDATE SET
         backend = excluded.backend,
         sync_mode = excluded.sync_mode,
         cloud_state = excluded.cloud_state,
         last_synced_at = excluded.last_synced_at`,
    )
    .run(
      params.profileId,
      params.workspaceScope,
      params.backend,
      CANONICAL_STORE_SYNC_MODE,
      params.cloudState ?? CANONICAL_STORE_CLOUD_SYNC,
      params.now,
    );
}

function buildReadyCanonicalStoreStatus(params: {
  baseStatus: CanonicalMemoryStoreStatus;
  db: DatabaseSync;
  profileId: string;
  workspaceScope: string;
  deviceId: string;
  stateDir: string;
}): CanonicalMemoryStoreStatus {
  const counts = readScopeCounts(params.db, {
    profileId: params.profileId,
    workspaceScope: params.workspaceScope,
  });
  return {
    ...params.baseStatus,
    state: "ready",
    entities: counts.entities,
    relations: counts.relations,
    projections: counts.projections,
    cloudSync: counts.cloudSync,
    projectionSources: readScopeProjectionSources(params.db, {
      profileId: params.profileId,
      workspaceScope: params.workspaceScope,
    }),
    ...(counts.lastSyncedAt ? { lastSyncedAt: counts.lastSyncedAt } : {}),
    replica: {
      deviceId: params.deviceId,
      stateDir: params.stateDir,
    },
  };
}

async function loadRemoteCanonicalSnapshot(params: {
  env: NodeJS.ProcessEnv;
  session: AlisioCloudAccessSession;
  status: CanonicalMemoryStoreStatus;
  cloudWorkspaceScope: string;
}): Promise<CanonicalMemoryCloudSnapshotRecord | null> {
  const config = resolveCanonicalMemoryCloudConfig(params.env);
  if (!config) {
    return null;
  }
  const lookupScopes = uniqueStrings([params.cloudWorkspaceScope, params.status.workspaceScope]);
  for (const workspaceScope of lookupScopes) {
    const result = await fetchCloudJson(
      createCloudRestUrl(config, config.snapshotsTable, {
        select: "*",
        owner_user_id: `eq.${params.session.userId}`,
        profile_id: `eq.${params.status.profileId}`,
        workspace_scope: `eq.${workspaceScope}`,
        limit: "1",
      }).toString(),
      {
        method: "GET",
        headers: supabaseCloudHeaders(config, params.session),
      },
    );
    if (!result.ok) {
      throw new Error(
        readCloudErrorMessage(result.body) ||
          `canonical cloud snapshot read failed (${result.status})`,
      );
    }
    const snapshot = (Array.isArray(result.body) ? result.body : [])
      .map((row) => parseCloudSnapshotRecord(row))
      .find((row): row is CanonicalMemoryCloudSnapshotRecord => Boolean(row && row.snapshot));
    if (snapshot) {
      return snapshot;
    }
  }
  return null;
}

async function upsertRemoteCanonicalSnapshot(params: {
  env: NodeJS.ProcessEnv;
  session: AlisioCloudAccessSession;
  status: CanonicalMemoryStoreStatus;
  cloudWorkspaceScope: string;
  snapshot: CanonicalCloudScopeSnapshot;
  contentHash: string;
}): Promise<string> {
  const config = resolveCanonicalMemoryCloudConfig(params.env);
  if (!config) {
    return params.snapshot.exportedAt;
  }
  const result = await fetchCloudJson(
    createCloudRestUrl(config, config.snapshotsTable, {
      on_conflict: "owner_user_id,profile_id,workspace_scope",
      select: "*",
    }).toString(),
    {
      method: "POST",
      headers: {
        ...supabaseCloudHeaders(config, params.session),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          owner_user_id: params.session.userId,
          profile_id: params.status.profileId,
          workspace_scope: params.cloudWorkspaceScope,
          backend: params.status.backend,
          projection_interface: params.status.projectionInterface,
          sync_mode: params.status.syncMode,
          last_writer_device_id: params.snapshot.exportedBy.deviceId,
          last_writer_state_dir: params.snapshot.exportedBy.stateDir,
          content_hash: params.contentHash,
          snapshot: params.snapshot,
          updated_at: params.snapshot.exportedAt,
        },
      ]),
    },
  );
  if (!result.ok) {
    throw new Error(
      readCloudErrorMessage(result.body) ||
        `canonical cloud snapshot write failed (${result.status})`,
    );
  }
  const persisted = (Array.isArray(result.body) ? result.body : [])
    .map((row) => parseCloudSnapshotRecord(row))
    .find((row): row is CanonicalMemoryCloudSnapshotRecord => Boolean(row));
  return persisted?.updatedAt ?? params.snapshot.exportedAt;
}

async function appendRemoteCanonicalBackup(params: {
  env: NodeJS.ProcessEnv;
  session: AlisioCloudAccessSession;
  status: CanonicalMemoryStoreStatus;
  cloudWorkspaceScope: string;
  snapshot: CanonicalCloudScopeSnapshot;
  contentHash: string;
}) {
  const config = resolveCanonicalMemoryCloudConfig(params.env);
  if (!config) {
    return;
  }
  const result = await fetchCloudJson(createCloudRestUrl(config, config.backupsTable).toString(), {
    method: "POST",
    headers: {
      ...supabaseCloudHeaders(config, params.session),
      Prefer: "return=minimal",
    },
    body: JSON.stringify([
      {
        owner_user_id: params.session.userId,
        profile_id: params.status.profileId,
        workspace_scope: params.cloudWorkspaceScope,
        writer_device_id: params.snapshot.exportedBy.deviceId,
        writer_state_dir: params.snapshot.exportedBy.stateDir,
        content_hash: params.contentHash,
        snapshot: params.snapshot,
        created_at: params.snapshot.exportedAt,
      },
    ]),
  });
  if (!result.ok) {
    throw new Error(
      readCloudErrorMessage(result.body) ||
        `canonical cloud backup write failed (${result.status})`,
    );
  }
}

async function finalizeCanonicalCloudSync(params: {
  db: DatabaseSync;
  cfg: OpenClawConfig;
  agentId: string;
  workspaceDir: string;
  env: NodeJS.ProcessEnv;
  status: CanonicalMemoryStoreStatus;
  ownerProfile: AlisioMemoryOwnerProfile;
  deviceId: string;
  stateDir: string;
}): Promise<CanonicalMemoryStoreStatus> {
  const baseReady = () =>
    buildReadyCanonicalStoreStatus({
      baseStatus: params.status,
      db: params.db,
      profileId: params.status.profileId,
      workspaceScope: params.status.workspaceScope,
      deviceId: params.deviceId,
      stateDir: params.stateDir,
    });

  const session = await getAlisioActiveCloudAccessSession(params.env);
  if (!session || params.status.profileSource !== "cloud-user") {
    return baseReady();
  }

  try {
    const cloudWorkspaceScope = createCloudWorkspaceScope(params.agentId);
    const localSnapshot = exportCanonicalCloudScopeSnapshot({
      db: params.db,
      status: params.status,
      workspaceScope: cloudWorkspaceScope,
      exportedAt: params.status.lastSyncedAt ?? new Date().toISOString(),
      deviceId: params.deviceId,
      stateDir: params.stateDir,
    });
    const localHash = hashCanonicalCloudScopeSnapshot(localSnapshot);
    const localSyncedAtMs = Date.parse(localSnapshot.exportedAt) || Date.now();
    const remote = await loadRemoteCanonicalSnapshot({
      env: params.env,
      session,
      status: params.status,
      cloudWorkspaceScope,
    });
    const remoteUpdatedAtMs = remote ? Date.parse(remote.updatedAt) || 0 : 0;
    const canBootstrapFromRemote =
      params.status.cloudSync !== "enabled" &&
      params.status.entities === 0 &&
      params.status.relations === 0 &&
      params.status.projections === 0;

    if (
      remote &&
      remote.contentHash !== localHash &&
      (canBootstrapFromRemote ||
        (params.status.cloudSync === "enabled" && remoteUpdatedAtMs > localSyncedAtMs))
    ) {
      const previousAbsolutePaths = applyCanonicalCloudScopeSnapshot({
        db: params.db,
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        profileId: params.status.profileId,
        workspaceScope: params.status.workspaceScope,
        ownerProfile: params.ownerProfile,
        backend: params.status.backend,
        deviceId: params.deviceId,
        stateDir: params.stateDir,
        snapshot: remote.snapshot,
        syncedAtMs: remoteUpdatedAtMs,
      });
      await materializeCanonicalScopeProjections({
        db: params.db,
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        profileId: params.status.profileId,
        workspaceScope: params.status.workspaceScope,
        previousAbsolutePaths,
      });
      return baseReady();
    }

    if (!remote || remote.contentHash !== localHash) {
      const persistedUpdatedAt = await upsertRemoteCanonicalSnapshot({
        env: params.env,
        session,
        status: params.status,
        cloudWorkspaceScope,
        snapshot: localSnapshot,
        contentHash: localHash,
      });
      await appendRemoteCanonicalBackup({
        env: params.env,
        session,
        status: params.status,
        cloudWorkspaceScope,
        snapshot: {
          ...localSnapshot,
          exportedAt: persistedUpdatedAt,
        },
        contentHash: localHash,
      });
      upsertCanonicalSyncState({
        db: params.db,
        profileId: params.status.profileId,
        workspaceScope: params.status.workspaceScope,
        backend: params.status.backend,
        now: Date.parse(persistedUpdatedAt) || localSyncedAtMs,
        cloudState: "enabled",
      });
      return baseReady();
    }

    upsertCanonicalSyncState({
      db: params.db,
      profileId: params.status.profileId,
      workspaceScope: params.status.workspaceScope,
      backend: params.status.backend,
      now: localSyncedAtMs,
      cloudState: "enabled",
    });
    return baseReady();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`failed to sync canonical memory cloud replica: ${message}`);
    upsertCanonicalSyncState({
      db: params.db,
      profileId: params.status.profileId,
      workspaceScope: params.status.workspaceScope,
      backend: params.status.backend,
      now: Date.now(),
      cloudState: "error",
    });
    return {
      ...baseReady(),
      cloudSync: "error",
      lastError: message,
    };
  }
}

function deleteOriginScopedRows(params: {
  db: DatabaseSync;
  profileId: string;
  workspaceScope: string;
  origin: CanonicalRecordOrigin;
}): void {
  params.db
    .prepare(
      `DELETE FROM relations
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ?`,
    )
    .run(params.profileId, params.workspaceScope, params.origin);
  params.db
    .prepare(
      `DELETE FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ?`,
    )
    .run(params.profileId, params.workspaceScope, params.origin);
  params.db
    .prepare(
      `DELETE FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ?`,
    )
    .run(params.profileId, params.workspaceScope, params.origin);
  params.db
    .prepare(
      `DELETE FROM entities
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ?`,
    )
    .run(params.profileId, params.workspaceScope, params.origin);
}

function deleteConflictingMarkdownImportsForStructuredEntities(params: {
  db: DatabaseSync;
  profileId: string;
  workspaceScope: string;
  entities: StructuredNormalizedEntity[];
}): Map<string, string> {
  const claimedPaths = uniqueStrings(
    params.entities.flatMap((entity) =>
      entity.projections.map((projection) => projection.relativePath),
    ),
  );
  if (claimedPaths.length === 0) {
    return new Map<string, string>();
  }

  const pathPlaceholders = claimedPaths.map(() => "?").join(", ");
  const rows = params.db
    .prepare(
      `SELECT DISTINCT e.entity_id, e.source_path
       FROM entities e
       WHERE e.profile_id = ? AND e.workspace_scope = ? AND e.origin = ? AND e.source_path IN (${pathPlaceholders})
       UNION
       SELECT DISTINCT e.entity_id, e.source_path
       FROM entities e
       INNER JOIN projections p
         ON p.profile_id = e.profile_id
        AND p.workspace_scope = e.workspace_scope
        AND p.entity_id = e.entity_id
       WHERE p.profile_id = ? AND p.workspace_scope = ? AND p.origin = ? AND p.relative_path IN (${pathPlaceholders})`,
    )
    .all(
      params.profileId,
      params.workspaceScope,
      MARKDOWN_IMPORT_ORIGIN,
      ...claimedPaths,
      params.profileId,
      params.workspaceScope,
      MARKDOWN_IMPORT_ORIGIN,
      ...claimedPaths,
    ) as Array<{
    entity_id: string;
    source_path: string;
  }>;
  if (rows.length === 0) {
    return new Map<string, string>();
  }

  const claimedEntityIdByPath = new Map<string, string>();
  for (const entity of params.entities) {
    for (const projection of entity.projections) {
      claimedEntityIdByPath.set(projection.relativePath, entity.entityId);
    }
  }

  const replacementEntityIdByDeletedEntityId = new Map<string, string>();
  for (const row of rows) {
    const replacementEntityId = claimedEntityIdByPath.get(row.source_path);
    if (replacementEntityId) {
      replacementEntityIdByDeletedEntityId.set(row.entity_id, replacementEntityId);
    }
  }

  const entityIds = uniqueStrings(rows.map((row) => row.entity_id));
  const entityPlaceholders = entityIds.map(() => "?").join(", ");
  params.db
    .prepare(
      `DELETE FROM relations
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ? AND from_entity_id IN (${entityPlaceholders})`,
    )
    .run(params.profileId, params.workspaceScope, MARKDOWN_IMPORT_ORIGIN, ...entityIds);
  params.db
    .prepare(
      `DELETE FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ? AND entity_id IN (${entityPlaceholders})`,
    )
    .run(params.profileId, params.workspaceScope, MARKDOWN_IMPORT_ORIGIN, ...entityIds);
  params.db
    .prepare(
      `DELETE FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ? AND entity_id IN (${entityPlaceholders})`,
    )
    .run(params.profileId, params.workspaceScope, MARKDOWN_IMPORT_ORIGIN, ...entityIds);
  params.db
    .prepare(
      `DELETE FROM entities
       WHERE profile_id = ? AND workspace_scope = ? AND origin = ? AND entity_id IN (${entityPlaceholders})`,
    )
    .run(params.profileId, params.workspaceScope, MARKDOWN_IMPORT_ORIGIN, ...entityIds);

  return replacementEntityIdByDeletedEntityId;
}

function rewriteMarkdownImportRelations(params: {
  db: DatabaseSync;
  profileId: string;
  workspaceScope: string;
  now: number;
  replacedEntityIdMap: ReadonlyMap<string, string>;
  entities: StructuredNormalizedEntity[];
}): void {
  const rewriteByDeletedEntityId = params.db.prepare(
    `UPDATE relations
     SET to_entity_id = ?, target_locator = NULL, updated_at = ?
     WHERE profile_id = ? AND workspace_scope = ? AND origin = ? AND to_entity_id = ?`,
  );
  for (const [deletedEntityId, replacementEntityId] of params.replacedEntityIdMap) {
    rewriteByDeletedEntityId.run(
      replacementEntityId,
      params.now,
      params.profileId,
      params.workspaceScope,
      MARKDOWN_IMPORT_ORIGIN,
      deletedEntityId,
    );
  }

  const uniqueStructuredAliasTargets = new Map<string, string>();
  const ambiguousStructuredAliasTargets = new Set<string>();
  for (const entity of params.entities) {
    for (const aliasKey of entity.aliasKeys) {
      if (ambiguousStructuredAliasTargets.has(aliasKey)) {
        continue;
      }
      const existing = uniqueStructuredAliasTargets.get(aliasKey);
      if (existing && existing !== entity.entityId) {
        uniqueStructuredAliasTargets.delete(aliasKey);
        ambiguousStructuredAliasTargets.add(aliasKey);
        continue;
      }
      uniqueStructuredAliasTargets.set(aliasKey, entity.entityId);
    }
  }

  const rewriteByTargetLocator = params.db.prepare(
    `UPDATE relations
     SET to_entity_id = ?, target_locator = NULL, updated_at = ?
     WHERE profile_id = ? AND workspace_scope = ? AND origin = ? AND target_locator = ?`,
  );
  for (const [aliasKey, entityId] of uniqueStructuredAliasTargets) {
    rewriteByTargetLocator.run(
      entityId,
      params.now,
      params.profileId,
      params.workspaceScope,
      MARKDOWN_IMPORT_ORIGIN,
      aliasKey,
    );
  }
}

async function materializeStructuredProjections(params: {
  profileId: string;
  entities: StructuredNormalizedEntity[];
}): Promise<void> {
  const projectionPathByEntityId = new Map<string, string>(
    params.entities.map((entity) => [entity.entityId, entity.primarySourcePath]),
  );
  for (const entity of params.entities) {
    for (const projection of entity.projections) {
      const markdown = buildCanonicalMarkdownProjection({
        profileId: params.profileId,
        entity,
        projection,
        projectionPathByEntityId,
      });
      await fs.mkdir(path.dirname(projection.absolutePath), { recursive: true });
      await fs.writeFile(projection.absolutePath, markdown, "utf8");
    }
  }
}

type CanonicalProjectionMaterializationRow = {
  entityId: string;
  origin: CanonicalRecordOrigin;
  relativePath: string;
  absolutePath: string;
  sourceKind: CanonicalProjectionSource;
  editable: boolean;
  frontmatterJson: string;
  markdownBody: string;
};

function readScopeProjectionMaterializationRows(
  db: DatabaseSync,
  params: {
    profileId: string;
    workspaceScope: string;
  },
): CanonicalProjectionMaterializationRow[] {
  const rows = db
    .prepare(
      `SELECT
         entity_id AS entityId,
         origin,
         relative_path AS relativePath,
         absolute_path AS absolutePath,
         source_kind AS sourceKind,
         editable,
         frontmatter_json AS frontmatterJson,
         markdown_body AS markdownBody
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ?
       ORDER BY relative_path ASC`,
    )
    .all(params.profileId, params.workspaceScope) as Array<{
    entityId: string;
    origin: CanonicalRecordOrigin;
    relativePath: string;
    absolutePath: string;
    sourceKind: CanonicalProjectionSource;
    editable: number;
    frontmatterJson: string;
    markdownBody: string;
  }>;
  return rows.map((row) => ({
    entityId: row.entityId,
    origin: row.origin,
    relativePath: row.relativePath,
    absolutePath: row.absolutePath,
    sourceKind: row.sourceKind,
    editable: row.editable === 1,
    frontmatterJson: row.frontmatterJson,
    markdownBody: row.markdownBody,
  }));
}

function renderStoredProjectionMarkdown(params: {
  frontmatterJson: string;
  markdownBody: string;
}): string {
  const frontmatter = parseJsonRecord(params.frontmatterJson);
  const body = params.markdownBody.trim();
  if (Object.keys(frontmatter).length === 0) {
    return body ? `${body}\n` : "";
  }
  const frontmatterLines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    appendYamlField(frontmatterLines, key, value);
  }
  frontmatterLines.push("---", "");
  return [...frontmatterLines, ...(body ? [body] : [])].join("\n").trimEnd().concat("\n");
}

async function materializeCanonicalScopeProjections(params: {
  db: DatabaseSync;
  cfg: OpenClawConfig;
  workspaceDir: string;
  profileId: string;
  workspaceScope: string;
  previousAbsolutePaths?: Iterable<string>;
}): Promise<void> {
  const projectionRows = readScopeProjectionMaterializationRows(params.db, {
    profileId: params.profileId,
    workspaceScope: params.workspaceScope,
  });
  const nextAbsolutePaths = new Set(projectionRows.map((row) => row.absolutePath).filter(Boolean));

  const structuredEntityIds = uniqueStrings(
    projectionRows
      .filter((row) => row.origin === STRUCTURED_STORE_ORIGIN)
      .map((row) => row.entityId)
      .filter(Boolean),
  );
  if (structuredEntityIds.length > 0) {
    const normalizedEntities = readStructuredEntityInputs(params.db, {
      profileId: params.profileId,
      workspaceScope: params.workspaceScope,
      entityIds: structuredEntityIds,
    }).map((entity) =>
      normalizeStructuredEntityInput({
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        entity,
      }),
    );
    await materializeStructuredProjections({
      profileId: params.profileId,
      entities: normalizedEntities,
    });
  }

  for (const projection of projectionRows) {
    if (projection.origin !== MARKDOWN_IMPORT_ORIGIN) {
      continue;
    }
    await fs.mkdir(path.dirname(projection.absolutePath), { recursive: true });
    await fs.writeFile(
      projection.absolutePath,
      renderStoredProjectionMarkdown({
        frontmatterJson: projection.frontmatterJson,
        markdownBody: projection.markdownBody,
      }),
      "utf8",
    );
  }

  for (const absolutePath of params.previousAbsolutePaths ?? []) {
    if (!absolutePath || nextAbsolutePaths.has(absolutePath)) {
      continue;
    }
    await fs.rm(absolutePath, { force: true }).catch(() => {});
  }
}

function deleteScopeRows(params: {
  db: DatabaseSync;
  profileId: string;
  workspaceScope: string;
}): void {
  params.db
    .prepare(
      `DELETE FROM relations
       WHERE profile_id = ? AND workspace_scope = ?`,
    )
    .run(params.profileId, params.workspaceScope);
  params.db
    .prepare(
      `DELETE FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ?`,
    )
    .run(params.profileId, params.workspaceScope);
  params.db
    .prepare(
      `DELETE FROM projections
       WHERE profile_id = ? AND workspace_scope = ?`,
    )
    .run(params.profileId, params.workspaceScope);
  params.db
    .prepare(
      `DELETE FROM entities
       WHERE profile_id = ? AND workspace_scope = ?`,
    )
    .run(params.profileId, params.workspaceScope);
}

function exportCanonicalCloudScopeSnapshot(params: {
  db: DatabaseSync;
  status: CanonicalMemoryStoreStatus;
  workspaceScope: string;
  exportedAt: string;
  deviceId: string;
  stateDir: string;
}): CanonicalCloudScopeSnapshot {
  const entities = params.db
    .prepare(
      `SELECT entity_id, kind, slug, title, source_path, source_kind, content_hash, updated_at, metadata, origin
       FROM entities
       WHERE profile_id = ? AND workspace_scope = ?
       ORDER BY source_path ASC, entity_id ASC`,
    )
    .all(params.status.profileId, params.status.workspaceScope) as Array<{
    entity_id: string;
    kind: string;
    slug: string;
    title: string;
    source_path: string;
    source_kind: CanonicalProjectionSource;
    content_hash: string;
    updated_at: number;
    metadata: string;
    origin: CanonicalRecordOrigin;
  }>;
  const aliases = params.db
    .prepare(
      `SELECT alias_key, entity_id, updated_at, origin
       FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ?
       ORDER BY alias_key ASC, entity_id ASC`,
    )
    .all(params.status.profileId, params.status.workspaceScope) as Array<{
    alias_key: string;
    entity_id: string;
    updated_at: number;
    origin: CanonicalRecordOrigin;
  }>;
  const relations = params.db
    .prepare(
      `SELECT relation_id, from_entity_id, relation_type, to_entity_id, target_locator, ordinal, updated_at, metadata, origin
       FROM relations
       WHERE profile_id = ? AND workspace_scope = ?
       ORDER BY from_entity_id ASC, ordinal ASC, relation_id ASC`,
    )
    .all(params.status.profileId, params.status.workspaceScope) as Array<{
    relation_id: string;
    from_entity_id: string;
    relation_type: string;
    to_entity_id: string | null;
    target_locator: string | null;
    ordinal: number;
    updated_at: number;
    metadata: string;
    origin: CanonicalRecordOrigin;
  }>;
  const projections = params.db
    .prepare(
      `SELECT projection_id, entity_id, projection_kind, relative_path, editable, source_kind, content_hash, frontmatter_json, markdown_body, updated_at, metadata, origin
       FROM projections
       WHERE profile_id = ? AND workspace_scope = ?
       ORDER BY relative_path ASC, projection_id ASC`,
    )
    .all(params.status.profileId, params.status.workspaceScope) as Array<{
    projection_id: string;
    entity_id: string;
    projection_kind: string;
    relative_path: string;
    editable: number;
    source_kind: CanonicalProjectionSource;
    content_hash: string;
    frontmatter_json: string;
    markdown_body: string;
    updated_at: number;
    metadata: string;
    origin: CanonicalRecordOrigin;
  }>;

  return {
    schemaVersion: CANONICAL_CLOUD_SNAPSHOT_SCHEMA_VERSION,
    profileId: params.status.profileId,
    workspaceScope: params.workspaceScope,
    backend: params.status.backend,
    projectionInterface: "markdown-vault",
    syncMode: CANONICAL_STORE_SYNC_MODE,
    exportedAt: params.exportedAt,
    exportedBy: {
      deviceId: params.deviceId,
      stateDir: params.stateDir,
    },
    entities: entities.map((row) => ({
      entityId: row.entity_id,
      kind: row.kind,
      slug: row.slug,
      title: row.title,
      sourcePath: row.source_path,
      sourceKind: row.source_kind,
      contentHash: row.content_hash,
      updatedAt: row.updated_at,
      metadataJson: row.metadata,
      origin: row.origin,
    })),
    aliases: aliases.map((row) => ({
      aliasKey: row.alias_key,
      entityId: row.entity_id,
      updatedAt: row.updated_at,
      origin: row.origin,
    })),
    relations: relations.map((row) => ({
      relationId: row.relation_id,
      fromEntityId: row.from_entity_id,
      relationType: row.relation_type,
      toEntityId: row.to_entity_id,
      targetLocator: row.target_locator,
      ordinal: row.ordinal,
      updatedAt: row.updated_at,
      metadataJson: row.metadata,
      origin: row.origin,
    })),
    projections: projections.map((row) => ({
      projectionId: row.projection_id,
      entityId: row.entity_id,
      projectionKind: row.projection_kind,
      relativePath: row.relative_path,
      editable: row.editable === 1,
      sourceKind: row.source_kind,
      contentHash: row.content_hash,
      frontmatterJson: row.frontmatter_json,
      markdownBody: row.markdown_body,
      updatedAt: row.updated_at,
      metadataJson: row.metadata,
      origin: row.origin,
    })),
  };
}

function hashCanonicalCloudScopeSnapshot(snapshot: CanonicalCloudScopeSnapshot) {
  return hashText(stringifyCanonicalJson(snapshot));
}

function applyCanonicalCloudScopeSnapshot(params: {
  db: DatabaseSync;
  cfg: OpenClawConfig;
  workspaceDir: string;
  profileId: string;
  workspaceScope: string;
  ownerProfile: AlisioMemoryOwnerProfile;
  backend: CanonicalStoreBackend;
  deviceId: string;
  stateDir: string;
  snapshot: CanonicalCloudScopeSnapshot;
  syncedAtMs: number;
}): string[] {
  const previousAbsolutePaths = readScopeProjectionMaterializationRows(params.db, {
    profileId: params.profileId,
    workspaceScope: params.workspaceScope,
  }).map((row) => row.absolutePath);

  const insertEntity = params.db.prepare(
    `INSERT INTO entities (
       entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind,
       content_hash, updated_at, metadata, origin
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAlias = params.db.prepare(
    `INSERT INTO entity_aliases (
       profile_id, workspace_scope, alias_key, entity_id, updated_at, origin
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertRelation = params.db.prepare(
    `INSERT INTO relations (
       relation_id, profile_id, workspace_scope, from_entity_id, relation_type, to_entity_id,
       target_locator, ordinal, updated_at, metadata, origin
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertProjection = params.db.prepare(
    `INSERT INTO projections (
       projection_id, profile_id, workspace_scope, entity_id, projection_kind, relative_path,
       absolute_path, editable, source_kind, content_hash, frontmatter_json, markdown_body,
       updated_at, metadata, origin
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  params.db.exec("BEGIN");
  try {
    upsertCanonicalOwnerProfile({
      db: params.db,
      ownerProfile: params.ownerProfile,
      now: params.syncedAtMs,
    });
    upsertCanonicalReplica({
      db: params.db,
      ownerProfile: params.ownerProfile,
      workspaceScope: params.workspaceScope,
      deviceId: params.deviceId,
      stateDir: params.stateDir,
      now: params.syncedAtMs,
    });
    deleteScopeRows({
      db: params.db,
      profileId: params.profileId,
      workspaceScope: params.workspaceScope,
    });

    for (const entity of params.snapshot.entities) {
      insertEntity.run(
        entity.entityId,
        params.profileId,
        params.workspaceScope,
        entity.kind,
        entity.slug,
        entity.title,
        entity.sourcePath,
        entity.sourceKind,
        entity.contentHash,
        entity.updatedAt,
        entity.metadataJson,
        entity.origin,
      );
    }
    for (const alias of params.snapshot.aliases) {
      insertAlias.run(
        params.profileId,
        params.workspaceScope,
        alias.aliasKey,
        alias.entityId,
        alias.updatedAt,
        alias.origin,
      );
    }
    for (const relation of params.snapshot.relations) {
      insertRelation.run(
        relation.relationId,
        params.profileId,
        params.workspaceScope,
        relation.fromEntityId,
        relation.relationType,
        relation.toEntityId,
        relation.targetLocator,
        relation.ordinal,
        relation.updatedAt,
        relation.metadataJson,
        relation.origin,
      );
    }
    for (const projection of params.snapshot.projections) {
      const absolutePath = resolveCanonicalProjectionAbsolutePath({
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        relativePath: projection.relativePath,
        sourceKind: projection.sourceKind,
      });
      insertProjection.run(
        projection.projectionId,
        params.profileId,
        params.workspaceScope,
        projection.entityId,
        projection.projectionKind,
        projection.relativePath,
        absolutePath,
        projection.editable ? 1 : 0,
        projection.sourceKind,
        projection.contentHash,
        projection.frontmatterJson,
        projection.markdownBody,
        projection.updatedAt,
        projection.metadataJson,
        projection.origin,
      );
    }
    upsertCanonicalSyncState({
      db: params.db,
      profileId: params.profileId,
      workspaceScope: params.workspaceScope,
      backend: params.backend,
      now: params.syncedAtMs,
      cloudState: "enabled",
    });
    params.db.exec("COMMIT");
    return previousAbsolutePaths;
  } catch (err) {
    try {
      params.db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

export async function upsertCanonicalMemoryStructuredEntities(params: {
  cfg: OpenClawConfig;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  entities: CanonicalMemoryStructuredEntityInput[];
  env?: NodeJS.ProcessEnv;
  materializeMarkdown?: boolean;
}): Promise<CanonicalMemoryStoreStatus> {
  if (params.entities.length === 0) {
    return buildCanonicalMemoryStoreStatus({
      env: params.env,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      backend: params.backend,
    });
  }
  const env = params.env ?? process.env;
  const baseStatus = createStatusBase({
    env,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    backend: params.backend,
  });
  const now = Date.now();
  const ownerProfile = resolveAlisioMemoryOwnerProfile(env);
  const deviceIdentity = loadOrCreateDeviceIdentity();
  const stateDir = resolveStateDir(env);
  const db = openCanonicalStore(baseStatus.path);

  try {
    const entities = params.entities.map((entity) =>
      normalizeStructuredEntityInput({
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        entity,
      }),
    );
    const entityMap = new Map(entities.map((entity) => [entity.entityId, entity]));
    const projectionPathByEntityId = new Map(
      entities.map((entity) => [entity.entityId, entity.primarySourcePath]),
    );
    const renderedProjectionMarkdown = new Map<string, string>();
    for (const entity of entities) {
      for (const projection of entity.projections) {
        renderedProjectionMarkdown.set(
          projection.projectionId,
          buildCanonicalMarkdownProjection({
            profileId: ownerProfile.profileId,
            entity,
            projection,
            projectionPathByEntityId,
          }),
        );
      }
    }

    db.exec("BEGIN");
    upsertCanonicalOwnerProfile({ db, ownerProfile, now });
    upsertCanonicalReplica({
      db,
      ownerProfile,
      workspaceScope: baseStatus.workspaceScope,
      deviceId: deviceIdentity.deviceId,
      stateDir,
      now,
    });
    const replacedEntityIdMap = deleteConflictingMarkdownImportsForStructuredEntities({
      db,
      profileId: ownerProfile.profileId,
      workspaceScope: baseStatus.workspaceScope,
      entities,
    });
    const aliasMap = readScopeAliasMap(db, {
      profileId: ownerProfile.profileId,
      workspaceScope: baseStatus.workspaceScope,
    });
    for (const entity of entities) {
      for (const aliasKey of entity.aliasKeys) {
        const aliasTargets = aliasMap.get(aliasKey) ?? new Set<string>();
        aliasTargets.add(entity.entityId);
        aliasMap.set(aliasKey, aliasTargets);
      }
    }

    const upsertEntity = db.prepare(
      `INSERT INTO entities (
         entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind,
         content_hash, updated_at, metadata, origin
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         kind = excluded.kind,
         slug = excluded.slug,
         title = excluded.title,
         source_path = excluded.source_path,
         source_kind = excluded.source_kind,
         content_hash = excluded.content_hash,
         updated_at = excluded.updated_at,
         metadata = excluded.metadata,
         origin = excluded.origin`,
    );
    const deleteAliases = db.prepare(
      `DELETE FROM entity_aliases
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ? AND origin = ?`,
    );
    const insertAlias = db.prepare(
      `INSERT INTO entity_aliases (
         profile_id, workspace_scope, alias_key, entity_id, updated_at, origin
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const deleteProjections = db.prepare(
      `DELETE FROM projections
       WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ? AND origin = ?`,
    );
    const insertProjection = db.prepare(
      `INSERT INTO projections (
         projection_id, profile_id, workspace_scope, entity_id, projection_kind, relative_path,
         absolute_path, editable, source_kind, content_hash, frontmatter_json, markdown_body,
         updated_at, metadata, origin
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const deleteRelations = db.prepare(
      `DELETE FROM relations
       WHERE profile_id = ? AND workspace_scope = ? AND from_entity_id = ? AND origin = ?`,
    );
    const insertRelation = db.prepare(
      `INSERT INTO relations (
         relation_id, profile_id, workspace_scope, from_entity_id, relation_type, to_entity_id,
         target_locator, ordinal, updated_at, metadata, origin
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const entity of entities) {
      upsertEntity.run(
        entity.entityId,
        ownerProfile.profileId,
        baseStatus.workspaceScope,
        entity.kind,
        entity.slug,
        entity.title,
        entity.primarySourcePath,
        entity.primarySourceKind,
        hashText(
          stringifyCanonicalJson({
            metadata: parseJsonRecord(entity.metadataJson),
            projections: entity.projections.map((projection) => projection.contentHash),
          }),
        ),
        now,
        entity.metadataJson,
        STRUCTURED_STORE_ORIGIN,
      );
      deleteAliases.run(
        ownerProfile.profileId,
        baseStatus.workspaceScope,
        entity.entityId,
        STRUCTURED_STORE_ORIGIN,
      );
      for (const aliasKey of entity.aliasKeys) {
        insertAlias.run(
          ownerProfile.profileId,
          baseStatus.workspaceScope,
          aliasKey,
          entity.entityId,
          now,
          STRUCTURED_STORE_ORIGIN,
        );
      }
      deleteProjections.run(
        ownerProfile.profileId,
        baseStatus.workspaceScope,
        entity.entityId,
        STRUCTURED_STORE_ORIGIN,
      );
      for (const projection of entity.projections) {
        const renderedMarkdown =
          renderedProjectionMarkdown.get(projection.projectionId) ??
          buildCanonicalMarkdownProjection({
            profileId: ownerProfile.profileId,
            entity,
            projection,
            projectionPathByEntityId,
          });
        insertProjection.run(
          projection.projectionId,
          ownerProfile.profileId,
          baseStatus.workspaceScope,
          entity.entityId,
          "markdown-note",
          projection.relativePath,
          projection.absolutePath,
          projection.editable ? 1 : 0,
          projection.sourceKind,
          hashText(renderedMarkdown),
          projection.frontmatterJson,
          projection.markdownBody,
          now,
          projection.metadataJson,
          STRUCTURED_STORE_ORIGIN,
        );
      }
      deleteRelations.run(
        ownerProfile.profileId,
        baseStatus.workspaceScope,
        entity.entityId,
        STRUCTURED_STORE_ORIGIN,
      );
      for (const relation of entity.relations) {
        const aliasTargets = relation.targetAliasKey
          ? aliasMap.get(relation.targetAliasKey)
          : undefined;
        const relatedFromAlias =
          aliasTargets && aliasTargets.size === 1 ? Array.from(aliasTargets)[0] : null;
        const relatedFromBatch =
          relation.targetEntityId && entityMap.has(relation.targetEntityId)
            ? relation.targetEntityId
            : undefined;
        const toEntityId = relation.targetEntityId ?? relatedFromBatch ?? relatedFromAlias ?? null;
        const targetLocator =
          toEntityId === null ? (relation.targetLocator ?? relation.targetAliasKey ?? null) : null;
        insertRelation.run(
          hashText(
            `${entity.entityId}:${relation.relationType}:${relation.ordinal}:${toEntityId ?? targetLocator ?? ""}`,
          ),
          ownerProfile.profileId,
          baseStatus.workspaceScope,
          entity.entityId,
          relation.relationType,
          toEntityId,
          targetLocator,
          relation.ordinal,
          now,
          relation.metadataJson,
          STRUCTURED_STORE_ORIGIN,
        );
      }
    }

    rewriteMarkdownImportRelations({
      db,
      profileId: ownerProfile.profileId,
      workspaceScope: baseStatus.workspaceScope,
      now,
      replacedEntityIdMap,
      entities,
    });

    upsertCanonicalSyncState({
      db,
      profileId: ownerProfile.profileId,
      workspaceScope: baseStatus.workspaceScope,
      backend: params.backend,
      now,
    });
    db.exec("COMMIT");

    if (params.materializeMarkdown !== false) {
      await materializeStructuredProjections({
        profileId: ownerProfile.profileId,
        entities,
      });
    }
    return await finalizeCanonicalCloudSync({
      db,
      cfg: params.cfg,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      env,
      status: buildReadyCanonicalStoreStatus({
        baseStatus,
        db,
        profileId: ownerProfile.profileId,
        workspaceScope: baseStatus.workspaceScope,
        deviceId: deviceIdentity.deviceId,
        stateDir,
      }),
      ownerProfile,
      deviceId: deviceIdentity.deviceId,
      stateDir,
    });
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`failed to upsert structured canonical memory entities: ${message}`);
    throw err;
  } finally {
    db.close();
  }
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
    const candidates = new Map<string, CanonicalEntityRow & { score: number }>();
    if (normalizedQuery) {
      upsertGraphCandidate(
        candidates,
        db
          .prepare(
            `SELECT DISTINCT
               e.entity_id,
               e.title,
               e.slug,
               e.source_path,
               e.source_kind,
               e.metadata
             FROM entities e
             INNER JOIN entity_aliases a
               ON a.profile_id = e.profile_id
              AND a.workspace_scope = e.workspace_scope
              AND a.entity_id = e.entity_id
             WHERE e.profile_id = ? AND e.workspace_scope = ? AND a.alias_key = ?`,
          )
          .all(
            params.status.profileId,
            params.status.workspaceScope,
            normalizedQuery,
          ) as CanonicalEntityRow[],
        1,
      );
      upsertGraphCandidate(
        candidates,
        db
          .prepare(
            `SELECT DISTINCT
               e.entity_id,
               e.title,
               e.slug,
               e.source_path,
               e.source_kind,
               e.metadata
             FROM entities e
             INNER JOIN entity_aliases a
               ON a.profile_id = e.profile_id
              AND a.workspace_scope = e.workspace_scope
              AND a.entity_id = e.entity_id
             WHERE e.profile_id = ? AND e.workspace_scope = ? AND a.alias_key LIKE ?
             ORDER BY a.alias_key ASC
             LIMIT ?`,
          )
          .all(
            params.status.profileId,
            params.status.workspaceScope,
            `${normalizedQuery}%`,
            matchLimit * 3,
          ) as CanonicalEntityRow[],
        0.8,
      );
      upsertGraphCandidate(
        candidates,
        db
          .prepare(
            `SELECT DISTINCT
               e.entity_id,
               e.title,
               e.slug,
               e.source_path,
               e.source_kind,
               e.metadata
             FROM entities e
             INNER JOIN entity_aliases a
               ON a.profile_id = e.profile_id
              AND a.workspace_scope = e.workspace_scope
              AND a.entity_id = e.entity_id
             WHERE e.profile_id = ? AND e.workspace_scope = ? AND a.alias_key LIKE ?
             ORDER BY a.alias_key ASC
             LIMIT ?`,
          )
          .all(
            params.status.profileId,
            params.status.workspaceScope,
            `%${normalizedQuery}%`,
            matchLimit * 3,
          ) as CanonicalEntityRow[],
        0.65,
      );
    }
    upsertGraphCandidate(
      candidates,
      db
        .prepare(
          `SELECT entity_id, title, slug, source_path, source_kind, metadata
           FROM entities
           WHERE profile_id = ? AND workspace_scope = ? AND LOWER(title) = ?`,
        )
        .all(
          params.status.profileId,
          params.status.workspaceScope,
          loweredQuery,
        ) as CanonicalEntityRow[],
      0.95,
    );
    upsertGraphCandidate(
      candidates,
      db
        .prepare(
          `SELECT entity_id, title, slug, source_path, source_kind, metadata
           FROM entities
           WHERE profile_id = ? AND workspace_scope = ? AND LOWER(title) LIKE ?
           ORDER BY title ASC
           LIMIT ?`,
        )
        .all(
          params.status.profileId,
          params.status.workspaceScope,
          `%${loweredQuery}%`,
          matchLimit * 3,
        ) as CanonicalEntityRow[],
      0.6,
    );

    const limits = resolveRelationDirectionLimits({
      direction,
      relationLimit: params.relationLimit,
    });
    const matches = Array.from(candidates.values())
      .toSorted((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.title.localeCompare(right.title);
      })
      .slice(0, matchLimit)
      .map((row) => {
        const metadata = parseJsonRecord(row.metadata);
        const aliases = listEntityAliases(db, {
          profileId: params.status.profileId,
          workspaceScope: params.status.workspaceScope,
          entityId: row.entity_id,
        });
        const projections = listEntityProjections(db, {
          profileId: params.status.profileId,
          workspaceScope: params.status.workspaceScope,
          entityId: row.entity_id,
        });
        const outgoingRelations = listEntityRelations(db, {
          profileId: params.status.profileId,
          workspaceScope: params.status.workspaceScope,
          entityId: row.entity_id,
          direction: "outgoing",
          limit: limits.outgoing,
        });
        const incomingRelations = listEntityRelations(db, {
          profileId: params.status.profileId,
          workspaceScope: params.status.workspaceScope,
          entityId: row.entity_id,
          direction: "incoming",
          limit: limits.incoming,
        });
        const tags = Array.isArray(metadata.tags)
          ? metadata.tags.filter((value): value is string => typeof value === "string")
          : [];
        return {
          entityId: row.entity_id,
          title: row.title,
          slug: row.slug,
          sourcePath: row.source_path,
          sourceKind: row.source_kind,
          aliases,
          tags,
          score: row.score,
          projections,
          relations: [...outgoingRelations, ...incomingRelations],
        } satisfies CanonicalMemoryGraphMatch;
      });

    return {
      ...emptyResult,
      matches,
    };
  } finally {
    db.close();
  }
}

export function buildCanonicalMemoryStoreStatus(params: {
  env?: NodeJS.ProcessEnv;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
}): CanonicalMemoryStoreStatus {
  return createStatusBase(params);
}

export async function syncCanonicalMemoryStore(params: {
  cfg: OpenClawConfig;
  agentId: string;
  workspaceDir: string;
  backend: CanonicalStoreBackend;
  env?: NodeJS.ProcessEnv;
}): Promise<CanonicalMemoryStoreStatus> {
  const env = params.env ?? process.env;
  const baseStatus = createStatusBase({
    env,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    backend: params.backend,
  });
  const now = Date.now();
  const ownerProfile = resolveAlisioMemoryOwnerProfile(env);
  const deviceIdentity = loadOrCreateDeviceIdentity();
  const stateDir = resolveStateDir(env);
  const db = openCanonicalStore(baseStatus.path);
  let closed = false;

  try {
    const structuredProjectionPaths = readOriginScopedProjectionPaths(db, {
      profileId: ownerProfile.profileId,
      workspaceScope: baseStatus.workspaceScope,
      origin: STRUCTURED_STORE_ORIGIN,
    });
    const structuredProjectionEntityIdsByPath = readStructuredProjectionEntityIdsByPath(db, {
      profileId: ownerProfile.profileId,
      workspaceScope: baseStatus.workspaceScope,
    });
    const collected = await collectOwnedMemoryProjections({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      structuredProjectionPaths,
    });
    const projections = collected.markdownImports;
    const insertEntity = db.prepare(
      `INSERT INTO entities (
         entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind,
         content_hash, updated_at, metadata, origin
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAlias = db.prepare(
      `INSERT INTO entity_aliases (
         profile_id, workspace_scope, alias_key, entity_id, updated_at, origin
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertProjection = db.prepare(
      `INSERT INTO projections (
         projection_id, profile_id, workspace_scope, entity_id, projection_kind, relative_path,
         absolute_path, editable, source_kind, content_hash, frontmatter_json, markdown_body,
         updated_at, metadata, origin
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertRelation = db.prepare(
      `INSERT INTO relations (
         relation_id, profile_id, workspace_scope, from_entity_id, relation_type, to_entity_id,
         target_locator, ordinal, updated_at, metadata, origin
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    db.exec("BEGIN");
    upsertCanonicalOwnerProfile({ db, ownerProfile, now });
    upsertCanonicalReplica({
      db,
      ownerProfile,
      workspaceScope: baseStatus.workspaceScope,
      deviceId: deviceIdentity.deviceId,
      stateDir,
      now,
    });
    deleteOriginScopedRows({
      db,
      profileId: ownerProfile.profileId,
      workspaceScope: baseStatus.workspaceScope,
      origin: MARKDOWN_IMPORT_ORIGIN,
    });

    const aliasMap = readScopeAliasMap(db, {
      profileId: ownerProfile.profileId,
      workspaceScope: baseStatus.workspaceScope,
    });
    for (const projection of projections) {
      for (const aliasKey of projection.aliasKeys) {
        const entry = aliasMap.get(aliasKey) ?? new Set<string>();
        entry.add(projection.entityId);
        aliasMap.set(aliasKey, entry);
      }
    }

    for (const projection of projections) {
      insertEntity.run(
        projection.entityId,
        ownerProfile.profileId,
        baseStatus.workspaceScope,
        "note",
        projection.slug,
        projection.title,
        projection.displayPath,
        projection.source,
        projection.contentHash,
        now,
        projection.metadataJson,
        MARKDOWN_IMPORT_ORIGIN,
      );
      for (const aliasKey of projection.aliasKeys) {
        insertAlias.run(
          ownerProfile.profileId,
          baseStatus.workspaceScope,
          aliasKey,
          projection.entityId,
          now,
          MARKDOWN_IMPORT_ORIGIN,
        );
      }
      insertProjection.run(
        projection.projectionId,
        ownerProfile.profileId,
        baseStatus.workspaceScope,
        projection.entityId,
        "markdown-note",
        projection.displayPath,
        projection.absolutePath,
        1,
        projection.source,
        projection.contentHash,
        projection.frontmatterJson,
        projection.markdownBody,
        now,
        projection.metadataJson,
        MARKDOWN_IMPORT_ORIGIN,
      );
      for (const reference of projection.references) {
        const targetEntityIds = aliasMap.get(reference.targetKey);
        const resolvedTargetId =
          targetEntityIds && targetEntityIds.size === 1 ? Array.from(targetEntityIds)[0] : null;
        insertRelation.run(
          hashText(
            `${projection.entityId}:${reference.relationType}:${reference.ordinal}:${reference.targetLocator}`,
          ),
          ownerProfile.profileId,
          baseStatus.workspaceScope,
          projection.entityId,
          reference.relationType,
          resolvedTargetId,
          resolvedTargetId ? null : reference.targetLocator,
          reference.ordinal,
          now,
          JSON.stringify(reference.metadata),
          MARKDOWN_IMPORT_ORIGIN,
        );
      }
    }

    upsertCanonicalSyncState({
      db,
      profileId: ownerProfile.profileId,
      workspaceScope: baseStatus.workspaceScope,
      backend: params.backend,
      now,
    });
    db.exec("COMMIT");

    const structuredRoundTripEntityIds = uniqueStrings(
      collected.structuredEdits
        .map(
          (edit) =>
            edit.entityId ?? structuredProjectionEntityIdsByPath.get(edit.displayPath) ?? "",
        )
        .filter(Boolean),
    );
    if (structuredRoundTripEntityIds.length > 0) {
      const mergedEntities = mergeStructuredRoundTripEdits({
        entities: readStructuredEntityInputs(db, {
          profileId: ownerProfile.profileId,
          workspaceScope: baseStatus.workspaceScope,
          entityIds: structuredRoundTripEntityIds,
        }),
        edits: collected.structuredEdits.map((edit) => ({
          ...edit,
          entityId: edit.entityId ?? structuredProjectionEntityIdsByPath.get(edit.displayPath),
        })),
      });
      db.close();
      closed = true;
      return await upsertCanonicalMemoryStructuredEntities({
        cfg: params.cfg,
        agentId: params.agentId,
        workspaceDir: params.workspaceDir,
        backend: params.backend,
        env,
        entities: mergedEntities,
      });
    }

    return await finalizeCanonicalCloudSync({
      db,
      cfg: params.cfg,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      env,
      status: buildReadyCanonicalStoreStatus({
        baseStatus,
        db,
        profileId: ownerProfile.profileId,
        workspaceScope: baseStatus.workspaceScope,
        deviceId: deviceIdentity.deviceId,
        stateDir,
      }),
      ownerProfile,
      deviceId: deviceIdentity.deviceId,
      stateDir,
    });
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`failed to sync canonical memory store: ${message}`);
    throw err;
  } finally {
    if (!closed) {
      db.close();
    }
  }
}
