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
  }
}

type NativeShellStateHost = {
  nativeShellLoading?: boolean;
  nativeShellError?: string | null;
  nativeShellState?: NativeShellState | null;
};

export function hasAlisioHostBridge(): boolean {
  return typeof window !== "undefined" && typeof window.alisioHost?.request === "function";
}

export async function requestAlisioHost<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!hasAlisioHostBridge()) {
    throw new Error("Native shell bridge unavailable");
  }
  return window.alisioHost!.request<T>(method, params);
}

export async function loadNativeShellState(state: NativeShellStateHost) {
  if (!hasAlisioHostBridge()) {
    state.nativeShellState = null;
    state.nativeShellError = null;
    state.nativeShellLoading = false;
    return;
  }
  state.nativeShellLoading = true;
  state.nativeShellError = null;
  try {
    state.nativeShellState = await requestAlisioHost<NativeShellState>("getShellState");
  } catch (error) {
    state.nativeShellError = String(error);
  } finally {
    state.nativeShellLoading = false;
  }
}

export async function setLaunchAtLogin(enabled: boolean) {
  return requestAlisioHost("setLaunchAtLogin", { enabled });
}

export async function requestNativePermission(permission: NativeShellPermission) {
  return requestAlisioHost<Record<string, boolean>>("requestPermission", { permission });
}

export async function setVoiceWake(params: {
  enabled?: boolean;
  talkEnabled?: boolean;
  triggers?: string[];
}) {
  return requestAlisioHost("setVoiceWake", params);
}

export async function revealLogs() {
  return requestAlisioHost("revealLogs");
}

export async function openNativeSettings(section?: string) {
  return requestAlisioHost("openNativeSettings", section ? { section } : {});
}

export async function rebuildAppFromCheckout() {
  return requestAlisioHost<{ ok: true }>("rebuildAppFromCheckout");
}

export async function openExternal(url: string) {
  return requestAlisioHost("openExternal", { url });
}
