export const canonicalToolStreamMarkerKey = "__alisio";
export const canonicalDocsOrigin = "https://docs.alisio.pt";

export const canonicalSkillSources = {
  bundled: "alisio-bundled",
  managed: "alisio-managed",
  workspace: "alisio-workspace",
  plugin: "alisio-plugin",
  extra: "alisio-extra",
} as const;

const legacySkillSourceAliases: Record<string, string> = {
  "openclaw-bundled": canonicalSkillSources.bundled,
  "openclaw-managed": canonicalSkillSources.managed,
  "openclaw-workspace": canonicalSkillSources.workspace,
  "openclaw-plugin": canonicalSkillSources.plugin,
  "openclaw-extra": canonicalSkillSources.extra,
};

export function normalizeSkillSource(source: string): string {
  const normalized = source.trim();
  if (!normalized) {
    return "unknown";
  }
  return legacySkillSourceAliases[normalized] ?? normalized;
}

export const commandPrefixPattern = /^(?:alisio)\s+|^\/start(?:@[a-z0-9_]+)?(?:\s+.+)?$/i;

export function docsUrl(rawPath: string): string {
  const path = rawPath.trim();
  return `${canonicalDocsOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}
