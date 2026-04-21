import { afterEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../../test-helpers/storage.ts";
import { GatewayRequestError } from "../gateway.ts";
import {
  abortChatRun,
  clearChatHistorySnapshot,
  handleChatEvent,
  handleSessionMessageEvent,
  hydrateChatHistoryFromCache,
  loadChatHistory,
  rememberChatHistorySnapshot,
  sendChatMessage,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";
import {
  loadComputerSession,
  readComputerSessionEvent,
  readComputerSessionState,
  updateComputerSession,
} from "./computer-session.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatFinalizing: false,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    refreshBrowserPaneBrowserState: vi.fn(() => ({
      hasActivity: false,
      changed: false,
    })),
    ...overrides,
  };
}

function createActiveStreamingState() {
  return createState({
    sessionKey: "main",
    chatRunId: "run-user",
    chatStream: "Working...",
    chatStreamStartedAt: 123,
  });
}

function createOtherRunNoReplyFinalPayload(): ChatEventPayload {
  return {
    runId: "run-announce",
    sessionKey: "main",
    state: "final",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "NO_REPLY" }],
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser pane controller helpers", () => {
  it("parses computer session updates from tool events", () => {
    vi.stubGlobal("localStorage", createStorageMock());

    const session = {
      sessionKey: "main",
      backend: "local-mac" as const,
      status: "observing" as const,
      mode: "approved_apps_only" as const,
      target: {
        id: "local-mac:local:host",
        label: "Local Mac",
        kind: "local-mac-host" as const,
        platform: "macos" as const,
        nodeId: "local",
        globalInput: true,
        allowsConcurrentObserve: true,
      },
      capabilities: [
        {
          kind: "observe_only" as const,
          available: true,
          exposure: "exposed" as const,
          reasonCode: "local_mac_observe_supported" as const,
          reason: "Read-only screen capture is supported on the local Mac.",
        },
      ],
      approvedApps: [],
      permissions: {
        accessibility: true,
        screenRecording: false,
        observation: "missing" as const,
        control: "granted" as const,
      },
      replay: {
        frames: [],
        steps: [],
        actionCount: 0,
        safetyEventsCount: 0,
      },
      context: {
        display: {
          width: 1440,
          height: 900,
          scale: 2,
          logicalWidth: 1440,
          logicalHeight: 900,
          pixelWidth: 2880,
          pixelHeight: 1800,
          orientation: "landscape",
        },
        capturedAt: 10,
      },
      frame: {
        id: "frame-1",
        dataUrl: "data:image/jpeg;base64,abc",
        mimeType: "image/jpeg",
        width: 1440,
        height: 900,
        pixelWidth: 2880,
        pixelHeight: 1800,
        logicalWidth: 1440,
        logicalHeight: 900,
        scaleFactor: 2,
        orientation: "landscape",
        sourceSpace: "display-pixel" as const,
        capturedAt: 10,
        maxAgeMs: 1000,
        staleAt: 1010,
      },
      stepCounter: 0,
      timeline: [],
      startedAt: 1,
      updatedAt: 10,
    };

    expect(
      readComputerSessionEvent({
        stream: "tool",
        sessionKey: "main",
        data: {
          name: "computer",
          partialResult: {
            details: {
              computerSession: session,
            },
          },
        },
      }),
    ).toEqual({
      sessionKey: "main",
      session: {
        ...session,
        eventLog: [],
        buffers: {
          eventLimit: 160,
          replayFrameLimit: 24,
          replayStepLimit: 24,
          timelineLimit: 80,
          eventLogTruncated: false,
          replayFramesTruncated: false,
          replayStepsTruncated: false,
          timelineTruncated: false,
        },
        target: {
          id: "local-mac:local:host",
          label: "Local Mac",
          kind: "local-mac-host",
          platform: "macos",
          nodeId: "local",
          globalInput: true,
          allowsConcurrentObserve: true,
        },
        capabilities: [
          {
            kind: "observe_only",
            available: true,
            exposure: "exposed",
            reasonCode: "local_mac_observe_supported",
            reason: "Read-only screen capture is supported on the local Mac.",
          },
        ],
        policy: {
          allow: {
            actions: [],
            apps: [],
            hosts: [],
            paths: [],
            surfaces: [],
          },
          deny: {
            actions: [],
            apps: [],
            hosts: [],
            paths: [],
            surfaces: [],
          },
          sensitive: {
            actions: [],
            apps: [],
            hosts: [],
            paths: [],
            surfaces: [],
          },
          commandLikeActions: [],
        },
        safety: {
          level: "normal",
          recentEvents: [],
        },
        replay: {
          frames: [],
          steps: [],
          actionCount: 0,
          safetyEventsCount: 0,
        },
      },
    });
    expect(readComputerSessionState({ status: "observing" })).toBeNull();
  });

  it("treats missing computer session methods as a silent no-op", async () => {
    const host = {
      client: {
        request: vi.fn(async () => {
          throw new GatewayRequestError({
            code: "METHOD_NOT_FOUND",
            message: "unknown method",
          });
        }),
      },
      connected: true,
      sessionKey: "main",
      computerSessionLoading: false,
      computerSessionError: null,
      setComputerSession: vi.fn(),
    };

    const session = await loadComputerSession(host);

    expect(session).toBeNull();
    expect(host.setComputerSession).toHaveBeenCalledWith("main", null);
    expect(host.computerSessionError).toBeNull();
  });

  it("sends permissions through computer session updates", async () => {
    const responseSession = {
      sessionKey: "main",
      backend: "local-mac" as const,
      status: "observing" as const,
      mode: "approved_apps_only" as const,
      target: {
        id: "local-mac:local:host",
        label: "Local Mac",
        kind: "local-mac-host" as const,
        platform: "macos" as const,
        nodeId: "local",
        globalInput: true,
        allowsConcurrentObserve: true,
      },
      capabilities: [
        {
          kind: "observe_only" as const,
          available: true,
          exposure: "exposed" as const,
          reasonCode: "local_mac_observe_supported" as const,
          reason: "Read-only screen capture is supported on the local Mac.",
        },
      ],
      approvedApps: [],
      permissions: {
        accessibility: true,
        screenRecording: true,
        observation: "granted" as const,
        control: "granted" as const,
      },
      replay: {
        frames: [],
        steps: [],
        actionCount: 0,
        safetyEventsCount: 0,
      },
      context: {
        display: {
          id: "display-1",
          width: 1440,
          height: 900,
          scale: 2,
          logicalWidth: 1440,
          logicalHeight: 900,
          pixelWidth: 2880,
          pixelHeight: 1800,
          orientation: "landscape",
        },
        capturedAt: 10,
      },
      frame: {
        id: "frame-2",
        dataUrl: "data:image/jpeg;base64,abc",
        mimeType: "image/jpeg",
        width: 1440,
        height: 900,
        pixelWidth: 2880,
        pixelHeight: 1800,
        logicalWidth: 1440,
        logicalHeight: 900,
        scaleFactor: 2,
        orientation: "landscape",
        displayId: "display-1",
        sourceSpace: "display-pixel",
        capturedAt: 10,
        maxAgeMs: 1000,
        staleAt: 1010,
      },
      stepCounter: 0,
      timeline: [],
      startedAt: 1,
      updatedAt: 10,
    };
    const host = {
      client: {
        request: vi.fn(async () => ({ session: responseSession })),
      },
      connected: true,
      sessionKey: "main",
      computerSessionLoading: false,
      computerSessionError: null,
      setComputerSession: vi.fn(),
    };

    const session = await updateComputerSession(
      host as Parameters<typeof updateComputerSession>[0],
      {
        permissions: { screenRecording: true },
      },
    );

    expect(host.client.request).toHaveBeenCalledWith("computer.session.update", {
      sessionKey: "main",
      permissions: { screenRecording: true },
    });
    expect(session?.permissions.screenRecording).toBe(true);
  });

  it("merges a persisted replay of the same user turn even when transcript and optimistic ids differ", () => {
    const state = createState({
      sessionKey: "main",
      chatMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "abre o google" }],
          timestamp: 1,
          idempotencyKey: "run-1",
        },
      ],
    });

    expect(
      handleSessionMessageEvent(state, {
        sessionKey: "main",
        messageId: "entry-123",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Sender (untrusted metadata):\n```json\n{"label":"alisio-control-ui"}\n```\n\n[Thu 2026-04-16 15:02 GMT+1] abre o google',
            },
          ],
          timestamp: 2,
        },
      }),
    ).toBe(true);

    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      role: "user",
      messageId: "entry-123",
    });
  });

  it("collapses adjacent duplicate user turns from polluted history even when transcript ids differ", async () => {
    const state = createState({
      sessionKey: "main",
      connected: true,
      client: {
        request: vi.fn(async (method: string) => {
          if (method !== "chat.history") {
            throw new Error(`unexpected method ${method}`);
          }
          return {
            messages: [
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
            ],
            thinkingLevel: "off",
          };
        }),
      } as never,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
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

describe("handleChatEvent", () => {
  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("ignores NO_REPLY delta updates", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
    };

    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toBe("Hello");
  });

  it("clears stale error state and restores the active run when a retry resumes streaming", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: null,
      chatStream: null,
      chatStreamStartedAt: null,
      lastError: "⚠️ You have hit your ChatGPT usage limit (team plan). Try again in ~174 min.",
      chatRuntimeSetupHint: {
        title: "Runtime setup required",
        message: "Configure um provider",
        ctaLabel: "Abrir setup do runtime",
      },
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Resposta" }] },
    };

    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatRunId).toBe("run-1");
    expect(state.chatStream).toBe("Resposta");
    expect(state.chatStreamStartedAt).not.toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.chatRuntimeSetupHint).toBeNull();
  });

  it("appends final payload from another run without clearing active stream", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toEqual(payload.message);
  });

  it("does not append the same final assistant message twice", () => {
    const finalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      timestamp: 10,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatMessages: [finalMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: finalMessage,
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([finalMessage]);
  });

  it("abre a pane do browser quando uma mensagem final nova traz actividade de browser", () => {
    const notifyBrowserPaneActivityForSurface = vi.fn();
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      refreshBrowserPaneBrowserState: vi.fn(() => ({
        hasActivity: true,
        changed: true,
      })),
      notifyBrowserPaneActivityForSurface,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        toolName: "browser",
        toolPhase: "result",
        content: [
          {
            type: "toolresult",
            name: "browser",
            text: '{"ok":true}',
            details: { ok: true, url: "https://grokopedia.com" },
          },
        ],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(notifyBrowserPaneActivityForSurface).toHaveBeenCalledWith("main", "browser");
  });

  it("drops NO_REPLY final payload from another run without clearing active stream", () => {
    const state = createActiveStreamingState();
    const payload = createOtherRunNoReplyFinalPayload();

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatMessages).toEqual([]);
  });

  it("returns final for another run when payload has no message", () => {
    const state = createActiveStreamingState();
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatMessages).toEqual([]);
  });

  it("persists streamed text when final event carries no message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Here is my reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Here is my reply" }],
    });
  });

  it("does not persist empty or whitespace-only stream on final", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "   ",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatMessages).toEqual([]);
  });

  it("does not persist null stream on final with no message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: null,
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
  });

  it("prefers final payload message over streamed text", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Streamed partial",
      chatStreamStartedAt: 100,
    });
    const finalMsg = {
      role: "assistant",
      content: [{ type: "text", text: "Complete reply" }],
      timestamp: 101,
    };
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: finalMsg,
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([finalMsg]);
    expect(state.chatStream).toBe(null);
  });

  it("appends final payload message from own run before clearing stream state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
        timestamp: 101,
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([payload.message]);
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("clears stale error state when a later final reply arrives for the same turn", () => {
    const finalMsg = {
      role: "assistant",
      content: [{ type: "text", text: "Resposta final" }],
      timestamp: 101,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: null,
      lastError: "⚠️ You have hit your ChatGPT usage limit (team plan). Try again in ~174 min.",
      chatRuntimeSetupHint: {
        title: "Runtime setup required",
        message: "Configure um provider",
        ctaLabel: "Abrir setup do runtime",
      },
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: finalMsg,
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([finalMsg]);
    expect(state.lastError).toBeNull();
    expect(state.chatRuntimeSetupHint).toBeNull();
  });

  it("processes aborted from own run and keeps partial assistant message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const partialMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
      timestamp: 2,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: partialMessage,
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage, partialMessage]);
  });

  it("falls back to streamed partial when aborted payload message is invalid", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("falls back to streamed partial when aborted payload has non-assistant role", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: {
        role: "user",
        content: [{ type: "text", text: "unexpected" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("processes aborted from own run without message and empty stream", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage]);
  });

  it("drops NO_REPLY final payload from another run", () => {
    const state = createActiveStreamingState();
    const payload = createOtherRunNoReplyFinalPayload();

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
  });

  it("drops NO_REPLY final payload from own run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
  });

  it("does not persist NO_REPLY stream text on final without message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
  });

  it("does not persist NO_REPLY stream text on abort", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toEqual([]);
  });

  it("keeps user messages containing NO_REPLY text", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "user",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    // User messages with NO_REPLY text should NOT be filtered — only assistant messages.
    // normalizeFinalAssistantMessage returns null for user role, so this falls through.
    expect(handleChatEvent(state, payload)).toBe("final");
  });

  it("keeps assistant message when text field has real reply but content is NO_REPLY", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        text: "real reply",
        content: "NO_REPLY",
      },
    };

    // entry.text takes precedence — "real reply" is NOT silent, so the message is kept.
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toHaveLength(1);
  });
});

describe("handleSessionMessageEvent", () => {
  it("replaces an optimistic user turn with the canonical transcript update", () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Olá." }],
      timestamp: 10,
    };
    const optimisticUserTurn = {
      role: "user",
      content: [{ type: "text", text: "manda isso" }],
      timestamp: 20,
      idempotencyKey: "run-1",
    };
    const state = createState({
      sessionKey: "main",
      chatMessages: [previousMessage, optimisticUserTurn],
    });

    expect(
      handleSessionMessageEvent(state, {
        sessionKey: "main",
        messageId: "msg-1",
        messageSeq: 2,
        message: {
          role: "user",
          content: "manda isso",
          timestamp: 21,
          idempotencyKey: "run-1",
        },
      }),
    ).toBe(true);

    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(previousMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "user",
      content: "manda isso",
      timestamp: 21,
      idempotencyKey: "run-1",
      messageId: "msg-1",
      __alisio: {
        id: "msg-1",
        seq: 2,
      },
    });
  });

  it("dedupes repeated canonical user transcript updates", () => {
    const state = createState({
      sessionKey: "main",
      chatMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "procura o email" }],
          timestamp: 20,
          idempotencyKey: "run-email-1",
        },
      ],
    });
    const payload = {
      sessionKey: "main",
      messageId: "msg-email-1",
      messageSeq: 3,
      message: {
        role: "user",
        content: "procura o email",
        timestamp: 21,
        idempotencyKey: "run-email-1",
      },
    } as const;

    expect(handleSessionMessageEvent(state, payload)).toBe(true);
    expect(handleSessionMessageEvent(state, payload)).toBe(true);

    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      messageId: "msg-email-1",
      idempotencyKey: "run-email-1",
      content: "procura o email",
    });
  });

  it("matches canonical user transcript updates after metadata stripping and whitespace normalization", () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Olá." }],
      timestamp: 10,
    };
    const optimisticUserTurn = {
      role: "user",
      content: [
        {
          type: "text",
          text: "chamo me Nuno Lopes,\nsou o teu criador  e quero tratar te por agora por alisio",
        },
      ],
      timestamp: 20,
      idempotencyKey: "run-creator-1",
    };
    const state = createState({
      sessionKey: "main",
      chatMessages: [previousMessage, optimisticUserTurn],
    });

    expect(
      handleSessionMessageEvent(state, {
        sessionKey: "main",
        messageId: "msg-creator-1",
        messageSeq: 4,
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Sender (untrusted metadata):\n```json\n{\n  "label": "alisio-control-ui",\n  "id": "alisio-control-ui"\n}\n```\n\n[Fri 2026-04-17 18:52 GMT+1] chamo me Nuno Lopes, sou o teu criador e quero tratar te por agora por alisio',
            },
          ],
          timestamp: 21,
        },
      }),
    ).toBe(true);

    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(previousMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "user",
      timestamp: 21,
      messageId: "msg-creator-1",
      __alisio: {
        id: "msg-creator-1",
        seq: 4,
      },
    });
  });

  it("matches canonical user transcript updates even with leading system event lines", () => {
    const optimisticUserTurn = {
      role: "user",
      content: [{ type: "text", text: "ola" }],
      timestamp: 20,
      idempotencyKey: "run-ola-1",
    };
    const state = createState({
      sessionKey: "main",
      chatMessages: [optimisticUserTurn],
    });

    expect(
      handleSessionMessageEvent(state, {
        sessionKey: "main",
        messageId: "msg-ola-1",
        messageSeq: 5,
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: 'System: [2026-04-17 18:37:38 GMT+1] Node: Nuno’s MacBook Air (192.168.1.221)\n\nSender (untrusted metadata):\n```json\n{\n  "label": "alisio-control-ui",\n  "id": "alisio-control-ui"\n}\n```\n\n[Fri 2026-04-17 18:38 GMT+1] ola',
            },
          ],
          timestamp: 21,
        },
      }),
    ).toBe(true);

    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      role: "user",
      timestamp: 21,
      messageId: "msg-ola-1",
      __alisio: {
        id: "msg-ola-1",
        seq: 5,
      },
    });
  });

  it("ignores canonical assistant transcript updates because chat events already cover them", () => {
    const state = createState({
      sessionKey: "main",
      chatMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Feito." }],
          timestamp: 30,
        },
      ],
    });

    expect(
      handleSessionMessageEvent(state, {
        sessionKey: "main",
        messageId: "msg-assistant-1",
        messageSeq: 3,
        message: {
          role: "assistant",
          content: "Feito.",
          timestamp: 31,
        },
      }),
    ).toBe(false);

    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Feito." }],
      timestamp: 30,
    });
  });

  it("ignores transcript updates for other sessions and tool roles", () => {
    const existing = {
      role: "assistant",
      content: [{ type: "text", text: "Olá." }],
      timestamp: 10,
    };
    const state = createState({
      sessionKey: "main",
      chatMessages: [existing],
    });

    expect(
      handleSessionMessageEvent(state, {
        sessionKey: "other",
        message: { role: "user", content: "ignorar", timestamp: 11 },
      }),
    ).toBe(false);
    expect(
      handleSessionMessageEvent(state, {
        sessionKey: "main",
        message: { role: "tool", content: "ignorar", timestamp: 12 },
      }),
    ).toBe(false);

    expect(state.chatMessages).toEqual([existing]);
  });

  it("rehydrates inline image previews from transcript media fields", () => {
    const state = createState({
      sessionKey: "main",
      chatMessages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "local-preview" },
            },
          ],
          timestamp: 20,
          idempotencyKey: "run-image-1",
        },
      ],
    });

    expect(
      handleSessionMessageEvent(state, {
        sessionKey: "main",
        messageId: "msg-image-1",
        messageSeq: 4,
        message: {
          role: "user",
          content: "",
          timestamp: 21,
          idempotencyKey: "run-image-1",
          MediaPath: "/tmp/chat-send-image-a.png",
          MediaPaths: ["/tmp/chat-send-image-a.png"],
          MediaType: "Image/PNG; charset=utf-8",
          MediaTypes: ["Image/PNG; charset=utf-8"],
          MediaPreviewImages: [{ mimeType: "image/png", data: "preview-base64" }],
        },
      }),
    ).toBe(true);

    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      role: "user",
      messageId: "msg-image-1",
      __alisio: {
        id: "msg-image-1",
        seq: 4,
      },
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "preview-base64",
          },
        },
      ],
    });
  });

  it("rehydrates attachment pills from transcript media fields when no preview exists", () => {
    const state = createState({
      sessionKey: "main",
    });

    expect(
      handleSessionMessageEvent(state, {
        sessionKey: "main",
        messageId: "msg-pdf-1",
        messageSeq: 5,
        message: {
          role: "user",
          content: "resume isto",
          timestamp: 22,
          idempotencyKey: "run-pdf-1",
          MediaPath: "/tmp/brief.pdf",
          MediaPaths: ["/tmp/brief.pdf"],
          MediaType: "application/pdf",
          MediaTypes: ["application/pdf"],
        },
      }),
    ).toBe(true);

    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "resume isto" },
        {
          type: "attachment",
          mimeType: "application/pdf",
          fileName: "brief.pdf",
        },
      ],
    });
  });
});

describe("loadChatHistory", () => {
  it("refreshes the browser pane preview after loading history", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        {
          role: "assistant",
          toolName: "browser",
          toolPhase: "result",
          content: [
            {
              type: "toolresult",
              name: "browser",
              text: '{"ok":true}',
              details: { ok: true, url: "https://grokopedia.com" },
            },
          ],
        },
      ],
    });
    const refreshBrowserPaneBrowserState = vi.fn(() => ({
      hasActivity: true,
      changed: true,
    }));
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      refreshBrowserPaneBrowserState,
    });

    await loadChatHistory(state);

    expect(refreshBrowserPaneBrowserState).toHaveBeenCalledWith("main");
  });

  it("filters NO_REPLY assistant messages from history", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
      { role: "assistant", content: [{ type: "text", text: "Real answer" }] },
      { role: "assistant", text: "  NO_REPLY  " },
    ];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages, thinkingLevel: "low" }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(messages[0]);
    expect(state.chatMessages[1]).toEqual(messages[2]);
    expect(state.chatThinkingLevel).toBe("low");
    expect(state.chatLoading).toBe(false);
  });

  it("keeps assistant message when text field has real content but content is NO_REPLY", async () => {
    const messages = [{ role: "assistant", text: "real reply", content: "NO_REPLY" }];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    // text takes precedence — "real reply" is NOT silent, so message is kept.
    expect(state.chatMessages).toHaveLength(1);
  });

  it("preserves ephemeral streaming state when requested", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: [{ type: "text", text: "Done" }] }],
      thinkingLevel: "high",
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      chatRunId: "run-1",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
      chatFinalizing: true,
    });

    await loadChatHistory(state, { preserveEphemeral: true });

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
    ]);
    expect(state.chatThinkingLevel).toBe("high");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatFinalizing).toBe(true);
  });

  it("colapsa bolhas locais duplicadas quando um transcript reescrito volta a carregar o histórico", async () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Olá." }],
      timestamp: 10,
    };
    const duplicatedUserTurn = {
      role: "user",
      content: [{ type: "text", text: "ola" }],
      timestamp: 20,
      idempotencyKey: "run-ola-1",
    };
    const request = vi.fn().mockResolvedValue({
      messages: [
        previousMessage,
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'System: [2026-04-17 18:37:38 GMT+1] Node: Nuno’s MacBook Air (192.168.1.221)\n\nSender (untrusted metadata):\n```json\n{\n  "label": "alisio-control-ui",\n  "id": "alisio-control-ui"\n}\n```\n\n[Fri 2026-04-17 18:38 GMT+1] ola',
            },
          ],
          timestamp: 21,
          messageId: "msg-ola-1",
        },
      ],
      thinkingLevel: "high",
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      chatMessages: [previousMessage, duplicatedUserTurn, { ...duplicatedUserTurn }],
      chatRunId: "run-1",
      chatFinalizing: true,
    });

    await loadChatHistory(state, { preserveEphemeral: true });

    expect(state.chatMessages).toEqual([
      previousMessage,
      {
        role: "user",
        content: [
          {
            type: "text",
            text: 'System: [2026-04-17 18:37:38 GMT+1] Node: Nuno’s MacBook Air (192.168.1.221)\n\nSender (untrusted metadata):\n```json\n{\n  "label": "alisio-control-ui",\n  "id": "alisio-control-ui"\n}\n```\n\n[Fri 2026-04-17 18:38 GMT+1] ola',
          },
        ],
        timestamp: 21,
        messageId: "msg-ola-1",
      },
    ]);
  });

  it("keeps an optimistic user turn visible when a finalizing history reload omits it", async () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Olá." }],
      timestamp: 10,
    };
    const optimisticUserTurn = {
      role: "user",
      content: [{ type: "text", text: "consegues abrir o browser?" }],
      timestamp: 20,
    };
    const localAssistantReply = {
      role: "assistant",
      content: [{ type: "text", text: "Sim — posso abrir o browser." }],
      timestamp: 30,
    };
    const request = vi.fn().mockResolvedValue({
      messages: [
        previousMessage,
        {
          role: "assistant",
          content: [{ type: "text", text: "Sim — posso abrir o browser." }],
          timestamp: 31,
        },
      ],
      thinkingLevel: "high",
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      chatMessages: [previousMessage, optimisticUserTurn, localAssistantReply],
      chatFinalizing: true,
    });

    await loadChatHistory(state, { preserveEphemeral: false });

    expect(state.chatMessages).toEqual([
      previousMessage,
      optimisticUserTurn,
      {
        role: "assistant",
        content: [{ type: "text", text: "Sim — posso abrir o browser." }],
        timestamp: 31,
      },
    ]);
  });

  it("keeps a recent unmatched user turn visible across a non-ephemeral history reload", async () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Olá." }],
      timestamp: 10_000,
    };
    const optimisticUserTurn = {
      role: "user",
      content: [{ type: "text", text: "olá 👋" }],
      timestamp: 10_200,
      idempotencyKey: "run-hello",
    };
    const request = vi.fn().mockResolvedValue({
      messages: [previousMessage],
      thinkingLevel: "high",
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      chatMessages: [previousMessage, optimisticUserTurn],
      chatFinalizing: false,
      chatRunId: null,
    });

    await loadChatHistory(state, { preserveEphemeral: false });

    expect(state.chatMessages).toEqual([previousMessage, optimisticUserTurn]);
  });

  it("keeps unmatched user turns with stable ids even after a long finalizing delay", async () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Olá." }],
      timestamp: 10_000,
    };
    const optimisticUserTurn = {
      role: "user",
      content: [{ type: "text", text: "abre o browser embutido" }],
      timestamp: 10_200,
      idempotencyKey: "run-browser-open",
    };
    const localAssistantReply = {
      role: "assistant",
      content: [{ type: "text", text: "Vou abrir o browser." }],
      timestamp: 130_000,
    };
    const request = vi.fn().mockResolvedValue({
      messages: [previousMessage, localAssistantReply],
      thinkingLevel: "high",
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      chatMessages: [previousMessage, optimisticUserTurn, localAssistantReply],
      chatFinalizing: false,
      chatRunId: null,
    });

    await loadChatHistory(state, { preserveEphemeral: false });

    expect(state.chatMessages).toEqual([previousMessage, optimisticUserTurn, localAssistantReply]);
  });

  it("replaces optimistic turns with canonical history entries once they arrive", async () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Olá." }],
      timestamp: 10,
    };
    const optimisticUserTurn = {
      role: "user",
      content: [{ type: "text", text: "consegues abrir o browser?" }],
      timestamp: 20,
    };
    const localAssistantReply = {
      role: "assistant",
      content: [{ type: "text", text: "Sim — posso abrir o browser." }],
      timestamp: 30,
    };
    const canonicalUserTurn = {
      role: "user",
      content: "consegues abrir o browser?",
      timestamp: 21,
    };
    const canonicalAssistantReply = {
      role: "assistant",
      content: [{ type: "text", text: "Sim — posso abrir o browser." }],
      timestamp: 31,
    };
    const request = vi.fn().mockResolvedValue({
      messages: [previousMessage, canonicalUserTurn, canonicalAssistantReply],
      thinkingLevel: "high",
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      chatMessages: [previousMessage, optimisticUserTurn, localAssistantReply],
      chatFinalizing: true,
    });

    await loadChatHistory(state, { preserveEphemeral: false });

    expect(state.chatMessages).toEqual([
      previousMessage,
      canonicalUserTurn,
      canonicalAssistantReply,
    ]);
  });

  it("replaces optimistic turns with canonical history even when transcript text was normalized", async () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Olá." }],
      timestamp: 10,
    };
    const optimisticUserTurn = {
      role: "user",
      content: [
        {
          type: "text",
          text: "chamo me Nuno Lopes,\nsou o teu criador  e quero tratar te por agora por alisio",
        },
      ],
      timestamp: 20,
      idempotencyKey: "run-creator-1",
    };
    const localAssistantReply = {
      role: "assistant",
      content: [{ type: "text", text: "Perfeito." }],
      timestamp: 30,
    };
    const canonicalUserTurn = {
      role: "user",
      content: [
        {
          type: "text",
          text: 'Sender (untrusted metadata):\n```json\n{\n  "label": "alisio-control-ui",\n  "id": "alisio-control-ui"\n}\n```\n\n[Fri 2026-04-17 18:52 GMT+1] chamo me Nuno Lopes, sou o teu criador e quero tratar te por agora por alisio',
        },
      ],
      timestamp: 21,
      messageId: "msg-creator-1",
    };
    const canonicalAssistantReply = {
      role: "assistant",
      content: [{ type: "text", text: "Perfeito." }],
      timestamp: 31,
    };
    const request = vi.fn().mockResolvedValue({
      messages: [previousMessage, canonicalUserTurn, canonicalAssistantReply],
      thinkingLevel: "high",
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      chatMessages: [previousMessage, optimisticUserTurn, localAssistantReply],
      chatFinalizing: true,
    });

    await loadChatHistory(state, { preserveEphemeral: false });

    expect(state.chatMessages).toEqual([
      previousMessage,
      canonicalUserTurn,
      canonicalAssistantReply,
    ]);
  });

  it("matches document-only optimistic turns with canonical history using the stable turn id", async () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Envia o ficheiro." }],
      timestamp: 10,
    };
    const optimisticUserTurn = {
      role: "user",
      content: [{ type: "attachment", mimeType: "application/pdf", fileName: "brief.pdf" }],
      timestamp: 20,
      idempotencyKey: "run-doc-1",
    };
    const localAssistantReply = {
      role: "assistant",
      content: [{ type: "text", text: "Já li o PDF." }],
      timestamp: 30,
    };
    const canonicalUserTurn = {
      role: "user",
      content: [{ type: "attachment", mimeType: "application/pdf", fileName: "brief.pdf" }],
      timestamp: 21,
      idempotencyKey: "run-doc-1",
    };
    const canonicalAssistantReply = {
      role: "assistant",
      content: [{ type: "text", text: "Já li o PDF." }],
      timestamp: 31,
    };
    const request = vi.fn().mockResolvedValue({
      messages: [previousMessage, canonicalUserTurn, canonicalAssistantReply],
      thinkingLevel: "high",
    });
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      chatMessages: [previousMessage, optimisticUserTurn, localAssistantReply],
      chatFinalizing: true,
    });

    await loadChatHistory(state, { preserveEphemeral: false });

    expect(state.chatMessages).toEqual([
      previousMessage,
      canonicalUserTurn,
      canonicalAssistantReply,
    ]);
  });

  it("does not toggle chatLoading for silent history refreshes", async () => {
    let resolveRequest!: (value: { messages: unknown[] }) => void;
    const request = vi.fn(
      () =>
        new Promise<{ messages: unknown[] }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
    });

    const pending = loadChatHistory(state, { silent: true });

    expect(state.chatLoading).toBe(false);
    resolveRequest({ messages: [] });
    await pending;
    expect(state.chatLoading).toBe(false);
  });

  it("ignores stale history responses after a reconnect swaps the client", async () => {
    let resolveFirst!: (value: { messages: unknown[]; thinkingLevel?: string }) => void;
    let resolveSecond!: (value: { messages: unknown[]; thinkingLevel?: string }) => void;
    const firstClient = {
      request: vi.fn(
        () =>
          new Promise<{ messages: unknown[]; thinkingLevel?: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      ),
    };
    const secondClient = {
      request: vi.fn(
        () =>
          new Promise<{ messages: unknown[]; thinkingLevel?: string }>((resolve) => {
            resolveSecond = resolve;
          }),
      ),
    };
    const state = createState({
      client: firstClient as unknown as ChatState["client"],
      connected: true,
    });

    const firstPending = loadChatHistory(state);
    state.client = secondClient as unknown as ChatState["client"];
    const secondPending = loadChatHistory(state);

    resolveFirst({
      messages: [{ role: "assistant", content: [{ type: "text", text: "stale" }] }],
      thinkingLevel: "low",
    });
    await firstPending;

    expect(state.chatLoading).toBe(true);
    expect(state.chatMessages).toEqual([]);
    expect(state.chatThinkingLevel).toBeNull();

    resolveSecond({
      messages: [{ role: "assistant", content: [{ type: "text", text: "fresh" }] }],
      thinkingLevel: "high",
    });
    await secondPending;

    expect(state.chatLoading).toBe(false);
    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "fresh" }] },
    ]);
    expect(state.chatThinkingLevel).toBe("high");
  });

  it("ignores stale history responses after the user switches sessions", async () => {
    let resolveMain!: (value: { messages: unknown[] }) => void;
    let resolveOther!: (value: { messages: unknown[] }) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ messages: unknown[] }>((resolve) => {
            resolveMain = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ messages: unknown[] }>((resolve) => {
            resolveOther = resolve;
          }),
      );
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      connected: true,
      sessionKey: "main",
    });

    const firstPending = loadChatHistory(state);
    state.sessionKey = "other";
    const secondPending = loadChatHistory(state);

    resolveOther({
      messages: [{ role: "assistant", content: [{ type: "text", text: "other session" }] }],
    });
    await secondPending;

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "other session" }] },
    ]);
    expect(state.chatLoading).toBe(false);

    resolveMain({
      messages: [{ role: "assistant", content: [{ type: "text", text: "main session" }] }],
    });
    await firstPending;

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "other session" }] },
    ]);
  });
});

describe("sendChatMessage", () => {
  it("dedupes repeated pending sends with the same semantic payload", async () => {
    let resolveRequest!: (value: { status: "started" }) => void;
    const request = vi.fn(
      () =>
        new Promise<{ status: "started" }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const firstSend = sendChatMessage(state, "abre o google");
    const secondSend = sendChatMessage(state, "  abre   o   google  ");

    expect(request).toHaveBeenCalledTimes(1);
    resolveRequest({ status: "started" });
    const firstRunId = await firstSend;
    const secondRunId = await secondSend;
    expect(firstRunId).toBeTruthy();
    expect(secondRunId).toBe(firstRunId);
    expect(
      state.chatMessages.filter(
        (message) =>
          message && typeof message === "object" && (message as { role?: unknown }).role === "user",
      ),
    ).toHaveLength(1);
  });

  it("drops burst duplicate optimistic user turns that re-enter with a fresh id", async () => {
    const request = vi.fn().mockResolvedValue({ status: "started" });
    const now = Date.now();
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "run-existing",
      chatSending: true,
      chatMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "abre o google" }],
          timestamp: now,
          idempotencyKey: "run-existing",
        },
      ],
    });

    const result = await sendChatMessage(state, "  abre   o   google  ");

    expect(result).toBe("run-existing");
    expect(request).not.toHaveBeenCalled();
    expect(
      state.chatMessages.filter(
        (message) =>
          message && typeof message === "object" && (message as { role?: unknown }).role === "user",
      ),
    ).toHaveLength(1);
  });

  it("adds structured document attachment blocks to the optimistic user turn", async () => {
    const request = vi.fn().mockResolvedValue({ status: "started" });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const result = await sendChatMessage(state, "", [
      {
        id: "att-1",
        dataUrl: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\\n").toString("base64")}`,
        mimeType: "application/pdf",
        fileName: "brief.pdf",
      },
    ]);

    expect(result).not.toBeNull();
    expect(state.chatMessages.at(-1)).toMatchObject({
      role: "user",
      content: [
        {
          type: "attachment",
          mimeType: "application/pdf",
          fileName: "brief.pdf",
        },
      ],
      idempotencyKey: result,
    });
  });

  it("formats structured non-auth connect failures for chat send", async () => {
    const request = vi.fn().mockRejectedValue(
      new GatewayRequestError({
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: "CONTROL_UI_ORIGIN_NOT_ALLOWED" },
      }),
    );
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const result = await sendChatMessage(state, "hello");

    expect(result).toBeNull();
    expect(state.lastError).toContain("origin not allowed");
    expect(state.chatMessages.at(-1)).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "text",
          text: expect.stringContaining("origin not allowed"),
        },
      ],
    });
  });

  it("redirects runtime setup errors into a guided state instead of appending a raw assistant error", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(
        new Error("No providers configured. Add a model provider api key before sending chat."),
      );
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const result = await sendChatMessage(state, "hello");

    expect(result).toBeNull();
    expect(state.lastError).toContain("Configure um provider");
    expect(state.chatRuntimeSetupHint).toMatchObject({
      title: "Runtime setup required",
      ctaLabel: "Abrir setup do runtime",
    });
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      role: "user",
    });
  });
});

describe("abortChatRun", () => {
  it("formats structured non-auth connect failures for chat abort", async () => {
    // Abort now shares the same structured connect-error formatter as send.
    const request = vi.fn().mockRejectedValue(
      new GatewayRequestError({
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" },
      }),
    );
    const state = createState({
      connected: true,
      chatRunId: "run-1",
      client: { request } as unknown as ChatState["client"],
    });

    const result = await abortChatRun(state);

    expect(result).toBe(false);
    expect(request).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "main",
      runId: "run-1",
    });
    expect(state.lastError).toContain("device identity required");
  });
});

describe("loadChatHistory", () => {
  it("filters assistant NO_REPLY messages and keeps user NO_REPLY messages", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
        { role: "assistant", content: [{ type: "text", text: "visible answer" }] },
        { role: "user", content: [{ type: "text", text: "NO_REPLY" }] },
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "main",
      limit: 200,
    });
    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "visible answer" }] },
      { role: "user", content: [{ type: "text", text: "NO_REPLY" }] },
    ]);
    expect(state.chatThinkingLevel).toBe("low");
    expect(state.chatLoading).toBe(false);
    expect(state.lastError).toBeNull();
  });

  it("collapses adjacent duplicate history messages", async () => {
    const duplicate = {
      role: "assistant",
      content: [{ type: "text", text: "visible answer" }],
      timestamp: 123,
    };
    const request = vi.fn().mockResolvedValue({
      messages: [
        duplicate,
        {
          role: "assistant",
          content: [{ type: "text", text: "visible answer" }],
          timestamp: 123,
        },
        { role: "user", content: [{ type: "text", text: "Follow up" }], timestamp: 124 },
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      duplicate,
      { role: "user", content: [{ type: "text", text: "Follow up" }], timestamp: 124 },
    ]);
  });

  it("drops invisible retry errors and collapses the repeated user turn they leave behind", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "user", content: [{ type: "text", text: "ola abre o google" }], timestamp: 1000 },
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "You have hit your ChatGPT usage limit.",
          timestamp: 1010,
        },
        { role: "user", content: [{ type: "text", text: "ola abre o google" }], timestamp: 1020 },
        {
          role: "assistant",
          content: [{ type: "text", text: "Abri o Google." }],
          timestamp: 1030,
        },
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "ola abre o google" }], timestamp: 1000 },
      {
        role: "assistant",
        content: [{ type: "text", text: "Abri o Google." }],
        timestamp: 1030,
      },
    ]);
  });

  it("collapses retry duplicates even when the invisible error delayed the replay by more than 30 seconds", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "user", content: [{ type: "text", text: "abre o google" }], timestamp: 1_000 },
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
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "abre o google" }], timestamp: 1_000 },
    ]);
  });

  it("surfaces the latest invisible assistant error from history when it is the terminal event", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "user", content: [{ type: "text", text: "ola" }], timestamp: 1_000 },
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "You have hit your ChatGPT usage limit (team plan). Try again in ~159 min.",
          timestamp: 1_010,
        },
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "ola" }], timestamp: 1_000 },
    ]);
    expect(state.lastError).toContain("usage limit");
    expect(state.lastError).toContain("~159 min");
  });

  it("does not surface an old invisible assistant error once a newer user turn exists", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "user", content: [{ type: "text", text: "ola" }], timestamp: 1_000 },
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "You have hit your ChatGPT usage limit (team plan). Try again in ~159 min.",
          timestamp: 1_010,
        },
        { role: "user", content: [{ type: "text", text: "tenta outra vez" }], timestamp: 1_020 },
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.lastError).toBeNull();
  });

  it("keeps repeated user turns when they are genuinely far apart", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "user", content: [{ type: "text", text: "abre o google" }], timestamp: 1_000 },
        {
          role: "user",
          content: [{ type: "text", text: "abre o google" }],
          timestamp: 10 * 60_000,
        },
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "abre o google" }], timestamp: 1_000 },
      { role: "user", content: [{ type: "text", text: "abre o google" }], timestamp: 10 * 60_000 },
    ]);
  });

  it("shows a targeted message when chat history is unauthorized", async () => {
    const request = vi.fn().mockRejectedValue(
      new GatewayRequestError({
        code: "PERMISSION_DENIED",
        message: "not allowed",
        details: { code: "AUTH_UNAUTHORIZED" },
      }),
    );
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [{ role: "assistant", content: [{ type: "text", text: "old" }] }],
      chatThinkingLevel: "high",
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([]);
    expect(state.chatThinkingLevel).toBeNull();
    expect(state.lastError).toContain("operator.read");
    expect(state.chatLoading).toBe(false);
  });

  it("can restore a cached snapshot for an already visited session", () => {
    const state = createState({
      sessionKey: "main",
      chatMessages: [{ role: "assistant", content: [{ type: "text", text: "Main" }] }],
      chatThinkingLevel: "low",
    });

    rememberChatHistorySnapshot(state);
    state.sessionKey = "other";
    state.chatMessages = [{ role: "assistant", content: [{ type: "text", text: "Other" }] }];
    state.chatThinkingLevel = "high";
    rememberChatHistorySnapshot(state);
    state.chatMessages = [];
    state.chatThinkingLevel = null;

    expect(hydrateChatHistoryFromCache(state, "main")).toBe(true);
    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Main" }] },
    ]);
    expect(state.chatThinkingLevel).toBe("low");

    clearChatHistorySnapshot(state, "main");
    state.chatMessages = [];
    state.chatThinkingLevel = null;
    expect(hydrateChatHistoryFromCache(state, "main")).toBe(false);
  });
});
