import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPerSenderSessionConfig } from "./test-helpers/session-config.js";

let configOverride: ReturnType<(typeof import("../config/config.js"))["loadConfig"]> = {
  session: createPerSenderSessionConfig(),
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
    resolveGatewayPort: () => 40705,
  };
});

import "./test-helpers/fast-core-tools.js";

let createAlisioTools: typeof import("./alisio-tools.js").createAlisioTools;

describe("agents_list", () => {
  type AgentConfig = NonNullable<NonNullable<typeof configOverride.agents>["list"]>[number];

  function setConfigWithAgentList(agentList: AgentConfig[]) {
    configOverride = {
      session: createPerSenderSessionConfig(),
      agents: {
        list: agentList,
      },
    };
  }

  function requireAgentsListTool() {
    const tool = createAlisioTools({
      agentSessionKey: "main",
    }).find((candidate) => candidate.name === "agents_list");
    if (!tool) {
      throw new Error("missing agents_list tool");
    }
    return tool;
  }

  function readAgentList(result: unknown) {
    return (result as { details?: { agents?: Array<{ id: string; configured?: boolean }> } })
      .details?.agents;
  }

  beforeEach(async () => {
    vi.resetModules();
    configOverride = {
      session: createPerSenderSessionConfig(),
    };
    await import("./test-helpers/fast-core-tools.js");
    ({ createAlisioTools } = await import("./alisio-tools.js"));
  });

  it("defaults to the requester agent only", async () => {
    const tool = requireAgentsListTool();
    const result = await tool.execute("call1", {});
    expect(result.details).toMatchObject({
      requester: "main",
      subagentMode: "same_agent_only",
    });
    const agents = readAgentList(result);
    expect(agents?.map((agent) => agent.id)).toEqual(["main"]);
  });

  it("keeps only the requester agent even when other agents are configured", async () => {
    setConfigWithAgentList([
      {
        id: "main",
        name: "Main",
      },
      {
        id: "research",
        name: "Research",
      },
    ]);

    const tool = requireAgentsListTool();
    const result = await tool.execute("call2", {});
    const agents = readAgentList(result);
    expect(agents?.map((agent) => agent.id)).toEqual(["main"]);
  });

  it("keeps only the requester agent even when multiple sibling agents exist", async () => {
    setConfigWithAgentList([
      {
        id: "main",
      },
      {
        id: "research",
        name: "Research",
      },
      {
        id: "coder",
        name: "Coder",
      },
    ]);

    const tool = requireAgentsListTool();
    const result = await tool.execute("call3", {});
    const agents = readAgentList(result);
    expect(agents?.map((agent) => agent.id)).toEqual(["main"]);
  });

  it("still marks the requester as unconfigured when it is not explicitly listed", async () => {
    setConfigWithAgentList([
      {
        id: "research",
      },
    ]);

    const tool = requireAgentsListTool();
    const result = await tool.execute("call4", {});
    const agents = readAgentList(result);
    expect(agents?.map((agent) => agent.id)).toEqual(["main"]);
    expect(agents?.[0]?.configured).toBe(false);
  });
});
