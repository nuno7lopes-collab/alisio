import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AlisioConfig } from "../../config/config.js";
import {
  listSkillAuditEntries,
  listSkillConsentGrants,
  resolveMarketplaceConsent,
} from "./marketplace-consent.js";
import {
  buildSkillMarketplaceCatalog,
  executeMarketplaceSkill,
  installMarketplaceSkill,
  removeMarketplaceSkill,
  resolveSkillMarketplaceCatalog,
} from "./marketplace.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeMarketplaceSkill(params: {
  workspaceDir: string;
  name: string;
  description: string;
  subscription?: {
    required: boolean;
    plan?: string;
    featureFlag?: string;
  };
}): Promise<void> {
  const skillDir = path.join(params.workspaceDir, "skills", params.name);
  const subscriptionBlock = params.subscription
    ? `
  subscription:
    required: ${params.subscription.required ? "true" : "false"}${
      params.subscription.plan ? `\n    plan: ${params.subscription.plan}` : ""
    }${
      params.subscription.featureFlag ? `\n    featureFlag: ${params.subscription.featureFlag}` : ""
    }`
    : "";
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: ${params.name}
description: ${params.description}
manifest:
  name: ${params.name}
  version: 1.0.0
  description: ${params.description}
  permissions:
    consent: explicit
    sandbox:
      mode: isolated
      filesystem: read-only
      network: off
  outputs:
    primary: instructions
    formats:
      - text/markdown
  compat:
    runtimes:
      - alisio${subscriptionBlock}
---

# ${params.name}

${params.description}
`,
    "utf8",
  );
}

function buildLocalMcpServerScript(): string {
  return `
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "toolbox", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Echo text",
    inputSchema: { text: z.string().optional() },
  },
  async (args) => ({
    structuredContent: { text: args.text ?? "pong" },
    content: [{ type: "text", text: args.text ?? "pong" }],
  }),
);

server.registerPrompt(
  "help",
  {
    description: "Explain capabilities",
    argsSchema: { topic: z.string().optional() },
  },
  async (args) => ({
    description: "Help prompt",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: args.topic ? "Help " + args.topic : "Help general",
        },
      },
    ],
  }),
);

server.registerResource(
  "toolbox_info",
  "toolbox://info",
  {
    title: "Toolbox Info",
    description: "Toolbox resource",
    mimeType: "text/plain",
  },
  async () => ({
    contents: [{ uri: "toolbox://info", mimeType: "text/plain", text: "toolbox" }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
`.trim();
}

function buildLocalMcpConfig(): AlisioConfig {
  return {
    mcp: {
      servers: {
        toolbox: {
          command: process.execPath,
          args: ["--input-type=module", "--eval", buildLocalMcpServerScript()],
          cwd: repoRoot,
        },
      },
    },
  } as AlisioConfig;
}

describe("skills marketplace", () => {
  it("catalogs marketplace-ready repo skills with explicit manifests", () => {
    const catalog = buildSkillMarketplaceCatalog({
      workspaceDir: repoRoot,
    });
    const mcporter = catalog.find((entry) => entry.name === "mcporter");

    expect(mcporter).toBeDefined();
    expect(mcporter?.marketplaceReady).toBe(true);
    expect(mcporter?.manifestSource).toBe("manifest");
    expect(mcporter?.manifestValid).toBe(true);
    expect(mcporter?.manifest.outputs.primary).toBe("instructions");
    expect(mcporter?.manifest.compat.mcp?.capabilities).toContain("tools");
  });

  it("installs a marketplace-ready repo skill into another workspace", async () => {
    const targetWorkspace = await makeTempDir("alisio-marketplace-install-");
    const result = await installMarketplaceSkill({
      catalogWorkspaceDir: repoRoot,
      targetWorkspaceDir: targetWorkspace,
      skillName: "mcporter",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const installedSkillMd = path.join(result.targetDir, "SKILL.md");
    await expect(fs.readFile(installedSkillMd, "utf8")).resolves.toContain("name: mcporter");
  });

  it("executes a marketplace-ready repo skill inside the default isolated sandbox", async () => {
    const rejected = await executeMarketplaceSkill({
      workspaceDir: repoRoot,
      skillName: "mcporter",
    });
    expect(rejected.ok).toBe(false);

    const accepted = await executeMarketplaceSkill({
      workspaceDir: repoRoot,
      skillName: "mcporter",
      consent: true,
    });

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.skill.marketplaceReady).toBe(true);
    expect(accepted.sandbox).toEqual({
      mode: "isolated",
      filesystem: "read-only",
      network: "off",
    });
    expect(accepted.instructions).toContain("# mcporter");
  });

  it("removes an installed marketplace skill even when its subscription is no longer allowed", async () => {
    const catalogWorkspace = await makeTempDir("alisio-marketplace-remove-catalog-");
    const targetWorkspace = await makeTempDir("alisio-marketplace-remove-target-");
    await writeMarketplaceSkill({
      workspaceDir: catalogWorkspace,
      name: "plus-skill",
      description: "Paid skill",
      subscription: {
        required: true,
        plan: "plus",
      },
    });

    const installed = await installMarketplaceSkill({
      catalogWorkspaceDir: catalogWorkspace,
      targetWorkspaceDir: targetWorkspace,
      skillName: "plus-skill",
      access: {
        currentPlan: "plus",
      },
    });
    expect(installed.ok).toBe(true);
    if (!installed.ok) {
      return;
    }

    const removed = await removeMarketplaceSkill({
      workspaceDir: targetWorkspace,
      skillName: "plus-skill",
      access: {
        currentPlan: "free",
      },
    });

    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }
    await expect(fs.access(removed.removedDir)).rejects.toThrow();
  });

  it("surfaces configured local MCP servers as virtual marketplace skills", async () => {
    const config = buildLocalMcpConfig();
    const catalog = buildSkillMarketplaceCatalog({
      workspaceDir: repoRoot,
      config,
    });
    const toolbox = catalog.find((entry) => entry.name === "mcp:toolbox");

    expect(toolbox).toBeDefined();
    expect(toolbox).toMatchObject({
      kind: "mcp-server",
      marketplaceReady: true,
      source: "alisio-mcp",
      permissions: {
        consent: "explicit",
        mcp: {
          consume: true,
        },
      },
    });
    expect(toolbox?.manifest.outputs.primary).toBe("tool");
    expect(toolbox?.manifest.compat.mcp?.transports).toEqual(["stdio"]);

    const rejected = await executeMarketplaceSkill({
      workspaceDir: repoRoot,
      skillName: "mcp:toolbox",
      config,
    });
    expect(rejected.ok).toBe(false);

    const accepted = await executeMarketplaceSkill({
      workspaceDir: repoRoot,
      skillName: "mcp:toolbox",
      consent: true,
      config,
    });

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.mcp).toMatchObject({
      serverName: "toolbox",
      transport: "stdio",
      toolCount: 1,
      promptCount: 1,
      resourceCount: 1,
    });
    expect(accepted.instructions).toContain("Tools (1)");
    expect(accepted.instructions).toContain("Prompts (1)");
    expect(accepted.instructions).toContain("Resources (1)");
  });

  it("enforces subscription access in catalog, install, and execute flows", async () => {
    const workspaceDir = await makeTempDir("alisio-marketplace-paid-");
    const targetWorkspace = await makeTempDir("alisio-marketplace-paid-target-");
    await writeMarketplaceSkill({
      workspaceDir,
      name: "plus-skill",
      description: "Paid skill",
      subscription: {
        required: true,
        plan: "plus",
      },
    });

    const catalog = await resolveSkillMarketplaceCatalog({
      workspaceDir,
      access: {
        currentPlan: "free",
      },
    });
    const plusSkill = catalog.find((entry) => entry.name === "plus-skill");
    expect(plusSkill?.access.allowed).toBe(false);
    expect(plusSkill?.access.currentPlan).toBe("free");

    const deniedInstall = await installMarketplaceSkill({
      catalogWorkspaceDir: workspaceDir,
      targetWorkspaceDir: targetWorkspace,
      skillName: "plus-skill",
      access: {
        currentPlan: "free",
      },
    });
    expect(deniedInstall.ok).toBe(false);

    const deniedExecution = await executeMarketplaceSkill({
      workspaceDir,
      skillName: "plus-skill",
      consent: true,
      access: {
        currentPlan: "free",
      },
    });
    expect(deniedExecution.ok).toBe(false);

    const allowedExecution = await executeMarketplaceSkill({
      workspaceDir,
      skillName: "plus-skill",
      consent: true,
      access: {
        currentPlan: "plus",
      },
    });
    expect(allowedExecution.ok).toBe(true);
    if (!allowedExecution.ok) {
      return;
    }
    expect(allowedExecution.access.allowed).toBe(true);
    expect(allowedExecution.access.currentPlan).toBe("plus");
  });

  it("persists consent grants and audit entries for marketplace actions", async () => {
    const stateDir = await makeTempDir("alisio-marketplace-consent-state-");
    const previousStateDir = process.env.ALISIO_STATE_DIR;
    process.env.ALISIO_STATE_DIR = stateDir;

    try {
      const skill = {
        name: "mcporter",
        version: "1.0.0",
        permissions: {
          consent: "explicit" as const,
          sandbox: {
            mode: "isolated" as const,
            filesystem: "read-only" as const,
            network: "off" as const,
          },
        },
        outputs: {
          primary: "instructions" as const,
          formats: ["text/markdown"],
        },
      };

      const initial = await resolveMarketplaceConsent({
        workspaceDir: repoRoot,
        action: "execute",
        skill,
        actor: "test-user",
      });
      expect(initial.status).toBe("consent-required");

      const granted = await resolveMarketplaceConsent({
        workspaceDir: repoRoot,
        action: "execute",
        skill,
        decision: "allow-always",
        actor: "test-user",
      });
      expect(granted).toMatchObject({
        status: "granted",
        decision: "allow-always",
      });

      const grants = await listSkillConsentGrants({
        workspaceDir: repoRoot,
        skillName: "mcporter",
      });
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({
        workspaceDir: repoRoot,
        skillName: "mcporter",
        action: "execute",
        decision: "allow-always",
      });

      const reused = await resolveMarketplaceConsent({
        workspaceDir: repoRoot,
        action: "execute",
        skill,
      });
      expect(reused).toMatchObject({
        status: "granted",
        decision: "allow-always",
      });

      const auditEntries = await listSkillAuditEntries({
        workspaceDir: repoRoot,
        skillName: "mcporter",
      });
      expect(auditEntries.map((entry) => entry.outcome)).toEqual(
        expect.arrayContaining(["requested", "granted"]),
      );
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.ALISIO_STATE_DIR;
      } else {
        process.env.ALISIO_STATE_DIR = previousStateDir;
      }
    }
  });
});
