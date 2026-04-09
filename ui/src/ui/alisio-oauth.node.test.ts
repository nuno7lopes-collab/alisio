/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALISIO_OPENAI_OAUTH_CHANNEL,
  ALISIO_OPENAI_OAUTH_SIGNAL_TYPE,
  ALISIO_OPENAI_OAUTH_STORAGE_KEY,
  LEGACY_ALISIO_OPENAI_OAUTH_CHANNEL,
  LEGACY_ALISIO_OPENAI_OAUTH_STORAGE_KEY,
  type AlisioOpenAiOAuthSignal,
} from "../../../src/shared/alisio-openai-oauth.js";
import { emitAlisioOpenAiOAuthSignal, refreshAfterAlisioOpenAiOAuth } from "./alisio-oauth.ts";

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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emite storage e BroadcastChannel canónicos e legacy", () => {
    const posted: Array<{ name: string; message: unknown }> = [];

    class BroadcastChannelMock {
      constructor(private readonly name: string) {}

      postMessage(message: unknown) {
        posted.push({ name: this.name, message });
      }

      close() {}
    }

    vi.stubGlobal("BroadcastChannel", BroadcastChannelMock);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");
    const signal: AlisioOpenAiOAuthSignal = {
      type: ALISIO_OPENAI_OAUTH_SIGNAL_TYPE,
      signalId: "signal-1",
      createdAtMs: 123,
    };

    expect(emitAlisioOpenAiOAuthSignal(signal)).toEqual(signal);
    expect(setItemSpy).toHaveBeenCalledWith(
      ALISIO_OPENAI_OAUTH_STORAGE_KEY,
      JSON.stringify(signal),
    );
    expect(setItemSpy).toHaveBeenCalledWith(
      LEGACY_ALISIO_OPENAI_OAUTH_STORAGE_KEY,
      JSON.stringify(signal),
    );
    expect(removeItemSpy).toHaveBeenCalledWith(ALISIO_OPENAI_OAUTH_STORAGE_KEY);
    expect(removeItemSpy).toHaveBeenCalledWith(LEGACY_ALISIO_OPENAI_OAUTH_STORAGE_KEY);
    expect(posted).toEqual([
      { name: ALISIO_OPENAI_OAUTH_CHANNEL, message: signal },
      { name: LEGACY_ALISIO_OPENAI_OAUTH_CHANNEL, message: signal },
    ]);
  });

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
      gatewayBootstrapUrl: "ws://127.0.0.1:40705",
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
