import { describe, expect, it, vi } from "vitest";
import { runChatTurn } from "./chat-engine.js";
import type { ChatTurnParams } from "./types.js";

function createParams(overrides: Partial<ChatTurnParams> = {}): ChatTurnParams {
  return {
    conversation: { messages: [] },
    content: "Quem está ligado neste computador?",
    settings: {
      provider: "openai",
      model: "gpt-5.4",
      openAiApiKey: "sk-local",
    },
    ...overrides,
  };
}

describe("runChatTurn", () => {
  it("responde com erro legível quando falta a API key", async () => {
    const result = await runChatTurn(createParams(), {
      prepareModel: vi.fn().mockResolvedValue({
        error: 'No API key resolved for provider "openai" (auth mode: api-key).',
      }),
      now: () => 100,
    });

    expect(result.transcript.at(-1)).toMatchObject({
      role: "assistant",
      isError: true,
    });
    expect(result.transcript.at(-1)?.text).toContain("No API key resolved");
  });

  it("executa o alias local e fecha a resposta final", async () => {
    const prepareModel = vi.fn().mockResolvedValue({
      model: { provider: "openai", id: "gpt-5.4" },
      auth: { apiKey: "sk-local", source: "env", mode: "api-key" },
    });

    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        role: "assistant",
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5.4",
        responseId: "resp_1",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 101,
        content: [
          {
            type: "toolCall",
            id: "tool_1",
            name: "system_whoami",
            arguments: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        role: "assistant",
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5.4",
        responseId: "resp_2",
        usage: {
          input: 12,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 102,
        content: [
          {
            type: "text",
            text: "O utilizador ativo neste computador é nuno.",
          },
        ],
      });

    const result = await runChatTurn(createParams(), {
      prepareModel,
      complete,
      invokeToolAlias: vi.fn().mockResolvedValue({
        alias: "system.whoami",
        output: "nuno",
        exitCode: 0,
        isError: false,
      }),
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(101).mockReturnValueOnce(102),
    });

    expect(result.transcript.some((message) => message.toolAlias === "system.whoami")).toBe(true);
    expect(result.transcript.at(-1)?.text).toContain("nuno");
  });

  it("não envia temperature no caminho openai-codex", async () => {
    const prepareModel = vi.fn().mockResolvedValue({
      model: { provider: "openai-codex", id: "gpt-5.4" },
      auth: { apiKey: "oauth-token", source: "auth-profile:1", mode: "api-key" },
    });
    const complete = vi.fn().mockResolvedValue({
      role: "assistant",
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.4",
      responseId: "resp_1",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 101,
      content: [
        {
          type: "text",
          text: "Tudo a funcionar.",
        },
      ],
    });

    const result = await runChatTurn(
      createParams({
        settings: {
          provider: "openai-codex",
          model: "gpt-5.4",
          openAiCodexAuthProfileId: "openai-codex:default",
        },
      }),
      {
        prepareModel,
        complete,
      },
    );

    expect(complete).toHaveBeenCalled();
    expect(complete.mock.calls[0]?.[2]).not.toHaveProperty("temperature");
    expect(result.transcript.at(-1)?.text).toContain("Tudo a funcionar");
  });
});
