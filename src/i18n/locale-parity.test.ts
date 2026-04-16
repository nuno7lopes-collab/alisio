import { describe, expect, it } from "vitest";
import { de } from "../../ui/src/i18n/locales/de.ts";
import { en } from "../../ui/src/i18n/locales/en.ts";
import { es } from "../../ui/src/i18n/locales/es.ts";
import { pt_BR } from "../../ui/src/i18n/locales/pt-BR.ts";
import { pt_PT } from "../../ui/src/i18n/locales/pt-PT.ts";
import { zh_CN } from "../../ui/src/i18n/locales/zh-CN.ts";
import { zh_TW } from "../../ui/src/i18n/locales/zh-TW.ts";
import type { TranslationMap } from "../../ui/src/i18n/lib/types.ts";

function flattenTranslations(map: TranslationMap, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.push(next);
      continue;
    }
    out.push(...flattenTranslations(value, next));
  }
  return out;
}

describe("ui locale parity", () => {
  const baseKeys = flattenTranslations(en).toSorted((left, right) => left.localeCompare(right));
  const locales = {
    "pt-PT": pt_PT,
    "pt-BR": pt_BR,
    es,
    de,
    "zh-CN": zh_CN,
    "zh-TW": zh_TW,
  } satisfies Record<string, TranslationMap>;

  for (const [locale, map] of Object.entries(locales)) {
    it(`${locale} matches the English key set`, () => {
      const keys = flattenTranslations(map).toSorted((left, right) => left.localeCompare(right));
      expect(keys).toEqual(baseKeys);
    });
  }
});
