export type TranslationMap = { [key: string]: string | TranslationMap };

export type Locale = "en" | "pt-PT" | "pt-BR" | "es" | "de" | "zh-CN" | "zh-TW";

export interface I18nConfig {
  locale: Locale;
  fallbackLocale: Locale;
  translations: Record<Locale, TranslationMap>;
}
