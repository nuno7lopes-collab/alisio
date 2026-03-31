import { randomUUID } from "node:crypto";
import type { AuthProfileStore, OAuthCredential } from "../../../src/agents/auth-profiles/types.js";
import {
  OPENAI_CODEX_PROVIDER,
  type AiProfile,
  type AiProfileAttachmentState,
  type AiProfileHealthStatus,
  type DesktopWorkerInstallation,
  type MockSession,
  type PersistedDesktopState,
  type RuntimeBinding,
  type WorkerAiCredential,
  type WorkerAiCredentialRuntimeState,
} from "./types.js";

const USABLE_CREDENTIAL_STATES = new Set<WorkerAiCredentialRuntimeState>([
  "active",
  "standby",
  "authenticated",
]);

function maxOptional(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => typeof value === "number");
  if (filtered.length === 0) {
    return undefined;
  }
  return Math.max(...filtered);
}

function isUsableCredentialState(state: WorkerAiCredentialRuntimeState): boolean {
  return USABLE_CREDENTIAL_STATES.has(state);
}

export function createDesktopWorkerInstallation(
  now: number = Date.now(),
): DesktopWorkerInstallation {
  return {
    deviceId: randomUUID(),
    workerId: randomUUID(),
    createdAt: now,
  };
}

export function canonicalizeOpenAICodexIdentity(params: {
  accountId?: string;
  email?: string;
  authProfileId?: string;
}): string {
  const accountId = params.accountId?.trim();
  const email = params.email?.trim().toLowerCase();
  if (accountId && email) {
    return `${accountId}#${email}`;
  }
  if (accountId) {
    return accountId;
  }
  if (email) {
    return email;
  }
  return params.authProfileId?.trim() || "default";
}

function buildAiProfileLabel(params: {
  email?: string;
  accountId?: string;
  fallback?: string;
}): string {
  return (
    params.email?.trim() || params.accountId?.trim() || params.fallback?.trim() || "Conta OpenAI"
  );
}

function resolveOwnerScope(
  session: MockSession | null,
): { scope: "personal"; ownerUserId: string } | null {
  if (!session) {
    return null;
  }
  return {
    scope: "personal",
    ownerUserId: session.userId,
  };
}

function resolveCredentialRuntimeState(params: {
  credential: WorkerAiCredential;
  runtimeBinding: RuntimeBinding | null;
  store: AuthProfileStore;
  now: number;
}): { runtimeState: WorkerAiCredentialRuntimeState; lastError?: string } {
  const stored = params.store.profiles[params.credential.authProfileId];
  if (!stored || stored.provider !== OPENAI_CODEX_PROVIDER || stored.type !== "oauth") {
    return {
      runtimeState: "error",
      lastError: "A credencial já não existe no runtime local.",
    };
  }

  const usageStats = params.store.usageStats?.[params.credential.authProfileId];
  const cooldownUntil = Math.max(usageStats?.cooldownUntil ?? 0, usageStats?.disabledUntil ?? 0);
  if (cooldownUntil > params.now) {
    return {
      runtimeState: "cooldown",
      lastError: params.credential.lastError,
    };
  }

  if (typeof stored.expires === "number" && stored.expires <= params.now) {
    return {
      runtimeState: "expired",
      lastError: params.credential.lastError,
    };
  }

  if (params.runtimeBinding?.workerAiCredentialId === params.credential.id) {
    return {
      runtimeState: "active",
      lastError: undefined,
    };
  }

  return {
    runtimeState: "standby",
    lastError: undefined,
  };
}

function resolveAiProfileHealth(params: {
  credentials: WorkerAiCredential[];
  runtimeBinding: RuntimeBinding | null;
}): {
  healthStatus: AiProfileHealthStatus;
  attachmentState: AiProfileAttachmentState;
} {
  if (params.credentials.length === 0) {
    return {
      healthStatus: "unavailable",
      attachmentState: "detached",
    };
  }

  const usable = params.credentials.filter((credential) =>
    isUsableCredentialState(credential.runtimeState),
  ).length;
  const expired = params.credentials.filter(
    (credential) => credential.runtimeState === "expired",
  ).length;
  const boundCredential = params.runtimeBinding
    ? params.credentials.find(
        (credential) => credential.id === params.runtimeBinding?.workerAiCredentialId,
      )
    : undefined;

  if (usable === params.credentials.length) {
    return {
      healthStatus: "healthy",
      attachmentState: "attached",
    };
  }

  if (usable === 0 && expired === params.credentials.length) {
    return {
      healthStatus: "expired",
      attachmentState: "attached",
    };
  }

  if (usable === 0) {
    return {
      healthStatus: "unavailable",
      attachmentState: "attached",
    };
  }

  if (params.credentials.length > 1) {
    return {
      healthStatus: "partially_available",
      attachmentState: "attached",
    };
  }

  if (boundCredential && !isUsableCredentialState(boundCredential.runtimeState)) {
    return {
      healthStatus: "degraded",
      attachmentState: "attached",
    };
  }

  return {
    healthStatus: "degraded",
    attachmentState: "attached",
  };
}

export function resolveBoundWorkerAiCredential(
  state: Pick<PersistedDesktopState, "runtimeBinding" | "workerAiCredentials">,
): WorkerAiCredential | null {
  if (!state.runtimeBinding) {
    return null;
  }
  return (
    state.workerAiCredentials.find(
      (credential) => credential.id === state.runtimeBinding?.workerAiCredentialId,
    ) ?? null
  );
}

export function rebuildAiAccountState(
  state: PersistedDesktopState,
  store: AuthProfileStore,
  now: number = Date.now(),
): PersistedDesktopState {
  const existingCredentialIds = new Set(
    Object.entries(store.profiles)
      .filter(
        ([, credential]) =>
          credential.provider === OPENAI_CODEX_PROVIDER && credential.type === "oauth",
      )
      .map(([profileId]) => profileId),
  );

  const nextWorkerAiCredentials = state.workerAiCredentials
    .filter((credential) => existingCredentialIds.has(credential.authProfileId))
    .map((credential) => {
      const stored = store.profiles[credential.authProfileId] as OAuthCredential | undefined;
      const resolved = resolveCredentialRuntimeState({
        credential,
        runtimeBinding: state.runtimeBinding,
        store,
        now,
      });
      return {
        ...credential,
        expiresAt: stored?.expires,
        email: stored?.email ?? credential.email,
        accountId: stored?.accountId ?? credential.accountId,
        runtimeState: resolved.runtimeState,
        lastError: resolved.lastError,
      };
    });

  const survivingCredentialIds = new Set(
    nextWorkerAiCredentials.map((credential) => credential.id),
  );
  const nextBinding =
    state.runtimeBinding && survivingCredentialIds.has(state.runtimeBinding.workerAiCredentialId)
      ? state.runtimeBinding
      : null;

  const nextAiProfiles = state.aiProfiles.map((profile) => {
    const credentials = nextWorkerAiCredentials.filter(
      (credential) => credential.aiProfileId === profile.id,
    );
    const health = resolveAiProfileHealth({
      credentials,
      runtimeBinding: nextBinding,
    });
    return {
      ...profile,
      label: credentials.find((credential) => credential.email)?.email || profile.label,
      healthStatus: health.healthStatus,
      attachmentState: health.attachmentState,
      aggregatedTelemetry: {
        attachedCredentials: credentials.length,
        usableCredentials: credentials.filter((credential) =>
          isUsableCredentialState(credential.runtimeState),
        ).length,
        lastUsedAt: maxOptional(credentials.map((credential) => credential.lastUsedAt)),
        lastError: credentials.map((credential) => credential.lastError).find(Boolean),
      },
    };
  });

  return {
    ...state,
    aiProfiles: nextAiProfiles,
    workerAiCredentials: nextWorkerAiCredentials,
    runtimeBinding: nextBinding,
  };
}

export function connectOpenAICodexCredential(params: {
  state: PersistedDesktopState;
  authProfileId: string;
  email?: string;
  accountId?: string;
  now?: number;
  reason?: string;
}): PersistedDesktopState {
  const now = params.now ?? Date.now();
  const owner = resolveOwnerScope(params.state.session);
  if (!owner) {
    return params.state;
  }

  const canonicalIdentity = canonicalizeOpenAICodexIdentity({
    accountId: params.accountId,
    email: params.email,
    authProfileId: params.authProfileId,
  });

  const existingProfile = params.state.aiProfiles.find(
    (profile) =>
      profile.provider === OPENAI_CODEX_PROVIDER &&
      profile.scope === owner.scope &&
      profile.ownerUserId === owner.ownerUserId &&
      profile.canonicalIdentity === canonicalIdentity,
  );

  const aiProfile: AiProfile = existingProfile ?? {
    id: randomUUID(),
    scope: owner.scope,
    ownerUserId: owner.ownerUserId,
    provider: OPENAI_CODEX_PROVIDER,
    canonicalIdentity,
    label: buildAiProfileLabel({
      email: params.email,
      accountId: params.accountId,
    }),
    healthStatus: "healthy",
    attachmentState: "attached",
    routingPolicy: { mode: "auto" },
    grants: { userIds: [owner.ownerUserId] },
    aggregatedTelemetry: {
      attachedCredentials: 0,
      usableCredentials: 0,
    },
  };

  const existingCredential = params.state.workerAiCredentials.find(
    (credential) =>
      credential.workerId === params.state.installation.workerId &&
      credential.aiProfileId === aiProfile.id,
  );

  const workerAiCredential: WorkerAiCredential = existingCredential
    ? {
        ...existingCredential,
        authProfileId: params.authProfileId,
        email: params.email ?? existingCredential.email,
        accountId: params.accountId ?? existingCredential.accountId,
        lastAuthAt: now,
        runtimeState: existingCredential.runtimeState === "active" ? "active" : "authenticated",
        lastError: undefined,
      }
    : {
        id: randomUUID(),
        deviceId: params.state.installation.deviceId,
        workerId: params.state.installation.workerId,
        aiProfileId: aiProfile.id,
        authProfileId: params.authProfileId,
        provider: OPENAI_CODEX_PROVIDER,
        runtimeState: "authenticated",
        lastAuthAt: now,
        localTelemetry: {},
        email: params.email,
        accountId: params.accountId,
      };

  const nextState: PersistedDesktopState = {
    ...params.state,
    aiProfiles: existingProfile
      ? params.state.aiProfiles.map((profile) =>
          profile.id === aiProfile.id
            ? {
                ...profile,
                label: buildAiProfileLabel({
                  email: params.email,
                  accountId: params.accountId,
                  fallback: profile.label,
                }),
                attachmentState: "attached",
              }
            : profile,
        )
      : [...params.state.aiProfiles, aiProfile],
    workerAiCredentials: existingCredential
      ? params.state.workerAiCredentials.map((credential) =>
          credential.id === workerAiCredential.id ? workerAiCredential : credential,
        )
      : [...params.state.workerAiCredentials, workerAiCredential],
    runtimeBinding: {
      workerId: params.state.installation.workerId,
      workerAiCredentialId: workerAiCredential.id,
      boundAt: now,
      reason: params.reason ?? "oauth_connected",
    },
  };

  return nextState;
}

export function bindWorkerAiCredential(params: {
  state: PersistedDesktopState;
  workerAiCredentialId: string;
  now?: number;
  reason?: string;
}): PersistedDesktopState {
  const credential = params.state.workerAiCredentials.find(
    (item) => item.id === params.workerAiCredentialId,
  );
  if (!credential) {
    throw new Error("A credencial local pedida já não existe.");
  }
  return {
    ...params.state,
    runtimeBinding: {
      workerId: credential.workerId,
      workerAiCredentialId: credential.id,
      boundAt: params.now ?? Date.now(),
      reason: params.reason ?? "manual_activate",
    },
  };
}
