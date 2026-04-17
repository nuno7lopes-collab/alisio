import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../test-helpers/storage.ts";
import { loadDeviceAuthToken, storeDeviceAuthToken } from "./device-auth.ts";
import type { DeviceIdentity } from "./device-identity.ts";

const wsInstances = vi.hoisted((): MockWebSocket[] => []);
const canUseBrowserGeneratedIdentityMock = vi.hoisted(() => vi.fn(() => true));
const loadManagedDeviceIdentityMock = vi.hoisted(() =>
  vi.fn(async (): Promise<DeviceIdentity | null> => null),
);
const loadStoredBrowserDeviceIdentityMock = vi.hoisted(() =>
  vi.fn(async (): Promise<DeviceIdentity | null> => null),
);
const clearStoredBrowserDeviceIdentityMock = vi.hoisted(() => vi.fn());
const loadOrCreateBrowserDeviceIdentityMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<DeviceIdentity> => ({
      deviceId: "browser-device-1",
      privateKey: "browser-private-key", // pragma: allowlist secret
      publicKey: "browser-public-key", // pragma: allowlist secret
      source: "browser",
    }),
  ),
);
const signDevicePayloadWithIdentityMock = vi.hoisted(() =>
  vi.fn(async (_privateKeyBase64Url: string, _payload: string) => "signature"),
);

type HandlerMap = {
  close: MockWebSocketHandler[];
  error: MockWebSocketHandler[];
  message: MockWebSocketHandler[];
  open: MockWebSocketHandler[];
};

type MockWebSocketHandler = (ev?: { code?: number; data?: string; reason?: string }) => void;

class MockWebSocket {
  static OPEN = 1;

  readonly handlers: HandlerMap = {
    close: [],
    error: [],
    message: [],
    open: [],
  };

  readonly sent: string[] = [];
  readyState = MockWebSocket.OPEN;

  constructor(_url: string) {
    wsInstances.push(this);
  }

  addEventListener(type: keyof HandlerMap, handler: MockWebSocketHandler) {
    this.handlers[type].push(handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  emitClose(code = 1000, reason = "") {
    for (const handler of this.handlers.close) {
      handler({ code, reason });
    }
  }

  emitOpen() {
    for (const handler of this.handlers.open) {
      handler();
    }
  }

  emitMessage(data: unknown) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    for (const handler of this.handlers.message) {
      handler({ data: payload });
    }
  }
}

vi.mock("./device-identity.ts", () => ({
  canUseBrowserGeneratedIdentity: canUseBrowserGeneratedIdentityMock,
  loadManagedDeviceIdentity: loadManagedDeviceIdentityMock,
  loadStoredBrowserDeviceIdentity: loadStoredBrowserDeviceIdentityMock,
  clearStoredBrowserDeviceIdentity: clearStoredBrowserDeviceIdentityMock,
  loadOrCreateBrowserDeviceIdentity: loadOrCreateBrowserDeviceIdentityMock,
  signDevicePayloadWithIdentity: signDevicePayloadWithIdentityMock,
}));

const { CONTROL_UI_OPERATOR_SCOPES, GatewayBrowserClient, shouldRetryWithDeviceToken } =
  await import("./gateway.ts");

type ConnectFrame = {
  id?: string;
  method?: string;
  params?: {
    client?: { platform?: string; deviceFamily?: string };
    auth?: { token?: string; bootstrapToken?: string; password?: string; deviceToken?: string };
    scopes?: string[];
  };
};

function stubWindowGlobals(storage?: ReturnType<typeof createStorageMock>) {
  vi.stubGlobal("window", {
    location: { href: "http://127.0.0.1:40705/" },
    localStorage: storage,
    setTimeout: (handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) =>
      globalThis.setTimeout(() => handler(...args), timeout),
    clearTimeout: (timeoutId: number | undefined) => globalThis.clearTimeout(timeoutId),
  });
}

function enableHostManagedIdentity(identity?: Partial<DeviceIdentity>) {
  window.alisioHost = {
    request: vi.fn(),
  };
  loadManagedDeviceIdentityMock.mockResolvedValue({
    deviceId: "device-1",
    privateKey: "private-key", // pragma: allowlist secret
    publicKey: "public-key", // pragma: allowlist secret
    ...identity,
  });
}

function getLatestWebSocket(): MockWebSocket {
  const ws = wsInstances.at(-1);
  if (!ws) {
    throw new Error("missing websocket instance");
  }
  return ws;
}

function stubInsecureCrypto() {
  vi.stubGlobal("crypto", {
    randomUUID: () => "req-insecure",
  });
  canUseBrowserGeneratedIdentityMock.mockReturnValue(false);
}

function parseLatestConnectFrame(ws: MockWebSocket): ConnectFrame {
  return JSON.parse(ws.sent.at(-1) ?? "{}") as ConnectFrame;
}

function parseLatestRequestFrame(
  ws: MockWebSocket,
): { id?: string; method?: string; params?: unknown } {
  return JSON.parse(ws.sent.at(-1) ?? "{}") as { id?: string; method?: string; params?: unknown };
}

async function continueConnect(ws: MockWebSocket, nonce = "nonce-1") {
  ws.emitOpen();
  ws.emitMessage({
    type: "event",
    event: "connect.challenge",
    payload: { nonce },
  });
  await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
  return { ws, connectFrame: parseLatestConnectFrame(ws) };
}

async function startConnect(client: InstanceType<typeof GatewayBrowserClient>, nonce = "nonce-1") {
  client.start();
  return await continueConnect(getLatestWebSocket(), nonce);
}

function emitRetryableTokenMismatch(ws: MockWebSocket, connectId: string | undefined) {
  ws.emitMessage({
    type: "res",
    id: connectId,
    ok: false,
    error: {
      code: "INVALID_REQUEST",
      message: "unauthorized",
      details: { code: "AUTH_TOKEN_MISMATCH", canRetryWithDeviceToken: true },
    },
  });
}

async function startRetriedDeviceTokenConnect(params: {
  url: string;
  token: string;
  retryNonce?: string;
}) {
  enableHostManagedIdentity();
  const client = new GatewayBrowserClient({
    url: params.url,
    token: params.token,
  });
  const { ws: firstWs, connectFrame: firstConnect } = await startConnect(client);
  expect(firstConnect.params?.auth?.token).toBe(params.token);
  expect(firstConnect.params?.auth?.deviceToken).toBeUndefined();

  emitRetryableTokenMismatch(firstWs, firstConnect.id);
  await vi.waitFor(() => expect(firstWs.readyState).toBe(3));
  firstWs.emitClose(4008, "connect failed");

  await vi.advanceTimersByTimeAsync(800);
  const secondWs = getLatestWebSocket();
  expect(secondWs).not.toBe(firstWs);
  const { connectFrame: secondConnect } = await continueConnect(
    secondWs,
    params.retryNonce ?? "nonce-2",
  );
  expect(secondConnect.params?.auth?.token).toBe(params.token);
  expect(secondConnect.params?.auth?.deviceToken).toBe("stored-device-token");

  return { client, firstWs, secondWs, firstConnect, secondConnect };
}

describe("GatewayBrowserClient", () => {
  beforeEach(() => {
    const storage = createStorageMock();
    wsInstances.length = 0;
    canUseBrowserGeneratedIdentityMock.mockReset();
    loadManagedDeviceIdentityMock.mockReset();
    loadStoredBrowserDeviceIdentityMock.mockReset();
    loadOrCreateBrowserDeviceIdentityMock.mockReset();
    signDevicePayloadWithIdentityMock.mockClear();
    canUseBrowserGeneratedIdentityMock.mockReturnValue(true);
    loadManagedDeviceIdentityMock.mockResolvedValue(null);
    loadStoredBrowserDeviceIdentityMock.mockResolvedValue(null);
    clearStoredBrowserDeviceIdentityMock.mockReset();
    loadOrCreateBrowserDeviceIdentityMock.mockResolvedValue({
      deviceId: "browser-device-1",
      privateKey: "browser-private-key", // pragma: allowlist secret
      publicKey: "browser-public-key", // pragma: allowlist secret
      source: "browser",
    });

    vi.stubGlobal("localStorage", storage);
    stubWindowGlobals(storage);
    localStorage.clear();
    vi.stubGlobal("WebSocket", MockWebSocket);

    storeDeviceAuthToken({
      deviceId: "device-1",
      role: "operator",
      token: "stored-device-token",
      scopes: [...CONTROL_UI_OPERATOR_SCOPES],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("requests the full control ui operator scope bundle on connect", async () => {
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      token: "shared-auth-token",
    });

    const { connectFrame } = await startConnect(client);

    expect(connectFrame.method).toBe("connect");
    expect(connectFrame.params?.scopes).toEqual([...CONTROL_UI_OPERATOR_SCOPES]);
  });

  it("prefers explicit shared auth over cached device tokens", async () => {
    enableHostManagedIdentity();
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      token: "shared-auth-token",
    });

    const { connectFrame } = await startConnect(client);

    expect(typeof connectFrame.id).toBe("string");
    expect(connectFrame.method).toBe("connect");
    expect(connectFrame.params?.auth?.token).toBe("shared-auth-token");
    expect(signDevicePayloadWithIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({ privateKey: "private-key" }),
      expect.any(String),
    );
    const signedPayload = signDevicePayloadWithIdentityMock.mock.calls[0]?.[1];
    expect(signedPayload).toContain("|shared-auth-token|nonce-1");
    expect(signedPayload).not.toContain("stored-device-token");
  });

  it("uses managed device metadata for the connect client when available", async () => {
    enableHostManagedIdentity({
      platform: "macos 26.0.1",
      deviceFamily: "Mac",
    });
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      token: "shared-auth-token",
    });

    const { connectFrame } = await startConnect(client);

    expect(connectFrame.params?.client?.platform).toBe("macos 26.0.1");
    expect(connectFrame.params?.client?.deviceFamily).toBe("Mac");
  });

  it("sends explicit shared token on insecure first connect without cached device fallback", async () => {
    stubInsecureCrypto();
    const client = new GatewayBrowserClient({
      url: "ws://gateway.example:40705",
      token: "shared-auth-token",
    });

    const { connectFrame } = await startConnect(client);

    expect(connectFrame.id).toBe("req-insecure");
    expect(connectFrame.method).toBe("connect");
    expect(connectFrame.params?.auth).toEqual({
      token: "shared-auth-token",
      password: undefined,
      deviceToken: undefined,
    });
    expect(loadManagedDeviceIdentityMock).toHaveBeenCalledOnce();
    expect(signDevicePayloadWithIdentityMock).not.toHaveBeenCalled();
  });

  it("sends explicit shared password on insecure first connect without cached device fallback", async () => {
    stubInsecureCrypto();
    const client = new GatewayBrowserClient({
      url: "ws://gateway.example:40705",
      password: "shared-password", // pragma: allowlist secret
    });

    const { connectFrame } = await startConnect(client);

    expect(connectFrame.id).toBe("req-insecure");
    expect(connectFrame.method).toBe("connect");
    expect(connectFrame.params?.auth).toEqual({
      token: undefined,
      password: "shared-password", // pragma: allowlist secret
      deviceToken: undefined,
    });
    expect(loadManagedDeviceIdentityMock).toHaveBeenCalledOnce();
    expect(signDevicePayloadWithIdentityMock).not.toHaveBeenCalled();
  });

  it("still uses the machine identity on insecure pages when a native host bridge exists", async () => {
    stubInsecureCrypto();
    enableHostManagedIdentity({
      deviceId: "host-device-1",
      publicKey: "host-public-key",
      source: "host",
    });

    const client = new GatewayBrowserClient({
      url: "ws://gateway.example:40705",
      token: "shared-auth-token",
    });

    const { connectFrame } = await startConnect(client);

    expect(connectFrame.method).toBe("connect");
    expect(loadManagedDeviceIdentityMock).toHaveBeenCalledOnce();
    expect(signDevicePayloadWithIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "host-device-1", source: "host" }),
      expect.any(String),
    );
  });

  it("uses a browser identity on localhost when no native host bridge is available", async () => {
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      token: "shared-auth-token",
    });

    const { connectFrame } = await startConnect(client);

    expect(connectFrame.method).toBe("connect");
    expect(loadManagedDeviceIdentityMock).toHaveBeenCalledOnce();
    expect(loadOrCreateBrowserDeviceIdentityMock).toHaveBeenCalledOnce();
    expect(signDevicePayloadWithIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "browser-device-1", source: "browser" }),
      expect.any(String),
    );
  });

  it("uses cached device tokens only when no explicit shared auth is provided", async () => {
    enableHostManagedIdentity();
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
    });

    const { connectFrame } = await startConnect(client);

    expect(typeof connectFrame.id).toBe("string");
    expect(connectFrame.method).toBe("connect");
    expect(connectFrame.params?.auth?.token).toBe("stored-device-token");
    expect(signDevicePayloadWithIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({ privateKey: "private-key" }),
      expect.any(String),
    );
    const signedPayload = signDevicePayloadWithIdentityMock.mock.calls[0]?.[1];
    expect(signedPayload).toContain("|stored-device-token|nonce-1");
  });

  it("signs bootstrap-token connects with the bootstrap token payload", async () => {
    enableHostManagedIdentity();
    localStorage.clear();
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      bootstrapToken: "bootstrap-token",
    });

    const { connectFrame } = await startConnect(client);

    expect(connectFrame.method).toBe("connect");
    expect(connectFrame.params?.auth?.token).toBeUndefined();
    expect(connectFrame.params?.auth?.bootstrapToken).toBe("bootstrap-token");
    const signedPayload = signDevicePayloadWithIdentityMock.mock.calls[0]?.[1];
    expect(signedPayload).toContain("|bootstrap-token|nonce-1");
  });

  it("prefers cached device tokens over bootstrap auth after the first successful connect", async () => {
    vi.useFakeTimers();
    enableHostManagedIdentity();
    localStorage.clear();
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      bootstrapToken: "bootstrap-token",
    });

    const { ws: firstWs, connectFrame: firstConnect } = await startConnect(client);

    expect(firstConnect.params?.auth).toEqual({
      token: undefined,
      bootstrapToken: "bootstrap-token",
      password: undefined,
      deviceToken: undefined,
    });

    firstWs.emitMessage({
      type: "res",
      id: firstConnect.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        auth: {
          deviceToken: "fresh-device-token",
          role: "operator",
          scopes: [...CONTROL_UI_OPERATOR_SCOPES],
        },
      },
    });
    await vi.waitFor(() =>
      expect(loadDeviceAuthToken({ deviceId: "device-1", role: "operator" })?.token).toBe(
        "fresh-device-token",
      ),
    );

    firstWs.emitClose(1006, "");
    await vi.advanceTimersByTimeAsync(800);

    const secondWs = getLatestWebSocket();
    expect(secondWs).not.toBe(firstWs);
    const { connectFrame: secondConnect } = await continueConnect(secondWs, "nonce-2");

    expect(secondConnect.params?.auth).toEqual({
      token: "fresh-device-token",
      bootstrapToken: undefined,
      password: undefined,
      deviceToken: "fresh-device-token",
    });

    const signedPayload = signDevicePayloadWithIdentityMock.mock.calls.at(-1)?.[1];
    expect(signedPayload).toContain("|fresh-device-token|nonce-2");
    expect(signedPayload).not.toContain("bootstrap-token");

    client.stop();
    vi.useRealTimers();
  });

  it("ignores cached operator device tokens that do not include read access", async () => {
    enableHostManagedIdentity();
    localStorage.clear();
    storeDeviceAuthToken({
      deviceId: "device-1",
      role: "operator",
      token: "under-scoped-device-token",
      scopes: [],
    });

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
    });

    const { connectFrame } = await startConnect(client);

    expect(connectFrame.method).toBe("connect");
    expect(connectFrame.params?.auth?.token).toBeUndefined();
    const signedPayload = signDevicePayloadWithIdentityMock.mock.calls[0]?.[1];
    expect(signedPayload).not.toContain("under-scoped-device-token");
  });

  it("retries once with device token after token mismatch when shared token is explicit", async () => {
    vi.useFakeTimers();
    const { secondWs, secondConnect } = await startRetriedDeviceTokenConnect({
      url: "ws://127.0.0.1:40705",
      token: "shared-auth-token",
    });

    secondWs.emitMessage({
      type: "res",
      id: secondConnect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized",
        details: { code: "AUTH_TOKEN_MISMATCH" },
      },
    });
    await vi.waitFor(() => expect(secondWs.readyState).toBe(3));
    secondWs.emitClose(4008, "connect failed");
    expect(loadDeviceAuthToken({ deviceId: "device-1", role: "operator" })?.token).toBe(
      "stored-device-token",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wsInstances).toHaveLength(2);

    vi.useRealTimers();
  });

  it("retries once with a stored browser identity when the host identity needs pairing", async () => {
    vi.useFakeTimers();
    enableHostManagedIdentity({
      deviceId: "host-device-1",
      publicKey: "host-public-key",
      source: "host",
    });
    loadStoredBrowserDeviceIdentityMock.mockResolvedValue({
      deviceId: "browser-device-1",
      privateKey: "browser-private-key", // pragma: allowlist secret
      publicKey: "browser-public-key", // pragma: allowlist secret
      source: "browser",
    });

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      token: "shared-auth-token",
    });

    const { ws: firstWs, connectFrame: firstConnect } = await startConnect(client);
    expect(signDevicePayloadWithIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "host-device-1", source: "host" }),
      expect.any(String),
    );

    firstWs.emitMessage({
      type: "res",
      id: firstConnect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "pairing required",
        details: { code: "PAIRING_REQUIRED" },
      },
    });
    await vi.waitFor(() => expect(firstWs.readyState).toBe(3));
    firstWs.emitClose(4008, "connect failed");

    await vi.advanceTimersByTimeAsync(800);
    const secondWs = getLatestWebSocket();
    expect(secondWs).not.toBe(firstWs);
    await continueConnect(secondWs, "nonce-2");

    expect(loadStoredBrowserDeviceIdentityMock).toHaveBeenCalledOnce();
    expect(loadOrCreateBrowserDeviceIdentityMock).not.toHaveBeenCalled();
    expect(signDevicePayloadWithIdentityMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ deviceId: "browser-device-1", source: "browser" }),
      expect.any(String),
    );

    client.stop();
    vi.useRealTimers();
  });

  it("treats IPv6 loopback as trusted for bounded device-token retry", async () => {
    vi.useFakeTimers();
    const { client } = await startRetriedDeviceTokenConnect({
      url: "ws://[::1]:40705",
      token: "shared-auth-token",
    });

    client.stop();
    vi.useRealTimers();
  });

  it("continues reconnecting on first token mismatch when no retry was attempted", async () => {
    vi.useFakeTimers();
    localStorage.clear();

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      token: "shared-auth-token",
    });

    const { ws: ws1, connectFrame: firstConnect } = await startConnect(client);

    ws1.emitMessage({
      type: "res",
      id: firstConnect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized",
        details: { code: "AUTH_TOKEN_MISMATCH" },
      },
    });
    await vi.waitFor(() => expect(ws1.readyState).toBe(3));
    ws1.emitClose(4008, "connect failed");

    await vi.advanceTimersByTimeAsync(800);
    expect(wsInstances).toHaveLength(2);

    client.stop();
    vi.useRealTimers();
  });

  it("cancels a queued connect send when stopped before the timeout fires", async () => {
    vi.useFakeTimers();

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      connectChallengeTimeoutMs: 750,
      token: "shared-auth-token",
    });

    client.start();
    const ws = getLatestWebSocket();
    ws.emitOpen();

    client.stop();
    await vi.advanceTimersByTimeAsync(750);

    expect(ws.sent).toHaveLength(0);

    vi.useRealTimers();
  });

  it("waits for connect.challenge before sending connect", async () => {
    vi.useFakeTimers();

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      connectChallengeTimeoutMs: 5_000,
      token: "shared-auth-token",
    });

    client.start();
    const ws = getLatestWebSocket();
    ws.emitOpen();

    await vi.advanceTimersByTimeAsync(750);
    expect(ws.sent).toHaveLength(0);

    ws.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    expect(parseLatestConnectFrame(ws).method).toBe("connect");

    vi.useRealTimers();
  });

  it("resets seq-gap tracking after reconnect hello", async () => {
    vi.useFakeTimers();
    const onGap = vi.fn();

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      token: "shared-auth-token",
      onGap,
    });

    const { ws: ws1, connectFrame: firstConnect } = await startConnect(client);
    ws1.emitMessage({
      type: "res",
      id: firstConnect.id,
      ok: true,
      payload: { type: "hello-ok", protocol: 3 },
    });
    ws1.emitMessage({ type: "event", event: "presence", seq: 5, payload: {} });
    expect(onGap).not.toHaveBeenCalled();

    ws1.emitClose(1006, "");
    await vi.advanceTimersByTimeAsync(800);

    const ws2 = getLatestWebSocket();
    const { connectFrame: secondConnect } = await continueConnect(ws2, "nonce-2");
    ws2.emitMessage({
      type: "res",
      id: secondConnect.id,
      ok: true,
      payload: { type: "hello-ok", protocol: 3 },
    });
    ws2.emitMessage({ type: "event", event: "presence", seq: 12, payload: {} });
    expect(onGap).not.toHaveBeenCalled();

    ws2.emitMessage({ type: "event", event: "presence", seq: 14, payload: {} });
    expect(onGap).toHaveBeenCalledWith({ expected: 13, received: 14 });

    vi.useRealTimers();
  });

  it("does not auto-reconnect on AUTH_TOKEN_MISSING", async () => {
    vi.useFakeTimers();
    localStorage.clear();

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
    });

    const { ws: ws1, connectFrame: connect } = await startConnect(client);

    ws1.emitMessage({
      type: "res",
      id: connect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized",
        details: { code: "AUTH_TOKEN_MISSING" },
      },
    });
    await vi.waitFor(() => expect(ws1.readyState).toBe(3));
    ws1.emitClose(4008, "connect failed");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(wsInstances).toHaveLength(1);

    vi.useRealTimers();
  });

  it("reconnects after an established request fails with JWT expiry", async () => {
    vi.useFakeTimers();

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:40705",
      token: "shared-auth-token",
    });

    const { ws: firstWs, connectFrame } = await startConnect(client);
    firstWs.emitMessage({
      type: "res",
      id: connectFrame.id,
      ok: true,
      payload: { type: "hello-ok", protocol: 3 },
    });

    const requestP = client.request("node.list", { timeoutMs: 4_000 });
    const requestFrame = parseLatestRequestFrame(firstWs);
    expect(requestFrame.method).toBe("node.list");

    firstWs.emitMessage({
      type: "res",
      id: requestFrame.id,
      ok: false,
      error: {
        code: "UNAVAILABLE",
        message: "JWT expired",
      },
    });

    await expect(requestP).rejects.toThrow(/JWT expired/i);
    expect(firstWs.readyState).toBe(3);
    firstWs.emitClose(4008, "request auth refresh");

    await vi.advanceTimersByTimeAsync(800);
    expect(wsInstances).toHaveLength(2);

    client.stop();
    vi.useRealTimers();
  });
});

describe("shouldRetryWithDeviceToken", () => {
  beforeEach(() => {
    stubWindowGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows a bounded retry for trusted loopback endpoints", () => {
    expect(
      shouldRetryWithDeviceToken({
        deviceTokenRetryBudgetUsed: false,
        authDeviceToken: undefined,
        explicitGatewayToken: "shared-auth-token",
        deviceIdentity: {
          deviceId: "device-1",
          privateKey: "private-key", // pragma: allowlist secret
          publicKey: "public-key", // pragma: allowlist secret
        },
        storedToken: "stored-device-token",
        canRetryWithDeviceTokenHint: true,
        url: "ws://127.0.0.1:40705",
      }),
    ).toBe(true);
  });

  it("blocks the retry after the one-shot budget is spent", () => {
    expect(
      shouldRetryWithDeviceToken({
        deviceTokenRetryBudgetUsed: true,
        authDeviceToken: undefined,
        explicitGatewayToken: "shared-auth-token",
        deviceIdentity: {
          deviceId: "device-1",
          privateKey: "private-key", // pragma: allowlist secret
          publicKey: "public-key", // pragma: allowlist secret
        },
        storedToken: "stored-device-token",
        canRetryWithDeviceTokenHint: true,
        url: "ws://127.0.0.1:40705",
      }),
    ).toBe(false);
  });
});
