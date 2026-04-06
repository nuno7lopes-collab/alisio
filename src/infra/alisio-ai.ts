import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";
import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  saveAuthProfileStore,
  updateRuntimeAuthProfileStoreSnapshot,
} from "../agents/auth-profiles.js";
import { loadValidConfigOrThrow, updateConfig } from "../commands/models/shared.js";
import type { OpenClawConfig } from "../config/config.js";
import { isLoopbackHost } from "../gateway/net.js";
import { applyDefaultModel } from "../plugins/provider-auth-choice-helpers.js";
import { OPENAI_CODEX_DEFAULT_MODEL } from "../plugins/provider-model-defaults.js";
import {
  ALISIO_AI_TELEMETRY_TTL_MS,
  buildAlisioAiLocalTelemetry,
  buildAlisioAiTelemetryWindow,
  type AlisioAiLocalTelemetry,
  type AlisioAiStatus,
  type AlisioStoredWorkerAiCredential,
} from "./alisio-ai-state.js";
import { fetchCodexUsageTelemetry } from "./provider-usage.fetch.codex.js";

export type {
  AlisioAiCanonicalIdentity,
  AlisioAiLimits,
  AlisioAiProfileState,
  AlisioAiRuntimeBindingState,
  AlisioAiState,
  AlisioAiStatus,
  AlisioAiTelemetryWindow,
  AlisioAiUsageWindow,
  AlisioAiWorkerCredentialState,
  AlisioAiLocalTelemetry,
  AlisioStoredAiProfile,
  AlisioStoredAiState,
  AlisioStoredRuntimeBinding,
  AlisioStoredWorkerAiCredential,
  AlisioAiOwnerContext,
  AlisioLegacyStoredAiSession,
} from "./alisio-ai-state.js";

const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_SCOPE = "openid profile email offline_access";
const OPENAI_LOOPBACK_REDIRECT_PORT = 1455;
const OPENAI_AUTH_CLAIM_PATH = "https://api.openai.com/auth";
const OPENAI_PROFILE_CLAIM_PATH = "https://api.openai.com/profile";

export type AlisioPendingAiAuthorization = {
  provider: "openai";
  stateToken: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: string;
  callbackUrl?: string;
};

export class AlisioAiError extends Error {
  readonly code:
    | "invalid_callback"
    | "token_exchange_failed"
    | "refresh_failed"
    | "connect_failed"
    | "runtime_apply_failed";

  constructor(
    code:
      | "invalid_callback"
      | "token_exchange_failed"
      | "refresh_failed"
      | "connect_failed"
      | "runtime_apply_failed",
    message: string,
  ) {
    super(message);
    this.name = "AlisioAiError";
    this.code = code;
  }
}

type OpenAiRedirectProxy = {
  server: Server;
  callbackUrl: string;
  port: number;
};

type OpenAiIdentityFields = {
  accountId?: string;
  accountUserId?: string;
  userId?: string;
  email?: string;
  planType?: string;
};

let openAiRedirectProxy: OpenAiRedirectProxy | null = null;

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

function buildCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

function buildCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function buildStateToken() {
  return randomBytes(16).toString("hex");
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function mergeOpenAiIdentity(
  primary: OpenAiIdentityFields,
  secondary: OpenAiIdentityFields,
): OpenAiIdentityFields {
  return {
    ...((primary.accountId ?? secondary.accountId)
      ? { accountId: primary.accountId ?? secondary.accountId }
      : {}),
    ...((primary.accountUserId ?? secondary.accountUserId)
      ? { accountUserId: primary.accountUserId ?? secondary.accountUserId }
      : {}),
    ...((primary.userId ?? secondary.userId) ? { userId: primary.userId ?? secondary.userId } : {}),
    ...((primary.email ?? secondary.email) ? { email: primary.email ?? secondary.email } : {}),
    ...((primary.planType ?? secondary.planType)
      ? { planType: primary.planType ?? secondary.planType }
      : {}),
  };
}

export function resolveAlisioOpenAiTokenIdentity(token: string): OpenAiIdentityFields {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return {};
  }
  const auth =
    payload?.[OPENAI_AUTH_CLAIM_PATH] && typeof payload[OPENAI_AUTH_CLAIM_PATH] === "object"
      ? (payload[OPENAI_AUTH_CLAIM_PATH] as Record<string, unknown>)
      : undefined;
  const profile =
    payload?.[OPENAI_PROFILE_CLAIM_PATH] && typeof payload[OPENAI_PROFILE_CLAIM_PATH] === "object"
      ? (payload[OPENAI_PROFILE_CLAIM_PATH] as Record<string, unknown>)
      : undefined;
  const accountId = normalizeOptionalString(
    typeof auth?.chatgpt_account_id === "string"
      ? auth.chatgpt_account_id
      : typeof auth?.account_id === "string"
        ? auth.account_id
        : undefined,
  );
  const accountUserId = normalizeOptionalString(
    typeof auth?.chatgpt_account_user_id === "string"
      ? auth.chatgpt_account_user_id
      : typeof auth?.account_user_id === "string"
        ? auth.account_user_id
        : undefined,
  );
  const userId = normalizeOptionalString(
    typeof auth?.chatgpt_user_id === "string"
      ? auth.chatgpt_user_id
      : typeof auth?.user_id === "string"
        ? auth.user_id
        : typeof payload?.user_id === "string"
          ? payload.user_id
          : typeof payload?.uid === "string"
            ? payload.uid
            : typeof payload?.sub === "string" && !payload.sub.includes("@")
              ? payload.sub
              : undefined,
  );
  const emailCandidates = [
    profile?.email,
    payload?.email,
    payload?.preferred_username,
    payload?.sub,
  ];
  let email: string | undefined;
  for (const candidate of emailCandidates) {
    if (typeof candidate === "string" && candidate.includes("@")) {
      email = normalizeOptionalEmail(candidate);
      break;
    }
  }
  const planType = normalizeOptionalString(
    typeof auth?.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : undefined,
  );
  return {
    ...(accountId ? { accountId } : {}),
    ...(accountUserId ? { accountUserId } : {}),
    ...(userId ? { userId } : {}),
    ...(email ? { email } : {}),
    ...(planType ? { planType } : {}),
  };
}

function resolveOpenAiIdentity(accessToken: string, idToken?: string): OpenAiIdentityFields {
  const accessIdentity = resolveAlisioOpenAiTokenIdentity(accessToken);
  const idIdentity = idToken ? resolveAlisioOpenAiTokenIdentity(idToken) : {};
  return mergeOpenAiIdentity(accessIdentity, idIdentity);
}

function normalizeOpenAiLocalTelemetryPlanType(
  telemetry: AlisioAiLocalTelemetry | undefined,
  planType: string | undefined,
): AlisioAiLocalTelemetry | undefined {
  if (!telemetry) {
    return undefined;
  }
  if (!planType || telemetry.planType) {
    return telemetry;
  }
  return {
    ...telemetry,
    planType,
  };
}

function normalizeOpenAiTelemetry(params: {
  telemetry: Awaited<ReturnType<typeof fetchCodexUsageTelemetry>>;
  observedAt: string;
  error?: string;
}): AlisioAiLocalTelemetry {
  const observedAtMs = Date.parse(params.observedAt);
  return buildAlisioAiLocalTelemetry({
    source: "official",
    observedAt: params.observedAt,
    staleAt: new Date(observedAtMs + ALISIO_AI_TELEMETRY_TTL_MS).toISOString(),
    ...(params.telemetry.planType ? { planType: params.telemetry.planType } : {}),
    ...(params.telemetry.primaryWindow
      ? {
          primaryWindow: buildAlisioAiTelemetryWindow({
            durationMinutes: params.telemetry.primaryWindow.durationMinutes,
            usedPercent: params.telemetry.primaryWindow.usedPercent,
            resetAt: params.telemetry.primaryWindow.resetAt,
          }),
        }
      : {}),
    ...(params.telemetry.secondaryWindow
      ? {
          secondaryWindow: buildAlisioAiTelemetryWindow({
            durationMinutes: params.telemetry.secondaryWindow.durationMinutes,
            usedPercent: params.telemetry.secondaryWindow.usedPercent,
            resetAt: params.telemetry.secondaryWindow.resetAt,
          }),
        }
      : {}),
    ...(typeof params.telemetry.credits === "number" ? { credits: params.telemetry.credits } : {}),
    ...(params.error ? { lastError: params.error } : {}),
  });
}

function prioritizeLocalOpenAiAuthProfile(authProfileId: string): void {
  updateRuntimeAuthProfileStoreSnapshot({
    updater: (store) => {
      const provider = "openai-codex";
      const existingOrder = Array.isArray(store.order?.[provider]) ? store.order[provider] : [];
      const knownProfiles = listProfilesForProvider(store, provider);
      const nextOrder = [
        authProfileId,
        ...existingOrder.filter((entry) => entry !== authProfileId),
        ...knownProfiles.filter(
          (entry) => entry !== authProfileId && !existingOrder.includes(entry),
        ),
      ];
      store.order = {
        ...store.order,
        [provider]: nextOrder,
      };
      store.lastGood = {
        ...store.lastGood,
        [provider]: authProfileId,
      };
    },
  });
}

function removePersistedAlisioOpenAiAuthProfiles(authProfileIds: readonly string[]): void {
  if (authProfileIds.length === 0) {
    return;
  }
  const store = ensureAuthProfileStore();
  let changed = false;
  for (const authProfileId of authProfileIds) {
    if (store.profiles[authProfileId]) {
      delete store.profiles[authProfileId];
      changed = true;
    }
    if (store.lastGood?.["openai-codex"] === authProfileId) {
      delete store.lastGood["openai-codex"];
      changed = true;
    }
    if (store.order?.["openai-codex"]?.includes(authProfileId)) {
      store.order["openai-codex"] = store.order["openai-codex"].filter(
        (entry) => entry !== authProfileId,
      );
      if (store.order["openai-codex"].length === 0) {
        delete store.order["openai-codex"];
      }
      changed = true;
    }
    if (store.usageStats?.[authProfileId]) {
      delete store.usageStats[authProfileId];
      changed = true;
    }
  }
  if (changed) {
    saveAuthProfileStore(store);
  }
}

function resolvePrimaryModelRef(cfg: OpenClawConfig): string | undefined {
  const primary = cfg.agents?.defaults?.model;
  return primary && typeof primary === "object" && "primary" in primary
    ? primary.primary
    : typeof primary === "string"
      ? primary
      : undefined;
}

function resolveConfiguredOpenAiCodexModel(cfg: OpenClawConfig): string | undefined {
  const primaryModel = resolvePrimaryModelRef(cfg)?.trim();
  if (!primaryModel?.toLowerCase().startsWith("openai-codex/")) {
    return undefined;
  }
  return primaryModel;
}

function isOpenAiLocalCallbackTarget(callbackUrl: URL): boolean {
  return isLoopbackHost(callbackUrl.hostname);
}

async function stopOpenAiRedirectProxy(): Promise<void> {
  const proxy = openAiRedirectProxy;
  if (!proxy) {
    return;
  }
  openAiRedirectProxy = null;
  await new Promise<void>((resolve) => {
    proxy.server.close(() => resolve());
  }).catch(() => undefined);
}

function buildOpenAiLoopbackRedirectUri(port = OPENAI_LOOPBACK_REDIRECT_PORT) {
  return `http://localhost:${port}/auth/callback`;
}

async function ensureOpenAiRedirectProxy(callbackUrl: string, port: number): Promise<void> {
  const target = new URL(callbackUrl);
  const relayBaseUrl = buildOpenAiLoopbackRedirectUri(port);
  if (!/^https?:$/.test(target.protocol)) {
    throw new AlisioAiError("connect_failed", "The OpenAI callback must use http or https.");
  }

  if (openAiRedirectProxy) {
    if (
      openAiRedirectProxy.callbackUrl !== target.toString() ||
      openAiRedirectProxy.port !== port
    ) {
      await stopOpenAiRedirectProxy();
    } else {
      return;
    }
  }

  const createRelayServer = () =>
    createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", relayBaseUrl);
        if (requestUrl.pathname !== "/auth/callback") {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Not found");
          return;
        }

        const destination = new URL(target.toString());
        destination.search = requestUrl.search;
        destination.hash = requestUrl.hash;

        res.statusCode = 302;
        res.setHeader("Location", destination.toString());
        res.end();
        void stopOpenAiRedirectProxy();
      } catch {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("OpenAI callback relay failed");
        void stopOpenAiRedirectProxy();
      }
    });

  const listen = async (host: string): Promise<Server> => {
    const server = createRelayServer();
    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => {
        server.off("listening", handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off("error", handleError);
        resolve();
      };
      server.once("error", handleError);
      server.once("listening", handleListening);
      server.listen({ port, host });
    }).catch((error) => {
      server.close(() => undefined);
      throw error;
    });
    return server;
  };

  try {
    const server = await listen("::");
    openAiRedirectProxy = {
      server,
      callbackUrl: target.toString(),
      port,
    };
    return;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    if (code !== "EAFNOSUPPORT" && code !== "EADDRNOTAVAIL") {
      throw new AlisioAiError(
        "connect_failed",
        `Could not start the local OpenAI callback relay on localhost:${port}: ${String(error)}`,
      );
    }
  }

  try {
    const server = await listen("127.0.0.1");
    openAiRedirectProxy = {
      server,
      callbackUrl: target.toString(),
      port,
    };
  } catch (error) {
    throw new AlisioAiError(
      "connect_failed",
      `Could not start the local OpenAI callback relay on localhost:${port}: ${String(error)}`,
    );
  }
}

export async function buildAlisioOpenAiAuthorization(params: {
  callbackUrl: string;
  loopbackPort?: number;
}): Promise<{
  pending: AlisioPendingAiAuthorization;
  setupUrl: string;
}> {
  const callbackUrl = new URL(params.callbackUrl);
  const loopbackPort = params.loopbackPort ?? OPENAI_LOOPBACK_REDIRECT_PORT;
  if (!/^https?:$/.test(callbackUrl.protocol)) {
    throw new AlisioAiError("connect_failed", "The OpenAI callback must use http or https.");
  }

  const useLocalRelay = isOpenAiLocalCallbackTarget(callbackUrl);
  const redirectUri = useLocalRelay
    ? buildOpenAiLoopbackRedirectUri(loopbackPort)
    : callbackUrl.toString();
  if (useLocalRelay) {
    await ensureOpenAiRedirectProxy(callbackUrl.toString(), loopbackPort);
  }

  const codeVerifier = buildCodeVerifier();
  const stateToken = buildStateToken();
  const pending: AlisioPendingAiAuthorization = {
    provider: "openai",
    stateToken,
    codeVerifier,
    redirectUri,
    createdAt: new Date().toISOString(),
    ...(useLocalRelay ? { callbackUrl: callbackUrl.toString() } : {}),
  };
  const url = new URL(OPENAI_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_CLIENT_ID);
  url.searchParams.set("redirect_uri", pending.redirectUri);
  url.searchParams.set("scope", OPENAI_SCOPE);
  url.searchParams.set("code_challenge", buildCodeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", stateToken);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "pi");
  return { pending, setupUrl: url.toString() };
}

async function exchangeOpenAiCode(params: {
  pending: AlisioPendingAiAuthorization;
  code: string;
  fetchImpl: typeof fetch;
}) {
  const response = await params.fetchImpl(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CLIENT_ID,
      code: params.code,
      code_verifier: params.pending.codeVerifier,
      redirect_uri: params.pending.redirectUri,
    }),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !body || typeof body.access_token !== "string") {
    throw new AlisioAiError("token_exchange_failed", "OpenAI could not connect this account.");
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    idToken: typeof body.id_token === "string" ? body.id_token : undefined,
    expiresAt:
      typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000).toISOString()
        : undefined,
  };
}

async function fetchOpenAiTelemetry(
  accessToken: string,
  accountId: string | undefined,
  fetchImpl: typeof fetch,
): Promise<{ localTelemetry?: AlisioAiLocalTelemetry; status: AlisioAiStatus }> {
  const observedAt = new Date().toISOString();
  try {
    const telemetry = await fetchCodexUsageTelemetry(accessToken, accountId, 5_000, fetchImpl);
    return {
      localTelemetry: normalizeOpenAiTelemetry({
        telemetry,
        observedAt,
      }),
      status: "connected",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      localTelemetry: buildAlisioAiLocalTelemetry({
        source: "official",
        observedAt,
        staleAt: new Date(Date.parse(observedAt) + ALISIO_AI_TELEMETRY_TTL_MS).toISOString(),
        lastError: message,
      }),
      status: "limits_unavailable",
    };
  }
}

export async function completeAlisioOpenAiAuthorization(params: {
  pending: AlisioPendingAiAuthorization;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<
  Pick<
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
  >
> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const token = await exchangeOpenAiCode({
    pending: params.pending,
    code: params.code,
    fetchImpl,
  });
  const identity = resolveOpenAiIdentity(token.accessToken, token.idToken);
  const usage = await fetchOpenAiTelemetry(token.accessToken, identity.accountId, fetchImpl);
  return {
    provider: "openai",
    runtimeState: usage.status,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.accountId ? { accountId: identity.accountId } : {}),
    ...(identity.accountUserId ? { accountUserId: identity.accountUserId } : {}),
    ...(identity.userId ? { userId: identity.userId } : {}),
    connectedAt: new Date().toISOString(),
    ...(normalizeOpenAiLocalTelemetryPlanType(usage.localTelemetry, identity.planType)
      ? {
          localTelemetry: normalizeOpenAiLocalTelemetryPlanType(
            usage.localTelemetry,
            identity.planType,
          ),
        }
      : {}),
  };
}

export async function refreshAlisioOpenAiSession(params: {
  credential: AlisioStoredWorkerAiCredential;
  fetchImpl?: typeof fetch;
  forceTelemetry?: boolean;
}): Promise<AlisioStoredWorkerAiCredential> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const now = Date.now();
  let next = { ...params.credential };
  let tokenIdentity = next.accessToken ? resolveAlisioOpenAiTokenIdentity(next.accessToken) : {};
  next = {
    ...next,
    ...(tokenIdentity.accountId ? { accountId: tokenIdentity.accountId } : {}),
    ...(tokenIdentity.accountUserId ? { accountUserId: tokenIdentity.accountUserId } : {}),
    ...(tokenIdentity.userId ? { userId: tokenIdentity.userId } : {}),
    ...(tokenIdentity.email ? { email: tokenIdentity.email } : {}),
    ...(normalizeOpenAiLocalTelemetryPlanType(next.localTelemetry, tokenIdentity.planType)
      ? {
          localTelemetry: normalizeOpenAiLocalTelemetryPlanType(
            next.localTelemetry,
            tokenIdentity.planType,
          ),
        }
      : {}),
  };
  const expiresAtMs = next.expiresAt ? Date.parse(next.expiresAt) : Number.NaN;
  if (
    next.refreshToken &&
    (!Number.isFinite(expiresAtMs) ||
      expiresAtMs - now <= 60_000 ||
      next.runtimeState === "expired")
  ) {
    try {
      const refreshed = await refreshOpenAICodexToken(next.refreshToken);
      tokenIdentity = resolveOpenAiIdentity(refreshed.access);
      next = {
        ...next,
        runtimeState: "connected",
        accessToken: refreshed.access,
        refreshToken: refreshed.refresh,
        expiresAt: new Date(refreshed.expires).toISOString(),
        ...(tokenIdentity.accountId ? { accountId: tokenIdentity.accountId } : {}),
        ...(tokenIdentity.accountUserId ? { accountUserId: tokenIdentity.accountUserId } : {}),
        ...(tokenIdentity.userId ? { userId: tokenIdentity.userId } : {}),
        ...(tokenIdentity.email ? { email: tokenIdentity.email } : {}),
        ...(normalizeOpenAiLocalTelemetryPlanType(next.localTelemetry, tokenIdentity.planType)
          ? {
              localTelemetry: normalizeOpenAiLocalTelemetryPlanType(
                next.localTelemetry,
                tokenIdentity.planType,
              ),
            }
          : {}),
      };
    } catch {
      return {
        ...next,
        runtimeState: "expired",
      };
    }
  }

  const observedAtMs = next.localTelemetry?.observedAt
    ? Date.parse(next.localTelemetry.observedAt)
    : 0;
  if (params.forceTelemetry || !observedAtMs || now - observedAtMs >= ALISIO_AI_TELEMETRY_TTL_MS) {
    const usage = await fetchOpenAiTelemetry(
      next.accessToken ?? "",
      next.accountId ?? tokenIdentity.accountId,
      fetchImpl,
    );
    next = {
      ...next,
      runtimeState: usage.status,
      ...(normalizeOpenAiLocalTelemetryPlanType(usage.localTelemetry, tokenIdentity.planType)
        ? {
            localTelemetry: normalizeOpenAiLocalTelemetryPlanType(
              usage.localTelemetry,
              tokenIdentity.planType,
            ),
          }
        : {}),
    };
  }

  return next;
}

export async function applyAlisioOpenAiRuntime(
  credential: Pick<
    AlisioStoredWorkerAiCredential,
    "authProfileId" | "accessToken" | "refreshToken" | "expiresAt" | "accountId" | "email"
  >,
  options?: { displayName?: string },
): Promise<void> {
  if (!credential.accessToken || !credential.refreshToken) {
    throw new AlisioAiError(
      "runtime_apply_failed",
      "The OpenAI session is incomplete and cannot be applied to the runtime.",
    );
  }
  const accessToken = credential.accessToken;
  const refreshToken = credential.refreshToken;

  const authProfileId = normalizeOptionalString(credential.authProfileId);
  if (!authProfileId) {
    throw new AlisioAiError(
      "runtime_apply_failed",
      "The OpenAI runtime binding is missing its local auth profile id.",
    );
  }

  removePersistedAlisioOpenAiAuthProfiles([authProfileId]);
  updateRuntimeAuthProfileStoreSnapshot({
    updater: (store) => {
      store.profiles[authProfileId] = {
        type: "oauth",
        provider: "openai-codex",
        access: accessToken,
        refresh: refreshToken,
        expires: credential.expiresAt
          ? Date.parse(credential.expiresAt)
          : Date.now() + 60 * 60 * 1000,
        ...(credential.accountId ? { accountId: credential.accountId } : {}),
        ...(credential.email ? { email: credential.email } : {}),
        ...(options?.displayName ? { displayName: options.displayName } : {}),
      };
    },
  });
  prioritizeLocalOpenAiAuthProfile(authProfileId);

  const currentConfig = await loadValidConfigOrThrow();
  const configuredOpenAiCodexModel = resolveConfiguredOpenAiCodexModel(currentConfig);
  if (!configuredOpenAiCodexModel) {
    await updateConfig((cfg) => applyDefaultModel(cfg, OPENAI_CODEX_DEFAULT_MODEL));
    return;
  }
  if (!currentConfig.agents?.defaults?.models?.[configuredOpenAiCodexModel]) {
    await updateConfig((cfg) => applyDefaultModel(cfg, configuredOpenAiCodexModel));
  }
}

export async function clearAlisioOpenAiRuntime(params?: {
  authProfileIds?: string[];
}): Promise<void> {
  await stopOpenAiRedirectProxy();

  const authProfileIds = (params?.authProfileIds ?? [])
    .map((entry) => normalizeOptionalString(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (authProfileIds.length === 0) {
    return;
  }

  removePersistedAlisioOpenAiAuthProfiles(authProfileIds);
  updateRuntimeAuthProfileStoreSnapshot({
    updater: (store) => {
      for (const authProfileId of authProfileIds) {
        delete store.profiles[authProfileId];
        if (store.lastGood?.["openai-codex"] === authProfileId) {
          delete store.lastGood["openai-codex"];
        }
        if (store.order?.["openai-codex"]) {
          store.order["openai-codex"] = store.order["openai-codex"].filter(
            (entry) => entry !== authProfileId,
          );
          if (store.order["openai-codex"].length === 0) {
            delete store.order["openai-codex"];
          }
        }
        if (store.usageStats?.[authProfileId]) {
          delete store.usageStats[authProfileId];
        }
      }
    },
  });
}
