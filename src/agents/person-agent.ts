import type {
  AgentConfig,
  AgentToolsConfig,
  MemorySearchConfig,
  AlisioConfig,
  PersonAgentConfig,
  PersonArtifactType,
  PersonMemoryScope,
  PersonTaskIntent,
  PersonWorkspaceSummary,
} from "../config/config.js";
import {
  PERSON_ARTIFACT_TYPES,
  PERSON_MEMORY_SCOPES,
  PERSON_TASK_INTENTS,
} from "../config/types.person.js";
import { buildAuthHealthSummary, type AuthProfileHealthStatus } from "./auth-health.js";
import { loadAuthProfileStoreForRuntime } from "./auth-profiles.js";
import { normalizeToolName } from "./tool-policy-shared.js";

const DEFAULT_PERSON_APPROVAL_POLICY = {
  id: "person-draft-first-v1",
  allowWithoutApproval: [...PERSON_TASK_INTENTS],
  requireApprovalFor: [
    "external_send",
    "external_write",
    "destructive_change",
    "third_party_share",
    "automation_mutation",
  ],
} as const;

const DEFAULT_PERSON_SPECIALISTS = [
  "research-specialist",
  "writing-specialist",
  "browser-errand-specialist",
] as const;

const DEFAULT_PERSON_PRIORITIES = ["Inbox triage", "Focus work", "Follow-ups"] as const;
const DEFAULT_PERSON_ROUTINES = ["Morning plan", "End-of-day review"] as const;
const DEFAULT_PERSON_CONTEXTS = ["Personal operations", "Work coordination"] as const;
const DEFAULT_PERSON_WRITING_PREFERENCES = [
  "Keep drafts concise",
  "End with clear next steps",
] as const;

const PERSON_STARTER_TOOL_ALLOW = [
  "agents_list",
  "browser",
  "memory_graph",
  "memory_get",
  "memory_search",
  "read",
  "session_status",
  "sessions_history",
  "sessions_list",
  "sessions_spawn",
  "subagents",
  "web_fetch",
  "web_search",
] as const;

const PERSON_STARTER_TOOL_DENY = [
  "apply_patch",
  "cron",
  "edit",
  "exec",
  "gateway",
  "message",
  "nodes",
  "process",
  "sessions_send",
  "write",
] as const;

const PERSON_STARTER_CAPABILITY_LEASES = [
  { capability: "browser", access: "execute", source: "starter_pack" },
  { capability: "search", access: "read", source: "starter_pack" },
  { capability: "files", access: "read", source: "starter_pack" },
  { capability: "memory", access: "read", source: "starter_pack" },
  { capability: "sessions", access: "read", source: "starter_pack" },
  { capability: "artifacts", access: "write", source: "starter_pack" },
] as const;

const BROWSER_MUTATING_ACTIONS = new Set(["close", "dialog", "start", "stop", "upload"]);
const BROWSER_MUTATING_ACT_KINDS = new Set([
  "click",
  "close",
  "drag",
  "evaluate",
  "fill",
  "press",
  "resize",
  "select",
  "type",
]);

export type ResolvedPersonAgentConfig = Omit<PersonWorkspaceSummary, "connectedAccounts">;

function unique(values: Iterable<string | undefined | null>): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) {
      out.add(trimmed);
    }
  }
  return Array.from(out);
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readStringField(value: unknown, key: string): string | undefined {
  const record = readObject(value);
  const raw = record?.[key];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function resolveProfileTimezone(cfg: AlisioConfig, person?: PersonAgentConfig): string {
  return (
    person?.profile?.timezone?.trim() ||
    cfg.agents?.defaults?.userTimezone?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC"
  );
}

function resolveConnectedAccountsSummary(
  agentDir?: string,
): PersonWorkspaceSummary["connectedAccounts"] {
  if (!agentDir) {
    return { status: "missing", totalProfiles: 0, providers: [] };
  }
  try {
    const store = loadAuthProfileStoreForRuntime(agentDir, {
      readOnly: true,
      allowKeychainPrompt: false,
    });
    const summary = buildAuthHealthSummary({ store });
    const providerStatuses = new Set(summary.providers.map((provider) => provider.status));
    const status: AuthProfileHealthStatus = providerStatuses.has("expired")
      ? "expired"
      : providerStatuses.has("expiring")
        ? "expiring"
        : providerStatuses.has("ok")
          ? "ok"
          : providerStatuses.has("static")
            ? "static"
            : "missing";
    return {
      status,
      totalProfiles: summary.profiles.length,
      providers: summary.providers.map((provider) => provider.provider),
    };
  } catch {
    return { status: "missing", totalProfiles: 0, providers: [] };
  }
}

function buildResolvedPersonConfig(params: {
  cfg: AlisioConfig;
  status: PersonWorkspaceSummary["status"];
  person?: PersonAgentConfig;
  agentName?: string;
  identityName?: string;
}): ResolvedPersonAgentConfig {
  const person = params.person;
  const profile = {
    name:
      person?.profile?.name?.trim() ||
      params.identityName?.trim() ||
      params.agentName?.trim() ||
      undefined,
    timezone: resolveProfileTimezone(params.cfg, person),
    tone: person?.profile?.tone?.trim() || undefined,
    writingPreferences: unique([
      ...(person?.profile?.writingPreferences ?? []),
      ...DEFAULT_PERSON_WRITING_PREFERENCES,
    ]),
    priorities: unique([...(person?.profile?.priorities ?? []), ...DEFAULT_PERSON_PRIORITIES]),
    routines: unique([...(person?.profile?.routines ?? []), ...DEFAULT_PERSON_ROUTINES]),
    frequentContacts: unique(person?.profile?.frequentContacts ?? []),
    frequentContexts: unique([
      ...(person?.profile?.frequentContexts ?? []),
      ...DEFAULT_PERSON_CONTEXTS,
    ]),
  };

  return {
    status: params.status,
    scope: person?.scope ?? "personal_and_work",
    autonomyMode: person?.autonomyMode ?? "draft-first",
    starterPack: person?.starterPack ?? "browser-first",
    profile,
    specialists: unique(person?.specialists ?? DEFAULT_PERSON_SPECIALISTS),
    memoryScopes: unique(person?.memoryScopes ?? PERSON_MEMORY_SCOPES) as PersonMemoryScope[],
    taskIntents: [...PERSON_TASK_INTENTS] as PersonTaskIntent[],
    artifactTypes: [...PERSON_ARTIFACT_TYPES] as PersonArtifactType[],
    approvalPolicy: {
      id: DEFAULT_PERSON_APPROVAL_POLICY.id,
      allowWithoutApproval: [...DEFAULT_PERSON_APPROVAL_POLICY.allowWithoutApproval],
      requireApprovalFor: [...DEFAULT_PERSON_APPROVAL_POLICY.requireApprovalFor],
    },
    capabilityLeases: PERSON_STARTER_CAPABILITY_LEASES.map((lease) => ({ ...lease })),
  };
}

export function resolveActivePersonAgentConfig(params: {
  cfg: AlisioConfig;
  agentId: string;
  agent: Pick<AgentConfig, "name" | "identity" | "person">;
}): ResolvedPersonAgentConfig | undefined {
  const person = params.agent.person;
  if (!person || person.enabled === false) {
    return undefined;
  }
  return buildResolvedPersonConfig({
    cfg: params.cfg,
    status: "active",
    person,
    agentName: params.agent.name,
    identityName: params.agent.identity?.name,
  });
}

export function resolvePersonWorkspaceSummary(params: {
  cfg: AlisioConfig;
  agentId: string;
  defaultAgentId: string;
  agent: Pick<AgentConfig, "name" | "identity" | "person">;
  agentDir?: string;
}): PersonWorkspaceSummary | undefined {
  const person = params.agent.person;
  if (person?.enabled === false) {
    return undefined;
  }
  const status = person ? "active" : params.agentId === params.defaultAgentId ? "suggested" : null;
  if (!status) {
    return undefined;
  }
  const resolved = buildResolvedPersonConfig({
    cfg: params.cfg,
    status,
    person,
    agentName: params.agent.name,
    identityName: params.agent.identity?.name,
  });
  return {
    ...resolved,
    connectedAccounts: resolveConnectedAccountsSummary(params.agentDir),
  };
}

export function mergePersonAgentToolDefaults(
  tools: AgentToolsConfig | undefined,
  person: ResolvedPersonAgentConfig | undefined,
): AgentToolsConfig | undefined {
  if (!person) {
    return tools;
  }
  return {
    ...tools,
    profile: tools?.profile ?? "minimal",
    alsoAllow: unique([...(tools?.alsoAllow ?? []), ...PERSON_STARTER_TOOL_ALLOW]),
    deny: unique([...(tools?.deny ?? []), ...PERSON_STARTER_TOOL_DENY]),
    fs: {
      ...tools?.fs,
      workspaceOnly: tools?.fs?.workspaceOnly ?? true,
    },
  };
}

export function mergePersonAgentMemoryDefaults(
  memorySearch: MemorySearchConfig | undefined,
  person: ResolvedPersonAgentConfig | undefined,
): MemorySearchConfig | undefined {
  if (!person) {
    return memorySearch;
  }
  return {
    ...memorySearch,
    enabled: memorySearch?.enabled ?? true,
    sources: unique([...(memorySearch?.sources ?? []), "memory", "sessions"]) as Array<
      "memory" | "sessions"
    >,
    extraPaths: unique([...(memorySearch?.extraPaths ?? []), "MEMORY.md", "memory"]),
  };
}

export function mergePersonAgentSubagentDefaults(
  subagents: AgentConfig["subagents"] | undefined,
  _person: ResolvedPersonAgentConfig | undefined,
): AgentConfig["subagents"] | undefined {
  return subagents;
}

function resolveBrowserGuardReason(toolParams: unknown): string | undefined {
  const action = readStringField(toolParams, "action");
  if (!action) {
    return undefined;
  }
  if (BROWSER_MUTATING_ACTIONS.has(action)) {
    return `browser.${action} is blocked for draft-first person agents. Keep the result as a draft or request approval first.`;
  }
  if (action !== "act") {
    return undefined;
  }
  const request = readObject(readObject(toolParams)?.request);
  const kind = readStringField(request ?? toolParams, "kind");
  if (kind && BROWSER_MUTATING_ACT_KINDS.has(kind)) {
    return `browser.act kind="${kind}" is blocked for draft-first person agents. Keep the result as a draft or request approval first.`;
  }
  return undefined;
}

export function evaluatePersonToolCallGuard(params: {
  person: ResolvedPersonAgentConfig | undefined;
  toolName: string;
  toolParams: unknown;
}): { block: true; reason: string } | null {
  const person = params.person;
  if (!person || person.autonomyMode !== "draft-first") {
    return null;
  }
  const toolName = normalizeToolName(params.toolName);
  const staticReasonMap = new Map<string, string>([
    [
      "apply_patch",
      "apply_patch is blocked for draft-first person agents. Produce a draft or artifact instead.",
    ],
    [
      "cron",
      "cron is blocked for draft-first person agents until an explicit approval flow lands.",
    ],
    ["edit", "edit is blocked for draft-first person agents. Produce a draft or artifact instead."],
    ["exec", "exec is blocked for browser-first person agents in V1."],
    ["gateway", "gateway mutations are blocked for draft-first person agents."],
    ["message", "message.send is blocked for draft-first person agents until explicit approval."],
    ["nodes", "node operations are blocked for draft-first person agents in V1."],
    ["process", "process management is blocked for browser-first person agents in V1."],
    [
      "sessions_send",
      "sessions_send is blocked for draft-first person agents. Keep the message as a draft instead.",
    ],
    [
      "write",
      "write is blocked for draft-first person agents. Produce a draft or artifact instead.",
    ],
  ]);
  if (toolName === "browser") {
    const browserReason = resolveBrowserGuardReason(params.toolParams);
    return browserReason ? { block: true, reason: browserReason } : null;
  }
  if (toolName === "subagents") {
    const action = readStringField(params.toolParams, "action") ?? "list";
    if (action !== "list") {
      return {
        block: true,
        reason: `subagents action="${action}" is blocked for draft-first person agents.`,
      };
    }
    return null;
  }
  const reason = staticReasonMap.get(toolName);
  return reason ? { block: true, reason } : null;
}

export function evaluatePersonSubagentGuard(params: {
  person: ResolvedPersonAgentConfig | undefined;
  requesterAgentId: string;
  targetAgentId: string;
}): { block: true; reason: string } | null {
  const person = params.person;
  if (!person) {
    return null;
  }
  if (params.targetAgentId === params.requesterAgentId) {
    return null;
  }
  const allowed = new Set(person.specialists);
  if (allowed.has(params.targetAgentId)) {
    return null;
  }
  return {
    block: true,
    reason: `draft-first person agents may only spawn specialists (${person.specialists.join(", ")}).`,
  };
}
