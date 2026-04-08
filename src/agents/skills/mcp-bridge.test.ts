import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const serverScriptPath = path.join(repoRoot, "src", "agents", "skills-mcp-serve.ts");

const transports: StdioClientTransport[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0, clients.length).map((client) => client.close()));
  await Promise.allSettled(
    transports.splice(0, transports.length).map((transport) => transport.close()),
  );
  await Promise.allSettled(
    tempDirs
      .splice(0, tempDirs.length)
      .map((dir) =>
        import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true })),
      ),
  );
});

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
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

function readTextContent(
  content:
    | { uri: string; text: string; mimeType?: string }
    | { uri: string; blob: string; mimeType?: string }
    | undefined,
): string {
  return content && "text" in content ? content.text : "";
}

async function connectClient(params?: {
  workspaceDir?: string;
  mcpServerConfig?: Record<string, Record<string, unknown>>;
  marketplacePlan?: "free" | "plus";
  skillFeatures?: string[];
}): Promise<Client> {
  const workspaceDir = params?.workspaceDir ?? repoRoot;
  const args = ["--import", "tsx", serverScriptPath, "--workspace", workspaceDir];
  if (params?.mcpServerConfig) {
    args.push("--mcp-config-json", JSON.stringify(params.mcpServerConfig));
  }
  if (params?.marketplacePlan) {
    args.push("--marketplace-plan", params.marketplacePlan);
  }
  if (params?.skillFeatures && params.skillFeatures.length > 0) {
    args.push("--skill-features", params.skillFeatures.join(","));
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    cwd: repoRoot,
    stderr: "pipe",
  });
  const client = new Client({
    name: "skills-mcp-test",
    version: "1.0.0",
  });
  transports.push(transport);
  clients.push(client);
  await client.connect(transport);
  return client;
}

async function createWorkspaceWithLocalMcpSkillBridge(): Promise<string> {
  const fs = await import("node:fs/promises");
  const workspaceDir = await makeTempDir("alisio-skills-mcp-bridge-");
  const skillDir = path.join(workspaceDir, "skills", "mcporter");
  await fs.mkdir(path.dirname(skillDir), { recursive: true });
  await fs.cp(path.join(repoRoot, "skills", "mcporter"), skillDir, {
    recursive: true,
    force: true,
  });
  return workspaceDir;
}

async function createWorkspaceWithSubscriptionSkill(params: {
  name: string;
  plan: "free" | "plus";
  featureFlag?: string;
}): Promise<string> {
  const fs = await import("node:fs/promises");
  const workspaceDir = await makeTempDir("alisio-skills-mcp-subscription-");
  const skillDir = path.join(workspaceDir, "skills", params.name);
  await fs.mkdir(skillDir, { recursive: true });
  const featureFlagBlock = params.featureFlag ? `\n    featureFlag: ${params.featureFlag}` : "";
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: ${params.name}
description: Subscription skill
manifest:
  name: ${params.name}
  version: 1.0.0
  description: Subscription skill
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
      - alisio
  subscription:
    required: true
    plan: ${params.plan}${featureFlagBlock}
---

# ${params.name}

Subscription skill.
`,
    "utf8",
  );
  return workspaceDir;
}

describe("skills MCP bridge", () => {
  it("exposes catalog resources, prompts, and marketplace-ready skill tools over stdio", async () => {
    const client = await connectClient();

    const resources = await client.listResources();
    const prompts = await client.listPrompts();
    const tools = await client.listTools();

    expect(resources.resources.some((resource) => resource.uri === "skills://catalog")).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === "skills://audit")).toBe(true);
    expect(resources.resources.some((resource) => resource.uri === "skills://consent-grants")).toBe(
      true,
    );
    expect(prompts.prompts.some((prompt) => prompt.name === "skill_mcporter")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "skill_mcporter")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "skills_install")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "skills_remove")).toBe(true);
  });

  it("executes a marketplace-ready repo skill through the MCP bridge", async () => {
    const client = await connectClient();

    const rejected = await client.callTool({
      name: "skill_mcporter",
      arguments: {},
    });
    expect(rejected.isError).toBe(true);

    const accepted = await client.callTool({
      name: "skill_mcporter",
      arguments: { consent: "true" },
    });
    expect(accepted.isError).not.toBe(true);
    expect(accepted.structuredContent).toMatchObject({
      skill: {
        name: "mcporter",
        marketplaceReady: true,
      },
      sandbox: {
        mode: "isolated",
        filesystem: "read-only",
        network: "off",
      },
    });

    const prompt = await client.getPrompt({
      name: "skill_mcporter",
      arguments: { consent: "true", task: "Inspect configured MCP servers" },
    });
    const promptText = prompt.messages
      .map((message) =>
        message.content.type === "text" && typeof message.content.text === "string"
          ? message.content.text
          : "",
      )
      .join("\n");
    expect(promptText).toContain("Inspect configured MCP servers");
    expect(promptText).toContain("# mcporter");

    const catalogResource = await client.readResource({
      uri: "skills://catalog",
    });
    expect(readTextContent(catalogResource.contents[0])).toContain('"mcporter"');
  });

  it("installs and removes a marketplace skill with explicit bridge consent", async () => {
    const targetWorkspace = await makeTempDir("alisio-skills-marketplace-target-");
    const client = await connectClient();

    const installRequiresConsent = await client.callTool({
      name: "skills_install",
      arguments: {
        name: "mcporter",
        targetWorkspaceDir: targetWorkspace,
      },
    });
    expect(installRequiresConsent.isError).toBe(true);
    expect(installRequiresConsent.structuredContent).toMatchObject({
      status: "consent-required",
      action: "install",
      skillName: "mcporter",
    });

    const installed = await client.callTool({
      name: "skills_install",
      arguments: {
        name: "mcporter",
        targetWorkspaceDir: targetWorkspace,
        consentDecision: "allow-always",
      },
    });
    expect(installed.isError).not.toBe(true);
    expect(installed.structuredContent).toMatchObject({
      status: "completed",
      action: "install",
      skill: {
        name: "mcporter",
      },
    });

    const installedSkillPath = path.join(targetWorkspace, "skills", "mcporter", "SKILL.md");
    await expect(
      import("node:fs/promises").then((fs) => fs.access(installedSkillPath)),
    ).resolves.toBe(undefined);

    const removeRequiresConsent = await client.callTool({
      name: "skills_remove",
      arguments: {
        name: "mcporter",
        targetWorkspaceDir: targetWorkspace,
      },
    });
    expect(removeRequiresConsent.isError).toBe(true);
    expect(removeRequiresConsent.structuredContent).toMatchObject({
      status: "consent-required",
      action: "remove",
      skillName: "mcporter",
    });

    const removed = await client.callTool({
      name: "skills_remove",
      arguments: {
        name: "mcporter",
        targetWorkspaceDir: targetWorkspace,
        consentDecision: "allow-once",
      },
    });
    expect(removed.isError).not.toBe(true);
    expect(removed.structuredContent).toMatchObject({
      status: "completed",
      action: "remove",
      skill: {
        name: "mcporter",
      },
    });
    await expect(
      import("node:fs/promises").then((fs) => fs.access(installedSkillPath)),
    ).rejects.toThrow();
  });

  it("exposes configured local MCP servers as virtual skills over the bridge", async () => {
    const workspaceDir = await createWorkspaceWithLocalMcpSkillBridge();
    const client = await connectClient({
      workspaceDir,
      mcpServerConfig: {
        toolbox: {
          command: process.execPath,
          args: ["--input-type=module", "--eval", buildLocalMcpServerScript()],
          cwd: repoRoot,
        },
      },
    });

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "skill_mcp_toolbox")).toBe(true);

    const manifestResource = await client.readResource({
      uri: "skills://skill/mcp%3Atoolbox/manifest",
    });
    const manifestText = readTextContent(manifestResource.contents[0]);
    expect(manifestText).toContain('"name": "mcp:toolbox"');
    expect(manifestText).toContain('"outputs"');
    expect(manifestText).toContain('"compat"');

    const accepted = await client.callTool({
      name: "skill_mcp_toolbox",
      arguments: { consent: "true" },
    });
    expect(accepted.isError).not.toBe(true);
    expect(accepted.structuredContent).toMatchObject({
      skill: {
        name: "mcp:toolbox",
        kind: "mcp-server",
      },
      mcp: {
        serverName: "toolbox",
        toolCount: 1,
        promptCount: 1,
        resourceCount: 1,
      },
    });

    const prompt = await client.getPrompt({
      name: "skill_mcp_toolbox",
      arguments: { consent: "true", task: "Enumerate toolbox capabilities" },
    });
    const promptText = prompt.messages
      .map((message) =>
        message.content.type === "text" && typeof message.content.text === "string"
          ? message.content.text
          : "",
      )
      .join("\n");
    expect(promptText).toContain("Enumerate toolbox capabilities");
    expect(promptText).toContain("Resolved MCP capabilities: tools=1, prompts=1, resources=1.");
  });

  it("persists approvals and audit entries for virtual MCP skills over the bridge", async () => {
    const previousStateDir = process.env.ALISIO_STATE_DIR;
    const stateDir = await makeTempDir("alisio-skills-mcp-state-");
    process.env.ALISIO_STATE_DIR = stateDir;

    try {
      const workspaceDir = await createWorkspaceWithLocalMcpSkillBridge();
      const client = await connectClient({
        workspaceDir,
        mcpServerConfig: {
          toolbox: {
            command: process.execPath,
            args: ["--input-type=module", "--eval", buildLocalMcpServerScript()],
            cwd: repoRoot,
          },
        },
      });

      const requiresConsent = await client.callTool({
        name: "skill_mcp_toolbox",
        arguments: {},
      });
      expect(requiresConsent.isError).toBe(true);
      expect(requiresConsent.structuredContent).toMatchObject({
        status: "consent-required",
        action: "execute",
        skillName: "mcp:toolbox",
      });

      const allowed = await client.callTool({
        name: "skill_mcp_toolbox",
        arguments: { consentDecision: "allow-always" },
      });
      expect(allowed.isError).not.toBe(true);

      const reused = await client.callTool({
        name: "skill_mcp_toolbox",
        arguments: {},
      });
      expect(reused.isError).not.toBe(true);

      const consentResource = await client.readResource({
        uri: "skills://consent-grants",
      });
      const consentText = readTextContent(consentResource.contents[0]);
      expect(consentText).toContain('"skillName": "mcp:toolbox"');
      expect(consentText).toContain('"decision": "allow-always"');

      const auditResource = await client.readResource({
        uri: "skills://audit",
      });
      const auditText = readTextContent(auditResource.contents[0]);
      expect(auditText).toContain('"skillName": "mcp:toolbox"');
      expect(auditText).toContain('"outcome": "completed"');
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.ALISIO_STATE_DIR;
      } else {
        process.env.ALISIO_STATE_DIR = previousStateDir;
      }
    }
  });

  it("surfaces marketplace access gates over the bridge", async () => {
    const workspaceDir = await createWorkspaceWithSubscriptionSkill({
      name: "plus-skill",
      plan: "plus",
    });

    const freeClient = await connectClient({
      workspaceDir,
      marketplacePlan: "free",
    });
    const freeCatalog = await freeClient.callTool({
      name: "skills_catalog",
      arguments: {},
    });
    expect(JSON.stringify(freeCatalog.structuredContent)).toContain('"allowed":false');

    const denied = await freeClient.callTool({
      name: "skill_plus_skill",
      arguments: { consent: "true" },
    });
    expect(denied.isError).toBe(true);

    const plusClient = await connectClient({
      workspaceDir,
      marketplacePlan: "plus",
    });
    const accepted = await plusClient.callTool({
      name: "skill_plus_skill",
      arguments: { consent: "true" },
    });
    expect(accepted.isError).not.toBe(true);
    expect(accepted.structuredContent).toMatchObject({
      access: {
        allowed: true,
        currentPlan: "plus",
      },
    });
  });
});
