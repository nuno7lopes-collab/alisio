import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_EVENT_UPDATE_AVAILABLE } from "../../../src/gateway/events.js";
import { ConnectErrorDetailCodes } from "../../../src/gateway/protocol/connect-error-details.js";
import { connectGateway, resolveControlUiClientVersion } from "./app-gateway.ts";
import type { BrowserPaneObserver, BrowserPaneSurfaceKind } from "./controllers/browser-pane.ts";
import type { GatewayHelloOk } from "./gateway.ts";
import { DEFAULT_THEME_SELECTION } from "./theme.ts";
import type { ComputerSessionState } from "./types.ts";

const loadChatHistoryMock = vi.hoisted(() => vi.fn(async () => undefined));
const refreshActiveTabMock = vi.hoisted(() => vi.fn());
const loadAlisioDoctorSummaryMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadControlUiBootstrapConfigMock = vi.hoisted(() =>
  vi.fn(
    async (state: {
      gatewayBootstrapToken?: string | null;
      gatewayBootstrapUrl?: string | null;
    }) => {
      state.gatewayBootstrapToken = "refreshed-bootstrap-token";
      state.gatewayBootstrapUrl = "ws://127.0.0.1:40705";
    },
  ),
);
const clearDeviceAuthTokenMock = vi.hoisted(() => vi.fn());
const loadManagedDeviceIdentityMock = vi.hoisted(() =>
  vi.fn(async () => ({ deviceId: "device-1", publicKey: "pk", privateKey: "sk" })),
);
const loadStoredBrowserDeviceIdentityMock = vi.hoisted(() => vi.fn(async () => null));
const clearStoredBrowserDeviceIdentityMock = vi.hoisted(() => vi.fn());

type GatewayClientMock = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  options: {
    clientVersion?: string;
    token?: string;
    bootstrapToken?: string;
    password?: string;
  };
  emitHello: (hello?: GatewayHelloOk) => void;
  emitClose: (info: {
    code: number;
    reason?: string;
    error?: { code: string; message: string; details?: unknown };
  }) => void;
  emitGap: (expected: number, received: number) => void;
  emitEvent: (evt: { event: string; payload?: unknown; seq?: number }) => void;
};

type BrowserPaneObserverSetter = (sessionKey: string, observer: BrowserPaneObserver | null) => void;
type ComputerSessionSetter = (sessionKey: string, session: ComputerSessionState | null) => void;
type BrowserPaneActivityNotifier = (sessionKey: string, surface?: BrowserPaneSurfaceKind) => void;

const gatewayClientInstances: GatewayClientMock[] = [];

vi.mock("./gateway.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gateway.ts")>();

  function resolveGatewayErrorDetailCode(
    error: { details?: unknown } | null | undefined,
  ): string | null {
    const details = error?.details;
    if (!details || typeof details !== "object") {
      return null;
    }
    const code = (details as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }

  class GatewayBrowserClient {
    readonly start = vi.fn();
    readonly stop = vi.fn();
    readonly request = vi.fn(async () => ({}));

    constructor(
      private opts: {
        clientVersion?: string;
        token?: string;
        bootstrapToken?: string;
        password?: string;
        onHello?: (hello: GatewayHelloOk) => void;
        onClose?: (info: {
          code: number;
          reason: string;
          error?: { code: string; message: string; details?: unknown };
        }) => void;
        onGap?: (info: { expected: number; received: number }) => void;
        onEvent?: (evt: { event: string; payload?: unknown; seq?: number }) => void;
      },
    ) {
      gatewayClientInstances.push({
        start: this.start,
        stop: this.stop,
        request: this.request,
        options: {
          clientVersion: this.opts.clientVersion,
          token: this.opts.token,
          bootstrapToken: this.opts.bootstrapToken,
          password: this.opts.password,
        },
        emitHello: (hello) => {
          this.opts.onHello?.(
            hello ?? {
              type: "hello-ok",
              protocol: 3,
              snapshot: {},
            },
          );
        },
        emitClose: (info) => {
          this.opts.onClose?.({
            code: info.code,
            reason: info.reason ?? "",
            error: info.error,
          });
        },
        emitGap: (expected, received) => {
          this.opts.onGap?.({ expected, received });
        },
        emitEvent: (evt) => {
          this.opts.onEvent?.(evt);
        },
      });
    }
  }

  return { ...actual, GatewayBrowserClient, resolveGatewayErrorDetailCode };
});

vi.mock("./controllers/chat.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./controllers/chat.ts")>();
  return {
    ...actual,
    loadChatHistory: loadChatHistoryMock,
  };
});

vi.mock("./controllers/control-ui-bootstrap.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./controllers/control-ui-bootstrap.ts")>();
  return {
    ...actual,
    loadControlUiBootstrapConfig: loadControlUiBootstrapConfigMock,
  };
});

vi.mock("./app-settings.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./app-settings.ts")>();
  return {
    ...actual,
    refreshActiveTab: refreshActiveTabMock,
  };
});

vi.mock("./controllers/alisio.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./controllers/alisio.ts")>();
  return {
    ...actual,
    loadAlisioDoctorSummary: loadAlisioDoctorSummaryMock,
  };
});

vi.mock("./device-auth.ts", () => ({
  clearDeviceAuthToken: clearDeviceAuthTokenMock,
}));

vi.mock("./device-identity.ts", () => ({
  loadManagedDeviceIdentity: loadManagedDeviceIdentityMock,
  loadStoredBrowserDeviceIdentity: loadStoredBrowserDeviceIdentityMock,
  clearStoredBrowserDeviceIdentity: clearStoredBrowserDeviceIdentityMock,
}));

type GatewayTestHost = Parameters<typeof connectGateway>[0] & {
  basePath: string;
  chatMessage: string;
  chatMessages: unknown[];
  chatAttachments: unknown[];
  chatQueue: Array<{
    id: string;
    text: string;
    createdAt: number;
    pendingRunId?: string;
  }>;
  chatToolMessages: unknown[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatSending: boolean;
  toolStreamById: Map<string, unknown>;
  toolStreamOrder: string[];
  toolStreamSyncTimer: number | null;
  setBrowserPaneObserver: BrowserPaneObserverSetter;
  setComputerSession: ComputerSessionSetter;
  notifyBrowserPaneActivity: BrowserPaneActivityNotifier;
};

function createHost(): GatewayTestHost {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:40705",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: DEFAULT_THEME_SELECTION.themeMode,
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      chatHideCronSessions: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 280,
      navGroupsCollapsed: {},
    },
    password: "",
    gatewayBootstrapUrl: null,
    gatewayBootstrapToken: null,
    clientInstanceId: "instance-test",
    client: null,
    connected: false,
    hello: null,
    lastError: null,
    lastErrorCode: null,
    eventLogBuffer: [],
    eventLog: [],
    tab: "chat",
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
    assistantName: "Alisio",
    assistantAvatar: null,
    assistantAgentId: null,
    serverVersion: null,
    sessionKey: "main",
    basePath: "",
    chatMessage: "",
    chatMessages: [],
    chatAttachments: [],
    chatQueue: [],
    chatToolMessages: [],
    chatStreamSegments: [],
    chatStream: null,
    chatStreamStartedAt: null,
    chatRunId: null,
    chatFinalizing: false,
    chatSending: false,
    toolStreamById: new Map(),
    toolStreamOrder: [],
    toolStreamSyncTimer: null,
    refreshSessionsAfterChat: new Set<string>(),
    execApprovalQueue: [],
    execApprovalAuditTrail: [],
    execApprovalError: null,
    updateAvailable: null,
    alisioModelOperations: {},
    setBrowserPaneObserver: vi.fn<BrowserPaneObserverSetter>(),
    setComputerSession: vi.fn<ComputerSessionSetter>(),
    notifyBrowserPaneActivity: vi.fn<BrowserPaneActivityNotifier>(),
  };
}

function connectHostGateway() {
  const host = createHost();
  connectGateway(host);
  const client = gatewayClientInstances[0];
  expect(client).toBeDefined();
  return { host, client };
}

function emitToolResultEvent(client: GatewayClientMock) {
  client.emitEvent({
    event: "agent",
    payload: {
      runId: "engine-run-1",
      seq: 1,
      stream: "tool",
      ts: 1,
      sessionKey: "main",
      data: {
        toolCallId: "tool-1",
        name: "fetch",
        phase: "result",
        result: { text: "ok" },
      },
    },
  });
}

describe("connectGateway", () => {
  beforeEach(() => {
    vi.useRealTimers();
    gatewayClientInstances.length = 0;
    loadChatHistoryMock.mockClear();
    refreshActiveTabMock.mockClear();
    loadAlisioDoctorSummaryMock.mockClear();
    loadControlUiBootstrapConfigMock.mockClear();
    clearDeviceAuthTokenMock.mockClear();
    loadManagedDeviceIdentityMock.mockClear();
    loadStoredBrowserDeviceIdentityMock.mockClear();
    clearStoredBrowserDeviceIdentityMock.mockClear();
  });

  it("ignores stale client onGap callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitGap(10, 13);
    expect(host.lastError).toBeNull();

    secondClient.emitGap(20, 24);
    expect(gatewayClientInstances).toHaveLength(3);
    expect(secondClient.stop).toHaveBeenCalledTimes(1);
    expect(host.lastError).toBe("Resyncing live state…");
  });

  it("prefers bootstrap auth over stale shared token settings for automatic local startup", () => {
    const host = createHost() as ReturnType<typeof createHost> & {
      gatewayBootstrapToken: string | null;
      password: string;
    };
    host.settings.token = "stale-shared-token";
    host.gatewayBootstrapToken = "fresh-bootstrap-token";
    host.password = "stale-password";

    connectGateway(host);
    const client = gatewayClientInstances[0];

    expect(host.settings.token).toBe("");
    expect(host.password).toBe("");
    expect(client.options.token).toBeUndefined();
    expect(client.options.password).toBeUndefined();
    expect(client.options.bootstrapToken).toBe("fresh-bootstrap-token");
  });

  it("preserves approval prompts, clears stale run indicators, and resumes queued work after seq-gap reconnect", async () => {
    const host = createHost();
    const chatHost = host as typeof host & {
      chatRunId: string | null;
      chatQueue: Array<{
        id: string;
        text: string;
        createdAt: number;
        pendingRunId?: string;
      }>;
    };
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    chatHost.chatRunId = "run-1";
    chatHost.chatQueue = [
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
    ];
    host.execApprovalQueue = [
      {
        id: "approval-1",
        kind: "exec",
        request: { command: "rm -rf /tmp/demo" },
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
      },
    ];

    client.emitGap(20, 24);

    expect(gatewayClientInstances).toHaveLength(2);
    expect(host.execApprovalQueue).toHaveLength(1);
    expect(host.execApprovalQueue[0]?.id).toBe("approval-1");
    expect(chatHost.chatQueue).toHaveLength(1);
    expect(chatHost.chatQueue[0]?.text).toBe("follow up");

    const reconnectClient = gatewayClientInstances[1];
    expect(reconnectClient).toBeDefined();

    reconnectClient.emitHello();

    await vi.waitFor(() => {
      expect(
        reconnectClient.request.mock.calls.some(
          ([method, params]) =>
            method === "chat.send" &&
            (params as Record<string, unknown>).message === "follow up" &&
            (params as Record<string, unknown>).sessionKey === "main",
        ),
      ).toBe(true);
    });
    expect(chatHost.chatQueue).toHaveLength(0);
  });

  it("keeps visible chat stream state during seq-gap reconnect until history resync lands", () => {
    const host = createHost();
    host.tab = "chat";
    host.chatRunId = "run-1";
    host.chatStream = "A continuar...";
    host.chatStreamStartedAt = 123;
    host.toolStreamOrder = ["tool-1"];

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitGap(20, 24);

    expect(host.chatRunId).toBeNull();
    expect(host.chatFinalizing).toBe(false);
    expect(host.chatStream).toBe("A continuar...");
    expect(host.chatStreamStartedAt).toBe(123);
    expect(host.toolStreamOrder).toEqual(["tool-1"]);

    const reconnectClient = gatewayClientInstances[1];
    expect(reconnectClient).toBeDefined();

    reconnectClient.emitHello();

    expect(host.chatStream).toBe("A continuar...");
    expect(host.chatStreamStartedAt).toBe(123);
    expect(host.toolStreamOrder).toEqual(["tool-1"]);
    expect(refreshActiveTabMock).toHaveBeenLastCalledWith(host, { includeChatHistory: true });
  });

  it("subscribes to session transcript updates for the active chat session on hello", async () => {
    const { client } = connectHostGateway();

    client.emitHello();

    await vi.waitFor(() => {
      expect(client.request).toHaveBeenCalledWith("sessions.subscribe", {});
      expect(client.request).toHaveBeenCalledWith("sessions.messages.subscribe", {
        key: "main",
      });
    });
  });

  it("holds queued work until the final history reload finishes", async () => {
    let resolveHistory!: () => void;
    loadChatHistoryMock.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveHistory = () => resolve(undefined);
        }),
    );

    const { host, client } = connectHostGateway();
    client.emitHello();

    host.chatRunId = "run-1";
    host.chatQueue = [
      {
        id: "queued",
        text: "follow up",
        createdAt: 2,
      },
    ];

    emitToolResultEvent(client);
    client.emitEvent({
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    const chatSendCalls = () =>
      client.request.mock.calls.filter(([method]) => method === "chat.send");

    expect(host.chatFinalizing).toBe(true);
    expect(host.chatMessages).toEqual([]);
    expect(chatSendCalls()).toHaveLength(0);

    resolveHistory();

    await vi.waitFor(() => {
      expect(host.chatFinalizing).toBe(false);
      expect(chatSendCalls()).toHaveLength(1);
    });
  });

  it("reconciles canonical user transcript updates from session.message events", () => {
    const { host, client } = connectHostGateway();
    client.emitHello();

    host.chatMessages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Olá." }],
        timestamp: 10,
      },
      {
        role: "user",
        content: [{ type: "text", text: "procura o email" }],
        timestamp: 20,
        idempotencyKey: "run-email-1",
      },
    ];

    client.emitEvent({
      event: "session.message",
      payload: {
        sessionKey: "main",
        messageId: "msg-email-1",
        messageSeq: 2,
        message: {
          role: "user",
          content: "procura o email",
          timestamp: 21,
          idempotencyKey: "run-email-1",
        },
      },
    });

    expect(host.chatMessages).toHaveLength(2);
    expect(host.chatMessages[1]).toMatchObject({
      role: "user",
      content: "procura o email",
      timestamp: 21,
      idempotencyKey: "run-email-1",
      messageId: "msg-email-1",
      __alisio: {
        id: "msg-email-1",
        seq: 2,
      },
    });
  });

  it("applies observer metadata updates from gateway events", () => {
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "agent",
      payload: {
        sessionKey: "main",
        observer: {
          kind: "novnc",
          url: "http://127.0.0.1:19000/sandbox/novnc?token=abc",
          label: "Observed browser",
        },
      },
    });

    expect(host.setBrowserPaneObserver).toHaveBeenCalledWith("main", {
      kind: "novnc",
      url: "http://127.0.0.1:19000/sandbox/novnc?token=abc",
      label: "Observed browser",
    });
  });

  it("marks browser pane activity when browser tool events arrive", () => {
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "agent",
      payload: {
        runId: "engine-run-browser-1",
        seq: 1,
        stream: "tool",
        ts: 1,
        sessionKey: "main",
        data: {
          toolCallId: "tool-browser-1",
          name: "browser",
          phase: "result",
          result: { text: "ok" },
        },
      },
    });

    expect(host.notifyBrowserPaneActivity).toHaveBeenCalledWith("main", "observer");
  });

  it("clears stale browser observer state when the browser tool reports sandbox unavailability", () => {
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "agent",
      payload: {
        sessionKey: "main",
        observer: {
          kind: "novnc",
          url: "http://127.0.0.1:19000/sandbox/novnc?token=abc",
          label: "Observed browser",
        },
      },
    });

    client.emitEvent({
      event: "agent",
      payload: {
        runId: "engine-run-browser-2",
        seq: 2,
        stream: "tool",
        ts: 2,
        sessionKey: "main",
        data: {
          toolCallId: "tool-browser-2",
          name: "browser",
          phase: "result",
          isError: true,
          result: {
            text: 'Sandbox browser is unavailable. Enable agents.defaults.sandbox.browser.enabled or use target="host" if allowed.',
          },
        },
      },
    });

    expect(host.setBrowserPaneObserver).toHaveBeenLastCalledWith("main", null);
    expect(host.notifyBrowserPaneActivity).not.toHaveBeenCalledWith("main", "observer");
  });

  it("applies computer session updates and marks computer pane activity", () => {
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "agent",
      payload: {
        runId: "engine-run-computer-1",
        seq: 1,
        stream: "tool",
        ts: 1,
        sessionKey: "main",
        data: {
          toolCallId: "tool-computer-1",
          name: "computer",
          phase: "update",
          partialResult: {
            text: "observing",
            details: {
              computerSession: {
                sessionKey: "main",
                backend: "local-mac",
                status: "observing",
                mode: "control-approved-apps",
                approvedApps: [],
                permissions: {
                  accessibility: true,
                  screenRecording: false,
                },
                context: {
                  display: {
                    width: 1440,
                    height: 900,
                    scale: 2,
                  },
                  capturedAt: 10,
                },
                frame: {
                  dataUrl: "data:image/jpeg;base64,abc",
                  mimeType: "image/jpeg",
                  width: 1440,
                  height: 900,
                  capturedAt: 10,
                },
                stepCounter: 0,
                timeline: [],
                startedAt: 1,
                updatedAt: 10,
              },
            },
          },
        },
      },
    });

    expect(host.setComputerSession).toHaveBeenCalledWith(
      "main",
      expect.objectContaining({
        sessionKey: "main",
        status: "observing",
        permissions: expect.objectContaining({
          accessibility: true,
          screenRecording: false,
        }),
      }),
    );
    expect(host.notifyBrowserPaneActivity).toHaveBeenCalledWith("main", "computer");
  });

  it("clears observer metadata when the gateway explicitly removes it", () => {
    const { host, client } = connectHostGateway();

    client.emitEvent({
      event: "sessions.changed",
      payload: {
        sessionKey: "main",
        reason: "patch",
        observer: null,
      },
    });

    expect(host.setBrowserPaneObserver).toHaveBeenCalledWith("main", null);
  });

  it("ressincroniza o histórico activo quando o transcript é reescrito", async () => {
    const { host, client } = connectHostGateway();
    client.emitHello();
    loadChatHistoryMock.mockClear();
    host.chatRunId = "run-1";
    host.chatFinalizing = true;

    client.emitEvent({
      event: "sessions.changed",
      payload: {
        sessionKey: "main",
        phase: "transcript",
      },
    });

    await vi.waitFor(() => {
      expect(loadChatHistoryMock).toHaveBeenCalledWith(host, {
        silent: true,
        preserveEphemeral: true,
      });
    });
  });

  it("forces a canonical history reload after attachment-backed runs finish", async () => {
    const { host, client } = connectHostGateway();
    client.emitHello();

    host.chatRunId = "run-image-1";
    host.chatMessages = [
      {
        role: "user",
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
        timestamp: 20,
        idempotencyKey: "run-image-1",
      },
    ];

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "run-image-1",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "feito" }],
        },
      },
    });

    await vi.waitFor(() => {
      expect(loadChatHistoryMock).toHaveBeenCalledWith(host, {
        silent: true,
        preserveEphemeral: false,
      });
    });
  });

  it("skips chat history reload on transparent reconnect when the chat was idle", () => {
    const host = createHost();
    host.tab = "chat";

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitHello();
    expect(refreshActiveTabMock).toHaveBeenLastCalledWith(host, { includeChatHistory: true });

    refreshActiveTabMock.mockClear();
    client.emitClose({ code: 1006 });
    client.emitHello();

    expect(refreshActiveTabMock).toHaveBeenCalledTimes(1);
    expect(refreshActiveTabMock).toHaveBeenCalledWith(host, { includeChatHistory: false });
    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });

  it("precarrega o doctor antes de refrescar o setup no hello", async () => {
    const host = createHost();
    host.tab = "setup";

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitHello();

    await vi.waitFor(() => {
      expect(loadAlisioDoctorSummaryMock).toHaveBeenCalledTimes(1);
      expect(refreshActiveTabMock).toHaveBeenCalledWith(host, {
        includeChatHistory: true,
        preloadedShellState: "doctor",
      });
    });
  });

  it("mantem refresh imediato nas tabs normais e faz prefetch do doctor em background", () => {
    const host = createHost();
    host.tab = "connections";

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitHello();

    expect(loadAlisioDoctorSummaryMock).toHaveBeenCalledTimes(1);
    expect(refreshActiveTabMock).toHaveBeenCalledWith(host, { includeChatHistory: true });
  });

  it("reloads chat history after transparent reconnect when a run was interrupted", () => {
    const host = createHost();
    host.tab = "chat";

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitHello();
    refreshActiveTabMock.mockClear();

    host.chatRunId = "run-1";
    host.chatStream = "partial reply";
    client.emitClose({ code: 1006 });
    client.emitHello();

    expect(refreshActiveTabMock).toHaveBeenCalledTimes(1);
    expect(refreshActiveTabMock).toHaveBeenCalledWith(host, { includeChatHistory: true });
  });

  it("ignores stale client onEvent callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitEvent({ event: "presence", payload: { presence: [{ host: "stale" }] } });
    expect(host.eventLogBuffer).toHaveLength(0);

    secondClient.emitEvent({ event: "presence", payload: { presence: [{ host: "active" }] } });
    expect(host.eventLogBuffer).toHaveLength(1);
    expect(host.eventLogBuffer[0]?.event).toBe("presence");
  });

  it("applies update.available only from active client", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitEvent({
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "9.9.9", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toBeNull();

    secondClient.emitEvent({
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "2.0.0", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toEqual({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      channel: "latest",
    });
  });

  it("ignores stale client onClose callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitClose({ code: 1005 });
    expect(host.lastError).toBeNull();
    expect(host.lastErrorCode).toBeNull();

    secondClient.emitClose({ code: 1005 });
    expect(host.lastError).toBe("Reconnecting…");
    expect(host.lastErrorCode).toBeNull();
  });

  it("refreshes the secure device session after a device-token mismatch even without bootstrap auth", async () => {
    const host = createHost();
    host.settings.token = "shared-token";

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 1008,
      error: {
        code: "PERMISSION_DENIED",
        message: "unauthorized: device token mismatch",
        details: { code: ConnectErrorDetailCodes.AUTH_DEVICE_TOKEN_MISMATCH },
      },
    });

    expect(host.lastError).toBe("Refreshing secure device session…");
    await vi.waitFor(() => {
      expect(clearDeviceAuthTokenMock).toHaveBeenCalledWith({
        deviceId: "device-1",
        role: "operator",
      });
      expect(gatewayClientInstances).toHaveLength(2);
    });
  });

  it("maps generic fetch-failed auth errors to actionable token mismatch message", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH);
    expect(host.lastError).toContain("connection token mismatch");
  });

  it("maps TypeError fetch failures to actionable auth rate-limit guidance", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "TypeError: Failed to fetch",
        details: { code: ConnectErrorDetailCodes.AUTH_RATE_LIMITED },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.AUTH_RATE_LIMITED);
    expect(host.lastError).toContain("too many failed authentication attempts");
  });

  it("maps generic fetch failures to actionable device identity guidance", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED);
    expect(host.lastError).toContain("device identity required");
  });

  it("clears stale device auth and reconnects once when bootstrap auth hits a signature error", async () => {
    const host = createHost();
    host.gatewayBootstrapToken = "fresh-bootstrap-token";

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "device signature invalid",
        details: { code: ConnectErrorDetailCodes.DEVICE_AUTH_SIGNATURE_INVALID },
      },
    });

    await vi.waitFor(() => {
      expect(loadManagedDeviceIdentityMock).toHaveBeenCalledTimes(1);
      expect(clearDeviceAuthTokenMock).toHaveBeenCalledWith({
        deviceId: "device-1",
        role: "operator",
      });
      expect(gatewayClientInstances).toHaveLength(2);
    });
  });

  it("refreshes the control-ui bootstrap and reconnects when the bootstrap token expires", async () => {
    const host = createHost();
    host.gatewayBootstrapToken = "stale-bootstrap-token";

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized: bootstrap token invalid or expired",
        details: { code: ConnectErrorDetailCodes.AUTH_BOOTSTRAP_TOKEN_INVALID },
      },
    });

    await vi.waitFor(() => {
      expect(loadControlUiBootstrapConfigMock).toHaveBeenCalledTimes(1);
      expect(gatewayClientInstances).toHaveLength(2);
      expect(gatewayClientInstances[1].options.bootstrapToken).toBe("refreshed-bootstrap-token");
    });
  });

  it("maps generic fetch failures to actionable origin guidance", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: ConnectErrorDetailCodes.CONTROL_UI_ORIGIN_NOT_ALLOWED },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.CONTROL_UI_ORIGIN_NOT_ALLOWED);
    expect(host.lastError).toContain("origin not allowed");
  });

  it("maps legacy client-id handshake failures to a stale-page message", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message:
          "invalid connect params: at /client/id: must be equal to constant; at /client/id: must match a schema in anyOf",
      },
    });

    expect(host.lastError).toBe(
      "The local Alisio app and this page are out of sync. Reload the page or reopen Alisio, then try again.",
    );
  });

  it("preserves specific close errors even when auth detail codes are present", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Failed to fetch gateway metadata from ws://127.0.0.1:40705",
        details: { code: ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH);
    expect(host.lastError).toBe("Failed to fetch Alisio metadata from ws://127.0.0.1:40705");
  });

  it("prefers structured connect errors over close reason", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message:
          "unauthorized: connection token mismatch (open the dashboard URL and paste the token in Control UI settings)",
        details: { code: "AUTH_TOKEN_MISMATCH" },
      },
    });

    expect(host.lastError).toContain("connection token mismatch");
    expect(host.lastErrorCode).toBe("AUTH_TOKEN_MISMATCH");
  });

  it("surfaces shutdown restart reasons before the socket closes", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "shutdown",
      payload: {
        reason: "config change requires gateway restart (plugins.installs)",
        restartExpectedMs: 1500,
      },
    });
    client.emitClose({ code: 1006 });

    expect(host.lastError).toBe(
      "Restarting: config change requires Alisio restart (plugins.installs)",
    );
    expect(host.lastErrorCode).toBeNull();
  });

  it("clears pending shutdown messages on successful hello after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "shutdown",
      payload: {
        reason: "config change",
        restartExpectedMs: 1500,
      },
    });
    client.emitClose({ code: 1006 });

    expect(host.lastError).toBe("Restarting: config change");

    client.emitHello();
    expect(host.lastError).toBeNull();

    client.emitClose({ code: 1006 });
    expect(host.lastError).toBe("Reconnecting…");
  });

  it("keeps a concise resync status while reconnecting after an event gap", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitGap(7, 10);

    expect(gatewayClientInstances).toHaveLength(2);
    expect(host.lastError).toBe("Resyncing live state…");
    expect(host.lastErrorCode).toBeNull();
  });

  it("recreates the gateway client when reconnecting stays stuck without hello", () => {
    vi.useFakeTimers();
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    firstClient.emitClose({ code: 1006, reason: "tick timeout" });
    expect(host.lastError).toBe("Reconnecting…");

    vi.advanceTimersByTime(12_000);

    expect(gatewayClientInstances).toHaveLength(2);
    expect(host.client).not.toBeNull();
    expect(host.client).not.toBe(firstClient as never);
  });

  it("clears the reconnect watchdog once hello arrives", () => {
    vi.useFakeTimers();
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    firstClient.emitHello();
    vi.advanceTimersByTime(12_000);

    expect(gatewayClientInstances).toHaveLength(1);
    expect(host.lastError).toBeNull();
  });

  it("keeps shutdown restart reasons on service restart closes", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "shutdown",
      payload: {
        reason: "gateway restarting",
        restartExpectedMs: 1500,
      },
    });
    client.emitClose({ code: 1012, reason: "service restart" });

    expect(host.lastError).toBe("Restarting: Alisio is restarting");
    expect(host.lastErrorCode).toBeNull();
  });

  it("prefers shutdown restart reasons over non-1012 close reasons", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "shutdown",
      payload: {
        reason: "gateway restarting",
        restartExpectedMs: 1500,
      },
    });
    client.emitClose({ code: 1001, reason: "going away" });

    expect(host.lastError).toBe("Restarting: Alisio is restarting");
    expect(host.lastErrorCode).toBeNull();
  });

  it("does not reload chat history for each live tool result event", () => {
    const { client } = connectHostGateway();
    emitToolResultEvent(client);

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });

  it("routes plugin.approval.requested into execApprovalQueue with kind plugin", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "plugin.approval.requested",
      payload: {
        id: "plugin-approval-1",
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 120_000,
        request: {
          title: "Dangerous command detected",
          description: "chmod 777 script.sh",
          severity: "high",
          pluginId: "sage",
          agentId: "agent-1",
          sessionKey: "main",
        },
      },
    });

    expect(host.execApprovalQueue).toHaveLength(1);
    expect(host.execApprovalQueue[0]?.id).toBe("plugin-approval-1");
    expect((host.execApprovalQueue[0] as { kind: string }).kind).toBe("plugin");
  });

  it("routes plugin.approval.resolved to remove from execApprovalQueue", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    // Add a plugin approval first
    client.emitEvent({
      event: "plugin.approval.requested",
      payload: {
        id: "plugin-approval-2",
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 120_000,
        request: { title: "Alert" },
      },
    });
    expect(host.execApprovalQueue).toHaveLength(1);

    // Resolve it
    client.emitEvent({
      event: "plugin.approval.resolved",
      payload: {
        id: "plugin-approval-2",
        decision: "allow-once",
        ts: Date.now(),
        request: { title: "Alert" },
      },
    });
    expect(host.execApprovalQueue).toHaveLength(0);
    expect(host.execApprovalAuditTrail).toHaveLength(1);
    expect(host.execApprovalAuditTrail[0]?.id).toBe("plugin-approval-2");
  });

  it("reloads chat history once after the final chat event when tool output was used", () => {
    const { host, client } = connectHostGateway();
    host.chatRunId = "engine-run-1";
    emitToolResultEvent(client);

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "engine-run-1",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("commits the buffered assistant stream locally instead of reloading stale history", () => {
    const { host, client } = connectHostGateway();
    host.chatRunId = "engine-run-1";
    host.chatStream = "Olá 👋";
    host.chatStreamStartedAt = 12;

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "engine-run-1",
        sessionKey: "main",
        state: "final",
      },
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    expect(host.chatMessages).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Olá 👋" }],
        timestamp: expect.any(Number),
      },
    ]);
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(host.chatFinalizing).toBe(false);
  });

  it("still reloads history when the final event has no message and no buffered stream", () => {
    const { host, client } = connectHostGateway();
    host.chatRunId = "engine-run-1";

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "engine-run-1",
        sessionKey: "main",
        state: "final",
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(host.chatFinalizing).toBe(true);
  });

  it("reloads secondary-run history without clearing the active run state", () => {
    const { host, client } = connectHostGateway();
    host.chatRunId = "run-live";
    host.chatStream = "Still working";
    host.chatStreamStartedAt = 12;
    host.toolStreamOrder = ["tool-live"];

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "run-announce",
        sessionKey: "main",
        state: "final",
      },
    });

    expect(loadChatHistoryMock).toHaveBeenCalledWith(
      host,
      expect.objectContaining({
        silent: true,
        preserveEphemeral: true,
      }),
    );
    expect(host.chatRunId).toBe("run-live");
    expect(host.chatStream).toBe("Still working");
    expect(host.chatFinalizing).toBe(false);
  });
});

describe("resolveControlUiClientVersion", () => {
  it("returns serverVersion for same-origin websocket targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "ws://localhost:8787",
        serverVersion: "2026.3.7",
        pageUrl: "http://localhost:8787/alisio/",
      }),
    ).toBe("2026.3.7");
  });

  it("returns serverVersion for same-origin relative targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "/ws",
        serverVersion: "2026.3.7",
        pageUrl: "https://control.example.com/alisio/",
      }),
    ).toBe("2026.3.7");
  });

  it("returns serverVersion for same-origin http targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "https://control.example.com/ws",
        serverVersion: "2026.3.7",
        pageUrl: "https://control.example.com/alisio/",
      }),
    ).toBe("2026.3.7");
  });

  it("omits serverVersion for cross-origin targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "wss://gateway.example.com",
        serverVersion: "2026.3.7",
        pageUrl: "https://control.example.com/alisio/",
      }),
    ).toBeUndefined();
  });
});
