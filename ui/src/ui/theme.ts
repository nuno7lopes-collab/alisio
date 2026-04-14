import {
  ALISIO_THEME_FAMILIES,
  ALISIO_THEME_MODES,
  DEFAULT_THEME_ACCENTS,
  DEFAULT_THEME_FAMILY,
  DEFAULT_THEME_MODE,
  normalizeHexColor,
  normalizeThemeAccents,
  normalizeThemeSelection,
  themeAccentsEqual,
  type AlisioThemeAccents,
  type AlisioThemeFamily,
  type AlisioThemeMode,
} from "../../../src/shared/alisio-appearance.js";

export type ThemeFamily = AlisioThemeFamily;
export type ThemeMode = AlisioThemeMode;
export type ThemeAccents = AlisioThemeAccents;
export type ThemeResolvedMode = "dark" | "light";
export type ResolvedTheme =
  | "mood-dark"
  | "mood-light"
  | "noir-dark"
  | "noir-light"
  | "matte-dark"
  | "matte-light";

type Rgb = { r: number; g: number; b: number };
type ThemeAccentTuning = {
  hoverTarget: "#000000" | "#FFFFFF";
  hoverMix: number;
  subtleAlpha: number;
  glowAlpha: number;
  focusAlpha: number;
  darkForeground: string;
};

export const VALID_THEME_FAMILIES = new Set<ThemeFamily>(ALISIO_THEME_FAMILIES);
export const VALID_THEME_MODES = new Set<ThemeMode>(ALISIO_THEME_MODES);
export const DEFAULT_THEME_SELECTION = {
  themeFamily: DEFAULT_THEME_FAMILY,
  themeMode: DEFAULT_THEME_MODE,
  themeAccents: DEFAULT_THEME_ACCENTS,
} as const;

export const THEME_PREVIEW_TONES: Record<
  ThemeFamily,
  { bg: string; rail: string; panel: string; accent: string; border: string }
> = {
  mood: {
    bg: "#171717",
    rail: "#121212",
    panel: "#1C1C1C",
    accent: DEFAULT_THEME_ACCENTS.mood,
    border: "#343434",
  },
  noir: {
    bg: "#080808",
    rail: "#111113",
    panel: "#141416",
    accent: DEFAULT_THEME_ACCENTS.noir,
    border: "#2A2A30",
  },
  matte: {
    bg: "#181312",
    rail: "#120D0C",
    panel: "#231918",
    accent: DEFAULT_THEME_ACCENTS.matte,
    border: "#4A3429",
  },
};

const DARK_BG_REFERENCE = "#171717";
const LIGHT_BG_REFERENCE = "#F4F5F6";

const THEME_ACCENT_TUNING: Record<ThemeFamily, Record<ThemeResolvedMode, ThemeAccentTuning>> = {
  mood: {
    dark: {
      hoverTarget: "#FFFFFF",
      hoverMix: 0.12,
      subtleAlpha: 0.09,
      glowAlpha: 0.16,
      focusAlpha: 0.18,
      darkForeground: "#14110D",
    },
    light: {
      hoverTarget: "#FFFFFF",
      hoverMix: 0.1,
      subtleAlpha: 0.08,
      glowAlpha: 0.12,
      focusAlpha: 0.15,
      darkForeground: "#14110D",
    },
  },
  noir: {
    dark: {
      hoverTarget: "#FFFFFF",
      hoverMix: 0.12,
      subtleAlpha: 0.14,
      glowAlpha: 0.26,
      focusAlpha: 0.22,
      darkForeground: "#14110D",
    },
    light: {
      hoverTarget: "#000000",
      hoverMix: 0.16,
      subtleAlpha: 0.08,
      glowAlpha: 0.12,
      focusAlpha: 0.16,
      darkForeground: "#14110D",
    },
  },
  matte: {
    dark: {
      hoverTarget: "#FFFFFF",
      hoverMix: 0.12,
      subtleAlpha: 0.16,
      glowAlpha: 0.24,
      focusAlpha: 0.2,
      darkForeground: "#1A1210",
    },
    light: {
      hoverTarget: "#000000",
      hoverMix: 0.16,
      subtleAlpha: 0.12,
      glowAlpha: 0.16,
      focusAlpha: 0.16,
      darkForeground: "#1A1210",
    },
  },
};

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex, "#000000") ?? "#000000";
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => clampChannel(value).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${clampChannel(rgb.r)}, ${clampChannel(rgb.g)}, ${clampChannel(rgb.b)}, ${alpha.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")})`;
}

function mixRgb(base: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: base.r + (target.r - base.r) * amount,
    g: base.g + (target.g - base.g) * amount,
    b: base.b + (target.b - base.b) * amount,
  };
}

function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].toSorted((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureAccentContrast(accentHex: string, mode: ThemeResolvedMode): string {
  const accent = hexToRgb(accentHex);
  const background = hexToRgb(mode === "dark" ? DARK_BG_REFERENCE : LIGHT_BG_REFERENCE);
  if (contrastRatio(accent, background) >= 4.5) {
    return rgbToHex(accent);
  }

  const target = hexToRgb(mode === "dark" ? "#FFFFFF" : "#111111");
  let low = 0;
  let high = 1;
  let best = target;

  for (let index = 0; index < 20; index += 1) {
    const mid = (low + high) / 2;
    const candidate = mixRgb(accent, target, mid);
    if (contrastRatio(candidate, background) >= 4.5) {
      best = candidate;
      high = mid;
    } else {
      low = mid;
    }
  }

  return rgbToHex(best);
}

function resolveAccentForeground(accentHex: string, darkForeground: string): string {
  const accent = hexToRgb(accentHex);
  const dark = hexToRgb(darkForeground);
  const light = hexToRgb("#FFFFFF");
  return contrastRatio(accent, dark) >= contrastRatio(accent, light) ? rgbToHex(dark) : "#FFFFFF";
}

export function prefersLightScheme(): boolean {
  if (typeof globalThis.matchMedia !== "function") {
    return false;
  }
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches;
}

export function resolveSystemTheme(): ThemeResolvedMode {
  return prefersLightScheme() ? "light" : "dark";
}

export function resolveThemeMode(mode: ThemeMode): ThemeResolvedMode {
  if (mode === "system") {
    return resolveSystemTheme();
  }
  return mode;
}

export function resolveThemeFamilyFromResolved(resolved: ResolvedTheme): ThemeFamily {
  return resolved.split("-")[0] as ThemeFamily;
}

export function resolveThemeModeFromResolved(resolved: ResolvedTheme): ThemeResolvedMode {
  return resolved.endsWith("-light") ? "light" : "dark";
}

export function resolveTheme(themeFamily: ThemeFamily, mode: ThemeMode): ResolvedTheme {
  return `${themeFamily}-${resolveThemeMode(mode)}` as ResolvedTheme;
}

export function parseThemeSelection(
  themeFamilyRaw: unknown,
  modeRaw: unknown,
  themeAccentsRaw?: unknown,
): {
  themeFamily: ThemeFamily;
  themeMode: ThemeMode;
  themeAccents: ThemeAccents;
} {
  return normalizeThemeSelection({
    themeFamily: themeFamilyRaw,
    themeMode: modeRaw,
    themeAccents: themeAccentsRaw,
    legacyTheme: themeFamilyRaw,
  });
}

export function getThemeAccent(themeAccents: ThemeAccents, themeFamily: ThemeFamily): string {
  return themeAccents[themeFamily] ?? DEFAULT_THEME_ACCENTS[themeFamily];
}

export function setThemeAccent(
  themeAccents: ThemeAccents,
  themeFamily: ThemeFamily,
  accent: string,
): ThemeAccents {
  const normalized = normalizeHexColor(accent, getThemeAccent(themeAccents, themeFamily));
  return {
    ...themeAccents,
    [themeFamily]: normalized ?? getThemeAccent(themeAccents, themeFamily),
  };
}

export function normalizeThemeAccentMap(themeAccents: unknown): ThemeAccents {
  return normalizeThemeAccents(themeAccents);
}

export function themeAccentMapsEqual(a: ThemeAccents, b: ThemeAccents): boolean {
  return themeAccentsEqual(a, b);
}

export function buildResolvedThemeAccentVariables(params: {
  resolvedTheme: ResolvedTheme;
  themeAccents: ThemeAccents;
}): Record<string, string> {
  const themeFamily = resolveThemeFamilyFromResolved(params.resolvedTheme);
  const resolvedMode = resolveThemeModeFromResolved(params.resolvedTheme);
  const tuning = THEME_ACCENT_TUNING[themeFamily][resolvedMode];
  const baseAccent = getThemeAccent(params.themeAccents, themeFamily);
  const accessibleAccent = ensureAccentContrast(baseAccent, resolvedMode);
  const accentRgb = hexToRgb(accessibleAccent);
  const hoverRgb = mixRgb(accentRgb, hexToRgb(tuning.hoverTarget), tuning.hoverMix);
  const accentForeground = resolveAccentForeground(accessibleAccent, tuning.darkForeground);

  return {
    "--accent": accessibleAccent,
    "--accent-hover": rgbToHex(hoverRgb),
    "--accent-muted": accessibleAccent,
    "--accent-subtle": rgba(accentRgb, tuning.subtleAlpha),
    "--accent-foreground": accentForeground,
    "--accent-glow": rgba(accentRgb, tuning.glowAlpha),
    "--primary": accessibleAccent,
    "--primary-foreground": accentForeground,
    "--ring": accessibleAccent,
    "--focus": rgba(accentRgb, tuning.focusAlpha),
  };
}
