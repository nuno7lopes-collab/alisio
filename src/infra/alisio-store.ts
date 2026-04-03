import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  deriveAlisioAvatarLabel,
  normalizeAlisioUsername,
  validateAlisioAccountDraft,
} from "../shared/alisio-account.js";
import {
  AlisioAccountCloudError,
  completeAlisioCloudAccountProfile,
  requestAlisioCloudPasswordReset,
  resolveAlisioAccountBackend,
  restoreAlisioCloudAccountSession,
  signInAlisioCloudAccount,
  signOutAlisioCloudAccount,
  signUpAlisioCloudAccount,
  type AlisioCloudAccountProfile,
  type AlisioStoredCloudSession,
  type AlisioStoredPasswordCredential,
} from "./alisio-account-cloud.js";
import {
  AlisioAiError,
  applyAlisioOpenAiRuntime,
  buildAlisioOpenAiAuthorization,
  clearAlisioOpenAiRuntime,
  completeAlisioOpenAiAuthorization,
  refreshAlisioOpenAiSession,
  toAlisioAiState,
  type AlisioAiState,
  type AlisioPendingAiAuthorization,
  type AlisioStoredAiSession,
} from "./alisio-ai.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "./json-files.js";

export type AlisioConnectorCategory = "social" | "google" | "productivity" | "development";

export type AlisioConnectorAvailability = "ready" | "in_review" | "unavailable";
export type AlisioAuthorizationState = "not_connected" | "connected" | "needs_reconnect";
export type AlisioAuthorizationHealth = "healthy" | "needs_reconnect" | "in_review" | "unavailable";
export type AlisioConnectorBeginMode = "oauth" | "setup";
export type AlisioConnectorBeginReason =
  | "ready_for_oauth"
  | "missing_client_config"
  | "review_required"
  | "unavailable";
export type AlisioOAuthProvider = "google" | "github" | "notion" | "vercel";
export type AlisioPreferredLanguage = "en" | "pt-PT" | "es";
export type AlisioPreferredTheme = "system" | "light" | "dark";
export type AlisioAccountSessionState = "signed_out" | "signed_in";
export type AlisioStartupState = "signed_out" | "needs_profile" | "needs_ai" | "ready";
export type AlisioBootstrapStep =
  | "gateway"
  | "runtime"
  | "account"
  | "organization"
  | "connectors"
  | "permissions"
  | "ready";

export type AlisioBootstrapConnectorSummary = {
  total: number;
  ready: number;
  connected: number;
  needsReconnect: number;
  inReview: number;
  unavailable: number;
  available: number;
};

export type AlisioBootstrapSummary = {
  connectionRequired: boolean;
  wizardRequired: boolean;
  wizardRunning: boolean;
  providerReady: boolean;
  accountReady: boolean;
  startupState: AlisioStartupState;
  organizationState: AlisioOrganizationMembershipState;
  connectorSummary: AlisioBootstrapConnectorSummary;
  nextStep: AlisioBootstrapStep;
};

export type AlisioDoctorIssueSeverity = "info" | "warning" | "error";

export type AlisioDoctorIssue = {
  code: string;
  severity: AlisioDoctorIssueSeverity;
  title: string;
  message: string;
  step?: AlisioBootstrapStep;
};

export type AlisioDoctorSummary = {
  ok: boolean;
  issues: AlisioDoctorIssue[];
  checks: {
    gateway: boolean;
    runtime: boolean;
    account: boolean;
    organization: boolean;
    connectors: boolean;
    permissions: boolean;
  };
  bootstrap: AlisioBootstrapSummary;
};

export type AlisioConnectorDefinition = {
  id: string;
  title: string;
  providerLabel: string;
  category: AlisioConnectorCategory;
  connectLabel: string;
  summary: string;
  detail?: string;
  availability: AlisioConnectorAvailability;
  setupUrl?: string;
  scopes: string[];
};

export type AlisioConnectedAccount = {
  label: string;
  email?: string;
  handle?: string;
};

export type AlisioConnectorAuthorization = {
  connectorId: string;
  state: AlisioAuthorizationState;
  health: AlisioAuthorizationHealth;
  connectedAt?: string;
  scopes: string[];
  connectedAccount?: AlisioConnectedAccount;
};

export type AlisioLocalAccountProfile = {
  userId?: string;
  username: string;
  displayName: string;
  email: string;
  avatarLabel: string;
  avatarUrl?: string;
  joinedAt: string;
  plan: string;
  backend?: "supabase" | "local-dev";
};

export type AlisioLocalUserPreferences = {
  language: AlisioPreferredLanguage;
  theme: AlisioPreferredTheme;
};

export type AlisioAccountSession = {
  state: AlisioAccountSessionState;
  profileCompleted: boolean;
  signedInAt?: string;
  signedOutAt?: string;
  backend?: "supabase" | "local-dev";
};

export type AlisioLocalDeviceSession = {
  id: string;
  label: string;
  platform: string;
  current: boolean;
  status: "active";
  lastSeenAt: string;
};

export type AlisioOrganizationMembershipState = {
  mode: "none" | "owner" | "member";
  organizationName?: string;
  inviteEmail?: string;
};

export type AlisioAccountState = {
  profile: AlisioLocalAccountProfile;
  preferences: AlisioLocalUserPreferences;
  session: AlisioAccountSession;
  devices: AlisioLocalDeviceSession[];
};

export type AlisioBootstrapSnapshot = {
  account: AlisioAccountState;
  ai: AlisioAiState;
  organization: AlisioOrganizationMembershipState;
  connectors: {
    catalog: readonly AlisioConnectorDefinition[];
    authorizations: AlisioConnectorAuthorization[];
    summary: AlisioBootstrapConnectorSummary;
  };
};

export type AlisioStoredState = {
  version: 1;
  account: {
    profile: AlisioLocalAccountProfile;
    preferences: AlisioLocalUserPreferences;
    session: AlisioAccountSession;
    cloudSession?: AlisioStoredCloudSession;
    passwordCredential?: AlisioStoredPasswordCredential;
  };
  organization: AlisioOrganizationMembershipState;
  ai?: {
    session?: AlisioStoredAiSession;
    pending?: AlisioPendingAiAuthorization;
  };
  authorizations: Record<string, AlisioConnectorAuthorization>;
  oauthCredentials: Record<
    string,
    {
      provider: AlisioOAuthProvider;
      accessToken: string;
      refreshToken?: string;
      tokenType?: string;
      scope?: string;
      expiresAt?: string;
      createdAt: string;
    }
  >;
  pendingAuthorizations: Record<
    string,
    {
      connectorId: string;
      provider: AlisioOAuthProvider;
      redirectUri: string;
      createdAt: string;
      codeVerifier?: string;
    }
  >;
};

export class AlisioAccountValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlisioAccountValidationError";
  }
}

export type AlisioConnectorsBeginResult = {
  connectorId: string;
  availability: AlisioConnectorAvailability;
  mode: AlisioConnectorBeginMode;
  provider?: AlisioOAuthProvider;
  providerLabel?: string;
  statusReason: AlisioConnectorBeginReason;
  setupUrl?: string;
  redirectUri?: string;
  callbackPath?: string;
  requiredEnvVars?: string[];
  setupHint?: string;
};

export type AlisioOAuthCallbackResult =
  | {
      ok: true;
      authorization: AlisioConnectorAuthorization;
    }
  | {
      ok: false;
      reason:
        | "unknown_provider"
        | "missing_state"
        | "missing_code"
        | "pending_not_found"
        | "provider_mismatch"
        | "missing_client_config"
        | "oauth_denied"
        | "token_exchange_failed"
        | "profile_fetch_failed";
      message: string;
    };

type AlisioOAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
};

const STORE_FILENAME = "alisio/state.json";
const PENDING_AUTHORIZATION_TTL_MS = 15 * 60 * 1000;
const withLock = createAsyncLock();

const CONNECTOR_CATALOG: readonly AlisioConnectorDefinition[] = [
  {
    id: "facebook",
    title: "Facebook",
    providerLabel: "Meta",
    category: "social",
    connectLabel: "Connect with Facebook",
    summary: "Pages, publishing access, and account signals for Meta workflows.",
    detail: "Requires app review and business/page-level permissions before production use.",
    availability: "in_review",
    scopes: ["pages_read_engagement", "pages_manage_posts"],
  },
  {
    id: "instagram",
    title: "Instagram",
    providerLabel: "Meta",
    category: "social",
    connectLabel: "Connect with Instagram",
    summary: "Professional Instagram account access for publishing and inbox operations.",
    detail: "Business or creator accounts only. Production access depends on Meta review.",
    availability: "in_review",
    scopes: ["instagram_basic", "instagram_manage_messages", "instagram_content_publish"],
  },
  {
    id: "x",
    title: "X / Twitter",
    providerLabel: "X",
    category: "social",
    connectLabel: "Connect with X",
    summary: "Read, write, and scheduling workflows for X-based publishing.",
    detail: "API access tiers vary by account and environment.",
    availability: "unavailable",
    scopes: ["tweet.read", "tweet.write", "users.read"],
  },
  {
    id: "tiktok",
    title: "TikTok",
    providerLabel: "TikTok",
    category: "social",
    connectLabel: "Connect with TikTok",
    summary: "Creator-facing TikTok capabilities for content and account operations.",
    detail: "Real production access requires app review.",
    availability: "in_review",
    scopes: ["user.info.basic", "video.list"],
  },
  {
    id: "linkedin",
    title: "LinkedIn",
    providerLabel: "LinkedIn",
    category: "social",
    connectLabel: "Connect with LinkedIn",
    summary: "Identity, profile, and business publishing workflows.",
    detail:
      "Planned for a later rollout. Sign-in and publishing scopes still need provider review.",
    availability: "in_review",
    setupUrl:
      "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2",
    scopes: ["openid", "profile", "email"],
  },
  {
    id: "pinterest",
    title: "Pinterest",
    providerLabel: "Pinterest",
    category: "social",
    connectLabel: "Connect with Pinterest",
    summary: "Boards, pins, and account-level content workflows.",
    detail: "Production rollout depends on vendor review and app setup.",
    availability: "in_review",
    scopes: ["boards:read", "pins:read", "pins:write"],
  },
  {
    id: "google-docs",
    title: "Google Docs",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Read and create document workflows in Google Docs.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/documents", "openid", "email"],
  },
  {
    id: "google-sheets",
    title: "Google Sheets",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Spreadsheet automation, reporting, and data sync workflows.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "openid", "email"],
  },
  {
    id: "google-forms",
    title: "Google Forms",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Form reading and submission workflows for intake automations.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/forms.body", "openid", "email"],
  },
  {
    id: "youtube",
    title: "YouTube",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Channel, publishing, and metadata workflows for YouTube.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/youtube.readonly", "openid", "email"],
  },
  {
    id: "gmail-read",
    title: "Gmail Read",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Read inbox state and messages for triage and summarization.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email"],
  },
  {
    id: "gmail-modify",
    title: "Gmail Modify",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Label, archive, and organize Gmail messages with approval-aware flows.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/gmail.modify", "openid", "email"],
  },
  {
    id: "gmail-send",
    title: "Gmail Send",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Send outbound email drafts and approved replies.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/gmail.send", "openid", "email"],
  },
  {
    id: "google-calendar",
    title: "Google Calendar",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Read and schedule calendar events for the person agent.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/calendar", "openid", "email"],
  },
  {
    id: "google-drive",
    title: "Google Drive",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Browse, read, and store files in Google Drive.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/drive", "openid", "email"],
  },
  {
    id: "google-analytics",
    title: "Google Analytics",
    providerLabel: "Google",
    category: "google",
    connectLabel: "Connect with Google",
    summary: "Reporting and read access for analytics properties.",
    availability: "ready",
    setupUrl: "https://developers.google.com/identity/protocols/oauth2",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly", "openid", "email"],
  },
  {
    id: "notion",
    title: "Notion",
    providerLabel: "Notion",
    category: "productivity",
    connectLabel: "Connect with Notion",
    summary: "Workspace pages, databases, and project context for planning flows.",
    detail: "Connector surface is ready, but the OAuth rollout lands after Google and GitHub.",
    availability: "in_review",
    setupUrl: "https://developers.notion.com/guides/get-started/authorization",
    scopes: ["read_content", "update_content"],
  },
  {
    id: "github",
    title: "GitHub",
    providerLabel: "GitHub",
    category: "development",
    connectLabel: "Connect with GitHub",
    summary: "Repository, issue, and pull request workflows for engineering tasks.",
    availability: "ready",
    setupUrl:
      "https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app",
    scopes: ["contents", "issues", "pull_requests"],
  },
  {
    id: "vercel",
    title: "Vercel",
    providerLabel: "Vercel",
    category: "development",
    connectLabel: "Connect with Vercel",
    summary: "Deployment status, project control, and environment-aware delivery flows.",
    detail: "Queued for the next OAuth wave after the first Google and GitHub rollout.",
    availability: "in_review",
    setupUrl: "https://vercel.com/docs/integrations/create-integration/approval-checklist",
    scopes: ["projects.read", "deployments.read"],
  },
] as const;

function stateFilePath(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveStateDir(env), STORE_FILENAME);
}

function titleCaseUser(input: string) {
  return input
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolvePlatformLabel() {
  switch (process.platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return process.platform;
  }
}

function buildDefaultState(): AlisioStoredState {
  const username = resolveDefaultUsername(process.env);
  const displayName = titleCaseUser(username) || "Nuno";
  const backend = resolveAlisioAccountBackend(process.env);
  return {
    version: 1,
    account: {
      profile: {
        username,
        displayName,
        email: `${username}@alisio.local`,
        avatarLabel: displayName.slice(0, 1).toUpperCase() || "A",
        joinedAt: new Date().toISOString(),
        plan: "Free Plan",
        backend,
      },
      preferences: {
        language: "pt-PT",
        theme: "dark",
      },
      session: {
        state: "signed_out",
        profileCompleted: false,
        backend,
      },
    },
    organization: {
      mode: "none",
    },
    ai: {},
    authorizations: {},
    oauthCredentials: {},
    pendingAuthorizations: {},
  };
}

function resolveDefaultUsername(env: NodeJS.ProcessEnv = process.env) {
  const candidate = normalizeAlisioUsername(env.USER || env.LOGNAME || "nuno");
  const sanitized = candidate.replace(/[^a-z0-9._]+/g, "");
  return sanitized || "nuno";
}

function resolveDefaultAccountSeed(env: NodeJS.ProcessEnv = process.env) {
  const username = resolveDefaultUsername(env);
  const displayName = titleCaseUser(username) || "Nuno";
  return {
    username,
    displayName,
    email: `${username}@alisio.local`,
    avatarLabel: displayName.slice(0, 1).toUpperCase() || "A",
  };
}

function isAccountProvisioned(
  profile: AlisioLocalAccountProfile,
  env: NodeJS.ProcessEnv = process.env,
) {
  const seed = resolveDefaultAccountSeed(env);
  return (
    profile.username !== seed.username ||
    profile.displayName !== seed.displayName ||
    profile.email !== seed.email ||
    profile.avatarLabel !== seed.avatarLabel
  );
}

function buildDefaultAccountSession(): AlisioAccountSession {
  return {
    state: "signed_out",
    profileCompleted: false,
    backend: resolveAlisioAccountBackend(process.env),
  };
}

function inferLegacyAccountSession(
  profile: AlisioLocalAccountProfile,
  env: NodeJS.ProcessEnv = process.env,
): AlisioAccountSession {
  const profileCompleted = isAccountProvisioned(profile, env);
  if (!profileCompleted) {
    return buildDefaultAccountSession();
  }
  return {
    state: "signed_in",
    profileCompleted: true,
    signedInAt: new Date().toISOString(),
  };
}

function normalizeStoredAccountSession(
  session: Partial<AlisioAccountSession> | undefined,
  profile: AlisioLocalAccountProfile,
  env: NodeJS.ProcessEnv = process.env,
): AlisioAccountSession {
  const fallback = inferLegacyAccountSession(profile, env);
  const state = session?.state === "signed_in" ? "signed_in" : "signed_out";
  return {
    state,
    profileCompleted:
      typeof session?.profileCompleted === "boolean"
        ? session.profileCompleted
        : fallback.profileCompleted,
    backend:
      session?.backend === "supabase" || session?.backend === "local-dev"
        ? session.backend
        : (profile.backend ?? resolveAlisioAccountBackend(env)),
    ...(typeof session?.signedInAt === "string" ? { signedInAt: session.signedInAt } : {}),
    ...(typeof session?.signedOutAt === "string" ? { signedOutAt: session.signedOutAt } : {}),
  };
}

export function hasRestorableAlisioAccount(
  profile: AlisioLocalAccountProfile,
  session: AlisioAccountSession,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (session.state === "signed_in") {
    return true;
  }
  return session.profileCompleted || isAccountProvisioned(profile, env);
}

function toLocalAccountProfile(profile: AlisioCloudAccountProfile): AlisioLocalAccountProfile {
  return {
    ...(profile.userId ? { userId: profile.userId } : {}),
    username: profile.username,
    displayName: profile.displayName,
    email: profile.email,
    avatarLabel: profile.avatarLabel,
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    joinedAt: profile.joinedAt,
    plan: profile.plan,
    backend: profile.backend,
  };
}

function toCloudAccountProfile(profile: AlisioLocalAccountProfile): AlisioCloudAccountProfile {
  return {
    ...(profile.userId ? { userId: profile.userId } : {}),
    email: profile.email,
    displayName: profile.displayName,
    username: profile.username,
    avatarLabel: profile.avatarLabel,
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    joinedAt: profile.joinedAt,
    plan: profile.plan,
    profileCompleted: true,
    backend: profile.backend ?? "local-dev",
  };
}

function toAccountSessionFromCloud(
  session: AlisioStoredCloudSession | undefined,
  profileCompleted: boolean,
  fallback: AlisioAccountSession,
): AlisioAccountSession {
  if (!session) {
    return {
      ...fallback,
      profileCompleted,
    };
  }
  return {
    state: session.state,
    profileCompleted,
    backend: session.backend,
    ...(session.signedInAt ? { signedInAt: session.signedInAt } : {}),
    ...(session.signedOutAt ? { signedOutAt: session.signedOutAt } : {}),
  };
}

function isAlisioAiReady(state: AlisioAiState | null | undefined) {
  return state?.status === "connected" || state?.status === "limits_unavailable";
}

function summarizeConnectorAuthorizations(
  authorizations: readonly AlisioConnectorAuthorization[],
): AlisioBootstrapConnectorSummary {
  const summary: AlisioBootstrapConnectorSummary = {
    total: CONNECTOR_CATALOG.length,
    ready: 0,
    connected: 0,
    needsReconnect: 0,
    inReview: 0,
    unavailable: 0,
    available: 0,
  };

  for (const connector of CONNECTOR_CATALOG) {
    if (connector.availability === "ready") {
      summary.ready += 1;
    } else if (connector.availability === "in_review") {
      summary.inReview += 1;
    } else {
      summary.unavailable += 1;
    }
  }

  for (const authorization of authorizations) {
    if (authorization.state === "connected") {
      summary.connected += 1;
    }
    if (authorization.state === "connected" && authorization.health === "needs_reconnect") {
      summary.needsReconnect += 1;
    }
  }

  summary.available = summary.total - summary.unavailable;
  return summary;
}

export async function getAlisioBootstrapSummary(
  params: {
    env?: NodeJS.ProcessEnv;
    wizardRunning?: boolean;
    providerReady?: boolean;
    connectionRequired?: boolean;
  } = {},
): Promise<AlisioBootstrapSummary> {
  const env = params.env ?? process.env;
  const [account, ai, organization, authorizations] = await Promise.all([
    getAlisioAccountState(env),
    getAlisioAiState(env),
    getAlisioOrganizationState(env),
    listAlisioConnectorAuthorizations(env),
  ]);
  const accountReady = account.session.state === "signed_in" && account.session.profileCompleted;
  const providerReady = params.providerReady ?? isAlisioAiReady(ai);
  const connectorSummary = summarizeConnectorAuthorizations(authorizations);
  const startupState: AlisioStartupState = params.connectionRequired
    ? "signed_out"
    : account.session.state !== "signed_in"
      ? "signed_out"
      : !account.session.profileCompleted
        ? "needs_profile"
        : !providerReady
          ? "needs_ai"
          : "ready";
  const wizardRequired = startupState === "needs_ai";
  const nextStep: AlisioBootstrapStep = params.connectionRequired
    ? "gateway"
    : startupState === "signed_out" || startupState === "needs_profile"
      ? "account"
      : startupState === "needs_ai"
        ? "runtime"
        : organization.mode === "none"
          ? "organization"
          : connectorSummary.connected === 0 && connectorSummary.ready > 0
            ? "connectors"
            : process.platform === "darwin"
              ? "permissions"
              : "ready";

  return {
    connectionRequired: params.connectionRequired ?? false,
    wizardRequired,
    wizardRunning: params.wizardRunning ?? false,
    providerReady,
    accountReady,
    startupState,
    organizationState: organization,
    connectorSummary,
    nextStep,
  };
}

export async function getAlisioDoctorSummary(
  params: {
    env?: NodeJS.ProcessEnv;
    wizardRunning?: boolean;
    providerReady?: boolean;
    connectionRequired?: boolean;
    gatewayHealthy?: boolean;
  } = {},
): Promise<AlisioDoctorSummary> {
  const bootstrap = await getAlisioBootstrapSummary(params);
  const issues: AlisioDoctorIssue[] = [];

  if (bootstrap.connectionRequired) {
    issues.push({
      code: "gateway_not_connected",
      severity: "error",
      title: "Gateway not connected",
      message: "Connect to the local gateway before continuing setup.",
      step: "gateway",
    });
  }

  if (params.gatewayHealthy === false) {
    issues.push({
      code: "gateway_unhealthy",
      severity: "error",
      title: "Gateway health check failed",
      message: "Refresh or restart the gateway before continuing setup.",
      step: "gateway",
    });
  }

  if (!bootstrap.accountReady) {
    issues.push({
      code: "account_not_ready",
      severity: "error",
      title:
        bootstrap.startupState === "signed_out" ? "Account not signed in" : "Profile incomplete",
      message:
        bootstrap.startupState === "signed_out"
          ? "Create an Alisio account or continue with the account saved on this device."
          : "Finish the Alisio profile before starting the first chat.",
      step: "account",
    });
  }

  if (!bootstrap.providerReady) {
    issues.push({
      code: "runtime_not_ready",
      severity: "error",
      title: "OpenAI not connected",
      message: "Connect OpenAI before starting the first chat.",
      step: "runtime",
    });
  }

  if (bootstrap.organizationState.mode === "none") {
    issues.push({
      code: "organization_not_configured",
      severity: "info",
      title: "Organization not configured",
      message: "You can create or join an organization later from the setup flow.",
      step: "organization",
    });
  }

  if (bootstrap.connectorSummary.needsReconnect > 0) {
    issues.push({
      code: "connectors_need_reconnect",
      severity: "warning",
      title: "Some connectors need reconnect",
      message: `${bootstrap.connectorSummary.needsReconnect} connector${bootstrap.connectorSummary.needsReconnect === 1 ? "" : "s"} need a fresh sign-in.`,
      step: "connectors",
    });
  }

  if (bootstrap.connectorSummary.inReview > 0) {
    issues.push({
      code: "connectors_in_review",
      severity: "info",
      title: "Some connectors are still in review",
      message: `${bootstrap.connectorSummary.inReview} connector${bootstrap.connectorSummary.inReview === 1 ? "" : "s"} are not production-ready yet.`,
      step: "connectors",
    });
  }

  const ok = !issues.some((issue) => issue.severity === "error");
  return {
    ok,
    issues,
    checks: {
      gateway: !bootstrap.connectionRequired,
      runtime: bootstrap.providerReady,
      account: bootstrap.accountReady,
      organization: bootstrap.organizationState.mode !== "none",
      connectors: bootstrap.connectorSummary.needsReconnect === 0,
      permissions: true,
    },
    bootstrap,
  };
}

async function loadStoredState(env?: NodeJS.ProcessEnv): Promise<AlisioStoredState> {
  const loaded = await readJsonFile<AlisioStoredState>(stateFilePath(env));
  const defaults = buildDefaultState();
  if (!loaded || loaded.version !== 1) {
    return defaults;
  }
  return {
    ...defaults,
    ...loaded,
    account: {
      ...defaults.account,
      ...loaded.account,
      profile: {
        ...defaults.account.profile,
        ...loaded.account?.profile,
      },
      preferences: {
        ...defaults.account.preferences,
        ...loaded.account?.preferences,
      },
      session: normalizeStoredAccountSession(
        loaded.account?.session,
        {
          ...defaults.account.profile,
          ...loaded.account?.profile,
        },
        env,
      ),
      ...(loaded.account?.cloudSession ? { cloudSession: loaded.account.cloudSession } : {}),
      ...(loaded.account?.passwordCredential
        ? { passwordCredential: loaded.account.passwordCredential }
        : {}),
    },
    organization: {
      ...defaults.organization,
      ...loaded.organization,
    },
    ai: {
      ...defaults.ai,
      ...loaded.ai,
    },
    authorizations: loaded.authorizations ?? {},
    oauthCredentials: loaded.oauthCredentials ?? {},
    pendingAuthorizations: loaded.pendingAuthorizations ?? {},
  };
}

async function persistState(state: AlisioStoredState, env?: NodeJS.ProcessEnv) {
  await writeJsonAtomic(stateFilePath(env), state, { trailingNewline: true });
}

function currentDevice(): AlisioLocalDeviceSession {
  const hostname = os.hostname().trim() || "This device";
  return {
    id: `local:${hostname.toLowerCase()}`,
    label: hostname,
    platform: resolvePlatformLabel(),
    current: true,
    status: "active",
    lastSeenAt: new Date().toISOString(),
  };
}

export function listAlisioConnectorDefinitions(): readonly AlisioConnectorDefinition[] {
  return CONNECTOR_CATALOG;
}

export function summarizeAlisioConnectorAuthorizations(
  authorizations: readonly AlisioConnectorAuthorization[],
): AlisioBootstrapConnectorSummary {
  return summarizeConnectorAuthorizations(authorizations);
}

async function refreshStoredAiState(
  state: AlisioStoredState,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  const session = state.ai?.session;
  if (!session) {
    return state;
  }
  const refreshed = await refreshAlisioOpenAiSession({
    session,
    fetchImpl,
  });
  if (!state.ai) {
    state.ai = {};
  }
  state.ai.session = refreshed;
  if (isAlisioAiReady(toAlisioAiState(refreshed))) {
    await applyAlisioOpenAiRuntime(refreshed).catch(() => undefined);
  } else if (refreshed.status === "expired" || refreshed.status === "disconnected") {
    await clearAlisioOpenAiRuntime().catch(() => undefined);
  }
  return state;
}

async function hydrateStoredAccountState(
  state: AlisioStoredState,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  const cloudSession = state.account.cloudSession;
  if (!cloudSession || cloudSession.state !== "signed_in") {
    return state;
  }
  try {
    const restored = await restoreAlisioCloudAccountSession({
      session: cloudSession,
      profile: toCloudAccountProfile(state.account.profile),
      env,
      fetchImpl,
    });
    state.account.cloudSession = restored.session;
    state.account.profile = toLocalAccountProfile(restored.profile);
    state.account.session = toAccountSessionFromCloud(
      restored.session,
      restored.profile.profileCompleted,
      state.account.session,
    );
    return state;
  } catch (error) {
    if (error instanceof AlisioAccountCloudError && error.code === "session_refresh_failed") {
      state.account.cloudSession = {
        ...(state.account.cloudSession ?? {
          backend: resolveAlisioAccountBackend(env),
          state: "signed_out" as const,
        }),
        state: "signed_out",
        signedOutAt: new Date().toISOString(),
      };
      state.account.session = {
        ...state.account.session,
        state: "signed_out",
        signedOutAt: new Date().toISOString(),
      };
      if (state.ai?.session) {
        delete state.ai.session;
        await clearAlisioOpenAiRuntime().catch(() => undefined);
      }
      return state;
    }
    throw error;
  }
}

async function loadHydratedStoredState(
  env?: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStoredState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    await hydrateStoredAccountState(state, env, fetchImpl);
    await refreshStoredAiState(state, env, fetchImpl);
    await persistState(state, env);
    return state;
  });
}

export async function loadAlisioBootstrapSnapshot(
  env?: NodeJS.ProcessEnv,
): Promise<AlisioBootstrapSnapshot> {
  const [account, ai, organization, authorizations] = await Promise.all([
    getAlisioAccountState(env),
    getAlisioAiState(env),
    getAlisioOrganizationState(env),
    listAlisioConnectorAuthorizations(env),
  ]);
  return {
    account,
    ai,
    organization,
    connectors: {
      catalog: listAlisioConnectorDefinitions(),
      authorizations,
      summary: summarizeAlisioConnectorAuthorizations(authorizations),
    },
  };
}

export async function getAlisioAccountState(env?: NodeJS.ProcessEnv): Promise<AlisioAccountState> {
  const state = await loadHydratedStoredState(env);
  return {
    profile: state.account.profile,
    preferences: state.account.preferences,
    session: state.account.session,
    devices: [currentDevice()],
  };
}

export async function getAlisioAiState(env?: NodeJS.ProcessEnv): Promise<AlisioAiState> {
  const state = await loadHydratedStoredState(env);
  return toAlisioAiState(state.ai?.session);
}

export async function updateAlisioAccountProfile(
  patch: Partial<
    Pick<
      AlisioLocalAccountProfile,
      "username" | "displayName" | "email" | "avatarLabel" | "avatarUrl"
    >
  > &
    Partial<AlisioLocalUserPreferences>,
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const nextProfile = {
      ...state.account.profile,
      ...(typeof patch.username === "string"
        ? { username: normalizeAlisioUsername(patch.username) || state.account.profile.username }
        : {}),
      ...(typeof patch.displayName === "string"
        ? { displayName: patch.displayName.trim() || state.account.profile.displayName }
        : {}),
      ...(typeof patch.email === "string"
        ? { email: patch.email.trim() || state.account.profile.email }
        : {}),
      ...(typeof patch.avatarLabel === "string"
        ? {
            avatarLabel:
              patch.avatarLabel.trim().slice(0, 2).toUpperCase() ||
              state.account.profile.avatarLabel,
          }
        : {}),
      ...(typeof patch.avatarUrl === "string"
        ? {
            avatarUrl: patch.avatarUrl.trim() || undefined,
          }
        : {}),
    };
    const validationError = validateAlisioAccountDraft(nextProfile);
    if (validationError) {
      throw new AlisioAccountValidationError(validationError);
    }
    const profilePayload = {
      ...nextProfile,
      avatarLabel: deriveAlisioAvatarLabel(nextProfile),
    };
    if (state.account.cloudSession?.state === "signed_in") {
      const completedProfile = await completeAlisioCloudAccountProfile({
        session: state.account.cloudSession,
        email: profilePayload.email,
        username: profilePayload.username,
        displayName: profilePayload.displayName,
        avatarLabel: profilePayload.avatarLabel,
        avatarUrl: profilePayload.avatarUrl,
        joinedAt: state.account.profile.joinedAt,
        plan: state.account.profile.plan,
        env,
      });
      state.account.profile = toLocalAccountProfile(completedProfile);
      state.account.session = toAccountSessionFromCloud(
        state.account.cloudSession,
        completedProfile.profileCompleted,
        state.account.session,
      );
    } else {
      state.account.profile = profilePayload;
      state.account.session = {
        ...state.account.session,
        profileCompleted: true,
      };
    }
    state.account.preferences = {
      ...state.account.preferences,
      ...(patch.language ? { language: patch.language } : {}),
      ...(patch.theme ? { theme: patch.theme } : {}),
    };
    await persistState(state, env);
    return {
      profile: state.account.profile,
      preferences: state.account.preferences,
      session: state.account.session,
      devices: [currentDevice()],
    };
  });
}

export async function signUpAlisioAccount(
  input: { email: string; password: string },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const result = await signUpAlisioCloudAccount({
      email: input.email,
      password: input.password,
      env,
    });
    state.account.profile = toLocalAccountProfile(result.profile);
    state.account.cloudSession = result.session;
    state.account.session = toAccountSessionFromCloud(
      result.session,
      result.profile.profileCompleted,
      state.account.session,
    );
    state.account.passwordCredential = result.localPasswordCredential;
    await persistState(state, env);
    return {
      profile: state.account.profile,
      preferences: state.account.preferences,
      session: state.account.session,
      devices: [currentDevice()],
    };
  });
}

export async function signInAlisioAccount(
  input: { email: string; password: string },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const result = await signInAlisioCloudAccount({
      email: input.email,
      password: input.password,
      localPasswordCredential: state.account.passwordCredential,
      env,
    });
    const mergedProfile =
      state.account.profile.email.trim().toLowerCase() === input.email.trim().toLowerCase()
        ? {
            ...result.profile,
            joinedAt: state.account.profile.joinedAt || result.profile.joinedAt,
            avatarLabel: state.account.profile.avatarLabel || result.profile.avatarLabel,
            avatarUrl: state.account.profile.avatarUrl || result.profile.avatarUrl,
            displayName: state.account.profile.displayName || result.profile.displayName,
            username: state.account.profile.username || result.profile.username,
            profileCompleted:
              result.profile.profileCompleted || state.account.session.profileCompleted,
          }
        : result.profile;
    state.account.profile = toLocalAccountProfile(mergedProfile);
    state.account.cloudSession = result.session;
    state.account.session = toAccountSessionFromCloud(
      result.session,
      mergedProfile.profileCompleted,
      state.account.session,
    );
    await persistState(state, env);
    return {
      profile: state.account.profile,
      preferences: state.account.preferences,
      session: state.account.session,
      devices: [currentDevice()],
    };
  });
}

export async function signOutAlisioAccount(env?: NodeJS.ProcessEnv): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    if (state.account.cloudSession) {
      await signOutAlisioCloudAccount({
        session: state.account.cloudSession,
        env,
      }).catch(() => undefined);
    }
    state.account.cloudSession = {
      backend: state.account.cloudSession?.backend ?? resolveAlisioAccountBackend(env),
      state: "signed_out",
      ...(state.account.cloudSession?.userId ? { userId: state.account.cloudSession.userId } : {}),
      ...(state.account.profile.email ? { email: state.account.profile.email } : {}),
      signedOutAt: new Date().toISOString(),
    };
    state.account.session = {
      state: "signed_out",
      profileCompleted: state.account.session.profileCompleted,
      signedInAt: state.account.session.signedInAt,
      signedOutAt: new Date().toISOString(),
      backend: state.account.cloudSession.backend,
    };
    if (state.ai?.session) {
      delete state.ai.session;
    }
    if (state.ai?.pending) {
      delete state.ai.pending;
    }
    await clearAlisioOpenAiRuntime().catch(() => undefined);
    await persistState(state, env);
    return {
      profile: state.account.profile,
      preferences: state.account.preferences,
      session: state.account.session,
      devices: [currentDevice()],
    };
  });
}

export async function beginAlisioAiConnect(
  input: {
    callbackUrl: string;
  },
  env?: NodeJS.ProcessEnv,
): Promise<{ setupUrl: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const authorization = await buildAlisioOpenAiAuthorization({
      callbackUrl: input.callbackUrl,
    });
    if (!state.ai) {
      state.ai = {};
    }
    state.ai.pending = authorization.pending;
    await persistState(state, env);
    return {
      setupUrl: authorization.setupUrl,
    };
  });
}

export async function completeAlisioAiConnect(
  input: {
    stateToken?: string | null;
    code?: string | null;
    error?: string | null;
    errorDescription?: string | null;
  },
  env?: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioAiState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const pending = state.ai?.pending;
    if (!pending || !input.stateToken?.trim() || pending.stateToken !== input.stateToken.trim()) {
      throw new AlisioAiError("invalid_callback", "The OpenAI sign-in request is no longer valid.");
    }
    if (input.error?.trim()) {
      if (state.ai?.pending) {
        delete state.ai.pending;
      }
      await persistState(state, env);
      await clearAlisioOpenAiRuntime().catch(() => undefined);
      throw new AlisioAiError(
        "invalid_callback",
        input.errorDescription?.trim() || input.error.trim(),
      );
    }
    if (!input.code?.trim()) {
      throw new AlisioAiError("invalid_callback", "Missing OpenAI authorization code.");
    }
    const session = await completeAlisioOpenAiAuthorization({
      pending,
      code: input.code.trim(),
      fetchImpl,
    });
    if (!state.ai) {
      state.ai = {};
    }
    state.ai.session = session;
    delete state.ai.pending;
    await persistState(state, env);
    await applyAlisioOpenAiRuntime(session);
    return toAlisioAiState(session);
  });
}

export async function disconnectAlisioAi(env?: NodeJS.ProcessEnv): Promise<AlisioAiState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    if (state.ai?.session) {
      delete state.ai.session;
    }
    if (state.ai?.pending) {
      delete state.ai.pending;
    }
    await clearAlisioOpenAiRuntime().catch(() => undefined);
    await persistState(state, env);
    return toAlisioAiState(null);
  });
}

export async function refreshAlisioAiLimits(
  env?: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioAiState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const session = state.ai?.session;
    if (!session) {
      return toAlisioAiState(null);
    }
    const refreshed = await refreshAlisioOpenAiSession({
      session,
      fetchImpl,
    });
    if (!state.ai) {
      state.ai = {};
    }
    state.ai.session = refreshed;
    await persistState(state, env);
    if (isAlisioAiReady(toAlisioAiState(refreshed))) {
      await applyAlisioOpenAiRuntime(refreshed).catch(() => undefined);
    }
    return toAlisioAiState(refreshed);
  });
}

export async function getAlisioOrganizationState(
  env?: NodeJS.ProcessEnv,
): Promise<AlisioOrganizationMembershipState> {
  const state = await loadStoredState(env);
  return state.organization;
}

export async function setAlisioOrganizationState(
  input:
    | { mode: "none" }
    | { mode: "owner"; organizationName: string }
    | { mode: "member"; organizationName: string; inviteEmail?: string },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioOrganizationMembershipState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    state.organization = input;
    await persistState(state, env);
    return state.organization;
  });
}

export async function listAlisioConnectorAuthorizations(
  env?: NodeJS.ProcessEnv,
): Promise<AlisioConnectorAuthorization[]> {
  const state = await loadStoredState(env);
  return CONNECTOR_CATALOG.map((connector) => {
    const existing = state.authorizations[connector.id];
    if (existing) {
      return existing;
    }
    const fallbackHealth: AlisioAuthorizationHealth =
      connector.availability === "ready"
        ? "needs_reconnect"
        : connector.availability === "in_review"
          ? "in_review"
          : "unavailable";
    return {
      connectorId: connector.id,
      state: "not_connected",
      health: fallbackHealth,
      scopes: connector.scopes,
    };
  });
}

function buildStateToken() {
  return randomBytes(24).toString("base64url");
}

function buildCodeVerifier() {
  return randomBytes(48).toString("base64url");
}

function buildCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function resolveConnectorOAuthProvider(connectorId: string): AlisioOAuthProvider | null {
  if (
    connectorId.startsWith("google-") ||
    connectorId === "youtube" ||
    connectorId.startsWith("gmail-")
  ) {
    return "google";
  }
  if (connectorId === "github") {
    return "github";
  }
  if (connectorId === "notion") {
    return "notion";
  }
  if (connectorId === "vercel") {
    return "vercel";
  }
  return null;
}

function providerLabel(provider: AlisioOAuthProvider) {
  switch (provider) {
    case "google":
      return "Google";
    case "github":
      return "GitHub";
    case "notion":
      return "Notion";
    case "vercel":
      return "Vercel";
  }
}

function providerRequiredEnvVars(provider: AlisioOAuthProvider) {
  switch (provider) {
    case "google":
      return [
        "ALISIO_GOOGLE_CLIENT_ID",
        "ALISIO_GOOGLE_CLIENT_SECRET",
        "ALISIO_GOOGLE_REDIRECT_URI",
      ];
    case "github":
      return [
        "ALISIO_GITHUB_CLIENT_ID",
        "ALISIO_GITHUB_CLIENT_SECRET",
        "ALISIO_GITHUB_REDIRECT_URI",
      ];
    case "notion":
      return [
        "ALISIO_NOTION_CLIENT_ID",
        "ALISIO_NOTION_CLIENT_SECRET",
        "ALISIO_NOTION_REDIRECT_URI",
      ];
    case "vercel":
      return [
        "ALISIO_VERCEL_CLIENT_ID",
        "ALISIO_VERCEL_CLIENT_SECRET",
        "ALISIO_VERCEL_REDIRECT_URI",
      ];
  }
}

function providerCallbackPath(provider: AlisioOAuthProvider): string | undefined {
  switch (provider) {
    case "google":
      return "/oauth/google/callback";
    case "github":
      return "/oauth/github/callback";
    default:
      return undefined;
  }
}

function providerSetupHint(provider: AlisioOAuthProvider, connectorTitle: string) {
  const label = providerLabel(provider);
  if (provider === "google" || provider === "github") {
    return `${connectorTitle} can complete native ${label} OAuth in Alisio as soon as the provider app credentials are configured on this gateway.`;
  }
  return `${connectorTitle} is modeled in the product already, but the native ${label} OAuth callback is still pending in this rollout.`;
}

function resolveOAuthClientConfig(provider: AlisioOAuthProvider, env: NodeJS.ProcessEnv) {
  switch (provider) {
    case "google":
      return {
        clientId: env.ALISIO_GOOGLE_CLIENT_ID?.trim() || "",
        clientSecret: env.ALISIO_GOOGLE_CLIENT_SECRET?.trim() || "",
        redirectUri: env.ALISIO_GOOGLE_REDIRECT_URI?.trim() || "",
      };
    case "github":
      return {
        clientId: env.ALISIO_GITHUB_CLIENT_ID?.trim() || "",
        clientSecret: env.ALISIO_GITHUB_CLIENT_SECRET?.trim() || "",
        redirectUri: env.ALISIO_GITHUB_REDIRECT_URI?.trim() || "",
      };
    case "notion":
      return {
        clientId: env.ALISIO_NOTION_CLIENT_ID?.trim() || "",
        clientSecret: env.ALISIO_NOTION_CLIENT_SECRET?.trim() || "",
        redirectUri: env.ALISIO_NOTION_REDIRECT_URI?.trim() || "",
      };
    case "vercel":
      return {
        clientId: env.ALISIO_VERCEL_CLIENT_ID?.trim() || "",
        clientSecret: env.ALISIO_VERCEL_CLIENT_SECRET?.trim() || "",
        redirectUri: env.ALISIO_VERCEL_REDIRECT_URI?.trim() || "",
      };
  }
}

export async function requestAlisioAccountPasswordReset(
  input: { email: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; message: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new AlisioAccountValidationError("Enter the email for the Alisio account first.");
  }
  return requestAlisioCloudPasswordReset({ email, env });
}

function providerSupportsRealCallback(
  provider: AlisioOAuthProvider,
): provider is "google" | "github" {
  return provider === "google" || provider === "github";
}

function buildAuthorizationUrl(params: {
  provider: AlisioOAuthProvider;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  stateToken: string;
  codeVerifier?: string;
}) {
  const authScopes =
    params.provider === "github"
      ? ["repo", "read:user", "user:email", "read:org", "gist"]
      : params.scopes;
  const url = new URL(
    params.provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : params.provider === "github"
        ? "https://github.com/login/oauth/authorize"
        : params.provider === "notion"
          ? "https://api.notion.com/v1/oauth/authorize"
          : "https://vercel.com/oauth/authorize",
  );
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.stateToken);

  if (params.provider === "google") {
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("scope", authScopes.join(" "));
    if (params.codeVerifier) {
      url.searchParams.set("code_challenge", buildCodeChallenge(params.codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  if (params.provider === "github") {
    url.searchParams.set("scope", authScopes.join(" "));
    return url.toString();
  }

  if (params.provider === "notion") {
    url.searchParams.set("owner", "user");
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  url.searchParams.set("scope", authScopes.join(" "));
  return url.toString();
}

function parseGrantedScopes(scope: string | undefined, fallback: readonly string[]) {
  if (!scope?.trim()) {
    return [...fallback];
  }
  const normalized = scope
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [...fallback];
}

function isPendingAuthorizationExpired(createdAt: string, now = Date.now()) {
  const createdAtMs = Date.parse(createdAt);
  if (Number.isNaN(createdAtMs)) {
    return true;
  }
  return now - createdAtMs > PENDING_AUTHORIZATION_TTL_MS;
}

export async function beginAlisioConnectorSetup(
  connectorId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AlisioConnectorsBeginResult | null> {
  return withLock(async () => {
    const connector = CONNECTOR_CATALOG.find((entry) => entry.id === connectorId.trim());
    if (!connector) {
      return null;
    }
    const provider = resolveConnectorOAuthProvider(connector.id);
    const providerGuide =
      provider == null
        ? {}
        : {
            provider,
            providerLabel: providerLabel(provider),
            callbackPath: providerCallbackPath(provider),
            requiredEnvVars: providerRequiredEnvVars(provider),
            setupHint: providerSetupHint(provider, connector.title),
          };
    if (connector.availability === "in_review") {
      return {
        connectorId: connector.id,
        availability: connector.availability,
        mode: "setup",
        statusReason: "review_required",
        setupUrl: connector.setupUrl,
        ...providerGuide,
      };
    }
    if (connector.availability === "unavailable") {
      return {
        connectorId: connector.id,
        availability: connector.availability,
        mode: "setup",
        statusReason: "unavailable",
        setupUrl: connector.setupUrl,
        ...providerGuide,
      };
    }

    if (!provider) {
      return {
        connectorId: connector.id,
        availability: connector.availability,
        mode: "setup",
        statusReason: "missing_client_config",
        setupUrl: connector.setupUrl,
      };
    }
    if (!providerSupportsRealCallback(provider)) {
      return {
        connectorId: connector.id,
        availability: connector.availability,
        mode: "setup",
        statusReason: "unavailable",
        setupUrl: connector.setupUrl,
        ...providerGuide,
      };
    }
    const config = resolveOAuthClientConfig(provider, env);
    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      return {
        connectorId: connector.id,
        availability: connector.availability,
        mode: "setup",
        statusReason: "missing_client_config",
        setupUrl: connector.setupUrl,
        ...providerGuide,
      };
    }

    const state = await loadStoredState(env);
    const stateToken = buildStateToken();
    const codeVerifier = provider === "google" ? buildCodeVerifier() : undefined;
    state.pendingAuthorizations[stateToken] = {
      connectorId: connector.id,
      provider,
      redirectUri: config.redirectUri,
      createdAt: new Date().toISOString(),
      ...(codeVerifier ? { codeVerifier } : {}),
    };
    await persistState(state, env);

    return {
      connectorId: connector.id,
      availability: connector.availability,
      mode: "oauth",
      provider,
      providerLabel: providerLabel(provider),
      statusReason: "ready_for_oauth",
      setupUrl: buildAuthorizationUrl({
        provider,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        scopes: connector.scopes,
        stateToken,
        codeVerifier,
      }),
      redirectUri: config.redirectUri,
      callbackPath: providerCallbackPath(provider),
    };
  });
}

async function exchangeGoogleAuthorizationCode(params: {
  config: ReturnType<typeof resolveOAuthClientConfig>;
  code: string;
  codeVerifier?: string;
  fetchImpl: typeof fetch;
}): Promise<AlisioOAuthTokenSet | null> {
  try {
    const response = await params.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: params.config.clientId,
        client_secret: params.config.clientSecret,
        code: params.code,
        grant_type: "authorization_code",
        redirect_uri: params.config.redirectUri,
        ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}),
      }),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !body || typeof body.access_token !== "string") {
      return null;
    }
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      tokenType: typeof body.token_type === "string" ? body.token_type : undefined,
      scope: typeof body.scope === "string" ? body.scope : undefined,
      expiresIn: typeof body.expires_in === "number" ? body.expires_in : undefined,
    };
  } catch {
    return null;
  }
}

async function exchangeGitHubAuthorizationCode(params: {
  config: ReturnType<typeof resolveOAuthClientConfig>;
  code: string;
  stateToken: string;
  fetchImpl: typeof fetch;
}): Promise<AlisioOAuthTokenSet | null> {
  try {
    const response = await params.fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Alisio",
      },
      body: new URLSearchParams({
        client_id: params.config.clientId,
        client_secret: params.config.clientSecret,
        code: params.code,
        redirect_uri: params.config.redirectUri,
        state: params.stateToken,
      }),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !body || typeof body.access_token !== "string") {
      return null;
    }
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      tokenType: typeof body.token_type === "string" ? body.token_type : undefined,
      scope: typeof body.scope === "string" ? body.scope : undefined,
    };
  } catch {
    return null;
  }
}

async function fetchGoogleAccount(params: { accessToken: string; fetchImpl: typeof fetch }) {
  try {
    const response = await params.fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !body) {
      return null;
    }
    return {
      label:
        (typeof body.name === "string" && body.name.trim()) ||
        (typeof body.email === "string" && body.email.trim()) ||
        "Google account",
      email: typeof body.email === "string" ? body.email : undefined,
      handle: typeof body.sub === "string" ? body.sub : undefined,
    } satisfies AlisioConnectedAccount;
  } catch {
    return null;
  }
}

async function fetchGitHubPrimaryEmail(params: { accessToken: string; fetchImpl: typeof fetch }) {
  try {
    const response = await params.fetchImpl("https://api.github.com/user/emails", {
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "Alisio",
      },
    });
    const body = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
    if (!response.ok || !body) {
      return undefined;
    }
    const primary =
      body.find((entry) => entry.primary === true && typeof entry.email === "string") ??
      body.find((entry) => entry.verified === true && typeof entry.email === "string") ??
      body.find((entry) => typeof entry.email === "string");
    return primary && typeof primary.email === "string" ? primary.email : undefined;
  } catch {
    return undefined;
  }
}

async function fetchGitHubAccount(params: { accessToken: string; fetchImpl: typeof fetch }) {
  try {
    const response = await params.fetchImpl("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "Alisio",
      },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !body) {
      return null;
    }
    const fallbackEmail = await fetchGitHubPrimaryEmail(params);
    return {
      label:
        (typeof body.name === "string" && body.name.trim()) ||
        (typeof body.login === "string" && body.login.trim()) ||
        "GitHub account",
      email: (typeof body.email === "string" && body.email.trim()) || fallbackEmail || undefined,
      handle: typeof body.login === "string" ? body.login : undefined,
    } satisfies AlisioConnectedAccount;
  } catch {
    return null;
  }
}

export async function completeAlisioConnectorAuthorizationFromCallback(
  input: {
    provider: string;
    stateToken?: string | null;
    code?: string | null;
    error?: string | null;
    errorDescription?: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioOAuthCallbackResult> {
  if (input.provider !== "google" && input.provider !== "github") {
    return {
      ok: false,
      reason: "unknown_provider",
      message: "OAuth provider is not supported by this callback.",
    };
  }
  if (!input.stateToken?.trim()) {
    return {
      ok: false,
      reason: "missing_state",
      message: "Missing OAuth state token.",
    };
  }
  return withLock(async () => {
    const state = await loadStoredState(env);
    const pending = state.pendingAuthorizations[input.stateToken!];
    if (!pending) {
      return {
        ok: false,
        reason: "pending_not_found",
        message: "This OAuth request is no longer pending.",
      } satisfies AlisioOAuthCallbackResult;
    }
    if (isPendingAuthorizationExpired(pending.createdAt)) {
      delete state.pendingAuthorizations[input.stateToken!];
      await persistState(state, env);
      return {
        ok: false,
        reason: "pending_not_found",
        message: "This OAuth request expired. Start the connection again from Alisio.",
      } satisfies AlisioOAuthCallbackResult;
    }
    if (pending.provider !== input.provider) {
      return {
        ok: false,
        reason: "provider_mismatch",
        message: "OAuth provider does not match the pending request.",
      } satisfies AlisioOAuthCallbackResult;
    }
    if (input.error?.trim()) {
      delete state.pendingAuthorizations[input.stateToken!];
      await persistState(state, env);
      return {
        ok: false,
        reason: "oauth_denied",
        message: input.errorDescription?.trim() || input.error.trim(),
      } satisfies AlisioOAuthCallbackResult;
    }
    if (!input.code?.trim()) {
      return {
        ok: false,
        reason: "missing_code",
        message: "Missing OAuth authorization code.",
      } satisfies AlisioOAuthCallbackResult;
    }

    const config = resolveOAuthClientConfig(pending.provider, env);
    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      return {
        ok: false,
        reason: "missing_client_config",
        message: "OAuth client configuration is incomplete on this gateway.",
      } satisfies AlisioOAuthCallbackResult;
    }
    if (pending.redirectUri !== config.redirectUri) {
      delete state.pendingAuthorizations[input.stateToken!];
      await persistState(state, env);
      return {
        ok: false,
        reason: "missing_client_config",
        message: "OAuth redirect configuration changed before the callback completed.",
      } satisfies AlisioOAuthCallbackResult;
    }

    const exchanged =
      pending.provider === "google"
        ? await exchangeGoogleAuthorizationCode({
            config,
            code: input.code.trim(),
            codeVerifier: pending.codeVerifier,
            fetchImpl,
          })
        : await exchangeGitHubAuthorizationCode({
            config,
            code: input.code.trim(),
            stateToken: input.stateToken!,
            fetchImpl,
          });
    if (!exchanged) {
      delete state.pendingAuthorizations[input.stateToken!];
      await persistState(state, env);
      return {
        ok: false,
        reason: "token_exchange_failed",
        message: "Failed to exchange OAuth code for an access token.",
      } satisfies AlisioOAuthCallbackResult;
    }

    const connectedAccount =
      pending.provider === "google"
        ? await fetchGoogleAccount({ accessToken: exchanged.accessToken, fetchImpl })
        : await fetchGitHubAccount({ accessToken: exchanged.accessToken, fetchImpl });
    if (!connectedAccount) {
      delete state.pendingAuthorizations[input.stateToken!];
      await persistState(state, env);
      return {
        ok: false,
        reason: "profile_fetch_failed",
        message: "OAuth token exchange succeeded, but the account profile could not be loaded.",
      } satisfies AlisioOAuthCallbackResult;
    }

    const connector = CONNECTOR_CATALOG.find((entry) => entry.id === pending.connectorId);
    if (!connector) {
      delete state.pendingAuthorizations[input.stateToken!];
      await persistState(state, env);
      return {
        ok: false,
        reason: "pending_not_found",
        message: "Connector metadata was not found for this authorization.",
      } satisfies AlisioOAuthCallbackResult;
    }

    const connectedAt = new Date().toISOString();
    const authorization: AlisioConnectorAuthorization = {
      connectorId: connector.id,
      state: "connected",
      health: "healthy",
      connectedAt,
      scopes: parseGrantedScopes(exchanged.scope, connector.scopes),
      connectedAccount,
    };
    state.authorizations[connector.id] = authorization;
    state.oauthCredentials[connector.id] = {
      provider: pending.provider,
      accessToken: exchanged.accessToken,
      ...(exchanged.refreshToken ? { refreshToken: exchanged.refreshToken } : {}),
      ...(exchanged.tokenType ? { tokenType: exchanged.tokenType } : {}),
      ...(exchanged.scope ? { scope: exchanged.scope } : {}),
      ...(typeof exchanged.expiresIn === "number"
        ? { expiresAt: new Date(Date.now() + exchanged.expiresIn * 1000).toISOString() }
        : {}),
      createdAt: connectedAt,
    };
    delete state.pendingAuthorizations[input.stateToken!];
    await persistState(state, env);
    return {
      ok: true,
      authorization,
    } satisfies AlisioOAuthCallbackResult;
  });
}

export async function completeAlisioConnectorAuthorization(
  input: {
    connectorId: string;
    account?: AlisioConnectedAccount;
  },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioConnectorAuthorization | null> {
  return withLock(async () => {
    const connector = CONNECTOR_CATALOG.find((entry) => entry.id === input.connectorId.trim());
    if (!connector || connector.availability !== "ready") {
      return null;
    }
    const provider = resolveConnectorOAuthProvider(connector.id);
    if (provider === "google" || provider === "github") {
      return null;
    }
    const state = await loadStoredState(env);
    const connectedAccount =
      input.account ??
      ({
        label: state.account.profile.displayName,
        email: state.account.profile.email,
      } satisfies AlisioConnectedAccount);
    const authorization: AlisioConnectorAuthorization = {
      connectorId: connector.id,
      state: "connected",
      health: "healthy",
      connectedAt: new Date().toISOString(),
      scopes: connector.scopes,
      connectedAccount,
    };
    state.authorizations[connector.id] = authorization;
    await persistState(state, env);
    return authorization;
  });
}

export async function revokeAlisioConnectorAuthorization(
  connectorId: string,
  env?: NodeJS.ProcessEnv,
): Promise<AlisioConnectorAuthorization | null> {
  return withLock(async () => {
    const connector = CONNECTOR_CATALOG.find((entry) => entry.id === connectorId.trim());
    if (!connector) {
      return null;
    }
    const state = await loadStoredState(env);
    delete state.authorizations[connector.id];
    delete state.oauthCredentials[connector.id];
    await persistState(state, env);
    const health: AlisioAuthorizationHealth =
      connector.availability === "ready"
        ? "needs_reconnect"
        : connector.availability === "in_review"
          ? "in_review"
          : "unavailable";
    return {
      connectorId: connector.id,
      state: "not_connected",
      health,
      scopes: connector.scopes,
    };
  });
}
