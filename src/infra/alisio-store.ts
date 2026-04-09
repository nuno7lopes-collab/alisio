import { execFileSync, execSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { resolveLegacyStateDirs, resolveNewStateDir, resolveStateDir } from "../config/paths.js";
import {
  type AlisioAccountAuthMethod,
  deriveAlisioAvatarLabel,
  normalizeAlisioAgentName,
  normalizeAlisioBirthdate,
  normalizeAlisioUsername,
  validateAlisioAccountDraft,
  validateAlisioEmail,
} from "../shared/alisio-account.js";
import { normalizeAlisioPlan, type AlisioPlan } from "../shared/alisio-billing.js";
import { summarizeAlisioConnectorUiStatuses } from "../shared/alisio-connector-status.js";
import {
  ALISIO_REQUIRED_SUPABASE_ENV_VARS,
  AlisioAccountCloudError,
  listMissingRequiredAlisioCloudEnvVars,
  beginAlisioCloudAccountEmailAuth,
  buildAlisioCloudGoogleAuthUrl,
  completeAlisioCloudAccountEmailLinkAuth,
  completeAlisioCloudAccountProfile,
  exchangeAlisioCloudGoogleAuthCode,
  requestAlisioCloudAccountEmailChange,
  verifyAlisioCloudAccountEmailAuth,
  requestAlisioCloudPasswordReset,
  resolveAlisioAccountBackend,
  restoreAlisioCloudAccountSession,
  signInAlisioCloudAccount,
  signOutAlisioCloudAccount,
  signUpAlisioCloudAccount,
  updateAlisioCloudAccountPassword,
  type AlisioAccountBackend,
  type AlisioCloudAccountProfile,
  type AlisioStoredCloudSession,
  type AlisioStoredPasswordCredential,
} from "./alisio-account-cloud.js";
import {
  buildAlisioAiLocalTelemetry,
  buildAlisioAiProfileId,
  buildAlisioWorkerAuthProfileId,
  buildAlisioWorkerCredentialId,
  resolveAggregatedTelemetry,
  resolveAlisioAiCanonicalIdentity,
  resolveAlisioAiProfileLabel,
  selectBestWorkerCredentialForProfile,
  toAlisioAiState,
  type AlisioAiCredentialSelection,
  type AlisioAiLocalTelemetry,
  type AlisioAiState,
  type AlisioLegacyStoredAiSession,
  type AlisioStoredAiProfile,
  type AlisioStoredRuntimeBinding,
  type AlisioStoredWorkerAiCredential,
  type AlisioAiOwnerContext,
} from "./alisio-ai-state.js";
import {
  AlisioAiError,
  applyAlisioOpenAiRuntime,
  buildAlisioOpenAiAuthorization,
  clearAlisioOpenAiRuntime,
  completeAlisioOpenAiAuthorization,
  refreshAlisioOpenAiSession,
  resolveAlisioOpenAiTokenIdentity,
  type AlisioStoredAiState,
} from "./alisio-ai.js";
import {
  countAlisioLimitedConnectorSlots,
  gateAlisioConnectorConnection,
  gateAlisioOrganizationMembership,
  gateAlisioRemoteModelServers,
  gateAlisioSharing,
} from "./alisio-plan-gating.js";
import {
  appendAlisioSharingCloudAuditEntry,
  canUseAlisioSharingCloud,
  loadAlisioSharingCloudState,
  upsertAlisioSharingCloudGrant,
  upsertAlisioSharingCloudPolicy,
  upsertAlisioSharingCloudRequest,
  type AlisioSharingCloudPrincipal,
  type AlisioSharingCloudRuntimeTarget,
} from "./alisio-sharing-cloud.js";
import { warnLegacyCompatibilityOnce } from "./compat-warning.js";
import { resolveRequiredHomeDir } from "./home-dir.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "./json-files.js";
import { autoMigrateLegacyStateDir } from "./state-migrations.js";

export type AlisioConnectorCategory = "social" | "google" | "productivity" | "development";

export type AlisioConnectorAvailability = "ready" | "in_review" | "unavailable";
export type AlisioAuthorizationState = "not_connected" | "connected" | "needs_reconnect";
export type AlisioAuthorizationHealth =
  | "healthy"
  | "needs_reconnect"
  | "config_missing"
  | "in_review"
  | "unavailable";
export type AlisioConnectorBeginMode = "oauth" | "setup";
export type AlisioConnectorBeginReason =
  | "ready_for_oauth"
  | "missing_client_config"
  | "missing_token_encryption"
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
  agentName?: string;
  avatarLabel: string;
  avatarUrl?: string;
  termsAcceptedAt?: string;
  marketingOptIn?: boolean;
  birthdate?: string;
  joinedAt: string;
  plan: AlisioPlan;
  backend?: "supabase";
};

export type AlisioLocalUserPreferences = {
  language: AlisioPreferredLanguage;
  theme: AlisioPreferredTheme;
};

export type AlisioAccountSession = {
  state: AlisioAccountSessionState;
  profileCompleted: boolean;
  authMethod?: AlisioAccountAuthMethod;
  signedInAt?: string;
  signedOutAt?: string;
  backend?: "supabase";
};

export type AlisioAccountCloudState = {
  backend: AlisioAccountBackend;
  available: boolean;
  missingEnvVars: Array<(typeof ALISIO_REQUIRED_SUPABASE_ENV_VARS)[number]>;
};

export type AlisioLocalDeviceSession = {
  id: string;
  label: string;
  platform: string;
  current: boolean;
  status: "active";
  lastSeenAt: string;
};

export type AlisioRemoteModelServerKind = "openai-compatible" | "ollama";

export type AlisioRemoteModelServer = {
  serverId: string;
  label: string;
  kind: AlisioRemoteModelServerKind;
  baseUrl: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  apiKey?: string;
  apiKeyEncrypted?: AlisioEncryptedToken;
};

export type AlisioOrganizationMembershipState = {
  mode: "none" | "owner" | "member";
  organizationName?: string;
  inviteEmail?: string;
};

export type AlisioSharingScope = "read-only" | "model-use" | "exec";
export type AlisioSharingOwnerScope = "user" | "organization";
export type AlisioSharingRequestStatus = "pending" | "approved" | "denied" | "revoked";
export type AlisioSharingTargetSourceKind = "current" | "node";
export type AlisioSharingTargetAccess = "owner" | "shared" | "requestable" | "blocked";
type AlisioLegacySharingScope = "device.use" | "model.use";
type AlisioStoredSharingScope = AlisioSharingScope | AlisioLegacySharingScope;
type AlisioLegacySharingRequestStatus = "rejected";
type AlisioStoredSharingRequestStatus =
  | AlisioSharingRequestStatus
  | AlisioLegacySharingRequestStatus;

export type AlisioSharingPrincipal = {
  ownerKey: string;
  ownerScope: AlisioSharingOwnerScope;
  label: string;
  email?: string;
};

export type AlisioSharingRuntimeTarget = {
  targetId: string;
  label: string;
  platform?: string;
  sourceKind: AlisioSharingTargetSourceKind;
  connected: boolean;
  current: boolean;
};

export type AlisioSharingTargetState = AlisioSharingRuntimeTarget & {
  ownerKey: string;
  ownerScope: AlisioSharingOwnerScope;
  ownerLabel: string;
  ownerEmail?: string;
  registeredAt: string;
  updatedAt: string;
  deviceAccess: AlisioSharingTargetAccess;
  modelAccess: AlisioSharingTargetAccess;
  execAccess: AlisioSharingTargetAccess;
  requestId?: string;
  requestStatus?: AlisioSharingRequestStatus;
  /** @deprecated Compatibility alias for grantId. Sunset target: 2026-06-30. */
  approvalId?: string;
  /** @deprecated Compatibility alias for grantScopes. Sunset target: 2026-06-30. */
  approvalScopes?: AlisioSharingScope[];
  grantId?: string;
  grantScopes?: AlisioSharingScope[];
};

export type AlisioSharingRequestState = {
  requestId: string;
  targetId: string;
  targetLabel: string;
  targetPlatform?: string;
  targetSourceKind: AlisioSharingTargetSourceKind;
  requester: AlisioSharingPrincipal;
  owner: AlisioSharingPrincipal;
  scopes: AlisioSharingScope[];
  status: AlisioSharingRequestStatus;
  createdAt: string;
  resolvedAt?: string;
  /** @deprecated Compatibility alias for grantId. Sunset target: 2026-06-30. */
  approvalId?: string;
  grantId?: string;
};

export type AlisioSharingGrantState = {
  /** @deprecated Compatibility alias for grantId. Sunset target: 2026-06-30. */
  approvalId: string;
  grantId: string;
  requestId: string;
  targetId: string;
  targetLabel: string;
  targetPlatform?: string;
  targetSourceKind: AlisioSharingTargetSourceKind;
  owner: AlisioSharingPrincipal;
  grantee: AlisioSharingPrincipal;
  scopes: AlisioSharingScope[];
  approvedAt: string;
  revokedAt?: string;
};

export type AlisioSharingAuditAction =
  | "policy.updated"
  | "request.created"
  | "request.approved"
  | "request.denied"
  | "grant.revoked";

export type AlisioSharingAuditEntry = {
  entryId: string;
  action: AlisioSharingAuditAction;
  actor: AlisioSharingPrincipal;
  targetId?: string;
  targetLabel?: string;
  requestId?: string;
  grantId?: string;
  summary: string;
  createdAt: string;
};

export type AlisioSharingPolicyState = {
  ownerKey: string;
  allowExternalUse: boolean;
  updatedAt: string;
  updatedBy: AlisioSharingPrincipal;
};

export type AlisioSharingState = {
  viewer: AlisioSharingPrincipal;
  planSupported: boolean;
  policy: {
    ownerKey?: string;
    ownerLabel?: string;
    allowExternalUse: boolean;
    editable: boolean;
    upgradeMessage?: string;
  };
  devices: {
    owned: AlisioSharingTargetState[];
    sharedWithMe: AlisioSharingTargetState[];
    available: AlisioSharingTargetState[];
  };
  incomingRequests: AlisioSharingRequestState[];
  outgoingRequests: AlisioSharingRequestState[];
  approvals: AlisioSharingGrantState[];
  grants: AlisioSharingGrantState[];
  audit: AlisioSharingAuditEntry[];
};

type AlisioStoredSharingTarget = {
  targetId: string;
  label: string;
  platform?: string;
  sourceKind: AlisioSharingTargetSourceKind;
  connected: boolean;
  current: boolean;
  ownerKey: string;
  ownerScope: AlisioSharingOwnerScope;
  ownerLabel: string;
  ownerEmail?: string;
  registeredAt: string;
  updatedAt: string;
};

type AlisioStoredSharingRequest = {
  requestId: string;
  targetId: string;
  targetLabel: string;
  targetPlatform?: string;
  targetSourceKind: AlisioSharingTargetSourceKind;
  requester: AlisioSharingPrincipal;
  owner: AlisioSharingPrincipal;
  scopes: AlisioStoredSharingScope[];
  status: AlisioStoredSharingRequestStatus;
  createdAt: string;
  resolvedAt?: string;
  grantId?: string;
};

type AlisioStoredSharingGrant = {
  grantId: string;
  requestId: string;
  targetId: string;
  targetLabel: string;
  targetPlatform?: string;
  targetSourceKind: AlisioSharingTargetSourceKind;
  owner: AlisioSharingPrincipal;
  grantee: AlisioSharingPrincipal;
  scopes: AlisioStoredSharingScope[];
  approvedAt: string;
  revokedAt?: string;
};

type AlisioStoredSharingAuditAction = AlisioSharingAuditAction | "request.rejected";

type AlisioStoredSharingAuditEntry = Omit<AlisioSharingAuditEntry, "action"> & {
  action: AlisioStoredSharingAuditAction;
};

type AlisioStoredSharingState = {
  policies?: Record<string, AlisioSharingPolicyState>;
  targets?: Record<string, AlisioStoredSharingTarget>;
  requests?: Record<string, AlisioStoredSharingRequest>;
  grants?: Record<string, AlisioStoredSharingGrant>;
  audit?: AlisioStoredSharingAuditEntry[];
};

export type AlisioAccountState = {
  profile: AlisioLocalAccountProfile;
  preferences: AlisioLocalUserPreferences;
  session: AlisioAccountSession;
  devices: AlisioLocalDeviceSession[];
  cloud: AlisioAccountCloudState;
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
  ai?: AlisioStoredAiState;
  sharing?: AlisioStoredSharingState;
  authorizations: Record<string, AlisioConnectorAuthorization>;
  modelServers?: Record<string, AlisioRemoteModelServer>;
  oauthCredentials: Record<
    string,
    {
      provider: AlisioOAuthProvider;
      accessToken?: string;
      refreshToken?: string;
      accessTokenEncrypted?: {
        iv: string;
        tag: string;
        ciphertext: string;
      };
      refreshTokenEncrypted?: {
        iv: string;
        tag: string;
        ciphertext: string;
      };
      tokenType?: string;
      scope?: string;
      expiresAt?: string;
      createdAt: string;
      refreshedAt?: string;
    }
  >;
  pendingAuthorizations: Record<
    string,
    {
      connectorId: string;
      provider: AlisioOAuthProvider;
      redirectUri: string;
      requestedScopes: string[];
      createdAt: string;
      codeVerifier?: string;
    }
  >;
  pendingAccountAuths?: Record<
    string,
    {
      provider: "google";
      createdAt: string;
      callbackUrl: string;
      codeVerifier: string;
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
        | "missing_token_encryption"
        | "oauth_denied"
        | "plan_upgrade_required"
        | "token_exchange_failed"
        | "profile_fetch_failed";
      message: string;
    };

export type AlisioGmailSendResult =
  | {
      ok: true;
      status: "sent";
      connectorId: "gmail-send";
      messageId: string;
      threadId?: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
    }
  | {
      ok: false;
      status: "auth_required" | "send_failed";
      connectorId: "gmail-send";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

type AlisioOAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
};

const STORE_FILENAME = "alisio/state.json";
const PENDING_AUTHORIZATION_TTL_MS = 15 * 60 * 1000;
const ALISIO_SHARING_AUDIT_LIMIT = 100;
const ALISIO_DEFAULT_SHARING_SCOPES: readonly AlisioSharingScope[] = ["read-only", "model-use"];
const CONNECTOR_TOKEN_ENCRYPTION_KEY_ENV = "ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY";
const ALISIO_CONNECTOR_TOKEN_KEYCHAIN_SERVICE = "Alisio Connector Token Encryption";
const LEGACY_ALISIO_CONNECTOR_TOKEN_KEYCHAIN_SERVICE = `${["Open", "Claw"].join("")} Alisio Connector Token Encryption`;
const GMAIL_SEND_CONNECTOR_ID = "gmail-send";
const withLock = createAsyncLock();

type AlisioEncryptedToken = {
  iv: string;
  tag: string;
  ciphertext: string;
};

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

async function ensureAlisioStateDirReady(env: NodeJS.ProcessEnv): Promise<void> {
  await autoMigrateLegacyStateDir({ env });
}

function decodeConnectorTokenEncryptionKey(raw: string) {
  const decoders = [
    () => Buffer.from(raw, "base64"),
    () => Buffer.from(raw, "hex"),
    () => Buffer.from(raw, "utf8"),
  ];
  for (const decode of decoders) {
    try {
      const key = decode();
      if (key.byteLength === 32) {
        return key;
      }
    } catch {
      // Try the next supported encoding.
    }
  }
  return null;
}

function shouldUseConnectorTokenKeychain(env: NodeJS.ProcessEnv) {
  return process.platform === "darwin" && !("VITEST" in env);
}

function hasUsableConnectorTokenKeychain(
  env: NodeJS.ProcessEnv,
  execFileSyncImpl: typeof execFileSync = execFileSync,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "darwin" || "VITEST" in env) {
    return false;
  }
  try {
    const result = execFileSyncImpl("security", ["default-keychain", "-d", "user"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

function buildConnectorTokenKeychainAccount(stateRoot: string) {
  const hash = createHash("sha256").update(path.resolve(stateRoot)).digest("hex");
  return `state|${hash.slice(0, 16)}`;
}

function resolveConnectorTokenKeychainAccounts(env: NodeJS.ProcessEnv): string[] {
  const homeDir = () => resolveRequiredHomeDir(env, os.homedir);
  const stateRoots = [
    resolveStateDir(env),
    resolveNewStateDir(homeDir),
    ...resolveLegacyStateDirs(homeDir),
  ];
  return [...new Set(stateRoots.map((root) => buildConnectorTokenKeychainAccount(root)))];
}

function resolveConnectorTokenKeychainAccount(env: NodeJS.ProcessEnv) {
  return resolveConnectorTokenKeychainAccounts(env)[0];
}

function readConnectorTokenKeychainSecret(
  env: NodeJS.ProcessEnv,
  execSyncImpl: typeof execSync = execSync,
  execFileSyncImpl: typeof execFileSync = execFileSync,
) {
  if (!hasUsableConnectorTokenKeychain(env, execFileSyncImpl)) {
    return null;
  }
  for (const service of [
    ALISIO_CONNECTOR_TOKEN_KEYCHAIN_SERVICE,
    LEGACY_ALISIO_CONNECTOR_TOKEN_KEYCHAIN_SERVICE,
  ]) {
    for (const account of resolveConnectorTokenKeychainAccounts(env)) {
      try {
        const secret = execSyncImpl(
          `security find-generic-password -s "${service}" -a "${account}" -w`,
          {
            encoding: "utf8",
            timeout: 5_000,
            stdio: ["pipe", "pipe", "pipe"],
          },
        ).trim();
        if (secret) {
          return secret;
        }
      } catch {
        // Try the next compatible keychain account or service name.
      }
    }
  }
  return null;
}

function writeConnectorTokenKeychainSecret(
  env: NodeJS.ProcessEnv,
  value: string,
  execFileSyncImpl: typeof execFileSync = execFileSync,
) {
  if (!hasUsableConnectorTokenKeychain(env, execFileSyncImpl)) {
    return false;
  }
  const account = resolveConnectorTokenKeychainAccount(env);
  try {
    execFileSyncImpl(
      "security",
      [
        "add-generic-password",
        "-U",
        "-s",
        ALISIO_CONNECTOR_TOKEN_KEYCHAIN_SERVICE,
        "-a",
        account,
        "-w",
        value,
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return true;
  } catch {
    return false;
  }
}

function resolveConnectorTokenEncryptionKey(
  env: NodeJS.ProcessEnv,
  options?: { createIfMissing?: boolean },
) {
  const raw = env[CONNECTOR_TOKEN_ENCRYPTION_KEY_ENV]?.trim() || "";
  if (raw) {
    return decodeConnectorTokenEncryptionKey(raw);
  }
  const keychainSecret = readConnectorTokenKeychainSecret(env);
  if (keychainSecret) {
    return decodeConnectorTokenEncryptionKey(keychainSecret);
  }
  if (!options?.createIfMissing || !shouldUseConnectorTokenKeychain(env)) {
    return null;
  }
  const generated = randomBytes(32).toString("base64");
  if (!writeConnectorTokenKeychainSecret(env, generated)) {
    return null;
  }
  return Buffer.from(generated, "base64");
}

export const __testing = {
  hasUsableConnectorTokenKeychain,
  resolveConnectorTokenKeychainAccounts,
};

function encryptConnectorToken(plaintext: string, env: NodeJS.ProcessEnv) {
  const key = resolveConnectorTokenEncryptionKey(env, { createIfMissing: true });
  if (!key) {
    return null;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function secureLocalTokenStorageRequiredMessage(action = "continue") {
  return `Secure local token storage is required. Restore the macOS login keychain or configure ${CONNECTOR_TOKEN_ENCRYPTION_KEY_ENV} before you ${action}.`;
}

function decryptConnectorToken(
  encrypted:
    | {
        iv: string;
        tag: string;
        ciphertext: string;
      }
    | undefined,
  env: NodeJS.ProcessEnv,
) {
  if (!encrypted) {
    return null;
  }
  const key = resolveConnectorTokenEncryptionKey(env);
  if (!key) {
    return null;
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function readStoredAccessToken(
  credential:
    | {
        accessToken?: string;
        accessTokenEncrypted?: {
          iv: string;
          tag: string;
          ciphertext: string;
        };
      }
    | undefined,
  env: NodeJS.ProcessEnv,
) {
  if (!credential) {
    return null;
  }
  if (typeof credential.accessToken === "string" && credential.accessToken.trim()) {
    return credential.accessToken;
  }
  return decryptConnectorToken(credential.accessTokenEncrypted, env);
}

function readStoredRefreshToken(
  credential:
    | {
        refreshToken?: string;
        refreshTokenEncrypted?: {
          iv: string;
          tag: string;
          ciphertext: string;
        };
      }
    | undefined,
  env: NodeJS.ProcessEnv,
) {
  if (!credential) {
    return null;
  }
  if (typeof credential.refreshToken === "string" && credential.refreshToken.trim()) {
    return credential.refreshToken;
  }
  return decryptConnectorToken(credential.refreshTokenEncrypted, env);
}

function buildStoredOAuthCredential(params: {
  provider: AlisioOAuthProvider;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string;
  createdAt: string;
  refreshedAt?: string;
  env: NodeJS.ProcessEnv;
}) {
  const accessTokenEncrypted = encryptConnectorToken(params.accessToken, params.env);
  const refreshTokenEncrypted = params.refreshToken
    ? encryptConnectorToken(params.refreshToken, params.env)
    : null;
  if (!accessTokenEncrypted || (params.refreshToken && !refreshTokenEncrypted)) {
    throw new AlisioAccountValidationError(
      secureLocalTokenStorageRequiredMessage("continue connector setup"),
    );
  }
  return {
    provider: params.provider,
    accessTokenEncrypted,
    ...(refreshTokenEncrypted ? { refreshTokenEncrypted } : {}),
    ...(params.tokenType ? { tokenType: params.tokenType } : {}),
    ...(params.scope ? { scope: params.scope } : {}),
    ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
    createdAt: params.createdAt,
    ...(params.refreshedAt ? { refreshedAt: params.refreshedAt } : {}),
  };
}

function hydrateStoredTokenSecrets<
  T extends {
    accessToken?: string;
    accessTokenEncrypted?: AlisioEncryptedToken;
    refreshToken?: string;
    refreshTokenEncrypted?: AlisioEncryptedToken;
  },
>(credential: T | undefined, env: NodeJS.ProcessEnv) {
  if (!credential) {
    return undefined;
  }
  const accessToken = readStoredAccessToken(credential, env);
  const refreshToken = readStoredRefreshToken(credential, env);
  const {
    accessTokenEncrypted: _ignoredAccessTokenEncrypted,
    refreshTokenEncrypted: _ignoredRefreshTokenEncrypted,
    ...rest
  } = credential;
  return {
    ...rest,
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(!accessToken && credential.accessTokenEncrypted
      ? { accessTokenEncrypted: credential.accessTokenEncrypted }
      : {}),
    ...(!refreshToken && credential.refreshTokenEncrypted
      ? { refreshTokenEncrypted: credential.refreshTokenEncrypted }
      : {}),
  } as T;
}

function serializeStoredTokenSecrets<
  T extends {
    accessToken?: string;
    accessTokenEncrypted?: AlisioEncryptedToken;
    refreshToken?: string;
    refreshTokenEncrypted?: AlisioEncryptedToken;
  },
>(credential: T | undefined, env: NodeJS.ProcessEnv) {
  if (!credential) {
    return undefined;
  }
  const { accessToken, accessTokenEncrypted, refreshToken, refreshTokenEncrypted, ...rest } =
    credential;
  const next: T = { ...rest } as T;

  if (typeof accessToken === "string" && accessToken.trim()) {
    const encrypted = encryptConnectorToken(accessToken, env);
    if (encrypted) {
      next.accessTokenEncrypted = encrypted;
    } else {
      throw new AlisioAccountValidationError(secureLocalTokenStorageRequiredMessage());
    }
  } else if (accessTokenEncrypted) {
    next.accessTokenEncrypted = accessTokenEncrypted;
  }

  if (typeof refreshToken === "string" && refreshToken.trim()) {
    const encrypted = encryptConnectorToken(refreshToken, env);
    if (encrypted) {
      next.refreshTokenEncrypted = encrypted;
    } else {
      throw new AlisioAccountValidationError(secureLocalTokenStorageRequiredMessage());
    }
  } else if (refreshTokenEncrypted) {
    next.refreshTokenEncrypted = refreshTokenEncrypted;
  }

  return next;
}

function hydrateStoredAiSecrets(
  ai: AlisioStoredState["ai"] | undefined,
  env: NodeJS.ProcessEnv,
): AlisioStoredState["ai"] | undefined {
  if (!ai) {
    return ai;
  }
  return {
    ...ai,
    ...(ai.workerCredentials
      ? {
          workerCredentials: Object.fromEntries(
            Object.entries(ai.workerCredentials).map(([workerCredentialId, credential]) => [
              workerCredentialId,
              hydrateStoredTokenSecrets(credential, env) ?? credential,
            ]),
          ),
        }
      : {}),
  };
}

function serializeStoredAiSecrets(
  ai: AlisioStoredState["ai"] | undefined,
  env: NodeJS.ProcessEnv,
): AlisioStoredState["ai"] | undefined {
  if (!ai) {
    return ai;
  }
  return {
    ...ai,
    ...(ai.workerCredentials
      ? {
          workerCredentials: Object.fromEntries(
            Object.entries(ai.workerCredentials).map(([workerCredentialId, credential]) => [
              workerCredentialId,
              serializeStoredTokenSecrets(credential, env) ?? credential,
            ]),
          ),
        }
      : {}),
  };
}

function hydrateStoredApiKeySecret<
  T extends {
    apiKey?: string;
    apiKeyEncrypted?: AlisioEncryptedToken;
  },
>(entry: T | undefined, env: NodeJS.ProcessEnv) {
  if (!entry) {
    return undefined;
  }
  const apiKey =
    typeof entry.apiKey === "string" && entry.apiKey.trim()
      ? entry.apiKey
      : (decryptConnectorToken(entry.apiKeyEncrypted, env) ?? undefined);
  const { apiKeyEncrypted: _ignoredEncrypted, ...rest } = entry;
  return {
    ...rest,
    ...(apiKey ? { apiKey } : {}),
    ...(!apiKey && entry.apiKeyEncrypted ? { apiKeyEncrypted: entry.apiKeyEncrypted } : {}),
  } as T;
}

function serializeStoredApiKeySecret<
  T extends {
    apiKey?: string;
    apiKeyEncrypted?: AlisioEncryptedToken;
  },
>(entry: T | undefined, env: NodeJS.ProcessEnv) {
  if (!entry) {
    return undefined;
  }
  const { apiKey, apiKeyEncrypted, ...rest } = entry;
  const next: T = { ...rest } as T;
  if (typeof apiKey === "string" && apiKey.trim()) {
    const encrypted = encryptConnectorToken(apiKey, env);
    if (encrypted) {
      next.apiKeyEncrypted = encrypted;
    } else {
      throw new AlisioAccountValidationError(
        secureLocalTokenStorageRequiredMessage("save remote model server credentials"),
      );
    }
  } else if (apiKeyEncrypted) {
    next.apiKeyEncrypted = apiKeyEncrypted;
  }
  return next;
}

function hydrateStoredRemoteModelServers(
  servers: Record<string, AlisioRemoteModelServer> | undefined,
  env: NodeJS.ProcessEnv,
) {
  if (!servers) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(servers)
      .map(([serverId, entry]) => {
        const hydrated = hydrateStoredApiKeySecret(entry, env);
        if (!hydrated) {
          return null;
        }
        return [serverId, hydrated] as const;
      })
      .filter((entry): entry is readonly [string, AlisioRemoteModelServer] => Boolean(entry)),
  );
}

function serializeStoredRemoteModelServers(
  servers: Record<string, AlisioRemoteModelServer> | undefined,
  env: NodeJS.ProcessEnv,
) {
  if (!servers) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(servers)
      .map(([serverId, entry]) => {
        const serialized = serializeStoredApiKeySecret(entry, env);
        if (!serialized) {
          return null;
        }
        return [serverId, serialized] as const;
      })
      .filter((entry): entry is readonly [string, AlisioRemoteModelServer] => Boolean(entry)),
  );
}

function isOAuthCredentialExpired(expiresAt: string | undefined, now = Date.now()) {
  if (!expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return true;
  }
  return expiresAtMs <= now + 60_000;
}

function splitGrantedScopes(scope: string | undefined) {
  if (!scope?.trim()) {
    return [];
  }
  return scope
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const GOOGLE_OAUTH_SCOPE_ALIASES = new Map<string, readonly string[]>([
  ["email", ["email", "https://www.googleapis.com/auth/userinfo.email"]],
  [
    "https://www.googleapis.com/auth/userinfo.email",
    ["email", "https://www.googleapis.com/auth/userinfo.email"],
  ],
  ["profile", ["profile", "https://www.googleapis.com/auth/userinfo.profile"]],
  [
    "https://www.googleapis.com/auth/userinfo.profile",
    ["profile", "https://www.googleapis.com/auth/userinfo.profile"],
  ],
]);

const GOOGLE_IDENTITY_SCOPES = new Set(["openid", "email", "profile"]);

function expandComparableOAuthScopes(provider: AlisioOAuthProvider, scopes: readonly string[]) {
  const expanded = new Set<string>();
  for (const scope of scopes) {
    expanded.add(scope);
    if (provider !== "google") {
      continue;
    }
    for (const alias of GOOGLE_OAUTH_SCOPE_ALIASES.get(scope) ?? []) {
      expanded.add(alias);
    }
  }
  return expanded;
}

function resolveOAuthScopesRequiredForValidation(
  provider: AlisioOAuthProvider,
  requestedScopes: readonly string[],
) {
  if (provider !== "google") {
    return [...requestedScopes];
  }
  const resourceScopes = requestedScopes.filter((scope) => !GOOGLE_IDENTITY_SCOPES.has(scope));
  return resourceScopes.length > 0 ? resourceScopes : [...requestedScopes];
}

function normalizeStoredOAuthScopes(
  provider: AlisioOAuthProvider,
  scopes: readonly string[],
  fallback: readonly string[],
) {
  const source = scopes.length > 0 ? scopes : [...fallback];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const scope of source) {
    const next =
      provider === "google" && scope === "https://www.googleapis.com/auth/userinfo.email"
        ? "email"
        : provider === "google" && scope === "https://www.googleapis.com/auth/userinfo.profile"
          ? "profile"
          : scope;
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    normalized.push(next);
  }
  return normalized;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) {
    return null;
  }
  try {
    const raw = Buffer.from(payload, "base64url").toString("utf8");
    const decoded = JSON.parse(raw) as Record<string, unknown>;
    return decoded && typeof decoded === "object" ? decoded : null;
  } catch {
    return null;
  }
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
        marketingOptIn: false,
        joinedAt: new Date().toISOString(),
        plan: "free",
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
    sharing: {
      policies: {},
      targets: {},
      requests: {},
      grants: {},
      audit: [],
    },
    authorizations: {},
    modelServers: {},
    oauthCredentials: {},
    pendingAuthorizations: {},
    pendingAccountAuths: {},
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
    marketingOptIn: false,
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
    ...(session?.authMethod === "email" || session?.authMethod === "google"
      ? { authMethod: session.authMethod }
      : {}),
    backend:
      session?.backend === "supabase"
        ? session.backend
        : (profile.backend ?? resolveAlisioAccountBackend(env)),
    ...(typeof session?.signedInAt === "string" ? { signedInAt: session.signedInAt } : {}),
    ...(typeof session?.signedOutAt === "string" ? { signedOutAt: session.signedOutAt } : {}),
  };
}

function migrateLegacyLocalDevAccountState(
  loaded: AlisioStoredState,
  defaults: AlisioStoredState,
): AlisioStoredState {
  const legacySessionBackend = (loaded.account?.session as { backend?: string } | undefined)
    ?.backend;
  const legacyCloudBackend = (loaded.account?.cloudSession as { backend?: string } | undefined)
    ?.backend;
  const legacyProfileBackend = (loaded.account?.profile as { backend?: string } | undefined)
    ?.backend;
  const hasLegacyLocalDevAccount =
    legacySessionBackend === "local-dev" ||
    legacyCloudBackend === "local-dev" ||
    legacyProfileBackend === "local-dev";
  if (!hasLegacyLocalDevAccount) {
    return loaded;
  }

  const preservedEmail =
    loaded.account?.profile?.email?.trim() ||
    loaded.account?.cloudSession?.email?.trim() ||
    defaults.account.profile.email;
  const signedOutAt = new Date().toISOString();
  const { passwordCredential: _ignoredLegacyPasswordCredential, ...legacyAccountWithoutPassword } =
    loaded.account ?? {};
  const { userId: _ignoredLegacyUserId, ...legacyProfileWithoutUserId } =
    loaded.account?.profile ?? {};

  return {
    ...loaded,
    account: {
      ...legacyAccountWithoutPassword,
      profile: {
        ...defaults.account.profile,
        ...legacyProfileWithoutUserId,
        email: preservedEmail,
        marketingOptIn: loaded.account?.profile?.marketingOptIn === true,
        backend: "supabase",
      },
      preferences: {
        ...defaults.account.preferences,
        ...loaded.account?.preferences,
      },
      session: {
        state: "signed_out",
        profileCompleted: false,
        backend: "supabase",
        signedOutAt,
      },
      cloudSession: {
        backend: "supabase",
        state: "signed_out",
        email: preservedEmail,
        signedOutAt,
      },
    },
    organization: { mode: "none" },
    ai: {},
    authorizations: {},
    oauthCredentials: {},
    pendingAuthorizations: {},
    pendingAccountAuths: {},
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

function hasSignedInAlisioAccountSession(
  state: Pick<AlisioStoredState, "account"> | Pick<AlisioAccountState, "session">,
) {
  const session = "account" in state ? state.account.session : state.session;
  return session.state === "signed_in";
}

function hasReadyAlisioAccountSession(
  state:
    | Pick<AlisioStoredState, "account">
    | Pick<AlisioAccountState, "session">
    | Pick<AlisioAccountState, "session" | "cloud">,
  env: NodeJS.ProcessEnv = process.env,
) {
  const session = "account" in state ? state.account.session : state.session;
  if (session.state === "signed_in" && session.profileCompleted) {
    return true;
  }
  const cloudAvailable =
    "cloud" in state
      ? state.cloud.available
      : listMissingRequiredAlisioCloudEnvVars(env).length === 0;
  return !cloudAvailable && session.profileCompleted && !session.signedOutAt;
}

function getAlisioAccountCloudState(env: NodeJS.ProcessEnv = process.env): AlisioAccountCloudState {
  const missingEnvVars = listMissingRequiredAlisioCloudEnvVars(env);
  return {
    backend: resolveAlisioAccountBackend(env),
    available: missingEnvVars.length === 0,
    missingEnvVars,
  };
}

function resolveAlisioAccountScopeKey(input: {
  session?: Pick<AlisioStoredCloudSession, "userId" | "email">;
  profile?: Pick<AlisioLocalAccountProfile | AlisioCloudAccountProfile, "email">;
}) {
  const userId = input.session?.userId?.trim();
  if (userId) {
    return `user:${userId}`;
  }
  const email =
    input.session?.email?.trim().toLowerCase() || input.profile?.email?.trim().toLowerCase() || "";
  return email ? `email:${email}` : null;
}

function shouldResetAccountScopedState(
  state: AlisioStoredState,
  next: {
    session?: AlisioStoredCloudSession;
    profile?: AlisioLocalAccountProfile | AlisioCloudAccountProfile;
  },
) {
  const currentKey = resolveAlisioAccountScopeKey({
    session: state.account.cloudSession,
    profile: state.account.profile,
  });
  const nextKey = resolveAlisioAccountScopeKey(next);
  return Boolean(currentKey && nextKey && currentKey !== nextKey);
}

function resetStoredAccountScopedState(state: AlisioStoredState) {
  state.organization = { mode: "none" };
  state.ai = {};
  state.authorizations = {};
  state.oauthCredentials = {};
  state.pendingAuthorizations = {};
  state.pendingAccountAuths = {};
}

function assertAlisioAccountSetupAccess(
  state: Pick<AlisioStoredState, "account">,
  context: "OpenAI" | "organization" | "connector",
  env: NodeJS.ProcessEnv = process.env,
) {
  const cloud = getAlisioAccountCloudState(env);
  if (!cloud.available) {
    if (!hasReadyAlisioAccountSession(state, env)) {
      throw new AlisioAccountValidationError(
        `Finish the local Alisio profile before continuing ${context} setup.`,
      );
    }
    return;
  }
  if (!hasSignedInAlisioAccountSession(state)) {
    throw new AlisioAccountValidationError(
      `Sign in to your Alisio account before continuing ${context} setup.`,
    );
  }
  if (!hasReadyAlisioAccountSession(state, env)) {
    throw new AlisioAccountValidationError(
      `Finish your Alisio account profile before continuing ${context} setup.`,
    );
  }
}

function withLocalAgentName(
  profile: AlisioLocalAccountProfile,
  agentName: string | null | undefined,
): AlisioLocalAccountProfile {
  const normalizedAgentName = normalizeAlisioAgentName(agentName);
  return normalizedAgentName
    ? {
        ...profile,
        agentName: normalizedAgentName,
      }
    : profile;
}

function toLocalAccountProfile(
  profile: AlisioCloudAccountProfile,
  opts?: { agentName?: string | null },
): AlisioLocalAccountProfile {
  return {
    ...withLocalAgentName(
      {
        ...(profile.userId ? { userId: profile.userId } : {}),
        username: profile.username,
        displayName: profile.displayName,
        email: profile.email,
        avatarLabel: profile.avatarLabel,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        ...(profile.termsAcceptedAt ? { termsAcceptedAt: profile.termsAcceptedAt } : {}),
        ...(typeof profile.marketingOptIn === "boolean"
          ? { marketingOptIn: profile.marketingOptIn }
          : {}),
        ...(profile.birthdate ? { birthdate: profile.birthdate } : {}),
        joinedAt: profile.joinedAt,
        plan: normalizeAlisioPlan(profile.plan),
        backend: profile.backend,
      },
      opts?.agentName,
    ),
  };
}

function toCloudAccountProfile(profile: AlisioLocalAccountProfile): AlisioCloudAccountProfile {
  return {
    ...(profile.userId ? { userId: profile.userId } : {}),
    email: profile.email,
    displayName: profile.displayName,
    username: profile.username,
    avatarLabel: profile.avatarLabel,
    ...(normalizeAlisioAgentName(profile.agentName) ? { agentName: profile.agentName } : {}),
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    ...(profile.termsAcceptedAt ? { termsAcceptedAt: profile.termsAcceptedAt } : {}),
    ...(typeof profile.marketingOptIn === "boolean"
      ? { marketingOptIn: profile.marketingOptIn }
      : {}),
    ...(normalizeAlisioBirthdate(profile.birthdate) ? { birthdate: profile.birthdate } : {}),
    joinedAt: profile.joinedAt,
    plan: normalizeAlisioPlan(profile.plan),
    profileCompleted: true,
    backend: profile.backend ?? "supabase",
  };
}

function normalizeStoredAccountProfile(
  profile: AlisioLocalAccountProfile,
): AlisioLocalAccountProfile {
  return {
    ...profile,
    ...(normalizeAlisioAgentName(profile.agentName)
      ? { agentName: normalizeAlisioAgentName(profile.agentName) }
      : {}),
    ...(profile.termsAcceptedAt?.trim() ? { termsAcceptedAt: profile.termsAcceptedAt.trim() } : {}),
    ...(typeof profile.marketingOptIn === "boolean"
      ? { marketingOptIn: profile.marketingOptIn }
      : {}),
    ...(normalizeAlisioBirthdate(profile.birthdate) ? { birthdate: profile.birthdate } : {}),
    plan: normalizeAlisioPlan(profile.plan),
  };
}

function resolveAlisioPlanFromProfile(
  profile: Pick<AlisioLocalAccountProfile, "plan">,
): AlisioPlan {
  return normalizeAlisioPlan(profile.plan);
}

function resolveStoredAlisioPlan(state: Pick<AlisioStoredState, "account">): AlisioPlan {
  return resolveAlisioPlanFromProfile(state.account.profile);
}

function resolveEffectiveAlisioOrganizationState(params: {
  plan: AlisioPlan;
  organization: AlisioOrganizationMembershipState;
}): AlisioOrganizationMembershipState {
  const gate = gateAlisioOrganizationMembership({
    plan: params.plan,
    mode: params.organization.mode,
  });
  return gate.ok ? params.organization : { mode: "none" };
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
    ...(session.authMethod ? { authMethod: session.authMethod } : {}),
    backend: session.backend,
    ...(session.signedInAt ? { signedInAt: session.signedInAt } : {}),
    ...(session.signedOutAt ? { signedOutAt: session.signedOutAt } : {}),
  };
}

function hasAccountProfilePatch(
  patch: Partial<
    Pick<
      AlisioLocalAccountProfile,
      | "username"
      | "displayName"
      | "email"
      | "agentName"
      | "avatarLabel"
      | "avatarUrl"
      | "termsAcceptedAt"
      | "marketingOptIn"
      | "birthdate"
    >
  >,
) {
  return (
    "username" in patch ||
    "displayName" in patch ||
    "email" in patch ||
    "agentName" in patch ||
    "avatarLabel" in patch ||
    "avatarUrl" in patch ||
    "termsAcceptedAt" in patch ||
    "marketingOptIn" in patch ||
    "birthdate" in patch
  );
}

function didAlisioAccountProfileChange(
  current: AlisioLocalAccountProfile,
  next: AlisioLocalAccountProfile,
) {
  return (
    current.username !== next.username ||
    current.displayName !== next.displayName ||
    current.email !== next.email ||
    (current.agentName ?? "") !== (next.agentName ?? "") ||
    current.avatarLabel !== next.avatarLabel ||
    (current.avatarUrl ?? "") !== (next.avatarUrl ?? "") ||
    (current.termsAcceptedAt ?? "") !== (next.termsAcceptedAt ?? "") ||
    (current.marketingOptIn ?? false) !== (next.marketingOptIn ?? false) ||
    (current.birthdate ?? "") !== (next.birthdate ?? "")
  );
}

async function repairSignedInCloudProfileFromStoredProfile(params: {
  state: AlisioStoredState;
  result: {
    session: AlisioStoredCloudSession;
    profile: AlisioCloudAccountProfile;
  };
  env?: NodeJS.ProcessEnv;
}) {
  const signedInEmail = params.result.session.email?.trim().toLowerCase() || "";
  const storedEmail = params.state.account.profile.email.trim().toLowerCase();
  if (
    !signedInEmail ||
    storedEmail !== signedInEmail ||
    params.result.profile.profileCompleted ||
    !params.state.account.session.profileCompleted
  ) {
    return params.result.profile;
  }

  const repairProfile = {
    ...params.state.account.profile,
    email: signedInEmail,
  };
  const validationError = validateAlisioAccountDraft(repairProfile);
  if (validationError) {
    return params.result.profile;
  }

  return await completeAlisioCloudAccountProfile({
    session: params.result.session,
    email: repairProfile.email,
    username: repairProfile.username,
    displayName: repairProfile.displayName,
    agentName: repairProfile.agentName,
    avatarLabel: repairProfile.avatarLabel,
    avatarUrl: repairProfile.avatarUrl,
    termsAcceptedAt: repairProfile.termsAcceptedAt,
    marketingOptIn: repairProfile.marketingOptIn,
    birthdate: repairProfile.birthdate,
    joinedAt: repairProfile.joinedAt,
    plan: repairProfile.plan,
    env: params.env,
  });
}

function isAlisioAiReady(state: AlisioAiState | null | undefined) {
  return state?.status === "connected" || state?.status === "limits_unavailable";
}

function summarizeConnectorAuthorizations(
  authorizations: readonly AlisioConnectorAuthorization[],
): AlisioBootstrapConnectorSummary {
  return summarizeAlisioConnectorUiStatuses({
    definitions: CONNECTOR_CATALOG,
    authorizations,
  });
}

function buildAlisioBootstrapSummary(params: {
  account: AlisioAccountState;
  ai: AlisioAiState;
  organization: AlisioOrganizationMembershipState;
  authorizations: readonly AlisioConnectorAuthorization[];
  wizardRunning?: boolean;
  providerReady?: boolean;
  connectionRequired?: boolean;
  env?: NodeJS.ProcessEnv;
}): AlisioBootstrapSummary {
  const cloud = params.account.cloud ?? getAlisioAccountCloudState(params.env);
  const accountReady = hasReadyAlisioAccountSession(params.account, params.env);
  const providerReady = params.providerReady ?? isAlisioAiReady(params.ai);
  const connectorSummary = summarizeConnectorAuthorizations(params.authorizations);
  const startupState: AlisioStartupState = params.connectionRequired
    ? "signed_out"
    : !cloud.available && !params.account.session.profileCompleted
      ? "needs_profile"
      : params.account.session.state !== "signed_in" && cloud.available
        ? "signed_out"
        : !params.account.session.profileCompleted
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
        : params.organization.mode === "none"
          ? "organization"
          : connectorSummary.connected === 0 &&
              (connectorSummary.ready > 0 || connectorSummary.needsReconnect > 0)
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
    organizationState: params.organization,
    connectorSummary,
    nextStep,
  };
}

export async function loadAlisioBootstrapState(
  params: {
    env?: NodeJS.ProcessEnv;
    wizardRunning?: boolean;
    providerReady?: boolean;
    connectionRequired?: boolean;
  } = {},
): Promise<{
  snapshot: AlisioBootstrapSnapshot;
  summary: AlisioBootstrapSummary;
}> {
  const snapshot = await loadAlisioBootstrapSnapshot(params.env);
  return {
    snapshot,
    summary: buildAlisioBootstrapSummary({
      account: snapshot.account,
      ai: snapshot.ai,
      organization: snapshot.organization,
      authorizations: snapshot.connectors.authorizations,
      wizardRunning: params.wizardRunning,
      providerReady: params.providerReady,
      connectionRequired: params.connectionRequired,
      env: params.env,
    }),
  };
}

export async function getAlisioBootstrapSummary(
  params: {
    env?: NodeJS.ProcessEnv;
    wizardRunning?: boolean;
    providerReady?: boolean;
    connectionRequired?: boolean;
  } = {},
): Promise<AlisioBootstrapSummary> {
  return (
    await loadAlisioBootstrapState({
      env: params.env,
      wizardRunning: params.wizardRunning,
      providerReady: params.providerReady,
      connectionRequired: params.connectionRequired,
    })
  ).summary;
}

export async function getAlisioDoctorSummary(
  params: {
    env?: NodeJS.ProcessEnv;
    wizardRunning?: boolean;
    providerReady?: boolean;
    connectionRequired?: boolean;
    gatewayHealthy?: boolean;
    bootstrap?: AlisioBootstrapSummary;
  } = {},
): Promise<AlisioDoctorSummary> {
  const runtimeEnv = params.env ?? process.env;
  const bootstrap =
    params.bootstrap ??
    (
      await loadAlisioBootstrapState({
        env: runtimeEnv,
        wizardRunning: params.wizardRunning,
        providerReady: params.providerReady,
        connectionRequired: params.connectionRequired,
      })
    ).summary;
  const doctorState = await loadStoredState(runtimeEnv);
  const issues: AlisioDoctorIssue[] = [];
  const missingCloudEnvVars = listMissingRequiredAlisioCloudEnvVars(runtimeEnv);
  const hasSensitiveLocalTokens = hasAlisioSensitiveLocalTokens(doctorState);
  const hasTokenEncryption = Boolean(resolveConnectorTokenEncryptionKey(runtimeEnv));

  if (bootstrap.connectionRequired) {
    issues.push({
      code: "gateway_not_connected",
      severity: "error",
      title: "Alisio app not connected",
      message: "Open or reconnect the Alisio app before continuing setup.",
      step: "gateway",
    });
  }

  if (params.gatewayHealthy === false) {
    issues.push({
      code: "gateway_unhealthy",
      severity: "error",
      title: "Alisio app not responding",
      message: "Reconnect the Alisio app before continuing setup.",
      step: "gateway",
    });
  }

  if (!bootstrap.accountReady) {
    const cloudAvailable = missingCloudEnvVars.length === 0;
    const waitingForSignIn = cloudAvailable && bootstrap.startupState === "signed_out";
    issues.push({
      code: "account_not_ready",
      severity: "error",
      title: waitingForSignIn ? "Account not signed in" : "Profile incomplete",
      message: waitingForSignIn
        ? "Create an Alisio account or continue with the account saved on this device."
        : cloudAvailable
          ? "Finish the Alisio profile before starting the first chat."
          : "Finish the local Alisio profile before starting the first chat.",
      step: "account",
    });
  }

  if (missingCloudEnvVars.length > 0) {
    issues.push({
      code: "account_backend_env_missing",
      severity: "warning",
      title: "Cloud account backend is unavailable",
      message: `Alisio is running in local account mode on this device. Set these env vars to enable email and Google sign-in: ${missingCloudEnvVars.join(", ")}.`,
      step: "account",
    });
  }

  if (!bootstrap.providerReady) {
    issues.push({
      code: "runtime_not_ready",
      severity: "error",
      title: "AI runtime not ready",
      message: "Connect OpenAI, a local model, or a model server before starting the first chat.",
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

  if (!hasTokenEncryption && hasSensitiveLocalTokens) {
    issues.push({
      code: "local_token_encryption_not_configured",
      severity: "warning",
      title: "Secure local token storage is unavailable",
      message:
        "Restore the macOS login keychain or configure ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY before using saved Alisio account, connector, AI, or remote model server credentials on this device.",
      step: "permissions",
    });
  }

  const permissionsOk = hasTokenEncryption || !hasSensitiveLocalTokens;
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
      permissions: permissionsOk,
    },
    bootstrap,
  };
}

function hasAlisioSensitiveLocalTokens(state: AlisioStoredState) {
  if (
    state.account.cloudSession?.state === "signed_in" &&
    (state.account.cloudSession.accessToken ||
      state.account.cloudSession.refreshToken ||
      state.account.cloudSession.accessTokenEncrypted ||
      state.account.cloudSession.refreshTokenEncrypted)
  ) {
    return true;
  }
  if (
    Object.values(state.ai?.workerCredentials ?? {}).some((credential) =>
      Boolean(
        credential.accessToken ||
        credential.refreshToken ||
        credential.accessTokenEncrypted ||
        credential.refreshTokenEncrypted,
      ),
    )
  ) {
    return true;
  }
  if (
    Object.values(state.oauthCredentials ?? {}).some((credential) =>
      Boolean(
        credential.accessToken ||
        credential.refreshToken ||
        credential.accessTokenEncrypted ||
        credential.refreshTokenEncrypted,
      ),
    )
  ) {
    return true;
  }
  return Object.values(state.modelServers ?? {}).some((server) =>
    Boolean(server.apiKey || server.apiKeyEncrypted),
  );
}

function currentWorkerId() {
  return currentDevice().id;
}

function resolveAlisioAiOwnerContext(params: {
  profile: AlisioLocalAccountProfile;
  cloudSession?: AlisioStoredCloudSession;
  organization: AlisioOrganizationMembershipState;
}): AlisioAiOwnerContext {
  const organizationName = params.organization.organizationName?.trim().toLowerCase();
  if (params.organization.mode !== "none" && organizationName) {
    return {
      scope: "organization",
      ownerKey: `organization:${organizationName}`,
    };
  }
  const rawUserKey =
    params.cloudSession?.userId?.trim() ||
    params.profile.userId?.trim() ||
    params.profile.email.trim().toLowerCase() ||
    "anonymous";
  return {
    scope: "user",
    ownerKey: rawUserKey.startsWith("user:") ? rawUserKey : `user:${rawUserKey}`,
  };
}

function resolveLegacyTelemetryDurationMinutes(label: string): number | undefined {
  const normalized = label.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "week") {
    return 10080;
  }
  if (normalized === "day") {
    return 1440;
  }
  const hourMatch = /^(\d+)\s*h$/.exec(normalized);
  if (hourMatch) {
    return Number(hourMatch[1]) * 60;
  }
  const minuteMatch = /^(\d+)\s*min$/.exec(normalized);
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }
  const dayMatch = /^(\d+)\s*d$/.exec(normalized);
  if (dayMatch) {
    return Number(dayMatch[1]) * 24 * 60;
  }
  return undefined;
}

function buildLegacyTelemetryWindow(
  durationMinutes: number,
  usedPercent: number,
  resetAt?: number,
) {
  return {
    durationMinutes,
    usedPercent,
    ...(typeof resetAt === "number" ? { resetAt } : {}),
  };
}

function legacySessionToLocalTelemetry(
  session: AlisioLegacyStoredAiSession | undefined,
): AlisioAiLocalTelemetry | undefined {
  if (!session?.limits?.lastRefreshedAt) {
    return undefined;
  }
  const typedWindows = session.limits.windows
    .map((window) => {
      const durationMinutes = resolveLegacyTelemetryDurationMinutes(window.label);
      if (!durationMinutes) {
        return null;
      }
      return buildLegacyTelemetryWindow(durationMinutes, window.usedPercent, window.resetAt);
    })
    .filter(
      (
        entry,
      ): entry is {
        durationMinutes: number;
        usedPercent: number;
        resetAt?: number;
      } => Boolean(entry),
    )
    .toSorted((left, right) => left.durationMinutes - right.durationMinutes);
  const primaryWindow = typedWindows[0];
  const secondaryWindow = typedWindows[1];
  return buildAlisioAiLocalTelemetry({
    source: "heuristic",
    observedAt: session.limits.lastRefreshedAt,
    staleAt: new Date(Date.parse(session.limits.lastRefreshedAt) + 10 * 60 * 1000).toISOString(),
    ...(session.planLabel ? { planType: session.planLabel } : {}),
    ...(primaryWindow
      ? {
          primaryWindow: {
            label:
              primaryWindow.durationMinutes === 300
                ? "5h"
                : primaryWindow.durationMinutes === 10080
                  ? "Week"
                  : `${primaryWindow.durationMinutes} min`,
            durationMinutes: primaryWindow.durationMinutes,
            usedPercent: primaryWindow.usedPercent,
            remainingPercent: Math.max(0, 100 - primaryWindow.usedPercent),
            ...(typeof primaryWindow.resetAt === "number"
              ? { resetAt: primaryWindow.resetAt }
              : {}),
          },
        }
      : {}),
    ...(secondaryWindow
      ? {
          secondaryWindow: {
            label:
              secondaryWindow.durationMinutes === 300
                ? "5h"
                : secondaryWindow.durationMinutes === 10080
                  ? "Week"
                  : `${secondaryWindow.durationMinutes} min`,
            durationMinutes: secondaryWindow.durationMinutes,
            usedPercent: secondaryWindow.usedPercent,
            remainingPercent: Math.max(0, 100 - secondaryWindow.usedPercent),
            ...(typeof secondaryWindow.resetAt === "number"
              ? { resetAt: secondaryWindow.resetAt }
              : {}),
          },
        }
      : {}),
  });
}

function reconcileStoredAiState(state: AlisioStoredAiState | undefined, _workerId: string) {
  if (!state) {
    return;
  }
  const aiProfiles = { ...state.aiProfiles };
  const workerCredentials = { ...state.workerCredentials };
  const runtimeBindings = { ...state.runtimeBindings };

  for (const [workerCredentialId, credential] of Object.entries(workerCredentials)) {
    if (!aiProfiles[credential.aiProfileId]) {
      delete workerCredentials[workerCredentialId];
    }
  }

  for (const [aiProfileId, profile] of Object.entries(aiProfiles)) {
    const relatedCredentials = Object.values(workerCredentials).filter(
      (credential) => credential.aiProfileId === aiProfileId,
    );
    if (relatedCredentials.length === 0) {
      delete aiProfiles[aiProfileId];
      continue;
    }
    aiProfiles[aiProfileId] = {
      ...profile,
      ...(resolveAggregatedTelemetry(relatedCredentials)
        ? { aggregatedTelemetry: resolveAggregatedTelemetry(relatedCredentials) }
        : {}),
    };
  }

  for (const [bindingWorkerId, binding] of Object.entries(runtimeBindings)) {
    const credential = workerCredentials[binding.workerCredentialId];
    if (!credential) {
      delete runtimeBindings[bindingWorkerId];
      continue;
    }
    runtimeBindings[bindingWorkerId] = {
      ...binding,
      authProfileId: credential.authProfileId,
    };
  }

  state.aiProfiles = Object.keys(aiProfiles).length > 0 ? aiProfiles : undefined;
  state.workerCredentials =
    Object.keys(workerCredentials).length > 0 ? workerCredentials : undefined;
  state.runtimeBindings = Object.keys(runtimeBindings).length > 0 ? runtimeBindings : undefined;
}

function storedAiStatusPriority(status: AlisioStoredWorkerAiCredential["runtimeState"]): number {
  switch (status) {
    case "connected":
      return 5;
    case "limits_unavailable":
      return 4;
    case "connecting":
      return 3;
    case "expired":
      return 2;
    case "disconnected":
    default:
      return 1;
  }
}

function selectPreferredLocalTelemetry(
  left: AlisioAiLocalTelemetry | undefined,
  right: AlisioAiLocalTelemetry | undefined,
): AlisioAiLocalTelemetry | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  const leftObserved = Date.parse(left.observedAt);
  const rightObserved = Date.parse(right.observedAt);
  if (
    (Number.isFinite(rightObserved) ? rightObserved : 0) >=
    (Number.isFinite(leftObserved) ? leftObserved : 0)
  ) {
    return right;
  }
  return left;
}

function normalizeCredentialFromAccessToken(
  credential: AlisioStoredWorkerAiCredential,
): AlisioStoredWorkerAiCredential {
  const tokenIdentity = credential.accessToken
    ? resolveAlisioOpenAiTokenIdentity(credential.accessToken)
    : {};
  return {
    ...credential,
    ...((tokenIdentity.email ?? credential.email)
      ? { email: tokenIdentity.email ?? credential.email }
      : {}),
    ...((tokenIdentity.accountId ?? credential.accountId)
      ? { accountId: tokenIdentity.accountId ?? credential.accountId }
      : {}),
    ...((tokenIdentity.accountUserId ?? credential.accountUserId)
      ? { accountUserId: tokenIdentity.accountUserId ?? credential.accountUserId }
      : {}),
    ...((tokenIdentity.userId ?? credential.userId)
      ? { userId: tokenIdentity.userId ?? credential.userId }
      : {}),
    ...(credential.localTelemetry || tokenIdentity.planType
      ? {
          localTelemetry: buildAlisioAiLocalTelemetry({
            source: credential.localTelemetry?.source ?? "heuristic",
            observedAt: credential.localTelemetry?.observedAt,
            staleAt: credential.localTelemetry?.staleAt,
            planType: credential.localTelemetry?.planType ?? tokenIdentity.planType,
            primaryWindow: credential.localTelemetry?.primaryWindow,
            secondaryWindow: credential.localTelemetry?.secondaryWindow,
            credits: credential.localTelemetry?.credits,
            lastError: credential.localTelemetry?.lastError,
          }),
        }
      : {}),
  };
}

function mergeStoredAiProfileRecord(
  existing: AlisioStoredAiProfile | undefined,
  incoming: AlisioStoredAiProfile,
): AlisioStoredAiProfile {
  if (!existing) {
    return incoming;
  }
  return {
    ...existing,
    ...incoming,
    label: existing.label ?? incoming.label,
    createdAt:
      Date.parse(existing.createdAt) <= Date.parse(incoming.createdAt)
        ? existing.createdAt
        : incoming.createdAt,
    aggregatedTelemetry: selectPreferredLocalTelemetry(
      existing.aggregatedTelemetry,
      incoming.aggregatedTelemetry,
    ),
  };
}

function mergeStoredWorkerCredentialRecord(
  existing: AlisioStoredWorkerAiCredential | undefined,
  incoming: AlisioStoredWorkerAiCredential,
): AlisioStoredWorkerAiCredential {
  if (!existing) {
    return incoming;
  }
  const existingConnectedAt = Date.parse(existing.connectedAt ?? existing.createdAt);
  const incomingConnectedAt = Date.parse(incoming.connectedAt ?? incoming.createdAt);
  const preferIncoming =
    (Number.isFinite(incomingConnectedAt) ? incomingConnectedAt : 0) >=
    (Number.isFinite(existingConnectedAt) ? existingConnectedAt : 0);
  const preferred = preferIncoming ? incoming : existing;
  const fallback = preferIncoming ? existing : incoming;
  return {
    ...existing,
    ...incoming,
    aiProfileId: incoming.aiProfileId,
    workerId: incoming.workerId,
    authProfileId: existing.authProfileId || incoming.authProfileId,
    runtimeState:
      storedAiStatusPriority(incoming.runtimeState) >= storedAiStatusPriority(existing.runtimeState)
        ? incoming.runtimeState
        : existing.runtimeState,
    accessToken: preferred.accessToken ?? fallback.accessToken,
    refreshToken: preferred.refreshToken ?? fallback.refreshToken,
    expiresAt: preferred.expiresAt ?? fallback.expiresAt,
    email: incoming.email ?? existing.email,
    accountId: incoming.accountId ?? existing.accountId,
    accountUserId: incoming.accountUserId ?? existing.accountUserId,
    userId: incoming.userId ?? existing.userId,
    connectedAt: preferred.connectedAt ?? fallback.connectedAt,
    createdAt:
      Date.parse(existing.createdAt) <= Date.parse(incoming.createdAt)
        ? existing.createdAt
        : incoming.createdAt,
    localTelemetry: selectPreferredLocalTelemetry(existing.localTelemetry, incoming.localTelemetry),
  };
}

function rebuildStoredAiStateForOwner(
  state: NonNullable<AlisioStoredState["ai"]>,
  owner: AlisioAiOwnerContext,
) {
  const originalProfiles = state.aiProfiles ?? {};
  const originalBindings = state.runtimeBindings ?? {};
  const rebuiltProfiles: Record<string, AlisioStoredAiProfile> = {};
  const rebuiltCredentials: Record<string, AlisioStoredWorkerAiCredential> = {};
  const workerCredentialIdMap = new Map<string, string>();

  for (const [previousWorkerCredentialId, rawCredential] of Object.entries(
    state.workerCredentials ?? {},
  )) {
    const credential = normalizeCredentialFromAccessToken(rawCredential);
    const identity = resolveAlisioAiCanonicalIdentity({
      accountUserId: credential.accountUserId,
      userId: credential.userId,
      accountId: credential.accountId,
      email: credential.email,
    });
    const aiProfileId = buildAlisioAiProfileId({
      ownerKey: owner.ownerKey,
      canonicalIdentityKey: identity.canonicalIdentityKey,
    });
    const workerCredentialId = buildAlisioWorkerCredentialId({
      workerId: credential.workerId,
      aiProfileId,
    });
    const sourceProfile =
      originalProfiles[rawCredential.aiProfileId] ?? originalProfiles[aiProfileId];
    const createdAt =
      credential.createdAt ||
      sourceProfile?.createdAt ||
      credential.connectedAt ||
      new Date().toISOString();

    workerCredentialIdMap.set(previousWorkerCredentialId, workerCredentialId);
    rebuiltProfiles[aiProfileId] = mergeStoredAiProfileRecord(rebuiltProfiles[aiProfileId], {
      provider: "openai",
      scope: owner.scope,
      ownerKey: owner.ownerKey,
      canonicalIdentityKey: identity.canonicalIdentityKey,
      identity,
      ...(sourceProfile?.label ? { label: sourceProfile.label } : {}),
      createdAt,
      ...(sourceProfile?.aggregatedTelemetry
        ? { aggregatedTelemetry: sourceProfile.aggregatedTelemetry }
        : {}),
    });
    rebuiltCredentials[workerCredentialId] = mergeStoredWorkerCredentialRecord(
      rebuiltCredentials[workerCredentialId],
      {
        ...credential,
        aiProfileId,
        authProfileId:
          credential.authProfileId || buildAlisioWorkerAuthProfileId(workerCredentialId),
        createdAt,
      },
    );
  }

  const rebuiltBindings: Record<string, AlisioStoredRuntimeBinding> = {};
  for (const [bindingWorkerId, binding] of Object.entries(originalBindings)) {
    const remappedWorkerCredentialId =
      workerCredentialIdMap.get(binding.workerCredentialId) ?? binding.workerCredentialId;
    const credential = rebuiltCredentials[remappedWorkerCredentialId];
    if (!credential) {
      continue;
    }
    rebuiltBindings[bindingWorkerId] = {
      workerId: binding.workerId,
      workerCredentialId: remappedWorkerCredentialId,
      authProfileId: credential.authProfileId,
      boundAt: binding.boundAt,
    };
  }

  state.aiProfiles = Object.keys(rebuiltProfiles).length > 0 ? rebuiltProfiles : undefined;
  state.workerCredentials =
    Object.keys(rebuiltCredentials).length > 0 ? rebuiltCredentials : undefined;
  state.runtimeBindings = Object.keys(rebuiltBindings).length > 0 ? rebuiltBindings : undefined;
}

async function loadStoredState(env?: NodeJS.ProcessEnv): Promise<AlisioStoredState> {
  const runtimeEnv = env ?? process.env;
  await ensureAlisioStateDirReady(runtimeEnv);
  const rawLoaded = await readJsonFile<AlisioStoredState>(stateFilePath(runtimeEnv));
  const defaults = buildDefaultState();
  if (!rawLoaded || rawLoaded.version !== 1) {
    return defaults;
  }
  const loaded = migrateLegacyLocalDevAccountState(rawLoaded, defaults);
  const loadedModelServers = hydrateStoredRemoteModelServers(loaded.modelServers, runtimeEnv);
  const loadedAccountWithoutSecrets = { ...loaded.account };
  const loadedCloudSession = hydrateStoredTokenSecrets(
    loadedAccountWithoutSecrets.cloudSession,
    runtimeEnv,
  );
  delete loadedAccountWithoutSecrets.cloudSession;
  delete loadedAccountWithoutSecrets.passwordCredential;
  const mergedProfile = {
    ...defaults.account.profile,
    ...loaded.account?.profile,
  };
  const mergedOrganization = {
    ...defaults.organization,
    ...loaded.organization,
  };
  const normalizedProfile = normalizeStoredAccountProfile(mergedProfile);
  const mergedSession = normalizeStoredAccountSession(
    loaded.account?.session,
    normalizedProfile,
    env,
  );
  const effectiveOrganization = resolveEffectiveAlisioOrganizationState({
    plan: resolveAlisioPlanFromProfile(normalizedProfile),
    organization: mergedOrganization,
  });
  const mergedSharing: AlisioStoredSharingState = {
    policies: loaded.sharing?.policies ?? {},
    targets: loaded.sharing?.targets ?? {},
    requests: loaded.sharing?.requests ?? {},
    grants: loaded.sharing?.grants ?? {},
    audit: loaded.sharing?.audit ?? [],
  };
  const defaultAiState: AlisioStoredAiState = defaults.ai ?? {};
  const nextAi = normalizeStoredAiState(
    hydrateStoredAiSecrets(loaded.ai, runtimeEnv),
    defaultAiState,
    {
      owner: resolveAlisioAiOwnerContext({
        profile: normalizedProfile,
        cloudSession: loadedCloudSession,
        organization: effectiveOrganization,
      }),
      workerId: currentWorkerId(),
    },
  );
  return {
    ...defaults,
    ...loaded,
    account: {
      ...defaults.account,
      ...loadedAccountWithoutSecrets,
      profile: normalizedProfile,
      preferences: {
        ...defaults.account.preferences,
        ...loaded.account?.preferences,
      },
      session: mergedSession,
      ...(loadedCloudSession ? { cloudSession: loadedCloudSession } : {}),
    },
    organization: mergedOrganization,
    ai: nextAi,
    sharing: mergedSharing,
    authorizations: loaded.authorizations ?? {},
    modelServers: loadedModelServers,
    oauthCredentials: loaded.oauthCredentials ?? {},
    pendingAuthorizations: loaded.pendingAuthorizations ?? {},
    pendingAccountAuths: loaded.pendingAccountAuths ?? {},
  };
}

function normalizeStoredAiState(
  loaded: AlisioStoredState["ai"] | undefined,
  defaults: NonNullable<AlisioStoredState["ai"]>,
  params: { owner: AlisioAiOwnerContext; workerId: string },
): NonNullable<AlisioStoredState["ai"]> {
  const next: NonNullable<AlisioStoredState["ai"]> = {
    ...defaults,
    ...(loaded?.pending ? { pending: loaded.pending } : {}),
    ...(loaded?.aiProfiles ? { aiProfiles: { ...loaded.aiProfiles } } : {}),
    ...(loaded?.workerCredentials ? { workerCredentials: { ...loaded.workerCredentials } } : {}),
    ...(loaded?.runtimeBindings ? { runtimeBindings: { ...loaded.runtimeBindings } } : {}),
  };
  const legacyProfiles = { ...loaded?.profiles };
  if (loaded?.session) {
    const legacySessionIdentity = resolveAlisioAiCanonicalIdentity({
      accountUserId: loaded.session.accountUserId,
      userId: loaded.session.userId,
      accountId: loaded.session.accountId,
      email: loaded.session.email,
    });
    legacyProfiles[
      loaded.activeProfileId?.trim() ||
        buildAlisioAiProfileId({
          ownerKey: params.owner.ownerKey,
          canonicalIdentityKey: legacySessionIdentity.canonicalIdentityKey,
        })
    ] = loaded.session;
  }

  const runtimeBindingCandidates: Array<{
    workerId: string;
    workerCredentialId: string;
    authProfileId: string;
    boundAt: string;
  }> = [];
  for (const [legacyProfileId, session] of Object.entries(legacyProfiles)) {
    const identity = resolveAlisioAiCanonicalIdentity({
      accountUserId: session.accountUserId,
      userId: session.userId,
      accountId: session.accountId,
      email: session.email,
    });
    const aiProfileId = buildAlisioAiProfileId({
      ownerKey: params.owner.ownerKey,
      canonicalIdentityKey: identity.canonicalIdentityKey,
    });
    const workerCredentialId = buildAlisioWorkerCredentialId({
      workerId: params.workerId,
      aiProfileId,
    });
    const authProfileId =
      next.workerCredentials?.[workerCredentialId]?.authProfileId ??
      buildAlisioWorkerAuthProfileId(workerCredentialId);
    const createdAt = session.connectedAt ?? new Date().toISOString();
    next.aiProfiles = {
      ...next.aiProfiles,
      [aiProfileId]: {
        provider: "openai",
        scope: params.owner.scope,
        ownerKey: params.owner.ownerKey,
        canonicalIdentityKey: identity.canonicalIdentityKey,
        identity,
        label: session.label,
        createdAt,
        ...(legacySessionToLocalTelemetry(session)
          ? { aggregatedTelemetry: legacySessionToLocalTelemetry(session) }
          : {}),
      } satisfies AlisioStoredAiProfile,
    };
    next.workerCredentials = {
      ...next.workerCredentials,
      [workerCredentialId]: {
        provider: "openai",
        aiProfileId,
        workerId: params.workerId,
        authProfileId,
        runtimeState: session.status,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        email: session.email,
        accountId: session.accountId,
        accountUserId: session.accountUserId,
        userId: session.userId,
        connectedAt: session.connectedAt,
        createdAt,
        ...(legacySessionToLocalTelemetry(session)
          ? { localTelemetry: legacySessionToLocalTelemetry(session) }
          : {}),
      } satisfies AlisioStoredWorkerAiCredential,
    };
    if (loaded?.activeProfileId?.trim() === legacyProfileId.trim()) {
      runtimeBindingCandidates.push({
        workerId: params.workerId,
        workerCredentialId,
        authProfileId,
        boundAt: session.connectedAt ?? createdAt,
      });
    }
  }

  if (runtimeBindingCandidates.length > 0) {
    const preferredBinding = runtimeBindingCandidates[0];
    next.runtimeBindings = {
      ...next.runtimeBindings,
      [params.workerId]: preferredBinding,
    };
  }
  rebuildStoredAiStateForOwner(next, params.owner);
  reconcileStoredAiState(next, params.workerId);
  return next;
}

async function persistState(state: AlisioStoredState, env?: NodeJS.ProcessEnv) {
  const runtimeEnv = env ?? process.env;
  await ensureAlisioStateDirReady(runtimeEnv);
  const serializedCloudSession = serializeStoredTokenSecrets(
    state.account.cloudSession,
    runtimeEnv,
  );
  const serializedAi = serializeStoredAiSecrets(state.ai, runtimeEnv);
  const serializedModelServers = serializeStoredRemoteModelServers(state.modelServers, runtimeEnv);
  await writeJsonAtomic(
    stateFilePath(runtimeEnv),
    {
      ...state,
      account: {
        ...state.account,
        ...(serializedCloudSession ? { cloudSession: serializedCloudSession } : {}),
      },
      ...(serializedAi ? { ai: serializedAi } : {}),
      modelServers: serializedModelServers,
    },
    { trailingNewline: true },
  );
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

function resolveBoundWorkerCredential(
  state: AlisioStoredState,
  workerId: string,
): { workerCredentialId: string; credential: AlisioStoredWorkerAiCredential } | null {
  const runtimeBinding = state.ai?.runtimeBindings?.[workerId];
  if (runtimeBinding) {
    const boundCredential = state.ai?.workerCredentials?.[runtimeBinding.workerCredentialId];
    if (boundCredential) {
      return {
        workerCredentialId: runtimeBinding.workerCredentialId,
        credential: boundCredential,
      };
    }
  }
  return selectBestWorkerCredentialForWorker(state, workerId);
}

function compareAiCredentialSelections(
  left: AlisioAiCredentialSelection,
  right: AlisioAiCredentialSelection,
): number {
  if (left.manualPreference !== right.manualPreference) {
    return left.manualPreference ? -1 : 1;
  }
  if (left.tokenReady !== right.tokenReady) {
    return left.tokenReady ? -1 : 1;
  }
  if (left.inCooldown !== right.inCooldown) {
    return left.inCooldown ? 1 : -1;
  }
  if (left.primaryRemainingPercent !== right.primaryRemainingPercent) {
    return right.primaryRemainingPercent - left.primaryRemainingPercent;
  }
  if (left.secondaryRemainingPercent !== right.secondaryRemainingPercent) {
    return right.secondaryRemainingPercent - left.secondaryRemainingPercent;
  }
  if (left.recentFailures !== right.recentFailures) {
    return left.recentFailures - right.recentFailures;
  }
  if (left.recentSuccess !== right.recentSuccess) {
    return left.recentSuccess ? -1 : 1;
  }
  const statusPriority: Record<AlisioAiCredentialSelection["runtimeState"], number> = {
    connected: 5,
    limits_unavailable: 4,
    connecting: 3,
    expired: 2,
    disconnected: 1,
  };
  return statusPriority[right.runtimeState] - statusPriority[left.runtimeState];
}

function selectBestWorkerCredentialForWorker(
  state: AlisioStoredState,
  workerId: string,
): { workerCredentialId: string; credential: AlisioStoredWorkerAiCredential } | null {
  const authStore = ensureAuthProfileStore();
  const candidates = Object.keys(state.ai?.aiProfiles ?? {})
    .map((aiProfileId) =>
      selectBestWorkerCredentialForProfile({
        aiProfileId,
        workerId,
        state: state.ai,
        authStore,
      }),
    )
    .filter(
      (
        candidate,
      ): candidate is {
        workerCredentialId: string;
        record: AlisioStoredWorkerAiCredential;
        score: AlisioAiCredentialSelection;
      } => Boolean(candidate),
    )
    .toSorted((left, right) => compareAiCredentialSelections(left.score, right.score));
  const best = candidates[0];
  if (!best) {
    return null;
  }
  return {
    workerCredentialId: best.workerCredentialId,
    credential: best.record,
  };
}

function selectBestWorkerCredentialsForWorker(
  state: AlisioStoredState,
  workerId: string,
): Array<{ workerCredentialId: string; credential: AlisioStoredWorkerAiCredential }> {
  const authStore = ensureAuthProfileStore();
  return Object.keys(state.ai?.aiProfiles ?? {})
    .map((aiProfileId) =>
      selectBestWorkerCredentialForProfile({
        aiProfileId,
        workerId,
        state: state.ai,
        authStore,
      }),
    )
    .filter(
      (
        candidate,
      ): candidate is {
        workerCredentialId: string;
        record: AlisioStoredWorkerAiCredential;
        score: AlisioAiCredentialSelection;
      } => Boolean(candidate),
    )
    .map((candidate) => resolveSelectedWorkerCredentialRecord(candidate));
}

function setRuntimeBinding(
  state: AlisioStoredState,
  workerId: string,
  binding: AlisioStoredRuntimeBinding | null,
) {
  if (!state.ai) {
    state.ai = {};
  }
  if (!state.ai.runtimeBindings) {
    state.ai.runtimeBindings = {};
  }
  if (binding) {
    state.ai.runtimeBindings[workerId] = binding;
  } else {
    delete state.ai.runtimeBindings[workerId];
    if (Object.keys(state.ai.runtimeBindings).length === 0) {
      delete state.ai.runtimeBindings;
    }
  }
}

function ensureStoredAiState(state: AlisioStoredState): NonNullable<AlisioStoredState["ai"]> {
  if (!state.ai) {
    state.ai = {};
  }
  return state.ai;
}

function resolveCurrentOwnerContext(state: AlisioStoredState): AlisioAiOwnerContext {
  return resolveAlisioAiOwnerContext({
    profile: state.account.profile,
    cloudSession: state.account.cloudSession,
    organization: resolveEffectiveAlisioOrganizationState({
      plan: resolveStoredAlisioPlan(state),
      organization: state.organization,
    }),
  });
}

function ensureStoredSharingState(
  state: AlisioStoredState,
): NonNullable<AlisioStoredState["sharing"]> {
  if (!state.sharing) {
    state.sharing = {};
  }
  if (!state.sharing.policies) {
    state.sharing.policies = {};
  }
  if (!state.sharing.targets) {
    state.sharing.targets = {};
  }
  if (!state.sharing.requests) {
    state.sharing.requests = {};
  }
  if (!state.sharing.grants) {
    state.sharing.grants = {};
  }
  if (!state.sharing.audit) {
    state.sharing.audit = [];
  }
  return state.sharing;
}

function buildSharingPrincipalForOwner(
  state: AlisioStoredState,
  owner: AlisioAiOwnerContext,
): AlisioSharingPrincipal {
  if (owner.scope === "organization") {
    const organizationName =
      resolveEffectiveAlisioOrganizationState({
        plan: resolveStoredAlisioPlan(state),
        organization: state.organization,
      }).organizationName?.trim() || "Organization";
    return {
      ownerKey: owner.ownerKey,
      ownerScope: "organization",
      label: organizationName,
    };
  }
  return {
    ownerKey: owner.ownerKey,
    ownerScope: "user",
    label: state.account.profile.displayName.trim() || state.account.profile.email.trim(),
    ...(state.account.profile.email.trim()
      ? { email: state.account.profile.email.trim().toLowerCase() }
      : {}),
  };
}

function buildCurrentSharingPrincipal(state: AlisioStoredState): AlisioSharingPrincipal {
  return buildSharingPrincipalForOwner(state, resolveCurrentOwnerContext(state));
}

const ALISIO_SHARING_SCOPE_ORDER: readonly AlisioSharingScope[] = [
  "read-only",
  "model-use",
  "exec",
];
const ALISIO_LEGACY_SHARING_SCOPE_REPLACEMENTS: Record<
  AlisioLegacySharingScope,
  AlisioSharingScope
> = {
  "device.use": "read-only",
  "model.use": "model-use",
};

function warnOnLegacySharingScopeInput(
  scopes: readonly AlisioStoredSharingScope[] | undefined,
): void {
  for (const scope of scopes ?? []) {
    if (scope === "device.use" || scope === "model.use") {
      const replacement = ALISIO_LEGACY_SHARING_SCOPE_REPLACEMENTS[scope];
      warnLegacyCompatibilityOnce({
        key: `sharing-scope:${scope}`,
        message: `Legacy sharing scope alias "${scope}" is deprecated.`,
        replacement: `"${replacement}"`,
      });
    }
  }
}

function normalizeAlisioSharingScope(
  scope: AlisioStoredSharingScope | null | undefined,
): AlisioSharingScope | null {
  switch (scope) {
    case "device.use":
    case "read-only":
      return "read-only";
    case "model.use":
    case "model-use":
      return "model-use";
    case "exec":
      return "exec";
    default:
      return null;
  }
}

function normalizeAlisioSharingScopes(
  scopes: readonly AlisioStoredSharingScope[] | undefined,
): AlisioSharingScope[] {
  const normalized = new Set<AlisioSharingScope>();
  for (const scope of scopes ?? ALISIO_DEFAULT_SHARING_SCOPES) {
    const nextScope = normalizeAlisioSharingScope(scope);
    if (nextScope) {
      normalized.add("read-only");
      if (nextScope === "model-use" || nextScope === "exec") {
        normalized.add("model-use");
      }
      normalized.add(nextScope);
    }
  }
  const resolved =
    normalized.size > 0
      ? [...normalized]
      : scopes === undefined
        ? [...ALISIO_DEFAULT_SHARING_SCOPES]
        : [];
  return [...resolved].toSorted(
    (left, right) =>
      ALISIO_SHARING_SCOPE_ORDER.indexOf(left) - ALISIO_SHARING_SCOPE_ORDER.indexOf(right),
  );
}

function canApproveAlisioSharingScopes(params: {
  requested: readonly AlisioStoredSharingScope[] | undefined;
  approved: readonly AlisioStoredSharingScope[] | undefined;
}) {
  const requested = new Set(normalizeAlisioSharingScopes(params.requested));
  const approved = normalizeAlisioSharingScopes(params.approved);
  return approved.every((scope) => requested.has(scope));
}

function resolveActiveAlisioSharingCloudAccessToken(
  state: Pick<AlisioStoredState, "account">,
  env?: NodeJS.ProcessEnv,
) {
  const runtimeEnv = env ?? process.env;
  if (
    !canUseAlisioSharingCloud({
      env: runtimeEnv,
      cloudSession: state.account.cloudSession,
    })
  ) {
    return null;
  }
  return state.account.cloudSession?.accessToken?.trim() || null;
}

function toAlisioSharingCloudPrincipal(
  principal: AlisioSharingPrincipal,
): AlisioSharingCloudPrincipal {
  return {
    ownerKey: principal.ownerKey,
    ownerScope: principal.ownerScope,
    label: principal.label,
    ...(principal.email ? { email: principal.email } : {}),
  };
}

function toAlisioSharingCloudRuntimeTarget(
  target: AlisioSharingRuntimeTarget,
): AlisioSharingCloudRuntimeTarget {
  return {
    targetId: target.targetId,
    label: target.label,
    platform: target.platform,
    sourceKind: target.sourceKind,
    connected: target.connected,
    current: target.current,
  };
}

async function loadAlisioSharingStateFromCloud(
  state: AlisioStoredState,
  input?: { targets?: readonly AlisioSharingRuntimeTarget[] },
  env?: NodeJS.ProcessEnv,
) {
  const accessToken = resolveActiveAlisioSharingCloudAccessToken(state, env);
  if (!accessToken) {
    return null;
  }
  const viewer = buildCurrentSharingPrincipal(state);
  return await loadAlisioSharingCloudState({
    env,
    accessToken,
    viewer: toAlisioSharingCloudPrincipal(viewer),
    ...(input?.targets
      ? { targets: input.targets.map((target) => toAlisioSharingCloudRuntimeTarget(target)) }
      : {}),
  });
}

function normalizeAlisioSharingRequestStatus(
  status: AlisioStoredSharingRequestStatus | null | undefined,
): AlisioSharingRequestStatus {
  switch (status) {
    case "approved":
    case "denied":
    case "revoked":
      return status;
    case "rejected":
      return "denied";
    default:
      return "pending";
  }
}

function normalizeAlisioSharingAuditAction(
  action: AlisioStoredSharingAuditAction | null | undefined,
): AlisioSharingAuditAction {
  switch (action) {
    case "policy.updated":
    case "request.created":
    case "request.approved":
    case "request.denied":
    case "grant.revoked":
      return action;
    case "request.rejected":
      return "request.denied";
    default:
      return "request.created";
  }
}

function toAlisioSharingRequestState(
  request: AlisioStoredSharingRequest,
): AlisioSharingRequestState {
  return {
    ...request,
    scopes: normalizeAlisioSharingScopes(request.scopes),
    status: normalizeAlisioSharingRequestStatus(request.status),
    ...(request.grantId ? { approvalId: request.grantId } : {}),
  };
}

function toAlisioSharingGrantState(grant: AlisioStoredSharingGrant): AlisioSharingGrantState {
  return {
    ...grant,
    approvalId: grant.grantId,
    scopes: normalizeAlisioSharingScopes(grant.scopes),
  };
}

function toAlisioSharingAuditEntry(entry: AlisioStoredSharingAuditEntry): AlisioSharingAuditEntry {
  return {
    ...entry,
    action: normalizeAlisioSharingAuditAction(entry.action),
  };
}

function sortAlisioSharingTargets(targets: readonly AlisioSharingTargetState[]) {
  return [...targets].toSorted((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }
    if (left.connected !== right.connected) {
      return left.connected ? -1 : 1;
    }
    return left.label.localeCompare(right.label) || left.targetId.localeCompare(right.targetId);
  });
}

function sortAlisioSharingRequests(requests: readonly AlisioSharingRequestState[]) {
  return [...requests].toSorted((left, right) => {
    if (left.status !== right.status) {
      return left.status === "pending" ? -1 : right.status === "pending" ? 1 : 0;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function sortAlisioSharingGrants(grants: readonly AlisioSharingGrantState[]) {
  return [...grants].toSorted((left, right) => right.approvedAt.localeCompare(left.approvedAt));
}

function sortAlisioSharingAudit(entries: readonly AlisioSharingAuditEntry[]) {
  return [...entries].toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function appendAlisioSharingAuditEntry(
  state: AlisioStoredState,
  entry: Omit<AlisioSharingAuditEntry, "entryId" | "createdAt"> &
    Partial<Pick<AlisioSharingAuditEntry, "entryId" | "createdAt">>,
): AlisioSharingAuditEntry {
  const sharing = ensureStoredSharingState(state);
  const nextEntry: AlisioStoredSharingAuditEntry = {
    entryId: entry.entryId ?? randomUUID(),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    ...entry,
  };
  sharing.audit = [...(sharing.audit ?? []), nextEntry]
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, ALISIO_SHARING_AUDIT_LIMIT);
  return toAlisioSharingAuditEntry(nextEntry);
}

function resolveAlisioSharingPolicyForOwner(
  state: AlisioStoredState,
  ownerKey: string,
): AlisioSharingPolicyState | null {
  const policy = state.sharing?.policies?.[ownerKey];
  return policy ?? null;
}

function resolveLatestSharingRequest(params: {
  requests: Record<string, AlisioStoredSharingRequest> | undefined;
  targetId: string;
  requesterOwnerKey: string;
}) {
  const matches = Object.values(params.requests ?? {}).filter(
    (request) =>
      request.targetId === params.targetId &&
      request.requester.ownerKey === params.requesterOwnerKey,
  );
  return (
    matches.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  );
}

function resolveActiveSharingGrant(params: {
  grants: Record<string, AlisioStoredSharingGrant> | undefined;
  targetId: string;
  granteeOwnerKey: string;
}) {
  return (
    Object.values(params.grants ?? {}).find(
      (grant) =>
        grant.targetId === params.targetId &&
        grant.grantee.ownerKey === params.granteeOwnerKey &&
        !grant.revokedAt,
    ) ?? null
  );
}

function canRequestAlisioSharingTarget(params: {
  state: AlisioStoredState;
  target: AlisioStoredSharingTarget;
  viewer: AlisioSharingPrincipal;
  planSupported: boolean;
}) {
  if (!params.planSupported || params.target.ownerKey === params.viewer.ownerKey) {
    return false;
  }
  if (params.target.ownerScope === "organization") {
    return Boolean(
      resolveAlisioSharingPolicyForOwner(params.state, params.target.ownerKey)?.allowExternalUse,
    );
  }
  return true;
}

function isLinkedSameAccountSharingTarget(params: {
  target: AlisioStoredSharingTarget;
  viewer: AlisioSharingPrincipal;
}) {
  return params.target.ownerKey === params.viewer.ownerKey && !params.target.current;
}

function resolveLinkedSameAccountDefaultScopes(params: {
  target: AlisioStoredSharingTarget;
  viewer: AlisioSharingPrincipal;
  planSupported: boolean;
}) {
  if (
    !params.planSupported ||
    !isLinkedSameAccountSharingTarget({
      target: params.target,
      viewer: params.viewer,
    })
  ) {
    return [] as AlisioSharingScope[];
  }
  // After initial device pairing, same-account devices auto-share model access.
  return [...ALISIO_DEFAULT_SHARING_SCOPES];
}

function buildAlisioSharingTargetState(params: {
  state: AlisioStoredState;
  target: AlisioStoredSharingTarget;
  viewer: AlisioSharingPrincipal;
  planSupported: boolean;
}): AlisioSharingTargetState {
  const linkedSameAccountTarget = isLinkedSameAccountSharingTarget({
    target: params.target,
    viewer: params.viewer,
  });
  const activeGrant = params.planSupported
    ? resolveActiveSharingGrant({
        grants: params.state.sharing?.grants,
        targetId: params.target.targetId,
        granteeOwnerKey: params.viewer.ownerKey,
      })
    : null;
  const latestRequest = resolveLatestSharingRequest({
    requests: params.state.sharing?.requests,
    targetId: params.target.targetId,
    requesterOwnerKey: params.viewer.ownerKey,
  });
  const owned = params.target.ownerKey === params.viewer.ownerKey && !linkedSameAccountTarget;
  const activeGrantScopes = activeGrant ? normalizeAlisioSharingScopes(activeGrant.scopes) : [];
  const defaultLinkedScopes = resolveLinkedSameAccountDefaultScopes(params);
  const effectiveScopes = normalizeAlisioSharingScopes([
    ...defaultLinkedScopes,
    ...activeGrantScopes,
  ]);
  const hasSharedAccess = effectiveScopes.length > 0;
  const canRequest = linkedSameAccountTarget
    ? params.planSupported &&
      ALISIO_SHARING_SCOPE_ORDER.some((scope) => !effectiveScopes.includes(scope))
    : canRequestAlisioSharingTarget(params);
  const deviceAccess: AlisioSharingTargetAccess = owned
    ? "owner"
    : hasSharedAccess
      ? "shared"
      : canRequest
        ? "requestable"
        : "blocked";
  const modelAccess: AlisioSharingTargetAccess = owned
    ? "owner"
    : effectiveScopes.includes("model-use")
      ? "shared"
      : canRequest
        ? "requestable"
        : "blocked";
  const execAccess: AlisioSharingTargetAccess = owned
    ? "owner"
    : effectiveScopes.includes("exec")
      ? "shared"
      : canRequest
        ? "requestable"
        : "blocked";
  const normalizedRequest = latestRequest ? toAlisioSharingRequestState(latestRequest) : null;
  return {
    ...params.target,
    deviceAccess,
    modelAccess,
    execAccess,
    ...(normalizedRequest
      ? {
          requestId: normalizedRequest.requestId,
          requestStatus: normalizedRequest.status,
        }
      : {}),
    ...(activeGrant
      ? {
          approvalId: activeGrant.grantId,
          approvalScopes: effectiveScopes,
          grantId: activeGrant.grantId,
          grantScopes: effectiveScopes,
        }
      : linkedSameAccountTarget && effectiveScopes.length > 0
        ? {
            approvalScopes: effectiveScopes,
            grantScopes: effectiveScopes,
          }
        : {}),
  };
}

function buildAlisioSharingStateFromStoredState(state: AlisioStoredState): AlisioSharingState {
  const viewer = buildCurrentSharingPrincipal(state);
  const sharingGate = gateAlisioSharing({
    plan: resolveStoredAlisioPlan(state),
  });
  const planSupported = sharingGate.ok;
  const effectiveOrganization = resolveEffectiveAlisioOrganizationState({
    plan: resolveStoredAlisioPlan(state),
    organization: state.organization,
  });
  const currentPolicyOwnerKey = viewer.ownerScope === "organization" ? viewer.ownerKey : undefined;
  const currentPolicy = currentPolicyOwnerKey
    ? resolveAlisioSharingPolicyForOwner(state, currentPolicyOwnerKey)
    : null;
  const targets = Object.values(state.sharing?.targets ?? {}).map((target) =>
    buildAlisioSharingTargetState({
      state,
      target,
      viewer,
      planSupported,
    }),
  );
  const incomingRequests = Object.values(state.sharing?.requests ?? {})
    .filter((request) => request.owner.ownerKey === viewer.ownerKey)
    .map(toAlisioSharingRequestState);
  const outgoingRequests = Object.values(state.sharing?.requests ?? {})
    .filter((request) => request.requester.ownerKey === viewer.ownerKey)
    .map(toAlisioSharingRequestState);
  const grants = Object.values(state.sharing?.grants ?? {})
    .filter(
      (grant) =>
        !grant.revokedAt &&
        (grant.owner.ownerKey === viewer.ownerKey || grant.grantee.ownerKey === viewer.ownerKey),
    )
    .map(toAlisioSharingGrantState);
  const approvals = grants;
  return {
    viewer,
    planSupported,
    policy: {
      ...(currentPolicyOwnerKey
        ? { ownerKey: currentPolicyOwnerKey, ownerLabel: viewer.label }
        : {}),
      allowExternalUse: currentPolicy?.allowExternalUse === true,
      editable: effectiveOrganization.mode === "owner" && viewer.ownerScope === "organization",
      ...(!sharingGate.ok ? { upgradeMessage: sharingGate.message } : {}),
    },
    devices: {
      owned: sortAlisioSharingTargets(
        targets.filter((target) => target.ownerKey === viewer.ownerKey && target.current),
      ),
      sharedWithMe: sortAlisioSharingTargets(
        targets.filter(
          (target) =>
            (target.ownerKey !== viewer.ownerKey || !target.current) &&
            (target.deviceAccess === "shared" ||
              target.modelAccess === "shared" ||
              target.execAccess === "shared"),
        ),
      ),
      available: sortAlisioSharingTargets(
        targets.filter(
          (target) =>
            (target.ownerKey !== viewer.ownerKey || !target.current) &&
            (target.deviceAccess === "requestable" ||
              target.modelAccess === "requestable" ||
              target.execAccess === "requestable"),
        ),
      ),
    },
    incomingRequests: sortAlisioSharingRequests(incomingRequests),
    outgoingRequests: sortAlisioSharingRequests(outgoingRequests),
    approvals: sortAlisioSharingGrants(approvals),
    grants: sortAlisioSharingGrants(grants),
    audit: sortAlisioSharingAudit((state.sharing?.audit ?? []).map(toAlisioSharingAuditEntry)),
  };
}

function collectStoredAiAuthProfileIds(state: AlisioStoredState): string[] {
  const ids = new Set<string>();
  for (const credential of Object.values(state.ai?.workerCredentials ?? {})) {
    if (credential.authProfileId) {
      ids.add(credential.authProfileId);
    }
  }
  return [...ids];
}

function buildDefaultConnectorAuthorization(
  connector: AlisioConnectorDefinition,
  env: NodeJS.ProcessEnv,
): AlisioConnectorAuthorization {
  return {
    connectorId: connector.id,
    state: "not_connected",
    health: resolveDefaultConnectorAuthorizationHealth(connector, env),
    scopes: connector.scopes,
  };
}

function buildDefaultConnectorAuthorizations(
  env: NodeJS.ProcessEnv = process.env,
): AlisioConnectorAuthorization[] {
  return CONNECTOR_CATALOG.map((connector) => buildDefaultConnectorAuthorization(connector, env));
}

function resolveSelectedWorkerCredentialRecord(
  selection:
    | { workerCredentialId: string; credential: AlisioStoredWorkerAiCredential }
    | { workerCredentialId: string; record: AlisioStoredWorkerAiCredential },
): { workerCredentialId: string; credential: AlisioStoredWorkerAiCredential } {
  return {
    workerCredentialId: selection.workerCredentialId,
    credential: "credential" in selection ? selection.credential : selection.record,
  };
}

function upsertWorkerCredentialForOwner(params: {
  state: AlisioStoredState;
  owner: AlisioAiOwnerContext;
  workerId: string;
  credential: Pick<
    AlisioStoredWorkerAiCredential,
    | "provider"
    | "runtimeState"
    | "accessToken"
    | "refreshToken"
    | "expiresAt"
    | "email"
    | "accountId"
    | "accountUserId"
    | "userId"
    | "connectedAt"
    | "localTelemetry"
  >;
}) {
  const aiState = ensureStoredAiState(params.state);
  const identity = resolveAlisioAiCanonicalIdentity({
    accountUserId: params.credential.accountUserId,
    userId: params.credential.userId,
    accountId: params.credential.accountId,
    email: params.credential.email,
  });
  const aiProfileId = buildAlisioAiProfileId({
    ownerKey: params.owner.ownerKey,
    canonicalIdentityKey: identity.canonicalIdentityKey,
  });
  const workerCredentialId = buildAlisioWorkerCredentialId({
    workerId: params.workerId,
    aiProfileId,
  });
  const existingProfile = aiState.aiProfiles?.[aiProfileId];
  const existingCredential = aiState.workerCredentials?.[workerCredentialId];
  const createdAt =
    existingCredential?.createdAt ??
    existingProfile?.createdAt ??
    params.credential.connectedAt ??
    new Date().toISOString();
  const authProfileId =
    existingCredential?.authProfileId ?? buildAlisioWorkerAuthProfileId(workerCredentialId);
  const nextCredential: AlisioStoredWorkerAiCredential = {
    provider: "openai",
    aiProfileId,
    workerId: params.workerId,
    authProfileId,
    runtimeState: params.credential.runtimeState,
    ...(params.credential.accessToken ? { accessToken: params.credential.accessToken } : {}),
    ...(params.credential.refreshToken ? { refreshToken: params.credential.refreshToken } : {}),
    ...(params.credential.expiresAt ? { expiresAt: params.credential.expiresAt } : {}),
    ...((params.credential.email ?? identity.email)
      ? { email: params.credential.email ?? identity.email }
      : {}),
    ...((params.credential.accountId ?? identity.accountId)
      ? { accountId: params.credential.accountId ?? identity.accountId }
      : {}),
    ...((params.credential.accountUserId ?? identity.accountUserId)
      ? { accountUserId: params.credential.accountUserId ?? identity.accountUserId }
      : {}),
    ...((params.credential.userId ?? identity.userId)
      ? { userId: params.credential.userId ?? identity.userId }
      : {}),
    ...(params.credential.connectedAt
      ? { connectedAt: params.credential.connectedAt }
      : existingCredential?.connectedAt
        ? { connectedAt: existingCredential.connectedAt }
        : {}),
    createdAt,
    ...(params.credential.localTelemetry
      ? { localTelemetry: params.credential.localTelemetry }
      : existingCredential?.localTelemetry
        ? { localTelemetry: existingCredential.localTelemetry }
        : {}),
  };
  aiState.aiProfiles = {
    ...aiState.aiProfiles,
    [aiProfileId]: {
      provider: "openai",
      scope: params.owner.scope,
      ownerKey: params.owner.ownerKey,
      canonicalIdentityKey: identity.canonicalIdentityKey,
      identity,
      ...(existingProfile?.label ? { label: existingProfile.label } : {}),
      createdAt: existingProfile?.createdAt ?? createdAt,
    },
  };
  aiState.workerCredentials = {
    ...aiState.workerCredentials,
    [workerCredentialId]: nextCredential,
  };
  return {
    aiProfileId,
    workerCredentialId,
    authProfileId,
    profile:
      aiState.aiProfiles[aiProfileId] ??
      ({
        provider: "openai",
        scope: params.owner.scope,
        ownerKey: params.owner.ownerKey,
        canonicalIdentityKey: identity.canonicalIdentityKey,
        identity,
        createdAt,
      } satisfies AlisioStoredAiProfile),
    credential: nextCredential,
  };
}

async function refreshStoredAiState(
  state: AlisioStoredState,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  if (!hasReadyAlisioAccountSession(state, env)) {
    const authProfileIds = collectStoredAiAuthProfileIds(state);
    if (authProfileIds.length > 0) {
      await clearAlisioOpenAiRuntime({ authProfileIds }).catch(() => undefined);
    }
    return state;
  }
  const workerId = currentWorkerId();
  const bound = resolveBoundWorkerCredential(state, workerId);
  if (!bound) {
    return state;
  }
  const refreshed = await refreshAlisioOpenAiSession({
    credential: bound.credential,
    fetchImpl,
  });
  ensureStoredAiState(state).workerCredentials = {
    ...state.ai?.workerCredentials,
    [bound.workerCredentialId]: refreshed,
  };
  setRuntimeBinding(state, workerId, {
    workerId,
    workerCredentialId: bound.workerCredentialId,
    authProfileId: refreshed.authProfileId,
    boundAt:
      state.ai?.runtimeBindings?.[workerId]?.boundAt ??
      refreshed.connectedAt ??
      new Date().toISOString(),
  });
  reconcileStoredAiState(state.ai, workerId);
  if (refreshed.runtimeState === "expired" || refreshed.runtimeState === "disconnected") {
    const fallback = selectBestWorkerCredentialForWorker(state, workerId);
    if (!fallback || fallback.workerCredentialId === bound.workerCredentialId) {
      setRuntimeBinding(state, workerId, null);
    } else {
      setRuntimeBinding(state, workerId, {
        workerId,
        workerCredentialId: fallback.workerCredentialId,
        authProfileId: fallback.credential.authProfileId,
        boundAt: new Date().toISOString(),
      });
    }
  }
  const derivedState = toAlisioAiState({
    state: state.ai,
    workerId,
    authStore: ensureAuthProfileStore(),
  });
  const activeCredential = resolveBoundWorkerCredential(state, workerId);
  if (activeCredential && isAlisioAiReady(derivedState)) {
    await applyAlisioOpenAiRuntime(activeCredential.credential, {
      displayName: state.ai?.aiProfiles?.[activeCredential.credential.aiProfileId]
        ? resolveAlisioAiProfileLabel({
            profile: state.ai.aiProfiles[activeCredential.credential.aiProfileId],
            credential: activeCredential.credential,
          })
        : (activeCredential.credential.email ?? "OpenAI"),
    }).catch(() => undefined);
  } else if (refreshed.runtimeState === "expired" || refreshed.runtimeState === "disconnected") {
    await clearAlisioOpenAiRuntime({
      authProfileIds: [refreshed.authProfileId],
    }).catch(() => undefined);
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
    state.account.profile = toLocalAccountProfile(restored.profile, {
      agentName: state.account.profile.agentName,
    });
    state.account.session = toAccountSessionFromCloud(
      restored.session,
      restored.profile.profileCompleted,
      state.account.session,
    );
    return state;
  } catch (error) {
    if (error instanceof AlisioAccountCloudError && error.code === "session_refresh_failed") {
      const authProfileIds = collectStoredAiAuthProfileIds(state);
      state.account.cloudSession = {
        backend: state.account.cloudSession?.backend ?? resolveAlisioAccountBackend(env),
        state: "signed_out",
        ...(state.account.cloudSession?.authMethod
          ? { authMethod: state.account.cloudSession.authMethod }
          : {}),
        ...(state.account.cloudSession?.userId
          ? { userId: state.account.cloudSession.userId }
          : {}),
        ...(state.account.cloudSession?.email ? { email: state.account.cloudSession.email } : {}),
        ...(state.account.cloudSession?.signedInAt
          ? { signedInAt: state.account.cloudSession.signedInAt }
          : {}),
        signedOutAt: new Date().toISOString(),
      };
      state.account.session = {
        ...state.account.session,
        state: "signed_out",
        signedOutAt: new Date().toISOString(),
      };
      if (state.ai) {
        delete state.ai.pending;
      }
      await clearAlisioOpenAiRuntime({ authProfileIds }).catch(() => undefined);
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
    if (hasReadyAlisioAccountSession(state, env)) {
      await refreshStoredAiState(state, env, fetchImpl);
    } else {
      const authProfileIds = collectStoredAiAuthProfileIds(state);
      if (authProfileIds.length > 0) {
        await clearAlisioOpenAiRuntime({ authProfileIds }).catch(() => undefined);
      }
    }
    await persistState(state, env);
    return state;
  });
}

export async function loadAlisioBootstrapSnapshot(
  env?: NodeJS.ProcessEnv,
): Promise<AlisioBootstrapSnapshot> {
  const runtimeEnv = env ?? process.env;
  const cloud = getAlisioAccountCloudState(runtimeEnv);
  const [state, authorizations] = await Promise.all([
    loadHydratedStoredState(runtimeEnv),
    listAlisioConnectorAuthorizations(runtimeEnv),
  ]);
  const account: AlisioAccountState = {
    profile: state.account.profile,
    preferences: state.account.preferences,
    session: state.account.session,
    devices: [currentDevice()],
    cloud,
  };
  const ai: AlisioAiState = hasReadyAlisioAccountSession(state, runtimeEnv)
    ? toAlisioAiState({
        state: state.ai,
        workerId: currentWorkerId(),
        authStore: ensureAuthProfileStore(),
      })
    : {
        provider: "openai",
        status: "disconnected",
      };
  const organization: AlisioOrganizationMembershipState = hasReadyAlisioAccountSession(
    state,
    runtimeEnv,
  )
    ? resolveEffectiveAlisioOrganizationState({
        plan: resolveStoredAlisioPlan(state),
        organization: state.organization,
      })
    : { mode: "none" };
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
  const runtimeEnv = env ?? process.env;
  const state = await loadHydratedStoredState(runtimeEnv);
  return {
    profile: state.account.profile,
    preferences: state.account.preferences,
    session: state.account.session,
    devices: [currentDevice()],
    cloud: getAlisioAccountCloudState(runtimeEnv),
  };
}

export async function getAlisioAiState(env?: NodeJS.ProcessEnv): Promise<AlisioAiState> {
  const runtimeEnv = env ?? process.env;
  const state = await loadHydratedStoredState(runtimeEnv);
  if (!hasReadyAlisioAccountSession(state, runtimeEnv)) {
    return {
      provider: "openai",
      status: "disconnected",
    };
  }
  return toAlisioAiState({
    state: state.ai,
    workerId: currentWorkerId(),
    authStore: ensureAuthProfileStore(),
  });
}

function normalizeRemoteModelServerBaseUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function sortRemoteModelServers(servers: readonly AlisioRemoteModelServer[]) {
  return [...servers].toSorted((left, right) => {
    if (left.active && !right.active) {
      return -1;
    }
    if (right.active && !left.active) {
      return 1;
    }
    return left.label.localeCompare(right.label);
  });
}

export async function listAlisioRemoteModelServers(
  env?: NodeJS.ProcessEnv,
): Promise<AlisioRemoteModelServer[]> {
  const state = await loadStoredState(env);
  return sortRemoteModelServers(Object.values(state.modelServers ?? {}));
}

export async function resolveCurrentAlisioPlan(env?: NodeJS.ProcessEnv): Promise<AlisioPlan> {
  const state = await loadStoredState(env);
  return resolveStoredAlisioPlan(state);
}

export async function saveAlisioRemoteModelServer(
  input: {
    serverId?: string;
    label: string;
    kind: AlisioRemoteModelServerKind;
    baseUrl: string;
    apiKey?: string;
    clearApiKey?: boolean;
  },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioRemoteModelServer> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const gate = gateAlisioRemoteModelServers({
      plan: resolveStoredAlisioPlan(state),
    });
    if (!gate.ok) {
      throw new AlisioAccountValidationError(gate.message);
    }
    const now = new Date().toISOString();
    const serverId = input.serverId?.trim() || randomUUID();
    const existing = state.modelServers?.[serverId];
    const label = input.label.trim();
    const baseUrl = normalizeRemoteModelServerBaseUrl(input.baseUrl);
    if (!label) {
      throw new AlisioAccountValidationError("Add a name for this server.");
    }
    if (!baseUrl) {
      throw new AlisioAccountValidationError("Enter the server address.");
    }
    const duplicate = Object.values(state.modelServers ?? {}).find(
      (server) =>
        server.serverId !== serverId &&
        server.kind === input.kind &&
        normalizeRemoteModelServerBaseUrl(server.baseUrl).toLowerCase() === baseUrl.toLowerCase(),
    );
    if (duplicate) {
      throw new AlisioAccountValidationError("That server has already been added.");
    }
    const nextServer: AlisioRemoteModelServer = {
      serverId,
      label,
      kind: input.kind,
      baseUrl,
      active:
        existing?.active === true ||
        (!existing && !Object.values(state.modelServers ?? {}).some((server) => server.active)),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(typeof input.apiKey === "string" && input.apiKey.trim()
        ? { apiKey: input.apiKey.trim() }
        : input.clearApiKey
          ? {}
          : existing?.apiKey
            ? { apiKey: existing.apiKey }
            : existing?.apiKeyEncrypted
              ? { apiKeyEncrypted: existing.apiKeyEncrypted }
              : {}),
    };
    state.modelServers = {
      ...state.modelServers,
      [serverId]: nextServer,
    };
    await persistState(state, env);
    return nextServer;
  });
}

export async function removeAlisioRemoteModelServer(
  input: { serverId: string },
  env?: NodeJS.ProcessEnv,
): Promise<{ serverId: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const serverId = input.serverId.trim();
    const removed = state.modelServers?.[serverId];
    if (!removed) {
      return { serverId };
    }
    delete state.modelServers?.[serverId];
    if (removed.active) {
      const nextServer = Object.values(state.modelServers ?? {})[0];
      if (nextServer) {
        state.modelServers = {
          ...state.modelServers,
          [nextServer.serverId]: {
            ...nextServer,
            active: true,
            updatedAt: new Date().toISOString(),
          },
        };
      }
    }
    await persistState(state, env);
    return { serverId };
  });
}

export async function selectAlisioRemoteModelServer(
  input: { serverId: string },
  env?: NodeJS.ProcessEnv,
): Promise<{ serverId: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const gate = gateAlisioRemoteModelServers({
      plan: resolveStoredAlisioPlan(state),
    });
    if (!gate.ok) {
      throw new AlisioAccountValidationError(gate.message);
    }
    const serverId = input.serverId.trim();
    if (!state.modelServers?.[serverId]) {
      throw new AlisioAccountValidationError("That server no longer exists.");
    }
    const now = new Date().toISOString();
    state.modelServers = Object.fromEntries(
      Object.entries(state.modelServers ?? {}).map(([id, server]) => [
        id,
        {
          ...server,
          active: id === serverId,
          updatedAt: id === serverId || server.active ? now : server.updatedAt,
        },
      ]),
    );
    await persistState(state, env);
    return { serverId };
  });
}

export async function updateAlisioAccountProfile(
  patch: Partial<
    Pick<
      AlisioLocalAccountProfile,
      | "username"
      | "displayName"
      | "email"
      | "agentName"
      | "avatarLabel"
      | "avatarUrl"
      | "termsAcceptedAt"
      | "marketingOptIn"
      | "birthdate"
    >
  > &
    Partial<AlisioLocalUserPreferences>,
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const profilePatchRequested = hasAccountProfilePatch(patch);
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
      ...(typeof patch.agentName === "string"
        ? { agentName: normalizeAlisioAgentName(patch.agentName) }
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
      ...(typeof patch.termsAcceptedAt === "string"
        ? {
            termsAcceptedAt: patch.termsAcceptedAt.trim() || undefined,
          }
        : {}),
      ...("marketingOptIn" in patch
        ? {
            marketingOptIn: patch.marketingOptIn === true,
          }
        : {}),
      ...(typeof patch.birthdate === "string"
        ? {
            birthdate: normalizeAlisioBirthdate(patch.birthdate),
          }
        : {}),
    };
    if (
      state.account.cloudSession?.state === "signed_in" &&
      state.account.cloudSession.backend === "supabase"
    ) {
      nextProfile.email =
        state.account.cloudSession.email?.trim().toLowerCase() || state.account.profile.email;
    }
    const profileChanged = didAlisioAccountProfileChange(state.account.profile, nextProfile);
    const shouldPersistProfile =
      profileChanged || (profilePatchRequested && !state.account.session.profileCompleted);

    if (shouldPersistProfile) {
      const validationError = validateAlisioAccountDraft(nextProfile);
      if (validationError) {
        throw new AlisioAccountValidationError(validationError);
      }
      if (!state.account.session.profileCompleted && !nextProfile.termsAcceptedAt?.trim()) {
        throw new AlisioAccountValidationError(
          "Accept the Alisio terms before creating this account.",
        );
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
          agentName: profilePayload.agentName,
          avatarLabel: profilePayload.avatarLabel,
          avatarUrl: profilePayload.avatarUrl,
          termsAcceptedAt: profilePayload.termsAcceptedAt,
          marketingOptIn: profilePayload.marketingOptIn,
          birthdate: profilePayload.birthdate,
          joinedAt: state.account.profile.joinedAt,
          plan: state.account.profile.plan,
          env,
        });
        state.account.profile = toLocalAccountProfile(completedProfile, {
          agentName: profilePayload.agentName,
        });
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
          signedOutAt: undefined,
        };
      }
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
      cloud: getAlisioAccountCloudState(env ?? process.env),
    };
  });
}

async function applySignedInCloudAccountResult(params: {
  state: AlisioStoredState;
  result: {
    session: AlisioStoredCloudSession;
    profile: AlisioCloudAccountProfile;
  };
  env?: NodeJS.ProcessEnv;
  repairFromStoredProfile?: boolean;
}): Promise<AlisioAccountState> {
  const restoredProfile = params.repairFromStoredProfile
    ? await repairSignedInCloudProfileFromStoredProfile({
        state: params.state,
        result: params.result,
        env: params.env,
      })
    : params.result.profile;
  const resetScopedState = shouldResetAccountScopedState(params.state, {
    session: params.result.session,
    profile: normalizeStoredAccountProfile(
      toLocalAccountProfile(restoredProfile, {
        agentName: params.state.account.profile.agentName,
      }),
    ),
  });
  if (resetScopedState) {
    resetStoredAccountScopedState(params.state);
  }
  params.state.account.profile = toLocalAccountProfile(restoredProfile, {
    agentName: resetScopedState ? undefined : params.state.account.profile.agentName,
  });
  params.state.account.cloudSession = params.result.session;
  params.state.account.session = toAccountSessionFromCloud(
    params.result.session,
    restoredProfile.profileCompleted,
    params.state.account.session,
  );
  await persistState(params.state, params.env);
  return {
    profile: params.state.account.profile,
    preferences: params.state.account.preferences,
    session: params.state.account.session,
    devices: [currentDevice()],
    cloud: getAlisioAccountCloudState(params.env ?? process.env),
  };
}

function normalizeAlisioAccountCallbackUrl(
  rawCallbackUrl: string | undefined,
  purpose: "email sign-in" | "account sign-up" | "account recovery" | "email change",
) {
  if (!rawCallbackUrl?.trim()) {
    return undefined;
  }
  let callback: URL;
  try {
    callback = new URL(rawCallbackUrl.trim());
  } catch {
    throw new AlisioAccountValidationError(
      `Alisio needs a valid callback URL to finish ${purpose}.`,
    );
  }
  if (!/^https?:$/.test(callback.protocol)) {
    throw new AlisioAccountValidationError(
      `Alisio needs an http or https callback URL to finish ${purpose}.`,
    );
  }
  return callback.toString();
}

export async function beginAlisioAccountEmailAuth(
  input: { email: string; callbackUrl?: string },
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: true; email: string; message: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const email = input.email.trim().toLowerCase();
    if (!email) {
      throw new AlisioAccountValidationError("Enter the email for your Alisio account first.");
    }
    const validationError = validateAlisioEmail(email);
    if (validationError) {
      throw new AlisioAccountValidationError(validationError);
    }
    const callbackUrl = normalizeAlisioAccountCallbackUrl(input.callbackUrl, "email sign-in");
    state.account.profile = {
      ...state.account.profile,
      email,
    };
    const result = await beginAlisioCloudAccountEmailAuth({
      email,
      callbackUrl,
      env,
    });
    await persistState(state, env);
    return result;
  });
}

export async function verifyAlisioAccountEmailAuth(
  input: { email: string; code: string },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const email = input.email.trim().toLowerCase();
    const code = input.code.trim();
    if (!email) {
      throw new AlisioAccountValidationError("Enter the email for your Alisio account first.");
    }
    const validationError = validateAlisioEmail(email);
    if (validationError) {
      throw new AlisioAccountValidationError(validationError);
    }
    if (!code) {
      throw new AlisioAccountValidationError("Enter the verification code from your email.");
    }
    return await applySignedInCloudAccountResult({
      state,
      result: await verifyAlisioCloudAccountEmailAuth({ email, code, env }),
      env,
      repairFromStoredProfile: true,
    });
  });
}

export async function completeAlisioAccountEmailLinkAuth(
  input: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenType?: string;
  },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    return await applySignedInCloudAccountResult({
      state,
      result: await completeAlisioCloudAccountEmailLinkAuth({
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresIn: input.expiresIn,
        tokenType: input.tokenType,
        env,
      }),
      env,
      repairFromStoredProfile: true,
    });
  });
}

export async function beginAlisioAccountGoogleAuth(
  input: { callbackUrl: string },
  env?: NodeJS.ProcessEnv,
): Promise<{ setupUrl: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const callbackUrl = input.callbackUrl.trim();
    if (!callbackUrl) {
      throw new AlisioAccountValidationError("Alisio needs a callback URL to sign in.");
    }
    let callback: URL;
    try {
      callback = new URL(callbackUrl);
    } catch {
      throw new AlisioAccountValidationError("Alisio needs a valid callback URL to sign in.");
    }
    const stateToken = buildStateToken();
    const codeVerifier = buildCodeVerifier();
    callback.searchParams.set("account_state", stateToken);
    callback.searchParams.set("provider", "google");
    state.pendingAccountAuths = {
      ...state.pendingAccountAuths,
      [stateToken]: {
        provider: "google",
        createdAt: new Date().toISOString(),
        callbackUrl: callback.toString(),
        codeVerifier,
      },
    };
    await persistState(state, env);
    const result = buildAlisioCloudGoogleAuthUrl({
      callbackUrl: callback.toString(),
      codeVerifier,
      stateToken,
      env,
    });
    return {
      setupUrl: result.setupUrl,
    };
  });
}

export async function completeAlisioAccountGoogleAuthFromCallback(
  input: {
    stateToken?: string | null;
    code?: string | null;
    error?: string | null;
    errorDescription?: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const stateToken = input.stateToken?.trim();
    if (!stateToken) {
      throw new AlisioAccountValidationError("The Google sign-in callback is missing state.");
    }
    const pending = state.pendingAccountAuths?.[stateToken];
    if (!pending) {
      throw new AlisioAccountValidationError(
        "This Google sign-in has expired. Start the account sign-in again.",
      );
    }
    if (isPendingAuthorizationExpired(pending.createdAt)) {
      delete state.pendingAccountAuths?.[stateToken];
      await persistState(state, env);
      throw new AlisioAccountValidationError(
        "This Google sign-in has expired. Start the account sign-in again.",
      );
    }
    if (input.error?.trim()) {
      delete state.pendingAccountAuths?.[stateToken];
      await persistState(state, env);
      throw new AlisioAccountValidationError(
        input.errorDescription?.trim() || "Google sign-in was cancelled before it completed.",
      );
    }
    const code = input.code?.trim();
    if (!code) {
      delete state.pendingAccountAuths?.[stateToken];
      await persistState(state, env);
      throw new AlisioAccountValidationError(
        "Google did not return an authorization code to Alisio.",
      );
    }

    const result = await exchangeAlisioCloudGoogleAuthCode({
      code,
      codeVerifier: pending.codeVerifier,
      env,
      fetchImpl,
    });
    delete state.pendingAccountAuths?.[stateToken];
    return await applySignedInCloudAccountResult({
      state,
      result,
      env,
      repairFromStoredProfile: true,
    });
  });
}

export async function signUpAlisioAccount(
  input: { email: string; password: string; callbackUrl?: string },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const email = input.email.trim().toLowerCase();
    const validationError = validateAlisioEmail(email);
    if (validationError) {
      throw new AlisioAccountValidationError(validationError);
    }
    if (input.password.length < 8) {
      throw new AlisioAccountValidationError("Use at least 8 characters for your Alisio password.");
    }
    return await applySignedInCloudAccountResult({
      state,
      result: await signUpAlisioCloudAccount({
        email,
        password: input.password,
        callbackUrl: normalizeAlisioAccountCallbackUrl(input.callbackUrl, "account sign-up"),
        env,
      }),
      env,
    });
  });
}

export async function signInAlisioAccount(
  input: { email: string; password: string },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const email = input.email.trim().toLowerCase();
    const validationError = validateAlisioEmail(email);
    if (validationError) {
      throw new AlisioAccountValidationError(validationError);
    }
    if (!input.password) {
      throw new AlisioAccountValidationError("Enter the password for your Alisio account.");
    }
    return await applySignedInCloudAccountResult({
      state,
      result: await signInAlisioCloudAccount({
        email,
        password: input.password,
        env,
      }),
      env,
      repairFromStoredProfile: true,
    });
  });
}

export async function signOutAlisioAccount(env?: NodeJS.ProcessEnv): Promise<AlisioAccountState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const authProfileIds = collectStoredAiAuthProfileIds(state);
    if (state.account.cloudSession) {
      await signOutAlisioCloudAccount({
        session: state.account.cloudSession,
        env,
      }).catch(() => undefined);
    }
    state.account.cloudSession = {
      backend: state.account.cloudSession?.backend ?? resolveAlisioAccountBackend(env),
      state: "signed_out",
      ...(state.account.cloudSession?.authMethod
        ? { authMethod: state.account.cloudSession.authMethod }
        : {}),
      ...(state.account.cloudSession?.userId ? { userId: state.account.cloudSession.userId } : {}),
      ...(state.account.profile.email ? { email: state.account.profile.email } : {}),
      signedOutAt: new Date().toISOString(),
    };
    state.account.session = {
      state: "signed_out",
      profileCompleted: state.account.session.profileCompleted,
      ...(state.account.session.authMethod ? { authMethod: state.account.session.authMethod } : {}),
      signedInAt: state.account.session.signedInAt,
      signedOutAt: new Date().toISOString(),
      backend: state.account.cloudSession.backend,
    };
    state.pendingAccountAuths = {};
    if (state.ai) {
      delete state.ai.pending;
    }
    await clearAlisioOpenAiRuntime({ authProfileIds }).catch(() => undefined);
    await persistState(state, env);
    return {
      profile: state.account.profile,
      preferences: state.account.preferences,
      session: state.account.session,
      devices: [currentDevice()],
      cloud: getAlisioAccountCloudState(env ?? process.env),
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
    assertAlisioAccountSetupAccess(state, "OpenAI", env ?? process.env);
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
    assertAlisioAccountSetupAccess(state, "OpenAI", env ?? process.env);
    const pending = state.ai?.pending;
    if (!pending || !input.stateToken?.trim() || pending.stateToken !== input.stateToken.trim()) {
      throw new AlisioAiError("invalid_callback", "The OpenAI sign-in request is no longer valid.");
    }
    if (input.error?.trim()) {
      if (state.ai?.pending) {
        delete state.ai.pending;
      }
      await persistState(state, env);
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
    const workerId = currentWorkerId();
    const owner = resolveCurrentOwnerContext(state);
    const nextEntry = upsertWorkerCredentialForOwner({
      state,
      owner,
      workerId,
      credential: session,
    });
    ensureStoredAiState(state);
    delete state.ai?.pending;
    setRuntimeBinding(state, workerId, {
      workerId,
      workerCredentialId: nextEntry.workerCredentialId,
      authProfileId: nextEntry.authProfileId,
      boundAt: session.connectedAt ?? new Date().toISOString(),
    });
    reconcileStoredAiState(state.ai, workerId);
    await persistState(state, env);
    await applyAlisioOpenAiRuntime(nextEntry.credential, {
      displayName: resolveAlisioAiProfileLabel({
        profile: nextEntry.profile,
        credential: nextEntry.credential,
      }),
    });
    return toAlisioAiState({
      state: state.ai,
      workerId,
      authStore: ensureAuthProfileStore(),
    });
  });
}

export async function disconnectAlisioAi(
  input?: { profileId?: string },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAiState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    assertAlisioAccountSetupAccess(state, "OpenAI", env ?? process.env);
    const workerId = currentWorkerId();
    const activeState = toAlisioAiState({
      state: state.ai,
      workerId,
      authStore: ensureAuthProfileStore(),
    });
    const targetProfileId = input?.profileId?.trim() || activeState.activeProfileId || "";
    ensureStoredAiState(state);
    delete state.ai?.pending;
    const removedAuthProfileIds = Object.entries(state.ai?.workerCredentials ?? {})
      .filter(
        ([, credential]) =>
          credential.aiProfileId === targetProfileId && credential.workerId === workerId,
      )
      .map(([workerCredentialId, credential]) => {
        delete state.ai?.workerCredentials?.[workerCredentialId];
        return credential.authProfileId;
      });
    for (const [bindingWorkerId, binding] of Object.entries(state.ai?.runtimeBindings ?? {})) {
      if (
        binding.workerCredentialId &&
        !state.ai?.workerCredentials?.[binding.workerCredentialId]
      ) {
        delete state.ai?.runtimeBindings?.[bindingWorkerId];
      }
    }
    if (
      targetProfileId &&
      !Object.values(state.ai?.workerCredentials ?? {}).some(
        (credential) => credential.aiProfileId === targetProfileId,
      )
    ) {
      delete state.ai?.aiProfiles?.[targetProfileId];
    }
    const nextCredential = selectBestWorkerCredentialForWorker(state, workerId);
    if (nextCredential) {
      setRuntimeBinding(state, workerId, {
        workerId,
        workerCredentialId: nextCredential.workerCredentialId,
        authProfileId: nextCredential.credential.authProfileId,
        boundAt: new Date().toISOString(),
      });
    } else {
      setRuntimeBinding(state, workerId, null);
    }
    reconcileStoredAiState(state.ai, workerId);
    await clearAlisioOpenAiRuntime({ authProfileIds: removedAuthProfileIds }).catch(
      () => undefined,
    );
    const nextActive = resolveBoundWorkerCredential(state, workerId);
    if (nextActive) {
      await applyAlisioOpenAiRuntime(nextActive.credential, {
        displayName: state.ai?.aiProfiles?.[nextActive.credential.aiProfileId]
          ? resolveAlisioAiProfileLabel({
              profile: state.ai.aiProfiles[nextActive.credential.aiProfileId],
              credential: nextActive.credential,
            })
          : (nextActive.credential.email ?? "OpenAI"),
      }).catch(() => undefined);
    }
    await persistState(state, env);
    return toAlisioAiState({
      state: state.ai,
      workerId,
      authStore: ensureAuthProfileStore(),
    });
  });
}

export async function selectAlisioAiProfile(
  input: { profileId: string },
  env?: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioAiState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    assertAlisioAccountSetupAccess(state, "OpenAI", env ?? process.env);
    const workerId = currentWorkerId();
    const profileId = input.profileId.trim();
    if (!state.ai?.aiProfiles?.[profileId]) {
      throw new AlisioAiError("invalid_callback", "The selected OpenAI profile no longer exists.");
    }
    const targetCredential = selectBestWorkerCredentialForProfile({
      aiProfileId: profileId,
      workerId,
      state: state.ai,
      authStore: ensureAuthProfileStore(),
    });
    if (!targetCredential) {
      throw new AlisioAiError(
        "invalid_callback",
        "The selected OpenAI profile is not available on this worker.",
      );
    }
    const refreshed = await refreshAlisioOpenAiSession({
      credential: targetCredential.record,
      fetchImpl,
    });
    ensureStoredAiState(state).workerCredentials = {
      ...state.ai?.workerCredentials,
      [targetCredential.workerCredentialId]: refreshed,
    };
    setRuntimeBinding(state, workerId, {
      workerId,
      workerCredentialId: targetCredential.workerCredentialId,
      authProfileId: refreshed.authProfileId,
      boundAt: new Date().toISOString(),
    });
    reconcileStoredAiState(state.ai, workerId);
    await persistState(state, env);
    const nextState = toAlisioAiState({
      state: state.ai,
      workerId,
      authStore: ensureAuthProfileStore(),
    });
    if (isAlisioAiReady(nextState)) {
      await applyAlisioOpenAiRuntime(refreshed, {
        displayName: state.ai?.aiProfiles?.[profileId]
          ? resolveAlisioAiProfileLabel({
              profile: state.ai.aiProfiles[profileId],
              credential: refreshed,
            })
          : (refreshed.email ?? "OpenAI"),
      }).catch(() => undefined);
    } else {
      await clearAlisioOpenAiRuntime({
        authProfileIds: [refreshed.authProfileId],
      }).catch(() => undefined);
    }
    return nextState;
  });
}

export async function renameAlisioAiProfile(
  input: { profileId: string; label: string },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioAiState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    assertAlisioAccountSetupAccess(state, "OpenAI", env ?? process.env);
    const workerId = currentWorkerId();
    const profileId = input.profileId.trim();
    const profile = state.ai?.aiProfiles?.[profileId];
    if (!profile) {
      throw new AlisioAiError("invalid_callback", "The selected OpenAI profile no longer exists.");
    }
    const _representative = selectBestWorkerCredentialForProfile({
      aiProfileId: profileId,
      workerId,
      state: state.ai,
      authStore: ensureAuthProfileStore(),
    })?.record;
    const nextCustomLabel = input.label.trim();
    const { label: _previousLabel, ...profileWithoutLabel } = profile;
    const nextProfile = nextCustomLabel
      ? {
          ...profileWithoutLabel,
          label: nextCustomLabel,
        }
      : profileWithoutLabel;
    ensureStoredAiState(state).aiProfiles = {
      ...state.ai?.aiProfiles,
      [profileId]: nextProfile,
    };
    reconcileStoredAiState(state.ai, workerId);
    await persistState(state, env);
    const active = resolveBoundWorkerCredential(state, workerId);
    const nextState = toAlisioAiState({
      state: state.ai,
      workerId,
      authStore: ensureAuthProfileStore(),
    });
    if (active && active.credential.aiProfileId === profileId && isAlisioAiReady(nextState)) {
      await applyAlisioOpenAiRuntime(active.credential, {
        displayName: resolveAlisioAiProfileLabel({
          profile: nextProfile,
          credential: active.credential,
        }),
      }).catch(() => undefined);
    }
    return nextState;
  });
}

export async function refreshAlisioAiLimits(
  input?: { profileId?: string },
  env?: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioAiState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    assertAlisioAccountSetupAccess(state, "OpenAI", env ?? process.env);
    const workerId = currentWorkerId();
    const requestedProfileId = input?.profileId?.trim();
    const refreshSelections = requestedProfileId
      ? [
          selectBestWorkerCredentialForProfile({
            aiProfileId: requestedProfileId,
            workerId,
            state: state.ai,
            authStore: ensureAuthProfileStore(),
          }),
        ]
          .filter(
            (
              candidate,
            ): candidate is {
              workerCredentialId: string;
              record: AlisioStoredWorkerAiCredential;
              score: AlisioAiCredentialSelection;
            } => Boolean(candidate),
          )
          .map((candidate) => resolveSelectedWorkerCredentialRecord(candidate))
      : (() => {
          const selections = selectBestWorkerCredentialsForWorker(state, workerId);
          if (selections.length > 0) {
            return selections;
          }
          const fallback = resolveBoundWorkerCredential(state, workerId);
          return fallback ? [fallback] : [];
        })();
    if (refreshSelections.length === 0) {
      return toAlisioAiState({
        state: state.ai,
        workerId,
        authStore: ensureAuthProfileStore(),
      });
    }

    const refreshedSelections = await Promise.all(
      refreshSelections.map(async (selection) => ({
        workerCredentialId: selection.workerCredentialId,
        credential: await refreshAlisioOpenAiSession({
          credential: selection.credential,
          fetchImpl,
          forceTelemetry: true,
        }),
      })),
    );

    ensureStoredAiState(state).workerCredentials = {
      ...state.ai?.workerCredentials,
      ...Object.fromEntries(
        refreshedSelections.map((selection) => [
          selection.workerCredentialId,
          selection.credential,
        ]),
      ),
    };
    const activeWorkerCredentialId = state.ai?.runtimeBindings?.[workerId]?.workerCredentialId;
    const activeSelection = activeWorkerCredentialId
      ? (refreshedSelections.find(
          (selection) => selection.workerCredentialId === activeWorkerCredentialId,
        ) ?? null)
      : null;
    if (
      activeSelection &&
      state.ai?.runtimeBindings?.[workerId]?.workerCredentialId ===
        activeSelection.workerCredentialId
    ) {
      setRuntimeBinding(state, workerId, {
        workerId,
        workerCredentialId: activeSelection.workerCredentialId,
        authProfileId: activeSelection.credential.authProfileId,
        boundAt: state.ai.runtimeBindings[workerId]?.boundAt ?? new Date().toISOString(),
      });
    }
    reconcileStoredAiState(state.ai, workerId);
    await persistState(state, env);
    const nextState = toAlisioAiState({
      state: state.ai,
      workerId,
      authStore: ensureAuthProfileStore(),
    });
    if (
      activeSelection &&
      state.ai?.runtimeBindings?.[workerId]?.workerCredentialId ===
        activeSelection.workerCredentialId &&
      isAlisioAiReady(nextState)
    ) {
      await applyAlisioOpenAiRuntime(activeSelection.credential, {
        displayName: state.ai?.aiProfiles?.[activeSelection.credential.aiProfileId]
          ? resolveAlisioAiProfileLabel({
              profile: state.ai.aiProfiles[activeSelection.credential.aiProfileId],
              credential: activeSelection.credential,
            })
          : (activeSelection.credential.email ?? "OpenAI"),
      }).catch(() => undefined);
    }
    return nextState;
  });
}

function syncAlisioSharingTargetsOnState(
  state: AlisioStoredState,
  targets: readonly AlisioSharingRuntimeTarget[],
) {
  if (targets.length === 0) {
    return false;
  }
  const viewer = buildCurrentSharingPrincipal(state);
  const sharing = ensureStoredSharingState(state);
  let changed = false;
  const seenTargetIds = new Set<string>();
  const now = new Date().toISOString();

  for (const target of targets) {
    const targetId = target.targetId.trim();
    if (!targetId) {
      continue;
    }
    seenTargetIds.add(targetId);
    const existing = sharing.targets?.[targetId];
    const owner =
      target.current || !existing
        ? viewer
        : {
            ownerKey: existing.ownerKey,
            ownerScope: existing.ownerScope,
            label: existing.ownerLabel,
            ...(existing.ownerEmail ? { email: existing.ownerEmail } : {}),
          };
    const nextTarget: AlisioStoredSharingTarget = {
      targetId,
      label: target.label.trim() || existing?.label || targetId,
      ...(target.platform?.trim() ? { platform: target.platform.trim() } : {}),
      sourceKind: target.sourceKind,
      connected: target.connected,
      current: target.current,
      ownerKey: owner.ownerKey,
      ownerScope: owner.ownerScope,
      ownerLabel: owner.label,
      ...(owner.email ? { ownerEmail: owner.email } : {}),
      registeredAt: existing?.registeredAt ?? now,
      updatedAt: existing?.updatedAt ?? now,
    };
    const targetChanged =
      !existing ||
      existing.label !== nextTarget.label ||
      existing.platform !== nextTarget.platform ||
      existing.sourceKind !== nextTarget.sourceKind ||
      existing.connected !== nextTarget.connected ||
      existing.current !== nextTarget.current ||
      existing.ownerKey !== nextTarget.ownerKey ||
      existing.ownerScope !== nextTarget.ownerScope ||
      existing.ownerLabel !== nextTarget.ownerLabel ||
      existing.ownerEmail !== nextTarget.ownerEmail;
    if (targetChanged) {
      sharing.targets = {
        ...sharing.targets,
        [targetId]: {
          ...nextTarget,
          updatedAt: now,
        },
      };
      changed = true;
    }
  }

  for (const [targetId, existing] of Object.entries(sharing.targets ?? {})) {
    if (seenTargetIds.has(targetId)) {
      continue;
    }
    if (!existing.connected && !existing.current) {
      continue;
    }
    sharing.targets = {
      ...sharing.targets,
      [targetId]: {
        ...existing,
        connected: false,
        current: false,
        updatedAt: now,
      },
    };
    changed = true;
  }

  return changed;
}

function buildAlisioSharingAccessIndexFromState(
  state: AlisioStoredState,
): Record<string, AlisioSharingTargetState> {
  return Object.fromEntries(
    Object.values(state.sharing?.targets ?? {}).map((target) => [
      target.targetId,
      buildAlisioSharingTargetState({
        state,
        target,
        viewer: buildCurrentSharingPrincipal(state),
        planSupported: gateAlisioSharing({ plan: resolveStoredAlisioPlan(state) }).ok,
      }),
    ]),
  );
}

type AlisioSharingRequestMutation = {
  result: { ok: true; requestId: string };
  request: AlisioStoredSharingRequest;
  grant?: AlisioStoredSharingGrant;
  auditEntry: AlisioSharingAuditEntry;
};

type AlisioSharingApprovedMutation = {
  decision: "approved";
  result: { ok: true; requestId: string; grantId: string };
  request: AlisioStoredSharingRequest;
  grant: AlisioStoredSharingGrant;
  auditEntry: AlisioSharingAuditEntry;
};

type AlisioSharingDeniedMutation = {
  decision: "denied";
  result: { ok: true; requestId: string };
  request: AlisioStoredSharingRequest;
  auditEntry: AlisioSharingAuditEntry;
};

type AlisioSharingRevokeMutation = {
  result: { ok: true; grantId: string; targetId: string };
  request?: AlisioStoredSharingRequest;
  grant: AlisioStoredSharingGrant;
  auditEntry: AlisioSharingAuditEntry;
};

type AlisioSharingPolicyMutation = {
  result: { ok: true; allowExternalUse: boolean };
  policy: AlisioSharingPolicyState;
  auditEntry: AlisioSharingAuditEntry;
};

function requestAlisioSharingAccessOnState(
  state: AlisioStoredState,
  input: {
    targetId: string;
    scopes?: readonly AlisioStoredSharingScope[];
  },
  env?: NodeJS.ProcessEnv,
): AlisioSharingRequestMutation {
  warnOnLegacySharingScopeInput(input.scopes);
  assertAlisioAccountSetupAccess(state, "organization", env ?? process.env);
  const gate = gateAlisioSharing({ plan: resolveStoredAlisioPlan(state) });
  if (!gate.ok) {
    throw new AlisioAccountValidationError(gate.message);
  }
  const targetId = input.targetId.trim();
  const target = state.sharing?.targets?.[targetId];
  if (!target) {
    throw new AlisioAccountValidationError("That device is no longer available.");
  }
  const viewer = buildCurrentSharingPrincipal(state);
  if (target.ownerKey === viewer.ownerKey && target.current) {
    throw new AlisioAccountValidationError("You already own this device.");
  }
  if (
    isLinkedSameAccountSharingTarget({
      target,
      viewer,
    })
  ) {
    const existingGrant = resolveActiveSharingGrant({
      grants: state.sharing?.grants,
      targetId,
      granteeOwnerKey: viewer.ownerKey,
    });
    const existingGrantScopes = existingGrant
      ? normalizeAlisioSharingScopes(existingGrant.scopes)
      : [];
    const defaultScopes = resolveLinkedSameAccountDefaultScopes({
      target,
      viewer,
      planSupported: true,
    });
    const requestedScopes = normalizeAlisioSharingScopes(input.scopes);
    const effectiveScopes = normalizeAlisioSharingScopes([
      ...defaultScopes,
      ...existingGrantScopes,
    ]);
    const scopesToGrant = requestedScopes.filter((scope) => !effectiveScopes.includes(scope));
    if (scopesToGrant.length === 0) {
      throw new AlisioAccountValidationError("You already have access to this linked device.");
    }
    const requestId = randomUUID();
    const now = new Date().toISOString();
    const grantId = existingGrant?.grantId ?? randomUUID();
    const nextGrant = {
      grantId,
      requestId,
      targetId,
      targetLabel: target.label,
      ...(target.platform ? { targetPlatform: target.platform } : {}),
      targetSourceKind: target.sourceKind,
      owner: viewer,
      grantee: viewer,
      scopes: normalizeAlisioSharingScopes([...existingGrantScopes, ...scopesToGrant]),
      approvedAt: existingGrant?.approvedAt ?? now,
    } satisfies AlisioStoredSharingGrant;
    const nextRequest = {
      requestId,
      targetId,
      targetLabel: target.label,
      ...(target.platform ? { targetPlatform: target.platform } : {}),
      targetSourceKind: target.sourceKind,
      requester: viewer,
      owner: viewer,
      scopes: normalizeAlisioSharingScopes([...defaultScopes, ...nextGrant.scopes]),
      status: "approved",
      createdAt: now,
      resolvedAt: now,
      grantId,
    } satisfies AlisioStoredSharingRequest;
    ensureStoredSharingState(state).grants = {
      ...state.sharing?.grants,
      [grantId]: nextGrant,
    };
    ensureStoredSharingState(state).requests = {
      ...state.sharing?.requests,
      [requestId]: nextRequest,
    };
    const auditEntry = appendAlisioSharingAuditEntry(state, {
      action: "request.approved",
      actor: viewer,
      targetId,
      targetLabel: target.label,
      requestId,
      grantId,
      summary: `${viewer.label} approved linked-device access to ${target.label}.`,
    });
    return {
      result: { ok: true, requestId },
      request: nextRequest,
      grant: nextGrant,
      auditEntry,
    };
  }
  if (
    !canRequestAlisioSharingTarget({
      state,
      target,
      viewer,
      planSupported: true,
    })
  ) {
    throw new AlisioAccountValidationError(
      "That device is not accepting external sharing requests right now.",
    );
  }
  const existingGrant = resolveActiveSharingGrant({
    grants: state.sharing?.grants,
    targetId,
    granteeOwnerKey: viewer.ownerKey,
  });
  const requestedScopes = normalizeAlisioSharingScopes(input.scopes);
  const existingGrantScopes = existingGrant
    ? normalizeAlisioSharingScopes(existingGrant.scopes)
    : [];
  const scopesToRequest = existingGrant
    ? requestedScopes.filter((scope) => !existingGrantScopes.includes(scope))
    : requestedScopes;
  if (existingGrant && scopesToRequest.length === 0) {
    throw new AlisioAccountValidationError("You already have access to this device.");
  }
  const existingRequest = resolveLatestSharingRequest({
    requests: state.sharing?.requests,
    targetId,
    requesterOwnerKey: viewer.ownerKey,
  });
  if (
    normalizeAlisioSharingRequestStatus(existingRequest?.status) === "pending" &&
    existingRequest
  ) {
    const nextScopes = normalizeAlisioSharingScopes([
      ...existingRequest.scopes,
      ...scopesToRequest,
    ]);
    const nextRequest = {
      ...existingRequest,
      scopes: nextScopes,
    } satisfies AlisioStoredSharingRequest;
    ensureStoredSharingState(state).requests = {
      ...state.sharing?.requests,
      [existingRequest.requestId]: nextRequest,
    };
    const existingAuditEntry = (state.sharing?.audit ?? []).find(
      (entry) => entry.requestId === existingRequest.requestId,
    );
    const auditEntry = existingAuditEntry
      ? toAlisioSharingAuditEntry(existingAuditEntry)
      : appendAlisioSharingAuditEntry(state, {
          action: "request.created",
          actor: viewer,
          targetId,
          targetLabel: target.label,
          requestId: existingRequest.requestId,
          summary: `${viewer.label} requested access to ${target.label}.`,
        });
    return {
      result: { ok: true, requestId: existingRequest.requestId },
      request: nextRequest,
      auditEntry,
    };
  }
  const requestId = randomUUID();
  const nextRequest = {
    requestId,
    targetId,
    targetLabel: target.label,
    ...(target.platform ? { targetPlatform: target.platform } : {}),
    targetSourceKind: target.sourceKind,
    requester: viewer,
    owner: {
      ownerKey: target.ownerKey,
      ownerScope: target.ownerScope,
      label: target.ownerLabel,
      ...(target.ownerEmail ? { email: target.ownerEmail } : {}),
    },
    scopes: scopesToRequest,
    status: "pending",
    createdAt: new Date().toISOString(),
  } satisfies AlisioStoredSharingRequest;
  ensureStoredSharingState(state).requests = {
    ...state.sharing?.requests,
    [requestId]: nextRequest,
  };
  const auditEntry = appendAlisioSharingAuditEntry(state, {
    action: "request.created",
    actor: viewer,
    targetId,
    targetLabel: target.label,
    requestId,
    summary: `${viewer.label} requested access to ${target.label}.`,
  });
  return {
    result: { ok: true, requestId },
    request: nextRequest,
    auditEntry,
  };
}

function approveAlisioSharingRequestOnState(
  state: AlisioStoredState,
  input: { requestId: string; scopes?: readonly AlisioStoredSharingScope[] },
  env?: NodeJS.ProcessEnv,
): AlisioSharingApprovedMutation {
  warnOnLegacySharingScopeInput(input.scopes);
  assertAlisioAccountSetupAccess(state, "organization", env ?? process.env);
  const gate = gateAlisioSharing({ plan: resolveStoredAlisioPlan(state) });
  if (!gate.ok) {
    throw new AlisioAccountValidationError(gate.message);
  }
  const requestId = input.requestId.trim();
  const request = state.sharing?.requests?.[requestId];
  if (!request || normalizeAlisioSharingRequestStatus(request.status) !== "pending") {
    throw new AlisioAccountValidationError("That sharing request is no longer pending.");
  }
  const viewer = buildCurrentSharingPrincipal(state);
  if (request.owner.ownerKey !== viewer.ownerKey) {
    throw new AlisioAccountValidationError("Only the device owner can approve this request.");
  }
  const target = state.sharing?.targets?.[request.targetId];
  if (!target || target.ownerKey !== viewer.ownerKey) {
    throw new AlisioAccountValidationError("That device is no longer owned by this account.");
  }
  const approvedScopes = input.scopes ? normalizeAlisioSharingScopes(input.scopes) : request.scopes;
  if (!canApproveAlisioSharingScopes({ requested: request.scopes, approved: approvedScopes })) {
    throw new AlisioAccountValidationError(
      "Approved scopes must stay within the requested access.",
    );
  }
  const existingGrant = resolveActiveSharingGrant({
    grants: state.sharing?.grants,
    targetId: request.targetId,
    granteeOwnerKey: request.requester.ownerKey,
  });
  const grantId = existingGrant?.grantId ?? randomUUID();
  const nextGrant = {
    grantId,
    requestId,
    targetId: request.targetId,
    targetLabel: request.targetLabel,
    ...(request.targetPlatform ? { targetPlatform: request.targetPlatform } : {}),
    targetSourceKind: request.targetSourceKind,
    owner: request.owner,
    grantee: request.requester,
    scopes: approvedScopes,
    approvedAt: existingGrant?.approvedAt ?? new Date().toISOString(),
  } satisfies AlisioStoredSharingGrant;
  ensureStoredSharingState(state).grants = {
    ...state.sharing?.grants,
    [grantId]: nextGrant,
  };
  const nextRequest = {
    ...request,
    scopes: approvedScopes,
    status: "approved",
    resolvedAt: new Date().toISOString(),
    grantId,
  } satisfies AlisioStoredSharingRequest;
  ensureStoredSharingState(state).requests = {
    ...state.sharing?.requests,
    [requestId]: nextRequest,
  };
  const auditEntry = appendAlisioSharingAuditEntry(state, {
    action: "request.approved",
    actor: viewer,
    targetId: request.targetId,
    targetLabel: request.targetLabel,
    requestId,
    grantId,
    summary: `${viewer.label} approved access to ${request.targetLabel}.`,
  });
  return {
    decision: "approved",
    result: { ok: true, requestId, grantId },
    request: nextRequest,
    grant: nextGrant,
    auditEntry,
  };
}

function rejectAlisioSharingRequestOnState(
  state: AlisioStoredState,
  input: { requestId: string },
  env?: NodeJS.ProcessEnv,
): AlisioSharingDeniedMutation {
  assertAlisioAccountSetupAccess(state, "organization", env ?? process.env);
  const gate = gateAlisioSharing({ plan: resolveStoredAlisioPlan(state) });
  if (!gate.ok) {
    throw new AlisioAccountValidationError(gate.message);
  }
  const requestId = input.requestId.trim();
  const request = state.sharing?.requests?.[requestId];
  if (!request || normalizeAlisioSharingRequestStatus(request.status) !== "pending") {
    throw new AlisioAccountValidationError("That sharing request is no longer pending.");
  }
  const viewer = buildCurrentSharingPrincipal(state);
  if (request.owner.ownerKey !== viewer.ownerKey) {
    throw new AlisioAccountValidationError("Only the device owner can reject this request.");
  }
  const nextRequest = {
    ...request,
    status: "denied",
    resolvedAt: new Date().toISOString(),
  } satisfies AlisioStoredSharingRequest;
  ensureStoredSharingState(state).requests = {
    ...state.sharing?.requests,
    [requestId]: nextRequest,
  };
  const auditEntry = appendAlisioSharingAuditEntry(state, {
    action: "request.denied",
    actor: viewer,
    targetId: request.targetId,
    targetLabel: request.targetLabel,
    requestId,
    summary: `${viewer.label} denied access to ${request.targetLabel}.`,
  });
  return {
    decision: "denied",
    result: { ok: true, requestId },
    request: nextRequest,
    auditEntry,
  };
}

function revokeAlisioSharingGrantOnState(
  state: AlisioStoredState,
  input: { grantId: string },
  env?: NodeJS.ProcessEnv,
): AlisioSharingRevokeMutation {
  assertAlisioAccountSetupAccess(state, "organization", env ?? process.env);
  const gate = gateAlisioSharing({ plan: resolveStoredAlisioPlan(state) });
  if (!gate.ok) {
    throw new AlisioAccountValidationError(gate.message);
  }
  const grantId = input.grantId.trim();
  const grant = state.sharing?.grants?.[grantId];
  if (!grant || grant.revokedAt) {
    throw new AlisioAccountValidationError("That sharing grant no longer exists.");
  }
  const viewer = buildCurrentSharingPrincipal(state);
  const canRevoke =
    grant.owner.ownerKey === viewer.ownerKey || grant.grantee.ownerKey === viewer.ownerKey;
  if (!canRevoke) {
    throw new AlisioAccountValidationError("Only the owner or grantee can revoke this access.");
  }
  const nextGrant = {
    ...grant,
    revokedAt: new Date().toISOString(),
  } satisfies AlisioStoredSharingGrant;
  ensureStoredSharingState(state).grants = {
    ...state.sharing?.grants,
    [grantId]: nextGrant,
  };
  const request = state.sharing?.requests?.[grant.requestId];
  const nextRequest = request
    ? ({
        ...request,
        status: "revoked",
        resolvedAt: new Date().toISOString(),
        grantId,
      } satisfies AlisioStoredSharingRequest)
    : undefined;
  if (nextRequest) {
    ensureStoredSharingState(state).requests = {
      ...state.sharing?.requests,
      [grant.requestId]: nextRequest,
    };
  }
  const auditEntry = appendAlisioSharingAuditEntry(state, {
    action: "grant.revoked",
    actor: viewer,
    targetId: grant.targetId,
    targetLabel: grant.targetLabel,
    requestId: grant.requestId,
    grantId,
    summary: `${viewer.label} revoked access to ${grant.targetLabel}.`,
  });
  return {
    result: { ok: true, grantId, targetId: grant.targetId },
    ...(nextRequest ? { request: nextRequest } : {}),
    grant: nextGrant,
    auditEntry,
  };
}

function setAlisioSharingPolicyOnState(
  state: AlisioStoredState,
  input: { allowExternalUse: boolean },
  env?: NodeJS.ProcessEnv,
): AlisioSharingPolicyMutation {
  assertAlisioAccountSetupAccess(state, "organization", env ?? process.env);
  const gate = gateAlisioSharing({ plan: resolveStoredAlisioPlan(state) });
  if (!gate.ok) {
    throw new AlisioAccountValidationError(gate.message);
  }
  const effectiveOrganization = resolveEffectiveAlisioOrganizationState({
    plan: resolveStoredAlisioPlan(state),
    organization: state.organization,
  });
  if (effectiveOrganization.mode !== "owner") {
    throw new AlisioAccountValidationError(
      "Only organization owners can change external sharing policy.",
    );
  }
  const viewer = buildCurrentSharingPrincipal(state);
  const nextPolicy = {
    ownerKey: viewer.ownerKey,
    allowExternalUse: input.allowExternalUse,
    updatedAt: new Date().toISOString(),
    updatedBy: viewer,
  } satisfies AlisioSharingPolicyState;
  ensureStoredSharingState(state).policies = {
    ...state.sharing?.policies,
    [viewer.ownerKey]: nextPolicy,
  };
  const auditEntry = appendAlisioSharingAuditEntry(state, {
    action: "policy.updated",
    actor: viewer,
    summary: `${viewer.label} ${input.allowExternalUse ? "enabled" : "disabled"} external device sharing.`,
  });
  return {
    result: { ok: true, allowExternalUse: input.allowExternalUse },
    policy: nextPolicy,
    auditEntry,
  };
}

export async function getAlisioSharingState(
  input?: { targets?: readonly AlisioSharingRuntimeTarget[] },
  env?: NodeJS.ProcessEnv,
): Promise<AlisioSharingState> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const remoteSharing = await loadAlisioSharingStateFromCloud(state, input, env);
    if (remoteSharing) {
      return buildAlisioSharingStateFromStoredState({
        ...state,
        sharing: remoteSharing,
      });
    }
    const changed = input?.targets ? syncAlisioSharingTargetsOnState(state, input.targets) : false;
    if (changed) {
      await persistState(state, env);
    }
    return buildAlisioSharingStateFromStoredState(state);
  });
}

export async function getAlisioSharingTargetAccessIndex(
  input?: { targets?: readonly AlisioSharingRuntimeTarget[] },
  env?: NodeJS.ProcessEnv,
): Promise<Record<string, AlisioSharingTargetState>> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const remoteSharing = await loadAlisioSharingStateFromCloud(state, input, env);
    if (remoteSharing) {
      return buildAlisioSharingAccessIndexFromState({
        ...state,
        sharing: remoteSharing,
      });
    }
    const changed = input?.targets ? syncAlisioSharingTargetsOnState(state, input.targets) : false;
    if (changed) {
      await persistState(state, env);
    }
    return buildAlisioSharingAccessIndexFromState(state);
  });
}

export async function requestAlisioSharingAccess(
  input: {
    targetId: string;
    scopes?: readonly AlisioStoredSharingScope[];
  },
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: true; requestId: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const remoteSharing = await loadAlisioSharingStateFromCloud(state, undefined, env);
    if (remoteSharing) {
      const remoteState = {
        ...state,
        sharing: remoteSharing,
      };
      const mutation = requestAlisioSharingAccessOnState(remoteState, input, env);
      const accessToken = resolveActiveAlisioSharingCloudAccessToken(state, env);
      if (!accessToken) {
        throw new AlisioAccountValidationError("The Alisio sharing cloud session is unavailable.");
      }
      await upsertAlisioSharingCloudRequest({
        env,
        accessToken,
        request: mutation.request,
      });
      if (mutation.grant) {
        await upsertAlisioSharingCloudGrant({
          env,
          accessToken,
          grant: mutation.grant,
        });
      }
      await appendAlisioSharingCloudAuditEntry({
        env,
        accessToken,
        entry: mutation.auditEntry,
      });
      return mutation.result;
    }
    const mutation = requestAlisioSharingAccessOnState(state, input, env);
    await persistState(state, env);
    return mutation.result;
  });
}

export async function approveAlisioSharingRequest(
  input: { requestId: string; scopes?: readonly AlisioStoredSharingScope[] },
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: true; requestId: string; grantId: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const remoteSharing = await loadAlisioSharingStateFromCloud(state, undefined, env);
    if (remoteSharing) {
      const remoteState = {
        ...state,
        sharing: remoteSharing,
      };
      const mutation = approveAlisioSharingRequestOnState(remoteState, input, env);
      const accessToken = resolveActiveAlisioSharingCloudAccessToken(state, env);
      if (!accessToken) {
        throw new AlisioAccountValidationError("The Alisio sharing cloud session is unavailable.");
      }
      await upsertAlisioSharingCloudRequest({
        env,
        accessToken,
        request: mutation.request,
      });
      await upsertAlisioSharingCloudGrant({
        env,
        accessToken,
        grant: mutation.grant,
      });
      await appendAlisioSharingCloudAuditEntry({
        env,
        accessToken,
        entry: mutation.auditEntry,
      });
      return mutation.result;
    }
    const mutation = approveAlisioSharingRequestOnState(state, input, env);
    await persistState(state, env);
    return mutation.result;
  });
}

export async function rejectAlisioSharingRequest(
  input: { requestId: string },
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: true; requestId: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const remoteSharing = await loadAlisioSharingStateFromCloud(state, undefined, env);
    if (remoteSharing) {
      const remoteState = {
        ...state,
        sharing: remoteSharing,
      };
      const mutation = rejectAlisioSharingRequestOnState(remoteState, input, env);
      const accessToken = resolveActiveAlisioSharingCloudAccessToken(state, env);
      if (!accessToken) {
        throw new AlisioAccountValidationError("The Alisio sharing cloud session is unavailable.");
      }
      await upsertAlisioSharingCloudRequest({
        env,
        accessToken,
        request: mutation.request,
      });
      await appendAlisioSharingCloudAuditEntry({
        env,
        accessToken,
        entry: mutation.auditEntry,
      });
      return mutation.result;
    }
    const mutation = rejectAlisioSharingRequestOnState(state, input, env);
    await persistState(state, env);
    return mutation.result;
  });
}

export async function revokeAlisioSharingGrant(
  input: { grantId: string },
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: true; grantId: string; targetId: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const remoteSharing = await loadAlisioSharingStateFromCloud(state, undefined, env);
    if (remoteSharing) {
      const remoteState = {
        ...state,
        sharing: remoteSharing,
      };
      const mutation = revokeAlisioSharingGrantOnState(remoteState, input, env);
      const accessToken = resolveActiveAlisioSharingCloudAccessToken(state, env);
      if (!accessToken) {
        throw new AlisioAccountValidationError("The Alisio sharing cloud session is unavailable.");
      }
      await upsertAlisioSharingCloudGrant({
        env,
        accessToken,
        grant: mutation.grant,
      });
      if (mutation.request) {
        await upsertAlisioSharingCloudRequest({
          env,
          accessToken,
          request: mutation.request,
        });
      }
      await appendAlisioSharingCloudAuditEntry({
        env,
        accessToken,
        entry: mutation.auditEntry,
      });
      return mutation.result;
    }
    const mutation = revokeAlisioSharingGrantOnState(state, input, env);
    await persistState(state, env);
    return mutation.result;
  });
}

export async function setAlisioSharingPolicy(
  input: { allowExternalUse: boolean },
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: true; allowExternalUse: boolean }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const remoteSharing = await loadAlisioSharingStateFromCloud(state, undefined, env);
    if (remoteSharing) {
      const remoteState = {
        ...state,
        sharing: remoteSharing,
      };
      const mutation = setAlisioSharingPolicyOnState(remoteState, input, env);
      const accessToken = resolveActiveAlisioSharingCloudAccessToken(state, env);
      if (!accessToken) {
        throw new AlisioAccountValidationError("The Alisio sharing cloud session is unavailable.");
      }
      await upsertAlisioSharingCloudPolicy({
        env,
        accessToken,
        policy: mutation.policy,
      });
      await appendAlisioSharingCloudAuditEntry({
        env,
        accessToken,
        entry: mutation.auditEntry,
      });
      return mutation.result;
    }
    const mutation = setAlisioSharingPolicyOnState(state, input, env);
    await persistState(state, env);
    return mutation.result;
  });
}

export async function getAlisioOrganizationState(
  env?: NodeJS.ProcessEnv,
): Promise<AlisioOrganizationMembershipState> {
  const runtimeEnv = env ?? process.env;
  const state = await loadStoredState(runtimeEnv);
  if (!hasReadyAlisioAccountSession(state, runtimeEnv)) {
    return { mode: "none" };
  }
  return resolveEffectiveAlisioOrganizationState({
    plan: resolveStoredAlisioPlan(state),
    organization: state.organization,
  });
}

function normalizeAlisioOrganizationStateInput(
  input:
    | { mode: "none" }
    | { mode: "owner"; organizationName: string }
    | { mode: "member"; organizationName: string; inviteEmail?: string },
): AlisioOrganizationMembershipState {
  if (input.mode === "none") {
    return { mode: "none" };
  }
  const organizationName = input.organizationName.trim();
  if (!organizationName) {
    throw new Error("Organization name is required.");
  }
  if (input.mode === "owner") {
    return {
      mode: "owner",
      organizationName,
    };
  }
  const inviteEmail = input.inviteEmail?.trim();
  if (inviteEmail) {
    const inviteEmailError = validateAlisioEmail(inviteEmail);
    if (inviteEmailError) {
      throw new Error("Invitation email must be a valid email address.");
    }
  }
  return {
    mode: "member",
    organizationName,
    ...(inviteEmail ? { inviteEmail } : {}),
  };
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
    assertAlisioAccountSetupAccess(state, "organization", env ?? process.env);
    const nextOrganization = normalizeAlisioOrganizationStateInput(input);
    const gate = gateAlisioOrganizationMembership({
      plan: resolveStoredAlisioPlan(state),
      mode: nextOrganization.mode,
    });
    if (!gate.ok) {
      throw new AlisioAccountValidationError(gate.message);
    }
    state.organization = nextOrganization;
    await persistState(state, env);
    return resolveEffectiveAlisioOrganizationState({
      plan: resolveStoredAlisioPlan(state),
      organization: state.organization,
    });
  });
}

export async function listAlisioConnectorAuthorizations(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioConnectorAuthorization[]> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    if (!hasReadyAlisioAccountSession(state, env)) {
      return buildDefaultConnectorAuthorizations(env);
    }
    let changed = false;
    for (const connector of CONNECTOR_CATALOG) {
      const existing = state.authorizations[connector.id];
      const credential = state.oauthCredentials[connector.id];
      if (!existing) {
        continue;
      }
      if (!credential) {
        if (existing.state === "connected") {
          markAuthorizationNeedsReconnect(state, connector, existing);
          changed = true;
        }
        continue;
      }
      const legacyPlaintext =
        typeof credential.accessToken === "string" || typeof credential.refreshToken === "string";
      const wasExpired = isOAuthCredentialExpired(credential.expiresAt);
      const refreshed = await refreshStoredConnectorCredential({
        state,
        connector,
        existingAuthorization: existing,
        env,
        fetchImpl,
      });
      if (!refreshed) {
        changed = true;
        continue;
      }
      if (legacyPlaintext || wasExpired) {
        changed = true;
      }
    }

    if (changed) {
      await persistState(state, env);
    }

    return CONNECTOR_CATALOG.map((connector) => {
      const existing = state.authorizations[connector.id];
      if (existing) {
        return existing;
      }
      return buildDefaultConnectorAuthorization(connector, env);
    });
  });
}

export async function getAlisioConnectorAccessToken(
  connectorId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const result = await getAlisioConnectorAccessTokenStatus(connectorId, env, fetchImpl);
  return result.accessToken;
}

async function getAlisioConnectorAccessTokenStatus(
  connectorId: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<{ accessToken: string | null; reconnectRequired: boolean }> {
  return withLock(async () => {
    const connector = CONNECTOR_CATALOG.find((entry) => entry.id === connectorId.trim());
    if (!connector) {
      return { accessToken: null, reconnectRequired: false };
    }
    const state = await loadStoredState(env);
    if (!hasReadyAlisioAccountSession(state, env)) {
      return { accessToken: null, reconnectRequired: false };
    }
    const authorizationState = state.authorizations[connector.id]?.state ?? "not_connected";
    const refreshed = await refreshStoredConnectorCredential({
      state,
      connector,
      existingAuthorization: state.authorizations[connector.id],
      env,
      fetchImpl,
    });
    if (!refreshed) {
      await persistState(state, env);
      const nextAuthorizationState =
        state.authorizations[connector.id]?.state ?? authorizationState;
      return {
        accessToken: null,
        reconnectRequired: nextAuthorizationState === "needs_reconnect",
      };
    }
    const accessToken = readStoredAccessToken(refreshed, env);
    if (!accessToken) {
      markAuthorizationNeedsReconnect(state, connector, state.authorizations[connector.id]);
      delete state.oauthCredentials[connector.id];
      await persistState(state, env);
      return { accessToken: null, reconnectRequired: true };
    }
    await persistState(state, env);
    return { accessToken, reconnectRequired: false };
  });
}

function extractProviderErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  const message = (body as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  return fallback;
}

function extractProviderErrorReason(body: unknown) {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return undefined;
  }
  const reason = errors.find((entry): entry is { reason: string } =>
    Boolean(
      entry &&
      typeof entry === "object" &&
      typeof (entry as { reason?: unknown }).reason === "string" &&
      (entry as { reason: string }).reason.trim(),
    ),
  )?.reason;
  return reason?.trim() || undefined;
}

export async function sendAlisioGmailMessage(
  input: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    threadId?: string;
    bodyFormat?: "text" | "html";
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGmailSendResult> {
  let payload:
    | {
        raw: string;
        to: string[];
        cc?: string[];
        bcc?: string[];
      }
    | undefined;
  try {
    payload = buildRawGmailMessage(input);
  } catch (error) {
    return {
      ok: false,
      status: "send_failed",
      connectorId: GMAIL_SEND_CONNECTOR_ID,
      message: error instanceof Error ? error.message : "Invalid Gmail message payload.",
    };
  }

  const authorization = await getAlisioConnectorAccessTokenStatus(
    GMAIL_SEND_CONNECTOR_ID,
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: GMAIL_SEND_CONNECTOR_ID,
      message: authorization.reconnectRequired
        ? "Gmail Send authorization is no longer valid. Reconnect Gmail Send in Apps."
        : "Gmail Send is not connected in Alisio. Connect Gmail Send in Apps first.",
      reconnectRequired: authorization.reconnectRequired,
    };
  }

  try {
    const response = await fetchImpl(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          raw: payload.raw,
          ...(input.threadId?.trim() ? { threadId: input.threadId.trim() } : {}),
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !body || typeof body.id !== "string") {
      const providerReason = extractProviderErrorReason(body);
      const reconnectRequired =
        response.status === 401 ||
        providerReason === "authError" ||
        providerReason === "insufficientPermissions";
      const message =
        providerReason === "insufficientPermissions"
          ? "Gmail Send needs to be reconnected with the Gmail send permission."
          : reconnectRequired
            ? "Gmail Send authorization is no longer valid. Reconnect Gmail Send in Apps."
            : extractProviderErrorMessage(body, "Gmail rejected the send request.");
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "send_failed",
        connectorId: GMAIL_SEND_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }
    return {
      ok: true,
      status: "sent",
      connectorId: GMAIL_SEND_CONNECTOR_ID,
      messageId: body.id,
      ...(typeof body.threadId === "string" ? { threadId: body.threadId } : {}),
      to: payload.to,
      ...(payload.cc ? { cc: payload.cc } : {}),
      ...(payload.bcc ? { bcc: payload.bcc } : {}),
      subject: input.subject,
    };
  } catch {
    return {
      ok: false,
      status: "send_failed",
      connectorId: GMAIL_SEND_CONNECTOR_ID,
      message: "Gmail could not be reached right now. Try again in a moment.",
    };
  }
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

function assertSafeMailHeader(value: string, label: string) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} contains invalid line breaks.`);
  }
}

function parseMailRecipientList(value: string | undefined, label: string, required = false) {
  const normalized = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (required && normalized.length === 0) {
    throw new Error(`${label} required.`);
  }
  for (const recipient of normalized) {
    assertSafeMailHeader(recipient, label);
  }
  return normalized;
}

function encodeMimeHeaderValue(value: string) {
  assertSafeMailHeader(value, "subject");
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function foldBase64Content(value: string) {
  return value.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function buildRawGmailMessage(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  bodyFormat?: "text" | "html";
}) {
  const to = parseMailRecipientList(input.to, "to", true);
  const cc = parseMailRecipientList(input.cc, "cc");
  const bcc = parseMailRecipientList(input.bcc, "bcc");
  const replyTo = input.replyTo?.trim();
  if (replyTo) {
    assertSafeMailHeader(replyTo, "replyTo");
  }
  const contentType = input.bodyFormat === "html" ? "text/html" : "text/plain";
  const bodyBase64 = foldBase64Content(Buffer.from(input.body, "utf8").toString("base64"));
  const lines = [
    `To: ${to.join(", ")}`,
    ...(cc.length > 0 ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length > 0 ? [`Bcc: ${bcc.join(", ")}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeMimeHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: ${contentType}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    bodyBase64,
    "",
  ];
  return {
    raw: Buffer.from(lines.join("\r\n"), "utf8").toString("base64url"),
    to,
    ...(cc.length > 0 ? { cc } : {}),
    ...(bcc.length > 0 ? { bcc } : {}),
  };
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
        CONNECTOR_TOKEN_ENCRYPTION_KEY_ENV,
      ];
    case "github":
      return [
        "ALISIO_GITHUB_CLIENT_ID",
        "ALISIO_GITHUB_CLIENT_SECRET",
        "ALISIO_GITHUB_REDIRECT_URI",
        CONNECTOR_TOKEN_ENCRYPTION_KEY_ENV,
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

export async function requestAlisioAccountRecoveryEmail(
  input: { email: string; callbackUrl?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; message: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new AlisioAccountValidationError("Enter the email for the Alisio account first.");
  }
  const validationError = validateAlisioEmail(email);
  if (validationError) {
    throw new AlisioAccountValidationError(validationError);
  }
  const callbackUrl = normalizeAlisioAccountCallbackUrl(input.callbackUrl, "account recovery");
  return requestAlisioCloudPasswordReset({ email, callbackUrl, env });
}

export async function changeAlisioAccountEmail(
  input: { email: string; callbackUrl?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; message: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const session = state.account.cloudSession;
    if (session?.state !== "signed_in" || session.backend !== "supabase") {
      throw new AlisioAccountValidationError(
        "Sign in to your Alisio cloud account before changing the email.",
      );
    }

    const email = input.email.trim().toLowerCase();
    if (!email) {
      throw new AlisioAccountValidationError(
        "Enter the new email address for this Alisio account first.",
      );
    }
    const validationError = validateAlisioEmail(email);
    if (validationError) {
      throw new AlisioAccountValidationError(validationError);
    }
    const currentEmail =
      session.email?.trim().toLowerCase() || state.account.profile.email.trim().toLowerCase();
    if (email === currentEmail) {
      throw new AlisioAccountValidationError("That is already the current email address.");
    }

    return await requestAlisioCloudAccountEmailChange({
      session,
      email,
      callbackUrl: normalizeAlisioAccountCallbackUrl(input.callbackUrl, "email change"),
      env,
    });
  });
}

export async function updateAlisioAccountPassword(
  input: { password: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; message: string }> {
  return withLock(async () => {
    const state = await loadStoredState(env);
    const session = state.account.cloudSession;
    if (session?.state !== "signed_in" || session.backend !== "supabase") {
      throw new AlisioAccountValidationError(
        "Sign in to your Alisio cloud account before updating the password.",
      );
    }
    if (input.password.length < 8) {
      throw new AlisioAccountValidationError("Use at least 8 characters for your Alisio password.");
    }
    return await updateAlisioCloudAccountPassword({
      session,
      password: input.password,
      env,
    });
  });
}

function providerSupportsRealCallback(
  provider: AlisioOAuthProvider,
): provider is "google" | "github" {
  return provider === "google" || provider === "github";
}

function isProviderClientConfigReady(provider: AlisioOAuthProvider, env: NodeJS.ProcessEnv) {
  if (!providerSupportsRealCallback(provider)) {
    return false;
  }
  const config = resolveOAuthClientConfig(provider, env);
  return Boolean(
    config.clientId &&
    config.clientSecret &&
    config.redirectUri &&
    resolveConnectorTokenEncryptionKey(env),
  );
}

function resolveDefaultConnectorAuthorizationHealth(
  connector: AlisioConnectorDefinition,
  env: NodeJS.ProcessEnv,
): AlisioAuthorizationHealth {
  if (connector.availability === "in_review") {
    return "in_review";
  }
  if (connector.availability === "unavailable") {
    return "unavailable";
  }
  const provider = resolveConnectorOAuthProvider(connector.id);
  if (!provider || !providerSupportsRealCallback(provider)) {
    return "config_missing";
  }
  return isProviderClientConfigReady(provider, env) ? "healthy" : "config_missing";
}

function buildAuthorizationUrl(params: {
  provider: AlisioOAuthProvider;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  stateToken: string;
  codeVerifier?: string;
}) {
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
    // For Google connectors we want the explicit account chooser first and
    // then the consent screen, matching the native Gmail/Calendar connection UX.
    url.searchParams.set("prompt", "select_account consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("scope", params.scopes.join(" "));
    if (params.codeVerifier) {
      url.searchParams.set("code_challenge", buildCodeChallenge(params.codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  if (params.provider === "github") {
    url.searchParams.set("scope", params.scopes.join(" "));
    url.searchParams.set("prompt", "select_account");
    if (params.codeVerifier) {
      url.searchParams.set("code_challenge", buildCodeChallenge(params.codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  if (params.provider === "notion") {
    url.searchParams.set("owner", "user");
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  url.searchParams.set("scope", params.scopes.join(" "));
  return url.toString();
}

function resolveRequestedOAuthScopes(connector: AlisioConnectorDefinition) {
  if (connector.id === "github") {
    return ["repo", "read:user", "user:email", "read:org", "gist"];
  }
  return connector.scopes;
}

function hasRequiredOAuthScopes(
  provider: AlisioOAuthProvider,
  grantedScopes: string[],
  requestedScopes: readonly string[],
) {
  if (grantedScopes.length === 0) {
    return true;
  }
  const granted = expandComparableOAuthScopes(provider, grantedScopes);
  return resolveOAuthScopesRequiredForValidation(provider, requestedScopes).every((scope) =>
    granted.has(scope),
  );
}

function markAuthorizationNeedsReconnect(
  state: AlisioStoredState,
  connector: AlisioConnectorDefinition,
  existing?: AlisioConnectorAuthorization,
) {
  const next: AlisioConnectorAuthorization = {
    connectorId: connector.id,
    state: "needs_reconnect",
    health: "needs_reconnect",
    scopes: existing?.scopes ?? connector.scopes,
    ...(existing?.connectedAt ? { connectedAt: existing.connectedAt } : {}),
    ...(existing?.connectedAccount ? { connectedAccount: existing.connectedAccount } : {}),
  };
  state.authorizations[connector.id] = next;
  return next;
}

function parseGrantedScopes(
  provider: AlisioOAuthProvider,
  scope: string | undefined,
  fallback: readonly string[],
) {
  const normalized = scope
    ?.split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return normalizeStoredOAuthScopes(provider, normalized ?? [], fallback);
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
    const state = await loadStoredState(env);
    assertAlisioAccountSetupAccess(state, "connector", env ?? process.env);
    const gate = gateAlisioConnectorConnection({
      plan: resolveStoredAlisioPlan(state),
      connectedCount: countAlisioLimitedConnectorSlots(Object.values(state.authorizations)),
      connectorAlreadyConnected:
        state.authorizations[connector.id]?.state === "connected" ||
        state.authorizations[connector.id]?.state === "needs_reconnect",
    });
    if (!gate.ok) {
      throw new AlisioAccountValidationError(gate.message);
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
    if (!resolveConnectorTokenEncryptionKey(env)) {
      return {
        connectorId: connector.id,
        availability: connector.availability,
        mode: "setup",
        statusReason: "missing_token_encryption",
        setupUrl: connector.setupUrl,
        ...providerGuide,
      };
    }

    const stateToken = buildStateToken();
    const codeVerifier =
      provider === "google" || provider === "github" ? buildCodeVerifier() : undefined;
    const requestedScopes = resolveRequestedOAuthScopes(connector);
    state.pendingAuthorizations[stateToken] = {
      connectorId: connector.id,
      provider,
      redirectUri: config.redirectUri,
      requestedScopes,
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
        scopes: requestedScopes,
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
      idToken: typeof body.id_token === "string" ? body.id_token : undefined,
      tokenType: typeof body.token_type === "string" ? body.token_type : undefined,
      scope: typeof body.scope === "string" ? body.scope : undefined,
      expiresIn: typeof body.expires_in === "number" ? body.expires_in : undefined,
    };
  } catch {
    return null;
  }
}

async function refreshGoogleAuthorizationCode(params: {
  config: ReturnType<typeof resolveOAuthClientConfig>;
  refreshToken: string;
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
        grant_type: "refresh_token",
        refresh_token: params.refreshToken,
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
  codeVerifier?: string;
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
    };
  } catch {
    return null;
  }
}

async function fetchGoogleAccount(params: {
  accessToken: string;
  idToken?: string;
  fetchImpl: typeof fetch;
}) {
  try {
    const response = await params.fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && body) {
      return {
        label:
          (typeof body.name === "string" && body.name.trim()) ||
          (typeof body.email === "string" && body.email.trim()) ||
          "Google account",
        email: typeof body.email === "string" ? body.email : undefined,
        handle: typeof body.sub === "string" ? body.sub : undefined,
      } satisfies AlisioConnectedAccount;
    }
  } catch {
    // Fall through to the ID token fallback below.
  }

  const idPayload = params.idToken ? decodeJwtPayload(params.idToken) : null;
  if (!idPayload) {
    return null;
  }
  const label =
    (typeof idPayload.name === "string" && idPayload.name.trim()) ||
    (typeof idPayload.email === "string" && idPayload.email.trim()) ||
    "Google account";
  return {
    label,
    email: typeof idPayload.email === "string" ? idPayload.email : undefined,
    handle: typeof idPayload.sub === "string" ? idPayload.sub : undefined,
  } satisfies AlisioConnectedAccount;
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

async function refreshStoredConnectorCredential(params: {
  state: AlisioStoredState;
  connector: AlisioConnectorDefinition;
  existingAuthorization?: AlisioConnectorAuthorization;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}) {
  const credential = params.state.oauthCredentials[params.connector.id];
  if (!credential) {
    return null;
  }
  if (!isOAuthCredentialExpired(credential.expiresAt)) {
    if (!readStoredAccessToken(credential, params.env)) {
      markAuthorizationNeedsReconnect(params.state, params.connector, params.existingAuthorization);
      delete params.state.oauthCredentials[params.connector.id];
      return null;
    }
    if (typeof credential.accessToken === "string" || typeof credential.refreshToken === "string") {
      if (!resolveConnectorTokenEncryptionKey(params.env)) {
        return credential;
      }
      const accessToken = readStoredAccessToken(credential, params.env);
      if (!accessToken) {
        markAuthorizationNeedsReconnect(
          params.state,
          params.connector,
          params.existingAuthorization,
        );
        delete params.state.oauthCredentials[params.connector.id];
        return null;
      }
      const refreshToken = readStoredRefreshToken(credential, params.env);
      const normalized = buildStoredOAuthCredential({
        provider: credential.provider,
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        ...(credential.tokenType ? { tokenType: credential.tokenType } : {}),
        ...(credential.scope ? { scope: credential.scope } : {}),
        ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
        createdAt: credential.createdAt,
        ...(credential.refreshedAt ? { refreshedAt: credential.refreshedAt } : {}),
        env: params.env,
      });
      params.state.oauthCredentials[params.connector.id] = normalized;
      return normalized;
    }
    return credential;
  }

  if (credential.provider !== "google") {
    markAuthorizationNeedsReconnect(params.state, params.connector, params.existingAuthorization);
    return null;
  }

  const refreshToken = readStoredRefreshToken(credential, params.env);
  if (!refreshToken) {
    markAuthorizationNeedsReconnect(params.state, params.connector, params.existingAuthorization);
    return null;
  }

  const config = resolveOAuthClientConfig("google", params.env);
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    markAuthorizationNeedsReconnect(params.state, params.connector, params.existingAuthorization);
    return null;
  }

  const refreshed = await refreshGoogleAuthorizationCode({
    config,
    refreshToken,
    fetchImpl: params.fetchImpl,
  });
  if (!refreshed) {
    markAuthorizationNeedsReconnect(params.state, params.connector, params.existingAuthorization);
    delete params.state.oauthCredentials[params.connector.id];
    return null;
  }

  const next = buildStoredOAuthCredential({
    provider: "google",
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    tokenType: refreshed.tokenType ?? credential.tokenType,
    scope: refreshed.scope ?? credential.scope,
    expiresAt:
      typeof refreshed.expiresIn === "number"
        ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
        : credential.expiresAt,
    createdAt: credential.createdAt,
    refreshedAt: new Date().toISOString(),
    env: params.env,
  });
  params.state.oauthCredentials[params.connector.id] = next;
  const existing = params.existingAuthorization ?? params.state.authorizations[params.connector.id];
  if (existing) {
    params.state.authorizations[params.connector.id] = {
      ...existing,
      state: "connected",
      health: "healthy",
      scopes: parseGrantedScopes(
        next.provider,
        next.scope,
        resolveRequestedOAuthScopes(params.connector),
      ),
    };
  }
  return next;
}

async function revokeGoogleOAuthCredential(params: {
  token: string;
  fetchImpl: typeof fetch;
}): Promise<void> {
  try {
    await params.fetchImpl("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        token: params.token,
      }),
    });
  } catch {
    // Best-effort revoke only.
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
    assertAlisioAccountSetupAccess(state, "connector", env ?? process.env);
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
    if (!resolveConnectorTokenEncryptionKey(env)) {
      delete state.pendingAuthorizations[input.stateToken!];
      await persistState(state, env);
      return {
        ok: false,
        reason: "missing_token_encryption",
        message:
          "Secure local token storage is unavailable on this gateway. Restore the macOS login keychain or configure ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY and try again.",
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
    const gate = gateAlisioConnectorConnection({
      plan: resolveStoredAlisioPlan(state),
      connectedCount: countAlisioLimitedConnectorSlots(Object.values(state.authorizations)),
      connectorAlreadyConnected:
        state.authorizations[connector.id]?.state === "connected" ||
        state.authorizations[connector.id]?.state === "needs_reconnect",
    });
    if (!gate.ok) {
      delete state.pendingAuthorizations[input.stateToken!];
      await persistState(state, env);
      return {
        ok: false,
        reason: "plan_upgrade_required",
        message: gate.message,
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
            codeVerifier: pending.codeVerifier,
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

    const requestedScopes =
      Array.isArray(pending.requestedScopes) && pending.requestedScopes.length > 0
        ? pending.requestedScopes
        : resolveRequestedOAuthScopes(connector);
    const grantedScopes = splitGrantedScopes(exchanged.scope);
    if (!hasRequiredOAuthScopes(pending.provider, grantedScopes, requestedScopes)) {
      delete state.pendingAuthorizations[input.stateToken!];
      await persistState(state, env);
      return {
        ok: false,
        reason: "token_exchange_failed",
        message: "OAuth completed without the scopes required for this connector.",
      } satisfies AlisioOAuthCallbackResult;
    }

    const connectedAccount =
      pending.provider === "google"
        ? await fetchGoogleAccount({
            accessToken: exchanged.accessToken,
            idToken: exchanged.idToken,
            fetchImpl,
          })
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

    const connectedAt = new Date().toISOString();
    const authorization: AlisioConnectorAuthorization = {
      connectorId: connector.id,
      state: "connected",
      health: "healthy",
      connectedAt,
      scopes: parseGrantedScopes(pending.provider, exchanged.scope, requestedScopes),
      connectedAccount,
    };
    state.authorizations[connector.id] = authorization;
    state.oauthCredentials[connector.id] = buildStoredOAuthCredential({
      provider: pending.provider,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      tokenType: exchanged.tokenType,
      scope: exchanged.scope,
      expiresAt:
        typeof exchanged.expiresIn === "number"
          ? new Date(Date.now() + exchanged.expiresIn * 1000).toISOString()
          : undefined,
      createdAt: connectedAt,
      env,
    });
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
    assertAlisioAccountSetupAccess(state, "connector", env ?? process.env);
    const gate = gateAlisioConnectorConnection({
      plan: resolveStoredAlisioPlan(state),
      connectedCount: countAlisioLimitedConnectorSlots(Object.values(state.authorizations)),
      connectorAlreadyConnected:
        state.authorizations[connector.id]?.state === "connected" ||
        state.authorizations[connector.id]?.state === "needs_reconnect",
    });
    if (!gate.ok) {
      throw new AlisioAccountValidationError(gate.message);
    }
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
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioConnectorAuthorization | null> {
  return withLock(async () => {
    const connector = CONNECTOR_CATALOG.find((entry) => entry.id === connectorId.trim());
    if (!connector) {
      return null;
    }
    const state = await loadStoredState(env);
    assertAlisioAccountSetupAccess(state, "connector", env ?? process.env);
    const credential = state.oauthCredentials[connector.id];
    if (credential?.provider === "google") {
      const tokenForRevoke =
        readStoredRefreshToken(credential, env) ?? readStoredAccessToken(credential, env);
      if (tokenForRevoke) {
        await revokeGoogleOAuthCredential({
          token: tokenForRevoke,
          fetchImpl,
        });
      }
    }
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
