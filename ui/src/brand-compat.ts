const LEGACY_BRAND_ID = "\u006fpen\u0063law";
const LEGACY_BRAND_TITLE = "\u004fpen\u0043law";

export const legacyBrandId = LEGACY_BRAND_ID;
export const legacyBrandTitle = LEGACY_BRAND_TITLE;
export const legacyDocsOrigin = `https://docs.${LEGACY_BRAND_ID}.ai`;
export const legacySiteOrigin = `https://${LEGACY_BRAND_ID}.ai`;
export const legacyToolStreamMarkerKey = `__${LEGACY_BRAND_ID}`;
export const legacyControlUiConfigPath = `/__${LEGACY_BRAND_ID}/control-ui-config.json`;
export const legacyBasePath = `/${LEGACY_BRAND_ID}`;
export const legacyAppsBasePath = `/apps/${LEGACY_BRAND_ID}`;

export const legacySkillSources = {
  bundled: `${LEGACY_BRAND_ID}-bundled`,
  managed: `${LEGACY_BRAND_ID}-managed`,
  workspace: `${LEGACY_BRAND_ID}-workspace`,
  plugin: `${LEGACY_BRAND_ID}-plugin`,
  extra: `${LEGACY_BRAND_ID}-extra`,
} as const;

export const legacyCommandPrefixPattern = new RegExp(
  `^(?:alisio|${LEGACY_BRAND_ID})\\s+|^\\/start(?:@[a-z0-9_]+)?(?:\\s+.+)?$`,
  "i",
);

export function legacyDocsUrl(rawPath: string): string {
  const path = rawPath.trim();
  return `${legacyDocsOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function legacySiteUrl(rawPath: string): string {
  const path = rawPath.trim();
  return `${legacySiteOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function legacyDotKey(...segments: string[]): string {
  return [LEGACY_BRAND_ID, ...segments].join(".");
}

export function legacyColonKey(...segments: string[]): string {
  return [LEGACY_BRAND_ID, ...segments].join(":");
}

export function legacyDashKey(...segments: string[]): string {
  return [LEGACY_BRAND_ID, ...segments].join("-");
}
