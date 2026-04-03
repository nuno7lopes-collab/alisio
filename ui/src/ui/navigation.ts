import { normalizeBasePath } from "./base-path.ts";
import type { IconName } from "./icons.js";

export { normalizeBasePath } from "./base-path.ts";

const PUBLIC_TABS = [
  "setup",
  "chat",
  "connections",
  "authentications",
  "organization",
  "settings",
] as const;
const LEGACY_TABS = ["home", "sessions", "automations", "agents"] as const;

export const TAB_GROUPS = [
  {
    label: "product",
    tabs: ["chat", "connections", "authentications", "organization", "settings"],
  },
] as const;

const PUBLIC_SETTINGS_SECTIONS = [
  "ai",
  "appearance",
  "language",
  "account",
  "security",
  "devices",
  "billing",
  "support",
  "mac",
  "advanced",
] as const;

const LEGACY_SETTINGS_SECTIONS = [
  "workspace",
  "communications",
  "automation",
  "infrastructure",
  "aiAgents",
  "debug",
  "logs",
] as const;

export type SettingsSection =
  | (typeof PUBLIC_SETTINGS_SECTIONS)[number]
  | (typeof LEGACY_SETTINGS_SECTIONS)[number];

type PublicTab = (typeof PUBLIC_TABS)[number];
type LegacyTab = (typeof LEGACY_TABS)[number];
type PublicSettingsSection = (typeof PUBLIC_SETTINGS_SECTIONS)[number];

export type Tab = PublicTab | LegacyTab;

export function normalizePublicTab(tab: Tab): PublicTab {
  switch (tab) {
    case "setup":
    case "authentications":
    case "connections":
    case "organization":
    case "settings":
    case "chat":
      return tab;
    case "home":
    case "sessions":
    case "automations":
    case "agents":
    default:
      return "chat";
  }
}

export function publicTabFor(tab: Tab): PublicTab {
  return normalizePublicTab(tab);
}

const PUBLIC_TAB_PATHS: Record<PublicTab, string> = {
  setup: "/setup",
  chat: "/chat",
  connections: "/connections",
  authentications: "/authentications",
  organization: "/organization",
  settings: "/settings",
};

const LEGACY_TAB_PATHS: Record<LegacyTab, string> = {
  home: "/home",
  sessions: "/sessions",
  automations: "/automations",
  agents: "/agents",
};

const TAB_PATHS: Record<Tab, string> = {
  ...PUBLIC_TAB_PATHS,
  ...LEGACY_TAB_PATHS,
};

const PATH_TO_PUBLIC_TAB = new Map(
  Object.entries(PUBLIC_TAB_PATHS).map(([tab, path]) => [path, tab as PublicTab]),
);
const LEGACY_PATH_ALIASES = new Map<string, PublicTab>([
  ["/overview", "chat"],
  ["/home", "chat"],
  ["/sessions", "chat"],
  ["/cron", "chat"],
  ["/automations", "chat"],
  ["/agents", "chat"],
  ["/skills", "chat"],
  ["/connections", "connections"],
  ["/channels", "organization"],
  ["/instances", "organization"],
  ["/usage", "organization"],
  ["/nodes", "connections"],
  ["/config", "settings"],
  ["/communications", "settings"],
  ["/appearance", "settings"],
  ["/automation", "settings"],
  ["/infrastructure", "settings"],
  ["/ai-agents", "settings"],
  ["/debug", "settings"],
  ["/logs", "settings"],
]);
const LEGACY_SETTINGS_PATHS = new Map<string, SettingsSection>([
  ["/config", "account"],
  ["/communications", "support"],
  ["/appearance", "appearance"],
  ["/automation", "account"],
  ["/infrastructure", "mac"],
  ["/ai-agents", "account"],
  ["/debug", "account"],
  ["/logs", "account"],
  ["/nodes", "mac"],
]);

export function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function pathForTab(tab: Tab, basePath = ""): string {
  const base = normalizeBasePath(basePath);
  const path = TAB_PATHS[normalizePublicTab(tab)];
  return base ? `${base}${path}` : path;
}

export function tabFromPath(pathname: string, basePath = ""): Tab | null {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  let normalized = normalizePath(path).toLowerCase();
  if (normalized.endsWith("/index.html")) {
    normalized = "/";
  }
  if (normalized === "/") {
    return "setup";
  }
  return PATH_TO_PUBLIC_TAB.get(normalized) ?? LEGACY_PATH_ALIASES.get(normalized) ?? null;
}

export function normalizeSettingsSection(value: string | null | undefined): SettingsSection {
  const normalized = (value ?? "").trim();
  if (PUBLIC_SETTINGS_SECTIONS.includes(normalized as PublicSettingsSection)) {
    return normalized as PublicSettingsSection;
  }
  return "account";
}

export function settingsSectionFromPath(pathname: string, basePath = ""): SettingsSection | null {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  let normalized = normalizePath(path).toLowerCase();
  if (normalized.endsWith("/index.html")) {
    normalized = normalized.slice(0, -"/index.html".length) || "/";
  }
  if (normalized === "/settings") {
    return "account";
  }
  return LEGACY_SETTINGS_PATHS.get(normalized) ?? null;
}

export function inferBasePathFromPathname(pathname: string): string {
  let normalized = normalizePath(pathname);
  if (normalized.endsWith("/index.html")) {
    normalized = normalizePath(normalized.slice(0, -"/index.html".length));
  }
  if (normalized === "/") {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  for (let i = 0; i < segments.length; i++) {
    const candidate = `/${segments.slice(i).join("/")}`.toLowerCase();
    if (PATH_TO_PUBLIC_TAB.has(candidate) || LEGACY_PATH_ALIASES.has(candidate)) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
  }
  return `/${segments.join("/")}`;
}

export function iconForTab(tab: Tab): IconName {
  switch (normalizePublicTab(tab)) {
    case "setup":
      return "terminal";
    case "authentications":
      return "link";
    case "connections":
      return "monitor";
    case "organization":
      return "barChart";
    case "chat":
      return "messageSquare";
    case "settings":
      return "settings";
    default:
      return "messageSquare";
  }
}

export function titleForTab(tab: Tab) {
  switch (normalizePublicTab(tab)) {
    case "setup":
      return "Setup";
    case "chat":
      return "Chat";
    case "connections":
      return "Connections";
    case "authentications":
      return "Integrations";
    case "organization":
      return "Workspace";
    case "settings":
      return "Preferences";
    default:
      return "Chat";
  }
}

export function subtitleForTab(tab: Tab) {
  switch (normalizePublicTab(tab)) {
    case "setup":
      return "Connect your runtime, account, organization, connectors, and permissions.";
    case "chat":
      return "Minimal chat, context, and live tool execution.";
    case "connections":
      return "Devices, nodes, bindings, and runtime connectivity.";
    case "authentications":
      return "Connected apps, authorization state, and reconnect actions.";
    case "organization":
      return "Team access, membership, and shared workspace context.";
    case "settings":
      return "Account, AI runtime, appearance, and native controls.";
    default:
      return "Conversations, context, and tool calls.";
  }
}
