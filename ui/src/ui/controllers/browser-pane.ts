import { getSafeLocalStorage } from "../../local-storage.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";

export type BrowserPaneSurfaceKind = "observer" | "markdown";

export type BrowserPaneObserver = {
  kind: "novnc";
  url: string;
  label?: string;
};

export type BrowserPaneMarkdownState = {
  content: string | null;
  error: string | null;
};

export type BrowserPaneSurface =
  | { kind: "observer"; observer: BrowserPaneObserver }
  | { kind: "markdown"; content: string | null; error: string | null };

export type BrowserPaneUiState = {
  open: boolean;
  selectedSurface: BrowserPaneSurfaceKind;
  touched: boolean;
};

const BROWSER_PANE_UI_STORAGE_KEY = "alisio.control.chat.browser-pane.v1";

export const DEFAULT_BROWSER_PANE_UI_STATE: BrowserPaneUiState = {
  open: false,
  selectedSurface: "observer",
  touched: false,
};

type PersistedBrowserPaneUiState = {
  open?: unknown;
  selectedSurface?: unknown;
  touched?: unknown;
};

type PersistedBrowserPaneUiMap = Record<string, PersistedBrowserPaneUiState>;
type BrowserPaneObserverFieldState = {
  present: boolean;
  observer: BrowserPaneObserver | null;
};

function isBrowserPaneSurfaceKind(value: unknown): value is BrowserPaneSurfaceKind {
  return value === "observer" || value === "markdown";
}

function hasOwnRecordKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeBrowserPaneUiState(
  value: PersistedBrowserPaneUiState | undefined,
): BrowserPaneUiState {
  return {
    open: value?.open === true,
    selectedSurface: isBrowserPaneSurfaceKind(value?.selectedSurface)
      ? value.selectedSurface
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

function normalizeBrowserPaneObserver(value: unknown): BrowserPaneObserver | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!url) {
    return null;
  }
  const kindRaw = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
  if (kindRaw && kindRaw !== "novnc") {
    return null;
  }
  const label = typeof record.label === "string" ? record.label.trim() : "";
  return {
    kind: "novnc",
    url,
    ...(label ? { label } : {}),
  };
}

export function readBrowserPaneObserver(value: unknown): BrowserPaneObserver | null {
  return normalizeBrowserPaneObserver(value);
}

export function getBrowserPaneObserverIdentity(
  observer: BrowserPaneObserver | null | undefined,
): string | null {
  if (!observer?.url) {
    return null;
  }
  const trimmed = observer.url.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    return `${observer.kind}:${parsed.origin}${parsed.pathname}`;
  } catch {
    const base = trimmed.split("#", 1)[0]?.split("?", 1)[0]?.trim() || trimmed;
    return base ? `${observer.kind}:${base}` : null;
  }
}

function readBrowserPaneObserverFieldState(value: unknown): BrowserPaneObserverFieldState {
  if (!value || typeof value !== "object") {
    return { present: false, observer: null };
  }
  const record = value as Record<string, unknown>;
  if (hasOwnRecordKey(record, "observer")) {
    return {
      present: true,
      observer: readBrowserPaneObserver(record.observer),
    };
  }
  if (hasOwnRecordKey(record, "browserObserver")) {
    return {
      present: true,
      observer: readBrowserPaneObserver(record.browserObserver),
    };
  }
  return { present: false, observer: null };
}

export function readBrowserPaneObserverStateFromSessionRow(
  row: (GatewaySessionRow & { browserObserver?: unknown }) | null | undefined,
): BrowserPaneObserverFieldState {
  if (!row) {
    return { present: false, observer: null };
  }
  return readBrowserPaneObserverFieldState(row);
}

export function readBrowserPaneObserverFromSessionRow(
  row: (GatewaySessionRow & { browserObserver?: unknown }) | null | undefined,
): BrowserPaneObserver | null {
  return readBrowserPaneObserverStateFromSessionRow(row).observer;
}

export function resolveBrowserPaneSessionObserver(params: {
  sessionKey: string;
  sessions?: SessionsListResult | null;
  liveObserver?: BrowserPaneObserver | null;
}): BrowserPaneObserver | null {
  const row = params.sessions?.sessions?.find((entry) => entry.key === params.sessionKey);
  const rowObserverState = readBrowserPaneObserverStateFromSessionRow(row);
  if (rowObserverState.present) {
    return rowObserverState.observer;
  }
  return params.liveObserver ?? null;
}

export function readBrowserPaneObserverEvent(
  value: unknown,
): { sessionKey: string; observer: BrowserPaneObserver | null } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const nestedSession =
    record.session && typeof record.session === "object"
      ? (record.session as Record<string, unknown>)
      : null;
  const sessionKey =
    typeof record.sessionKey === "string" && record.sessionKey.trim()
      ? record.sessionKey.trim()
      : typeof nestedSession?.key === "string" && nestedSession.key.trim()
        ? nestedSession.key.trim()
        : "";
  if (!sessionKey) {
    return null;
  }
  const topLevelState = readBrowserPaneObserverFieldState(record);
  const nestedState = readBrowserPaneObserverFieldState(nestedSession);
  const observerState = topLevelState.present ? topLevelState : nestedState;
  if (!observerState.present) {
    return null;
  }
  return {
    sessionKey,
    observer: observerState.observer,
  };
}

export function getBrowserPaneAvailableSurfaces(params: {
  observer?: BrowserPaneObserver | null;
  markdown?: BrowserPaneMarkdownState | null;
}): BrowserPaneSurfaceKind[] {
  const available: BrowserPaneSurfaceKind[] = [];
  if (params.observer) {
    available.push("observer");
  }
  if (params.markdown?.content || params.markdown?.error) {
    available.push("markdown");
  }
  return available;
}

export function resolveBrowserPaneSurface(params: {
  preferredSurface: BrowserPaneSurfaceKind;
  observer?: BrowserPaneObserver | null;
  markdown?: BrowserPaneMarkdownState | null;
}): BrowserPaneSurface | null {
  const available = getBrowserPaneAvailableSurfaces(params);
  if (available.length === 0) {
    return null;
  }
  const preferred = available.includes(params.preferredSurface)
    ? params.preferredSurface
    : available[0];
  if (preferred === "observer" && params.observer) {
    return { kind: "observer", observer: params.observer };
  }
  return {
    kind: "markdown",
    content: params.markdown?.content ?? null,
    error: params.markdown?.error ?? null,
  };
}
