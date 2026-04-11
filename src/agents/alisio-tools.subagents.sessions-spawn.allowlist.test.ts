import { beforeEach, describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import {
  getCallGatewayMock,
  getSessionsSpawnTool,
  resetSessionsSpawnConfigOverride,
  setSessionsSpawnConfigOverride,
} from "./alisio-tools.subagents.sessions-spawn.test-harness.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";

const callGatewayMock = getCallGatewayMock();

describe("alisio-tools: subagents (sessions_spawn same-agent targeting)", () => {
  function mockAcceptedSpawn(acceptedAt: number) {
    let childSessionKey: string | undefined;
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      if (request.method === "agent") {
        const params = request.params as { sessionKey?: string } | undefined;
        childSessionKey = params?.sessionKey;
        return { runId: "run-1", status: "accepted", acceptedAt };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });
    return () => childSessionKey;
  }

  async function executeSpawn(callId: string, agentId: string, sandbox?: "inherit" | "require") {
    const tool = await getSessionsSpawnTool({
      agentSessionKey: "main",
      agentChannel: "whatsapp",
    });
    return tool.execute(callId, { task: "do thing", agentId, sandbox });
  }

  function setResearchUnsandboxedConfig(params?: { includeSandboxedDefault?: boolean }) {
    setSessionsSpawnConfigOverride({
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        ...(params?.includeSandboxedDefault
          ? {
              defaults: {
                sandbox: {
                  mode: "all",
                },
              },
            }
          : {}),
        list: [
          {
            id: "main",
          },
          {
            id: "research",
            sandbox: {
              mode: "off",
            },
          },
        ],
      },
    });
  }

  async function expectForbiddenCrossAgentSpawn(params: {
    agentId: string;
    callId: string;
    sandbox?: "inherit" | "require";
  }) {
    const result = await executeSpawn(params.callId, params.agentId, params.sandbox);
    const details = result.details as { status?: string; error?: string };
    expect(details.status).toBe("forbidden");
    expect(details.error).toContain('runtime="subagent" cannot target another agentId');
    expect(callGatewayMock).not.toHaveBeenCalled();
  }

  async function expectInvalidAgentId(callId: string, agentId: string) {
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        list: [{ id: "main" }],
      },
    });
    const tool = await getSessionsSpawnTool({
      agentSessionKey: "main",
      agentChannel: "whatsapp",
    });
    const result = await tool.execute(callId, { task: "do thing", agentId });
    const details = result.details as { status?: string; error?: string };
    expect(details.status).toBe("error");
    expect(details.error).toContain("Invalid agentId");
    expect(callGatewayMock).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    resetSessionsSpawnConfigOverride();
    resetSubagentRegistryForTests();
    callGatewayMock.mockClear();
  });

  it("sessions_spawn accepts explicit same-agent spawns", async () => {
    mockAcceptedSpawn(4_900);
    const result = await executeSpawn("call-same-agent", "main");
    expect(result.details).toMatchObject({
      status: "accepted",
      runId: "run-1",
    });
  });

  it("sessions_spawn only allows same-agent by default", async () => {
    await expectForbiddenCrossAgentSpawn({
      agentId: "beta",
      callId: "call6",
    });
  });

  it("sessions_spawn still rejects cross-agent spawns when the target agent exists", async () => {
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        list: [{ id: "main" }, { id: "beta" }],
      },
    });
    await expectForbiddenCrossAgentSpawn({
      agentId: "beta",
      callId: "call7",
    });
  });

  it("sessions_spawn rejects cross-agent spawns with multiple configured siblings", async () => {
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        list: [{ id: "main" }, { id: "beta" }, { id: "gamma" }],
      },
    });
    await expectForbiddenCrossAgentSpawn({
      agentId: "beta",
      callId: "call8",
    });
  });

  it("sessions_spawn still normalizes cross-agent ids before rejecting them", async () => {
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        list: [{ id: "main" }, { id: "research" }],
      },
    });
    await expectForbiddenCrossAgentSpawn({
      agentId: "research",
      callId: "call10",
    });
  });

  it("rejects cross-agent spawns before sandbox inheritance checks", async () => {
    setResearchUnsandboxedConfig({ includeSandboxedDefault: true });
    await expectForbiddenCrossAgentSpawn({
      agentId: "research",
      callId: "call11",
    });
  });

  it('rejects cross-agent spawns before sandbox="require" checks', async () => {
    setResearchUnsandboxedConfig();
    await expectForbiddenCrossAgentSpawn({
      agentId: "research",
      callId: "call12",
      sandbox: "require",
    });
  });
  // ---------------------------------------------------------------------------
  // agentId format validation (#31311)
  // ---------------------------------------------------------------------------

  it("rejects error-message-like strings as agentId (#31311)", async () => {
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        list: [{ id: "main" }, { id: "research" }],
      },
    });
    const tool = await getSessionsSpawnTool({
      agentSessionKey: "main",
      agentChannel: "whatsapp",
    });
    const result = await tool.execute("call-err-msg", {
      task: "do thing",
      agentId: "Agent not found: xyz",
    });
    const details = result.details as { status?: string; error?: string };
    expect(details.status).toBe("error");
    expect(details.error).toContain("Invalid agentId");
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("rejects agentId containing path separators (#31311)", async () => {
    await expectInvalidAgentId("call-path", "../../../etc/passwd");
  });

  it("rejects agentId exceeding 64 characters (#31311)", async () => {
    await expectInvalidAgentId("call-long", "a".repeat(65));
  });

  it("rejects well-formed cross-agent ids with hyphens and underscores when targeting another agent", async () => {
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        list: [{ id: "main" }, { id: "my-research_agent01" }],
      },
    });
    const result = await executeSpawn("call-valid", "my-research_agent01");
    const details = result.details as { status?: string; error?: string };
    expect(details.status).toBe("forbidden");
    expect(details.error).toContain('runtime="subagent" cannot target another agentId');
  });

  it("rejects unconfigured cross-agent ids", async () => {
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        list: [{ id: "main" }],
      },
    });
    const result = await executeSpawn("call-unconfigured", "research");
    const details = result.details as { status?: string; error?: string };
    expect(details.status).toBe("forbidden");
    expect(details.error).toContain('runtime="subagent" cannot target another agentId');
  });
});
