import { t } from "../i18n/index.ts";
import type { IconName } from "./icons.js";

export const TAB_GROUPS = [
  {
    label: "control",
    tabs: ["home", "chat", "authentications", "organization", "sessions"],
  },
  { label: "agent", tabs: ["automations", "agents"] },
  {
    label: "settings",
    tabs: ["settings"],
  },
] as const;

export const SETTINGS_SECTIONS = [
  "workspace",
  "communications",
  "appearance",
  "automation",
  "infrastructure",
  "aiAgents",
  "mac",
  "debug",
  "logs",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Tab =
  | "agents"
  | "home"
  | "authentications"
  | "organization"
  | "sessions"
  | "automations"
  | "chat"
  | "settings";

const TAB_PATHS: Record<Tab, string> = {
  agents: "/agents",
  home: "/home",
  authentications: "/authentications",
  organization: "/organization",
  sessions: "/sessions",
  automations: "/automations",
  chat: "/chat",
  settings: "/settings",
};

const PATH_TO_TAB = new Map(Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab]));
const LEGACY_PATH_ALIASES = new Map<string, Tab>([
  ["/overview", "home"],
  ["/cron", "automations"],
  ["/channels", "organization"],
  ["/instances", "organization"],
  ["/usage", "organization"],
  ["/skills", "agents"],
  ["/nodes", "settings"],
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
  ["/config", "workspace"],
  ["/communications", "communications"],
  ["/appearance", "appearance"],
  ["/automation", "automation"],
  ["/infrastructure", "infrastructure"],
  ["/ai-agents", "aiAgents"],
  ["/debug", "debug"],
  ["/logs", "logs"],
  ["/nodes", "mac"],
]);

export function normalizeBasePath(basePath: string): string {
  if (!basePath) {
    return "";
  }
  let base = basePath.trim();
  if (!base.startsWith("/")) {
    base = `/${base}`;
  }
  if (base === "/") {
    return "";
  }
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}

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
  const path = TAB_PATHS[tab];
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
    return "home";
  }
  return PATH_TO_TAB.get(normalized) ?? LEGACY_PATH_ALIASES.get(normalized) ?? null;
}

export function normalizeSettingsSection(value: string | null | undefined): SettingsSection {
  const normalized = (value ?? "").trim();
  if (SETTINGS_SECTIONS.includes(normalized as SettingsSection)) {
    return normalized as SettingsSection;
  }
  return "workspace";
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
    return "workspace";
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
    if (PATH_TO_TAB.has(candidate) || LEGACY_PATH_ALIASES.has(candidate)) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
  }
  return `/${segments.join("/")}`;
}

export function iconForTab(tab: Tab): IconName {
  switch (tab) {
    case "agents":
      return "folder";
    case "home":
      return "spark";
    case "authentications":
      return "link";
    case "organization":
      return "barChart";
    case "automations":
      return "loader";
    case "chat":
      return "messageSquare";
    case "sessions":
      return "fileText";
    case "settings":
      return "settings";
    default:
      return "folder";
  }
}

export function titleForTab(tab: Tab) {
  return t(`tabs.${tab}`);
}

export function subtitleForTab(tab: Tab) {
  return t(`subtitles.${tab}`);
}
