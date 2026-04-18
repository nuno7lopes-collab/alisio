import { getSafeLocalStorage } from "../../local-storage.ts";
import type { ComputerSessionState } from "../types.ts";

export type BrowserPaneSurfaceKind = "browser" | "computer" | "tool_output";

export type BrowserPaneBrowserState = {
  title?: string | null;
  subtitle?: string | null;
  url?: string | null;
  screenshotUrl?: string | null;
  status?: string | null;
  updatedAt?: number | null;
};

export type BrowserPaneToolOutputState = {
  content: string | null;
  error: string | null;
};

export type BrowserPaneMarkdownState = BrowserPaneToolOutputState;

export type BrowserPanePreviewState = {
  browser: BrowserPaneBrowserState | null;
  computer: ComputerSessionState | null;
  toolOutput: BrowserPaneToolOutputState;
  selectedSurface: BrowserPaneSurfaceKind;
};

export type BrowserPaneSurface =
  | { kind: "browser"; browser: BrowserPaneBrowserState }
  | { kind: "computer"; session: ComputerSessionState }
  | { kind: "tool_output"; content: string | null; error: string | null };

export type BrowserPaneUiState = {
  open: boolean;
  selectedSurface: BrowserPaneSurfaceKind;
  touched: boolean;
};

const BROWSER_PANE_UI_STORAGE_KEY = "alisio.control.chat.browser-pane.v1";

export const DEFAULT_BROWSER_PANE_UI_STATE: BrowserPaneUiState = {
  open: false,
  selectedSurface: "computer",
  touched: false,
};

type PersistedBrowserPaneUiState = {
  open?: unknown;
  selectedSurface?: unknown;
  touched?: unknown;
};

type PersistedBrowserPaneUiMap = Record<string, PersistedBrowserPaneUiState>;

function isBrowserPaneSurfaceKind(value: unknown): value is BrowserPaneSurfaceKind {
  return (
    value === "browser" ||
    value === "computer" ||
    value === "tool_output" ||
    value === "markdown"
  );
}

function normalizeBrowserPaneUiState(
  value: PersistedBrowserPaneUiState | undefined,
): BrowserPaneUiState {
  return {
    open: value?.open === true,
    selectedSurface: isBrowserPaneSurfaceKind(value?.selectedSurface)
      ? value.selectedSurface === "markdown"
        ? "tool_output"
        : value.selectedSurface
      : DEFAULT_BROWSER_PANE_UI_STATE.selectedSurface,
    touched: value?.touched === true,
  };
}

function normalizeBrowserPaneScopeKey(params: { gatewayUrl: string; sessionKey: string }): string {
  const gatewayUrl = params.gatewayUrl.trim() || "default";
  const sessionKey = params.sessionKey.trim() || "main";
  return `${gatewayUrl}::${sessionKey}`;
}

function loadPersistedBrowserPaneUiMap(): PersistedBrowserPaneUiMap {
  try {
    const storage = getSafeLocalStorage();
    const raw = storage?.getItem(BROWSER_PANE_UI_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as PersistedBrowserPaneUiMap;
  } catch {
    return {};
  }
}

function savePersistedBrowserPaneUiMap(value: PersistedBrowserPaneUiMap): void {
  try {
    const storage = getSafeLocalStorage();
    storage?.setItem(BROWSER_PANE_UI_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best-effort persistence only.
  }
}

export function loadBrowserPaneUiState(params: {
  gatewayUrl: string;
  sessionKey: string;
}): BrowserPaneUiState {
  const scopeKey = normalizeBrowserPaneScopeKey(params);
  const map = loadPersistedBrowserPaneUiMap();
  return normalizeBrowserPaneUiState(map[scopeKey]);
}

export function saveBrowserPaneUiState(params: {
  gatewayUrl: string;
  sessionKey: string;
  state: BrowserPaneUiState;
}): void {
  const scopeKey = normalizeBrowserPaneScopeKey(params);
  const map = loadPersistedBrowserPaneUiMap();
  map[scopeKey] = {
    open: params.state.open,
    selectedSurface: params.state.selectedSurface,
    touched: params.state.touched,
  };
  savePersistedBrowserPaneUiMap(map);
}

export function getBrowserPaneAvailableSurfaces(params: {
  browser?: BrowserPaneBrowserState | null;
  computer?: ComputerSessionState | null;
  toolOutput?: BrowserPaneToolOutputState | null;
}): BrowserPaneSurfaceKind[] {
  const available: BrowserPaneSurfaceKind[] = [];
  if (params.browser) {
    available.push("browser");
  }
  if (params.computer) {
    available.push("computer");
  }
  if (params.toolOutput?.content || params.toolOutput?.error) {
    available.push("tool_output");
  }
  return available;
}

export function resolveBrowserPaneSurface(params: {
  preferredSurface: BrowserPaneSurfaceKind;
  browser?: BrowserPaneBrowserState | null;
  computer?: ComputerSessionState | null;
  toolOutput?: BrowserPaneToolOutputState | null;
}): BrowserPaneSurface | null {
  const available = getBrowserPaneAvailableSurfaces(params);
  if (available.length === 0) {
    return null;
  }
  const preferred = available.includes(params.preferredSurface)
    ? params.preferredSurface
    : available[0];
  if (preferred === "browser" && params.browser) {
    return { kind: "browser", browser: params.browser };
  }
  if (preferred === "computer" && params.computer) {
    return { kind: "computer", session: params.computer };
  }
  return {
    kind: "tool_output",
    content: params.toolOutput?.content ?? null,
    error: params.toolOutput?.error ?? null,
  };
}
