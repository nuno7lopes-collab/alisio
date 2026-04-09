type SharingOwnerScope = "user" | "organization";
type SharingTargetSourceKind = "current" | "node";
type SharingScope = "read-only" | "model-use" | "exec" | "device.use" | "model.use";
type SharingRequestStatus = "pending" | "approved" | "denied" | "revoked" | "rejected";
type SharingResource =
  | "compute"
  | "models"
  | "jobs"
  | "artifacts"
  | "cache"
  | "memory"
  | "vault"
  | "files"
  | "context";
type SharingResourcePolicyMode = "paired-device" | "light-approval" | "explicit-consent";
type SharingAuditAction =
  | "policy.updated"
  | "request.created"
  | "request.approved"
  | "request.denied"
  | "grant.revoked"
  | "request.rejected";

export type AlisioSharingCloudPrincipal = {
  ownerKey: string;
  ownerScope: SharingOwnerScope;
  label: string;
  email?: string;
};

export type AlisioSharingCloudRuntimeTarget = {
  targetId: string;
  label: string;
  platform?: string;
  sourceKind: SharingTargetSourceKind;
  connected: boolean;
  current: boolean;
};

export type AlisioSharingCloudTargetRecord = AlisioSharingCloudRuntimeTarget & {
  ownerKey: string;
  ownerScope: SharingOwnerScope;
  ownerLabel: string;
  ownerEmail?: string;
  registeredAt: string;
  updatedAt: string;
};

export type AlisioSharingCloudRequestRecord = {
  requestId: string;
  targetId: string;
  targetLabel: string;
  targetPlatform?: string;
  targetSourceKind: SharingTargetSourceKind;
  requester: AlisioSharingCloudPrincipal;
  owner: AlisioSharingCloudPrincipal;
  scopes: SharingScope[];
  status: SharingRequestStatus;
  createdAt: string;
  resolvedAt?: string;
  grantId?: string;
};

export type AlisioSharingCloudGrantRecord = {
  grantId: string;
  requestId: string;
  targetId: string;
  targetLabel: string;
  targetPlatform?: string;
  targetSourceKind: SharingTargetSourceKind;
  owner: AlisioSharingCloudPrincipal;
  grantee: AlisioSharingCloudPrincipal;
  scopes: SharingScope[];
  approvedAt: string;
  revokedAt?: string;
};

export type AlisioSharingCloudAuditRecord = {
  entryId: string;
  action: SharingAuditAction;
  actor: AlisioSharingCloudPrincipal;
  targetId?: string;
  targetLabel?: string;
  requestId?: string;
  grantId?: string;
  summary: string;
  createdAt: string;
};

export type AlisioSharingCloudPolicyRecord = {
  ownerKey: string;
  allowExternalUse: boolean;
  resourcePolicies?: Partial<Record<SharingResource, SharingResourcePolicyMode>>;
  updatedAt: string;
  updatedBy: AlisioSharingCloudPrincipal;
};

export type AlisioSharingCloudState = {
  policies: Record<string, AlisioSharingCloudPolicyRecord>;
  targets: Record<string, AlisioSharingCloudTargetRecord>;
  requests: Record<string, AlisioSharingCloudRequestRecord>;
  grants: Record<string, AlisioSharingCloudGrantRecord>;
  audit: AlisioSharingCloudAuditRecord[];
};

type SupabaseSharingConfig = {
  url: string;
  anonKey: string;
  policiesTable: string;
  targetsTable: string;
  requestsTable: string;
  grantsTable: string;
  auditTable: string;
};

const DEFAULT_POLICIES_TABLE = "alisio_sharing_policies";
const DEFAULT_TARGETS_TABLE = "alisio_sharing_targets";
const DEFAULT_REQUESTS_TABLE = "alisio_sharing_requests";
const DEFAULT_GRANTS_TABLE = "alisio_sharing_grants";
const DEFAULT_AUDIT_TABLE = "alisio_sharing_audit";
const MAX_REMOTE_ROWS = 2000;

function resolveSupabaseClientKey(env: NodeJS.ProcessEnv) {
  return env.ALISIO_SUPABASE_ANON_KEY?.trim() || env.ALISIO_SUPABASE_PUBLISHABLE_KEY?.trim() || "";
}

function resolveSupabaseSharingConfig(env: NodeJS.ProcessEnv): SupabaseSharingConfig | null {
  const url = env.ALISIO_SUPABASE_URL?.trim() || "";
  const anonKey = resolveSupabaseClientKey(env);
  if (!url || !anonKey) {
    return null;
  }
  return {
    url: url.replace(/\/+$/, ""),
    anonKey,
    policiesTable: env.ALISIO_SUPABASE_SHARING_POLICIES_TABLE?.trim() || DEFAULT_POLICIES_TABLE,
    targetsTable: env.ALISIO_SUPABASE_SHARING_TARGETS_TABLE?.trim() || DEFAULT_TARGETS_TABLE,
    requestsTable: env.ALISIO_SUPABASE_SHARING_REQUESTS_TABLE?.trim() || DEFAULT_REQUESTS_TABLE,
    grantsTable: env.ALISIO_SUPABASE_SHARING_GRANTS_TABLE?.trim() || DEFAULT_GRANTS_TABLE,
    auditTable: env.ALISIO_SUPABASE_SHARING_AUDIT_TABLE?.trim() || DEFAULT_AUDIT_TABLE,
  };
}

function supabaseHeaders(config: SupabaseSharingConfig, accessToken: string) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

async function fetchJson(
  input: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetchImpl(input, init);
  const body = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function readErrorMessage(body: unknown) {
  if (!body || typeof body !== "object") {
    return "";
  }
  const record = body as Record<string, unknown>;
  for (const key of ["message", "hint", "details", "error_description", "msg"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function createRestUrl(
  config: SupabaseSharingConfig,
  table: string,
  params?: Record<string, string>,
) {
  const url = new URL(`/rest/v1/${table}`, config.url);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function getTableRows(
  config: SupabaseSharingConfig,
  table: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  params?: Record<string, string>,
) {
  const result = await fetchJson(
    createRestUrl(config, table, {
      select: "*",
      limit: String(MAX_REMOTE_ROWS),
      ...params,
    }).toString(),
    {
      method: "GET",
      headers: supabaseHeaders(config, accessToken),
    },
    fetchImpl,
  );
  if (!result.ok) {
    throw new Error(readErrorMessage(result.body) || `sharing table read failed (${table})`);
  }
  return Array.isArray(result.body) ? result.body : [];
}

async function upsertRows(
  config: SupabaseSharingConfig,
  table: string,
  accessToken: string,
  rows: unknown[],
  onConflict: string,
  fetchImpl: typeof fetch,
) {
  if (rows.length === 0) {
    return;
  }
  const result = await fetchJson(
    createRestUrl(config, table, {
      on_conflict: onConflict,
    }).toString(),
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config, accessToken),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
    fetchImpl,
  );
  if (!result.ok) {
    throw new Error(readErrorMessage(result.body) || `sharing table write failed (${table})`);
  }
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function normalizeResourcePolicyMode(value: unknown): SharingResourcePolicyMode | null {
  switch (value) {
    case "paired-device":
    case "light-approval":
    case "explicit-consent":
      return value;
    default:
      return null;
  }
}

function asResourcePolicies(
  value: unknown,
): Partial<Record<SharingResource, SharingResourcePolicyMode>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: Partial<Record<SharingResource, SharingResourcePolicyMode>> = {};
  for (const resource of [
    "compute",
    "models",
    "jobs",
    "artifacts",
    "cache",
    "memory",
    "vault",
    "files",
    "context",
  ] as const satisfies SharingResource[]) {
    const mode = normalizeResourcePolicyMode(record[resource]);
    if (mode) {
      result[resource] = mode;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function toPrincipal(
  prefix: string,
  row: Record<string, unknown>,
): AlisioSharingCloudPrincipal | null {
  const ownerKey = asString(row[`${prefix}_key`]);
  const ownerScope = row[`${prefix}_scope`];
  const label = asString(row[`${prefix}_label`]);
  if (!ownerKey || !label || (ownerScope !== "user" && ownerScope !== "organization")) {
    return null;
  }
  return {
    ownerKey,
    ownerScope,
    label,
    ...(asString(row[`${prefix}_email`]) ? { email: asString(row[`${prefix}_email`]) } : {}),
  };
}

function targetRowToRecord(row: Record<string, unknown>): AlisioSharingCloudTargetRecord | null {
  const targetId = asString(row.target_id);
  const label = asString(row.label);
  const sourceKind = row.source_kind;
  const owner = toPrincipal("owner", row);
  const registeredAt = asString(row.registered_at);
  const updatedAt = asString(row.updated_at);
  if (
    !targetId ||
    !label ||
    !owner ||
    !registeredAt ||
    !updatedAt ||
    (sourceKind !== "current" && sourceKind !== "node")
  ) {
    return null;
  }
  return {
    targetId,
    label,
    ...(asString(row.platform) ? { platform: asString(row.platform) } : {}),
    sourceKind,
    connected: asBoolean(row.connected),
    current: asBoolean(row.current),
    ownerKey: owner.ownerKey,
    ownerScope: owner.ownerScope,
    ownerLabel: owner.label,
    ...(owner.email ? { ownerEmail: owner.email } : {}),
    registeredAt,
    updatedAt,
  };
}

function requestRowToRecord(row: Record<string, unknown>): AlisioSharingCloudRequestRecord | null {
  const requester = toPrincipal("requester", row);
  const owner = toPrincipal("owner", row);
  const requestId = asString(row.request_id);
  const targetId = asString(row.target_id);
  const targetLabel = asString(row.target_label);
  const targetSourceKind = row.target_source_kind;
  const createdAt = asString(row.created_at);
  const status = row.status;
  if (
    !requestId ||
    !targetId ||
    !targetLabel ||
    !requester ||
    !owner ||
    !createdAt ||
    (targetSourceKind !== "current" && targetSourceKind !== "node") ||
    typeof status !== "string"
  ) {
    return null;
  }
  return {
    requestId,
    targetId,
    targetLabel,
    ...(asString(row.target_platform) ? { targetPlatform: asString(row.target_platform) } : {}),
    targetSourceKind,
    requester,
    owner,
    scopes: asStringArray(row.scopes) as SharingScope[],
    status: status as SharingRequestStatus,
    createdAt,
    ...(asString(row.resolved_at) ? { resolvedAt: asString(row.resolved_at) } : {}),
    ...(asString(row.grant_id) ? { grantId: asString(row.grant_id) } : {}),
  };
}

function grantRowToRecord(row: Record<string, unknown>): AlisioSharingCloudGrantRecord | null {
  const owner = toPrincipal("owner", row);
  const grantee = toPrincipal("grantee", row);
  const grantId = asString(row.grant_id);
  const requestId = asString(row.request_id);
  const targetId = asString(row.target_id);
  const targetLabel = asString(row.target_label);
  const targetSourceKind = row.target_source_kind;
  const approvedAt = asString(row.approved_at);
  if (
    !grantId ||
    !requestId ||
    !targetId ||
    !targetLabel ||
    !owner ||
    !grantee ||
    !approvedAt ||
    (targetSourceKind !== "current" && targetSourceKind !== "node")
  ) {
    return null;
  }
  return {
    grantId,
    requestId,
    targetId,
    targetLabel,
    ...(asString(row.target_platform) ? { targetPlatform: asString(row.target_platform) } : {}),
    targetSourceKind,
    owner,
    grantee,
    scopes: asStringArray(row.scopes) as SharingScope[],
    approvedAt,
    ...(asString(row.revoked_at) ? { revokedAt: asString(row.revoked_at) } : {}),
  };
}

function auditRowToRecord(row: Record<string, unknown>): AlisioSharingCloudAuditRecord | null {
  const actor = toPrincipal("actor", row);
  const entryId = asString(row.entry_id);
  const action = row.action;
  const summary = asString(row.summary);
  const createdAt = asString(row.created_at);
  if (!actor || !entryId || !summary || !createdAt || typeof action !== "string") {
    return null;
  }
  return {
    entryId,
    action: action as SharingAuditAction,
    actor,
    ...(asString(row.target_id) ? { targetId: asString(row.target_id) } : {}),
    ...(asString(row.target_label) ? { targetLabel: asString(row.target_label) } : {}),
    ...(asString(row.request_id) ? { requestId: asString(row.request_id) } : {}),
    ...(asString(row.grant_id) ? { grantId: asString(row.grant_id) } : {}),
    summary,
    createdAt,
  };
}

function policyRowToRecord(row: Record<string, unknown>): AlisioSharingCloudPolicyRecord | null {
  const ownerKey = asString(row.owner_key);
  const updatedAt = asString(row.updated_at);
  const updatedBy = toPrincipal("updated_by", row);
  if (!ownerKey || !updatedAt || !updatedBy) {
    return null;
  }
  return {
    ownerKey,
    allowExternalUse: asBoolean(row.allow_external_use),
    ...(asResourcePolicies(row.resource_policies)
      ? { resourcePolicies: asResourcePolicies(row.resource_policies) }
      : {}),
    updatedAt,
    updatedBy,
  };
}

function toTargetRow(target: AlisioSharingCloudTargetRecord) {
  return {
    target_id: target.targetId,
    label: target.label,
    platform: target.platform ?? null,
    source_kind: target.sourceKind,
    connected: target.connected,
    current: target.current,
    owner_key: target.ownerKey,
    owner_scope: target.ownerScope,
    owner_label: target.ownerLabel,
    owner_email: target.ownerEmail ?? null,
    registered_at: target.registeredAt,
    updated_at: target.updatedAt,
  };
}

function toRequestRow(request: AlisioSharingCloudRequestRecord) {
  return {
    request_id: request.requestId,
    target_id: request.targetId,
    target_label: request.targetLabel,
    target_platform: request.targetPlatform ?? null,
    target_source_kind: request.targetSourceKind,
    requester_key: request.requester.ownerKey,
    requester_scope: request.requester.ownerScope,
    requester_label: request.requester.label,
    requester_email: request.requester.email ?? null,
    owner_key: request.owner.ownerKey,
    owner_scope: request.owner.ownerScope,
    owner_label: request.owner.label,
    owner_email: request.owner.email ?? null,
    scopes: request.scopes,
    status: request.status,
    created_at: request.createdAt,
    resolved_at: request.resolvedAt ?? null,
    grant_id: request.grantId ?? null,
  };
}

function toGrantRow(grant: AlisioSharingCloudGrantRecord) {
  return {
    grant_id: grant.grantId,
    request_id: grant.requestId,
    target_id: grant.targetId,
    target_label: grant.targetLabel,
    target_platform: grant.targetPlatform ?? null,
    target_source_kind: grant.targetSourceKind,
    owner_key: grant.owner.ownerKey,
    owner_scope: grant.owner.ownerScope,
    owner_label: grant.owner.label,
    owner_email: grant.owner.email ?? null,
    grantee_key: grant.grantee.ownerKey,
    grantee_scope: grant.grantee.ownerScope,
    grantee_label: grant.grantee.label,
    grantee_email: grant.grantee.email ?? null,
    scopes: grant.scopes,
    approved_at: grant.approvedAt,
    revoked_at: grant.revokedAt ?? null,
  };
}

function toPolicyRow(policy: AlisioSharingCloudPolicyRecord) {
  return {
    owner_key: policy.ownerKey,
    allow_external_use: policy.allowExternalUse,
    resource_policies: policy.resourcePolicies ?? null,
    updated_at: policy.updatedAt,
    updated_by_key: policy.updatedBy.ownerKey,
    updated_by_scope: policy.updatedBy.ownerScope,
    updated_by_label: policy.updatedBy.label,
    updated_by_email: policy.updatedBy.email ?? null,
  };
}

function toAuditRow(entry: AlisioSharingCloudAuditRecord) {
  return {
    entry_id: entry.entryId,
    action: entry.action,
    actor_key: entry.actor.ownerKey,
    actor_scope: entry.actor.ownerScope,
    actor_label: entry.actor.label,
    actor_email: entry.actor.email ?? null,
    target_id: entry.targetId ?? null,
    target_label: entry.targetLabel ?? null,
    request_id: entry.requestId ?? null,
    grant_id: entry.grantId ?? null,
    summary: entry.summary,
    created_at: entry.createdAt,
  };
}

export function canUseAlisioSharingCloud(params: {
  env?: NodeJS.ProcessEnv;
  cloudSession?: {
    backend?: string;
    state?: string;
    accessToken?: string;
  };
}) {
  const env = params.env ?? process.env;
  return Boolean(
    resolveSupabaseSharingConfig(env) &&
    params.cloudSession?.backend === "supabase" &&
    params.cloudSession?.state === "signed_in" &&
    params.cloudSession?.accessToken?.trim(),
  );
}

export async function loadAlisioSharingCloudState(params: {
  env?: NodeJS.ProcessEnv;
  accessToken: string;
  viewer: AlisioSharingCloudPrincipal;
  targets?: readonly AlisioSharingCloudRuntimeTarget[];
  fetchImpl?: typeof fetch;
}): Promise<AlisioSharingCloudState> {
  const env = params.env ?? process.env;
  const config = resolveSupabaseSharingConfig(env);
  if (!config) {
    throw new Error("The Alisio sharing cloud backend is not configured.");
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  if (params.targets) {
    const existingTargetRows = await getTableRows(
      config,
      config.targetsTable,
      params.accessToken,
      fetchImpl,
      { owner_key: `eq.${params.viewer.ownerKey}` },
    );
    const existingById = new Map<string, AlisioSharingCloudTargetRecord>();
    for (const entry of existingTargetRows) {
      const next = targetRowToRecord(entry as Record<string, unknown>);
      if (next) {
        existingById.set(next.targetId, next);
      }
    }
    const now = new Date().toISOString();
    const nextTargets = params.targets.map((target) => {
      const existing = existingById.get(target.targetId);
      return {
        targetId: target.targetId,
        label: target.label,
        platform: target.platform,
        sourceKind: target.sourceKind,
        connected: target.connected,
        current: target.current,
        ownerKey: params.viewer.ownerKey,
        ownerScope: params.viewer.ownerScope,
        ownerLabel: params.viewer.label,
        ownerEmail: params.viewer.email,
        registeredAt: existing?.registeredAt ?? now,
        updatedAt: now,
      } satisfies AlisioSharingCloudTargetRecord;
    });
    const staleTargets = [...existingById.values()]
      .filter((entry) => !params.targets?.some((target) => target.targetId === entry.targetId))
      .map(
        (entry) =>
          ({
            ...entry,
            connected: false,
            current: false,
            updatedAt: now,
          }) satisfies AlisioSharingCloudTargetRecord,
      );
    await upsertRows(
      config,
      config.targetsTable,
      params.accessToken,
      [...nextTargets, ...staleTargets].map(toTargetRow),
      "target_id",
      fetchImpl,
    );
  }

  const [policyRows, targetRows, requestRows, grantRows, auditRows] = await Promise.all([
    getTableRows(config, config.policiesTable, params.accessToken, fetchImpl),
    getTableRows(config, config.targetsTable, params.accessToken, fetchImpl),
    getTableRows(config, config.requestsTable, params.accessToken, fetchImpl),
    getTableRows(config, config.grantsTable, params.accessToken, fetchImpl),
    getTableRows(config, config.auditTable, params.accessToken, fetchImpl),
  ]);

  return {
    policies: Object.fromEntries(
      policyRows
        .map((entry) => policyRowToRecord(entry as Record<string, unknown>))
        .filter((entry): entry is AlisioSharingCloudPolicyRecord => Boolean(entry))
        .map((entry) => [entry.ownerKey, entry]),
    ),
    targets: Object.fromEntries(
      targetRows
        .map((entry) => targetRowToRecord(entry as Record<string, unknown>))
        .filter((entry): entry is AlisioSharingCloudTargetRecord => Boolean(entry))
        .map((entry) => [entry.targetId, entry]),
    ),
    requests: Object.fromEntries(
      requestRows
        .map((entry) => requestRowToRecord(entry as Record<string, unknown>))
        .filter((entry): entry is AlisioSharingCloudRequestRecord => Boolean(entry))
        .map((entry) => [entry.requestId, entry]),
    ),
    grants: Object.fromEntries(
      grantRows
        .map((entry) => grantRowToRecord(entry as Record<string, unknown>))
        .filter((entry): entry is AlisioSharingCloudGrantRecord => Boolean(entry))
        .map((entry) => [entry.grantId, entry]),
    ),
    audit: auditRows
      .map((entry) => auditRowToRecord(entry as Record<string, unknown>))
      .filter((entry): entry is AlisioSharingCloudAuditRecord => Boolean(entry)),
  };
}

export async function upsertAlisioSharingCloudRequest(params: {
  env?: NodeJS.ProcessEnv;
  accessToken: string;
  request: AlisioSharingCloudRequestRecord;
  fetchImpl?: typeof fetch;
}) {
  const env = params.env ?? process.env;
  const config = resolveSupabaseSharingConfig(env);
  if (!config) {
    throw new Error("The Alisio sharing cloud backend is not configured.");
  }
  await upsertRows(
    config,
    config.requestsTable,
    params.accessToken,
    [toRequestRow(params.request)],
    "request_id",
    params.fetchImpl ?? fetch,
  );
}

export async function upsertAlisioSharingCloudGrant(params: {
  env?: NodeJS.ProcessEnv;
  accessToken: string;
  grant: AlisioSharingCloudGrantRecord;
  fetchImpl?: typeof fetch;
}) {
  const env = params.env ?? process.env;
  const config = resolveSupabaseSharingConfig(env);
  if (!config) {
    throw new Error("The Alisio sharing cloud backend is not configured.");
  }
  await upsertRows(
    config,
    config.grantsTable,
    params.accessToken,
    [toGrantRow(params.grant)],
    "grant_id",
    params.fetchImpl ?? fetch,
  );
}

export async function upsertAlisioSharingCloudPolicy(params: {
  env?: NodeJS.ProcessEnv;
  accessToken: string;
  policy: AlisioSharingCloudPolicyRecord;
  fetchImpl?: typeof fetch;
}) {
  const env = params.env ?? process.env;
  const config = resolveSupabaseSharingConfig(env);
  if (!config) {
    throw new Error("The Alisio sharing cloud backend is not configured.");
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  const rows = [toPolicyRow(params.policy)];
  try {
    await upsertRows(
      config,
      config.policiesTable,
      params.accessToken,
      rows,
      "owner_key",
      fetchImpl,
    );
  } catch (error) {
    const message = String(error);
    // Temporary compatibility: older Supabase tables may not yet expose the
    // resource_policies JSON column. Retry without it so sharing policy writes
    // keep working while the hosted schema catches up.
    if (!message.includes("resource_policies")) {
      throw error;
    }
    await upsertRows(
      config,
      config.policiesTable,
      params.accessToken,
      rows.map(({ resource_policies: _resourcePolicies, ...row }) => row),
      "owner_key",
      fetchImpl,
    );
  }
}

export async function appendAlisioSharingCloudAuditEntry(params: {
  env?: NodeJS.ProcessEnv;
  accessToken: string;
  entry: AlisioSharingCloudAuditRecord;
  fetchImpl?: typeof fetch;
}) {
  const env = params.env ?? process.env;
  const config = resolveSupabaseSharingConfig(env);
  if (!config) {
    throw new Error("The Alisio sharing cloud backend is not configured.");
  }
  await upsertRows(
    config,
    config.auditTable,
    params.accessToken,
    [toAuditRow(params.entry)],
    "entry_id",
    params.fetchImpl ?? fetch,
  );
}
