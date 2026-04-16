import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";

const mockState = vi.hoisted(() => ({
  entry: {
    sessionId: "sess-main",
    updatedAt: Date.now(),
  } as Record<string, unknown>,
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("../session-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...actual,
    loadSessionEntry: () => ({
      cfg: {},
      storePath: "/tmp/sessions.json",
      entry: mockState.entry,
    }),
    readSessionMessages: () => mockState.messages,
    resolveSessionModelRef: () => ({
      provider: "alisio-local-current-llama",
      model: "qwen3-4b-q4-k-m",
    }),
  };
});

const { chatHandlers } = await import("./chat.js");

describe("chat.history model catalog fallback", () => {
  afterEach(() => {
    mockState.messages = [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 1,
      },
    ];
  });

  it("keeps history available when the gateway model catalog load fails", async () => {
    const warn = vi.fn();
    let response:
      | {
          ok: boolean;
          payload?: Record<string, unknown>;
          error?: { message?: string };
        }
      | undefined;

    await chatHandlers["chat.history"]({
      params: { sessionKey: "main", limit: 200 },
      respond: (ok, payload, error) => {
        response = {
          ok,
          payload: (payload as Record<string, unknown> | undefined) ?? undefined,
          error: (error as { message?: string } | undefined) ?? undefined,
        };
      },
      context: {
        loadGatewayModelCatalog: async () => {
          throw new Error("sharing cloud schema cache stale");
        },
        logGateway: {
          warn,
          debug: vi.fn(),
        },
      } as unknown as GatewayRequestContext,
    } as never);

    expect(response?.ok).toBe(true);
    expect(response?.payload?.thinkingLevel).toBe("off");
    expect(response?.payload?.messages).toEqual(mockState.messages);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("chat.history thinking default fallback session=main"),
    );
  });

  it("drops invisible retry errors and the replayed user turn from canonical chat history", async () => {
    mockState.messages = [
      {
        role: "user",
        content: [{ type: "text", text: "abre o google" }],
        timestamp: 1_000,
      },
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "You have hit your ChatGPT usage limit.",
        timestamp: 20_000,
      },
      {
        role: "user",
        content: [{ type: "text", text: "abre o google" }],
        timestamp: 75_000,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Abri o Google." }],
        timestamp: 90_000,
      },
    ];

    let response:
      | {
          ok: boolean;
          payload?: Record<string, unknown>;
          error?: { message?: string };
        }
      | undefined;

    await chatHandlers["chat.history"]({
      params: { sessionKey: "main", limit: 200 },
      respond: (ok, payload, error) => {
        response = {
          ok,
          payload: (payload as Record<string, unknown> | undefined) ?? undefined,
          error: (error as { message?: string } | undefined) ?? undefined,
        };
      },
      context: {
        loadGatewayModelCatalog: async () => ({ providers: [] }),
        logGateway: {
          warn: vi.fn(),
          debug: vi.fn(),
        },
      } as unknown as GatewayRequestContext,
    } as never);

    expect(response?.ok).toBe(true);
    expect(response?.payload?.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "abre o google" }],
        timestamp: 1_000,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Abri o Google." }],
        timestamp: 90_000,
      },
    ]);
  });

  it("collapses retry-replayed user turns even when the transcript stores inbound metadata", async () => {
    mockState.messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Sender (untrusted metadata):\n```json\n{\"label\":\"alisio-control-ui\"}\n```\n\n[Thu 2026-04-16 15:02 GMT+1] abre o google",
          },
        ],
        timestamp: 1_000,
      },
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "You have hit your ChatGPT usage limit.",
        timestamp: 20_000,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Sender (untrusted metadata):\n```json\n{\"label\":\"alisio-control-ui\"}\n```\n\n[Thu 2026-04-16 15:02 GMT+1] abre o google",
          },
        ],
        timestamp: 75_000,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Abri o Google." }],
        timestamp: 90_000,
      },
    ];

    let response:
      | {
          ok: boolean;
          payload?: Record<string, unknown>;
          error?: { message?: string };
        }
      | undefined;

    await chatHandlers["chat.history"]({
      params: { sessionKey: "main", limit: 200 },
      respond: (ok, payload, error) => {
        response = {
          ok,
          payload: (payload as Record<string, unknown> | undefined) ?? undefined,
          error: (error as { message?: string } | undefined) ?? undefined,
        };
      },
      context: {
        loadGatewayModelCatalog: async () => ({ providers: [] }),
        logGateway: {
          warn: vi.fn(),
          debug: vi.fn(),
        },
      } as unknown as GatewayRequestContext,
    } as never);

    expect(response?.ok).toBe(true);
    expect(response?.payload?.messages).toHaveLength(2);
  });

  it("collapses adjacent duplicate user turns from polluted transcript history even when their transcript ids differ", async () => {
    mockState.messages = [
      {
        role: "user",
        content: [{ type: "text", text: "abre o google" }],
        timestamp: 1_000,
        __alisio: { id: "entry-1" },
      },
      {
        role: "user",
        content: [{ type: "text", text: "abre o google" }],
        timestamp: 45_000,
        __alisio: { id: "entry-2" },
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Abri o Google." }],
        timestamp: 90_000,
      },
    ];

    let response:
      | {
          ok: boolean;
          payload?: Record<string, unknown>;
          error?: { message?: string };
        }
      | undefined;

    await chatHandlers["chat.history"]({
      params: { sessionKey: "main", limit: 200 },
      respond: (ok, payload, error) => {
        response = {
          ok,
          payload: (payload as Record<string, unknown> | undefined) ?? undefined,
          error: (error as { message?: string } | undefined) ?? undefined,
        };
      },
      context: {
        loadGatewayModelCatalog: async () => ({ providers: [] }),
        logGateway: {
          warn: vi.fn(),
          debug: vi.fn(),
        },
      } as unknown as GatewayRequestContext,
    } as never);

    expect(response?.ok).toBe(true);
    expect(response?.payload?.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "abre o google" }],
        timestamp: 1_000,
        __alisio: { id: "entry-1" },
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Abri o Google." }],
        timestamp: 90_000,
      },
    ]);
  });
});
