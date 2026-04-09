/* @vitest-environment jsdom */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHost } from "./app-chat.ts";
import { refreshChat, refreshChatAvatar } from "./app-chat.ts";

const { setLastActiveSessionKeyMock } = vi.hoisted(() => ({
  setLastActiveSessionKeyMock: vi.fn(),
}));

vi.mock("./app-settings.ts", () => ({
  setLastActiveSessionKey: (...args: unknown[]) => setLastActiveSessionKeyMock(...args),
}));

let handleSendChat: typeof import("./app-chat.ts").handleSendChat;
let clearPendingQueueItemsForRun: typeof import("./app-chat.ts").clearPendingQueueItemsForRun;
let isChatBusy: typeof import("./app-chat.ts").isChatBusy;

async function loadChatHelpers(): Promise<void> {
  vi.resetModules();
  ({ handleSendChat, clearPendingQueueItemsForRun, isChatBusy } = await import("./app-chat.ts"));
}

function makeHost(overrides?: Partial<ChatHost>): ChatHost {
  return {
    client: null,
    chatMessages: [],
    chatStream: null,
    chatFinalizing: false,
    connected: true,
    chatMessage: "",
    chatAttachments: [],
    chatQueue: [],
    chatRunId: null,
    chatSending: false,
    lastError: null,
    sessionKey: "agent:main",
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    chatModelOverrides: {},
    chatModelsLoading: false,
    chatModelCatalog: [],
    toolStreamById: new Map(),
    toolStreamOrder: [],
    toolStreamSyncTimer: null,
    refreshSessionsAfterChat: new Set<string>(),
    updateComplete: Promise.resolve(),
    ...overrides,
  } as unknown as ChatHost;
}

describe("refreshChatAvatar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a route-relative avatar endpoint before basePath bootstrap finishes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ avatarUrl: "/avatar/main" }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "", sessionKey: "agent:main" });
    await refreshChatAvatar(host);

    expect(fetchMock).toHaveBeenCalledWith(
      "avatar/main?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(host.chatAvatarUrl).toBe("/avatar/main");
  });

  it("keeps mounted dashboard avatar endpoints under the normalized base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "/alisio/", sessionKey: "agent:ops:main" });
    await refreshChatAvatar(host);

    expect(fetchMock).toHaveBeenCalledWith(
      "/alisio/avatar/ops?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(host.chatAvatarUrl).toBeNull();
  });
});

describe("refreshChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("can refresh side data without reloading chat history", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "sessions.list") {
        expect(params).toEqual({
          includeGlobal: true,
          includeUnknown: true,
        });
        return {
          ts: 0,
          path: "",
          count: 0,
          defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
          sessions: [],
        };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      if (method === "chat.history") {
        throw new Error("chat.history should not run when includeHistory is false");
      }
      throw new Error(`Unexpected request: ${method}`);
    });

    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
    });

    await refreshChat(host, { includeHistory: false, scheduleScroll: false });

    expect(request).not.toHaveBeenCalledWith("chat.history", expect.anything());
    expect(request).toHaveBeenCalledWith(
      "sessions.list",
      expect.objectContaining({
        includeGlobal: true,
        includeUnknown: true,
      }),
    );
    expect(request).toHaveBeenCalledWith("models.list", {});
  });
});

describe("handleSendChat", () => {
  beforeEach(async () => {
    setLastActiveSessionKeyMock.mockReset();
    await loadChatHelpers();
  }, 20_000);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("./chat/slash-command-executor.ts");
    vi.doUnmock("./controllers/security-access.ts");
  });

  it("keeps slash-command model changes in sync with the chat header cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }) as unknown as typeof fetch,
    );
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "sessions.patch") {
        return {
          ok: true,
          key: "main",
          resolved: {
            modelProvider: "openai",
            model: "gpt-5-mini",
          },
        };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      if (method === "sessions.list") {
        return {
          ts: 0,
          path: "",
          count: 0,
          defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
          sessions: [],
        };
      }
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" }],
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const onSlashAction = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatMessage: "/model gpt-5-mini",
      onSlashAction,
    });

    await handleSendChat(host);

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: "gpt-5-mini",
    });
    expect(host.chatModelOverrides.main).toEqual({
      kind: "qualified",
      value: "openai/gpt-5-mini",
    });
    expect(onSlashAction).toHaveBeenCalledWith("refresh-tools-effective");
  });

  it("summarizes chat security state locally for /permissions status", async () => {
    const host = makeHost({
      connected: true,
      chatMessage: "/permissions status",
      gatewayAccessMode: "recommended",
      nativeShellState: {
        platform: "macos",
        launchAtLogin: true,
        permissions: {
          notifications: true,
          appleScript: false,
          accessibility: false,
          screenRecording: true,
          microphone: true,
          speechRecognition: true,
          camera: true,
          location: true,
        },
        voiceWake: {
          supported: true,
          enabled: false,
          talkEnabled: false,
          triggers: ["alisio"],
        },
        logsPath: null,
      },
      execApprovalQueue: [
        {
          id: "approval-1",
          kind: "exec",
          request: {
            command: "rm -rf /tmp/demo",
            host: "gateway",
            security: "allowlist",
            ask: "on-miss",
          },
          createdAtMs: Date.now() - 1_000,
          expiresAtMs: Date.now() + 60_000,
        },
      ],
      execApprovalAuditTrail: [
        {
          id: "audit-1",
          kind: "exec",
          title: "ls",
          summary: "ls",
          decision: "allow-once",
          resolvedBy: "operator",
          ts: Date.now() - 30_000,
          request: {
            command: "ls",
            host: "gateway",
            security: "allowlist",
            ask: "on-miss",
          },
        },
      ],
    });

    await handleSendChat(host);

    expect(host.chatMessages.at(-1)).toMatchObject({
      role: "system",
      content: expect.stringContaining("Security in chat"),
    });
    const content = String((host.chatMessages.at(-1) as { content?: string })?.content);
    expect(content).toContain("Policy plane");
    expect(content).toContain("Computer access");
    expect(content).toContain("6/8 system permissions ready");
    expect(content).toContain("Live approvals");
  });

  it("applies chat security profiles locally for /permissions safe", async () => {
    const applyGatewayAccessModeMock = vi.fn(async () => undefined);
    vi.doMock("./controllers/security-access.ts", async () => {
      const actual = await vi.importActual<typeof import("./controllers/security-access.ts")>(
        "./controllers/security-access.ts",
      );
      return {
        ...actual,
        applyGatewayAccessMode: applyGatewayAccessModeMock,
      };
    });
    await loadChatHelpers();

    const host = makeHost({
      connected: true,
      client: { request: vi.fn() } as unknown as ChatHost["client"],
      chatMessage: "/permissions safe",
    });

    await handleSendChat(host);

    expect(applyGatewayAccessModeMock).toHaveBeenCalledWith(host, "recommended");
    expect(host.chatMessages.at(-1)).toMatchObject({
      role: "system",
      content: expect.stringContaining("Security"),
    });
  });

  it("shows a visible pending item for /steer on the active run", async () => {
    vi.doMock("./chat/slash-command-executor.ts", async () => {
      const actual = await vi.importActual<typeof import("./chat/slash-command-executor.ts")>(
        "./chat/slash-command-executor.ts",
      );
      return {
        ...actual,
        executeSlashCommand: vi.fn(async () => ({
          content: "Steered.",
          pendingCurrentRun: true,
        })),
      };
    });
    await loadChatHelpers();

    const host = makeHost({
      client: { request: vi.fn() } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatMessage: "/steer tighten the plan",
    });

    await handleSendChat(host);

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        text: "/steer tighten the plan",
        pendingRunId: "run-1",
      }),
    ]);
  });

  it("removes pending steer indicators when the run finishes", async () => {
    const host = makeHost({
      chatQueue: [
        {
          id: "pending",
          text: "/steer tighten the plan",
          createdAt: 1,
          pendingRunId: "run-1",
        },
        {
          id: "queued",
          text: "follow up",
          createdAt: 2,
        },
      ],
    });

    clearPendingQueueItemsForRun(host, "run-1");

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        id: "queued",
        text: "follow up",
      }),
    ]);
  });

  it("treats silent finalization as a busy state", () => {
    const host = makeHost({ chatFinalizing: true });

    expect(isChatBusy(host)).toBe(true);
  });

  it("queues a new message while the previous run is still finalizing", async () => {
    const host = makeHost({
      client: { request: vi.fn() } as unknown as ChatHost["client"],
      chatFinalizing: true,
      chatMessage: "follow up",
    });

    await handleSendChat(host);

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        text: "follow up",
      }),
    ]);
  });

  it("uses override attachments when replaying a message after connector auth", async () => {
    const sendChatMessageMock = vi.fn(async () => "run-override");
    vi.doMock("./controllers/chat.ts", async () => {
      const actual =
        await vi.importActual<typeof import("./controllers/chat.ts")>("./controllers/chat.ts");
      return {
        ...actual,
        sendChatMessage: sendChatMessageMock,
      };
    });
    await loadChatHelpers();

    const host = makeHost({
      client: { request: vi.fn() } as unknown as ChatHost["client"],
      chatMessage: "rascunho local",
      chatAttachments: [
        {
          id: "draft-1",
          dataUrl: "data:image/jpeg;base64,draft",
          mimeType: "image/jpeg",
        },
      ],
    });
    const replayAttachments = [
      {
        id: "resume-1",
        dataUrl: "data:image/png;base64,resume",
        mimeType: "image/png",
      },
    ];

    await handleSendChat(host, "Reenvia este pedido", { attachments: replayAttachments });

    expect(sendChatMessageMock).toHaveBeenCalledWith(
      host,
      "Reenvia este pedido",
      replayAttachments,
    );
    expect(host.chatMessage).toBe("rascunho local");
    expect(host.chatAttachments).toEqual([
      {
        id: "draft-1",
        dataUrl: "data:image/jpeg;base64,draft",
        mimeType: "image/jpeg",
      },
    ]);
  });
});

afterAll(() => {
  vi.doUnmock("./app-settings.ts");
  vi.resetModules();
});
