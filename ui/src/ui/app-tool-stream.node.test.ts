import { beforeAll, describe, expect, it, vi } from "vitest";
import { handleAgentEvent, type FallbackStatus, type ToolStreamEntry } from "./app-tool-stream.ts";

type ToolStreamHost = Parameters<typeof handleAgentEvent>[0];
type MutableHost = ToolStreamHost & {
  compactionStatus?: unknown;
  compactionClearTimer?: number | null;
  fallbackStatus?: FallbackStatus | null;
  fallbackClearTimer?: number | null;
};

function createHost(overrides?: Partial<MutableHost>): MutableHost {
  return {
    sessionKey: "main",
    chatRunId: null,
    chatStream: null,
    chatStreamStartedAt: null,
    chatStreamSegments: [],
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [],
    chatToolMessages: [],
    toolStreamSyncTimer: null,
    compactionStatus: null,
    compactionClearTimer: null,
    fallbackStatus: null,
    fallbackClearTimer: null,
    ...overrides,
  };
}

describe("app-tool-stream fallback lifecycle handling", () => {
  beforeAll(() => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    if (!globalWithWindow.window) {
      globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
    }
  });

  it("accepts session-scoped fallback lifecycle events when no run is active", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "fallback",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/minimax-m2p5",
        activeProvider: "deepinfra",
        activeModel: "moonshotai/Kimi-K2.5",
        reasonSummary: "rate limit",
      },
    });

    expect(host.fallbackStatus?.selected).toBe("fireworks/minimax-m2p5");
    expect(host.fallbackStatus?.active).toBe("deepinfra/moonshotai/Kimi-K2.5");
    expect(host.fallbackStatus?.reason).toBe("rate limit");
    vi.useRealTimers();
  });

  it("rejects idle fallback lifecycle events for other sessions", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "agent:other:main",
      data: {
        phase: "fallback",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/minimax-m2p5",
        activeProvider: "deepinfra",
        activeModel: "moonshotai/Kimi-K2.5",
      },
    });

    expect(host.fallbackStatus).toBeNull();
    vi.useRealTimers();
  });

  it("auto-clears fallback status after toast duration", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "fallback",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/minimax-m2p5",
        activeProvider: "deepinfra",
        activeModel: "moonshotai/Kimi-K2.5",
      },
    });

    expect(host.fallbackStatus).not.toBeNull();
    vi.advanceTimersByTime(7_999);
    expect(host.fallbackStatus).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.fallbackStatus).toBeNull();
    vi.useRealTimers();
  });

  it("builds previous fallback label from provider + model on fallback_cleared", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "fallback_cleared",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/minimax-m2p5",
        activeProvider: "fireworks",
        activeModel: "fireworks/minimax-m2p5",
        previousActiveProvider: "deepinfra",
        previousActiveModel: "moonshotai/Kimi-K2.5",
      },
    });

    expect(host.fallbackStatus?.phase).toBe("cleared");
    expect(host.fallbackStatus?.previous).toBe("deepinfra/moonshotai/Kimi-K2.5");
    vi.useRealTimers();
  });

  it("preserves structured tool result details for connector auth flows", () => {
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "result",
        name: "gmail_send",
        toolCallId: "tool-auth-1",
        result: {
          content: [
            {
              type: "text",
              text: "Gmail Send is not connected in Alisio. Connect Gmail Send in Apps first.",
            },
          ],
          details: {
            ok: false,
            status: "auth_required",
            connectorId: "gmail-send",
            reconnectRequired: false,
          },
        },
      },
    });

    const message = host.chatToolMessages[0] as
      | {
          toolResultDetails?: { connectorId?: string; status?: string };
          content?: Array<{ type?: string; details?: { connectorId?: string } }>;
        }
      | undefined;
    expect(message?.toolResultDetails).toMatchObject({
      status: "auth_required",
      connectorId: "gmail-send",
    });
    expect(message?.content?.[1]).toMatchObject({
      type: "toolresult",
      details: {
        connectorId: "gmail-send",
      },
    });
  });

  it("isolates tool stream entries by run when toolCallId collides", () => {
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-a",
      seq: 1,
      stream: "tool",
      ts: 1,
      sessionKey: "main",
      data: {
        phase: "start",
        name: "read",
        toolCallId: "shared-tool-call-id",
        args: { path: "/tmp/path-a.txt" },
      },
    });
    handleAgentEvent(host, {
      runId: "run-b",
      seq: 2,
      stream: "tool",
      ts: 2,
      sessionKey: "main",
      data: {
        phase: "start",
        name: "read",
        toolCallId: "shared-tool-call-id",
        args: { path: "/tmp/path-b.txt" },
      },
    });
    handleAgentEvent(host, {
      runId: "run-a",
      seq: 3,
      stream: "tool",
      ts: 3,
      sessionKey: "main",
      data: {
        phase: "result",
        name: "read",
        toolCallId: "shared-tool-call-id",
        result: { content: [{ type: "text", text: "done-a" }] },
      },
    });
    handleAgentEvent(host, {
      runId: "run-b",
      seq: 4,
      stream: "tool",
      ts: 4,
      sessionKey: "main",
      data: {
        phase: "result",
        name: "read",
        toolCallId: "shared-tool-call-id",
        result: { content: [{ type: "text", text: "done-b" }] },
      },
    });

    expect(host.chatToolMessages).toHaveLength(2);
    expect(host.chatToolMessages[0]).toMatchObject({
      runId: "run-a",
      toolCallId: "shared-tool-call-id",
      content: [
        {
          type: "toolcall",
          arguments: { path: "/tmp/path-a.txt" },
        },
        {
          type: "toolresult",
          text: "done-a",
        },
      ],
    });
    expect(host.chatToolMessages[1]).toMatchObject({
      runId: "run-b",
      toolCallId: "shared-tool-call-id",
      content: [
        {
          type: "toolcall",
          arguments: { path: "/tmp/path-b.txt" },
        },
        {
          type: "toolresult",
          text: "done-b",
        },
      ],
    });
  });
});
