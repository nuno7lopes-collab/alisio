import { createHash } from "node:crypto";
import {
  type AlisioAccountAuthMethod,
  ALISIO_USERNAME_MAX_LENGTH,
  ALISIO_USERNAME_MIN_LENGTH,
  deriveAlisioAvatarLabel,
  normalizeAlisioAgentName,
  normalizeAlisioBirthdate,
  normalizeAlisioUsername,
} from "../shared/alisio-account.js";
import { normalizeAlisioPlan, type AlisioPlan } from "../shared/alisio-billing.js";

export type AlisioAccountBackend = "supabase";

export type AlisioStoredPasswordCredential = {
  email: string;
  salt: string;
  hash: string;
};

export type AlisioStoredCloudSession = {
  backend: AlisioAccountBackend;
  state: "signed_out" | "signed_in";
  authMethod?: AlisioAccountAuthMethod;
  userId?: string;
  email?: string;
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
  tokenType?: string;
  signedInAt?: string;
  signedOutAt?: string;
};

export type AlisioCloudAccountProfile = {
  userId?: string;
  email: string;
  displayName: string;
  username: string;
  agentName?: string;
  avatarLabel: string;
  avatarUrl?: string;
  termsAcceptedAt?: string;
  marketingOptIn?: boolean;
  birthdate?: string;
  joinedAt: string;
  plan: AlisioPlan;
  profileCompleted: boolean;
  backend: AlisioAccountBackend;
};

export class AlisioAccountCloudError extends Error {
  readonly code:
    | "backend_unavailable"
    | "invalid_credentials"
    | "email_in_use"
    | "username_taken"
    | "profile_write_failed"
    | "session_refresh_failed"
    | "password_reset_failed"
    | "password_update_failed"
    | "email_auth_failed"
    | "email_verification_failed"
    | "email_change_failed"
    | "oauth_failed";

  constructor(
    code:
      | "backend_unavailable"
      | "invalid_credentials"
      | "email_in_use"
      | "username_taken"
      | "profile_write_failed"
      | "session_refresh_failed"
      | "password_reset_failed"
      | "password_update_failed"
      | "email_auth_failed"
      | "email_verification_failed"
      | "email_change_failed"
      | "oauth_failed",
    message: string,
  ) {
    super(message);
    this.name = "AlisioAccountCloudError";
    this.code = code;
  }
}

type SupabaseConfig = {
  url: string;
  anonKey: string;
  profilesTable: string;
};

export const ALISIO_REQUIRED_SUPABASE_ENV_VARS = [
  "ALISIO_SUPABASE_URL",
  "ALISIO_SUPABASE_ANON_KEY",
] as const;

function resolveSupabaseClientKey(env: NodeJS.ProcessEnv) {
  return env.ALISIO_SUPABASE_ANON_KEY?.trim() || env.ALISIO_SUPABASE_PUBLISHABLE_KEY?.trim() || "";
}

type SupabaseSessionResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  user?: {
    id?: string;
    email?: string;
    created_at?: string;
  };
  error_description?: string;
  msg?: string;
};

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  created_at?: string;
};

type SupabaseProfileRow = {
  user_id?: string;
  email?: string;
  display_name?: string;
  username?: string;
  agent_name?: string;
  avatar_url?: string;
  avatar_label?: string;
  terms_accepted_at?: string;
  marketing_opt_in?: boolean;
  birthdate?: string;
  joined_at?: string;
  plan?: string;
  profile_completed?: boolean;
};

type CompleteProfileParams = {
  session: AlisioStoredCloudSession;
  email: string;
  username: string;
  displayName: string;
  agentName?: string;
  avatarLabel: string;
  avatarUrl?: string;
  termsAcceptedAt?: string;
  marketingOptIn?: boolean;
  birthdate?: string;
  joinedAt: string;
  plan: AlisioPlan;
};

type ResolvedSupabaseSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  authMethod: AlisioAccountAuthMethod;
  userId: string;
  email: string;
  joinedAt: string;
};

type EmailAuthResult = {
  ok: true;
  email: string;
  message: string;
};

const SUPABASE_PROFILE_SELECT_COLUMNS = [
  "user_id",
  "email",
  "display_name",
  "username",
  "agent_name",
  "avatar_url",
  "avatar_label",
  "terms_accepted_at",
  "marketing_opt_in",
  "birthdate",
  "joined_at",
  "plan",
  "profile_completed",
] as const;

function buildCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function listMissingRequiredAlisioCloudEnvVars(
  env: NodeJS.ProcessEnv,
): Array<(typeof ALISIO_REQUIRED_SUPABASE_ENV_VARS)[number]> {
  return ALISIO_REQUIRED_SUPABASE_ENV_VARS.filter((key) =>
    key === "ALISIO_SUPABASE_ANON_KEY" ? !resolveSupabaseClientKey(env) : !(env[key]?.trim() || ""),
  );
}

function resolveSupabaseConfig(env: NodeJS.ProcessEnv): SupabaseConfig | null {
  if (listMissingRequiredAlisioCloudEnvVars(env).length > 0) {
    return null;
  }
  const url = env.ALISIO_SUPABASE_URL?.trim() || "";
  const anonKey = resolveSupabaseClientKey(env);
  return {
    url: url.replace(/\/+$/, ""),
    anonKey,
    profilesTable: env.ALISIO_SUPABASE_PROFILES_TABLE?.trim() || "alisio_profiles",
  };
}

export function resolveAlisioAccountBackend(
  _env: NodeJS.ProcessEnv = process.env,
): AlisioAccountBackend {
  void _env;
  return "supabase";
}

function defaultProfileSeed(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const rawName = normalizedEmail.split("@", 1)[0] || "alisio";
  const username = normalizeSeedUsername(rawName);
  const displayName = rawName
    .split(/[._-]+/)
    .filter(Boolean)
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
  return {
    username,
    displayName: displayName || "Alisio User",
    avatarLabel: deriveAlisioAvatarLabel({
      displayName: displayName || "Alisio User",
      username,
    }),
  };
}

function normalizeSeedUsername(value: string) {
  const normalized = normalizeAlisioUsername(value).replace(/[^a-z0-9._]+/g, "");
  return normalized.slice(0, ALISIO_USERNAME_MAX_LENGTH) || "alisio";
}

function buildDefaultUsernameCandidates(email: string, userId: string) {
  const base = normalizeSeedUsername(email.split("@", 1)[0] || "alisio");
  const fallbackSuffix =
    userId
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 4) || createHash("sha256").update(email).digest("hex").slice(0, 4);
  const paddedBase =
    base.length >= ALISIO_USERNAME_MIN_LENGTH
      ? base
      : `${base}${fallbackSuffix}`.slice(0, ALISIO_USERNAME_MAX_LENGTH);
  const baseWithSuffix = `${base.slice(0, ALISIO_USERNAME_MAX_LENGTH - fallbackSuffix.length)}${fallbackSuffix}`;
  const fallbackBase = `user${fallbackSuffix}`.slice(0, ALISIO_USERNAME_MAX_LENGTH);
  return [
    ...new Set(
      [paddedBase, baseWithSuffix, fallbackBase].map((entry) => normalizeSeedUsername(entry)),
    ),
  ].filter((entry) => entry.length >= ALISIO_USERNAME_MIN_LENGTH);
}

async function fetchJson(
  input: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown> | SupabaseProfileRow[] | SupabaseProfileRow | null;
}> {
  const response = await fetchImpl(input, init);
  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | SupabaseProfileRow[]
    | SupabaseProfileRow
    | null;
  return { ok: response.ok, status: response.status, body };
}

function supabaseHeaders(config: SupabaseConfig, accessToken?: string) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${accessToken ?? config.anonKey}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

function mapSupabaseProfile(
  row: SupabaseProfileRow | null | undefined,
  fallback: {
    userId?: string;
    email: string;
    joinedAt: string;
    backend: AlisioAccountBackend;
  },
): AlisioCloudAccountProfile {
  const seed = defaultProfileSeed(row?.email || fallback.email);
  return {
    userId: row?.user_id ?? fallback.userId,
    email: row?.email?.trim() || fallback.email,
    displayName: row?.display_name?.trim() || seed.displayName,
    username: normalizeAlisioUsername(row?.username?.trim() || seed.username),
    ...(normalizeAlisioAgentName(row?.agent_name) ? { agentName: row?.agent_name?.trim() } : {}),
    avatarLabel:
      row?.avatar_label?.trim().slice(0, 2).toUpperCase() ||
      deriveAlisioAvatarLabel({
        avatarLabel: row?.avatar_label,
        displayName: row?.display_name || seed.displayName,
        username: row?.username || seed.username,
      }),
    avatarUrl: row?.avatar_url?.trim() || undefined,
    ...(row?.terms_accepted_at?.trim() ? { termsAcceptedAt: row.terms_accepted_at.trim() } : {}),
    ...(typeof row?.marketing_opt_in === "boolean" ? { marketingOptIn: row.marketing_opt_in } : {}),
    ...(normalizeAlisioBirthdate(row?.birthdate) ? { birthdate: row?.birthdate?.trim() } : {}),
    joinedAt: row?.joined_at?.trim() || fallback.joinedAt,
    plan: normalizeAlisioPlan(row?.plan),
    profileCompleted: Boolean(row?.profile_completed),
    backend: fallback.backend,
  };
}

function readSupabaseErrorDetail(body: Record<string, unknown> | null | undefined): string {
  const candidates = [body?.msg, body?.error_description, body?.message, body?.error, body?.hint];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function readSupabaseErrorText(body: Record<string, unknown> | null | undefined): string {
  return readSupabaseErrorDetail(body).toLowerCase();
}

function buildSupabaseRequestFailureMessage(params: {
  status: number;
  body: Record<string, unknown> | null | undefined;
  fallbackMessage: string;
}) {
  const detail = readSupabaseErrorDetail(params.body);
  if (!detail) {
    return `${params.fallbackMessage} Supabase replied with HTTP ${params.status}.`;
  }
  return `${params.fallbackMessage} Supabase replied with HTTP ${params.status}: ${detail}`;
}

function readSupabaseMissingColumn(
  body: Record<string, unknown> | null | undefined,
  tableName: string,
): string | null {
  const detail = readSupabaseErrorDetail(body);
  if (!detail) {
    return null;
  }
  const escapedTableName = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = detail.match(
    new RegExp(`column\\s+${escapedTableName}\\.([a-z0-9_]+)\\s+does\\s+not\\s+exist`, "i"),
  );
  return match?.[1]?.toLowerCase() ?? null;
}

function resolveSignedOutCloudSession(
  session: AlisioStoredCloudSession,
  signedOutAt = new Date().toISOString(),
): AlisioStoredCloudSession {
  return {
    backend: session.backend,
    state: "signed_out",
    ...(session.authMethod ? { authMethod: session.authMethod } : {}),
    ...(session.userId ? { userId: session.userId } : {}),
    ...(session.email ? { email: session.email } : {}),
    ...(session.signedInAt ? { signedInAt: session.signedInAt } : {}),
    signedOutAt,
  };
}

function resolveSupabaseSession(params: {
  body: SupabaseSessionResponse;
  fallbackEmail: string;
  authMethod: AlisioAccountAuthMethod;
  errorCode: AlisioAccountCloudError["code"];
  errorMessage: string;
}): ResolvedSupabaseSession {
  const accessToken = params.body.access_token?.trim() || "";
  const userId = params.body.user?.id?.trim() || "";
  const email = params.body.user?.email?.trim().toLowerCase() || params.fallbackEmail;
  if (!accessToken || !userId || !email) {
    throw new AlisioAccountCloudError(params.errorCode, params.errorMessage);
  }
  return {
    accessToken,
    refreshToken: params.body.refresh_token?.trim() || undefined,
    expiresAt:
      typeof params.body.expires_in === "number"
        ? new Date(Date.now() + params.body.expires_in * 1000).toISOString()
        : undefined,
    tokenType: params.body.token_type?.trim() || undefined,
    authMethod: params.authMethod,
    userId,
    email,
    joinedAt: params.body.user?.created_at?.trim() || new Date().toISOString(),
  };
}

function buildStoredSupabaseSession(
  resolvedSession: ResolvedSupabaseSession,
  signedInAt = new Date().toISOString(),
): AlisioStoredCloudSession {
  return {
    backend: "supabase",
    state: "signed_in",
    authMethod: resolvedSession.authMethod,
    userId: resolvedSession.userId,
    email: resolvedSession.email,
    accessToken: resolvedSession.accessToken,
    refreshToken: resolvedSession.refreshToken,
    expiresAt: resolvedSession.expiresAt,
    tokenType: resolvedSession.tokenType,
    signedInAt,
  };
}

async function fetchSupabaseProfile(params: {
  config: SupabaseConfig;
  accessToken: string;
  userId: string;
  fallbackEmail: string;
  fallbackJoinedAt: string;
  fetchImpl: typeof fetch;
}) {
  const url = new URL(`/rest/v1/${params.config.profilesTable}`, params.config.url);
  url.searchParams.set("user_id", `eq.${params.userId}`);
  const selectColumns = [...SUPABASE_PROFILE_SELECT_COLUMNS];
  while (selectColumns.length > 0) {
    url.searchParams.set("select", selectColumns.join(","));
    const result = await fetchJson(
      url.toString(),
      {
        method: "GET",
        headers: supabaseHeaders(params.config, params.accessToken),
      },
      params.fetchImpl,
    );
    if (result.ok) {
      const body = Array.isArray(result.body) ? result.body[0] : null;
      return mapSupabaseProfile(body, {
        userId: params.userId,
        email: params.fallbackEmail,
        joinedAt: params.fallbackJoinedAt,
        backend: "supabase",
      });
    }
    const body = result.body as Record<string, unknown> | null;
    const missingColumn = readSupabaseMissingColumn(body, params.config.profilesTable);
    if (
      missingColumn &&
      selectColumns.includes(missingColumn as (typeof SUPABASE_PROFILE_SELECT_COLUMNS)[number])
    ) {
      selectColumns.splice(
        selectColumns.indexOf(missingColumn as (typeof SUPABASE_PROFILE_SELECT_COLUMNS)[number]),
        1,
      );
      continue;
    }
    throw new AlisioAccountCloudError(
      "profile_write_failed",
      buildSupabaseRequestFailureMessage({
        status: result.status,
        body,
        fallbackMessage: "Alisio could not load the account profile from the cloud.",
      }),
    );
  }
  throw new AlisioAccountCloudError(
    "profile_write_failed",
    "Alisio could not load the account profile from the cloud.",
  );
}

async function writeSupabaseProfile(params: {
  config: SupabaseConfig;
  accessToken: string;
  payload: {
    user_id: string;
    email: string;
    display_name: string;
    username: string;
    agent_name: string | null;
    avatar_url: string | null;
    avatar_label: string;
    terms_accepted_at: string | null;
    marketing_opt_in: boolean;
    birthdate: string | null;
    joined_at: string;
    plan: AlisioPlan;
    profile_completed: boolean;
  };
  fetchImpl: typeof fetch;
}) {
  const url = new URL(`/rest/v1/${params.config.profilesTable}`, params.config.url);
  url.searchParams.set("on_conflict", "user_id");
  const result = await fetchJson(
    url.toString(),
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(params.config, params.accessToken),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(params.payload),
    },
    params.fetchImpl,
  );
  if (!result.ok) {
    const body = result.body as Record<string, unknown> | null;
    const message = readSupabaseErrorText(body);
    if (message.includes("duplicate") || message.includes("unique")) {
      throw new AlisioAccountCloudError("username_taken", "That username is already in use.");
    }
    throw new AlisioAccountCloudError(
      "profile_write_failed",
      "Alisio could not save the account profile.",
    );
  }
  const row = Array.isArray(result.body)
    ? result.body[0]
    : (result.body as SupabaseProfileRow | null);
  if (!row) {
    throw new AlisioAccountCloudError(
      "profile_write_failed",
      "Alisio could not verify the saved account profile.",
    );
  }
  return row;
}

async function ensureSupabaseProfile(params: {
  config: SupabaseConfig;
  accessToken: string;
  userId: string;
  email: string;
  joinedAt: string;
  fetchImpl: typeof fetch;
}) {
  const fetched = await fetchSupabaseProfile({
    config: params.config,
    accessToken: params.accessToken,
    userId: params.userId,
    fallbackEmail: params.email,
    fallbackJoinedAt: params.joinedAt,
    fetchImpl: params.fetchImpl,
  });
  if (fetched.userId && fetched.profileCompleted) {
    if (fetched.email === params.email) {
      return fetched;
    }
    const row = await writeSupabaseProfile({
      config: params.config,
      accessToken: params.accessToken,
      payload: {
        user_id: params.userId,
        email: params.email,
        display_name: fetched.displayName,
        username: fetched.username,
        agent_name: fetched.agentName ?? null,
        avatar_url: fetched.avatarUrl ?? null,
        avatar_label: fetched.avatarLabel,
        terms_accepted_at: fetched.termsAcceptedAt ?? null,
        marketing_opt_in: fetched.marketingOptIn ?? false,
        birthdate: fetched.birthdate ?? null,
        joined_at: fetched.joinedAt,
        plan: fetched.plan,
        profile_completed: true,
      },
      fetchImpl: params.fetchImpl,
    });
    return mapSupabaseProfile(row, {
      userId: params.userId,
      email: params.email,
      joinedAt: fetched.joinedAt,
      backend: "supabase",
    });
  }
  if (fetched.userId) {
    return fetched.email === params.email
      ? fetched
      : mapSupabaseProfile(
          await writeSupabaseProfile({
            config: params.config,
            accessToken: params.accessToken,
            payload: {
              user_id: params.userId,
              email: params.email,
              display_name: fetched.displayName,
              username: fetched.username,
              agent_name: fetched.agentName ?? null,
              avatar_url: fetched.avatarUrl ?? null,
              avatar_label: fetched.avatarLabel,
              terms_accepted_at: fetched.termsAcceptedAt ?? null,
              marketing_opt_in: fetched.marketingOptIn ?? false,
              birthdate: fetched.birthdate ?? null,
              joined_at: fetched.joinedAt,
              plan: fetched.plan,
              profile_completed: fetched.profileCompleted,
            },
            fetchImpl: params.fetchImpl,
          }),
          {
            userId: params.userId,
            email: params.email,
            joinedAt: fetched.joinedAt,
            backend: "supabase",
          },
        );
  }

  const seed = defaultProfileSeed(params.email);
  const usernameCandidates = buildDefaultUsernameCandidates(params.email, params.userId);
  for (const candidate of usernameCandidates) {
    try {
      const row = await writeSupabaseProfile({
        config: params.config,
        accessToken: params.accessToken,
        payload: {
          user_id: params.userId,
          email: params.email,
          display_name: seed.displayName,
          username: candidate,
          agent_name: null,
          avatar_url: null,
          avatar_label: seed.avatarLabel,
          terms_accepted_at: null,
          marketing_opt_in: false,
          birthdate: null,
          joined_at: params.joinedAt,
          plan: "free",
          profile_completed: false,
        },
        fetchImpl: params.fetchImpl,
      });
      return mapSupabaseProfile(row, {
        userId: params.userId,
        email: params.email,
        joinedAt: params.joinedAt,
        backend: "supabase",
      });
    } catch (error) {
      if (!(error instanceof AlisioAccountCloudError) || error.code !== "username_taken") {
        throw error;
      }
    }
  }

  throw new AlisioAccountCloudError(
    "profile_write_failed",
    "Alisio could not reserve a unique username for the new account.",
  );
}

async function signInWithSupabasePassword(params: {
  config: SupabaseConfig;
  email: string;
  password: string;
  fetchImpl: typeof fetch;
}) {
  const url = new URL("/auth/v1/token?grant_type=password", params.config.url);
  const result = await fetchJson(
    url.toString(),
    {
      method: "POST",
      headers: supabaseHeaders(params.config),
      body: JSON.stringify({
        email: params.email.trim().toLowerCase(),
        password: params.password,
      }),
    },
    params.fetchImpl,
  );
  if (!result.ok) {
    throw new AlisioAccountCloudError(
      "invalid_credentials",
      "Invalid email or password for this Alisio account.",
    );
  }
  return result.body as SupabaseSessionResponse;
}

export async function beginAlisioCloudAccountEmailAuth(params: {
  email: string;
  callbackUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<EmailAuthResult> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const email = params.email.trim().toLowerCase();
  const config = resolveSupabaseConfig(env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const url = new URL("/auth/v1/otp", config.url);
  if (params.callbackUrl?.trim()) {
    url.searchParams.set("redirect_to", params.callbackUrl.trim());
  }
  const result = await fetchJson(
    url.toString(),
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config),
        ...(params.callbackUrl?.trim() ? { redirect_to: params.callbackUrl.trim() } : {}),
      },
      body: JSON.stringify({
        email,
        create_user: true,
      }),
    },
    fetchImpl,
  );
  if (!result.ok) {
    throw new AlisioAccountCloudError(
      "email_auth_failed",
      buildSupabaseRequestFailureMessage({
        status: result.status,
        body: result.body as Record<string, unknown> | null,
        fallbackMessage: "Alisio could not send the verification email right now.",
      }),
    );
  }

  return {
    ok: true,
    email,
    message: "Check your email for the verification code or sign-in link, then return to Alisio.",
  };
}

async function fetchSupabaseUser(params: {
  config: SupabaseConfig;
  accessToken: string;
  fetchImpl: typeof fetch;
}) {
  const userUrl = new URL("/auth/v1/user", params.config.url);
  const userResult = await fetchJson(
    userUrl.toString(),
    {
      method: "GET",
      headers: supabaseHeaders(params.config, params.accessToken),
    },
    params.fetchImpl,
  );
  if (!userResult.ok) {
    throw new AlisioAccountCloudError(
      "session_refresh_failed",
      buildSupabaseRequestFailureMessage({
        status: userResult.status,
        body: userResult.body as Record<string, unknown> | null,
        fallbackMessage: "The Alisio account session is no longer valid. Sign in again.",
      }),
    );
  }
  return userResult.body as SupabaseUserResponse;
}

async function refreshSupabaseLinkSession(params: {
  config: SupabaseConfig;
  refreshToken: string;
  tokenType?: string;
  fetchImpl: typeof fetch;
}) {
  const refreshToken = params.refreshToken.trim();
  if (!refreshToken) {
    throw new AlisioAccountCloudError(
      "session_refresh_failed",
      "The Alisio account session is no longer valid. Sign in again.",
    );
  }

  const refreshUrl = new URL("/auth/v1/token?grant_type=refresh_token", params.config.url);
  const refreshResult = await fetchJson(
    refreshUrl.toString(),
    {
      method: "POST",
      headers: supabaseHeaders(params.config),
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    },
    params.fetchImpl,
  );
  if (!refreshResult.ok) {
    throw new AlisioAccountCloudError(
      "session_refresh_failed",
      buildSupabaseRequestFailureMessage({
        status: refreshResult.status,
        body: refreshResult.body as Record<string, unknown> | null,
        fallbackMessage: "The Alisio account session is no longer valid. Sign in again.",
      }),
    );
  }

  const resolvedSession = resolveSupabaseSession({
    body: refreshResult.body as SupabaseSessionResponse,
    fallbackEmail: "",
    authMethod: "email",
    errorCode: "session_refresh_failed",
    errorMessage: "The Alisio account session is no longer valid. Sign in again.",
  });
  return {
    accessToken: resolvedSession.accessToken,
    refreshToken: resolvedSession.refreshToken ?? refreshToken,
    tokenType: resolvedSession.tokenType ?? params.tokenType,
    expiresAt: resolvedSession.expiresAt,
  };
}

export async function verifyAlisioCloudAccountEmailAuth(params: {
  email: string;
  code: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  session: AlisioStoredCloudSession;
  profile: AlisioCloudAccountProfile;
}> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const email = params.email.trim().toLowerCase();
  const code = params.code.trim();
  const config = resolveSupabaseConfig(env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const url = new URL("/auth/v1/verify", config.url);
  const result = await fetchJson(
    url.toString(),
    {
      method: "POST",
      headers: supabaseHeaders(config),
      body: JSON.stringify({
        email,
        token: code,
        type: "email",
      }),
    },
    fetchImpl,
  );
  if (!result.ok) {
    throw new AlisioAccountCloudError(
      "email_verification_failed",
      buildSupabaseRequestFailureMessage({
        status: result.status,
        body: result.body as Record<string, unknown> | null,
        fallbackMessage:
          "The verification code is invalid or has expired. Request a new email and try again.",
      }),
    );
  }

  const resolvedSession = resolveSupabaseSession({
    body: result.body as SupabaseSessionResponse,
    fallbackEmail: email,
    authMethod: "email",
    errorCode: "email_verification_failed",
    errorMessage: "Alisio could not verify this email yet.",
  });
  const profile = await ensureSupabaseProfile({
    config,
    accessToken: resolvedSession.accessToken,
    userId: resolvedSession.userId,
    email: resolvedSession.email,
    joinedAt: resolvedSession.joinedAt,
    fetchImpl,
  });

  return {
    session: buildStoredSupabaseSession(resolvedSession),
    profile,
  };
}

export function buildAlisioCloudGoogleAuthUrl(params: {
  callbackUrl: string;
  codeVerifier: string;
  stateToken?: string;
  env?: NodeJS.ProcessEnv;
}): {
  setupUrl: string;
  redirectUri: string;
} {
  const config = resolveSupabaseConfig(params.env ?? process.env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const callbackUrl = params.callbackUrl.trim();
  if (!callbackUrl) {
    throw new AlisioAccountCloudError("oauth_failed", "Alisio needs a callback URL to sign in.");
  }

  const url = new URL("/auth/v1/authorize", config.url);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", callbackUrl);
  url.searchParams.set("code_challenge", buildCodeChallenge(params.codeVerifier));
  url.searchParams.set("code_challenge_method", "s256");
  url.searchParams.set("scopes", "openid email profile");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("access_type", "offline");
  if (params.stateToken?.trim()) {
    url.searchParams.set("state", params.stateToken.trim());
  }
  return {
    setupUrl: url.toString(),
    redirectUri: callbackUrl,
  };
}

export async function exchangeAlisioCloudGoogleAuthCode(params: {
  code: string;
  codeVerifier: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  session: AlisioStoredCloudSession;
  profile: AlisioCloudAccountProfile;
}> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const config = resolveSupabaseConfig(env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const url = new URL("/auth/v1/token?grant_type=pkce", config.url);
  const result = await fetchJson(
    url.toString(),
    {
      method: "POST",
      headers: supabaseHeaders(config),
      body: JSON.stringify({
        auth_code: params.code.trim(),
        code_verifier: params.codeVerifier,
      }),
    },
    fetchImpl,
  );
  if (!result.ok) {
    throw new AlisioAccountCloudError(
      "oauth_failed",
      "Alisio could not complete the Google sign-in flow.",
    );
  }

  const resolvedSession = resolveSupabaseSession({
    body: result.body as SupabaseSessionResponse,
    fallbackEmail: "",
    authMethod: "google",
    errorCode: "oauth_failed",
    errorMessage: "Alisio could not establish the Google account session.",
  });
  const profile = await ensureSupabaseProfile({
    config,
    accessToken: resolvedSession.accessToken,
    userId: resolvedSession.userId,
    email: resolvedSession.email,
    joinedAt: resolvedSession.joinedAt,
    fetchImpl,
  });

  return {
    session: buildStoredSupabaseSession(resolvedSession),
    profile,
  };
}

export async function signUpAlisioCloudAccount(params: {
  email: string;
  password: string;
  callbackUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  session: AlisioStoredCloudSession;
  profile: AlisioCloudAccountProfile;
}> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const email = params.email.trim().toLowerCase();

  const config = resolveSupabaseConfig(env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const signUpUrl = new URL("/auth/v1/signup", config.url);
  if (params.callbackUrl?.trim()) {
    signUpUrl.searchParams.set("redirect_to", params.callbackUrl.trim());
  }
  const signUpResult = await fetchJson(
    signUpUrl.toString(),
    {
      method: "POST",
      headers: supabaseHeaders(config),
      body: JSON.stringify({
        email,
        password: params.password,
      }),
    },
    fetchImpl,
  );

  if (!signUpResult.ok) {
    const message = readSupabaseErrorText(signUpResult.body as Record<string, unknown> | null);
    if (message.includes("already") || message.includes("registered")) {
      throw new AlisioAccountCloudError(
        "email_in_use",
        "An Alisio account already exists for that email.",
      );
    }
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "Alisio could not create the account right now.",
    );
  }

  const signUpBody = signUpResult.body as SupabaseSessionResponse;
  if (!signUpBody.access_token?.trim()) {
    const userId = signUpBody.user?.id?.trim() || undefined;
    const joinedAt = signUpBody.user?.created_at?.trim() || new Date().toISOString();
    return {
      session: {
        backend: "supabase",
        state: "signed_out",
        authMethod: "email",
        ...(userId ? { userId } : {}),
        email,
        signedOutAt: new Date().toISOString(),
      },
      profile: mapSupabaseProfile(null, {
        userId,
        email,
        joinedAt,
        backend: "supabase",
      }),
    };
  }

  const resolvedSession = resolveSupabaseSession({
    body: signUpBody,
    fallbackEmail: email,
    authMethod: "email",
    errorCode: "backend_unavailable",
    errorMessage: "Alisio could not establish the new account session.",
  });
  const ensuredProfile = await ensureSupabaseProfile({
    config,
    accessToken: resolvedSession.accessToken,
    userId: resolvedSession.userId,
    email: resolvedSession.email,
    joinedAt: resolvedSession.joinedAt,
    fetchImpl,
  });

  return {
    session: buildStoredSupabaseSession(resolvedSession),
    profile: ensuredProfile,
  };
}

export async function signInAlisioCloudAccount(params: {
  email: string;
  password: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  session: AlisioStoredCloudSession;
  profile: AlisioCloudAccountProfile;
}> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const email = params.email.trim().toLowerCase();

  const config = resolveSupabaseConfig(env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const sessionResult = await signInWithSupabasePassword({
    config,
    email,
    password: params.password,
    fetchImpl,
  });
  const resolvedSession = resolveSupabaseSession({
    body: sessionResult,
    fallbackEmail: email,
    authMethod: "email",
    errorCode: "backend_unavailable",
    errorMessage: "Alisio could not establish the Alisio account session.",
  });
  const profile = await ensureSupabaseProfile({
    config,
    accessToken: resolvedSession.accessToken,
    userId: resolvedSession.userId,
    email: resolvedSession.email,
    joinedAt: resolvedSession.joinedAt,
    fetchImpl,
  });

  return {
    session: buildStoredSupabaseSession(resolvedSession),
    profile,
  };
}

export async function restoreAlisioCloudAccountSession(params: {
  session: AlisioStoredCloudSession;
  profile: AlisioCloudAccountProfile;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  session: AlisioStoredCloudSession;
  profile: AlisioCloudAccountProfile;
}> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  if (params.session.state !== "signed_in") {
    return params;
  }
  const config = resolveSupabaseConfig(env);
  if (!config) {
    return {
      session: resolveSignedOutCloudSession(params.session),
      profile: {
        ...params.profile,
        profileCompleted: false,
      },
    };
  }

  const now = Date.now();
  let session = { ...params.session };
  const expiresAtMs = session.expiresAt ? Date.parse(session.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAtMs) && expiresAtMs - now <= 60_000) {
    if (!session.refreshToken) {
      throw new AlisioAccountCloudError(
        "session_refresh_failed",
        "The Alisio account session expired and needs a new sign-in.",
      );
    }
    const url = new URL("/auth/v1/token?grant_type=refresh_token", config.url);
    const refreshResult = await fetchJson(
      url.toString(),
      {
        method: "POST",
        headers: supabaseHeaders(config),
        body: JSON.stringify({
          refresh_token: session.refreshToken,
        }),
      },
      fetchImpl,
    );
    if (!refreshResult.ok) {
      throw new AlisioAccountCloudError(
        "session_refresh_failed",
        "The Alisio account session expired and needs a new sign-in.",
      );
    }
    const resolvedSession = resolveSupabaseSession({
      body: refreshResult.body as SupabaseSessionResponse,
      fallbackEmail: session.email ?? params.profile.email,
      authMethod: session.authMethod ?? "email",
      errorCode: "session_refresh_failed",
      errorMessage: "The Alisio account session expired and needs a new sign-in.",
    });
    session = {
      ...session,
      accessToken: resolvedSession.accessToken,
      refreshToken: resolvedSession.refreshToken ?? session.refreshToken,
      tokenType: resolvedSession.tokenType ?? session.tokenType,
      expiresAt: resolvedSession.expiresAt ?? session.expiresAt,
      email: resolvedSession.email,
      userId: resolvedSession.userId,
    };
  }

  const user = await fetchSupabaseUser({
    config,
    accessToken: session.accessToken ?? "",
    fetchImpl,
  });
  const profile = await ensureSupabaseProfile({
    config,
    accessToken: session.accessToken ?? "",
    userId: user.id ?? session.userId ?? "",
    email: user.email ?? session.email ?? params.profile.email,
    joinedAt: user.created_at ?? params.profile.joinedAt,
    fetchImpl,
  });

  return {
    session: {
      ...session,
      userId: user.id ?? session.userId,
      email: user.email ?? session.email,
    },
    profile,
  };
}

export async function completeAlisioCloudAccountEmailLinkAuth(params: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  session: AlisioStoredCloudSession;
  profile: AlisioCloudAccountProfile;
}> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const accessToken = params.accessToken.trim();
  if (!accessToken) {
    throw new AlisioAccountCloudError(
      "email_verification_failed",
      "Alisio could not complete that sign-in link.",
    );
  }

  const config = resolveSupabaseConfig(env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  let sessionAccessToken = accessToken;
  let sessionRefreshToken = params.refreshToken?.trim() || undefined;
  let sessionTokenType = params.tokenType?.trim() || undefined;
  let sessionExpiresAt =
    typeof params.expiresIn === "number" && Number.isFinite(params.expiresIn)
      ? new Date(Date.now() + params.expiresIn * 1000).toISOString()
      : undefined;

  let user: SupabaseUserResponse;
  try {
    user = await fetchSupabaseUser({
      config,
      accessToken: sessionAccessToken,
      fetchImpl,
    });
  } catch (error) {
    if (!(error instanceof AlisioAccountCloudError) || error.code !== "session_refresh_failed") {
      throw error;
    }
    if (!sessionRefreshToken) {
      throw error;
    }
    const refreshedSession = await refreshSupabaseLinkSession({
      config,
      refreshToken: sessionRefreshToken,
      tokenType: sessionTokenType,
      fetchImpl,
    });
    sessionAccessToken = refreshedSession.accessToken;
    sessionRefreshToken = refreshedSession.refreshToken;
    sessionTokenType = refreshedSession.tokenType;
    sessionExpiresAt = refreshedSession.expiresAt;
    user = await fetchSupabaseUser({
      config,
      accessToken: sessionAccessToken,
      fetchImpl,
    });
  }

  const userId = user.id?.trim() || "";
  const email = user.email?.trim().toLowerCase() || "";
  if (!userId || !email) {
    throw new AlisioAccountCloudError(
      "email_verification_failed",
      "Alisio could not complete that sign-in link.",
    );
  }

  const joinedAt = user.created_at?.trim() || new Date().toISOString();
  const profile = await ensureSupabaseProfile({
    config,
    accessToken: sessionAccessToken,
    userId,
    email,
    joinedAt,
    fetchImpl,
  });

  return {
    session: buildStoredSupabaseSession({
      accessToken: sessionAccessToken,
      refreshToken: sessionRefreshToken,
      expiresAt: sessionExpiresAt,
      tokenType: sessionTokenType,
      authMethod: "email",
      userId,
      email,
      joinedAt,
    }),
    profile,
  };
}

export async function completeAlisioCloudAccountProfile(
  params: CompleteProfileParams & {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  },
): Promise<AlisioCloudAccountProfile> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;

  const config = resolveSupabaseConfig(env);
  if (!config || !params.session.accessToken || !params.session.userId) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const profileEmail =
    params.session.email?.trim().toLowerCase() || params.email.trim().toLowerCase();
  const payload = {
    user_id: params.session.userId,
    email: profileEmail,
    display_name: params.displayName.trim(),
    username: normalizeAlisioUsername(params.username),
    agent_name: normalizeAlisioAgentName(params.agentName) ?? null,
    avatar_url: params.avatarUrl?.trim() || null,
    avatar_label: deriveAlisioAvatarLabel({
      avatarLabel: params.avatarLabel,
      displayName: params.displayName,
      username: params.username,
    }),
    terms_accepted_at: params.termsAcceptedAt?.trim() || null,
    marketing_opt_in: params.marketingOptIn === true,
    birthdate: normalizeAlisioBirthdate(params.birthdate) ?? null,
    joined_at: params.joinedAt,
    plan: normalizeAlisioPlan(params.plan),
    profile_completed: true,
  };
  const row = await writeSupabaseProfile({
    config,
    accessToken: params.session.accessToken,
    payload,
    fetchImpl,
  });
  return mapSupabaseProfile(row, {
    userId: params.session.userId,
    email: profileEmail,
    joinedAt: params.joinedAt,
    backend: "supabase",
  });
}

export async function signOutAlisioCloudAccount(params: {
  session: AlisioStoredCloudSession;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}) {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  if (params.session.backend === "supabase") {
    const config = resolveSupabaseConfig(env);
    if (config && params.session.accessToken) {
      const url = new URL("/auth/v1/logout", config.url);
      await fetchImpl(url.toString(), {
        method: "POST",
        headers: supabaseHeaders(config, params.session.accessToken),
      }).catch(() => undefined);
    }
  }
}

export async function requestAlisioCloudPasswordReset(params: {
  email: string;
  callbackUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ message: string; ok: true }> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const email = params.email.trim().toLowerCase();
  if (!email) {
    throw new AlisioAccountCloudError(
      "password_reset_failed",
      "Enter the email for the Alisio account first.",
    );
  }

  const config = resolveSupabaseConfig(env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const url = new URL("/auth/v1/recover", config.url);
  if (params.callbackUrl?.trim()) {
    url.searchParams.set("redirect_to", params.callbackUrl.trim());
  }
  const result = await fetchJson(
    url.toString(),
    {
      method: "POST",
      headers: supabaseHeaders(config),
      body: JSON.stringify({
        email,
      }),
    },
    fetchImpl,
  );
  if (!result.ok) {
    throw new AlisioAccountCloudError(
      "password_reset_failed",
      buildSupabaseRequestFailureMessage({
        status: result.status,
        body: result.body as Record<string, unknown> | null,
        fallbackMessage: "Alisio could not start account recovery right now.",
      }),
    );
  }
  return {
    ok: true,
    message: "If this Alisio account exists, a recovery email is on its way.",
  };
}

export async function requestAlisioCloudAccountEmailChange(params: {
  session: AlisioStoredCloudSession;
  email: string;
  callbackUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ message: string; ok: true }> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const email = params.email.trim().toLowerCase();
  if (!email) {
    throw new AlisioAccountCloudError(
      "email_change_failed",
      "Enter the new email address for this Alisio account first.",
    );
  }

  const config = resolveSupabaseConfig(env);
  if (!config || !params.session.accessToken) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const url = new URL("/auth/v1/user", config.url);
  if (params.callbackUrl?.trim()) {
    url.searchParams.set("redirect_to", params.callbackUrl.trim());
  }
  const result = await fetchJson(
    url.toString(),
    {
      method: "PUT",
      headers: supabaseHeaders(config, params.session.accessToken),
      body: JSON.stringify({
        email,
      }),
    },
    fetchImpl,
  );
  if (!result.ok) {
    const message = readSupabaseErrorText(result.body as Record<string, unknown> | null);
    if (message.includes("already") || message.includes("registered")) {
      throw new AlisioAccountCloudError(
        "email_in_use",
        "An Alisio account already exists for that email.",
      );
    }
    throw new AlisioAccountCloudError(
      "email_change_failed",
      buildSupabaseRequestFailureMessage({
        status: result.status,
        body: result.body as Record<string, unknown> | null,
        fallbackMessage: "Alisio could not start the email change right now.",
      }),
    );
  }

  return {
    ok: true,
    message: "Check your new email inbox to confirm the change.",
  };
}

export async function updateAlisioCloudAccountPassword(params: {
  session: AlisioStoredCloudSession;
  password: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ message: string; ok: true }> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const password = params.password;
  if (!password) {
    throw new AlisioAccountCloudError(
      "password_update_failed",
      "Enter a new password for this Alisio account first.",
    );
  }

  const config = resolveSupabaseConfig(env);
  if (!config || !params.session.accessToken) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const url = new URL("/auth/v1/user", config.url);
  const result = await fetchJson(
    url.toString(),
    {
      method: "PUT",
      headers: supabaseHeaders(config, params.session.accessToken),
      body: JSON.stringify({
        password,
      }),
    },
    fetchImpl,
  );
  if (!result.ok) {
    const message = readSupabaseErrorText(result.body as Record<string, unknown> | null);
    if (message.includes("reauthentication") || message.includes("nonce")) {
      throw new AlisioAccountCloudError(
        "password_update_failed",
        "Alisio needs you to reauthenticate before updating the password.",
      );
    }
    throw new AlisioAccountCloudError(
      "password_update_failed",
      "Alisio could not update the password right now.",
    );
  }

  return {
    ok: true,
    message: "Your Alisio password was updated.",
  };
}
