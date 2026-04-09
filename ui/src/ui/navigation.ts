import { t } from "../i18n/index.ts";
import { normalizeBasePath } from "./base-path.ts";
import type { IconName } from "./icons.js";

export { normalizeBasePath } from "./base-path.ts";

const PUBLIC_TABS = [
  "setup",
  "chat",
  "memory",
  "models",
  "channels",
  "capabilities",
  "connections",
  "security",
  "authentications",
  "organization",
  "settings",
] as const;

export const TAB_GROUPS = [
  {
    label: "product",
    tabs: [
      "chat",
      "memory",
      "models",
      "channels",
      "authentications",
      "capabilities",
      "connections",
      "organization",
      "settings",
    ],
  },
] as const;

const PUBLIC_SETTINGS_SECTIONS = ["general", "account", "mac", "support"] as const;

const LEGACY_SETTINGS_SECTIONS = [
  "appearance",
  "language",
  "security",
  "devices",
  "billing",
  "advanced",
  "workspace",
  "communications",
  "automation",
  "infrastructure",
  "debug",
  "logs",
] as const;

export type SettingsSection =
  | (typeof PUBLIC_SETTINGS_SECTIONS)[number]
  | (typeof LEGACY_SETTINGS_SECTIONS)[number];

type PublicTab = (typeof PUBLIC_TABS)[number];
type PublicSettingsSection = (typeof PUBLIC_SETTINGS_SECTIONS)[number];

export type Tab = PublicTab;

export function normalizePublicTab(tab: Tab): PublicTab {
  return tab;
}

export function publicTabFor(tab: Tab): PublicTab {
  return normalizePublicTab(tab);
}

const PUBLIC_TAB_PATHS: Record<PublicTab, string> = {
  setup: "/setup",
  chat: "/chat",
  memory: "/memory",
  models: "/models",
  channels: "/channels",
  capabilities: "/capabilities",
  connections: "/connections",
  security: "/security",
  authentications: "/authentications",
  organization: "/organization",
  settings: "/settings",
};

const PATH_TO_PUBLIC_TAB = new Map(
  Object.entries(PUBLIC_TAB_PATHS).map(([tab, path]) => [path, tab as PublicTab]),
);

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
  const path = PUBLIC_TAB_PATHS[normalizePublicTab(tab)];
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
  return PATH_TO_PUBLIC_TAB.get(normalized) ?? null;
}

export function normalizeSettingsSection(value: string | null | undefined): SettingsSection {
  const normalized = (value ?? "").trim();
  if (PUBLIC_SETTINGS_SECTIONS.includes(normalized as PublicSettingsSection)) {
    return normalized as PublicSettingsSection;
  }
  switch (normalized) {
    case "billing":
      return "billing";
    case "appearance":
    case "language":
      return "general";
    case "security":
    case "devices":
    case "advanced":
    case "automation":
    case "workspace":
    case "debug":
    case "logs":
      return "account";
    case "communications":
      return "support";
    case "infrastructure":
      return "mac";
    default:
      return "general";
  }
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
    return "general";
  }
  return null;
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
    if (PATH_TO_PUBLIC_TAB.has(candidate)) {
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
    case "memory":
      return "book";
    case "channels":
      return "radio";
    case "models":
      return "brain";
    case "capabilities":
      return "spark";
    case "connections":
      return "monitor";
    case "security":
      return "shield";
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
      return t("tabs.setup");
    case "chat":
      return t("tabs.chat");
    case "memory":
      return t("tabs.memory");
    case "models":
      return t("tabs.models");
    case "channels":
      return t("tabs.channels");
    case "capabilities":
      return t("tabs.capabilities");
    case "connections":
      return t("tabs.connections");
    case "security":
      return t("tabs.security");
    case "authentications":
      return t("tabs.authentications");
    case "organization":
      return t("tabs.organization");
    case "settings":
      return t("tabs.settings");
    default:
      return t("tabs.chat");
  }
}

export function subtitleForTab(tab: Tab) {
  switch (normalizePublicTab(tab)) {
    case "setup":
      return t("subtitles.setup");
    case "chat":
      return t("subtitles.chat");
    case "memory":
      return t("subtitles.memory");
    case "models":
      return t("subtitles.models");
    case "channels":
      return t("subtitles.channels");
    case "capabilities":
      return t("subtitles.capabilities");
    case "connections":
      return t("subtitles.connections");
    case "security":
      return t("subtitles.security");
    case "authentications":
      return t("subtitles.authentications");
    case "organization":
      return t("subtitles.organization");
    case "settings":
      return t("subtitles.settings");
    default:
      return t("subtitles.chat");
  }
}
