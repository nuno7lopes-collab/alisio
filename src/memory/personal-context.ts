import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveCanonicalAgentIdentitySnapshot,
  type CanonicalAgentIdentitySource,
} from "../agents/identity-canonical.js";
import type { ResolvedAgentIdentity } from "../agents/resolved-identity.js";
import { resolveResolvedAgentIdentity } from "../agents/resolved-identity.js";
import {
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_USER_FILENAME,
  readWorkspaceSetupSummary,
  type WorkspaceSetupSummary,
} from "../agents/workspace.js";
import type { AlisioConfig } from "../config/config.js";
import { listMemoryFiles } from "../plugin-sdk/memory-core-host-runtime-files.js";
import { buildAgentMainSessionKey } from "../routing/session-key.js";
import {
  buildAccountDeviceBinding,
  buildAccountWorkspaceScopeSegments,
  buildAlisioDataResidencyContract,
  type AlisioDataResidencyContract,
  ALISIO_ACCOUNT_SCOPE_ROOT,
  normalizeCanonicalAccountId,
} from "../shared/alisio-account-scope.js";
import {
  MEMORY_BACKLOG_NOTES_DIR,
  MANUAL_MEMORY_NOTES_DIR,
  resolveMemoryNoteRole,
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

export type PersonalContextFileSummary = {
  path: string;
  present: boolean;
  availability: PersonalContextAvailability;
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function countOperationalMemoryFiles(workspaceDir: string): Promise<{
  topicCount: number;
  dailyCount: number;
  backlogCount: number;
}> {
  const counts = {
    topicCount: 0,
    dailyCount: 0,
    backlogCount: 0,
  };
  const files = await listMemoryFiles(workspaceDir);
  for (const absolutePath of files) {
    const relativePath = path.relative(workspaceDir, absolutePath).replace(/\\/g, "/");
    if (relativePath === DEFAULT_MEMORY_FILENAME) {
      continue;
    }
    switch (resolveMemoryNoteRole({ path: relativePath })) {
      case "backlog":
        counts.backlogCount += 1;
        break;
      case "daily":
        counts.dailyCount += 1;
        break;
      case "topic":
        counts.topicCount += 1;
        break;
      default:
        break;
    }
  }
  return counts;
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
  const [
    setup,
    identityPresent,
    soulPresent,
    preferencesPresent,
    mainMemoryPresent,
    operationalCounts,
  ] = await Promise.all([
    readWorkspaceSetupSummary(workspaceDir),
    fileExists(path.join(workspaceDir, DEFAULT_IDENTITY_FILENAME)),
    fileExists(path.join(workspaceDir, DEFAULT_SOUL_FILENAME)),
    fileExists(path.join(workspaceDir, DEFAULT_USER_FILENAME)),
    fileExists(path.join(workspaceDir, DEFAULT_MEMORY_FILENAME)),
    countOperationalMemoryFiles(workspaceDir),
  ]);

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
  const canonicalAccountId = normalizeCanonicalAccountId(params.accountId);
  if (!canonicalAccountId) {
    throw new Error("readPersonalContextSummary requires an authenticated accountId");
  }
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
      present: setup.bootstrapFilePresent,
      availability: "setup_only",
      state: setup.state,
      oneTime: true,
      ...(setup.bootstrapSeededAt ? { seededAt: setup.bootstrapSeededAt } : {}),
      ...(setup.setupCompletedAt ? { completedAt: setup.setupCompletedAt } : {}),
    },
    identity: {
      path: DEFAULT_IDENTITY_FILENAME,
      present: identityPresent,
      availability: "all_sessions",
      resolved: resolvedIdentity,
      sources: identitySnapshot.sources,
    },
    soul: {
      path: DEFAULT_SOUL_FILENAME,
      present: soulPresent,
      availability: "all_sessions",
    },
    preferences: {
      path: DEFAULT_USER_FILENAME,
      present: preferencesPresent,
      availability: "all_sessions",
    },
    memory: {
      main: {
        path: DEFAULT_MEMORY_FILENAME,
        present: mainMemoryPresent,
        availability: "private_direct_sessions",
      },
      operational: {
        root: MANUAL_MEMORY_NOTES_DIR,
        backlogRoot: MEMORY_BACKLOG_NOTES_DIR,
        availability: "retrieval_only",
        ...operationalCounts,
      },
    },
    sessionPolicy: buildSessionPolicy({
      agentId: params.agentId,
      mainKey: params.mainKey,
    }),
  };
}
