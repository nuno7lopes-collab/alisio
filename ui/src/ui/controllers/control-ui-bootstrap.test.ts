/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import {
  ALISIO_BOOTSTRAP_HTTP_PATH,
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
} from "../../../../src/gateway/control-ui-contract.js";
import type { ControlUiBootstrapState } from "./control-ui-bootstrap.ts";
import { loadControlUiBootstrapConfig } from "./control-ui-bootstrap.ts";

describe("loadControlUiBootstrapConfig", () => {
  it("loads assistant identity from the bootstrap endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          basePath: "/alisio",
          assistantName: "Ops",
          assistantAvatar: "O",
          assistantAgentId: "main",
          serverVersion: "2026.3.7",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            basePath: "/alisio",
            controlUrl: "ws://127.0.0.1:40705/alisio/",
            startupState: "needs_profile",
            account: {
              username: "nuno",
              displayName: "Nuno",
              email: "nuno@alisio.local",
              avatarLabel: "N",
              plan: "free",
            },
            ai: {
              provider: "openai",
              status: "disconnected",
            },
            bootstrapToken: "bootstrap-123",
          }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state: ControlUiBootstrapState = {
      basePath: "/alisio",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      alisioStartupLoading: false,
      alisioStartupError: null,
      alisioStartupBootstrap: null,
      gatewayBootstrapUrl: null,
      gatewayBootstrapToken: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/alisio${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`,
      `/alisio${ALISIO_BOOTSTRAP_HTTP_PATH}`,
    ]);
    expect(state.assistantName).toBe("Ops");
    expect(state.assistantAvatar).toBe("O");
    expect(state.assistantAgentId).toBe("main");
    expect(state.serverVersion).toBe("2026.3.7");
    expect(state.gatewayBootstrapUrl).toBe("ws://127.0.0.1:40705/alisio/");
    expect(state.gatewayBootstrapToken).toBe("bootstrap-123");
    expect(state.alisioStartupBootstrap?.startupState).toBe("needs_profile");

    vi.unstubAllGlobals();
  });

  it("surfaces a clear message when an old gateway serves html instead of bootstrap json", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          basePath: "/",
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAgentId: "main",
          serverVersion: "2026.3.24",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          "<!doctype html><html><head><title>\u004fpen\u0043law Control</title></head><body></body></html>",
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state: ControlUiBootstrapState = {
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      alisioStartupLoading: false,
      alisioStartupError: null,
      alisioStartupBootstrap: null,
      gatewayBootstrapUrl: null,
      gatewayBootstrapToken: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(state.alisioStartupBootstrap).toBeNull();
    expect(state.alisioStartupError).toContain("older build");
    expect(state.alisioStartupError).toContain("2026.3.24");

    vi.unstubAllGlobals();
  });

  it("ignores failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state: ControlUiBootstrapState = {
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      alisioStartupLoading: false,
      alisioStartupError: null,
      alisioStartupBootstrap: null,
      gatewayBootstrapUrl: null,
      gatewayBootstrapToken: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
      ALISIO_BOOTSTRAP_HTTP_PATH,
    ]);
    expect(state.assistantName).toBe("Assistant");
    expect(state.alisioStartupError).toBe("startup bootstrap failed (401)");

    vi.unstubAllGlobals();
  });

  it("normalizes trailing slash basePath for bootstrap fetch path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state: ControlUiBootstrapState = {
      basePath: "/alisio/",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      alisioStartupLoading: false,
      alisioStartupError: null,
      alisioStartupBootstrap: null,
      gatewayBootstrapUrl: null,
      gatewayBootstrapToken: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/alisio${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`,
      `/alisio${ALISIO_BOOTSTRAP_HTTP_PATH}`,
    ]);

    vi.unstubAllGlobals();
  });

  it("uses the Alisio account agent name when the bootstrap identity is still the default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          basePath: "/alisio",
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAgentId: "main",
          serverVersion: "2026.3.7",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            basePath: "/alisio",
            controlUrl: "ws://127.0.0.1:40705/alisio/",
            startupState: "ready",
            account: {
              username: "nuno",
              displayName: "Nuno",
              email: "nuno@alisio.local",
              agentName: "Muse",
              avatarLabel: "N",
              plan: "free",
            },
            ai: {
              provider: "openai",
              status: "connected",
            },
            bootstrapToken: "bootstrap-123",
          }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state: ControlUiBootstrapState = {
      basePath: "/alisio",
      assistantName: "Assistant",
      assistantAvatar: "A",
      assistantAgentId: null,
      serverVersion: null,
      alisioStartupLoading: false,
      alisioStartupError: null,
      alisioStartupBootstrap: null,
      gatewayBootstrapUrl: null,
      gatewayBootstrapToken: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(state.assistantName).toBe("Muse");
    expect(state.assistantAvatar).toBe("M");

    vi.unstubAllGlobals();
  });

  it("does not block startup forever when the bootstrap request hangs", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          basePath: "",
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAgentId: "main",
          serverVersion: "2026.3.30",
        }),
      })
      .mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener(
            "abort",
            () => {
              const abortError = new Error("Aborted");
              abortError.name = "AbortError";
              reject(abortError);
            },
            { once: true },
          );
        });
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state: ControlUiBootstrapState = {
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      alisioStartupLoading: false,
      alisioStartupError: null,
      alisioStartupBootstrap: null,
      gatewayBootstrapUrl: null,
      gatewayBootstrapToken: null,
    };

    const loadPromise = loadControlUiBootstrapConfig(state);
    await vi.advanceTimersByTimeAsync(3000);
    await loadPromise;

    expect(state.alisioStartupLoading).toBe(false);
    expect(state.alisioStartupError).toBeNull();
    expect(state.alisioStartupBootstrap).toBeNull();
    expect(state.gatewayBootstrapUrl).toBeNull();
    expect(state.gatewayBootstrapToken).toBeNull();
    expect(state.serverVersion).toBe("2026.3.30");

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
