import path from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config/config.js";
import { normalizeConfiguredMcpServers } from "../config/mcp-config.js";
import { routeLogsToStderr } from "../logging/console.js";
import { isAlisioPlan } from "../shared/alisio-billing.js";
import type { SkillMarketplaceAccessContext } from "./skills/marketplace-access.js";
import { createSkillsMarketplaceMcpBridge } from "./skills/mcp-bridge.js";

function readArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === name) {
      return args[index + 1];
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

function resolveWorkspaceDir(): string {
  const arg = readArg("--workspace") ?? readArg("-w");
  return path.resolve(arg?.trim() || process.cwd());
}

function resolveMcpServerOverrides(): Record<string, Record<string, unknown>> | undefined {
  const raw = readArg("--mcp-config-json");
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    return normalizeConfiguredMcpServers(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `Invalid --mcp-config-json payload: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function resolveMarketplaceAccessOverrides(): SkillMarketplaceAccessContext | undefined {
  const planRaw = readArg("--marketplace-plan");
  const featureFlagsRaw = readArg("--skill-features") ?? readArg("--marketplace-features");
  const planValue = planRaw?.trim().toLowerCase();
  if (planValue && !isAlisioPlan(planValue)) {
    throw new Error(`Invalid --marketplace-plan value: ${planRaw}`);
  }
  const currentPlan = planValue && isAlisioPlan(planValue) ? planValue : undefined;
  const enabledFeatureFlags = featureFlagsRaw
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!currentPlan && (!enabledFeatureFlags || enabledFeatureFlags.length === 0)) {
    return undefined;
  }
  return {
    ...(currentPlan ? { currentPlan } : {}),
    ...(enabledFeatureFlags?.length ? { enabledFeatureFlags } : {}),
  };
}

export async function serveSkillsMarketplaceMcp(): Promise<void> {
  routeLogsToStderr();
  const config = loadConfig();
  const mcpServerOverrides = resolveMcpServerOverrides();
  const marketplaceAccessOverrides = resolveMarketplaceAccessOverrides();
  if (mcpServerOverrides && Object.keys(mcpServerOverrides).length > 0) {
    config.mcp = {
      ...config.mcp,
      servers: {
        ...normalizeConfiguredMcpServers(config.mcp?.servers),
        ...mcpServerOverrides,
      },
    };
  }
  const workspaceDir = resolveWorkspaceDir();
  const bridge = createSkillsMarketplaceMcpBridge({
    workspaceDir,
    config,
    access: marketplaceAccessOverrides,
  });
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdin.off("end", shutdown);
    process.stdin.off("close", shutdown);
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    void bridge.server.close();
  };

  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (bridge.skills.length === 0) {
    process.stderr.write(`skills-mcp-serve: no skills found in ${workspaceDir}\n`);
  }

  await bridge.server.connect(transport);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  serveSkillsMarketplaceMcp().catch((error) => {
    process.stderr.write(
      `skills-mcp-serve: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
