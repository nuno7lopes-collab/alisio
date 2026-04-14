import { resolveNavigatorLocale } from "../i18n/lib/registry.ts";
import {
  DEFAULT_THEME_SELECTION,
  themeAccentMapsEqual,
  type ThemeAccents,
  type ThemeFamily,
  type ThemeMode,
} from "./theme.ts";

export const PUBLIC_PRESENTATION_LOCALES = ["en", "pt-PT", "es"] as const;

export type PublicPresentationLocale = (typeof PUBLIC_PRESENTATION_LOCALES)[number];

export type PresentationSelection = {
  locale?: string;
  themeFamily: ThemeFamily;
  themeMode: ThemeMode;
  themeAccents: ThemeAccents;
};

export function isPublicPresentationLocale(
  value: string | undefined,
): value is PublicPresentationLocale {
  return value === "en" || value === "pt-PT" || value === "es";
}

export function resolveDefaultPresentationLocale(): PublicPresentationLocale {
  const preferred = resolveNavigatorLocale(globalThis.navigator?.language ?? "");
  return isPublicPresentationLocale(preferred) ? preferred : "en";
}

export function resolveDefaultPresentationSelection(): PresentationSelection & {
  locale: PublicPresentationLocale;
} {
  return {
    locale: resolveDefaultPresentationLocale(),
    themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
    themeMode: DEFAULT_THEME_SELECTION.themeMode,
    themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
  };
}

export function presentationSelectionsEqual(
  local: PresentationSelection,
  remote: PresentationSelection,
): boolean {
  const languageMatches = isPublicPresentationLocale(local.locale)
    ? local.locale === remote.locale
    : true;
  return (
    languageMatches &&
    local.themeFamily === remote.themeFamily &&
    local.themeMode === remote.themeMode &&
    themeAccentMapsEqual(local.themeAccents, remote.themeAccents)
  );
}
