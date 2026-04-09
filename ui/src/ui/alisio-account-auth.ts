import {
  ALISIO_ACCOUNT_AUTH_CHANNEL,
  ALISIO_ACCOUNT_AUTH_STORAGE_KEY,
  buildAlisioAccountAuthSignal,
  isAlisioAccountAuthSignal,
  type AlisioAccountAuthSignal,
} from "../../../src/shared/alisio-account-auth.js";
import { connectGateway } from "./app-gateway.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";

type AccountAuthReconnectHost = Parameters<typeof loadControlUiBootstrapConfig>[0] &
  Parameters<typeof connectGateway>[0];

type AccountAuthSignalHandler = (signal: AlisioAccountAuthSignal) => void;

const ACCOUNT_AUTH_SENSITIVE_PARAM_NAMES = [
  "access_token",
  "refresh_token",
  "expires_in",
  "token_type",
  "provider_token",
  "provider_refresh_token",
  "sb",
] as const;

const ACCOUNT_AUTH_ERROR_PARAM_NAMES = ["error", "error_code", "error_description"] as const;
const ACCOUNT_AUTH_TYPE_VALUES = new Set([
  "magiclink",
  "signup",
  "recovery",
  "invite",
  "email_change",
]);

export type AlisioAccountEmailLinkAuthType =
  | "magiclink"
  | "signup"
  | "recovery"
  | "invite"
  | "email_change";

export type AlisioAccountEmailLinkAuthResult =
  | {
      kind: "success";
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
      tokenType?: string;
      authType?: AlisioAccountEmailLinkAuthType;
    }
  | {
      kind: "error";
      message: string;
    };

function parseAccountAuthSignal(raw: unknown): AlisioAccountAuthSignal | null {
  if (isAlisioAccountAuthSignal(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isAlisioAccountAuthSignal(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readUrlParams(rawUrl: string) {
  const url = new URL(rawUrl, "http://localhost/");
  return {
    url,
    searchParams: new URLSearchParams(url.search),
    hashParams: new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash),
  };
}

function readParam(
  hashParams: URLSearchParams,
  searchParams: URLSearchParams,
  name:
    | (typeof ACCOUNT_AUTH_SENSITIVE_PARAM_NAMES)[number]
    | (typeof ACCOUNT_AUTH_ERROR_PARAM_NAMES)[number]
    | "type",
) {
  return hashParams.get(name) ?? searchParams.get(name);
}

function normalizeAccountEmailLinkErrorMessage(
  error: string | null,
  errorCode: string | null,
  errorDescription: string | null,
) {
  const normalizedDescription = errorDescription?.trim() ?? "";
  if (
    errorCode?.trim().toLowerCase() === "otp_expired" ||
    /invalid or has expired/i.test(normalizedDescription)
  ) {
    return "The sign-in link is invalid or has expired. Request a new email and try again.";
  }
  if (normalizedDescription) {
    return normalizedDescription;
  }
  if ((error ?? "").trim().toLowerCase() === "access_denied") {
    return "The sign-in link was denied before it completed. Request a new email and try again.";
  }
  return "Alisio could not complete that sign-in link. Request a new email and try again.";
}

export function readAlisioAccountEmailLinkAuthResultFromUrl(
  rawUrl: string,
): AlisioAccountEmailLinkAuthResult | null {
  const { searchParams, hashParams } = readUrlParams(rawUrl);
  const authType = readParam(hashParams, searchParams, "type")?.trim().toLowerCase() ?? "";
  const accessToken = readParam(hashParams, searchParams, "access_token")?.trim() ?? "";
  if (accessToken) {
    const expiresInRaw = readParam(hashParams, searchParams, "expires_in")?.trim() ?? "";
    const expiresIn = Number.parseInt(expiresInRaw, 10);
    return {
      kind: "success",
      accessToken,
      refreshToken: readParam(hashParams, searchParams, "refresh_token")?.trim() || undefined,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
      tokenType: readParam(hashParams, searchParams, "token_type")?.trim() || undefined,
      ...(ACCOUNT_AUTH_TYPE_VALUES.has(authType)
        ? { authType: authType as AlisioAccountEmailLinkAuthType }
        : {}),
    };
  }

  const error = readParam(hashParams, searchParams, "error");
  const errorCode = readParam(hashParams, searchParams, "error_code");
  const errorDescription = readParam(hashParams, searchParams, "error_description");
  if (errorCode || (ACCOUNT_AUTH_TYPE_VALUES.has(authType) && (error || errorDescription))) {
    return {
      kind: "error",
      message: normalizeAccountEmailLinkErrorMessage(error, errorCode, errorDescription),
    };
  }

  return null;
}

function hasSensitiveAccountAuthParam(params: URLSearchParams) {
  return ACCOUNT_AUTH_SENSITIVE_PARAM_NAMES.some((name) => Boolean(params.get(name)?.trim()));
}

function clearAuthParams(params: URLSearchParams, opts?: { clearErrorParams?: boolean }) {
  for (const name of ACCOUNT_AUTH_SENSITIVE_PARAM_NAMES) {
    params.delete(name);
  }
  const authType = params.get("type")?.trim().toLowerCase() ?? "";
  const hasTypedAuthError =
    ACCOUNT_AUTH_TYPE_VALUES.has(authType) &&
    (Boolean(params.get("error")?.trim()) || Boolean(params.get("error_description")?.trim()));
  const shouldClearErrorParams =
    opts?.clearErrorParams === true || Boolean(params.get("error_code")) || hasTypedAuthError;
  if (ACCOUNT_AUTH_TYPE_VALUES.has(authType) && shouldClearErrorParams) {
    params.delete("type");
  }
  if (shouldClearErrorParams) {
    for (const name of ACCOUNT_AUTH_ERROR_PARAM_NAMES) {
      params.delete(name);
    }
  }
}

export function clearAlisioAccountEmailLinkAuthFromUrl(rawUrl: string): string {
  const { url, searchParams, hashParams } = readUrlParams(rawUrl);
  const clearErrorParams =
    hasSensitiveAccountAuthParam(searchParams) || hasSensitiveAccountAuthParam(hashParams);
  clearAuthParams(searchParams, { clearErrorParams });
  clearAuthParams(hashParams, { clearErrorParams });
  url.search = searchParams.toString() ? `?${searchParams.toString()}` : "";
  url.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";
  return url.toString();
}

export function resolveAlisioAccountEmailRedirectUrl(pageHref?: string): string {
  const currentPageHref =
    pageHref ?? (typeof window === "undefined" ? "http://localhost/" : window.location.href);
  return clearAlisioAccountEmailLinkAuthFromUrl(currentPageHref);
}

export function emitAlisioAccountAuthSignal(
  signal = buildAlisioAccountAuthSignal("email"),
): AlisioAccountAuthSignal {
  if (typeof window === "undefined") {
    return signal;
  }

  const serialized = JSON.stringify(signal);
  try {
    window.localStorage.setItem(ALISIO_ACCOUNT_AUTH_STORAGE_KEY, serialized);
    window.localStorage.removeItem(ALISIO_ACCOUNT_AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage failures; BroadcastChannel still covers modern clients.
  }

  try {
    if (typeof window.BroadcastChannel === "function") {
      const channel = new BroadcastChannel(ALISIO_ACCOUNT_AUTH_CHANNEL);
      channel.postMessage(signal);
      channel.close();
    }
  } catch {
    // Ignore broadcast failures; storage events cover same-origin tabs.
  }

  return signal;
}

export function subscribeAlisioAccountAuthSignals(onSignal: AccountAuthSignalHandler): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  let lastSignalId: string | null = null;
  const handleSignal = (raw: unknown) => {
    const signal = parseAccountAuthSignal(raw);
    if (!signal || signal.signalId === lastSignalId) {
      return;
    }
    lastSignalId = signal.signalId;
    onSignal(signal);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== ALISIO_ACCOUNT_AUTH_STORAGE_KEY) {
      return;
    }
    if (!event.newValue) {
      return;
    }
    handleSignal(event.newValue);
  };

  const channel =
    typeof window.BroadcastChannel === "function"
      ? new BroadcastChannel(ALISIO_ACCOUNT_AUTH_CHANNEL)
      : null;
  const handleMessage = (event: MessageEvent<unknown>) => {
    handleSignal(event.data);
  };

  window.addEventListener("storage", handleStorage);
  channel?.addEventListener("message", handleMessage as EventListener);
  try {
    handleSignal(window.localStorage.getItem(ALISIO_ACCOUNT_AUTH_STORAGE_KEY));
  } catch {
    // Ignore storage access failures.
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.removeEventListener("message", handleMessage as EventListener);
    channel?.close();
  };
}

export async function refreshAfterAlisioAccountAuth(host: AccountAuthReconnectHost): Promise<void> {
  await loadControlUiBootstrapConfig(host);
  connectGateway(host);
}
