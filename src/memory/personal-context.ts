import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveCanonicalAgentIdentitySnapshot,
  type CanonicalAgentIdentitySource,
} from "../agents/identity-canonical.js";
import type { ResolvedAgentIdentity } from "../agents/resolved-identity.js";
import { resolveResolvedAgentIdentity } from "../agents/resolved-identity.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  readWorkspaceSetupSummary,
  type WorkspaceSetupSummary,
} from "../agents/workspace.js";
import type { AlisioConfig } from "../config/config.js";
import { listMemoryFiles } from "../plugin-sdk/memory-core-host-runtime-files.js";
import { getActiveMemorySearchManager } from "../plugins/memory-runtime.js";
import { buildAgentMainSessionKey } from "../routing/session-key.js";
import {
  buildAccountDeviceBinding,
  buildAccountWorkspaceScopeSegments,
  buildAlisioDataResidencyContract,
  type AlisioDataResidencyContract,
  ALISIO_ACCOUNT_SCOPE_ROOT,
  isAccountScopedWorkspaceDir,
  normalizeCanonicalAccountId,
} from "../shared/alisio-account-scope.js";
import {
  type CanonicalMemoryFileGroup,
  type CanonicalMemoryFileKind,
  getCanonicalMemoryFileGroup,
  getCanonicalMemoryFileSortRank,
  isCanonicalOperationalMemoryKind,
  MEMORY_BACKLOG_NOTES_DIR,
  MANUAL_MEMORY_NOTES_DIR,
  type MemoryNoteRole,
  normalizeMemoryFileName,
  resolveCanonicalMemoryFileKind,
} from "../shared/memory-file-paths.js";

export const PERSONAL_CONTEXT_CONTRACT_VERSION = 1 as const;

export type PersonalContextAvailability =
  | "setup_only"
  | "all_sessions"
  | "private_direct_sessions"
  | "retrieval_only";

export type PersonalContextInheritance = "identity" | "soul" | "preferences" | "main_memory";

export type PersonalContextSessionKind = "main" | "direct" | "group" | "subagent" | "cron";

export type PersonalContextIdentitySource = CanonicalAgentIdentitySource;

export type PersonalContextIdentitySources = {
  name?: PersonalContextIdentitySource;
  avatar?: PersonalContextIdentitySource;
  emoji?: PersonalContextIdentitySource;
  theme?: PersonalContextIdentitySource;
};

export type PersonalContextFileKind = CanonicalMemoryFileKind;
export type PersonalContextFileGroup = CanonicalMemoryFileGroup;

export type PersonalContextFileSummary = {
  path: string;
  present: boolean;
  availability: PersonalContextAvailability;
};

export type PersonalContextDocument = PersonalContextFileSummary & {
  kind: PersonalContextFileKind;
  group: PersonalContextFileGroup;
  accountScoped: true;
  injected: boolean;
  indexed: boolean;
  writable: boolean;
  deletable: boolean;
  sessionKinds: PersonalContextSessionKind[];
  memoryRole?: MemoryNoteRole;
  size?: number;
  updatedAtMs?: number;
};

export type PersonalContextDocumentCounts = {
  expectedCount: number;
  presentCount: number;
  agentFileCount: number;
  identityFileCount: number;
  setupFileCount: number;
  memoryFileCount: number;
  mainMemoryCount: number;
  topicNoteCount: number;
  dailyNoteCount: number;
  backlogNoteCount: number;
};

export type PersonalContextReadContract = {
  method: "agents.files.get";
  locator: "workspace_relative_path";
  pathParam: "name";
  accountScopeRequired: true;
  readableKinds: PersonalContextFileKind[];
};

export type PersonalContextSearchContract = {
  runtime: "memory_index";
  searchTool: "memory_search";
  readTool: "memory_get";
  accountScopeRequired: true;
  indexedKinds: PersonalContextFileKind[];
  excludedKinds: PersonalContextFileKind[];
};

export type PersonalContextDocumentReadResult = {
  document: PersonalContextDocument;
  content: string;
  missing: boolean;
  fromLine: number;
  toLine: number;
};

export type PersonalContextDocumentSearchResult = {
  document: PersonalContextDocument;
  score: number;
  excerpt: string;
  startLine: number;
  endLine: number;
};

export type PersonalContextSessionPolicy = {
  kind: PersonalContextSessionKind;
  role:
    | "default_personal_session"
    | "private_direct_session"
    | "shared_session"
    | "delegated_session"
    | "automation_session";
  inherits: PersonalContextInheritance[];
  key?: string;
};

export type PersonalContextAccountScope = {
  scopeRoot: typeof ALISIO_ACCOUNT_SCOPE_ROOT;
  accountId: string;
  source: "account_id";
  authenticated: true;
  authRequired: true;
  workspaceMode: "account_scoped";
  workspaceRoot: string;
};

export type PersonalContextDeviceBinding = {
  binding: "account_bound";
  runtime: "local";
  current: true;
  accountId: string;
  deviceId?: string;
  label?: string;
  platform?: string;
};

export type PersonalContextSummary = {
  version: typeof PERSONAL_CONTEXT_CONTRACT_VERSION;
  accountScope: PersonalContextAccountScope;
  runtimeContract: AlisioDataResidencyContract;
  deviceBinding: PersonalContextDeviceBinding;
  bootstrap: PersonalContextFileSummary & {
    state: WorkspaceSetupSummary["state"];
    oneTime: true;
    seededAt?: string;
    completedAt?: string;
  };
  identity: PersonalContextFileSummary & {
    resolved: ResolvedAgentIdentity;
    sources: PersonalContextIdentitySources;
  };
  soul: PersonalContextFileSummary;
  preferences: PersonalContextFileSummary;
  memory: {
    main: PersonalContextFileSummary;
    operational: {
      root: typeof MANUAL_MEMORY_NOTES_DIR;
      backlogRoot: typeof MEMORY_BACKLOG_NOTES_DIR;
      availability: "retrieval_only";
      topicCount: number;
      dailyCount: number;
      backlogCount: number;
    };
  };
  documents: PersonalContextDocument[];
  documentCounts: PersonalContextDocumentCounts;
  access: {
    read: PersonalContextReadContract;
    search: PersonalContextSearchContract;
  };
  sessionPolicy: {
    main: PersonalContextSessionPolicy;
    direct: PersonalContextSessionPolicy;
    group: PersonalContextSessionPolicy;
    subagent: PersonalContextSessionPolicy;
    cron: PersonalContextSessionPolicy;
  };
};

function resolveWorkspaceRootLabel(accountId: string): string {
  return buildAccountWorkspaceScopeSegments(accountId).join("/");
}

type FileStatSummary = {
  size: number;
  updatedAtMs: number;
};

const ALL_SESSION_KINDS: PersonalContextSessionKind[] = [
  "main",
  "direct",
  "group",
  "subagent",
  "cron",
];
const PRIVATE_DIRECT_SESSION_KINDS: PersonalContextSessionKind[] = ["main", "direct"];
const NON_DELEGATED_SESSION_KINDS: PersonalContextSessionKind[] = ["main", "direct", "group"];
const RETRIEVAL_ONLY_SESSION_KINDS: PersonalContextSessionKind[] = [];

const INDEXED_MEMORY_KINDS: PersonalContextFileKind[] = [
  "main_memory",
  "topic_note",
  "daily_note",
  "backlog_note",
];
const NON_INDEXED_MEMORY_KINDS: PersonalContextFileKind[] = [
  "agent_instructions",
  "agent_tools",
  "agent_heartbeat",
  "setup_bootstrap",
  "identity",
  "soul",
  "preferences",
];

const ROOT_DOCUMENT_SPECS: Array<{
  kind: PersonalContextFileKind;
  path: string;
  availability: PersonalContextAvailability;
  sessionKinds: PersonalContextSessionKind[];
}> = [
  {
    kind: "agent_instructions",
    path: DEFAULT_AGENTS_FILENAME,
    availability: "all_sessions",
    sessionKinds: ALL_SESSION_KINDS,
  },
  {
    kind: "agent_tools",
    path: DEFAULT_TOOLS_FILENAME,
    availability: "all_sessions",
    sessionKinds: ALL_SESSION_KINDS,
  },
  {
    kind: "agent_heartbeat",
    path: DEFAULT_HEARTBEAT_FILENAME,
    availability: "all_sessions",
    sessionKinds: NON_DELEGATED_SESSION_KINDS,
  },
  {
    kind: "setup_bootstrap",
    path: DEFAULT_BOOTSTRAP_FILENAME,
    availability: "setup_only",
    sessionKinds: PRIVATE_DIRECT_SESSION_KINDS,
  },
  {
    kind: "identity",
    path: DEFAULT_IDENTITY_FILENAME,
    availability: "all_sessions",
    sessionKinds: ALL_SESSION_KINDS,
  },
  {
    kind: "soul",
    path: DEFAULT_SOUL_FILENAME,
    availability: "all_sessions",
    sessionKinds: ALL_SESSION_KINDS,
  },
  {
    kind: "preferences",
    path: DEFAULT_USER_FILENAME,
    availability: "all_sessions",
    sessionKinds: ALL_SESSION_KINDS,
  },
  {
    kind: "main_memory",
    path: DEFAULT_MEMORY_FILENAME,
    availability: "private_direct_sessions",
    sessionKinds: PRIVATE_DIRECT_SESSION_KINDS,
  },
];

async function statRegularFile(filePath: string): Promise<FileStatSummary | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return null;
    }
    return {
      size: stat.size,
      updatedAtMs: Math.floor(stat.mtimeMs),
    };
  } catch {
    return null;
  }
}

function memoryRoleForKind(kind: PersonalContextFileKind): MemoryNoteRole | undefined {
  switch (kind) {
    case "main_memory":
      return "main";
    case "topic_note":
      return "topic";
    case "daily_note":
      return "daily";
    case "backlog_note":
      return "backlog";
    default:
      return undefined;
  }
}

function buildDocument(params: {
  kind: PersonalContextFileKind;
  relativePath: string;
  present: boolean;
  availability: PersonalContextAvailability;
  sessionKinds: PersonalContextSessionKind[];
  stat?: FileStatSummary | null;
}): PersonalContextDocument {
  const memoryRole = memoryRoleForKind(params.kind);
  const indexed = INDEXED_MEMORY_KINDS.includes(params.kind);
  return {
    kind: params.kind,
    group: getCanonicalMemoryFileGroup(params.kind),
    path: params.relativePath,
    present: params.present,
    availability: params.availability,
    accountScoped: true,
    injected: params.sessionKinds.length > 0,
    indexed,
    writable: true,
    deletable: isCanonicalOperationalMemoryKind(params.kind),
    sessionKinds: [...params.sessionKinds],
    ...(memoryRole ? { memoryRole } : {}),
    ...(params.stat ? { size: params.stat.size, updatedAtMs: params.stat.updatedAtMs } : {}),
  };
}

function sortDocuments(documents: PersonalContextDocument[]): PersonalContextDocument[] {
  return [...documents].toSorted((left, right) => {
    const rankDiff =
      getCanonicalMemoryFileSortRank(left.kind) - getCanonicalMemoryFileSortRank(right.kind);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    const updatedDiff = (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return left.path.localeCompare(right.path);
  });
}

function countDocuments(documents: PersonalContextDocument[]): PersonalContextDocumentCounts {
  const counts: PersonalContextDocumentCounts = {
    expectedCount: documents.length,
    presentCount: 0,
    agentFileCount: 0,
    identityFileCount: 0,
    setupFileCount: 0,
    memoryFileCount: 0,
    mainMemoryCount: 0,
    topicNoteCount: 0,
    dailyNoteCount: 0,
    backlogNoteCount: 0,
  };
  for (const document of documents) {
    if (!document.present) {
      continue;
    }
    counts.presentCount += 1;
    switch (document.group) {
      case "agent":
        counts.agentFileCount += 1;
        break;
      case "identity":
        counts.identityFileCount += 1;
        break;
      case "setup":
        counts.setupFileCount += 1;
        break;
      case "memory":
        counts.memoryFileCount += 1;
        break;
    }
    switch (document.kind) {
      case "main_memory":
        counts.mainMemoryCount += 1;
        break;
      case "topic_note":
        counts.topicNoteCount += 1;
        break;
      case "daily_note":
        counts.dailyNoteCount += 1;
        break;
      case "backlog_note":
        counts.backlogNoteCount += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

async function buildRootDocuments(workspaceDir: string): Promise<PersonalContextDocument[]> {
  return await Promise.all(
    ROOT_DOCUMENT_SPECS.map(async (spec) => {
      const filePath = path.join(workspaceDir, spec.path);
      const stat = await statRegularFile(filePath);
      return buildDocument({
        kind: spec.kind,
        relativePath: spec.path,
        present: stat !== null,
        availability: spec.availability,
        sessionKinds: spec.sessionKinds,
        stat,
      });
    }),
  );
}

async function buildOperationalMemoryDocuments(
  workspaceDir: string,
): Promise<PersonalContextDocument[]> {
  const documents: PersonalContextDocument[] = [];
  const files = await listMemoryFiles(workspaceDir);
  for (const absolutePath of files) {
    const relativePath = path.relative(workspaceDir, absolutePath).replace(/\\/g, "/");
    if (relativePath === DEFAULT_MEMORY_FILENAME) {
      continue;
    }
    const kind = resolveCanonicalMemoryFileKind(relativePath);
    if (!kind || !isCanonicalOperationalMemoryKind(kind)) {
      continue;
    }
    const stat = await statRegularFile(absolutePath);
    documents.push(
      buildDocument({
        kind,
        relativePath,
        present: stat !== null,
        availability: "retrieval_only",
        sessionKinds: RETRIEVAL_ONLY_SESSION_KINDS,
        stat,
      }),
    );
  }
  return documents;
}

function requireDocument(
  documentsByKind: Map<PersonalContextFileKind, PersonalContextDocument>,
  kind: PersonalContextFileKind,
): PersonalContextDocument {
  const document = documentsByKind.get(kind);
  if (!document) {
    throw new Error(`missing personal context document descriptor for ${kind}`);
  }
  return document;
}

function normalizeRequiredAccountId(accountId: string): string {
  const canonicalAccountId = normalizeCanonicalAccountId(accountId);
  if (!canonicalAccountId) {
    throw new Error("personal context requires an authenticated accountId");
  }
  return canonicalAccountId;
}

function requireAccountScopedWorkspaceDir(params: {
  workspaceDir: string;
  accountId: string;
}): string {
  const canonicalAccountId = normalizeRequiredAccountId(params.accountId);
  if (!isAccountScopedWorkspaceDir(params.workspaceDir, canonicalAccountId)) {
    throw new Error(`personal context workspace must be account-scoped for ${canonicalAccountId}`);
  }
  return canonicalAccountId;
}

function buildReadContract(): PersonalContextReadContract {
  return {
    method: "agents.files.get",
    locator: "workspace_relative_path",
    pathParam: "name",
    accountScopeRequired: true,
    readableKinds: [...INDEXED_MEMORY_KINDS, ...NON_INDEXED_MEMORY_KINDS],
  };
}

function buildSearchContract(): PersonalContextSearchContract {
  return {
    runtime: "memory_index",
    searchTool: "memory_search",
    readTool: "memory_get",
    accountScopeRequired: true,
    indexedKinds: [...INDEXED_MEMORY_KINDS],
    excludedKinds: [...NON_INDEXED_MEMORY_KINDS],
  };
}

export async function listPersonalContextDocuments(params: {
  workspaceDir: string;
  accountId: string;
}): Promise<PersonalContextDocument[]> {
  requireAccountScopedWorkspaceDir(params);
  const [rootDocuments, operationalDocuments] = await Promise.all([
    buildRootDocuments(params.workspaceDir),
    buildOperationalMemoryDocuments(params.workspaceDir),
  ]);
  return sortDocuments([...rootDocuments, ...operationalDocuments]);
}

function resolveCanonicalDocumentPath(params: { workspaceDir: string; relativePath: string }): {
  relativePath: string;
  absolutePath: string;
} {
  const relativePath = normalizeMemoryFileName(params.relativePath);
  if (!resolveCanonicalMemoryFileKind(relativePath)) {
    throw new Error(`unsupported personal context file "${relativePath}"`);
  }
  const workspaceRoot = path.resolve(params.workspaceDir);
  const absolutePath = path.resolve(workspaceRoot, relativePath);
  const relativeToRoot = path.relative(workspaceRoot, absolutePath);
  if (!relativeToRoot || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`unsupported personal context file "${relativePath}"`);
  }
  return {
    relativePath: relativeToRoot.replace(/\\/g, "/"),
    absolutePath,
  };
}

function sliceContentLines(params: { content: string; from?: number; lines?: number }): {
  content: string;
  fromLine: number;
  toLine: number;
} {
  const fileLines = params.content.split("\n");
  const fromLine = Math.max(1, params.from ?? 1);
  const lineCount = Math.max(1, params.lines ?? fileLines.length);
  const selected = fileLines.slice(fromLine - 1, fromLine - 1 + lineCount);
  return {
    content: selected.join("\n"),
    fromLine,
    toLine: fromLine + Math.max(0, selected.length - 1),
  };
}

export async function readPersonalContextDocument(params: {
  workspaceDir: string;
  accountId: string;
  path: string;
  from?: number;
  lines?: number;
}): Promise<PersonalContextDocumentReadResult> {
  requireAccountScopedWorkspaceDir({
    workspaceDir: params.workspaceDir,
    accountId: params.accountId,
  });
  const resolved = resolveCanonicalDocumentPath({
    workspaceDir: params.workspaceDir,
    relativePath: params.path,
  });
  const documents = await listPersonalContextDocuments({
    workspaceDir: params.workspaceDir,
    accountId: params.accountId,
  });
  const document = documents.find((entry) => entry.path === resolved.relativePath);
  if (!document) {
    throw new Error(`personal context document is not indexed: ${resolved.relativePath}`);
  }
  if (!document.present) {
    return {
      document,
      content: "",
      missing: true,
      fromLine: 1,
      toLine: 1,
    };
  }
  const content = await fs.readFile(resolved.absolutePath, "utf-8");
  const sliced = sliceContentLines({
    content,
    from: params.from,
    lines: params.lines,
  });
  return {
    document,
    content: sliced.content,
    missing: false,
    fromLine: sliced.fromLine,
    toLine: sliced.toLine,
  };
}

export async function searchPersonalContextDocuments(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  accountId: string;
  query: string;
  limit?: number;
  minScore?: number;
}): Promise<PersonalContextDocumentSearchResult[]> {
  requireAccountScopedWorkspaceDir({
    workspaceDir: params.workspaceDir,
    accountId: params.accountId,
  });
  const query = params.query.trim();
  if (!query) {
    return [];
  }
  const documents = await listPersonalContextDocuments({
    workspaceDir: params.workspaceDir,
    accountId: params.accountId,
  });
  const indexedDocumentsByPath = new Map(
    documents
      .filter((document) => document.present && document.indexed)
      .map((document) => [document.path, document] as const),
  );
  const { manager, error } = await getActiveMemorySearchManager({
    cfg: params.cfg,
    agentId: params.agentId,
    purpose: "default",
  });
  if (!manager) {
    throw new Error(`personal context search unavailable: ${error ?? "no manager"}`);
  }
  try {
    const results = await manager.search(query, {
      maxResults: Math.max(1, params.limit ?? 20),
      minScore: params.minScore,
    });
    return results
      .map((result) => {
        if (result.source !== "memory") {
          return null;
        }
        const document = indexedDocumentsByPath.get(result.path);
        if (!document) {
          return null;
        }
        return {
          document,
          score: result.score,
          excerpt: result.snippet,
          startLine: result.startLine,
          endLine: result.endLine,
        } satisfies PersonalContextDocumentSearchResult;
      })
      .filter((result): result is PersonalContextDocumentSearchResult => result !== null);
  } finally {
    await manager.close?.().catch(() => {});
  }
}

function buildSessionPolicy(params: {
  agentId: string;
  mainKey?: string;
}): PersonalContextSummary["sessionPolicy"] {
  const directInheritance: PersonalContextInheritance[] = [
    "identity",
    "soul",
    "preferences",
    "main_memory",
  ];
  const nonPrivateInheritance: PersonalContextInheritance[] = ["identity", "soul", "preferences"];
  return {
    main: {
      kind: "main",
      role: "default_personal_session",
      key: buildAgentMainSessionKey({ agentId: params.agentId, mainKey: params.mainKey }),
      inherits: [...directInheritance],
    },
    direct: {
      kind: "direct",
      role: "private_direct_session",
      inherits: [...directInheritance],
    },
    group: {
      kind: "group",
      role: "shared_session",
      inherits: [...nonPrivateInheritance],
    },
    subagent: {
      kind: "subagent",
      role: "delegated_session",
      inherits: [...nonPrivateInheritance],
    },
    cron: {
      kind: "cron",
      role: "automation_session",
      inherits: [...nonPrivateInheritance],
    },
  };
}

export async function readPersonalContextSummary(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir: string;
  mainKey?: string;
  accountId: string;
  deviceId?: string;
  deviceLabel?: string;
  devicePlatform?: string;
  resolvedIdentity?: ResolvedAgentIdentity;
}): Promise<PersonalContextSummary> {
  const workspaceDir = params.workspaceDir;
  const canonicalAccountId = requireAccountScopedWorkspaceDir({
    workspaceDir,
    accountId: params.accountId,
  });
  const [setup, documents] = await Promise.all([
    readWorkspaceSetupSummary(workspaceDir),
    listPersonalContextDocuments({
      workspaceDir,
      accountId: canonicalAccountId,
    }),
  ]);
  const documentCounts = countDocuments(documents);
  const documentsByKind = new Map<PersonalContextFileKind, PersonalContextDocument>();
  for (const document of documents) {
    if (!documentsByKind.has(document.kind)) {
      documentsByKind.set(document.kind, document);
    }
  }
  const bootstrapDocument = requireDocument(documentsByKind, "setup_bootstrap");
  const identityDocument = requireDocument(documentsByKind, "identity");
  const soulDocument = requireDocument(documentsByKind, "soul");
  const preferencesDocument = requireDocument(documentsByKind, "preferences");
  const mainMemoryDocument = requireDocument(documentsByKind, "main_memory");

  const resolvedIdentity =
    params.resolvedIdentity ??
    resolveResolvedAgentIdentity({
      cfg: params.cfg,
      agentId: params.agentId,
      workspaceDir,
    });
  const identitySnapshot = resolveCanonicalAgentIdentitySnapshot({
    cfg: params.cfg,
    agentId: params.agentId,
    workspaceDir,
  });
  const deviceBinding: PersonalContextDeviceBinding = {
    ...buildAccountDeviceBinding({
      authenticated: true,
      accountId: canonicalAccountId,
      deviceId: params.deviceId,
      label: params.deviceLabel,
      platform: params.devicePlatform,
    }),
    binding: "account_bound",
    current: true,
    accountId: canonicalAccountId,
  };

  return {
    version: PERSONAL_CONTEXT_CONTRACT_VERSION,
    accountScope: {
      scopeRoot: ALISIO_ACCOUNT_SCOPE_ROOT,
      accountId: canonicalAccountId,
      source: "account_id",
      authenticated: true,
      authRequired: true,
      workspaceMode: "account_scoped",
      workspaceRoot: resolveWorkspaceRootLabel(canonicalAccountId),
    },
    runtimeContract: buildAlisioDataResidencyContract(),
    deviceBinding,
    bootstrap: {
      path: DEFAULT_BOOTSTRAP_FILENAME,
      present: setup.bootstrapFilePresent && bootstrapDocument.present,
      availability: "setup_only",
      state: setup.state,
      oneTime: true,
      ...(setup.bootstrapSeededAt ? { seededAt: setup.bootstrapSeededAt } : {}),
      ...(setup.setupCompletedAt ? { completedAt: setup.setupCompletedAt } : {}),
    },
    identity: {
      path: DEFAULT_IDENTITY_FILENAME,
      present: identityDocument.present,
      availability: "all_sessions",
      resolved: resolvedIdentity,
      sources: identitySnapshot.sources,
    },
    soul: {
      path: DEFAULT_SOUL_FILENAME,
      present: soulDocument.present,
      availability: "all_sessions",
    },
    preferences: {
      path: DEFAULT_USER_FILENAME,
      present: preferencesDocument.present,
      availability: "all_sessions",
    },
    memory: {
      main: {
        path: DEFAULT_MEMORY_FILENAME,
        present: mainMemoryDocument.present,
        availability: "private_direct_sessions",
      },
      operational: {
        root: MANUAL_MEMORY_NOTES_DIR,
        backlogRoot: MEMORY_BACKLOG_NOTES_DIR,
        availability: "retrieval_only",
        topicCount: documentCounts.topicNoteCount,
        dailyCount: documentCounts.dailyNoteCount,
        backlogCount: documentCounts.backlogNoteCount,
      },
    },
    documents,
    documentCounts,
    access: {
      read: buildReadContract(),
      search: buildSearchContract(),
    },
    sessionPolicy: buildSessionPolicy({
      agentId: params.agentId,
      mainKey: params.mainKey,
    }),
  };
}
