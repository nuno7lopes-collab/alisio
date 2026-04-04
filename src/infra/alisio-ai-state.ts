import { createHash } from "node:crypto";
import type { AuthProfileStore } from "../agents/auth-profiles/types.js";
import { isProfileInCooldown } from "../agents/auth-profiles/usage.js";

export const ALISIO_OPENAI_PROVIDER = "openai";
export const ALISIO_OPENAI_AUTH_PROVIDER = "openai-codex";
export const ALISIO_AI_TELEMETRY_TTL_MS = 10 * 60 * 1000;

export type AlisioAiStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "limits_unavailable"
  | "expired";

export type AlisioAiIdentitySource =
  | "account_user_id"
  | "user_id"
  | "account_id_email"
  | "email"
  | "account_id"
  | "default";

export type AlisioAiOwnerScope = "user" | "organization";

export type AlisioAiCanonicalIdentity = {
  accountUserId?: string;
  userId?: string;
  accountId?: string;
  email?: string;
  canonicalIdentityKey: string;
  source: AlisioAiIdentitySource;
};

export type AlisioAiTelemetryWindow = {
  label: string;
  durationMinutes: number;
  usedPercent: number;
  remainingPercent: number;
  resetAt?: number;
};

export type AlisioAiLocalTelemetry = {
  source: "official" | "heuristic";
  planType?: string;
  primaryWindow?: AlisioAiTelemetryWindow;
  secondaryWindow?: AlisioAiTelemetryWindow;
  credits?: number;
  observedAt: string;
  staleAt: string;
  lastError?: string;
};

export type AlisioAiUsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

export type AlisioAiLimits = {
  windows: AlisioAiUsageWindow[];
  lastRefreshedAt: string;
};

export type AlisioAiRuntimeBindingState = {
  workerId: string;
  workerCredentialId: string;
  authProfileId: string;
  boundAt: string;
};

export type AlisioAiWorkerCredentialState = {
  workerCredentialId: string;
  workerId: string;
  authProfileId: string;
  runtimeState: AlisioAiStatus;
  email?: string;
  accountId?: string;
  accountUserId?: string;
  userId?: string;
  connectedAt?: string;
  localTelemetry?: AlisioAiLocalTelemetry;
  runtimeBound?: boolean;
};

export type AlisioAiProfileState = {
  profileId: string;
  label: string;
  provider: "openai";
  scope: AlisioAiOwnerScope;
  ownerKey: string;
  canonicalIdentityKey: string;
  identity: AlisioAiCanonicalIdentity;
  status: AlisioAiStatus;
  email?: string;
  accountId?: string;
  accountUserId?: string;
  userId?: string;
  connectedAt?: string;
  planLabel?: string;
  limits?: AlisioAiLimits;
  aggregatedTelemetry?: AlisioAiLocalTelemetry;
  workerCredentials?: AlisioAiWorkerCredentialState[];
};

export type AlisioAiState = {
  provider: "openai";
  status: AlisioAiStatus;
  activeProfileId?: string;
  activeWorkerCredentialId?: string;
  activeAuthProfileId?: string;
  binding?: AlisioAiRuntimeBindingState;
  runtimeBindings?: AlisioAiRuntimeBindingState[];
  email?: string;
  accountId?: string;
  accountUserId?: string;
  userId?: string;
  planLabel?: string;
  connectedAt?: string;
  limits?: AlisioAiLimits;
  profiles?: AlisioAiProfileState[];
};

export type AlisioStoredAiProfile = {
  provider: "openai";
  scope: AlisioAiOwnerScope;
  ownerKey: string;
  canonicalIdentityKey: string;
  identity: AlisioAiCanonicalIdentity;
  label?: string;
  createdAt: string;
  aggregatedTelemetry?: AlisioAiLocalTelemetry;
};

export type AlisioStoredWorkerAiCredential = {
  provider: "openai";
  aiProfileId: string;
  workerId: string;
  authProfileId: string;
  runtimeState: AlisioAiStatus;
  accessToken?: string;
  accessTokenEncrypted?: {
    iv: string;
    tag: string;
    ciphertext: string;
  };
  refreshToken?: string;
  refreshTokenEncrypted?: {
    iv: string;
    tag: string;
    ciphertext: string;
  };
  expiresAt?: string;
  email?: string;
  accountId?: string;
  accountUserId?: string;
  userId?: string;
  connectedAt?: string;
  createdAt: string;
  localTelemetry?: AlisioAiLocalTelemetry;
};

export type AlisioStoredRuntimeBinding = {
  workerId: string;
  workerCredentialId: string;
  authProfileId: string;
  boundAt: string;
};

export type AlisioLegacyAiUsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

export type AlisioLegacyAiLimits = {
  windows: AlisioLegacyAiUsageWindow[];
  lastRefreshedAt: string;
};

export type AlisioLegacyStoredAiSession = {
  provider: "openai";
  status: AlisioAiStatus;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  email?: string;
  accountId?: string;
  accountUserId?: string;
  userId?: string;
  planLabel?: string;
  connectedAt?: string;
  limits?: AlisioLegacyAiLimits;
  label?: string;
};

export type AlisioStoredAiState = {
  aiProfiles?: Record<string, AlisioStoredAiProfile>;
  workerCredentials?: Record<string, AlisioStoredWorkerAiCredential>;
  runtimeBindings?: Record<string, AlisioStoredRuntimeBinding>;
  pending?: {
    provider: "openai";
    stateToken: string;
    codeVerifier: string;
    redirectUri: string;
    createdAt: string;
    callbackUrl?: string;
  };
  activeProfileId?: string;
  profiles?: Record<string, AlisioLegacyStoredAiSession>;
  session?: AlisioLegacyStoredAiSession;
};

export type AlisioAiOwnerContext = {
  scope: AlisioAiOwnerScope;
  ownerKey: string;
};

export type AlisioAiCredentialSelection = {
  workerCredentialId: string;
  authProfileId: string;
  manualPreference: boolean;
  inCooldown: boolean;
  primaryRemainingPercent: number;
  secondaryRemainingPercent: number;
  tokenReady: boolean;
  recentFailures: number;
  recentSuccess: boolean;
  runtimeState: AlisioAiStatus;
};

type SortableCredential = {
  workerCredentialId: string;
  record: AlisioStoredWorkerAiCredential;
  score: AlisioAiCredentialSelection;
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeOptionalEmail(value: string | null | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : undefined;
}

const UUID_LIKE_LABEL_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stableHash(input: string, length = 20): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function fallbackIdentityLabel(identity: AlisioAiCanonicalIdentity): string {
  return (
    identity.email ?? identity.accountId ?? identity.userId ?? identity.accountUserId ?? "default"
  );
}

function statusPriority(status: AlisioAiStatus): number {
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

function formatTelemetryWindowLabel(durationMinutes: number): string {
  if (durationMinutes === 300) {
    return "5h";
  }
  if (durationMinutes === 10080) {
    return "Week";
  }
  if (durationMinutes % (24 * 60) === 0 && durationMinutes >= 24 * 60) {
    const days = durationMinutes / (24 * 60);
    return days === 7 ? "Week" : `${days}d`;
  }
  if (durationMinutes % 60 === 0) {
    return `${durationMinutes / 60}h`;
  }
  return `${durationMinutes} min`;
}

export function buildAlisioAiTelemetryWindow(params: {
  durationMinutes: number;
  usedPercent: number;
  resetAt?: number;
}): AlisioAiTelemetryWindow {
  const usedPercent = Math.max(0, Math.min(100, params.usedPercent));
  return {
    label: formatTelemetryWindowLabel(params.durationMinutes),
    durationMinutes: Math.max(1, Math.round(params.durationMinutes)),
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    ...(typeof params.resetAt === "number" ? { resetAt: params.resetAt } : {}),
  };
}

export function buildAlisioAiLocalTelemetry(params: {
  source: "official" | "heuristic";
  observedAt?: string;
  staleAt?: string;
  planType?: string;
  primaryWindow?: AlisioAiTelemetryWindow;
  secondaryWindow?: AlisioAiTelemetryWindow;
  credits?: number;
  lastError?: string;
}): AlisioAiLocalTelemetry {
  const observedAt = normalizeOptionalString(params.observedAt) ?? new Date().toISOString();
  const staleAt =
    normalizeOptionalString(params.staleAt) ??
    new Date(Date.parse(observedAt) + ALISIO_AI_TELEMETRY_TTL_MS).toISOString();
  return {
    source: params.source,
    ...(normalizeOptionalString(params.planType)
      ? { planType: normalizeOptionalString(params.planType) }
      : {}),
    ...(params.primaryWindow ? { primaryWindow: params.primaryWindow } : {}),
    ...(params.secondaryWindow ? { secondaryWindow: params.secondaryWindow } : {}),
    ...(typeof params.credits === "number" && Number.isFinite(params.credits)
      ? { credits: params.credits }
      : {}),
    observedAt,
    staleAt,
    ...(normalizeOptionalString(params.lastError)
      ? { lastError: normalizeOptionalString(params.lastError) }
      : {}),
  };
}

export function isAlisioTelemetryFresh(
  telemetry: AlisioAiLocalTelemetry | null | undefined,
  now = Date.now(),
): boolean {
  if (!telemetry?.staleAt) {
    return false;
  }
  const staleAtMs = Date.parse(telemetry.staleAt);
  return Number.isFinite(staleAtMs) && staleAtMs > now;
}

export function toAlisioAiLimits(
  telemetry: AlisioAiLocalTelemetry | null | undefined,
): AlisioAiLimits | undefined {
  if (!telemetry) {
    return undefined;
  }
  const windows = [telemetry.primaryWindow, telemetry.secondaryWindow]
    .filter((entry): entry is AlisioAiTelemetryWindow => Boolean(entry))
    .map((entry) => ({
      label: entry.label,
      usedPercent: entry.usedPercent,
      ...(typeof entry.resetAt === "number" ? { resetAt: entry.resetAt } : {}),
    }));
  if (windows.length === 0) {
    return undefined;
  }
  return {
    windows,
    lastRefreshedAt: telemetry.observedAt,
  };
}

export function formatAlisioPlanLabel(
  telemetry: AlisioAiLocalTelemetry | null | undefined,
  fallback?: string,
): string | undefined {
  const planType = normalizeOptionalString(telemetry?.planType);
  const credits =
    typeof telemetry?.credits === "number" && Number.isFinite(telemetry.credits)
      ? telemetry.credits
      : undefined;
  if (planType && credits !== undefined) {
    return `${planType} ($${credits.toFixed(2)})`;
  }
  if (planType) {
    return planType;
  }
  if (credits !== undefined) {
    return `$${credits.toFixed(2)}`;
  }
  return normalizeOptionalString(fallback);
}

export function resolveAlisioAiCanonicalIdentity(input: {
  accountUserId?: string;
  userId?: string;
  accountId?: string;
  email?: string;
}): AlisioAiCanonicalIdentity {
  const accountUserId = normalizeOptionalString(input.accountUserId);
  const userId = normalizeOptionalString(input.userId);
  const accountId = normalizeOptionalString(input.accountId);
  const email = normalizeOptionalEmail(input.email);
  if (accountUserId) {
    return {
      ...(accountUserId ? { accountUserId } : {}),
      ...(userId ? { userId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(email ? { email } : {}),
      canonicalIdentityKey: `account_user_id:${accountUserId}`,
      source: "account_user_id",
    };
  }
  if (userId) {
    return {
      ...(userId ? { userId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(email ? { email } : {}),
      canonicalIdentityKey: `user_id:${userId}`,
      source: "user_id",
    };
  }
  if (accountId && email) {
    return {
      accountId,
      email,
      canonicalIdentityKey: `account_id_email:${accountId}|${email}`,
      source: "account_id_email",
    };
  }
  if (email) {
    return {
      ...(accountId ? { accountId } : {}),
      email,
      canonicalIdentityKey: `email:${email}`,
      source: "email",
    };
  }
  if (accountId) {
    return {
      accountId,
      canonicalIdentityKey: `account_id:${accountId}`,
      source: "account_id",
    };
  }
  return {
    canonicalIdentityKey: "default",
    source: "default",
  };
}

export function buildAlisioAiProfileId(params: {
  ownerKey: string;
  canonicalIdentityKey: string;
}): string {
  return `alisio-openai:${stableHash(`${params.ownerKey}|${params.canonicalIdentityKey}`)}`;
}

export function buildAlisioWorkerCredentialId(params: {
  workerId: string;
  aiProfileId: string;
}): string {
  return `alisio-openai-worker:${stableHash(`${params.workerId}|${params.aiProfileId}`)}`;
}

export function buildAlisioWorkerAuthProfileId(workerCredentialId: string): string {
  return `${ALISIO_OPENAI_AUTH_PROVIDER}:alisio-${stableHash(workerCredentialId, 16)}`;
}

export function resolveAlisioAiProfileLabel(params: {
  profile: Pick<AlisioStoredAiProfile, "label" | "identity">;
  credential?: Pick<
    AlisioStoredWorkerAiCredential,
    "email" | "accountId" | "accountUserId" | "userId"
  >;
}): string {
  const label = normalizeOptionalString(params.profile.label);
  const email =
    normalizeOptionalEmail(params.credential?.email) ??
    normalizeOptionalEmail(params.profile.identity.email);
  const technicalCandidates = new Set(
    [
      normalizeOptionalString(params.credential?.accountId),
      normalizeOptionalString(params.credential?.accountUserId),
      normalizeOptionalString(params.credential?.userId),
      normalizeOptionalString(params.profile.identity.accountId),
      normalizeOptionalString(params.profile.identity.accountUserId),
      normalizeOptionalString(params.profile.identity.userId),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase()),
  );
  const normalizedLabel = label?.toLowerCase();
  const looksTechnical = Boolean(
    normalizedLabel &&
    (technicalCandidates.has(normalizedLabel) ||
      normalizedLabel.startsWith("alisio-openai:") ||
      normalizedLabel === "default" ||
      UUID_LIKE_LABEL_PATTERN.test(normalizedLabel)),
  );
  if (label && !(email && looksTechnical)) {
    return label;
  }
  return email ?? fallbackIdentityLabel(params.profile.identity);
}

export function resolveAggregatedTelemetry(
  credentials: readonly AlisioStoredWorkerAiCredential[],
): AlisioAiLocalTelemetry | undefined {
  const candidates = credentials
    .map((credential) => credential.localTelemetry)
    .filter((entry): entry is AlisioAiLocalTelemetry => Boolean(entry))
    .toSorted((left, right) => {
      const leftObserved = Date.parse(left.observedAt);
      const rightObserved = Date.parse(right.observedAt);
      return (
        (Number.isFinite(rightObserved) ? rightObserved : 0) -
        (Number.isFinite(leftObserved) ? leftObserved : 0)
      );
    });
  const fresh = candidates.find((entry) => isAlisioTelemetryFresh(entry));
  return fresh ?? candidates[0];
}

export function resolveAggregatedAiStatus(
  credentials: readonly AlisioStoredWorkerAiCredential[],
): AlisioAiStatus {
  if (credentials.length === 0) {
    return "disconnected";
  }
  return (
    [...credentials].toSorted(
      (left, right) => statusPriority(right.runtimeState) - statusPriority(left.runtimeState),
    )[0]?.runtimeState ?? "disconnected"
  );
}

function resolveCredentialRecentFailures(
  authStore: AuthProfileStore | undefined,
  authProfileId: string,
): number {
  return authStore?.usageStats?.[authProfileId]?.errorCount ?? 0;
}

function resolveCredentialRecentSuccess(
  authStore: AuthProfileStore | undefined,
  authProfileId: string,
): boolean {
  return Object.values(authStore?.lastGood ?? {}).includes(authProfileId);
}

function isCredentialTokenReady(
  credential: Pick<AlisioStoredWorkerAiCredential, "expiresAt" | "accessToken">,
): boolean {
  if (!normalizeOptionalString(credential.accessToken)) {
    return false;
  }
  if (!credential.expiresAt) {
    return true;
  }
  const expiresAtMs = Date.parse(credential.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return expiresAtMs > Date.now() + 60_000;
}

function scoreWorkerCredential(params: {
  credential: AlisioStoredWorkerAiCredential;
  binding?: AlisioStoredRuntimeBinding;
  authStore?: AuthProfileStore;
}): AlisioAiCredentialSelection {
  const inCooldown = params.authStore
    ? isProfileInCooldown(params.authStore, params.credential.authProfileId)
    : false;
  return {
    workerCredentialId: buildAlisioWorkerCredentialId({
      workerId: params.credential.workerId,
      aiProfileId: params.credential.aiProfileId,
    }),
    authProfileId: params.credential.authProfileId,
    manualPreference:
      params.binding?.workerCredentialId ===
      buildAlisioWorkerCredentialId({
        workerId: params.credential.workerId,
        aiProfileId: params.credential.aiProfileId,
      }),
    inCooldown,
    primaryRemainingPercent:
      params.credential.localTelemetry?.primaryWindow?.remainingPercent ?? -1,
    secondaryRemainingPercent:
      params.credential.localTelemetry?.secondaryWindow?.remainingPercent ?? -1,
    tokenReady: isCredentialTokenReady(params.credential),
    recentFailures: resolveCredentialRecentFailures(
      params.authStore,
      params.credential.authProfileId,
    ),
    recentSuccess: resolveCredentialRecentSuccess(
      params.authStore,
      params.credential.authProfileId,
    ),
    runtimeState: params.credential.runtimeState,
  };
}

export function selectBestWorkerCredentialForProfile(params: {
  aiProfileId: string;
  workerId: string;
  state: AlisioStoredAiState | null | undefined;
  authStore?: AuthProfileStore;
}): SortableCredential | null {
  const binding = params.state?.runtimeBindings?.[params.workerId];
  const candidates = Object.entries(params.state?.workerCredentials ?? {})
    .filter(
      ([, credential]) =>
        credential.aiProfileId === params.aiProfileId && credential.workerId === params.workerId,
    )
    .map(([workerCredentialId, record]) => ({
      workerCredentialId,
      record,
      score: scoreWorkerCredential({
        credential: record,
        binding,
        authStore: params.authStore,
      }),
    }))
    .toSorted((left, right) => {
      if (left.score.manualPreference !== right.score.manualPreference) {
        return left.score.manualPreference ? -1 : 1;
      }
      if (left.score.tokenReady !== right.score.tokenReady) {
        return left.score.tokenReady ? -1 : 1;
      }
      if (left.score.inCooldown !== right.score.inCooldown) {
        return left.score.inCooldown ? 1 : -1;
      }
      if (left.score.primaryRemainingPercent !== right.score.primaryRemainingPercent) {
        return right.score.primaryRemainingPercent - left.score.primaryRemainingPercent;
      }
      if (left.score.secondaryRemainingPercent !== right.score.secondaryRemainingPercent) {
        return right.score.secondaryRemainingPercent - left.score.secondaryRemainingPercent;
      }
      if (left.score.recentFailures !== right.score.recentFailures) {
        return left.score.recentFailures - right.score.recentFailures;
      }
      if (left.score.recentSuccess !== right.score.recentSuccess) {
        return left.score.recentSuccess ? -1 : 1;
      }
      return statusPriority(right.score.runtimeState) - statusPriority(left.score.runtimeState);
    });
  return candidates[0] ?? null;
}

export function toAlisioAiState(params: {
  state: AlisioStoredAiState | null | undefined;
  workerId: string;
  authStore?: AuthProfileStore;
}): AlisioAiState {
  const aiProfiles = params.state?.aiProfiles ?? {};
  const workerCredentials = params.state?.workerCredentials ?? {};
  const runtimeBindings = params.state?.runtimeBindings ?? {};
  const currentBinding = runtimeBindings[params.workerId];
  const profiles = Object.entries(aiProfiles)
    .map(([profileId, profile]) => {
      const relatedCredentials = Object.entries(workerCredentials)
        .filter(([, credential]) => credential.aiProfileId === profileId)
        .map(([workerCredentialId, credential]) => ({
          workerCredentialId,
          credential,
        }));
      const aggregatedTelemetry = resolveAggregatedTelemetry(
        relatedCredentials.map((entry) => entry.credential),
      );
      const currentWorkerCredentials = relatedCredentials
        .filter((entry) => entry.credential.workerId === params.workerId)
        .map((entry) => ({
          workerCredentialId: entry.workerCredentialId,
          workerId: entry.credential.workerId,
          authProfileId: entry.credential.authProfileId,
          runtimeState: entry.credential.runtimeState,
          ...(normalizeOptionalEmail(entry.credential.email)
            ? { email: normalizeOptionalEmail(entry.credential.email) }
            : {}),
          ...(normalizeOptionalString(entry.credential.accountId)
            ? { accountId: normalizeOptionalString(entry.credential.accountId) }
            : {}),
          ...(normalizeOptionalString(entry.credential.accountUserId)
            ? { accountUserId: normalizeOptionalString(entry.credential.accountUserId) }
            : {}),
          ...(normalizeOptionalString(entry.credential.userId)
            ? { userId: normalizeOptionalString(entry.credential.userId) }
            : {}),
          ...(normalizeOptionalString(entry.credential.connectedAt)
            ? { connectedAt: normalizeOptionalString(entry.credential.connectedAt) }
            : {}),
          ...(entry.credential.localTelemetry
            ? { localTelemetry: entry.credential.localTelemetry }
            : {}),
          runtimeBound: currentBinding?.workerCredentialId === entry.workerCredentialId,
        }));
      const currentWorkerBest = selectBestWorkerCredentialForProfile({
        aiProfileId: profileId,
        workerId: params.workerId,
        state: params.state,
        authStore: params.authStore,
      });
      const representative = currentWorkerBest?.record ?? relatedCredentials[0]?.credential;
      return {
        profileId,
        label: resolveAlisioAiProfileLabel({
          profile,
          credential: representative,
        }),
        provider: "openai" as const,
        scope: profile.scope,
        ownerKey: profile.ownerKey,
        canonicalIdentityKey: profile.canonicalIdentityKey,
        identity: profile.identity,
        status: resolveAggregatedAiStatus(relatedCredentials.map((entry) => entry.credential)),
        ...(normalizeOptionalEmail(representative?.email)
          ? { email: normalizeOptionalEmail(representative?.email) }
          : {}),
        ...(normalizeOptionalString(representative?.accountId)
          ? { accountId: normalizeOptionalString(representative?.accountId) }
          : {}),
        ...(normalizeOptionalString(representative?.accountUserId)
          ? { accountUserId: normalizeOptionalString(representative?.accountUserId) }
          : {}),
        ...(normalizeOptionalString(representative?.userId)
          ? { userId: normalizeOptionalString(representative?.userId) }
          : {}),
        ...(normalizeOptionalString(representative?.connectedAt)
          ? { connectedAt: normalizeOptionalString(representative?.connectedAt) }
          : {}),
        ...(formatAlisioPlanLabel(aggregatedTelemetry)
          ? { planLabel: formatAlisioPlanLabel(aggregatedTelemetry) }
          : {}),
        ...(toAlisioAiLimits(aggregatedTelemetry)
          ? { limits: toAlisioAiLimits(aggregatedTelemetry) }
          : {}),
        ...(aggregatedTelemetry ? { aggregatedTelemetry } : {}),
        ...(currentWorkerCredentials.length > 0
          ? { workerCredentials: currentWorkerCredentials }
          : {}),
      } satisfies AlisioAiProfileState;
    })
    .toSorted((left, right) => {
      const leftBound =
        currentBinding &&
        left.workerCredentials?.some(
          (entry) => entry.workerCredentialId === currentBinding.workerCredentialId,
        );
      const rightBound =
        currentBinding &&
        right.workerCredentials?.some(
          (entry) => entry.workerCredentialId === currentBinding.workerCredentialId,
        );
      if (leftBound !== rightBound) {
        return leftBound ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });

  const activeProfile = currentBinding
    ? (profiles.find((profile) =>
        profile.workerCredentials?.some(
          (credential) => credential.workerCredentialId === currentBinding.workerCredentialId,
        ),
      ) ?? null)
    : null;
  const activeCredential =
    activeProfile?.workerCredentials?.find(
      (credential) => credential.workerCredentialId === currentBinding?.workerCredentialId,
    ) ?? null;

  if (!activeProfile) {
    return {
      provider: "openai",
      status: "disconnected",
      ...(profiles.length > 0 ? { profiles } : {}),
      ...(Object.keys(runtimeBindings).length > 0
        ? {
            runtimeBindings: Object.values(runtimeBindings).map((binding) => ({
              workerId: binding.workerId,
              workerCredentialId: binding.workerCredentialId,
              authProfileId: binding.authProfileId,
              boundAt: binding.boundAt,
            })),
          }
        : {}),
    };
  }

  const activeTelemetry =
    activeCredential && "localTelemetry" in activeCredential
      ? activeCredential.localTelemetry
      : activeProfile.aggregatedTelemetry;
  return {
    provider: "openai",
    status: activeCredential?.runtimeState ?? activeProfile.status,
    activeProfileId: activeProfile.profileId,
    ...(currentBinding
      ? {
          activeWorkerCredentialId: currentBinding.workerCredentialId,
          activeAuthProfileId: currentBinding.authProfileId,
          binding: {
            workerId: currentBinding.workerId,
            workerCredentialId: currentBinding.workerCredentialId,
            authProfileId: currentBinding.authProfileId,
            boundAt: currentBinding.boundAt,
          },
        }
      : {}),
    ...(Object.keys(runtimeBindings).length > 0
      ? {
          runtimeBindings: Object.values(runtimeBindings).map((binding) => ({
            workerId: binding.workerId,
            workerCredentialId: binding.workerCredentialId,
            authProfileId: binding.authProfileId,
            boundAt: binding.boundAt,
          })),
        }
      : {}),
    ...(activeProfile.email ? { email: activeProfile.email } : {}),
    ...(activeProfile.accountId ? { accountId: activeProfile.accountId } : {}),
    ...(activeProfile.accountUserId ? { accountUserId: activeProfile.accountUserId } : {}),
    ...(activeProfile.userId ? { userId: activeProfile.userId } : {}),
    ...(formatAlisioPlanLabel(activeTelemetry, activeProfile.planLabel)
      ? { planLabel: formatAlisioPlanLabel(activeTelemetry, activeProfile.planLabel) }
      : {}),
    ...(activeProfile.connectedAt ? { connectedAt: activeProfile.connectedAt } : {}),
    ...(toAlisioAiLimits(activeTelemetry) ? { limits: toAlisioAiLimits(activeTelemetry) } : {}),
    profiles,
  };
}
