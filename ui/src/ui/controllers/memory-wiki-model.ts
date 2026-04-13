import type {
  MemoryWikiHistoryEntry,
  MemoryWikiListPage,
  MemoryWikiListResult,
  MemoryWikiPage,
  MemoryWikiRelatedFile,
} from "./memory-runtime.ts";

export type MemoryWikiResolvedLink = {
  rawTarget: string;
  target: string;
  label: string;
  anchor?: string;
  pageId?: string | null;
  title?: string | null;
  path?: string | null;
  missing: boolean;
};

export type MemoryWikiHeading = {
  anchor: string;
  label: string;
  level: number;
};

export type MemoryWikiListPageModel = MemoryWikiListPage & {
  summary: string;
  tags: string[];
  categories: string[];
  collections: string[];
  featured: boolean;
  updatedAtMs: number | null;
  portalScore: number;
};

export type MemoryWikiPageModel = MemoryWikiPage & {
  summary: string;
  body: string;
  lead: string;
  tags: string[];
  categories: string[];
  collections: string[];
  featured: boolean;
  relatedFiles: MemoryWikiRelatedFile[];
  headings: MemoryWikiHeading[];
  links: MemoryWikiResolvedLink[];
};

export type MemoryWikiPortalGroup = {
  name: string;
  pages: MemoryWikiListPageModel[];
  kind: "category" | "collection";
};

export type MemoryWikiPortalModel = {
  pages: MemoryWikiListPageModel[];
  featured: MemoryWikiListPageModel | null;
  recentUpdates: MemoryWikiListPageModel[];
  categories: MemoryWikiPortalGroup[];
  collections: MemoryWikiPortalGroup[];
  stats: {
    pages: number;
    backlinks: number;
    claims: number;
    evidence: number;
  };
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown) {
  return value === true || normalizeString(value).toLowerCase() === "true";
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
      .filter((entry, index, items) => items.indexOf(entry) === index);
  }
  const single = normalizeString(value);
  return single ? [single] : [];
}

function uniqueStrings(values: Iterable<string>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function readFrontmatter(markdown: string) {
  if (!markdown.startsWith("---\n")) {
    return { body: markdown, summary: "", categories: [] as string[], collections: [] as string[] };
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) {
    return { body: markdown, summary: "", categories: [] as string[], collections: [] as string[] };
  }
  const raw = markdown.slice(4, end);
  const body = markdown.slice(end + 5);
  const readScalar = (key: string) => {
    const match = raw.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  };
  const readList = (key: string) => {
    const match = raw.match(new RegExp(`^${key}:\\s*\\[(.+)\\]$`, "m"));
    if (!match?.[1]) {
      return [] as string[];
    }
    return match[1]
      .split(",")
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  };
  return {
    body,
    summary: readScalar("summary") || readScalar("description"),
    categories: [...readList("categories"), readScalar("category")].filter(Boolean),
    collections: [...readList("collections"), readScalar("collection")].filter(Boolean),
  };
}

function summarizeText(value: string, maxChars = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function extractLead(body: string) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((entry) => !entry.startsWith("#"));
  return paragraphs[0] ?? "";
}

function normalizeWikiKey(value: string) {
  return value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\.md$/i, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function slugifyHeading(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[`*_~[\]()/]+/g, "")
    .replace(/[^a-z0-9 -]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return normalized || "section";
}

function splitTargetAnchor(rawTarget: string): { target: string; anchor?: string } {
  const [target, ...rest] = rawTarget.split("#");
  const anchor = rest
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("#");
  return {
    target: target.trim(),
    ...(anchor ? { anchor } : {}),
  };
}

function normalizeTags(rawPage: Record<string, unknown>, fallback?: string[]) {
  const rawTags = normalizeStringList(rawPage.tags);
  return rawTags.length > 0 ? rawTags : (fallback ?? []);
}

function normalizeCategories(rawPage: Record<string, unknown>, tags: string[]) {
  const explicit = normalizeStringList(rawPage.categories);
  if (explicit.length > 0) {
    return explicit;
  }
  const category = normalizeString(rawPage.category);
  return category ? [category] : tags;
}

function normalizeCollections(rawPage: Record<string, unknown>) {
  const explicit = normalizeStringList(rawPage.collections);
  if (explicit.length > 0) {
    return explicit;
  }
  const collection = normalizeString(rawPage.collection);
  return collection ? [collection] : [];
}

function normalizeSummary(rawPage: Record<string, unknown>, fallback: string) {
  const explicit =
    normalizeString(rawPage.summary) ||
    normalizeString(rawPage.description) ||
    normalizeString(rawPage.dek);
  return explicit || fallback;
}

function normalizeUpdatedAtMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPortalScore(page: {
  backlinks?: number | null;
  claims?: number | null;
  evidence?: number | null;
  updatedAtMs: number | null;
  featured: boolean;
}) {
  const freshness =
    page.updatedAtMs == null
      ? 0
      : Math.max(0, 1 - (Date.now() - page.updatedAtMs) / (14 * 24 * 60 * 60 * 1000));
  return (
    (page.featured ? 8 : 0) +
    (page.backlinks ?? 0) * 2 +
    (page.claims ?? 0) * 1.6 +
    (page.evidence ?? 0) * 1.8 +
    freshness
  );
}

function normalizeRelatedFiles(
  value: MemoryWikiPage["relatedFiles"] | null | undefined,
): MemoryWikiRelatedFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const files: MemoryWikiRelatedFile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = normalizeString(record.name);
    if (!name) {
      continue;
    }
    files.push({
      id: normalizeString(record.id) || null,
      name,
      mediaType: normalizeString(record.mediaType) || null,
      updatedAt: normalizeString(record.updatedAt) || null,
      provenanceSummary: normalizeString(record.provenanceSummary) || null,
    });
  }
  return files;
}

function buildLinkLookup(pages: MemoryWikiListPageModel[]) {
  const lookup = new Map<string, MemoryWikiListPageModel>();
  for (const page of pages) {
    const candidates = [
      page.id,
      page.title,
      page.slug ?? "",
      page.path ?? "",
      page.path ? page.path.replace(/^memory\//, "") : "",
      page.path ? page.path.split("/").at(-1)?.replace(/\.md$/i, "") : "",
    ];
    for (const candidate of candidates) {
      const key = normalizeWikiKey(candidate ?? "");
      if (key && !lookup.has(key)) {
        lookup.set(key, page);
      }
    }
  }
  return lookup;
}

export function buildWikiResolvedLinks(
  markdown: string,
  pages: MemoryWikiListPageModel[],
): MemoryWikiResolvedLink[] {
  const lookup = buildLinkLookup(pages);
  const links: MemoryWikiResolvedLink[] = [];
  for (const match of markdown.matchAll(/(?<bang>!?)\[\[([^\]]+)\]\]/g)) {
    if (match.groups?.bang === "!") {
      continue;
    }
    const raw = normalizeString(match[2]);
    if (!raw) {
      continue;
    }
    const [targetPart, labelPart] = raw.split("|", 2);
    const { target, anchor } = splitTargetAnchor(targetPart ?? "");
    const page = lookup.get(normalizeWikiKey(target));
    links.push({
      rawTarget: raw,
      target,
      label: normalizeString(labelPart) || target,
      ...(anchor ? { anchor } : {}),
      ...(page
        ? {
            pageId: page.id,
            title: page.title,
            path: page.path,
          }
        : {}),
      missing: !page,
    });
  }
  return links;
}

function buildHeadings(markdown: string): MemoryWikiHeading[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{2,4})\s+(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      anchor: slugifyHeading(match[2] ?? ""),
      label: normalizeString(match[2]),
      level: match[1]?.length ?? 2,
    }))
    .filter((entry) => entry.label);
}

export function asWikiListPageModel(page: MemoryWikiListPage): MemoryWikiListPageModel {
  const rawPage = page as MemoryWikiListPage & Record<string, unknown>;
  const tags = normalizeTags(rawPage);
  const categories = normalizeCategories(rawPage, tags);
  const collections = normalizeCollections(rawPage);
  const featured = normalizeBoolean(rawPage.featured) || collections.includes("Featured");
  const summary = normalizeSummary(
    rawPage,
    page.excerpt?.trim() || page.path?.trim() || page.title,
  );
  const updatedAtMs = normalizeUpdatedAtMs(page.updatedAt);
  return {
    ...page,
    summary,
    tags,
    categories,
    collections,
    featured,
    updatedAtMs,
    portalScore: buildPortalScore({
      backlinks: page.backlinks,
      claims: page.claims,
      evidence: page.evidence,
      updatedAtMs,
      featured,
    }),
  };
}

export function asWikiPageModel(
  page: MemoryWikiPage,
  pages: MemoryWikiListPageModel[] = [],
): MemoryWikiPageModel {
  const rawPage = page as MemoryWikiPage & Record<string, unknown>;
  const frontmatter = readFrontmatter(page.content ?? "");
  const body = frontmatter.body;
  const tags = normalizeTags(rawPage);
  const categories = uniqueStrings([
    ...normalizeCategories(rawPage, tags),
    ...frontmatter.categories,
  ]);
  const collections = uniqueStrings([...normalizeCollections(rawPage), ...frontmatter.collections]);
  const featured = normalizeBoolean(rawPage.featured) || collections.includes("Featured");
  const lead = extractLead(body);
  return {
    ...page,
    summary: normalizeSummary(
      { ...rawPage, summary: normalizeString(rawPage.summary) || frontmatter.summary },
      summarizeText(lead || body, 220),
    ),
    body,
    lead,
    tags,
    categories,
    collections,
    featured,
    relatedFiles: normalizeRelatedFiles(rawPage.relatedFiles),
    headings: buildHeadings(body),
    links: buildWikiResolvedLinks(body, pages),
  };
}

function groupPagesBy(
  pages: MemoryWikiListPageModel[],
  keysForPage: (page: MemoryWikiListPageModel) => string[],
  kind: MemoryWikiPortalGroup["kind"],
  limit = 6,
) {
  const groups = new Map<string, MemoryWikiListPageModel[]>();
  for (const page of pages) {
    for (const key of keysForPage(page)) {
      const name = normalizeString(key);
      if (!name) {
        continue;
      }
      const entry = groups.get(name) ?? [];
      entry.push(page);
      groups.set(name, entry);
    }
  }
  return Array.from(groups.entries())
    .map(([name, groupedPages]) => ({
      name,
      kind,
      pages: [...groupedPages]
        .toSorted((left, right) => right.portalScore - left.portalScore)
        .slice(0, 4),
    }))
    .toSorted((left, right) => {
      if (right.pages.length !== left.pages.length) {
        return right.pages.length - left.pages.length;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

function buildSyntheticCollections(pages: MemoryWikiListPageModel[]) {
  const collections: MemoryWikiPortalGroup[] = [];
  const recent = [...pages]
    .filter((page) => page.updatedAtMs != null)
    .toSorted((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0))
    .slice(0, 4);
  if (recent.length > 0) {
    collections.push({ name: "Recent updates", kind: "collection", pages: recent });
  }
  const evidence = [...pages]
    .filter((page) => (page.evidence ?? 0) > 0)
    .toSorted((left, right) => (right.evidence ?? 0) - (left.evidence ?? 0))
    .slice(0, 4);
  if (evidence.length > 0) {
    collections.push({ name: "Evidence desk", kind: "collection", pages: evidence });
  }
  const linked = [...pages]
    .filter((page) => (page.backlinks ?? 0) > 0)
    .toSorted((left, right) => (right.backlinks ?? 0) - (left.backlinks ?? 0))
    .slice(0, 4);
  if (linked.length > 0) {
    collections.push({ name: "Well linked", kind: "collection", pages: linked });
  }
  return collections;
}

export function buildWikiPortalModel(list: MemoryWikiListResult | null): MemoryWikiPortalModel {
  const pages = (list?.pages ?? []).map(asWikiListPageModel);
  const featured =
    pages.find((page) => page.featured) ??
    [...pages].toSorted((left, right) => right.portalScore - left.portalScore)[0] ??
    null;
  const explicitCollections = groupPagesBy(pages, (page) => page.collections, "collection");
  const syntheticCollections = buildSyntheticCollections(pages).filter(
    (collection) => !explicitCollections.some((entry) => entry.name === collection.name),
  );
  return {
    pages,
    featured,
    recentUpdates: [...pages]
      .toSorted((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0))
      .slice(0, 6),
    categories: groupPagesBy(pages, (page) => page.categories, "category"),
    collections: [...explicitCollections, ...syntheticCollections].slice(0, 6),
    stats: {
      pages: pages.length,
      backlinks: pages.reduce((sum, page) => sum + (page.backlinks ?? 0), 0),
      claims: pages.reduce((sum, page) => sum + (page.claims ?? 0), 0),
      evidence: pages.reduce((sum, page) => sum + (page.evidence ?? 0), 0),
    },
  };
}

export function findPageModelById(
  list: MemoryWikiListResult | null,
  pageId: string | null | undefined,
) {
  if (!pageId) {
    return null;
  }
  return (list?.pages ?? []).map(asWikiListPageModel).find((page) => page.id === pageId) ?? null;
}

export function buildWikiHistorySummary(history: MemoryWikiHistoryEntry[]) {
  return history.slice(0, 5);
}
