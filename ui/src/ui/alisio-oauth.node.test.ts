import { describe, expect, it, vi } from "vitest";
import { refreshAfterAlisioOpenAiOAuth } from "./alisio-oauth.ts";

const loadControlUiBootstrapConfigMock = vi.hoisted(() => vi.fn(async () => undefined));
const connectGatewayMock = vi.hoisted(() => vi.fn());

vi.mock("./controllers/control-ui-bootstrap.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./controllers/control-ui-bootstrap.ts")>();
  return {
    ...actual,
    loadControlUiBootstrapConfig: loadControlUiBootstrapConfigMock,
  };
});

vi.mock("./app-gateway.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./app-gateway.ts")>();
  return {
    ...actual,
    connectGateway: connectGatewayMock,
  };
});

describe("refreshAfterAlisioOpenAiOAuth", () => {
  it("reloads the bootstrap and reconnects the gateway", async () => {
    const host = {
      basePath: "",
      assistantName: "Alisio",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      alisioStartupLoading: false,
      alisioStartupError: null,
      alisioStartupBootstrap: null,
      gatewayBootstrapUrl: "ws://127.0.0.1:18789",
      gatewayBootstrapToken: "fresh-token",
      clientInstanceId: "instance-1",
      client: null,
      connected: true,
      hello: null,
      lastError: null,
      lastErrorCode: null,
      eventLogBuffer: [],
      eventLog: [],
      tab: "setup",
      presenceEntries: [],
      presenceError: null,
      presenceStatus: null,
      agentsLoading: false,
      agentsList: null,
      agentsError: null,
      healthLoading: false,
      healthResult: null,
      healthError: null,
      debugHealth: null,
      sessionKey: "main",
      chatRunId: null,
      refreshSessionsAfterChat: new Set<string>(),
      execApprovalQueue: [],
      execApprovalError: null,
      updateAvailable: null,
    };

    await refreshAfterAlisioOpenAiOAuth(
      host as unknown as Parameters<typeof refreshAfterAlisioOpenAiOAuth>[0],
    );

    expect(loadControlUiBootstrapConfigMock).toHaveBeenCalledTimes(1);
    expect(connectGatewayMock).toHaveBeenCalledTimes(1);
  });
});
