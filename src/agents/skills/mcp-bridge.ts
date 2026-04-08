import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AlisioConfig } from "../../config/config.js";
import { parseBooleanValue } from "../../utils/boolean.js";
import {
  buildSkillMarketplaceCatalog,
  executeMarketplaceSkill,
  installMarketplaceSkill,
  readMarketplaceSkillInstructions,
  resolveSkillMarketplaceCatalog,
} from "../skills.js";
import type { SkillCatalogEntry } from "../skills.js";
import type { SkillMarketplaceAccessContext } from "./marketplace-access.js";

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

function buildCatalogPayload(skills: SkillCatalogEntry[]) {
  return {
    generatedAt: new Date().toISOString(),
    total: skills.length,
    ready: skills.filter((skill) => skill.marketplaceReady).length,
    skills,
  };
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

export function createSkillsMarketplaceMcpBridge(params: {
  workspaceDir: string;
  config?: AlisioConfig;
  access?: SkillMarketplaceAccessContext;
}) {
  const skills = buildSkillMarketplaceCatalog({
    workspaceDir: params.workspaceDir,
    config: params.config,
  });
  const server = new McpServer({
    name: "alisio-skills-marketplace",
    version: "1.0.0",
  });

  server.registerResource(
    "skills_catalog",
    "skills://catalog",
    {
      title: "Skills Catalog",
      description: "Marketplace catalog for local skills.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "skills://catalog",
          mimeType: "application/json",
          text: JSON.stringify(
            buildCatalogPayload(
              await resolveSkillMarketplaceCatalog({
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

  server.registerTool(
    "skills_catalog",
    {
      description: "List marketplace skills and their manifest status.",
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
      const catalog = await resolveSkillMarketplaceCatalog({
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
      if (!parseMcpFlag(args.consent)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Explicit consent is required to install a skill into a workspace.",
            },
          ],
        };
      }
      const result = await installMarketplaceSkill({
        catalogWorkspaceDir: params.workspaceDir,
        targetWorkspaceDir: args.targetWorkspaceDir ?? params.workspaceDir,
        skillName: args.name,
        config: params.config,
        force: parseMcpFlag(args.force),
        access: params.access,
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: result.error }],
        };
      }
      return {
        structuredContent: {
          skill: result.skill,
          targetDir: result.targetDir,
          access: result.access,
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
          task: z.string().optional(),
        },
      },
      async (args) => {
        const execution = await executeMarketplaceSkill({
          workspaceDir: params.workspaceDir,
          skillName: skill.name,
          consent: parseMcpFlag(args.consent),
          config: params.config,
          access: params.access,
        });
        if (!execution.ok) {
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
        },
        annotations: resolveToolAnnotations(skill),
      },
      async (args) => {
        const execution = await executeMarketplaceSkill({
          workspaceDir: params.workspaceDir,
          skillName: skill.name,
          consent: parseMcpFlag(args.consent),
          config: params.config,
          access: params.access,
        });
        if (!execution.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: execution.error }],
          };
        }
        return {
          structuredContent: {
            skill,
            manifest: skill.manifest,
            sandbox: execution.sandbox,
            instructions: execution.instructions,
            access: execution.access,
            mcp: execution.mcp,
            resources: {
              manifest: manifestUri,
              instructions: instructionsUri,
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
