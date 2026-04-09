import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSubagentRegistryForTests } from "../../agents/subagent-registry.js";
import type { SpawnSubagentResult } from "../../agents/subagent-spawn.js";
import type { AlisioConfig } from "../../config/config.js";

const hoisted = vi.hoisted(() => {
  const spawnSubagentDirectMock = vi.fn();
  const callGatewayMock = vi.fn();
  return { spawnSubagentDirectMock, callGatewayMock };
});

let handleSubagentsCommand: typeof import("./commands-subagents.js").handleSubagentsCommand;
let buildCommandTestParams: typeof import("./commands-spawn.test-harness.js").buildCommandTestParams;

const { spawnSubagentDirectMock } = hoisted;

function acceptedResult(overrides?: Partial<SpawnSubagentResult>): SpawnSubagentResult {
  return {
    status: "accepted",
    childSessionKey: "agent:main:subagent:test-uuid",
    runId: "run-spawn-1",
    ...overrides,
  };
}

function forbiddenResult(error: string): SpawnSubagentResult {
  return {
    status: "forbidden",
    error,
  };
}

const baseCfg = {
  session: { mainKey: "main", scope: "per-sender" },
} satisfies AlisioConfig;

describe("/subagents spawn command", () => {
  afterEach(() => {
    vi.doUnmock("../../agents/subagent-spawn.js");
    vi.doUnmock("../../gateway/call.js");
    vi.doUnmock("../../config/config.js");
    vi.resetModules();
  });

  beforeEach(async () => {
    vi.doMock("../../agents/subagent-spawn.js", () => ({
      spawnSubagentDirect: (...args: unknown[]) => hoisted.spawnSubagentDirectMock(...args),
      SUBAGENT_SPAWN_MODES: ["run"],
    }));
    vi.doMock("../../gateway/call.js", () => ({
      callGateway: (opts: unknown) => hoisted.callGatewayMock(opts),
    }));
    vi.doMock("../../config/config.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../config/config.js")>();
      return {
        ...actual,
        loadConfig: () => ({}),
      };
    });
    ({ handleSubagentsCommand } = await import("./commands-subagents.js"));
    ({ buildCommandTestParams } = await import("./commands-spawn.test-harness.js"));
    resetSubagentRegistryForTests();
    spawnSubagentDirectMock.mockClear();
    hoisted.callGatewayMock.mockClear();
  });

  async function runSpawnWithFlag(
    flagSegment: string,
    result: SpawnSubagentResult = acceptedResult(),
  ) {
    spawnSubagentDirectMock.mockResolvedValue(result);
    const params = buildCommandTestParams(`/subagents spawn do the thing ${flagSegment}`, baseCfg);
    const commandResult = await handleSubagentsCommand(params, true);
    expect(commandResult).not.toBeNull();
    expect(commandResult?.reply?.text).toContain("Spawned subagent");
    const [spawnParams] = spawnSubagentDirectMock.mock.calls[0];
    return spawnParams as { model?: string; thinking?: string; task?: string };
  }

  async function runSuccessfulSpawn(params?: {
    commandText?: string;
    context?: Record<string, unknown>;
    mutateParams?: (commandParams: ReturnType<typeof buildCommandTestParams>) => void;
  }) {
    spawnSubagentDirectMock.mockResolvedValue(acceptedResult());
    const commandParams = buildCommandTestParams(
      params?.commandText ?? "/subagents spawn do the thing",
      baseCfg,
      params?.context,
    );
    params?.mutateParams?.(commandParams);
    const result = await handleSubagentsCommand(commandParams, true);
    expect(result).not.toBeNull();
    expect(result?.reply?.text).toContain("Spawned subagent");
    const [spawnParams, spawnCtx] = spawnSubagentDirectMock.mock.calls[0];
    return { spawnParams, spawnCtx, commandParams, commandResult: result };
  }

  it("shows usage when task is missing", async () => {
    const params = buildCommandTestParams("/subagents spawn", baseCfg);
    const result = await handleSubagentsCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.reply?.text).toContain("Usage:");
    expect(result?.reply?.text).toContain("/subagents spawn");
    expect(spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("accepts a single-word task", async () => {
    spawnSubagentDirectMock.mockResolvedValue(acceptedResult());
    const params = buildCommandTestParams("/subagents spawn summarize", baseCfg);
    const result = await handleSubagentsCommand(params, true);
    expect(result).not.toBeNull();
    const [spawnParams] = spawnSubagentDirectMock.mock.calls[0];
    expect(spawnParams.task).toBe("summarize");
  });

  it("spawns subagent and confirms reply text and child session key", async () => {
    const { spawnParams, spawnCtx, commandResult } = await runSuccessfulSpawn();
    expect(commandResult?.reply?.text).toContain("agent:main:subagent:test-uuid");
    expect(commandResult?.reply?.text).toContain("run-spaw");
    expect(spawnSubagentDirectMock).toHaveBeenCalledOnce();
    expect(spawnParams.task).toBe("do the thing");
    expect(spawnParams.agentId).toBeUndefined();
    expect(spawnParams.mode).toBe("run");
    expect(spawnParams.cleanup).toBe("keep");
    expect(spawnParams.expectsCompletionMessage).toBe(true);
    expect(spawnCtx.agentSessionKey).toBeDefined();
  });

  it("spawns with --model flag and passes model to spawnSubagentDirect", async () => {
    const spawnParams = await runSpawnWithFlag(
      "--model openai/gpt-4o",
      acceptedResult({ modelApplied: true }),
    );
    expect(spawnParams.model).toBe("openai/gpt-4o");
    expect(spawnParams.task).toBe("do the thing");
  });

  it("spawns with --thinking flag and passes thinking to spawnSubagentDirect", async () => {
    const spawnParams = await runSpawnWithFlag("--thinking high");
    expect(spawnParams.thinking).toBe("high");
    expect(spawnParams.task).toBe("do the thing");
  });

  it("passes group context from session entry to spawnSubagentDirect", async () => {
    const { spawnCtx } = await runSuccessfulSpawn({
      mutateParams: (commandParams) => {
        commandParams.sessionEntry = {
          sessionId: "session-main",
          updatedAt: Date.now(),
          groupId: "group-1",
          groupChannel: "#group-channel",
          space: "workspace-1",
        };
      },
    });
    expect(spawnCtx).toMatchObject({
      agentGroupId: "group-1",
      agentGroupChannel: "#group-channel",
      agentGroupSpace: "workspace-1",
    });
  });

  it("prefers CommandTargetSessionKey for native /subagents spawn", async () => {
    const { spawnCtx } = await runSuccessfulSpawn({
      context: {
        CommandSource: "native",
        CommandTargetSessionKey: "agent:main:main",
        OriginatingChannel: "discord",
        OriginatingTo: "channel:12345",
      },
      mutateParams: (commandParams) => {
        commandParams.sessionKey = "agent:main:slack:slash:u1";
      },
    });
    expect(spawnCtx.agentSessionKey).toBe("agent:main:main");
    expect(spawnCtx.agentChannel).toBe("discord");
    expect(spawnCtx.agentTo).toBe("channel:12345");
  });

  it("falls back to OriginatingTo for agentTo when command.to is missing", async () => {
    const { spawnCtx } = await runSuccessfulSpawn({
      context: {
        OriginatingTo: "channel:manual",
        To: "channel:fallback-from-to",
      },
      mutateParams: (commandParams) => {
        commandParams.command.to = undefined;
      },
    });
    expect(spawnCtx).toMatchObject({ agentTo: "channel:manual" });
  });
  it("surfaces spawn errors from the runtime", async () => {
    spawnSubagentDirectMock.mockResolvedValue(
      forbiddenResult(
        'runtime="subagent" cannot target another agentId. Internal subagents always run under the requester agent.',
      ),
    );
    const params = buildCommandTestParams("/subagents spawn do the thing", baseCfg);
    const result = await handleSubagentsCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.reply?.text).toContain("Spawn failed");
    expect(result?.reply?.text).toContain("cannot target another agentId");
  });

  it("spawns on the requester agent without an explicit agentId", async () => {
    await runSuccessfulSpawn();
    expect(spawnSubagentDirectMock).toHaveBeenCalledOnce();
  });

  it("ignores unauthorized sender (silent, no reply)", async () => {
    const params = buildCommandTestParams("/subagents spawn do the thing", baseCfg, {
      CommandAuthorized: false,
    });
    params.command.isAuthorizedSender = false;
    const result = await handleSubagentsCommand(params, true);
    expect(result).not.toBeNull();
    expect(result?.reply).toBeUndefined();
    expect(result?.shouldContinue).toBe(false);
    expect(spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("returns null when text commands disabled", async () => {
    const params = buildCommandTestParams("/subagents spawn do the thing", baseCfg);
    const result = await handleSubagentsCommand(params, false);
    expect(result).toBeNull();
    expect(spawnSubagentDirectMock).not.toHaveBeenCalled();
  });
});
