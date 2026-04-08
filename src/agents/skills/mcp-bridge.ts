import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AlisioConfig } from "../../config/config.js";
import { parseBooleanValue } from "../../utils/boolean.js";
import {
  buildWorkspaceSkillStatus,
  resolveWorkspaceMarketplaceCatalogStatus,
  type SkillStatusEntry,
} from "../skills-status.js";
import {
  appendSkillAuditEntry,
  buildSkillMarketplaceCatalog,
  executeMarketplaceSkill,
  installMarketplaceSkill,
  listSkillAuditEntries,
  listSkillConsentGrants,
  readMarketplaceSkillInstructions,
  removeMarketplaceSkill,
  resolveMarketplaceConsent,
} from "../skills.js";
import type {
  SkillCatalogEntry,
  SkillConsentDecision,
  SkillConsentRequest,
  SkillMarketplaceActionKind,
  SkillOutputsSpec,
} from "../skills.js";
import type { SkillMarketplaceAccessContext } from "./marketplace-access.js";

const BRIDGE_ACTOR = "mcp:alisio-skills-marketplace";

function sanitizeHandle(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "skill";
}

function encodeSkillUriSegment(name: string): string {
  return encodeURIComponent(name);
}

function buildSkillResourceUris(name: string): {
  manifestUri: string;
  instructionsUri: string;
} {
  const segment = encodeSkillUriSegment(name);
  return {
    manifestUri: `skills://skill/${segment}/manifest`,
    instructionsUri: `skills://skill/${segment}/instructions`,
  };
}

function buildMarketplaceResourceUris() {
  return {
    catalogUri: "skills://catalog",
    auditUri: "skills://audit",
    consentUri: "skills://consent-grants",
  };
}

function summarizePermissions(skill: SkillCatalogEntry): string {
  const parts: string[] = [];
  if ((skill.permissions.exec?.bins?.length ?? 0) > 0) {
    parts.push(`exec ${skill.permissions.exec?.bins?.join(", ")}`);
  }
  if (skill.permissions.network?.outbound === true) {
    parts.push(
      skill.permissions.network.hosts?.length
        ? `network ${skill.permissions.network.hosts.join(", ")}`
        : "network outbound",
    );
  }
  if ((skill.permissions.files?.write?.length ?? 0) > 0) {
    parts.push(`write ${skill.permissions.files?.write?.join(", ")}`);
  }
  if (skill.permissions.mcp?.consume === true) {
    parts.push("consume MCP");
  }
  return parts.join("; ");
}

function resolveToolAnnotations(skill: SkillCatalogEntry): ToolAnnotations {
  const writes = (skill.permissions.files?.write?.length ?? 0) > 0;
  const execs = (skill.permissions.exec?.bins?.length ?? 0) > 0;
  const network = skill.permissions.network?.outbound === true;
  const mcp = skill.permissions.mcp?.consume === true;
  return {
    title: skill.name,
    readOnlyHint: !writes && !execs && !network && !mcp,
    destructiveHint: writes,
    idempotentHint: !writes,
    openWorldHint: network || mcp,
  };
}

function buildCatalogPayload<T extends { marketplaceReady: boolean }>(skills: T[]) {
  return {
    generatedAt: new Date().toISOString(),
    total: skills.length,
    ready: skills.filter((skill) => skill.marketplaceReady).length,
    skills,
  };
}

function defaultSkillOutputs(outputs?: SkillOutputsSpec): SkillOutputsSpec {
  return (
    outputs ?? {
      primary: "instructions",
      formats: ["text/markdown"],
    }
  );
}

function buildSkillPromptText(
  skill: SkillCatalogEntry,
  instructions: string,
  mcp?: {
    toolCount: number;
    promptCount: number;
    resourceCount: number;
  },
  access?: {
    allowed: boolean;
    currentPlan: string;
    plan?: string;
    featureFlag?: string;
  },
  task?: string,
): string {
  const permissionSummary = summarizePermissions(skill);
  const lines = [
    `Use the skill "${skill.name}" (version ${skill.version ?? "0.0.0"}).`,
    skill.marketplaceReady
      ? "This skill is marketplace-ready with an explicit manifest."
      : "This skill is not marketplace-ready; review its manifest warnings before use.",
    `Sandbox default: ${skill.permissions.sandbox.mode}, filesystem=${skill.permissions.sandbox.filesystem}, network=${skill.permissions.sandbox.network}.`,
    `Primary output: ${skill.outputs.primary}; formats=${skill.outputs.formats.join(", ")}.`,
  ];
  if (skill.subscription?.required) {
    lines.push(`Subscription: ${skill.subscription.plan ?? "required"}.`);
  }
  if (access) {
    lines.push(
      access.allowed
        ? `Marketplace access: allowed for plan ${access.currentPlan}.`
        : `Marketplace access: blocked for plan ${access.currentPlan}.`,
    );
  }
  if (permissionSummary) {
    lines.push(`Declared permissions: ${permissionSummary}.`);
  }
  if (mcp) {
    lines.push(
      `Resolved MCP capabilities: tools=${mcp.toolCount}, prompts=${mcp.promptCount}, resources=${mcp.resourceCount}.`,
    );
  }
  if (task?.trim()) {
    lines.push(`Task context: ${task.trim()}`);
  }
  lines.push("", instructions.trim());
  return lines.join("\n");
}

function parseMcpFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return parseBooleanValue(value) ?? false;
  }
  return false;
}

function parseConsentDecision(value: unknown): SkillConsentDecision | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "allow-once" || normalized === "allow-always" || normalized === "deny"
    ? normalized
    : undefined;
}

function resolveConsentDecision(args: {
  consent?: unknown;
  consentDecision?: unknown;
}): SkillConsentDecision | undefined {
  const explicitDecision = parseConsentDecision(args.consentDecision);
  if (explicitDecision) {
    return explicitDecision;
  }
  const legacyDecision = parseConsentDecision(args.consent);
  if (legacyDecision) {
    return legacyDecision;
  }
  return parseMcpFlag(args.consent) ? "allow-once" : undefined;
}

function formatConsentRequestText(request: SkillConsentRequest): string {
  return `${request.title}\n${request.description}`.trim();
}

function buildConsentRequiredToolResult(params: {
  action: SkillMarketplaceActionKind;
  skillName: string;
  request: SkillConsentRequest;
}) {
  return {
    isError: true,
    structuredContent: {
      status: "consent-required",
      action: params.action,
      skillName: params.skillName,
      request: params.request,
    },
    content: [
      {
        type: "text" as const,
        text: formatConsentRequestText(params.request),
      },
    ],
  };
}

function buildDeniedToolResult(params: {
  action: SkillMarketplaceActionKind;
  skillName: string;
  message: string;
}) {
  return {
    isError: true,
    structuredContent: {
      status: "denied",
      action: params.action,
      skillName: params.skillName,
      message: params.message,
    },
    content: [
      {
        type: "text" as const,
        text: params.message,
      },
    ],
  };
}

function buildPromptErrorResponse(message: string) {
  return {
    description: message,
    messages: [
      {
        role: "assistant" as const,
        content: {
          type: "text" as const,
          text: message,
        },
      },
    ],
  };
}

async function resolveCatalogStatus(params: {
  workspaceDir: string;
  config?: AlisioConfig;
  access?: SkillMarketplaceAccessContext;
}): Promise<SkillStatusEntry[]> {
  return await resolveWorkspaceMarketplaceCatalogStatus(params.workspaceDir, {
    config: params.config,
    access: params.access,
  });
}

async function resolveCatalogStatusEntry(params: {
  workspaceDir: string;
  skillName: string;
  config?: AlisioConfig;
  access?: SkillMarketplaceAccessContext;
}): Promise<SkillStatusEntry | null> {
  const catalog = await resolveCatalogStatus(params);
  return catalog.find((entry) => entry.name === params.skillName) ?? null;
}

export function createSkillsMarketplaceMcpBridge(params: {
  workspaceDir: string;
  config?: AlisioConfig;
  access?: SkillMarketplaceAccessContext;
}) {
  const skills = buildSkillMarketplaceCatalog({
    workspaceDir: params.workspaceDir,
    config: params.config,
  });
  const { catalogUri, auditUri, consentUri } = buildMarketplaceResourceUris();
  const server = new McpServer({
    name: "alisio-skills-marketplace",
    version: "1.0.0",
  });

  server.registerResource(
    "skills_catalog",
    catalogUri,
    {
      title: "Skills Catalog",
      description: "Marketplace catalog with permissions, grants, and recent activity.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: catalogUri,
          mimeType: "application/json",
          text: JSON.stringify(
            buildCatalogPayload(
              await resolveCatalogStatus({
                workspaceDir: params.workspaceDir,
                config: params.config,
                access: params.access,
              }),
            ),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "skills_audit",
    auditUri,
    {
      title: "Skills Audit Log",
      description: "Recent marketplace action audit entries.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: auditUri,
          mimeType: "application/json",
          text: JSON.stringify(
            await listSkillAuditEntries({
              workspaceDir: params.workspaceDir,
              limit: 200,
            }),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "skills_consent_grants",
    consentUri,
    {
      title: "Skills Consent Grants",
      description: "Persisted marketplace consent grants for this workspace.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: consentUri,
          mimeType: "application/json",
          text: JSON.stringify(
            await listSkillConsentGrants({
              workspaceDir: params.workspaceDir,
            }),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "skills_catalog",
    {
      description: "List marketplace skills, grants, and recent audit status.",
      inputSchema: {
        onlyReady: z.string().optional(),
      },
      annotations: {
        title: "Skills Catalog",
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const catalog = await resolveCatalogStatus({
        workspaceDir: params.workspaceDir,
        config: params.config,
        access: params.access,
      });
      const filtered = parseMcpFlag(args.onlyReady)
        ? catalog.filter((skill) => skill.marketplaceReady)
        : catalog;
      return {
        structuredContent: buildCatalogPayload(filtered),
        content: [
          {
            type: "text",
            text: JSON.stringify(buildCatalogPayload(filtered), null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "skills_install",
    {
      description: "Install a marketplace-ready skill into a target workspace.",
      inputSchema: {
        name: z.string().min(1),
        targetWorkspaceDir: z.string().optional(),
        force: z.string().optional(),
        consent: z.string().optional(),
        consentDecision: z.string().optional(),
      },
      annotations: {
        title: "Install Skill",
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const targetWorkspaceDir = args.targetWorkspaceDir ?? params.workspaceDir;
      const skill = await resolveCatalogStatusEntry({
        workspaceDir: params.workspaceDir,
        skillName: args.name,
        config: params.config,
        access: params.access,
      });
      if (!skill) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Skill not found: ${args.name}`,
            },
          ],
        };
      }
      const consent = await resolveMarketplaceConsent({
        workspaceDir: targetWorkspaceDir,
        action: "install",
        skill: {
          name: skill.name,
          version: skill.manifestVersion,
          kind: skill.kind,
          permissions: skill.permissions,
          outputs: defaultSkillOutputs(skill.outputs),
        },
        decision: resolveConsentDecision(args),
        actor: BRIDGE_ACTOR,
      });
      if (consent.status === "consent-required") {
        return buildConsentRequiredToolResult({
          action: "install",
          skillName: skill.name,
          request: consent.request,
        });
      }
      if (consent.status === "denied") {
        return buildDeniedToolResult({
          action: "install",
          skillName: skill.name,
          message: consent.message,
        });
      }
      const result = await installMarketplaceSkill({
        catalogWorkspaceDir: params.workspaceDir,
        targetWorkspaceDir,
        skillName: args.name,
        config: params.config,
        force: parseMcpFlag(args.force),
        access: params.access,
      });
      if (!result.ok) {
        await appendSkillAuditEntry({
          workspaceDir: targetWorkspaceDir,
          skillName: skill.name,
          action: "install",
          outcome: "failed",
          actor: BRIDGE_ACTOR,
          summary: result.error,
        });
        return {
          isError: true,
          content: [{ type: "text", text: result.error }],
        };
      }
      await appendSkillAuditEntry({
        workspaceDir: targetWorkspaceDir,
        skillName: result.skill.name,
        action: "install",
        outcome: "completed",
        decision: consent.decision,
        actor: BRIDGE_ACTOR,
        summary: `Installed ${result.skill.name} into ${result.targetDir}.`,
      });
      return {
        structuredContent: {
          status: "completed",
          action: "install",
          skill: result.skill,
          targetDir: result.targetDir,
          access: result.access,
          resources: {
            catalog: catalogUri,
            audit: auditUri,
            consent: consentUri,
          },
        },
        content: [
          {
            type: "text",
            text: `Installed "${result.skill.name}" into ${result.targetDir}.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "skills_remove",
    {
      description: "Remove a previously installed marketplace skill from a workspace.",
      inputSchema: {
        name: z.string().min(1),
        targetWorkspaceDir: z.string().optional(),
        consent: z.string().optional(),
        consentDecision: z.string().optional(),
      },
      annotations: {
        title: "Remove Skill",
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const targetWorkspaceDir = args.targetWorkspaceDir ?? params.workspaceDir;
      const skill = await resolveCatalogStatusEntry({
        workspaceDir: targetWorkspaceDir,
        skillName: args.name,
        config: params.config,
        access: params.access,
      });
      if (!skill) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Skill not found: ${args.name}`,
            },
          ],
        };
      }
      const consent = await resolveMarketplaceConsent({
        workspaceDir: targetWorkspaceDir,
        action: "remove",
        skill: {
          name: skill.name,
          version: skill.manifestVersion,
          kind: skill.kind,
          permissions: skill.permissions,
          outputs: defaultSkillOutputs(skill.outputs),
        },
        decision: resolveConsentDecision(args),
        actor: BRIDGE_ACTOR,
      });
      if (consent.status === "consent-required") {
        return buildConsentRequiredToolResult({
          action: "remove",
          skillName: skill.name,
          request: consent.request,
        });
      }
      if (consent.status === "denied") {
        return buildDeniedToolResult({
          action: "remove",
          skillName: skill.name,
          message: consent.message,
        });
      }

      const managedSkillsDir = buildWorkspaceSkillStatus(targetWorkspaceDir, {
        config: params.config,
      }).managedSkillsDir;
      const result = await removeMarketplaceSkill({
        workspaceDir: targetWorkspaceDir,
        managedSkillsDir,
        skillName: args.name,
        config: params.config,
        access: params.access,
      });
      if (!result.ok) {
        await appendSkillAuditEntry({
          workspaceDir: targetWorkspaceDir,
          skillName: skill.name,
          action: "remove",
          outcome: "failed",
          actor: BRIDGE_ACTOR,
          summary: result.error,
        });
        return {
          isError: true,
          content: [{ type: "text", text: result.error }],
        };
      }
      await appendSkillAuditEntry({
        workspaceDir: targetWorkspaceDir,
        skillName: result.skill.name,
        action: "remove",
        outcome: "completed",
        decision: consent.decision,
        actor: BRIDGE_ACTOR,
        summary: `Removed ${result.skill.name} from ${result.removedDir}.`,
      });
      return {
        structuredContent: {
          status: "completed",
          action: "remove",
          skill: result.skill,
          removedDir: result.removedDir,
          access: result.access,
          resources: {
            catalog: catalogUri,
            audit: auditUri,
            consent: consentUri,
          },
        },
        content: [
          {
            type: "text",
            text: `Removed "${result.skill.name}" from ${result.removedDir}.`,
          },
        ],
      };
    },
  );

  for (const skill of skills) {
    const handle = sanitizeHandle(skill.name);
    const { manifestUri, instructionsUri } = buildSkillResourceUris(skill.name);

    server.registerResource(
      `skill_manifest_${handle}`,
      manifestUri,
      {
        title: `${skill.name} Manifest`,
        description: `Validated skill manifest for ${skill.name}.`,
        mimeType: "application/json",
      },
      async () => ({
        contents: [
          {
            uri: manifestUri,
            mimeType: "application/json",
            text: JSON.stringify(skill.manifest, null, 2),
          },
        ],
      }),
    );

    server.registerResource(
      `skill_instructions_${handle}`,
      instructionsUri,
      {
        title: `${skill.name} Instructions`,
        description: `Raw SKILL.md instructions for ${skill.name}.`,
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [
          {
            uri: instructionsUri,
            mimeType: "text/markdown",
            text: await readMarketplaceSkillInstructions(skill),
          },
        ],
      }),
    );

    if (!skill.marketplaceReady) {
      continue;
    }

    server.registerPrompt(
      `skill_${handle}`,
      {
        title: skill.name,
        description: `Load the ${skill.name} skill as a prompt.`,
        argsSchema: {
          consent: z.string().optional(),
          consentDecision: z.string().optional(),
          task: z.string().optional(),
        },
      },
      async (args) => {
        const consent = await resolveMarketplaceConsent({
          workspaceDir: params.workspaceDir,
          action: "execute",
          skill: {
            name: skill.name,
            version: skill.version,
            kind: skill.kind,
            permissions: skill.permissions,
            outputs: skill.outputs,
          },
          decision: resolveConsentDecision(args),
          actor: BRIDGE_ACTOR,
        });
        if (consent.status === "consent-required") {
          return buildPromptErrorResponse(formatConsentRequestText(consent.request));
        }
        if (consent.status === "denied") {
          return buildPromptErrorResponse(consent.message);
        }
        const execution = await executeMarketplaceSkill({
          workspaceDir: params.workspaceDir,
          skillName: skill.name,
          consent: true,
          config: params.config,
          access: params.access,
        });
        if (!execution.ok) {
          await appendSkillAuditEntry({
            workspaceDir: params.workspaceDir,
            skillName: skill.name,
            action: "execute",
            outcome: "failed",
            actor: BRIDGE_ACTOR,
            summary: execution.error,
          });
          return {
            description: execution.error,
            messages: [
              {
                role: "assistant",
                content: {
                  type: "text",
                  text: execution.error,
                },
              },
            ],
          };
        }
        await appendSkillAuditEntry({
          workspaceDir: params.workspaceDir,
          skillName: execution.skill.name,
          action: "execute",
          outcome: "completed",
          decision: consent.decision,
          actor: BRIDGE_ACTOR,
          summary:
            execution.skill.kind === "mcp-server"
              ? `Inspected MCP skill ${execution.skill.name}.`
              : `Executed skill ${execution.skill.name}.`,
        });
        return {
          description: `Prompt for ${skill.name}`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: buildSkillPromptText(
                  skill,
                  execution.instructions,
                  execution.mcp,
                  execution.access,
                  args.task,
                ),
              },
            },
          ],
        };
      },
    );

    server.registerTool(
      `skill_${handle}`,
      {
        description: `Execute the ${skill.name} skill inside its default isolated sandbox.`,
        inputSchema: {
          consent: z.string().optional(),
          consentDecision: z.string().optional(),
        },
        annotations: resolveToolAnnotations(skill),
      },
      async (args) => {
        const consent = await resolveMarketplaceConsent({
          workspaceDir: params.workspaceDir,
          action: "execute",
          skill: {
            name: skill.name,
            version: skill.version,
            kind: skill.kind,
            permissions: skill.permissions,
            outputs: skill.outputs,
          },
          decision: resolveConsentDecision(args),
          actor: BRIDGE_ACTOR,
        });
        if (consent.status === "consent-required") {
          return buildConsentRequiredToolResult({
            action: "execute",
            skillName: skill.name,
            request: consent.request,
          });
        }
        if (consent.status === "denied") {
          return buildDeniedToolResult({
            action: "execute",
            skillName: skill.name,
            message: consent.message,
          });
        }
        const execution = await executeMarketplaceSkill({
          workspaceDir: params.workspaceDir,
          skillName: skill.name,
          consent: true,
          config: params.config,
          access: params.access,
        });
        if (!execution.ok) {
          await appendSkillAuditEntry({
            workspaceDir: params.workspaceDir,
            skillName: skill.name,
            action: "execute",
            outcome: "failed",
            actor: BRIDGE_ACTOR,
            summary: execution.error,
          });
          return {
            isError: true,
            content: [{ type: "text", text: execution.error }],
          };
        }
        await appendSkillAuditEntry({
          workspaceDir: params.workspaceDir,
          skillName: execution.skill.name,
          action: "execute",
          outcome: "completed",
          decision: consent.decision,
          actor: BRIDGE_ACTOR,
          summary:
            execution.skill.kind === "mcp-server"
              ? `Inspected MCP skill ${execution.skill.name}.`
              : `Executed skill ${execution.skill.name}.`,
        });
        return {
          structuredContent: {
            status: "completed",
            action: "execute",
            skill,
            manifest: skill.manifest,
            sandbox: execution.sandbox,
            instructions: execution.instructions,
            access: execution.access,
            mcp: execution.mcp,
            resources: {
              manifest: manifestUri,
              instructions: instructionsUri,
              catalog: catalogUri,
              audit: auditUri,
              consent: consentUri,
            },
          },
          content: [
            {
              type: "text",
              text: buildSkillPromptText(
                skill,
                execution.instructions,
                execution.mcp,
                execution.access,
              ),
            },
          ],
        };
      },
    );
  }

  return {
    server,
    skills,
  };
}
