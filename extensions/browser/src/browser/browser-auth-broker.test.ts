import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserAuthBroker } from "./browser-auth-broker.js";
import { createBrowserSessionAuthCache } from "./browser-session-auth-cache.js";

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

describe("browser auth broker", () => {
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
  });

  it("resolves SecretRef inputs for blind fill and primes auth state", async () => {
    const authCache = createBrowserSessionAuthCache();
    const broker = createBrowserAuthBroker({ authCache, now: () => 123 });

    const resolved = await broker.resolveTypeInput({
      text: "",
      textRef: { source: "env", provider: "vault", id: "browser-password" },
      sessionKey: "Agent:Main:Main",
      origin: "https://example.com/login",
    });

    expect(resolved).toEqual({
      text: "vault:browser-password",
      auth: {
        status: "primed",
        method: "blind-fill",
        origin: "https://example.com",
        fields: 1,
      },
    });
    expect(authCache.read("agent:main:main", "https://example.com")).toMatchObject({
      status: "primed",
      method: "blind-fill",
      fields: 1,
    });
  });

  it("rechecks live session state before reusing cached auth", async () => {
    const authCache = createBrowserSessionAuthCache();
    authCache.write({
      sessionKey: "agent:main:main",
      origin: "https://example.com",
      status: "reused",
      method: "reused-session",
      updatedAt: 1,
      fields: 2,
    });
    const broker = createBrowserAuthBroker({ authCache, now: () => 456 });

    const resolved = await broker.resolveTypeInput({
      text: "",
      textRef: { source: "env", provider: "vault", id: "browser-password" },
      preferReuseSession: true,
      sessionKey: "agent:main:main",
      origin: "https://example.com/login",
      inspectSessionState: async () => ({
        cookies: false,
        localStorage: false,
        sessionStorage: false,
      }),
    });

    expect(resolved.skipped).not.toBe(true);
    expect(resolved.text).toBe("vault:browser-password");
    expect(resolved.auth).toEqual({
      status: "primed",
      method: "blind-fill",
      origin: "https://example.com",
      fields: 1,
    });
  });

  it("resolves http credential SecretRefs without exposing plaintext upstream", async () => {
    const authCache = createBrowserSessionAuthCache();
    const broker = createBrowserAuthBroker({ authCache, now: () => 789 });

    const resolved = await broker.resolveHttpCredentials({
      usernameRef: { source: "env", provider: "vault", id: "browser-user" },
      passwordRef: { source: "env", provider: "vault", id: "browser-password" },
      sessionKey: "agent:main:main",
      origin: "https://example.com/login",
    });

    expect(resolved).toEqual({
      clear: false,
      username: "vault:browser-user",
      password: "vault:browser-password",
      auth: {
        status: "primed",
        method: "http-credentials",
        origin: "https://example.com",
        fields: 2,
      },
    });
    expect(authCache.read("agent:main:main", "https://example.com")).toMatchObject({
      status: "primed",
      method: "http-credentials",
      fields: 2,
    });
  });
});
