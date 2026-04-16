import type { TranslationMap } from "./types.ts";

function isTranslationMap(value: unknown): value is TranslationMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeTranslationMaps(base: TranslationMap, overrides: TranslationMap): TranslationMap {
  const out: TranslationMap = { ...base };

  for (const [key, value] of Object.entries(overrides)) {
    const current = out[key];
    if (isTranslationMap(current) && isTranslationMap(value)) {
      out[key] = mergeTranslationMaps(current, value);
      continue;
    }
    out[key] = value;
  }

  return out;
}
