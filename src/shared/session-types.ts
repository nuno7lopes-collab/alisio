import type { PersonWorkspaceSummary } from "../config/types.person.js";
import type {
  AlisioBackendSharedResource,
  AlisioLocalRuntimeResource,
} from "./alisio-account-scope.js";
import { ALISIO_ACCOUNT_SCOPE_ROOT } from "./alisio-account-scope.js";

export type GatewayAgentIdentity = {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
};

export type GatewayPersonalContextAvailability =
  | "setup_only"
  | "all_sessions"
  | "private_direct_sessions"
  | "retrieval_only";

export type GatewayPersonalContextInheritance = "identity" | "soul" | "preferences" | "main_memory";

export type GatewayPersonalContextFileSummary = {
  path: string;
  present: boolean;
  availability: GatewayPersonalContextAvailability;
};

export type GatewayPersonalContextSessionPolicy = {
  kind: "main" | "direct" | "group" | "subagent" | "cron";
  role:
    | "default_personal_session"
    | "private_direct_session"
    | "shared_session"
    | "delegated_session"
    | "automation_session";
  inherits: GatewayPersonalContextInheritance[];
  key?: string;
};

export type GatewayAccountScope = {
  scopeRoot: typeof ALISIO_ACCOUNT_SCOPE_ROOT;
  accountId: string;
  source: "account_id";
  authenticated: true;
  authRequired: true;
  workspaceMode: "account_scoped";
  workspaceRoot: string;
};

export type GatewayRuntimeResidencyContract = {
  scopeRoot: typeof ALISIO_ACCOUNT_SCOPE_ROOT;
  backendShared: AlisioBackendSharedResource[];
  localRuntime: AlisioLocalRuntimeResource[];
};

export type GatewayAccountDeviceBinding = {
  binding: "account_bound";
  runtime: "local";
  current: true;
  accountId: string;
  deviceId?: string;
  label?: string;
  platform?: string;
};

export type GatewayPersonalContextSummary = {
  version: 1;
  accountScope: GatewayAccountScope;
  runtimeContract: GatewayRuntimeResidencyContract;
  deviceBinding: GatewayAccountDeviceBinding;
  bootstrap: GatewayPersonalContextFileSummary & {
    state: "pending" | "completed";
    oneTime: true;
    seededAt?: string;
    completedAt?: string;
  };
  identity: GatewayPersonalContextFileSummary & {
    resolved: GatewayAgentIdentity;
    sources: {
      name?: "identity-file" | "config-identity" | "agent-config" | "account-profile";
      avatar?: "identity-file" | "config-identity" | "agent-config" | "account-profile";
      emoji?: "identity-file" | "config-identity" | "agent-config" | "account-profile";
      theme?: "identity-file" | "config-identity" | "agent-config" | "account-profile";
    };
  };
  soul: GatewayPersonalContextFileSummary;
  preferences: GatewayPersonalContextFileSummary;
  memory: {
    main: GatewayPersonalContextFileSummary;
    operational: {
      root: "memory";
      backlogRoot: "memory/backlog";
      availability: "retrieval_only";
      topicCount: number;
      dailyCount: number;
      backlogCount: number;
    };
  };
  sessionPolicy: {
    main: GatewayPersonalContextSessionPolicy;
    direct: GatewayPersonalContextSessionPolicy;
    group: GatewayPersonalContextSessionPolicy;
    subagent: GatewayPersonalContextSessionPolicy;
    cron: GatewayPersonalContextSessionPolicy;
  };
};

export type GatewayAgentModel = {
  primary?: string;
  fallbacks?: string[];
};

export type GatewayAgentRow = {
  id: string;
  name?: string;
  identity?: GatewayAgentIdentity;
  personalContext?: GatewayPersonalContextSummary;
  person?: PersonWorkspaceSummary;
  workspace?: string;
  model?: GatewayAgentModel;
};

export type SessionsListResultBase<TDefaults, TRow> = {
  ts: number;
  path: string;
  count: number;
  defaults: TDefaults;
  sessions: TRow[];
};

export type SessionsPatchResultBase<TEntry> = {
  ok: true;
  path: string;
  key: string;
  entry: TEntry;
};
