import type { Context, Message } from "@mariozechner/pi-ai";

export const DESKTOP_WORKER_VERSION = 2 as const;
export const DEFAULT_WORKER_PORT = 3500;
export const DEFAULT_OPENAI_MODEL = "gpt-5.4";
export const DEFAULT_OPENAI_PROVIDER = "openai";
export const OPENAI_CODEX_PROVIDER = "openai-codex";
export const DESKTOP_BRAND_NAME = "Lume";

export type SupportedChatProvider = typeof DEFAULT_OPENAI_PROVIDER | typeof OPENAI_CODEX_PROVIDER;

export type WorkerRuntimeState = "starting" | "ready" | "error";
export type AiProfileScope = "personal" | "org_shared";
export type AiProfileHealthStatus =
  | "healthy"
  | "degraded"
  | "partially_available"
  | "unavailable"
  | "expired";
export type AiProfileAttachmentState = "attached" | "detached";
export type WorkerAiCredentialRuntimeState =
  | "authenticated"
  | "expired"
  | "cooldown"
  | "error"
  | "active"
  | "standby";

export type MockSession = {
  userId: string;
  name: string;
  email: string;
  sessionToken: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkerSettings = {
  provider: SupportedChatProvider;
  model: string;
  openAiApiKey?: string;
};

export type ChatExecutionSettings = WorkerSettings & {
  openAiCodexAuthProfileId?: string;
};

export type DesktopWorkerInstallation = {
  deviceId: string;
  workerId: string;
  createdAt: number;
};

export type AiProfileRoutingPolicy = {
  mode: "auto" | "manual";
};

export type AiProfileGrants = {
  userIds: string[];
};

export type AiProfileTelemetry = {
  attachedCredentials: number;
  usableCredentials: number;
  lastUsedAt?: number;
  lastError?: string;
};

export type WorkerAiCredentialTelemetry = {
  lastUsedAt?: number;
};

export type AiProfile = {
  id: string;
  scope: AiProfileScope;
  ownerUserId?: string;
  ownerOrgId?: string;
  provider: typeof OPENAI_CODEX_PROVIDER;
  canonicalIdentity: string;
  label: string;
  healthStatus: AiProfileHealthStatus;
  attachmentState: AiProfileAttachmentState;
  routingPolicy: AiProfileRoutingPolicy;
  grants: AiProfileGrants;
  aggregatedTelemetry: AiProfileTelemetry;
};

export type WorkerAiCredential = {
  id: string;
  deviceId: string;
  workerId: string;
  aiProfileId: string;
  authProfileId: string;
  provider: typeof OPENAI_CODEX_PROVIDER;
  runtimeState: WorkerAiCredentialRuntimeState;
  lastAuthAt?: number;
  expiresAt?: number;
  lastUsedAt?: number;
  localTelemetry: WorkerAiCredentialTelemetry;
  lastError?: string;
  email?: string;
  accountId?: string;
};

export type RuntimeBinding = {
  workerId: string;
  workerAiCredentialId: string;
  boundAt: number;
  reason: string;
};

export type PersistedConversation = Pick<Context, "messages">;

export type PersistedDesktopState = {
  version: typeof DESKTOP_WORKER_VERSION;
  updatedAt: number;
  installation: DesktopWorkerInstallation;
  session: MockSession | null;
  settings: WorkerSettings;
  conversation: PersistedConversation;
  aiProfiles: AiProfile[];
  workerAiCredentials: WorkerAiCredential[];
  runtimeBinding: RuntimeBinding | null;
};

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  createdAt: number;
  toolAlias?: string;
  isError?: boolean;
};

export type WorkerStatus = {
  state: WorkerRuntimeState;
  startedAt: number;
  pid: number;
  port: number;
  brandName: string;
  hasSession: boolean;
  hasOpenAiApiKey: boolean;
  hasActiveAiCredential: boolean;
  model: string;
  activeAiProfileLabel?: string;
  activeAiCredentialState?: WorkerAiCredentialRuntimeState;
  lastError?: string;
};

export type ChatTurnResult = {
  conversation: PersistedConversation;
  transcript: TranscriptMessage[];
};

export type ChatTurnParams = {
  conversation: PersistedConversation;
  content: string;
  settings: ChatExecutionSettings;
};

export type ToolAlias = "system.whoami";

export type InvokeAliasParams = {
  alias: ToolAlias;
  input?: Record<string, unknown>;
};

export type ToolAliasResult = {
  alias: ToolAlias;
  output: string;
  exitCode: number;
  isError: boolean;
};

export type WorkerServerOptions = {
  host?: string;
  port?: number;
  storageDir?: string;
};

export type WorkerServerHandle = {
  baseUrl: string;
  close: () => Promise<void>;
  getStatus: () => WorkerStatus;
};

export type SerializedChatState = {
  messages: Message[];
};
