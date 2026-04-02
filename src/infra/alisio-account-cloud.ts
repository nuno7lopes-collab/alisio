import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { deriveAlisioAvatarLabel, normalizeAlisioUsername } from "../shared/alisio-account.js";

export type AlisioAccountBackend = "supabase" | "local-dev";

export type AlisioStoredPasswordCredential = {
  email: string;
  salt: string;
  hash: string;
};

export type AlisioStoredCloudSession = {
  backend: AlisioAccountBackend;
  state: "signed_out" | "signed_in";
  userId?: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
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
  avatarLabel: string;
  avatarUrl?: string;
  joinedAt: string;
  plan: string;
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
    | "password_reset_failed";

  constructor(
    code:
      | "backend_unavailable"
      | "invalid_credentials"
      | "email_in_use"
      | "username_taken"
      | "profile_write_failed"
      | "session_refresh_failed"
      | "password_reset_failed",
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
  avatar_url?: string;
  avatar_label?: string;
  joined_at?: string;
  plan?: string;
  profile_completed?: boolean;
};

type CompleteProfileParams = {
  session: AlisioStoredCloudSession;
  email: string;
  username: string;
  displayName: string;
  avatarLabel: string;
  avatarUrl?: string;
  joinedAt: string;
  plan: string;
};

function resolveSupabaseConfig(env: NodeJS.ProcessEnv): SupabaseConfig | null {
  const url = env.ALISIO_SUPABASE_URL?.trim() || "";
  const anonKey = env.ALISIO_SUPABASE_ANON_KEY?.trim() || "";
  if (!url || !anonKey) {
    return null;
  }
  return {
    url: url.replace(/\/+$/, ""),
    anonKey,
    profilesTable: env.ALISIO_SUPABASE_PROFILES_TABLE?.trim() || "alisio_profiles",
  };
}

export function resolveAlisioAccountBackend(
  env: NodeJS.ProcessEnv = process.env,
): AlisioAccountBackend {
  return resolveSupabaseConfig(env) ? "supabase" : "local-dev";
}

function defaultProfileSeed(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const rawName = normalizedEmail.split("@", 1)[0] || "alisio";
  const username = normalizeAlisioUsername(rawName).replace(/[^a-z0-9._]+/g, "") || "alisio";
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

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function buildPasswordCredential(email: string, password: string): AlisioStoredPasswordCredential {
  const salt = randomBytes(16).toString("hex");
  return {
    email: email.trim().toLowerCase(),
    salt,
    hash: hashPassword(password, salt),
  };
}

export function verifyPasswordCredential(
  credential: AlisioStoredPasswordCredential | undefined,
  email: string,
  password: string,
) {
  if (!credential) {
    return false;
  }
  if (credential.email !== email.trim().toLowerCase()) {
    return false;
  }
  const candidate = hashPassword(password, credential.salt);
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(credential.hash, "hex"));
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
    avatarLabel:
      row?.avatar_label?.trim().slice(0, 2).toUpperCase() ||
      deriveAlisioAvatarLabel({
        avatarLabel: row?.avatar_label,
        displayName: row?.display_name || seed.displayName,
        username: row?.username || seed.username,
      }),
    avatarUrl: row?.avatar_url?.trim() || undefined,
    joinedAt: row?.joined_at?.trim() || fallback.joinedAt,
    plan: row?.plan?.trim() || "Free Plan",
    profileCompleted: Boolean(row?.profile_completed),
    backend: fallback.backend,
  };
}

function readSupabaseErrorText(body: Record<string, unknown> | null | undefined): string {
  const candidates = [body?.msg, body?.error_description, body?.message, body?.hint];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }
  return "";
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
  url.searchParams.set(
    "select",
    [
      "user_id",
      "email",
      "display_name",
      "username",
      "avatar_url",
      "avatar_label",
      "joined_at",
      "plan",
      "profile_completed",
    ].join(","),
  );
  const result = await fetchJson(
    url.toString(),
    {
      method: "GET",
      headers: supabaseHeaders(params.config, params.accessToken),
    },
    params.fetchImpl,
  );
  const body = Array.isArray(result.body) ? result.body[0] : null;
  return mapSupabaseProfile(body, {
    userId: params.userId,
    email: params.fallbackEmail,
    joinedAt: params.fallbackJoinedAt,
    backend: "supabase",
  });
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

export async function signUpAlisioCloudAccount(params: {
  email: string;
  password: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  session: AlisioStoredCloudSession;
  profile: AlisioCloudAccountProfile;
  localPasswordCredential?: AlisioStoredPasswordCredential;
}> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const email = params.email.trim().toLowerCase();
  const backend = resolveAlisioAccountBackend(env);
  const joinedAt = new Date().toISOString();

  if (backend === "local-dev") {
    const seed = defaultProfileSeed(email);
    return {
      session: {
        backend,
        state: "signed_in",
        userId: createHash("sha256").update(email).digest("hex").slice(0, 24),
        email,
        signedInAt: joinedAt,
      },
      profile: {
        userId: createHash("sha256").update(email).digest("hex").slice(0, 24),
        email,
        displayName: seed.displayName,
        username: seed.username,
        avatarLabel: seed.avatarLabel,
        joinedAt,
        plan: "Free Plan",
        profileCompleted: false,
        backend,
      },
      localPasswordCredential: buildPasswordCredential(email, params.password),
    };
  }

  const config = resolveSupabaseConfig(env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const signUpUrl = new URL("/auth/v1/signup", config.url);
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

  const sessionResult = await signInWithSupabasePassword({
    config,
    email,
    password: params.password,
    fetchImpl,
  });
  const accessToken = sessionResult.access_token ?? "";
  const userId = sessionResult.user?.id ?? "";
  const joinedAtValue = sessionResult.user?.created_at ?? joinedAt;
  const profile = await fetchSupabaseProfile({
    config,
    accessToken,
    userId,
    fallbackEmail: sessionResult.user?.email ?? email,
    fallbackJoinedAt: joinedAtValue,
    fetchImpl,
  });

  return {
    session: {
      backend: "supabase",
      state: "signed_in",
      userId,
      email: sessionResult.user?.email ?? email,
      accessToken,
      refreshToken: sessionResult.refresh_token,
      expiresAt:
        typeof sessionResult.expires_in === "number"
          ? new Date(Date.now() + sessionResult.expires_in * 1000).toISOString()
          : undefined,
      tokenType: sessionResult.token_type,
      signedInAt: new Date().toISOString(),
    },
    profile,
  };
}

export async function signInAlisioCloudAccount(params: {
  email: string;
  password: string;
  localPasswordCredential?: AlisioStoredPasswordCredential;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  session: AlisioStoredCloudSession;
  profile: AlisioCloudAccountProfile;
}> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  const email = params.email.trim().toLowerCase();
  const backend = resolveAlisioAccountBackend(env);

  if (backend === "local-dev") {
    if (!verifyPasswordCredential(params.localPasswordCredential, email, params.password)) {
      throw new AlisioAccountCloudError(
        "invalid_credentials",
        "Invalid email or password for this Alisio account.",
      );
    }
    const seed = defaultProfileSeed(email);
    return {
      session: {
        backend,
        state: "signed_in",
        userId: createHash("sha256").update(email).digest("hex").slice(0, 24),
        email,
        signedInAt: new Date().toISOString(),
      },
      profile: {
        userId: createHash("sha256").update(email).digest("hex").slice(0, 24),
        email,
        displayName: seed.displayName,
        username: seed.username,
        avatarLabel: seed.avatarLabel,
        joinedAt: new Date().toISOString(),
        plan: "Free Plan",
        profileCompleted: false,
        backend,
      },
    };
  }

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
  const accessToken = sessionResult.access_token ?? "";
  const userId = sessionResult.user?.id ?? "";
  const profile = await fetchSupabaseProfile({
    config,
    accessToken,
    userId,
    fallbackEmail: sessionResult.user?.email ?? email,
    fallbackJoinedAt: sessionResult.user?.created_at ?? new Date().toISOString(),
    fetchImpl,
  });

  return {
    session: {
      backend: "supabase",
      state: "signed_in",
      userId,
      email: sessionResult.user?.email ?? email,
      accessToken,
      refreshToken: sessionResult.refresh_token,
      expiresAt:
        typeof sessionResult.expires_in === "number"
          ? new Date(Date.now() + sessionResult.expires_in * 1000).toISOString()
          : undefined,
      tokenType: sessionResult.token_type,
      signedInAt: new Date().toISOString(),
    },
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
  if (params.session.backend === "local-dev") {
    return params;
  }
  const config = resolveSupabaseConfig(env);
  if (!config) {
    return {
      session: {
        ...params.session,
        state: "signed_out",
        signedOutAt: new Date().toISOString(),
      },
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
    const body = refreshResult.body as SupabaseSessionResponse;
    session = {
      ...session,
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? session.refreshToken,
      tokenType: body.token_type ?? session.tokenType,
      expiresAt:
        typeof body.expires_in === "number"
          ? new Date(Date.now() + body.expires_in * 1000).toISOString()
          : session.expiresAt,
      email: body.user?.email ?? session.email,
      userId: body.user?.id ?? session.userId,
    };
  }

  const userUrl = new URL("/auth/v1/user", config.url);
  const userResult = await fetchJson(
    userUrl.toString(),
    {
      method: "GET",
      headers: supabaseHeaders(config, session.accessToken),
    },
    fetchImpl,
  );
  if (!userResult.ok) {
    throw new AlisioAccountCloudError(
      "session_refresh_failed",
      "The Alisio account session is no longer valid. Sign in again.",
    );
  }
  const user = userResult.body as SupabaseUserResponse;
  const profile = await fetchSupabaseProfile({
    config,
    accessToken: session.accessToken ?? "",
    userId: user.id ?? session.userId ?? "",
    fallbackEmail: user.email ?? session.email ?? params.profile.email,
    fallbackJoinedAt: user.created_at ?? params.profile.joinedAt,
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

export async function completeAlisioCloudAccountProfile(
  params: CompleteProfileParams & {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  },
): Promise<AlisioCloudAccountProfile> {
  const env = params.env ?? process.env;
  const fetchImpl = params.fetchImpl ?? fetch;
  if (params.session.backend === "local-dev") {
    return {
      userId: params.session.userId,
      email: params.email.trim().toLowerCase(),
      displayName: params.displayName.trim(),
      username: normalizeAlisioUsername(params.username),
      avatarLabel: deriveAlisioAvatarLabel({
        avatarLabel: params.avatarLabel,
        displayName: params.displayName,
        username: params.username,
      }),
      avatarUrl: params.avatarUrl?.trim() || undefined,
      joinedAt: params.joinedAt,
      plan: params.plan,
      profileCompleted: true,
      backend: "local-dev",
    };
  }

  const config = resolveSupabaseConfig(env);
  if (!config || !params.session.accessToken || !params.session.userId) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const url = new URL(`/rest/v1/${config.profilesTable}`, config.url);
  url.searchParams.set("on_conflict", "user_id");
  const payload = {
    user_id: params.session.userId,
    email: params.email.trim().toLowerCase(),
    display_name: params.displayName.trim(),
    username: normalizeAlisioUsername(params.username),
    avatar_url: params.avatarUrl?.trim() || null,
    avatar_label: deriveAlisioAvatarLabel({
      avatarLabel: params.avatarLabel,
      displayName: params.displayName,
      username: params.username,
    }),
    joined_at: params.joinedAt,
    plan: params.plan,
    profile_completed: true,
  };
  const result = await fetchJson(
    url.toString(),
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config, params.session.accessToken),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(payload),
    },
    fetchImpl,
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
  return mapSupabaseProfile(row, {
    userId: params.session.userId,
    email: payload.email,
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

  const backend = resolveAlisioAccountBackend(env);
  if (backend === "local-dev") {
    return {
      ok: true,
      message: "If this Alisio account exists, a password reset email is on its way.",
    };
  }

  const config = resolveSupabaseConfig(env);
  if (!config) {
    throw new AlisioAccountCloudError(
      "backend_unavailable",
      "The Alisio cloud account backend is not configured in this environment yet.",
    );
  }

  const url = new URL("/auth/v1/recover", config.url);
  const result = await fetchJson(
    url.toString(),
    {
      method: "POST",
      headers: supabaseHeaders(config),
      body: JSON.stringify({ email }),
    },
    fetchImpl,
  );
  if (!result.ok) {
    throw new AlisioAccountCloudError(
      "password_reset_failed",
      "Alisio could not start password recovery right now.",
    );
  }
  return {
    ok: true,
    message: "If this Alisio account exists, a password reset email is on its way.",
  };
}
