export const ALISIO_THEME_FAMILIES = ["mood", "noir", "matte"] as const;
export const ALISIO_THEME_MODES = ["system", "light", "dark"] as const;

export type AlisioThemeFamily = (typeof ALISIO_THEME_FAMILIES)[number];
export type AlisioThemeMode = (typeof ALISIO_THEME_MODES)[number];
export type AlisioThemeAccents = Record<AlisioThemeFamily, string>;

export const DEFAULT_THEME_FAMILY: AlisioThemeFamily = "mood";
export const DEFAULT_THEME_MODE: AlisioThemeMode = "system";
export const DEFAULT_THEME_ACCENTS: AlisioThemeAccents = {
  mood: "#F0B56F",
  noir: "#8B5CF6",
  matte: "#B47840",
};

const LEGACY_THEME_FAMILY_ALIASES: Record<string, AlisioThemeFamily> = {
  claw: "mood",
  knot: "noir",
  dash: "matte",
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeHexColor(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (!short) {
    return fallback;
  }
  const [, compact] = short;
  const expanded = compact
    .split("")
    .map((part) => `${part}${part}`)
    .join("");
  return `#${expanded.toUpperCase()}`;
}

export function normalizeThemeFamily(value: unknown): AlisioThemeFamily | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized in LEGACY_THEME_FAMILY_ALIASES) {
    return LEGACY_THEME_FAMILY_ALIASES[normalized];
  }
  return ALISIO_THEME_FAMILIES.find((entry) => entry === normalized) ?? undefined;
}

export function normalizeThemeMode(value: unknown): AlisioThemeMode | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }
  return ALISIO_THEME_MODES.find((entry) => entry === normalized) ?? undefined;
}

export function normalizeThemeAccents(value: unknown): AlisioThemeAccents {
  const raw =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const entries = Object.entries(raw).reduce<Partial<AlisioThemeAccents>>((acc, [key, entry]) => {
    const family = normalizeThemeFamily(key);
    if (!family) {
      return acc;
    }
    const normalized = normalizeHexColor(entry, DEFAULT_THEME_ACCENTS[family]);
    if (!normalized) {
      return acc;
    }
    acc[family] = normalized;
    return acc;
  }, {});

  return {
    mood: entries.mood ?? DEFAULT_THEME_ACCENTS.mood,
    noir: entries.noir ?? DEFAULT_THEME_ACCENTS.noir,
    matte: entries.matte ?? DEFAULT_THEME_ACCENTS.matte,
  };
}

export function normalizeThemeSelection(params: {
  themeFamily?: unknown;
  themeMode?: unknown;
  themeAccents?: unknown;
  legacyTheme?: unknown;
}): {
  themeFamily: AlisioThemeFamily;
  themeMode: AlisioThemeMode;
  themeAccents: AlisioThemeAccents;
} {
  const themeFamily =
    normalizeThemeFamily(params.themeFamily) ??
    normalizeThemeFamily(params.legacyTheme) ??
    DEFAULT_THEME_FAMILY;
  const themeMode =
    normalizeThemeMode(params.themeMode) ??
    normalizeThemeMode(params.legacyTheme) ??
    DEFAULT_THEME_MODE;
  return {
    themeFamily,
    themeMode,
    themeAccents: normalizeThemeAccents(params.themeAccents),
  };
}

export function themeAccentsEqual(a: AlisioThemeAccents, b: AlisioThemeAccents): boolean {
  return a.mood === b.mood && a.noir === b.noir && a.matte === b.matte;
}
