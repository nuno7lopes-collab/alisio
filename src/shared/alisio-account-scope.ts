export const ALISIO_ACCOUNT_SCOPE_ROOT = "account" as const;

export const ALISIO_BACKEND_SHARED_RESOURCES = [
  "account",
  "auth",
  "linked_devices",
  "session_index",
  "automations",
] as const;

export const ALISIO_LOCAL_RUNTIME_RESOURCES = [
  "identity",
  "soul",
  "preferences",
  "memory",
  "native_runtime",
] as const;

export type AlisioBackendSharedResource = (typeof ALISIO_BACKEND_SHARED_RESOURCES)[number];
export type AlisioLocalRuntimeResource = (typeof ALISIO_LOCAL_RUNTIME_RESOURCES)[number];

export type CanonicalAccountIdSource = "account_id" | "missing";

export type CanonicalAccountScope = {
  scopeRoot: typeof ALISIO_ACCOUNT_SCOPE_ROOT;
  accountId?: string;
  source: CanonicalAccountIdSource;
  authenticated: boolean;
  authRequired: true;
};

export type AccountDeviceBindingState = "auth_required" | "account_bound";

export type AccountDeviceBinding = {
  binding: AccountDeviceBindingState;
  runtime: "local";
  current: boolean;
  accountId?: string;
  deviceId?: string;
  label?: string;
  platform?: string;
};

export type AlisioDataResidencyContract = {
  scopeRoot: typeof ALISIO_ACCOUNT_SCOPE_ROOT;
  backendShared: AlisioBackendSharedResource[];
  localRuntime: AlisioLocalRuntimeResource[];
};

function normalizeCandidate(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return undefined;
  }
  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
}

export function normalizeCanonicalAccountId(value: string | null | undefined): string | undefined {
  return normalizeCandidate(value);
}

export function resolveCanonicalAccountScope(params: {
  authenticated: boolean;
  accountId?: string | null;
  accountUserId?: string | null;
  userId?: string | null;
  email?: string | null;
}): CanonicalAccountScope {
  if (!params.authenticated) {
    return {
      scopeRoot: ALISIO_ACCOUNT_SCOPE_ROOT,
      source: "missing",
      authenticated: false,
      authRequired: true,
    };
  }

  const candidates = [
    normalizeCandidate(params.accountId),
    normalizeCandidate(params.accountUserId),
    normalizeCandidate(params.userId),
    normalizeCandidate(params.email),
  ];

  const resolved = candidates.find(Boolean);
  return {
    scopeRoot: ALISIO_ACCOUNT_SCOPE_ROOT,
    source: resolved ? "account_id" : "missing",
    authenticated: true,
    authRequired: true,
    ...(resolved ? { accountId: resolved } : {}),
  };
}

export function buildAlisioDataResidencyContract(): AlisioDataResidencyContract {
  return {
    scopeRoot: ALISIO_ACCOUNT_SCOPE_ROOT,
    backendShared: [...ALISIO_BACKEND_SHARED_RESOURCES],
    localRuntime: [...ALISIO_LOCAL_RUNTIME_RESOURCES],
  };
}

export function buildAccountDeviceBinding(params: {
  authenticated: boolean;
  accountId?: string | null;
  deviceId?: string | null;
  label?: string | null;
  platform?: string | null;
  current?: boolean;
}): AccountDeviceBinding {
  const accountId = normalizeCanonicalAccountId(params.accountId);
  const boundAccountId = params.authenticated ? accountId : undefined;
  return {
    binding: params.authenticated && boundAccountId ? "account_bound" : "auth_required",
    runtime: "local",
    current: params.current !== false,
    ...(boundAccountId ? { accountId: boundAccountId } : {}),
    ...(normalizeCandidate(params.deviceId)
      ? { deviceId: normalizeCandidate(params.deviceId) }
      : {}),
    ...(normalizeCandidate(params.label) ? { label: normalizeCandidate(params.label) } : {}),
    ...(normalizeCandidate(params.platform)
      ? { platform: normalizeCandidate(params.platform) }
      : {}),
  };
}

export function slugifyAccountScopeSegment(value: string): string {
  const normalized = value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "account";
}

export function buildAccountWorkspaceScopeSegments(accountId: string): string[] {
  return ["accounts", slugifyAccountScopeSegment(accountId)];
}

export function isAccountScopedWorkspaceDir(
  workspaceDir: string,
  accountId?: string | null,
): boolean {
  const canonicalAccountId = normalizeCanonicalAccountId(accountId);
  if (!canonicalAccountId) {
    return false;
  }
  const normalizedSegments = workspaceDir.replace(/\\/g, "/").split("/").filter(Boolean);
  const scopeSegments = buildAccountWorkspaceScopeSegments(canonicalAccountId);
  if (normalizedSegments.length < scopeSegments.length) {
    return false;
  }
  const tail = normalizedSegments.slice(-scopeSegments.length);
  return scopeSegments.every((segment, index) => tail[index] === segment);
}
