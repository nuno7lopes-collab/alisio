import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";
import { ensureAuthProfileStore, saveAuthProfileStore } from "../agents/auth-profiles.js";
import { OPENAI_CODEX_DEFAULT_PROFILE_ID } from "../agents/auth-profiles/constants.js";
import { updateConfig } from "../commands/models/shared.js";
import { isLoopbackHost } from "../gateway/net.js";
import { applyDefaultModel } from "../plugins/provider-auth-choice-helpers.js";
import { writeOAuthCredentials } from "../plugins/provider-auth-helpers.js";
import { applyAuthProfileConfig } from "../plugins/provider-auth-helpers.js";
import { fetchCodexUsage } from "./provider-usage.fetch.codex.js";

const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_SCOPE = "openid profile email offline_access";
const OPENAI_LOOPBACK_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_AUTH_CLAIM_PATH = "https://api.openai.com/auth";
const LIMITS_REFRESH_TTL_MS = 10 * 60 * 1000;

export type AlisioAiStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "limits_unavailable"
  | "expired";

export type AlisioAiUsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

export type AlisioAiLimits = {
  windows: AlisioAiUsageWindow[];
  lastRefreshedAt: string;
};

export type AlisioAiState = {
  provider: "openai";
  status: AlisioAiStatus;
  email?: string;
  accountId?: string;
  planLabel?: string;
  connectedAt?: string;
  limits?: AlisioAiLimits;
};

export type AlisioStoredAiSession = {
  provider: "openai";
  status: AlisioAiStatus;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  email?: string;
  accountId?: string;
  planLabel?: string;
  connectedAt?: string;
  limits?: AlisioAiLimits;
};

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

function buildCodeVerifier() {
  // Keep verifier shape aligned with @mariozechner/pi-ai's OpenAI Codex OAuth flow.
  return randomBytes(32).toString("base64url");
}

function buildCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function buildStateToken() {
  // OpenAI's hosted auth flow appears sensitive to the exact request shape.
  // Mirror the upstream flow here to avoid hidden compatibility drift.
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

function resolveOpenAiAccountId(accessToken: string) {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.[OPENAI_AUTH_CLAIM_PATH];
  if (!auth || typeof auth !== "object") {
    return undefined;
  }
  const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
}

function resolveOpenAiEmail(accessToken: string) {
  const payload = decodeJwtPayload(accessToken);
  const candidates = [payload?.email, payload?.preferred_username, payload?.sub];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.includes("@")) {
      return candidate.trim().toLowerCase();
    }
  }
  return undefined;
}

function normalizeLimitsSnapshot(
  snapshot: Awaited<ReturnType<typeof fetchCodexUsage>>,
): AlisioAiLimits {
  return {
    windows: snapshot.windows.map((window) => ({
      label: window.label,
      usedPercent: window.usedPercent,
      ...(typeof window.resetAt === "number" ? { resetAt: window.resetAt } : {}),
    })),
    lastRefreshedAt: new Date().toISOString(),
  };
}

type OpenAiRedirectProxy = {
  server: Server;
  callbackUrl: string;
};

let openAiRedirectProxy: OpenAiRedirectProxy | null = null;

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

async function ensureOpenAiRedirectProxy(callbackUrl: string): Promise<void> {
  const target = new URL(callbackUrl);
  if (!/^https?:$/.test(target.protocol)) {
    throw new AlisioAiError("connect_failed", "The OpenAI callback must use http or https.");
  }

  if (openAiRedirectProxy) {
    if (openAiRedirectProxy.callbackUrl !== target.toString()) {
      await stopOpenAiRedirectProxy();
    } else {
      return;
    }
  }

  const createRelayServer = () =>
    createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", OPENAI_LOOPBACK_REDIRECT_URI);
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
      server.listen({ port: 1455, host });
    }).catch((error) => {
      server.close(() => undefined);
      throw error;
    });
    return server;
  };

  try {
    // Listen on the IPv6 wildcard first so localhost works for both ::1 and 127.0.0.1.
    const server = await listen("::");
    openAiRedirectProxy = {
      server,
      callbackUrl: target.toString(),
    };
    return;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    if (code !== "EAFNOSUPPORT" && code !== "EADDRNOTAVAIL") {
      throw new AlisioAiError(
        "connect_failed",
        `Could not start the local OpenAI callback relay on localhost:1455: ${String(error)}`,
      );
    }
  }

  try {
    const server = await listen("127.0.0.1");
    openAiRedirectProxy = {
      server,
      callbackUrl: target.toString(),
    };
  } catch (error) {
    throw new AlisioAiError(
      "connect_failed",
      `Could not start the local OpenAI callback relay on localhost:1455: ${String(error)}`,
    );
  }
}

export async function buildAlisioOpenAiAuthorization(params: { callbackUrl: string }): Promise<{
  pending: AlisioPendingAiAuthorization;
  setupUrl: string;
}> {
  const callbackUrl = new URL(params.callbackUrl);
  if (!/^https?:$/.test(callbackUrl.protocol)) {
    throw new AlisioAiError("connect_failed", "The OpenAI callback must use http or https.");
  }

  const useLocalRelay = isOpenAiLocalCallbackTarget(callbackUrl);
  const redirectUri = useLocalRelay ? OPENAI_LOOPBACK_REDIRECT_URI : callbackUrl.toString();
  if (useLocalRelay) {
    await ensureOpenAiRedirectProxy(callbackUrl.toString());
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
    expiresAt:
      typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000).toISOString()
        : undefined,
  };
}

async function fetchOpenAiLimits(
  accessToken: string,
  accountId: string | undefined,
  fetchImpl: typeof fetch,
): Promise<{ limits?: AlisioAiLimits; planLabel?: string; status: AlisioAiStatus }> {
  try {
    const usage = await fetchCodexUsage(accessToken, accountId, 5_000, fetchImpl);
    return {
      limits: normalizeLimitsSnapshot(usage),
      planLabel: usage.plan,
      status: "connected",
    };
  } catch {
    return {
      status: "limits_unavailable",
    };
  }
}

export async function completeAlisioOpenAiAuthorization(params: {
  pending: AlisioPendingAiAuthorization;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<AlisioStoredAiSession> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const token = await exchangeOpenAiCode({
    pending: params.pending,
    code: params.code,
    fetchImpl,
  });
  const accountId = resolveOpenAiAccountId(token.accessToken);
  const email = resolveOpenAiEmail(token.accessToken);
  const usage = await fetchOpenAiLimits(token.accessToken, accountId, fetchImpl);
  return {
    provider: "openai",
    status: usage.status,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    email,
    accountId,
    planLabel: usage.planLabel,
    connectedAt: new Date().toISOString(),
    ...(usage.limits ? { limits: usage.limits } : {}),
  };
}

export async function refreshAlisioOpenAiSession(params: {
  session: AlisioStoredAiSession;
  fetchImpl?: typeof fetch;
}): Promise<AlisioStoredAiSession> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const now = Date.now();
  let next = { ...params.session };
  const expiresAtMs = next.expiresAt ? Date.parse(next.expiresAt) : Number.NaN;
  if (
    next.refreshToken &&
    (!Number.isFinite(expiresAtMs) || expiresAtMs - now <= 60_000 || next.status === "expired")
  ) {
    try {
      const refreshed = await refreshOpenAICodexToken(next.refreshToken);
      next = {
        ...next,
        status: "connected",
        accessToken: refreshed.access,
        refreshToken: refreshed.refresh,
        expiresAt: new Date(refreshed.expires).toISOString(),
        accountId:
          typeof refreshed.accountId === "string" && refreshed.accountId.trim()
            ? refreshed.accountId
            : next.accountId,
        email:
          typeof refreshed.email === "string" && refreshed.email.trim()
            ? refreshed.email.trim().toLowerCase()
            : next.email,
      };
    } catch {
      return {
        ...next,
        status: "expired",
      };
    }
  }

  const lastRefreshedAt = next.limits?.lastRefreshedAt
    ? Date.parse(next.limits.lastRefreshedAt)
    : 0;
  if (!lastRefreshedAt || now - lastRefreshedAt >= LIMITS_REFRESH_TTL_MS) {
    const usage = await fetchOpenAiLimits(next.accessToken ?? "", next.accountId, fetchImpl);
    next = {
      ...next,
      status: usage.status,
      planLabel: usage.planLabel ?? next.planLabel,
      ...(usage.limits ? { limits: usage.limits } : {}),
    };
  }

  return next;
}

export function toAlisioAiState(session: AlisioStoredAiSession | null | undefined): AlisioAiState {
  if (!session) {
    return {
      provider: "openai",
      status: "disconnected",
    };
  }
  return {
    provider: "openai",
    status: session.status,
    ...(session.email ? { email: session.email } : {}),
    ...(session.accountId ? { accountId: session.accountId } : {}),
    ...(session.planLabel ? { planLabel: session.planLabel } : {}),
    ...(session.connectedAt ? { connectedAt: session.connectedAt } : {}),
    ...(session.limits ? { limits: session.limits } : {}),
  };
}

export async function applyAlisioOpenAiRuntime(session: AlisioStoredAiSession): Promise<void> {
  if (!session.accessToken || !session.refreshToken) {
    throw new AlisioAiError(
      "runtime_apply_failed",
      "The OpenAI session is incomplete and cannot be applied to the runtime.",
    );
  }
  await writeOAuthCredentials(
    "openai-codex",
    {
      access: session.accessToken,
      refresh: session.refreshToken,
      expires: session.expiresAt ? Date.parse(session.expiresAt) : Date.now() + 60 * 60 * 1000,
      ...(session.accountId ? { accountId: session.accountId } : {}),
      ...(session.email ? { email: session.email } : {}),
    },
    undefined,
    {
      profileName: "default",
      displayName: "Alisio OpenAI",
      syncSiblingAgents: true,
    },
  );
  await updateConfig((cfg) => {
    const withProfile = applyAuthProfileConfig(cfg, {
      profileId: OPENAI_CODEX_DEFAULT_PROFILE_ID,
      provider: "openai-codex",
      mode: "oauth",
      ...(session.email ? { email: session.email } : {}),
      displayName: "Alisio OpenAI",
    });
    return applyDefaultModel(withProfile, "openai-codex/gpt-5.4");
  });
}

export async function clearAlisioOpenAiRuntime(): Promise<void> {
  await stopOpenAiRedirectProxy();
  const store = ensureAuthProfileStore();
  delete store.profiles[OPENAI_CODEX_DEFAULT_PROFILE_ID];
  if (store.lastGood?.["openai-codex"] === OPENAI_CODEX_DEFAULT_PROFILE_ID) {
    delete store.lastGood["openai-codex"];
  }
  if (store.order?.["openai-codex"]) {
    store.order["openai-codex"] = store.order["openai-codex"].filter(
      (entry) => entry !== OPENAI_CODEX_DEFAULT_PROFILE_ID,
    );
    if (store.order["openai-codex"].length === 0) {
      delete store.order["openai-codex"];
    }
  }
  saveAuthProfileStore(store);

  await updateConfig((cfg) => {
    const profiles = { ...cfg.auth?.profiles };
    delete profiles[OPENAI_CODEX_DEFAULT_PROFILE_ID];
    const order = { ...cfg.auth?.order };
    if (Array.isArray(order["openai-codex"])) {
      order["openai-codex"] = order["openai-codex"].filter(
        (entry) => entry !== OPENAI_CODEX_DEFAULT_PROFILE_ID,
      );
      if (order["openai-codex"].length === 0) {
        delete order["openai-codex"];
      }
    }
    return {
      ...cfg,
      auth: {
        ...cfg.auth,
        ...(Object.keys(profiles).length > 0 ? { profiles } : { profiles: undefined }),
        ...(Object.keys(order).length > 0 ? { order } : { order: undefined }),
      },
    };
  }).catch(() => undefined);
}
