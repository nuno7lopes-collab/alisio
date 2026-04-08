import { beforeEach, describe, expect, it, vi } from "vitest";

const lazyHandlerMocks = vi.hoisted(() => ({
  modelsModuleLoaded: vi.fn(),
  modelsHandler: vi.fn(async () => true),
  embeddingsModuleLoaded: vi.fn(),
  embeddingsHandler: vi.fn(async () => true),
  toolsModuleLoaded: vi.fn(),
  toolsHandler: vi.fn(async () => true),
  openResponsesModuleLoaded: vi.fn(),
  openResponsesHandler: vi.fn(async () => true),
  openAiModuleLoaded: vi.fn(),
  openAiHandler: vi.fn(async () => true),
  slackModuleLoaded: vi.fn(),
  slackHandler: vi.fn(async () => true),
}));

vi.mock("./models-http.js", () => {
  lazyHandlerMocks.modelsModuleLoaded();
  return { handleOpenAiModelsHttpRequest: lazyHandlerMocks.modelsHandler };
});

vi.mock("./embeddings-http.js", () => {
  lazyHandlerMocks.embeddingsModuleLoaded();
  return { handleOpenAiEmbeddingsHttpRequest: lazyHandlerMocks.embeddingsHandler };
});

vi.mock("./tools-invoke-http.js", () => {
  lazyHandlerMocks.toolsModuleLoaded();
  return { handleToolsInvokeHttpRequest: lazyHandlerMocks.toolsHandler };
});

vi.mock("./openresponses-http.js", () => {
  lazyHandlerMocks.openResponsesModuleLoaded();
  return { handleOpenResponsesHttpRequest: lazyHandlerMocks.openResponsesHandler };
});

vi.mock("./openai-http.js", () => {
  lazyHandlerMocks.openAiModuleLoaded();
  return { handleOpenAiHttpRequest: lazyHandlerMocks.openAiHandler };
});

vi.mock("../plugin-sdk/slack.js", () => {
  lazyHandlerMocks.slackModuleLoaded();
  return { handleSlackHttpRequest: lazyHandlerMocks.slackHandler };
});

describe("server-http lazy handler loading", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function loadHarness() {
    return await import("./server-http.test-harness.js");
  }

  it("does not load API handlers during server creation or health probes", async () => {
    const { AUTH_TOKEN, createTestGatewayServer, sendRequest, withGatewayTempConfig } =
      await loadHarness();

    await withGatewayTempConfig("openclaw-gateway-http-lazy-", async () => {
      const server = createTestGatewayServer({
        resolvedAuth: AUTH_TOKEN,
        overrides: {
          openAiChatCompletionsEnabled: true,
          openResponsesEnabled: true,
        },
      });

      expect(lazyHandlerMocks.modelsModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.embeddingsModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.toolsModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.openResponsesModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.openAiModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.slackModuleLoaded).not.toHaveBeenCalled();

      const response = await sendRequest(server, { path: "/health" });
      expect(response.res.statusCode).toBe(200);

      expect(lazyHandlerMocks.modelsModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.embeddingsModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.toolsModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.openResponsesModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.openAiModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.slackModuleLoaded).not.toHaveBeenCalled();
    });
  });

  it("loads the models handler only for /v1/models", async () => {
    const { AUTH_TOKEN, createTestGatewayServer, sendRequest, withGatewayTempConfig } =
      await loadHarness();

    await withGatewayTempConfig("openclaw-gateway-http-models-lazy-", async () => {
      const server = createTestGatewayServer({
        resolvedAuth: AUTH_TOKEN,
        overrides: {
          openAiChatCompletionsEnabled: true,
          openResponsesEnabled: true,
        },
      });

      await sendRequest(server, { path: "/v1/models" });

      expect(lazyHandlerMocks.modelsModuleLoaded).toHaveBeenCalledTimes(1);
      expect(lazyHandlerMocks.modelsHandler).toHaveBeenCalledTimes(1);
      expect(lazyHandlerMocks.embeddingsModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.toolsModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.openResponsesModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.openAiModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.slackModuleLoaded).not.toHaveBeenCalled();
    });
  });

  it("loads each heavy handler only when its route is requested", async () => {
    const { AUTH_TOKEN, createTestGatewayServer, sendRequest, withGatewayTempConfig } =
      await loadHarness();

    await withGatewayTempConfig("openclaw-gateway-http-route-lazy-", async () => {
      const server = createTestGatewayServer({
        resolvedAuth: AUTH_TOKEN,
        overrides: {
          openAiChatCompletionsEnabled: true,
          openResponsesEnabled: true,
        },
      });

      await sendRequest(server, { path: "/v1/embeddings" });
      expect(lazyHandlerMocks.embeddingsModuleLoaded).toHaveBeenCalledTimes(1);
      expect(lazyHandlerMocks.toolsModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.openResponsesModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.openAiModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.slackModuleLoaded).not.toHaveBeenCalled();

      await sendRequest(server, { path: "/tools/invoke" });
      expect(lazyHandlerMocks.toolsModuleLoaded).toHaveBeenCalledTimes(1);
      expect(lazyHandlerMocks.openResponsesModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.openAiModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.slackModuleLoaded).not.toHaveBeenCalled();

      await sendRequest(server, { path: "/v1/responses" });
      expect(lazyHandlerMocks.openResponsesModuleLoaded).toHaveBeenCalledTimes(1);
      expect(lazyHandlerMocks.openAiModuleLoaded).not.toHaveBeenCalled();
      expect(lazyHandlerMocks.slackModuleLoaded).not.toHaveBeenCalled();

      await sendRequest(server, { path: "/v1/chat/completions" });
      expect(lazyHandlerMocks.openAiModuleLoaded).toHaveBeenCalledTimes(1);
      expect(lazyHandlerMocks.slackModuleLoaded).not.toHaveBeenCalled();
    });
  });
});
