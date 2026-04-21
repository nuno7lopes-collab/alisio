import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { emitAgentEvent, registerAgentRunContext } from "../infra/agent-events.js";
import { saveMediaBuffer } from "../media/store.js";
import { extractFirstTextBlock } from "../shared/chat-message-content.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import {
  connectOk,
  installGatewayTestHooks,
  mockGetReplyFromConfigOnce,
  onceMessage,
  rpcReq,
  testState,
  trackConnectChallengeNonce,
  withGatewayServer,
  writeSessionStore,
} from "./test-helpers.js";
import { agentCommand } from "./test-helpers.mocks.js";
import { installConnectedControlUiServerSuite } from "./test-with-server.js";

vi.mock("./alisio-account-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alisio-account-context.js")>();
  const account = {
    profile: {
      userId: "test-account",
      username: "test",
      displayName: "Test User",
      email: "test@example.com",
      avatarLabel: "T",
      joinedAt: "2026-01-01T00:00:00.000Z",
      plan: "free",
    },
    preferences: {
      language: "en",
      themeFamily: "mood",
      themeMode: "system",
      themeAccents: {
        mood: "#F0B56F",
        noir: "#8B5CF6",
        matte: "#B47840",
      },
    },
    session: {
      state: "signed_in",
      profileCompleted: true,
      signedInAt: "2026-01-01T00:00:00.000Z",
    },
    devices: [
      {
        id: "test-device",
        label: "Test Mac",
        platform: "macOS",
        current: true,
        status: "active",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    cloud: {
      backend: "supabase",
      available: false,
      missingEnvVars: [],
    },
  } satisfies Parameters<typeof actual.buildAlisioGatewayAccountContext>[0];

  return {
    ...actual,
    loadAlisioGatewayAccountContext: vi.fn(async () =>
      actual.buildAlisioGatewayAccountContext(account),
    ),
  };
});

installGatewayTestHooks({ scope: "suite" });
const CHAT_RESPONSE_TIMEOUT_MS = 4_000;

let ws: WebSocket;
let port: number;

installConnectedControlUiServerSuite((started) => {
  ws = started.ws;
  port = started.port;
});

const TEST_ACCOUNT_ID = "test-account";
const resolveAccountScopedSessionStorePath = (dir: string) =>
  path.join(dir, "accounts", TEST_ACCOUNT_ID, "sessions.json");

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

describe("gateway server chat", () => {
  const buildNoReplyHistoryFixture = (includeMixedAssistant = false) => [
    {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "NO_REPLY" }],
      timestamp: 2,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "real reply" }],
      timestamp: 3,
    },
    {
      role: "assistant",
      text: "real text field reply",
      content: "NO_REPLY",
      timestamp: 4,
    },
    {
      role: "user",
      content: [{ type: "text", text: "NO_REPLY" }],
      timestamp: 5,
    },
    ...(includeMixedAssistant
      ? [
          {
            role: "assistant",
            content: [
              { type: "text", text: "NO_REPLY" },
              { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
            ],
            timestamp: 6,
          },
        ]
      : []),
  ];

  const loadChatHistoryWithMessages = async (
    messages: Array<Record<string, unknown>>,
  ): Promise<unknown[]> => {
    return withMainSessionStore(async (dir) => {
      const lines = messages.map((message) => JSON.stringify({ message }));
      await fs.writeFile(path.join(dir, "sess-main.jsonl"), lines.join("\n"), "utf-8");

      const res = await rpcReq<{ messages?: unknown[] }>(ws, "chat.history", {
        sessionKey: "main",
      });
      expect(res.ok).toBe(true);
      return res.payload?.messages ?? [];
    });
  };

  const withMainSessionStore = async <T>(run: (dir: string) => Promise<T>): Promise<T> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-gw-"));
    try {
      const storePath = resolveAccountScopedSessionStorePath(dir);
      testState.sessionStorePath = storePath;
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-main",
            updatedAt: Date.now(),
          },
        },
      });
      return await run(path.dirname(storePath));
    } finally {
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  };

  const collectHistoryTextValues = (historyMessages: unknown[]) =>
    historyMessages
      .map((message) => {
        if (message && typeof message === "object") {
          const entry = message as { text?: unknown };
          if (typeof entry.text === "string") {
            return entry.text;
          }
        }
        return extractFirstTextBlock(message);
      })
      .filter((value): value is string => typeof value === "string");

  const expectAgentWaitTimeout = (res: Awaited<ReturnType<typeof rpcReq>>) => {
    expect(res.ok).toBe(true);
    expect(res.payload?.status).toBe("timeout");
  };

  const expectAgentWaitStartedAt = (res: Awaited<ReturnType<typeof rpcReq>>, startedAt: number) => {
    expect(res.ok).toBe(true);
    expect(res.payload?.status).toBe("ok");
    expect(res.payload?.startedAt).toBe(startedAt);
  };

  const sendChatAndExpectStarted = async (runId: string, message = `ping ${runId}`) => {
    const normalizedMessage = message.includes(runId) ? message : `${message} [${runId}]`;
    const res = await rpcReq(ws, "chat.send", {
      sessionKey: "main",
      message: normalizedMessage,
      idempotencyKey: runId,
    });
    expect(res.ok).toBe(true);
    expect(res.payload?.status).toBe("started");
    return res;
  };

  const waitForAgentRunOk = async (runId: string, timeoutMs = 1_000) => {
    const res = await rpcReq(ws, "agent.wait", {
      runId,
      timeoutMs,
    });
    expect(res.ok).toBe(true);
    expect(res.payload?.status).toBe("ok");
    return res;
  };

  const abortChatRun = async (runId: string) => {
    const res = await rpcReq(ws, "chat.abort", {
      sessionKey: "main",
      runId,
    });
    expect(res.ok).toBe(true);
    return res;
  };

  const mockBlockedChatReply = () => {
    let releaseBlockedReply: (() => void) | undefined;
    const blockedReply = new Promise<void>((resolve) => {
      releaseBlockedReply = resolve;
    });
    mockGetReplyFromConfigOnce(async (_ctx, opts) => {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve();
        };
        void blockedReply.then(finish);
        if (opts?.abortSignal?.aborted) {
          finish();
          return;
        }
        opts?.abortSignal?.addEventListener("abort", finish, { once: true });
      });
      return undefined;
    });
    return () => {
      releaseBlockedReply?.();
    };
  };

  test("sessions.send accepts dashboard messages for existing sessions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-sessions-send-"));
    testState.sessionStorePath = resolveAccountScopedSessionStorePath(dir);
    try {
      await writeSessionStore({
        entries: {
          "agent:main:dashboard:test-send": {
            sessionId: "sess-dashboard-send",
            updatedAt: Date.now(),
          },
        },
      });

      const res = await rpcReq(ws, "sessions.send", {
        key: "agent:main:dashboard:test-send",
        message: "hello from dashboard",
        idempotencyKey: "idem-sessions-send-1",
      });
      expect(res.ok).toBe(true);
      expect(res.payload?.runId).toBe("idem-sessions-send-1");
      expect(res.payload?.messageSeq).toBe(1);
    } finally {
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("sessions.steer accepts dashboard follow-up messages for existing sessions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-sessions-steer-"));
    testState.sessionStorePath = resolveAccountScopedSessionStorePath(dir);
    try {
      await writeSessionStore({
        entries: {
          "agent:main:dashboard:test-steer": {
            sessionId: "sess-dashboard-steer",
            updatedAt: Date.now(),
          },
        },
      });

      const res = await rpcReq(ws, "sessions.steer", {
        key: "agent:main:dashboard:test-steer",
        message: "follow-up from dashboard",
        idempotencyKey: "idem-sessions-steer-1",
      });
      expect(res.ok).toBe(true);
      expect(res.payload?.runId).toBe("idem-sessions-steer-1");
      expect(res.payload?.messageSeq).toBe(1);
    } finally {
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("sessions.abort stops active dashboard runs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-sessions-abort-"));
    testState.sessionStorePath = resolveAccountScopedSessionStorePath(dir);
    try {
      await writeSessionStore({
        entries: {
          "agent:main:dashboard:test-abort": {
            sessionId: "sess-dashboard-abort",
            updatedAt: Date.now(),
          },
        },
      });

      const sendRes = await rpcReq(ws, "sessions.send", {
        key: "agent:main:dashboard:test-abort",
        message: "hello",
        idempotencyKey: "idem-sessions-abort-1",
        timeoutMs: 30_000,
      });
      expect(sendRes.ok).toBe(true);

      const abortRes = await rpcReq(ws, "sessions.abort", {
        key: "agent:main:dashboard:test-abort",
        runId: "idem-sessions-abort-1",
      });
      expect(abortRes.ok).toBe(true);
      expect(["aborted", "no-active-run"]).toContain(abortRes.payload?.status);
      if (abortRes.payload?.status === "aborted") {
        expect(abortRes.payload?.abortedRunId).toBe("idem-sessions-abort-1");
      } else {
        expect(abortRes.payload?.abortedRunId).toBeNull();
      }
    } finally {
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("sanitizes inbound chat.send message text and rejects null bytes", async () => {
    const nullByteRes = await rpcReq(ws, "chat.send", {
      sessionKey: "main",
      message: "hello\u0000world",
      idempotencyKey: "idem-null-byte-1",
    });
    expect(nullByteRes.ok).toBe(false);
    expect((nullByteRes.error as { message?: string } | undefined)?.message ?? "").toMatch(
      /null bytes/i,
    );

    const sanitizedRes = await rpcReq(ws, "chat.send", {
      sessionKey: "main",
      message: "Cafe\u0301\u0007\tline",
      idempotencyKey: "idem-sanitized-1",
    });
    expect(sanitizedRes.ok).toBe(true);
  });

  test("dedupes repeated chat.send payloads with different idempotency keys while the first run is still in flight", async () => {
    const releaseBlockedReply = mockBlockedChatReply();
    const realNow = Date.now.bind(Date);
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow());
    const semanticMessage = `abre o google semantic ${Date.now()}`;

    try {
      const first = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: semanticMessage,
        idempotencyKey: "idem-semantic-1",
      });
      expect(first.ok).toBe(true);
      expect(first.payload?.status).toBe("started");

      const second = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: `  ${semanticMessage.split(" ").join("   ")}  `,
        idempotencyKey: "idem-semantic-2",
      });
      expect(second.ok).toBe(true);
      expect(second.payload?.runId).toBe("idem-semantic-1");
      expect(["in_flight", "ok"]).toContain(second.payload?.status ?? "");

      nowSpy.mockImplementation(() => realNow() + 15_000);
      const third = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: semanticMessage,
        idempotencyKey: "idem-semantic-3",
      });
      expect(third.ok).toBe(true);
      expect(third.payload?.runId).toBe("idem-semantic-1");
      // A later semantic replay may still hit the active run, or it may reuse the
      // same run's terminal cache if the original reply resolved before this probe.
      expect(["in_flight", "ok"]).toContain(third.payload?.status ?? "");
      nowSpy.mockImplementation(() => realNow());
    } finally {
      nowSpy.mockRestore();
      releaseBlockedReply();
    }
  });

  test("handles chat send and history flows", async () => {
    const tempDirs: string[] = [];
    let webchatWs: WebSocket | undefined;

    try {
      webchatWs = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { origin: `http://127.0.0.1:${port}` },
      });
      trackConnectChallengeNonce(webchatWs);
      await new Promise<void>((resolve) => webchatWs?.once("open", resolve));
      await connectOk(webchatWs, {
        client: {
          id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
          version: "dev",
          platform: "web",
          mode: GATEWAY_CLIENT_MODES.WEBCHAT,
        },
      });

      const webchatRes = await rpcReq(webchatWs, "chat.send", {
        sessionKey: "main",
        message: "hello from webchat",
        idempotencyKey: "idem-webchat-1",
      });
      expect(webchatRes.ok).toBe(true);

      webchatWs.close();
      webchatWs = undefined;

      testState.agentConfig = { timeoutSeconds: 123 };
      const timeoutRes = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "hello with timeout override",
        idempotencyKey: "idem-timeout-1",
      });
      expect(timeoutRes.ok).toBe(true);
      expect(timeoutRes.payload?.runId).toBe("idem-timeout-1");
      testState.agentConfig = undefined;

      const sessionRes = await rpcReq(ws, "chat.send", {
        sessionKey: "agent:main:subagent:abc",
        message: "hello subagent",
        idempotencyKey: "idem-session-key-1",
      });
      expect(sessionRes.ok).toBe(true);
      expect(sessionRes.payload?.runId).toBe("idem-session-key-1");

      const sendPolicyDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-gw-"));
      tempDirs.push(sendPolicyDir);
      testState.sessionStorePath = resolveAccountScopedSessionStorePath(sendPolicyDir);
      testState.sessionConfig = {
        sendPolicy: {
          default: "allow",
          rules: [
            {
              action: "deny",
              match: { channel: "discord", chatType: "group" },
            },
          ],
        },
      };

      await writeSessionStore({
        entries: {
          "discord:group:dev": {
            sessionId: "sess-discord",
            updatedAt: Date.now(),
            chatType: "group",
            channel: "discord",
          },
        },
      });

      const blockedRes = await rpcReq(ws, "chat.send", {
        sessionKey: "discord:group:dev",
        message: "hello",
        idempotencyKey: "idem-1",
      });
      expect(blockedRes.ok).toBe(false);
      expect((blockedRes.error as { message?: string } | undefined)?.message ?? "").toMatch(
        /send blocked/i,
      );

      testState.sessionStorePath = undefined;
      testState.sessionConfig = undefined;

      const agentBlockedDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-gw-"));
      tempDirs.push(agentBlockedDir);
      testState.sessionStorePath = resolveAccountScopedSessionStorePath(agentBlockedDir);
      testState.sessionConfig = {
        sendPolicy: {
          default: "allow",
          rules: [{ action: "deny", match: { keyPrefix: "cron:" } }],
        },
      };

      await writeSessionStore({
        entries: {
          "cron:job-1": {
            sessionId: "sess-cron",
            updatedAt: Date.now(),
          },
        },
      });

      const agentBlockedRes = await rpcReq(ws, "agent", {
        sessionKey: "cron:job-1",
        message: "hi",
        idempotencyKey: "idem-2",
      });
      expect(agentBlockedRes.ok).toBe(false);
      expect((agentBlockedRes.error as { message?: string } | undefined)?.message ?? "").toMatch(
        /send blocked/i,
      );

      testState.sessionStorePath = undefined;
      testState.sessionConfig = undefined;

      const pngB64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

      const reqId = "chat-img";
      ws.send(
        JSON.stringify({
          type: "req",
          id: reqId,
          method: "chat.send",
          params: {
            sessionKey: "main",
            message: "see image",
            idempotencyKey: "idem-img",
            attachments: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: pngB64,
                },
              },
            ],
          },
        }),
      );

      const imgRes = await onceMessage(
        ws,
        (o) => o.type === "res" && o.id === reqId,
        CHAT_RESPONSE_TIMEOUT_MS,
      );
      expect(imgRes.ok).toBe(true);
      expect(imgRes.payload?.runId).toBeDefined();
      const reqIdOnly = "chat-img-only";
      ws.send(
        JSON.stringify({
          type: "req",
          id: reqIdOnly,
          method: "chat.send",
          params: {
            sessionKey: "main",
            message: "",
            idempotencyKey: "idem-img-only",
            attachments: [
              {
                type: "image",
                mimeType: "image/png",
                fileName: "dot.png",
                content: `data:image/png;base64,${pngB64}`,
              },
            ],
          },
        }),
      );

      const imgOnlyRes = await onceMessage(
        ws,
        (o) => o.type === "res" && o.id === reqIdOnly,
        CHAT_RESPONSE_TIMEOUT_MS,
      );
      expect(imgOnlyRes.ok).toBe(true);
      expect(imgOnlyRes.payload?.runId).toBeDefined();

      const historyDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-gw-"));
      tempDirs.push(historyDir);
      testState.sessionStorePath = resolveAccountScopedSessionStorePath(historyDir);
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-main",
            updatedAt: Date.now(),
          },
        },
      });

      const lines: string[] = [];
      for (let i = 0; i < 300; i += 1) {
        lines.push(
          JSON.stringify({
            message: {
              role: "user",
              content: [{ type: "text", text: `m${i}` }],
              timestamp: Date.now() + i,
            },
          }),
        );
      }
      await fs.writeFile(
        path.join(path.dirname(testState.sessionStorePath), "sess-main.jsonl"),
        lines.join("\n"),
        "utf-8",
      );

      const defaultRes = await rpcReq<{ messages?: unknown[] }>(ws, "chat.history", {
        sessionKey: "main",
      });
      expect(defaultRes.ok).toBe(true);
      const defaultMsgs = defaultRes.payload?.messages ?? [];
      expect(defaultMsgs.length).toBe(200);
      expect(extractFirstTextBlock(defaultMsgs[0])).toBe("m100");
    } finally {
      testState.agentConfig = undefined;
      testState.sessionStorePath = undefined;
      testState.sessionConfig = undefined;
      if (webchatWs) {
        webchatWs.close();
      }
      await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    }
  });

  test("chat.history hides assistant NO_REPLY-only entries", async () => {
    const historyMessages = await loadChatHistoryWithMessages(buildNoReplyHistoryFixture());
    const textValues = collectHistoryTextValues(historyMessages);
    // The NO_REPLY assistant message (content block) should be dropped.
    // The assistant with text="real text field reply" + content="NO_REPLY" stays
    // because entry.text takes precedence over entry.content for the silent check.
    // The user message with NO_REPLY text is preserved (only assistant filtered).
    expect(textValues).toEqual(["hello", "real reply", "real text field reply", "NO_REPLY"]);
  });

  test("chat.history hides heartbeat acknowledgements on interactive chat surfaces", async () => {
    testState.channelsConfig = {
      defaults: {
        heartbeat: {
          showOk: false,
        },
      },
    };
    try {
      const historyMessages = await loadChatHistoryWithMessages([
        {
          role: "assistant",
          content: [{ type: "text", text: "HEARTBEAT_OK" }],
          timestamp: 1,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Olá 👋" }],
          timestamp: 2,
        },
      ]);

      expect(collectHistoryTextValues(historyMessages)).toEqual(["Olá 👋"]);
    } finally {
      testState.channelsConfig = undefined;
    }
  });

  test("chat.history keeps heartbeat-tagged assistant entries when they carry media", async () => {
    testState.channelsConfig = {
      defaults: {
        heartbeat: {
          showOk: false,
        },
      },
    };
    try {
      const historyMessages = await loadChatHistoryWithMessages([
        {
          role: "assistant",
          content: [
            { type: "text", text: "HEARTBEAT_OK" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
          ],
          timestamp: 1,
        },
      ]);

      expect(historyMessages).toHaveLength(1);
    } finally {
      testState.channelsConfig = undefined;
    }
  });

  test("routes chat.send slash commands without agent runs", async () => {
    await withMainSessionStore(async () => {
      const spy = vi.mocked(agentCommand);
      const callsBefore = spy.mock.calls.length;
      const eventPromise = onceMessage(
        ws,
        (o) =>
          o.type === "event" &&
          o.event === "chat" &&
          o.payload?.state === "final" &&
          o.payload?.runId === "idem-command-1",
        8000,
      );
      const res = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "/context list",
        idempotencyKey: "idem-command-1",
      });
      expect(res.ok, JSON.stringify(res)).toBe(true);
      await eventPromise;
      expect(spy.mock.calls.length).toBe(callsBefore);
    });
  });

  test("chat.history hides assistant NO_REPLY-only entries and keeps mixed-content assistant entries", async () => {
    const historyMessages = await loadChatHistoryWithMessages(buildNoReplyHistoryFixture(true));
    const roleAndText = historyMessages
      .map((message) => {
        const role =
          message &&
          typeof message === "object" &&
          typeof (message as { role?: unknown }).role === "string"
            ? (message as { role: string }).role
            : "unknown";
        const text =
          message &&
          typeof message === "object" &&
          typeof (message as { text?: unknown }).text === "string"
            ? (message as { text: string }).text
            : (extractFirstTextBlock(message) ?? "");
        return `${role}:${text}`;
      })
      .filter((entry) => entry !== "unknown:");

    expect(roleAndText).toEqual([
      "user:hello",
      "assistant:real reply",
      "assistant:real text field reply",
      "user:NO_REPLY",
      "assistant:NO_REPLY",
    ]);
  });

  test("chat.history rehydrates inline image previews for persisted media attachments", async () => {
    const saved = await saveMediaBuffer(
      Buffer.from(PNG_1X1_BASE64, "base64"),
      "image/png",
      "inbound",
      5_000_000,
      "reload-preview.png",
    );

    try {
      const historyMessages = await loadChatHistoryWithMessages([
        {
          role: "user",
          content: "",
          MediaPath: saved.path,
          MediaPaths: [saved.path],
          MediaType: "image/png",
          MediaTypes: ["image/png"],
          timestamp: 1,
        },
      ]);

      expect(historyMessages).toHaveLength(1);
      expect(historyMessages[0]).toMatchObject({
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: expect.any(String),
            },
          },
        ],
      });
    } finally {
      await fs.rm(saved.path, { force: true }).catch(() => {});
    }
  });

  test("chat.history normalizes persisted media MIME parameters before building previews", async () => {
    const saved = await saveMediaBuffer(
      Buffer.from(PNG_1X1_BASE64, "base64"),
      "image/png",
      "inbound",
      5_000_000,
      "reload-preview-params.png",
    );

    try {
      const historyMessages = await loadChatHistoryWithMessages([
        {
          role: "user",
          content: "",
          MediaPath: saved.path,
          MediaPaths: [saved.path],
          MediaType: "Image/PNG; charset=utf-8",
          MediaTypes: ["Image/PNG; charset=utf-8"],
          timestamp: 1,
        },
      ]);

      expect(historyMessages).toHaveLength(1);
      expect(historyMessages[0]).toMatchObject({
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: expect.any(String),
            },
          },
        ],
      });
    } finally {
      await fs.rm(saved.path, { force: true }).catch(() => {});
    }
  });

  test("chat.history prefers persisted image previews even when the original media file is gone", async () => {
    const historyMessages = await loadChatHistoryWithMessages([
      {
        role: "user",
        content: "",
        MediaPath: "/tmp/missing-image.png",
        MediaPaths: ["/tmp/missing-image.png"],
        MediaType: "image/png",
        MediaTypes: ["image/png"],
        MediaPreviewImages: [
          {
            mimeType: "image/png",
            data: PNG_1X1_BASE64,
          },
        ],
        timestamp: 1,
      },
    ]);

    expect(historyMessages).toHaveLength(1);
    expect(historyMessages[0]).toMatchObject({
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: PNG_1X1_BASE64,
          },
        },
      ],
    });
  });

  test("chat.history rehydrates non-image attachments as structured attachment blocks", async () => {
    const saved = await saveMediaBuffer(
      Buffer.from("%PDF-1.4\n"),
      "application/pdf",
      "inbound",
      5_000_000,
      "brief.pdf",
    );

    try {
      const historyMessages = await loadChatHistoryWithMessages([
        {
          role: "user",
          content: "",
          MediaPath: saved.path,
          MediaPaths: [saved.path],
          MediaType: "application/pdf",
          MediaTypes: ["application/pdf"],
          timestamp: 1,
        },
      ]);

      expect(historyMessages).toHaveLength(1);
      expect(historyMessages[0]).toMatchObject({
        role: "user",
        content: [
          {
            type: "attachment",
            mimeType: "application/pdf",
            fileName: expect.stringContaining("brief.pdf"),
          },
        ],
      });
    } finally {
      await fs.rm(saved.path, { force: true }).catch(() => {});
    }
  });

  test("chat.send does not persist verboseLevel for operator.write callers", async () => {
    await withGatewayServer(async ({ port }) => {
      await withMainSessionStore(async () => {
        let scopedWs: WebSocket | undefined;

        try {
          scopedWs = new WebSocket(`ws://127.0.0.1:${port}`);
          trackConnectChallengeNonce(scopedWs);
          await new Promise<void>((resolve) => scopedWs?.once("open", resolve));
          await connectOk(scopedWs, {
            scopes: ["operator.write"],
          });

          const sendRes = await rpcReq(scopedWs, "chat.send", {
            sessionKey: "main",
            message: "/verbose full",
            idempotencyKey: "idem-write-scope-verbose-no-persist",
          });
          expect(sendRes.ok).toBe(true);

          const waitRes = await rpcReq(scopedWs, "agent.wait", {
            runId: "idem-write-scope-verbose-no-persist",
            timeoutMs: 1_000,
          });
          expect(waitRes.ok).toBe(true);
          expect(waitRes.payload?.status).toBe("ok");

          const raw = await fs.readFile(testState.sessionStorePath!, "utf-8");
          const stored = JSON.parse(raw) as {
            "agent:main:main"?: {
              verboseLevel?: string;
            };
          };
          expect(stored["agent:main:main"]?.verboseLevel).toBeUndefined();
        } finally {
          scopedWs?.close();
        }
      });
    });
  });

  test("chat.send does not rotate sessions for operator.write reset triggers", async () => {
    await withGatewayServer(async ({ port }) => {
      await withMainSessionStore(async () => {
        let scopedWs: WebSocket | undefined;

        try {
          scopedWs = new WebSocket(`ws://127.0.0.1:${port}`);
          trackConnectChallengeNonce(scopedWs);
          await new Promise<void>((resolve) => scopedWs?.once("open", resolve));
          await connectOk(scopedWs, {
            scopes: ["operator.write"],
          });

          const sendRes = await rpcReq(scopedWs, "chat.send", {
            sessionKey: "main",
            message: "/reset",
            idempotencyKey: "idem-write-scope-reset-no-rotate",
          });
          expect(sendRes.ok).toBe(true);

          const waitRes = await rpcReq(scopedWs, "agent.wait", {
            runId: "idem-write-scope-reset-no-rotate",
            timeoutMs: 1_000,
          });
          expect(waitRes.ok).toBe(true);
          expect(waitRes.payload?.status).toBe("ok");

          const raw = await fs.readFile(testState.sessionStorePath!, "utf-8");
          const stored = JSON.parse(raw) as {
            "agent:main:main"?: {
              sessionId?: string;
            };
          };
          expect(stored["agent:main:main"]?.sessionId).toBe("sess-main");
        } finally {
          scopedWs?.close();
        }
      });
    });
  });

  test("agent.wait resolves chat.send runs that finish without lifecycle events", async () => {
    await withMainSessionStore(async () => {
      const runId = "idem-wait-chat-1";
      await sendChatAndExpectStarted(runId);
      await waitForAgentRunOk(runId);
    });
  });

  test("agent.wait ignores stale chat dedupe when an agent run with the same runId is in flight", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-gw-"));
    let resolveAgentRun: (() => void) | undefined;
    const blockedAgentRun = new Promise<void>((resolve) => {
      resolveAgentRun = resolve;
    });
    const agentSpy = vi.mocked(agentCommand);
    agentSpy.mockImplementationOnce(async () => {
      await blockedAgentRun;
      return undefined;
    });

    try {
      testState.sessionStorePath = resolveAccountScopedSessionStorePath(dir);
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-main",
            updatedAt: Date.now(),
          },
        },
      });

      const runId = "idem-wait-chat-vs-agent";
      await sendChatAndExpectStarted(runId);
      await waitForAgentRunOk(runId);

      const agentRes = await rpcReq(ws, "agent", {
        sessionKey: "main",
        message: "hold this run open",
        idempotencyKey: runId,
      });
      expect(agentRes.ok).toBe(true);
      expect(agentRes.payload?.status).toBe("accepted");

      const waitWhileAgentInFlight = await rpcReq(ws, "agent.wait", {
        runId,
        timeoutMs: 40,
      });
      expectAgentWaitTimeout(waitWhileAgentInFlight);

      resolveAgentRun?.();
      await waitForAgentRunOk(runId);
    } finally {
      resolveAgentRun?.();
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("agent.wait ignores stale agent snapshots while same-runId chat.send is active", async () => {
    await withMainSessionStore(async () => {
      const runId = "idem-wait-chat-active-vs-stale-agent";
      const seedAgentRes = await rpcReq(ws, "agent", {
        sessionKey: "main",
        message: "seed stale agent snapshot",
        idempotencyKey: runId,
      });
      expect(seedAgentRes.ok).toBe(true);
      expect(seedAgentRes.payload?.status).toBe("accepted");

      const seedWaitRes = await rpcReq(ws, "agent.wait", {
        runId,
        timeoutMs: 1_000,
      });
      expect(seedWaitRes.ok).toBe(true);
      expect(seedWaitRes.payload?.status).toBe("ok");

      const releaseBlockedReply = mockBlockedChatReply();

      try {
        await sendChatAndExpectStarted(runId, "hold chat run open");

        const waitWhileChatActive = await rpcReq(ws, "agent.wait", {
          runId,
          timeoutMs: 40,
        });
        expectAgentWaitTimeout(waitWhileChatActive);

        await abortChatRun(runId);
      } finally {
        releaseBlockedReply();
      }
    });
  });

  test("agent.wait keeps lifecycle wait active while same-runId chat.send is active", async () => {
    await withMainSessionStore(async () => {
      const runId = "idem-wait-chat-active-with-agent-lifecycle";
      const releaseBlockedReply = mockBlockedChatReply();

      try {
        await sendChatAndExpectStarted(runId, "hold chat run open");

        const waitP = rpcReq(ws, "agent.wait", {
          runId,
          timeoutMs: 1_000,
        });

        vi.useFakeTimers();
        try {
          const settle = new Promise((resolve) => setTimeout(resolve, 20));
          await vi.advanceTimersByTimeAsync(20);
          await settle;
        } finally {
          vi.useRealTimers();
        }
        emitAgentEvent({
          runId,
          stream: "lifecycle",
          data: { phase: "start", startedAt: 1 },
        });
        emitAgentEvent({
          runId,
          stream: "lifecycle",
          data: { phase: "end", startedAt: 1, endedAt: 2 },
        });

        const waitRes = await waitP;
        expect(waitRes.ok).toBe(true);
        expect(waitRes.payload?.status).toBe("ok");

        await abortChatRun(runId);
      } finally {
        releaseBlockedReply();
      }
    });
  });

  test("agent events include sessionKey and agent.wait covers lifecycle flows", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-gw-"));
    testState.sessionStorePath = resolveAccountScopedSessionStorePath(dir);
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-main",
          updatedAt: Date.now(),
          verboseLevel: "off",
        },
      },
    });

    const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    trackConnectChallengeNonce(webchatWs);
    await new Promise<void>((resolve) => webchatWs.once("open", resolve));
    await connectOk(webchatWs, {
      client: {
        id: GATEWAY_CLIENT_NAMES.WEBCHAT,
        version: "1.0.0",
        platform: "test",
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      },
    });

    try {
      registerAgentRunContext("run-tool-1", {
        sessionKey: "main",
        verboseLevel: "on",
      });

      {
        const agentEvtP = onceMessage(
          webchatWs,
          (o) => o.type === "event" && o.event === "agent" && o.payload?.runId === "run-tool-1",
          8000,
        );

        emitAgentEvent({
          runId: "run-tool-1",
          stream: "assistant",
          data: { text: "hello" },
        });

        const evt = await agentEvtP;
        const payload = evt.payload && typeof evt.payload === "object" ? evt.payload : {};
        expect(payload.sessionKey).toBe("main");
        expect(payload.stream).toBe("assistant");
      }

      {
        const waitP = rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-1",
          timeoutMs: 200,
        });

        queueMicrotask(() => {
          emitAgentEvent({
            runId: "run-wait-1",
            stream: "lifecycle",
            data: { phase: "end", startedAt: 200, endedAt: 210 },
          });
        });

        const res = await waitP;
        expectAgentWaitStartedAt(res, 200);
      }

      {
        emitAgentEvent({
          runId: "run-wait-early",
          stream: "lifecycle",
          data: { phase: "end", startedAt: 50, endedAt: 55 },
        });

        const res = await rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-early",
          timeoutMs: 200,
        });
        expect(res.ok).toBe(true);
        expect(res.payload?.status).toBe("ok");
        expect(res.payload?.startedAt).toBe(50);
      }

      {
        const res = await rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-3",
          timeoutMs: 30,
        });
        expectAgentWaitTimeout(res);
      }

      {
        const waitP = rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-err",
          timeoutMs: 50,
        });

        queueMicrotask(() => {
          emitAgentEvent({
            runId: "run-wait-err",
            stream: "lifecycle",
            data: { phase: "error", error: "boom" },
          });
        });

        const res = await waitP;
        expectAgentWaitTimeout(res);
      }

      {
        const waitP = rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-start",
          timeoutMs: 200,
        });

        emitAgentEvent({
          runId: "run-wait-start",
          stream: "lifecycle",
          data: { phase: "start", startedAt: 123 },
        });

        queueMicrotask(() => {
          emitAgentEvent({
            runId: "run-wait-start",
            stream: "lifecycle",
            data: { phase: "end", endedAt: 456 },
          });
        });

        const res = await waitP;
        expectAgentWaitStartedAt(res, 123);
        expect(res.payload?.endedAt).toBe(456);
      }
    } finally {
      webchatWs.close();
      await fs.rm(dir, { recursive: true, force: true });
      testState.sessionStorePath = undefined;
    }
  });
});
