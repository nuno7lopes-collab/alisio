import {
  coerceSecretRef,
  loadConfig,
  resolveConfiguredSecretInputString,
} from "alisio/plugin-sdk/config-runtime";
import type { BrowserSessionAuthMethod } from "./browser-action.types.js";
import type { BrowserSessionAuthCache } from "./browser-session-auth-cache.js";
import type { BrowserFormField } from "./client-actions-core.js";

type BrowserSecretRefInput = {
  source: "env" | "file" | "exec";
  provider: string;
  id: string;
};

type BrowserFieldWithSecret = BrowserFormField & {
  valueRef?: BrowserSecretRefInput;
};

type BrowserAuthOriginState = {
  cookies: boolean;
  localStorage: boolean;
  sessionStorage: boolean;
};

export type BrowserAuthSummary = {
  status: "primed" | "reused";
  method: BrowserSessionAuthMethod;
  origin?: string | null;
  fields?: number;
};

export type BrowserResolvedTypeInput = {
  text?: string;
  skipped?: boolean;
  auth?: BrowserAuthSummary;
};

export type BrowserResolvedFormFill = {
  fields: BrowserFormField[];
  auth?: BrowserAuthSummary;
};

export type BrowserResolvedHttpCredentials = {
  username?: string;
  password?: string;
  clear: boolean;
  auth?: BrowserAuthSummary;
};

function normalizeOrigin(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    return url.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizeSecretRefInput(value: unknown): BrowserSecretRefInput | undefined {
  const ref = coerceSecretRef(value);
  if (!ref) {
    return undefined;
  }
  return {
    source: ref.source,
    provider: ref.provider,
    id: ref.id,
  };
}

function hasSecretRef(value: unknown): boolean {
  return Boolean(normalizeSecretRefInput(value));
}

async function resolveSecretString(params: {
  value: unknown;
  path: string;
}): Promise<string | undefined> {
  const ref = normalizeSecretRefInput(params.value);
  if (!ref) {
    return undefined;
  }
  const cfg = loadConfig();
  const resolved = await resolveConfiguredSecretInputString({
    config: cfg,
    env: process.env,
    value: ref,
    path: params.path,
    unresolvedReasonStyle: "detailed",
  });
  if (resolved.value) {
    return resolved.value;
  }
  throw new Error(resolved.unresolvedRefReason ?? `${params.path} SecretRef is unresolved.`);
}

function coerceStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function countTruthyValues(values: Record<string, string>): number {
  return Object.keys(values).length;
}

export function createBrowserAuthBroker(params: {
  authCache: BrowserSessionAuthCache;
  now?: () => number;
}) {
  const now = params.now ?? Date.now;

  const maybeWriteAuthCache = (input: {
    sessionKey?: string;
    origin?: string;
    status: "primed" | "reused";
    method: BrowserSessionAuthMethod;
    fields?: number;
  }): BrowserAuthSummary | undefined => {
    const sessionKey = input.sessionKey?.trim();
    const origin = normalizeOrigin(input.origin);
    if (!sessionKey || !origin) {
      return undefined;
    }
    params.authCache.write({
      sessionKey,
      origin,
      status: input.status,
      method: input.method,
      updatedAt: now(),
      fields: input.fields,
    });
    return {
      status: input.status,
      method: input.method,
      origin,
      fields: input.fields,
    };
  };

  const resolveReusableAuthState = async (input: {
    sessionKey?: string;
    origin?: string;
    inspectSessionState?: () => Promise<BrowserAuthOriginState>;
  }): Promise<BrowserAuthSummary | undefined> => {
    const sessionKey = input.sessionKey?.trim();
    const origin = normalizeOrigin(input.origin);
    if (!sessionKey || !origin || !input.inspectSessionState) {
      return undefined;
    }
    const cached = params.authCache.read(sessionKey, origin);
    const inspected = await input.inspectSessionState();
    const hasReusableState =
      inspected.cookies || inspected.localStorage || inspected.sessionStorage;
    if (!hasReusableState) {
      return undefined;
    }
    const inspectedFieldCount =
      Number(inspected.cookies) + Number(inspected.localStorage) + Number(inspected.sessionStorage);
    if (cached?.status === "reused") {
      return {
        status: "reused",
        method: "reused-session",
        origin,
        fields: cached.fields ?? inspectedFieldCount,
      };
    }
    return maybeWriteAuthCache({
      sessionKey,
      origin,
      status: "reused",
      method: "reused-session",
      fields: inspectedFieldCount,
    });
  };

  return {
    async resolveTypeInput(input: {
      text: unknown;
      textRef?: unknown;
      preferReuseSession?: boolean;
      sessionKey?: string;
      origin?: string;
      inspectSessionState?: () => Promise<BrowserAuthOriginState>;
    }): Promise<BrowserResolvedTypeInput> {
      if (input.preferReuseSession) {
        const reused = await resolveReusableAuthState(input);
        if (reused) {
          return { skipped: true, auth: reused };
        }
      }
      const resolvedRef = await resolveSecretString({
        value: input.textRef ?? input.text,
        path: "browser act:type text",
      });
      const text = resolvedRef ?? coerceStringValue(input.text);
      if (text === undefined) {
        throw new Error("text is required");
      }
      const auth = hasSecretRef(input.textRef ?? input.text)
        ? maybeWriteAuthCache({
            sessionKey: input.sessionKey,
            origin: input.origin,
            status: "primed",
            method: "blind-fill",
            fields: 1,
          })
        : undefined;
      return { text, auth };
    },

    async resolveFormFill(input: {
      fields: BrowserFieldWithSecret[];
      preferReuseSession?: boolean;
      sessionKey?: string;
      origin?: string;
      inspectSessionState?: () => Promise<BrowserAuthOriginState>;
    }): Promise<BrowserResolvedFormFill> {
      const secretFields = input.fields.filter((field) =>
        hasSecretRef(field.valueRef ?? field.value),
      );
      const preferReuse = input.preferReuseSession === true && secretFields.length > 0;
      const reused = preferReuse ? await resolveReusableAuthState(input) : undefined;
      const resolvedFields: BrowserFormField[] = [];

      for (const field of input.fields) {
        const usesSecret = hasSecretRef(field.valueRef ?? field.value);
        if (reused && usesSecret) {
          continue;
        }
        const resolvedValue = await resolveSecretString({
          value: field.valueRef ?? field.value,
          path: `browser act:fill fields[${field.ref}]`,
        });
        if (resolvedValue !== undefined) {
          resolvedFields.push({ ref: field.ref, type: field.type, value: resolvedValue });
          continue;
        }
        resolvedFields.push({
          ref: field.ref,
          type: field.type,
          ...(field.value !== undefined ? { value: field.value } : {}),
        });
      }

      if (reused) {
        return { fields: resolvedFields, auth: reused };
      }

      const auth = secretFields.length
        ? maybeWriteAuthCache({
            sessionKey: input.sessionKey,
            origin: input.origin,
            status: "primed",
            method: "blind-fill",
            fields: secretFields.length,
          })
        : undefined;
      return { fields: resolvedFields, auth };
    },

    async resolveHttpCredentials(input: {
      username?: unknown;
      usernameRef?: unknown;
      password?: unknown;
      passwordRef?: unknown;
      clear?: boolean;
      sessionKey?: string;
      origin?: string;
    }): Promise<BrowserResolvedHttpCredentials> {
      const clear = input.clear === true;
      if (clear) {
        return { clear: true };
      }
      const username =
        (await resolveSecretString({
          value: input.usernameRef ?? input.username,
          path: "browser set:credentials username",
        })) ?? coerceStringValue(input.username);
      const password =
        (await resolveSecretString({
          value: input.passwordRef ?? input.password,
          path: "browser set:credentials password",
        })) ?? coerceStringValue(input.password);
      const auth =
        hasSecretRef(input.usernameRef ?? input.username) ||
        hasSecretRef(input.passwordRef ?? input.password)
          ? maybeWriteAuthCache({
              sessionKey: input.sessionKey,
              origin: input.origin,
              status: "primed",
              method: "http-credentials",
              fields: Number(Boolean(username)) + Number(Boolean(password)),
            })
          : undefined;
      return {
        clear: false,
        username,
        password,
        auth,
      };
    },

    markCookieAuth(input: {
      sessionKey?: string;
      origin?: string;
    }): BrowserAuthSummary | undefined {
      return maybeWriteAuthCache({
        sessionKey: input.sessionKey,
        origin: input.origin,
        status: "primed",
        method: "cookies",
        fields: 1,
      });
    },

    markStorageAuth(input: {
      sessionKey?: string;
      origin?: string;
      key?: string;
      values?: Record<string, string>;
    }): BrowserAuthSummary | undefined {
      const key = input.key?.trim().toLowerCase() || "";
      const values = input.values ?? {};
      const looksAuthLike =
        key.includes("token") ||
        key.includes("session") ||
        key.includes("auth") ||
        key.includes("bearer") ||
        key.includes("csrf") ||
        countTruthyValues(values) > 0;
      if (!looksAuthLike) {
        return undefined;
      }
      return maybeWriteAuthCache({
        sessionKey: input.sessionKey,
        origin: input.origin,
        status: "primed",
        method: "storage",
        fields: key ? 1 : countTruthyValues(values),
      });
    },
  };
}
