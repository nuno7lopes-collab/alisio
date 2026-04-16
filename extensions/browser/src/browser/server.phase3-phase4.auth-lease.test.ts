import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  installAgentContractHooks,
  postJson,
  startServerAndBase,
} from "./server.agent-contract.test-harness.js";
import { getPwMocks } from "./server.control-server.test-harness.js";
import { getBrowserTestFetch } from "./test-fetch.js";

const configRuntimeMocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({ browser: {} })),
  resolveConfiguredSecretInputString: vi.fn(
    async (params: { value?: { provider?: string; id?: string } }) => ({
      value:
        params.value && typeof params.value === "object"
          ? `${params.value.provider ?? "secret"}:${params.value.id ?? "missing"}`
          : undefined,
    }),
  ),
}));

vi.mock("alisio/plugin-sdk/config-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("alisio/plugin-sdk/config-runtime")>();
  return {
    ...actual,
    loadConfig: configRuntimeMocks.loadConfig,
    resolveConfiguredSecretInputString: configRuntimeMocks.resolveConfiguredSecretInputString,
  };
});

type BrowserActionResponse = {
  ok?: boolean;
  error?: string;
  auth?: {
    status: "primed" | "reused";
    method: "blind-fill" | "http-credentials" | "reused-session" | "cookies" | "storage";
    origin?: string | null;
    fields?: number;
  };
  action?: {
    layer: "semantic" | "geometric" | "os";
    reusedAuth?: boolean;
    blindFilled?: boolean;
  };
};

const pwMocks = getPwMocks();

describe("browser control phase 3 and 4", () => {
  installAgentContractHooks();

  beforeEach(() => {
    vi.clearAllMocks();
    configRuntimeMocks.loadConfig.mockReturnValue({ browser: {} });
    configRuntimeMocks.resolveConfiguredSecretInputString.mockImplementation(
      async (params: { value?: { provider?: string; id?: string } }) => ({
        value:
          params.value && typeof params.value === "object"
            ? `${params.value.provider ?? "secret"}:${params.value.id ?? "missing"}`
            : undefined,
      }),
    );
    pwMocks.cookiesGetViaPlaywright.mockResolvedValue({ cookies: [] });
    pwMocks.storageGetViaPlaywright.mockResolvedValue({ values: {} });
    pwMocks.typeViaPlaywright.mockImplementation(
      async (params: { onExecutionPath?: (summary: { layer: "semantic" }) => void }) => {
        params.onExecutionPath?.({ layer: "semantic" });
      },
    );
    pwMocks.fillFormViaPlaywright.mockImplementation(
      async (params: { onExecutionPath?: (summary: { layer: "semantic" }) => void }) => {
        params.onExecutionPath?.({ layer: "semantic" });
      },
    );
  });

  it("blind fills type textRef values and returns auth metadata", async () => {
    const base = await startServerAndBase();

    const response = await postJson<BrowserActionResponse>(`${base}/act`, {
      kind: "type",
      ref: "e1",
      textRef: {
        source: "env",
        provider: "vault",
        id: "browser-password",
      },
      sessionKey: "agent:main:main",
      leaseOwner: "agent:writer-a",
    });

    expect(response.ok).toBe(true);
    expect(response.auth).toEqual({
      status: "primed",
      method: "blind-fill",
      origin: "https://example.com",
      fields: 1,
    });
    expect(response.action).toMatchObject({
      layer: "semantic",
      blindFilled: true,
    });
    expect(pwMocks.typeViaPlaywright).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "abcd1234",
        text: "vault:browser-password",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reuses existing session auth for secret fills without retyping secrets", async () => {
    const base = await startServerAndBase();
    pwMocks.cookiesGetViaPlaywright.mockResolvedValue({ cookies: [{ name: "sid", value: "abc" }] });

    const response = await postJson<BrowserActionResponse>(`${base}/act`, {
      kind: "fill",
      fields: [
        {
          ref: "e19",
          type: "password",
          valueRef: {
            source: "env",
            provider: "vault",
            id: "browser-password",
          },
        },
      ],
      preferReuseSession: true,
      sessionKey: "agent:main:main",
      leaseOwner: "agent:writer-a",
    });

    expect(response.ok).toBe(true);
    expect(response.auth).toEqual({
      status: "reused",
      method: "reused-session",
      origin: "https://example.com",
      fields: 1,
    });
    expect(response.action).toMatchObject({
      layer: "semantic",
      reusedAuth: true,
    });
    expect(pwMocks.fillFormViaPlaywright).not.toHaveBeenCalled();
  });

  it("keeps press actions on the managed action path without leaking auth payloads", async () => {
    const base = await startServerAndBase();

    const response = await postJson<BrowserActionResponse>(`${base}/act`, {
      kind: "press",
      key: "Enter",
      sessionKey: "agent:main:main",
      leaseOwner: "agent:writer-a",
    });

    expect(response.ok).toBe(true);
    expect(response.auth).toBeUndefined();
    expect(response.action).toMatchObject({
      layer: "semantic",
    });
    expect(pwMocks.pressKeyViaPlaywright).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "abcd1234",
        key: "Enter",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("enforces the same session lease across act and credential priming routes", async () => {
    const base = await startServerAndBase();
    const realFetch = getBrowserTestFetch();

    const firstAction = await postJson<BrowserActionResponse>(`${base}/act`, {
      kind: "click",
      ref: "e1",
      sessionKey: "agent:main:main",
      leaseOwner: "agent:writer-a",
    });
    expect(firstAction.ok).toBe(true);

    const primed = await postJson<BrowserActionResponse>(`${base}/set/credentials`, {
      usernameRef: {
        source: "env",
        provider: "vault",
        id: "browser-user",
      },
      passwordRef: {
        source: "env",
        provider: "vault",
        id: "browser-password",
      },
      sessionKey: "agent:main:main",
      leaseOwner: "agent:writer-a",
    });

    expect(primed.ok).toBe(true);
    expect(primed.auth).toEqual({
      status: "primed",
      method: "http-credentials",
      origin: "https://example.com",
      fields: 2,
    });
    expect(pwMocks.setHttpCredentialsViaPlaywright).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "abcd1234",
        username: "vault:browser-user",
        password: "vault:browser-password",
        clear: false,
      }),
    );

    const conflictResponse = await realFetch(`${base}/set/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clear: true,
        sessionKey: "agent:main:main",
        leaseOwner: "agent:writer-b",
      }),
    });
    const conflictBody = (await conflictResponse.json()) as BrowserActionResponse;

    expect(conflictResponse.status).toBe(409);
    expect(conflictBody.error).toContain('already controlled by "agent:writer-a"');
  });
});
