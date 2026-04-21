/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasAlisioHostBridge,
  loadNativeShellState,
  openExternal,
  requestAlisioHost,
} from "./alisio-host.ts";
import type { NativeShellState } from "./types.ts";

const ORIGINAL_HOST = window.alisioHost;

afterEach(() => {
  if (ORIGINAL_HOST) {
    window.alisioHost = ORIGINAL_HOST;
    return;
  }
  delete window.alisioHost;
});

describe("alisio host bridge", () => {
  it("detecta uma bridge nativa quando só existe invoke", () => {
    window.alisioHost = {
      invoke: vi.fn(),
    };

    expect(hasAlisioHostBridge()).toBe(true);
  });

  it("usa invoke como fallback quando request não existe", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    window.alisioHost = { invoke };

    await expect(requestAlisioHost("openExternal", { url: "https://alisio.ai" })).resolves.toEqual({
      ok: true,
    });
    expect(invoke).toHaveBeenCalledWith("openExternal", { url: "https://alisio.ai" });
  });

  it("mantém o estado nativo a null quando a bridge não existe", async () => {
    delete window.alisioHost;
    const state: {
      nativeShellLoading: boolean;
      nativeShellError: string | null;
      nativeShellState: NativeShellState | null;
    } = {
      nativeShellLoading: true,
      nativeShellError: "stale",
      nativeShellState: {
        platform: "macos" as const,
        launchAtLogin: false,
        permissions: {
          notifications: false,
          appleScript: false,
          accessibility: false,
          screenRecording: false,
          microphone: false,
          speechRecognition: false,
          camera: false,
          location: false,
        },
        voiceWake: {
          supported: false,
          enabled: false,
          talkEnabled: false,
          triggers: [],
        },
        logsPath: null,
      },
    };

    await loadNativeShellState(state);

    expect(state.nativeShellLoading).toBe(false);
    expect(state.nativeShellError).toBeNull();
    expect(state.nativeShellState).toBeNull();
  });

  it("usa a bridge nativa para abrir links externos", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    window.alisioHost = { invoke };

    await openExternal("https://docs.alisio.ai");

    expect(invoke).toHaveBeenCalledWith("openExternal", { url: "https://docs.alisio.ai" });
  });
});
