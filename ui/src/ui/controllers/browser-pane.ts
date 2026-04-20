import { getSafeLocalStorage } from "../../local-storage.ts";
import { extractToolCards } from "../chat/tool-cards.ts";
import type { ComputerSessionState } from "../types.ts";

export type BrowserPaneSurfaceKind = "preview" | "computer" | "tool_output";

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
  | { kind: "preview"; preview: BrowserPaneBrowserState }
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
  selectedSurface: "tool_output",
  touched: false,
};

type PersistedBrowserPaneUiState = {
  open?: unknown;
  selectedSurface?: unknown;
  touched?: unknown;
};

type PersistedBrowserPaneUiMap = Record<string, PersistedBrowserPaneUiState>;

function isPersistedBrowserPaneSurfaceKind(
  value: unknown,
): value is BrowserPaneSurfaceKind | "browser" | "markdown" {
  return (
    value === "preview" ||
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
    selectedSurface: isPersistedBrowserPaneSurfaceKind(value?.selectedSurface)
      ? value.selectedSurface === "markdown"
        ? "tool_output"
        : value.selectedSurface === "browser"
          ? "preview"
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

export function hasBrowserPaneBrowserActivity(
  browser: BrowserPaneBrowserState | null | undefined,
): boolean {
  if (!browser) {
    return false;
  }
  return Boolean(
    browser.title?.trim() ||
    browser.subtitle?.trim() ||
    browser.url?.trim() ||
    browser.screenshotUrl?.trim() ||
    browser.status?.trim(),
  );
}

export function hasBrowserPaneToolOutputActivity(
  toolOutput: BrowserPaneToolOutputState | null | undefined,
): boolean {
  return Boolean(toolOutput?.content || toolOutput?.error);
}

export function getBrowserPaneAvailableSurfaces(params: {
  browser?: BrowserPaneBrowserState | null;
  computer?: ComputerSessionState | null;
  toolOutput?: BrowserPaneToolOutputState | null;
}): BrowserPaneSurfaceKind[] {
  const available: BrowserPaneSurfaceKind[] = [];
  if (hasBrowserPaneToolOutputActivity(params.toolOutput)) {
    available.push("tool_output");
  }
  if (hasBrowserPaneBrowserActivity(params.browser)) {
    available.push("preview");
  }
  if (params.computer) {
    available.push("computer");
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
  if (preferred === "preview" && params.browser) {
    return { kind: "preview", preview: params.browser };
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

function isBrowserLikeToolName(name: string): boolean {
  const lowerName = name.trim().toLowerCase();
  return (
    lowerName.includes("browser") ||
    lowerName.includes("page") ||
    lowerName.includes("tab") ||
    lowerName.includes("navigate") ||
    lowerName.includes("goto")
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readFirstString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = readTrimmedString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function summarizeBrowserText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact || compact.startsWith("{") || compact.startsWith("[") || compact.includes('"ok"')) {
    return null;
  }
  return compact.length > 240 ? `${compact.slice(0, 239)}…` : compact;
}

function readBrowserScreenshotUrl(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return null;
  }
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const item = content[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      record.type === "image" &&
      typeof record.data === "string" &&
      record.data.trim() &&
      typeof record.mimeType === "string" &&
      record.mimeType.trim()
    ) {
      return `data:${record.mimeType};base64,${record.data}`;
    }
    const source =
      record.source && typeof record.source === "object" && !Array.isArray(record.source)
        ? (record.source as Record<string, unknown>)
        : null;
    if (
      source?.type === "base64" &&
      typeof source.data === "string" &&
      source.data.trim() &&
      typeof source.media_type === "string" &&
      source.media_type.trim()
    ) {
      return `data:${source.media_type};base64,${source.data}`;
    }
  }
  return null;
}

function deriveBrowserPaneBrowserStateFromMessage(
  message: unknown,
): BrowserPaneBrowserState | null {
  const cards = extractToolCards(message);
  if (cards.length === 0) {
    return null;
  }
  const screenshotUrl = readBrowserScreenshotUrl(message);
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (!card || !isBrowserLikeToolName(card.name)) {
      continue;
    }
    const details = readRecord(card.details);
    const args = readRecord(card.args);
    const externalContent = readRecord(details?.externalContent);
    const format = readFirstString(details, ["format"]);
    const title = readFirstString(details, ["title"]);
    const url =
      readFirstString(details, ["url", "finalUrl", "href"]) ??
      readFirstString(args, ["url", "targetUrl", "href"]);
    const errorText =
      readFirstString(details, ["error", "message", "reason", "statusText", "summary"]) ??
      (card.isError ? summarizeBrowserText(card.text) : null);
    const snapshotKind =
      externalContent?.kind === "snapshot" ||
      card.name.toLowerCase().includes("snapshot") ||
      card.name.toLowerCase().includes("screenshot");
    const subtitle =
      errorText ?? (snapshotKind ? (format ? `Snapshot (${format})` : "Snapshot ready") : null);
    const hasSignal = Boolean(title || url || screenshotUrl || subtitle || snapshotKind);
    if (!hasSignal) {
      continue;
    }
    return {
      ...(title ? { title } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(url ? { url } : {}),
      ...(screenshotUrl ? { screenshotUrl } : {}),
      status: errorText || card.isError ? "error" : card.phase === "start" ? "running" : "ready",
    };
  }
  return null;
}

export function deriveBrowserPaneBrowserStateFromMessages(
  messages: unknown[],
): BrowserPaneBrowserState | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const state = deriveBrowserPaneBrowserStateFromMessage(messages[index]);
    if (state) {
      return state;
    }
  }
  return null;
}
