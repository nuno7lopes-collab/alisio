import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { installSkillFromClawHub, updateSkillsFromClawHub } from "../../agents/skills-clawhub.js";
import { installSkill } from "../../agents/skills-install.js";
import {
  buildWorkspaceSkillStatus,
  resolveWorkspaceMarketplaceCatalogStatus,
} from "../../agents/skills-status.js";
import {
  appendSkillAuditEntry,
  executeMarketplaceSkill,
  installMarketplaceSkill,
  loadWorkspaceSkillEntries,
  removeMarketplaceSkill,
  resolveMarketplaceConsent,
  type SkillEntry,
} from "../../agents/skills.js";
import { listAgentWorkspaceDirs } from "../../agents/workspace-dirs.js";
import type { AlisioConfig } from "../../config/config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSkillsBinsParams,
  validateSkillsInstallParams,
  validateSkillsStatusParams,
  validateSkillsUpdateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function collectSkillBins(entries: SkillEntry[]): string[] {
  const bins = new Set<string>();
  for (const entry of entries) {
    const required = entry.metadata?.requires?.bins ?? [];
    const anyBins = entry.metadata?.requires?.anyBins ?? [];
    const install = entry.metadata?.install ?? [];
    for (const bin of required) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const bin of anyBins) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const spec of install) {
      const specBins = spec?.bins ?? [];
      for (const bin of specBins) {
        const trimmed = String(bin).trim();
        if (trimmed) {
          bins.add(trimmed);
        }
      }
    }
  }
  return [...bins].toSorted();
}

type MarketplaceSkillActionParams = {
  name: string;
  force?: boolean;
  consentDecision?: "allow-once" | "allow-always" | "deny";
};

function parseMarketplaceSkillActionParams(
  params: unknown,
): { ok: true; value: MarketplaceSkillActionParams } | { ok: false; error: string } {
  if (!params || typeof params !== "object") {
    return { ok: false, error: "params must be an object" };
  }
  const record = params as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    return { ok: false, error: "name is required" };
  }
  const consentDecisionRaw =
    typeof record.consentDecision === "string" ? record.consentDecision.trim() : "";
  const consentDecision =
    consentDecisionRaw === "allow-once" ||
    consentDecisionRaw === "allow-always" ||
    consentDecisionRaw === "deny"
      ? consentDecisionRaw
      : undefined;
  if (consentDecisionRaw && !consentDecision) {
    return {
      ok: false,
      error: `invalid consentDecision "${consentDecisionRaw}"`,
    };
  }
  return {
    ok: true,
    value: {
      name,
      force: record.force === true,
      ...(consentDecision ? { consentDecision } : {}),
    },
  };
}

function resolveGatewayActorLabel(
  client: { connect?: { client?: { displayName?: string; id?: string } } } | null,
): string | undefined {
  return client?.connect?.client?.displayName ?? client?.connect?.client?.id;
}

export const skillsHandlers: GatewayRequestHandlers = {
  "skills.status": async ({ params, respond }) => {
    if (!validateSkillsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.status params: ${formatValidationErrors(validateSkillsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentIdRaw = typeof params?.agentId === "string" ? params.agentId.trim() : "";
    const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : resolveDefaultAgentId(cfg);
    if (agentIdRaw) {
      const knownAgents = listAgentIds(cfg);
      if (!knownAgents.includes(agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent id "${agentIdRaw}"`),
        );
        return;
      }
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const report = buildWorkspaceSkillStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    report.marketplaceCatalog = await resolveWorkspaceMarketplaceCatalogStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    respond(true, report, undefined);
  },
  "skills.bins": ({ params, respond }) => {
    if (!validateSkillsBinsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.bins params: ${formatValidationErrors(validateSkillsBinsParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDirs = listAgentWorkspaceDirs(cfg);
    const bins = new Set<string>();
    for (const workspaceDir of workspaceDirs) {
      const entries = loadWorkspaceSkillEntries(workspaceDir, { config: cfg });
      for (const bin of collectSkillBins(entries)) {
        bins.add(bin);
      }
    }
    respond(true, { bins: [...bins].toSorted() }, undefined);
  },
  "skills.install": async ({ params, respond }) => {
    if (!validateSkillsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.install params: ${formatValidationErrors(validateSkillsInstallParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    if (params && typeof params === "object" && "source" in params && params.source === "clawhub") {
      const p = params as {
        source: "clawhub";
        slug: string;
        version?: string;
        force?: boolean;
      };
      const result = await installSkillFromClawHub({
        workspaceDir: workspaceDirRaw,
        slug: p.slug,
        version: p.version,
        force: Boolean(p.force),
      });
      respond(
        result.ok,
        result.ok
          ? {
              ok: true,
              message: `Installed ${result.slug}@${result.version}`,
              stdout: "",
              stderr: "",
              code: 0,
              slug: result.slug,
              version: result.version,
              targetDir: result.targetDir,
            }
          : result,
        result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.error),
      );
      return;
    }
    const p = params as {
      name: string;
      installId: string;
      timeoutMs?: number;
    };
    const result = await installSkill({
      workspaceDir: workspaceDirRaw,
      skillName: p.name,
      installId: p.installId,
      timeoutMs: p.timeoutMs,
      config: cfg,
    });
    respond(
      result.ok,
      result,
      result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.message),
    );
  },
  "skills.marketplace.install": async ({ params, respond, client }) => {
    const parsed = parseMarketplaceSkillActionParams(params);
    if (!parsed.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsed.error));
      return;
    }
    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const actor = resolveGatewayActorLabel(client);
    const catalog = await resolveWorkspaceMarketplaceCatalogStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    const skill = catalog.find((entry) => entry.name === parsed.value.name);
    if (!skill) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "skill not found"));
      return;
    }
    const consent = await resolveMarketplaceConsent({
      workspaceDir,
      action: "install",
      skill: {
        name: skill.name,
        version: skill.manifestVersion,
        kind: skill.kind,
        permissions: skill.permissions,
        outputs: skill.outputs ?? {
          primary: "instructions",
          formats: ["markdown"],
        },
      },
      decision: parsed.value.consentDecision,
      actor,
    });
    if (consent.status === "consent-required") {
      respond(
        true,
        {
          status: "consent-required",
          action: "install",
          skillName: skill.name,
          request: consent.request,
        },
        undefined,
      );
      return;
    }
    if (consent.status === "denied") {
      respond(
        true,
        {
          status: "denied",
          action: "install",
          skillName: skill.name,
          message: consent.message,
        },
        undefined,
      );
      return;
    }

    const result = await installMarketplaceSkill({
      catalogWorkspaceDir: workspaceDir,
      targetWorkspaceDir: workspaceDir,
      skillName: parsed.value.name,
      config: cfg,
      force: parsed.value.force,
    });
    if (!result.ok) {
      await appendSkillAuditEntry({
        workspaceDir,
        skillName: parsed.value.name,
        action: "install",
        outcome: "failed",
        actor,
        summary: result.error,
      });
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error));
      return;
    }
    await appendSkillAuditEntry({
      workspaceDir,
      skillName: result.skill.name,
      action: "install",
      outcome: "completed",
      decision: consent.decision,
      actor,
      summary: `Installed ${result.skill.name} into ${result.targetDir}.`,
    });
    respond(
      true,
      {
        status: "completed",
        action: "install",
        skillName: result.skill.name,
        targetDir: result.targetDir,
        message: `Installed ${result.skill.name}.`,
      },
      undefined,
    );
  },
  "skills.marketplace.remove": async ({ params, respond, client }) => {
    const parsed = parseMarketplaceSkillActionParams(params);
    if (!parsed.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsed.error));
      return;
    }
    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const actor = resolveGatewayActorLabel(client);
    const catalog = await resolveWorkspaceMarketplaceCatalogStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    const skill = catalog.find((entry) => entry.name === parsed.value.name);
    if (!skill) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "skill not found"));
      return;
    }
    const consent = await resolveMarketplaceConsent({
      workspaceDir,
      action: "remove",
      skill: {
        name: skill.name,
        version: skill.manifestVersion,
        kind: skill.kind,
        permissions: skill.permissions,
        outputs: skill.outputs ?? {
          primary: "instructions",
          formats: ["markdown"],
        },
      },
      decision: parsed.value.consentDecision,
      actor,
    });
    if (consent.status === "consent-required") {
      respond(
        true,
        {
          status: "consent-required",
          action: "remove",
          skillName: skill.name,
          request: consent.request,
        },
        undefined,
      );
      return;
    }
    if (consent.status === "denied") {
      respond(
        true,
        {
          status: "denied",
          action: "remove",
          skillName: skill.name,
          message: consent.message,
        },
        undefined,
      );
      return;
    }

    const result = await removeMarketplaceSkill({
      workspaceDir,
      managedSkillsDir: buildWorkspaceSkillStatus(workspaceDir, { config: cfg }).managedSkillsDir,
      skillName: parsed.value.name,
      config: cfg,
    });
    if (!result.ok) {
      await appendSkillAuditEntry({
        workspaceDir,
        skillName: parsed.value.name,
        action: "remove",
        outcome: "failed",
        actor,
        summary: result.error,
      });
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error));
      return;
    }
    await appendSkillAuditEntry({
      workspaceDir,
      skillName: result.skill.name,
      action: "remove",
      outcome: "completed",
      decision: consent.decision,
      actor,
      summary: `Removed ${result.skill.name} from ${result.removedDir}.`,
    });
    respond(
      true,
      {
        status: "completed",
        action: "remove",
        skillName: result.skill.name,
        removedDir: result.removedDir,
        message: `Removed ${result.skill.name}.`,
      },
      undefined,
    );
  },
  "skills.marketplace.execute": async ({ params, respond, client }) => {
    const parsed = parseMarketplaceSkillActionParams(params);
    if (!parsed.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsed.error));
      return;
    }
    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const actor = resolveGatewayActorLabel(client);
    const catalog = await resolveWorkspaceMarketplaceCatalogStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    const skill = catalog.find((entry) => entry.name === parsed.value.name);
    if (!skill) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "skill not found"));
      return;
    }
    const consent = await resolveMarketplaceConsent({
      workspaceDir,
      action: "execute",
      skill: {
        name: skill.name,
        version: skill.manifestVersion,
        kind: skill.kind,
        permissions: skill.permissions,
        outputs: skill.outputs ?? {
          primary: "instructions",
          formats: ["markdown"],
        },
      },
      decision: parsed.value.consentDecision,
      actor,
    });
    if (consent.status === "consent-required") {
      respond(
        true,
        {
          status: "consent-required",
          action: "execute",
          skillName: skill.name,
          request: consent.request,
        },
        undefined,
      );
      return;
    }
    if (consent.status === "denied") {
      respond(
        true,
        {
          status: "denied",
          action: "execute",
          skillName: skill.name,
          message: consent.message,
        },
        undefined,
      );
      return;
    }

    const result = await executeMarketplaceSkill({
      workspaceDir,
      skillName: parsed.value.name,
      consent: true,
      config: cfg,
    });
    if (!result.ok) {
      await appendSkillAuditEntry({
        workspaceDir,
        skillName: parsed.value.name,
        action: "execute",
        outcome: "failed",
        actor,
        summary: result.error,
      });
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error));
      return;
    }
    await appendSkillAuditEntry({
      workspaceDir,
      skillName: result.skill.name,
      action: "execute",
      outcome: "completed",
      decision: consent.decision,
      actor,
      summary:
        result.skill.kind === "mcp-server"
          ? `Inspected MCP skill ${result.skill.name}.`
          : `Executed skill ${result.skill.name}.`,
    });
    respond(
      true,
      {
        status: "completed",
        action: "execute",
        skillName: result.skill.name,
        message:
          result.skill.kind === "mcp-server"
            ? `Loaded MCP surfaces for ${result.skill.name}.`
            : `Loaded ${result.skill.name}.`,
        instructions: result.instructions,
        mcp: result.mcp,
        sandbox: result.sandbox,
      },
      undefined,
    );
  },
  "skills.update": async ({ params, respond }) => {
    if (!validateSkillsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.update params: ${formatValidationErrors(validateSkillsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    if (params && typeof params === "object" && "source" in params && params.source === "clawhub") {
      const p = params as {
        source: "clawhub";
        slug?: string;
        all?: boolean;
      };
      if (!p.slug && !p.all) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, 'clawhub skills.update requires "slug" or "all"'),
        );
        return;
      }
      if (p.slug && p.all) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            'clawhub skills.update accepts either "slug" or "all", not both',
          ),
        );
        return;
      }
      const cfg = loadConfig();
      const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
      const results = await updateSkillsFromClawHub({
        workspaceDir,
        slug: p.slug,
      });
      const errors = results.filter((result) => !result.ok);
      respond(
        errors.length === 0,
        {
          ok: errors.length === 0,
          skillKey: p.slug ?? "*",
          config: {
            source: "clawhub",
            results,
          },
        },
        errors.length === 0
          ? undefined
          : errorShape(ErrorCodes.UNAVAILABLE, errors.map((result) => result.error).join("; ")),
      );
      return;
    }
    const p = params as {
      skillKey: string;
      enabled?: boolean;
      apiKey?: string;
      env?: Record<string, string>;
    };
    const cfg = loadConfig();
    const skills = cfg.skills ? { ...cfg.skills } : {};
    const entries = skills.entries ? { ...skills.entries } : {};
    const current = entries[p.skillKey] ? { ...entries[p.skillKey] } : {};
    if (typeof p.enabled === "boolean") {
      current.enabled = p.enabled;
    }
    if (typeof p.apiKey === "string") {
      const trimmed = normalizeSecretInput(p.apiKey);
      if (trimmed) {
        current.apiKey = trimmed;
      } else {
        delete current.apiKey;
      }
    }
    if (p.env && typeof p.env === "object") {
      const nextEnv = current.env ? { ...current.env } : {};
      for (const [key, value] of Object.entries(p.env)) {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
          continue;
        }
        const trimmedVal = value.trim();
        if (!trimmedVal) {
          delete nextEnv[trimmedKey];
        } else {
          nextEnv[trimmedKey] = trimmedVal;
        }
      }
      current.env = nextEnv;
    }
    entries[p.skillKey] = current;
    skills.entries = entries;
    const nextConfig: AlisioConfig = {
      ...cfg,
      skills,
    };
    await writeConfigFile(nextConfig);
    respond(true, { ok: true, skillKey: p.skillKey, config: current }, undefined);
  },
};
