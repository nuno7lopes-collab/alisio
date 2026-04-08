import type { AlisioConfig } from "../../config/config.js";

type AgentToolsConfig = NonNullable<NonNullable<AlisioConfig["agents"]>["list"]>[number]["tools"];
type SandboxToolsConfig = {
  allow?: string[];
  deny?: string[];
};

export function createRestrictedAgentSandboxConfig(params: {
  agentTools?: AgentToolsConfig;
  globalSandboxTools?: SandboxToolsConfig;
  workspace?: string;
}): AlisioConfig {
  return {
    agents: {
      defaults: {
        sandbox: {
          mode: "all",
          scope: "agent",
        },
      },
      list: [
        {
          id: "restricted",
          workspace: params.workspace ?? "~/openclaw-restricted",
          sandbox: {
            mode: "all",
            scope: "agent",
          },
          ...(params.agentTools ? { tools: params.agentTools } : {}),
        },
      ],
    },
    ...(params.globalSandboxTools
      ? {
          tools: {
            sandbox: {
              tools: params.globalSandboxTools,
            },
          },
        }
      : {}),
  } as AlisioConfig;
}
