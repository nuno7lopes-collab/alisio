import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/config.js";
import type {
  SkillAuditEntry,
  SkillAuditOutcome,
  SkillConsentDecision,
  SkillConsentGrant,
  SkillConsentRequest,
  SkillMarketplaceActionKind,
  SkillOutputsSpec,
  SkillPermissionSpec,
} from "./types.js";

type SkillConsentSubject = {
  name: string;
  version?: string;
  kind?: string;
  permissions: SkillPermissionSpec;
  outputs: SkillOutputsSpec;
};

type SkillConsentStore = {
  version: 1;
  grants: SkillConsentGrant[];
};

type ResolveMarketplaceConsentParams = {
  workspaceDir: string;
  action: SkillMarketplaceActionKind;
  skill: SkillConsentSubject;
  decision?: SkillConsentDecision;
  actor?: string;
};

export type SkillConsentResolution =
  | {
      status: "granted";
      fingerprint: string;
      storedGrant?: SkillConsentGrant;
      decision?: Extract<SkillConsentDecision, "allow-once" | "allow-always">;
    }
  | {
      status: "consent-required";
      fingerprint: string;
      request: SkillConsentRequest;
    }
  | {
      status: "denied";
      fingerprint: string;
      message: string;
    };

function resolveMarketplaceStateDir(): string {
  return path.join(resolveStateDir(), "skills");
}

export function resolveMarketplaceConsentStorePath(): string {
  return path.join(resolveMarketplaceStateDir(), "marketplace-consent.json");
}

export function resolveMarketplaceAuditLogPath(): string {
  return path.join(resolveMarketplaceStateDir(), "marketplace-audit.jsonl");
}

async function ensureMarketplaceStateDir(): Promise<void> {
  await fs.mkdir(resolveMarketplaceStateDir(), { recursive: true });
}

function summarizePermissions(permissions: SkillPermissionSpec): string[] {
  const parts: string[] = [
    `sandbox=${permissions.sandbox.mode}/${permissions.sandbox.filesystem}/${permissions.sandbox.network}`,
  ];
  if ((permissions.exec?.bins?.length ?? 0) > 0) {
    parts.push(`exec ${permissions.exec?.bins?.join(", ")}`);
  }
  if ((permissions.files?.write?.length ?? 0) > 0) {
    parts.push(`write ${permissions.files?.write?.join(", ")}`);
  }
  if ((permissions.env?.read?.length ?? 0) > 0) {
    parts.push(`env ${permissions.env?.read?.join(", ")}`);
  }
  if (permissions.network?.outbound === true) {
    parts.push(
      permissions.network.hosts?.length
        ? `network ${permissions.network.hosts.join(", ")}`
        : "network outbound",
    );
  }
  if (permissions.mcp?.consume === true) {
    parts.push("consume MCP");
  }
  if (permissions.mcp?.exposeTools === true) {
    parts.push("expose MCP tools");
  }
  if (permissions.mcp?.exposePrompts === true) {
    parts.push("expose MCP prompts");
  }
  if (permissions.mcp?.exposeResources === true) {
    parts.push("expose MCP resources");
  }
  return parts;
}

export function resolveMarketplaceConsentFingerprint(skill: SkillConsentSubject): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: skill.name,
        version: skill.version ?? "0.0.0",
        kind: skill.kind ?? "local-skill",
        permissions: skill.permissions,
        outputs: skill.outputs,
      }),
    )
    .digest("hex");
}

async function readSkillConsentStore(): Promise<SkillConsentStore> {
  try {
    const raw = await fs.readFile(resolveMarketplaceConsentStorePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SkillConsentStore>;
    return {
      version: 1,
      grants: Array.isArray(parsed.grants)
        ? parsed.grants.filter(
            (entry): entry is SkillConsentGrant =>
              typeof entry?.workspaceDir === "string" &&
              typeof entry?.skillName === "string" &&
              typeof entry?.action === "string" &&
              entry.decision === "allow-always" &&
              typeof entry?.fingerprint === "string" &&
              typeof entry?.createdAt === "string" &&
              typeof entry?.updatedAt === "string",
          )
        : [],
    };
  } catch {
    return { version: 1, grants: [] };
  }
}

async function writeSkillConsentStore(store: SkillConsentStore): Promise<void> {
  await ensureMarketplaceStateDir();
  await fs.writeFile(resolveMarketplaceConsentStorePath(), `${JSON.stringify(store, null, 2)}\n`);
}

function requiresConsent(params: {
  action: SkillMarketplaceActionKind;
  permissions: SkillPermissionSpec;
}): boolean {
  if (params.action === "install" || params.action === "remove") {
    return true;
  }
  return params.permissions.consent === "explicit";
}

function buildConsentRequest(params: {
  action: SkillMarketplaceActionKind;
  skill: SkillConsentSubject;
  fingerprint: string;
}): SkillConsentRequest {
  const permissionSummary = summarizePermissions(params.skill.permissions);
  const actionLabel =
    params.action === "install"
      ? "install"
      : params.action === "remove"
        ? "remove"
        : params.skill.kind === "mcp-server"
          ? "inspect"
          : "run";
  return {
    action: params.action,
    title: `${actionLabel[0]?.toUpperCase() ?? ""}${actionLabel.slice(1)} ${params.skill.name}?`,
    description: permissionSummary.length
      ? `Declared permissions: ${permissionSummary.join("; ")}.`
      : "This action requires explicit approval.",
    fingerprint: params.fingerprint,
    permissions: params.skill.permissions,
    outputs: params.skill.outputs,
  };
}

export async function listSkillConsentGrants(params?: {
  workspaceDir?: string;
  skillName?: string;
}): Promise<SkillConsentGrant[]> {
  const store = await readSkillConsentStore();
  return store.grants
    .filter((grant) =>
      params?.workspaceDir
        ? path.resolve(grant.workspaceDir) === path.resolve(params.workspaceDir)
        : true,
    )
    .filter((grant) => (params?.skillName ? grant.skillName === params.skillName : true))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function persistConsentGrant(params: {
  workspaceDir: string;
  skillName: string;
  action: SkillMarketplaceActionKind;
  fingerprint: string;
  actor?: string;
}): Promise<SkillConsentGrant> {
  const now = new Date().toISOString();
  const store = await readSkillConsentStore();
  const workspaceDir = path.resolve(params.workspaceDir);
  const nextGrant: SkillConsentGrant = {
    workspaceDir,
    skillName: params.skillName,
    action: params.action,
    decision: "allow-always",
    fingerprint: params.fingerprint,
    createdAt: now,
    updatedAt: now,
    ...(params.actor ? { actor: params.actor } : {}),
  };
  const existingIndex = store.grants.findIndex(
    (grant) =>
      path.resolve(grant.workspaceDir) === workspaceDir &&
      grant.skillName === params.skillName &&
      grant.action === params.action,
  );
  if (existingIndex >= 0) {
    const previous = store.grants[existingIndex];
    nextGrant.createdAt = previous.createdAt;
    store.grants[existingIndex] = nextGrant;
  } else {
    store.grants.push(nextGrant);
  }
  await writeSkillConsentStore(store);
  return nextGrant;
}

export async function appendSkillAuditEntry(params: {
  workspaceDir: string;
  skillName: string;
  action: SkillMarketplaceActionKind;
  outcome: SkillAuditOutcome;
  decision?: SkillConsentDecision;
  actor?: string;
  summary: string;
}): Promise<SkillAuditEntry> {
  const entry: SkillAuditEntry = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    workspaceDir: path.resolve(params.workspaceDir),
    skillName: params.skillName,
    action: params.action,
    outcome: params.outcome,
    ...(params.decision ? { decision: params.decision } : {}),
    ...(params.actor ? { actor: params.actor } : {}),
    summary: params.summary,
  };
  await ensureMarketplaceStateDir();
  await fs.appendFile(resolveMarketplaceAuditLogPath(), `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function listSkillAuditEntries(params?: {
  workspaceDir?: string;
  skillName?: string;
  limit?: number;
}): Promise<SkillAuditEntry[]> {
  try {
    const raw = await fs.readFile(resolveMarketplaceAuditLogPath(), "utf8");
    const entries = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as SkillAuditEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is SkillAuditEntry => Boolean(entry));
    const filtered = entries
      .filter((entry) =>
        params?.workspaceDir
          ? path.resolve(entry.workspaceDir) === path.resolve(params.workspaceDir)
          : true,
      )
      .filter((entry) => (params?.skillName ? entry.skillName === params.skillName : true))
      .toSorted((left, right) => right.ts.localeCompare(left.ts));
    if (!params?.limit || params.limit <= 0) {
      return filtered;
    }
    return filtered.slice(0, params.limit);
  } catch {
    return [];
  }
}

export async function resolveMarketplaceConsent(
  params: ResolveMarketplaceConsentParams,
): Promise<SkillConsentResolution> {
  const fingerprint = resolveMarketplaceConsentFingerprint(params.skill);
  if (!requiresConsent({ action: params.action, permissions: params.skill.permissions })) {
    return { status: "granted", fingerprint };
  }

  const grants = await listSkillConsentGrants({
    workspaceDir: params.workspaceDir,
    skillName: params.skill.name,
  });
  const storedGrant = grants.find(
    (grant) =>
      grant.action === params.action &&
      grant.fingerprint === fingerprint &&
      grant.decision === "allow-always",
  );
  if (storedGrant) {
    return {
      status: "granted",
      fingerprint,
      storedGrant,
      decision: "allow-always",
    };
  }

  if (!params.decision) {
    const request = buildConsentRequest({
      action: params.action,
      skill: params.skill,
      fingerprint,
    });
    await appendSkillAuditEntry({
      workspaceDir: params.workspaceDir,
      skillName: params.skill.name,
      action: params.action,
      outcome: "requested",
      actor: params.actor,
      summary: request.description,
    });
    return { status: "consent-required", fingerprint, request };
  }

  if (params.decision === "deny") {
    await appendSkillAuditEntry({
      workspaceDir: params.workspaceDir,
      skillName: params.skill.name,
      action: params.action,
      outcome: "denied",
      decision: params.decision,
      actor: params.actor,
      summary: `Denied ${params.action} for ${params.skill.name}.`,
    });
    return {
      status: "denied",
      fingerprint,
      message: `Denied ${params.action} for "${params.skill.name}".`,
    };
  }

  const persistedGrant =
    params.decision === "allow-always"
      ? await persistConsentGrant({
          workspaceDir: params.workspaceDir,
          skillName: params.skill.name,
          action: params.action,
          fingerprint,
          actor: params.actor,
        })
      : undefined;
  await appendSkillAuditEntry({
    workspaceDir: params.workspaceDir,
    skillName: params.skill.name,
    action: params.action,
    outcome: "granted",
    decision: params.decision,
    actor: params.actor,
    summary: `${params.decision === "allow-always" ? "Persisted" : "Granted"} ${params.action} for ${params.skill.name}.`,
  });
  return {
    status: "granted",
    fingerprint,
    ...(persistedGrant ? { storedGrant: persistedGrant } : {}),
    decision: params.decision,
  };
}
