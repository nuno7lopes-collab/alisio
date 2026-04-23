export const AGENT_INSTRUCTIONS_FILE_NAME = "AGENTS.md";
export const AGENT_TOOLS_FILE_NAME = "TOOLS.md";
export const AGENT_HEARTBEAT_FILE_NAME = "HEARTBEAT.md";
export const SETUP_BOOTSTRAP_FILE_NAME = "BOOTSTRAP.md";
export const AGENT_IDENTITY_FILE_NAME = "IDENTITY.md";
export const AGENT_SOUL_FILE_NAME = "SOUL.md";
export const USER_PREFERENCES_FILE_NAME = "USER.md";
export const PRIMARY_MEMORY_FILE_NAME = "MEMORY.md";
export const MANUAL_MEMORY_NOTES_DIR = "memory";
export const MEMORY_BACKLOG_NOTES_DIR = `${MANUAL_MEMORY_NOTES_DIR}/backlog`;

export const CANONICAL_MEMORY_NOTE_ROLES = ["main", "topic", "daily", "backlog"] as const;
export type MemoryNoteRole = (typeof CANONICAL_MEMORY_NOTE_ROLES)[number];

export const CANONICAL_MEMORY_FILE_KINDS = [
  "agent_instructions",
  "agent_tools",
  "agent_heartbeat",
  "setup_bootstrap",
  "identity",
  "soul",
  "preferences",
  "main_memory",
  "topic_note",
  "daily_note",
  "backlog_note",
] as const;
export type CanonicalMemoryFileKind = (typeof CANONICAL_MEMORY_FILE_KINDS)[number];

export const CANONICAL_MEMORY_FILE_GROUPS = ["agent", "setup", "identity", "memory"] as const;
export type CanonicalMemoryFileGroup = (typeof CANONICAL_MEMORY_FILE_GROUPS)[number];

export const CANONICAL_MEMORY_FILE_AVAILABILITIES = [
  "setup_only",
  "all_sessions",
  "private_direct_sessions",
  "retrieval_only",
] as const;
export type CanonicalMemoryFileAvailability = (typeof CANONICAL_MEMORY_FILE_AVAILABILITIES)[number];

export const CANONICAL_PERSONAL_CONTEXT_INHERITANCE_VALUES = [
  "identity",
  "soul",
  "preferences",
  "main_memory",
] as const;
export type CanonicalPersonalContextInheritance =
  (typeof CANONICAL_PERSONAL_CONTEXT_INHERITANCE_VALUES)[number];

export const CANONICAL_MEMORY_SESSION_KINDS = [
  "main",
  "direct",
  "group",
  "subagent",
  "cron",
] as const;
export type CanonicalMemorySessionKind = (typeof CANONICAL_MEMORY_SESSION_KINDS)[number];

export const CANONICAL_PERSONAL_CONTEXT_SESSION_ROLE_VALUES = [
  "default_personal_session",
  "private_direct_session",
  "shared_session",
  "delegated_session",
  "automation_session",
] as const;
export type CanonicalPersonalContextSessionRole =
  (typeof CANONICAL_PERSONAL_CONTEXT_SESSION_ROLE_VALUES)[number];

export type CanonicalMemoryKindDescriptor = {
  kind: CanonicalMemoryFileKind;
  group: CanonicalMemoryFileGroup;
  sortRank: number;
  availability: CanonicalMemoryFileAvailability;
  sessionKinds: readonly CanonicalMemorySessionKind[];
  indexed: boolean;
  deletable: boolean;
  path?: string;
  memoryRole?: MemoryNoteRole;
};

const ALL_CANONICAL_MEMORY_SESSION_KINDS = [
  ...CANONICAL_MEMORY_SESSION_KINDS,
] as const satisfies readonly CanonicalMemorySessionKind[];
const PRIVATE_DIRECT_CANONICAL_MEMORY_SESSION_KINDS = [
  "main",
  "direct",
] as const satisfies readonly CanonicalMemorySessionKind[];
const NON_DELEGATED_CANONICAL_MEMORY_SESSION_KINDS = [
  "main",
  "direct",
  "group",
] as const satisfies readonly CanonicalMemorySessionKind[];
const RETRIEVAL_ONLY_CANONICAL_MEMORY_SESSION_KINDS =
  [] as const satisfies readonly CanonicalMemorySessionKind[];

export const CANONICAL_MEMORY_KIND_DESCRIPTORS = [
  {
    kind: "agent_instructions",
    group: "agent",
    sortRank: 10,
    availability: "all_sessions",
    sessionKinds: ALL_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: false,
    deletable: false,
    path: AGENT_INSTRUCTIONS_FILE_NAME,
  },
  {
    kind: "agent_tools",
    group: "agent",
    sortRank: 20,
    availability: "all_sessions",
    sessionKinds: ALL_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: false,
    deletable: false,
    path: AGENT_TOOLS_FILE_NAME,
  },
  {
    kind: "agent_heartbeat",
    group: "agent",
    sortRank: 30,
    availability: "all_sessions",
    sessionKinds: NON_DELEGATED_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: false,
    deletable: false,
    path: AGENT_HEARTBEAT_FILE_NAME,
  },
  {
    kind: "setup_bootstrap",
    group: "setup",
    sortRank: 40,
    availability: "setup_only",
    sessionKinds: PRIVATE_DIRECT_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: false,
    deletable: false,
    path: SETUP_BOOTSTRAP_FILE_NAME,
  },
  {
    kind: "identity",
    group: "identity",
    sortRank: 50,
    availability: "all_sessions",
    sessionKinds: ALL_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: false,
    deletable: false,
    path: AGENT_IDENTITY_FILE_NAME,
  },
  {
    kind: "soul",
    group: "identity",
    sortRank: 60,
    availability: "all_sessions",
    sessionKinds: ALL_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: false,
    deletable: false,
    path: AGENT_SOUL_FILE_NAME,
  },
  {
    kind: "preferences",
    group: "identity",
    sortRank: 70,
    availability: "all_sessions",
    sessionKinds: ALL_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: false,
    deletable: false,
    path: USER_PREFERENCES_FILE_NAME,
  },
  {
    kind: "main_memory",
    group: "memory",
    sortRank: 80,
    availability: "private_direct_sessions",
    sessionKinds: PRIVATE_DIRECT_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: true,
    deletable: false,
    path: PRIMARY_MEMORY_FILE_NAME,
    memoryRole: "main",
  },
  {
    kind: "topic_note",
    group: "memory",
    sortRank: 90,
    availability: "retrieval_only",
    sessionKinds: RETRIEVAL_ONLY_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: true,
    deletable: true,
    memoryRole: "topic",
  },
  {
    kind: "daily_note",
    group: "memory",
    sortRank: 100,
    availability: "retrieval_only",
    sessionKinds: RETRIEVAL_ONLY_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: true,
    deletable: true,
    memoryRole: "daily",
  },
  {
    kind: "backlog_note",
    group: "memory",
    sortRank: 110,
    availability: "retrieval_only",
    sessionKinds: RETRIEVAL_ONLY_CANONICAL_MEMORY_SESSION_KINDS,
    indexed: true,
    deletable: true,
    memoryRole: "backlog",
  },
] as const satisfies readonly CanonicalMemoryKindDescriptor[];

function isRootMemoryKindDescriptor(
  descriptor: CanonicalMemoryKindDescriptor,
): descriptor is CanonicalMemoryKindDescriptor & { path: string } {
  return typeof descriptor.path === "string" && descriptor.path.length > 0;
}

const MEMORY_KIND_DESCRIPTOR_BY_KIND = new Map<
  CanonicalMemoryFileKind,
  CanonicalMemoryKindDescriptor
>(CANONICAL_MEMORY_KIND_DESCRIPTORS.map((descriptor) => [descriptor.kind, descriptor]));

const ROOT_CANONICAL_MEMORY_KIND_DESCRIPTORS = CANONICAL_MEMORY_KIND_DESCRIPTORS.filter(
  isRootMemoryKindDescriptor,
) as Array<CanonicalMemoryKindDescriptor & { path: string }>;

const ROOT_FILE_KIND_BY_NAME = Object.fromEntries(
  ROOT_CANONICAL_MEMORY_KIND_DESCRIPTORS.map((descriptor) => [descriptor.path, descriptor.kind]),
) as Record<string, CanonicalMemoryFileKind>;

const MEMORY_NOTE_KIND_BY_ROLE: Record<MemoryNoteRole, CanonicalMemoryFileKind> = {
  main: "main_memory",
  topic: "topic_note",
  daily: "daily_note",
  backlog: "backlog_note",
};

export const CANONICAL_ROOT_MEMORY_FILE_NAMES = ROOT_CANONICAL_MEMORY_KIND_DESCRIPTORS.map(
  (descriptor) => descriptor.path,
);

export const CANONICAL_INDEXED_MEMORY_FILE_KINDS = CANONICAL_MEMORY_KIND_DESCRIPTORS.filter(
  (descriptor) => descriptor.indexed,
).map((descriptor) => descriptor.kind);

export const CANONICAL_NON_INDEXED_MEMORY_FILE_KINDS = CANONICAL_MEMORY_KIND_DESCRIPTORS.filter(
  (descriptor) => !descriptor.indexed,
).map((descriptor) => descriptor.kind);

export const CANONICAL_OPERATIONAL_MEMORY_FILE_KINDS = CANONICAL_MEMORY_KIND_DESCRIPTORS.filter(
  (descriptor) => descriptor.deletable,
).map((descriptor) => descriptor.kind);

const DAILY_MEMORY_NOTE_RE = /(^|\/)\d{4}-\d{2}-\d{2}\.md$/i;

function normalizeTaxonomyEntry(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeTaxonomyList(value: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = new Set<string>();
  for (const entry of value) {
    const cleaned = normalizeTaxonomyEntry(entry);
    if (cleaned) {
      normalized.add(cleaned);
    }
  }
  return Array.from(normalized);
}

function normalizeDateStamp(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function normalizeMemoryFileName(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

export function isLongTermMemoryFileName(name: string): boolean {
  return normalizeMemoryFileName(name) === PRIMARY_MEMORY_FILE_NAME;
}

export function isMemoryNoteFileName(name: string): boolean {
  const normalized = normalizeMemoryFileName(name);
  return (
    normalized.startsWith(`${MANUAL_MEMORY_NOTES_DIR}/`) && normalized.toLowerCase().endsWith(".md")
  );
}

export function isDailyMemoryNoteFileName(name: string): boolean {
  return DAILY_MEMORY_NOTE_RE.test(normalizeMemoryFileName(name));
}

export function normalizeMemoryNoteRole(value: unknown): MemoryNoteRole | null {
  const normalized = normalizeTaxonomyEntry(value);
  if (CANONICAL_MEMORY_NOTE_ROLES.includes(normalized as MemoryNoteRole)) {
    return normalized as MemoryNoteRole;
  }
  return null;
}

export function getCanonicalMemoryKindDescriptor(
  kind: CanonicalMemoryFileKind,
): CanonicalMemoryKindDescriptor {
  const descriptor = MEMORY_KIND_DESCRIPTOR_BY_KIND.get(kind);
  if (!descriptor) {
    throw new Error(`missing canonical memory descriptor for ${kind}`);
  }
  return descriptor;
}

export function resolveCanonicalMemoryFileKind(name: string): CanonicalMemoryFileKind | null {
  const normalized = normalizeMemoryFileName(name);
  const rootKind = ROOT_FILE_KIND_BY_NAME[normalized];
  if (rootKind) {
    return rootKind;
  }
  if (!isMemoryNoteFileName(normalized)) {
    return null;
  }
  const noteRole = resolveMemoryNoteRole({ path: normalized });
  return MEMORY_NOTE_KIND_BY_ROLE[noteRole];
}

export function isCanonicalMemoryFileName(name: string): boolean {
  return resolveCanonicalMemoryFileKind(name) !== null;
}

export function getCanonicalMemoryFileGroup(
  kind: CanonicalMemoryFileKind,
): CanonicalMemoryFileGroup {
  return getCanonicalMemoryKindDescriptor(kind).group;
}

export function getCanonicalMemoryFileAvailability(
  kind: CanonicalMemoryFileKind,
): CanonicalMemoryFileAvailability {
  return getCanonicalMemoryKindDescriptor(kind).availability;
}

export function getCanonicalMemoryFileSessionKinds(
  kind: CanonicalMemoryFileKind,
): CanonicalMemorySessionKind[] {
  return [...getCanonicalMemoryKindDescriptor(kind).sessionKinds];
}

export function listCanonicalRootMemoryFileNames(params?: {
  sessionKind?: CanonicalMemorySessionKind;
}): string[] {
  return ROOT_CANONICAL_MEMORY_KIND_DESCRIPTORS.filter(
    (descriptor) => !params?.sessionKind || descriptor.sessionKinds.includes(params.sessionKind),
  ).map((descriptor) => descriptor.path);
}

export function isCanonicalOperationalMemoryKind(kind: CanonicalMemoryFileKind): boolean {
  return getCanonicalMemoryKindDescriptor(kind).deletable;
}

export function isCanonicalIndexedMemoryKind(kind: CanonicalMemoryFileKind): boolean {
  return getCanonicalMemoryKindDescriptor(kind).indexed;
}

export function getCanonicalMemoryFileSortRank(kind: CanonicalMemoryFileKind): number {
  return getCanonicalMemoryKindDescriptor(kind).sortRank;
}

export function resolveCanonicalMemoryFileMemoryRole(
  kind: CanonicalMemoryFileKind,
): MemoryNoteRole | undefined {
  return getCanonicalMemoryKindDescriptor(kind).memoryRole;
}

export function compareCanonicalMemoryFileOrder(
  left: { path: string; kind?: CanonicalMemoryFileKind | null; updatedAtMs?: number },
  right: { path: string; kind?: CanonicalMemoryFileKind | null; updatedAtMs?: number },
): number {
  const leftKind = left.kind ?? resolveCanonicalMemoryFileKind(left.path);
  const rightKind = right.kind ?? resolveCanonicalMemoryFileKind(right.path);
  if (leftKind && rightKind) {
    const rankDiff =
      getCanonicalMemoryFileSortRank(leftKind) - getCanonicalMemoryFileSortRank(rightKind);
    if (rankDiff !== 0) {
      return rankDiff;
    }
  } else if (leftKind || rightKind) {
    return leftKind ? -1 : 1;
  }
  const updatedDiff = (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }
  return normalizeMemoryFileName(left.path).localeCompare(normalizeMemoryFileName(right.path));
}

export function slugifyMemoryNotePathComponent(value: string, fallback = "note"): string {
  const normalized = value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function buildCanonicalMemoryNotePath(params: {
  role: MemoryNoteRole;
  title?: string | null;
  slug?: string | null;
  dateStamp?: string | null;
}): string {
  const slugSource = params.slug?.trim() || params.title?.trim() || "note";
  const slug = slugifyMemoryNotePathComponent(slugSource);
  const dateStamp = normalizeDateStamp(params.dateStamp) ?? normalizeDateStamp(params.title);
  switch (params.role) {
    case "main":
      return PRIMARY_MEMORY_FILE_NAME;
    case "daily":
      return `${MANUAL_MEMORY_NOTES_DIR}/${dateStamp ?? slug}.md`;
    case "backlog":
      return dateStamp
        ? `${MEMORY_BACKLOG_NOTES_DIR}/${dateStamp}/${slug}.md`
        : `${MEMORY_BACKLOG_NOTES_DIR}/${slug}.md`;
    case "topic":
    default:
      return `${MANUAL_MEMORY_NOTES_DIR}/${slug}.md`;
  }
}

export function resolveMemoryNoteRole(params: {
  path?: string | null;
  memoryRole?: unknown;
  tags?: readonly unknown[] | null;
  collections?: readonly unknown[] | null;
}): MemoryNoteRole {
  const explicitRole = normalizeMemoryNoteRole(params.memoryRole);
  if (explicitRole) {
    return explicitRole;
  }
  const normalizedPath = normalizeMemoryFileName(params.path ?? "").toLowerCase();
  if (normalizedPath === PRIMARY_MEMORY_FILE_NAME.toLowerCase()) {
    return "main";
  }
  const tags = normalizeTaxonomyList(params.tags);
  const collections = normalizeTaxonomyList(params.collections);
  if (
    normalizedPath.startsWith(`${MEMORY_BACKLOG_NOTES_DIR}/`) ||
    normalizedPath.startsWith("backlog/") ||
    tags.includes("backlog") ||
    collections.includes("backlog")
  ) {
    return "backlog";
  }
  if (
    isDailyMemoryNoteFileName(normalizedPath) ||
    tags.includes("daily") ||
    collections.includes("daily")
  ) {
    return "daily";
  }
  return "topic";
}
