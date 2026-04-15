import { getSafeLocalStorage } from "../../local-storage.ts";
import { en } from "../locales/en.ts";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  loadLazyLocaleTranslation,
  resolveNavigatorLocale,
} from "./registry.ts";
import type { Locale, TranslationMap } from "./types.ts";

type Subscriber = (locale: Locale) => void;

export { SUPPORTED_LOCALES, isSupportedLocale };

const LOCALE_STORAGE_KEY = "alisio.i18n.locale";

function readStoredLocaleValue(): string | null {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function loadPersistedLocale(): Locale | null {
  const locale = readStoredLocaleValue();
  return isSupportedLocale(locale) ? locale : null;
}

export function resolvePreferredLocale(): Locale {
  const saved = readStoredLocaleValue();
  if (isSupportedLocale(saved)) {
    return saved;
  }
  const language =
    typeof globalThis.navigator?.language === "string" ? globalThis.navigator.language : "";
  return resolveNavigatorLocale(language);
}

class I18nManager {
  private locale: Locale = DEFAULT_LOCALE;
  private translations: Partial<Record<Locale, TranslationMap>> = { [DEFAULT_LOCALE]: en };
  private subscribers: Set<Subscriber> = new Set();
  private localeRequestVersion = 0;

  constructor() {
    this.loadLocale();
  }

  private persistLocale(locale: Locale) {
    const storage = getSafeLocalStorage();
    if (!storage) {
      return;
    }
    try {
      storage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage write failures in private/blocked contexts.
    }
  }

  private syncDocumentLocale(locale: Locale) {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.lang = locale;
  }

  private resolveInitialLocale(): Locale {
    return resolvePreferredLocale();
  }

  private loadLocale() {
    const initialLocale = this.resolveInitialLocale();
    if (initialLocale === DEFAULT_LOCALE) {
      this.locale = DEFAULT_LOCALE;
      this.syncDocumentLocale(DEFAULT_LOCALE);
      return;
    }
    // Use the normal locale setter so startup locale loading follows the same
    // translation-loading + notify path as manual locale changes.
    void this.setLocale(initialLocale);
  }

  public getLocale(): Locale {
    return this.locale;
  }

  public async setLocale(locale: Locale) {
    const needsTranslationLoad = locale !== DEFAULT_LOCALE && !this.translations[locale];
    const requestVersion = ++this.localeRequestVersion;
    if (this.locale === locale && !needsTranslationLoad) {
      this.syncDocumentLocale(locale);
      this.persistLocale(locale);
      this.notify();
      return;
    }

    if (needsTranslationLoad) {
      try {
        const translation = await loadLazyLocaleTranslation(locale);
        if (!translation) {
          return;
        }
        this.translations[locale] = translation;
        if (requestVersion !== this.localeRequestVersion) {
          return;
        }
      } catch (e) {
        console.error(`Failed to load locale: ${locale}`, e);
        return;
      }
    }

    if (requestVersion !== this.localeRequestVersion) {
      return;
    }

    this.locale = locale;
    this.syncDocumentLocale(locale);
    this.persistLocale(locale);
    this.notify();
  }

  public registerTranslation(locale: Locale, map: TranslationMap) {
    this.translations[locale] = map;
  }

  public subscribe(sub: Subscriber) {
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }

  private notify() {
    this.subscribers.forEach((sub) => sub(this.locale));
  }

  public t(key: string, params?: Record<string, string>): string {
    const keys = key.split(".");
    let value: unknown = this.translations[this.locale] || this.translations[DEFAULT_LOCALE];

    for (const k of keys) {
      if (value && typeof value === "object") {
        value = (value as Record<string, unknown>)[k];
      } else {
        value = undefined;
        break;
      }
    }

    // Fallback to English.
    if (value === undefined && this.locale !== DEFAULT_LOCALE) {
      value = this.translations[DEFAULT_LOCALE];
      for (const k of keys) {
        if (value && typeof value === "object") {
          value = (value as Record<string, unknown>)[k];
        } else {
          value = undefined;
          break;
        }
      }
    }

    if (typeof value !== "string") {
      return key;
    }

    if (params) {
      return value.replace(/\{(\w+)\}/g, (_, k) => params[k] || `{${k}}`);
    }

    return value;
  }
}

export const i18n = new I18nManager();
export const t = (key: string, params?: Record<string, string>) => i18n.t(key, params);
