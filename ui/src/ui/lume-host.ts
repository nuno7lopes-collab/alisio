import type { NativeShellPermission, NativeShellState } from "./types.ts";

type AlisioHostRequest = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
) => Promise<T>;

declare global {
  interface Window {
    alisioHost?: {
      request: AlisioHostRequest;
    };
    lumeHost?: {
      request: AlisioHostRequest;
    };
  }
}

type NativeShellStateHost = {
  nativeShellLoading?: boolean;
  nativeShellError?: string | null;
  nativeShellState?: NativeShellState | null;
};

export function hasLumeHostBridge(): boolean {
  return (
    typeof window !== "undefined" &&
    (typeof window.alisioHost?.request === "function" ||
      typeof window.lumeHost?.request === "function")
  );
}

export async function requestLumeHost<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!hasLumeHostBridge()) {
    throw new Error("Native shell bridge unavailable");
  }
  const host = window.alisioHost ?? window.lumeHost;
  return host!.request<T>(method, params);
}

export async function loadNativeShellState(state: NativeShellStateHost) {
  if (!hasLumeHostBridge()) {
    state.nativeShellState = null;
    state.nativeShellError = null;
    state.nativeShellLoading = false;
    return;
  }
  state.nativeShellLoading = true;
  state.nativeShellError = null;
  try {
    state.nativeShellState = await requestLumeHost<NativeShellState>("getShellState");
  } catch (error) {
    state.nativeShellError = String(error);
  } finally {
    state.nativeShellLoading = false;
  }
}

export async function setLaunchAtLogin(enabled: boolean) {
  return requestLumeHost("setLaunchAtLogin", { enabled });
}

export async function requestNativePermission(permission: NativeShellPermission) {
  return requestLumeHost<Record<string, boolean>>("requestPermission", { permission });
}

export async function setVoiceWake(params: {
  enabled?: boolean;
  talkEnabled?: boolean;
  triggers?: string[];
}) {
  return requestLumeHost("setVoiceWake", params);
}

export async function revealLogs() {
  return requestLumeHost("revealLogs");
}

export async function openNativeSettings(section?: string) {
  return requestLumeHost("openNativeSettings", section ? { section } : {});
}

export async function openExternal(url: string) {
  return requestLumeHost("openExternal", { url });
}
