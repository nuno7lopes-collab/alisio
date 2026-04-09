import { createSubsystemLogger } from "../logging/subsystem.js";

export const ALISIO_LEGACY_COMPATIBILITY_SUNSET_DATE = "2026-06-30";

const compatLog = createSubsystemLogger("compat");
const warnedCompatibilityKeys = new Set<string>();

export function warnLegacyCompatibilityOnce(params: {
  key: string;
  message: string;
  replacement?: string;
  sunset?: string;
}): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  if (warnedCompatibilityKeys.has(params.key)) {
    return;
  }
  warnedCompatibilityKeys.add(params.key);
  const replacement = params.replacement?.trim();
  const sunset = params.sunset?.trim() || ALISIO_LEGACY_COMPATIBILITY_SUNSET_DATE;
  compatLog.warn(
    `${params.message.trim()}${replacement ? ` Use ${replacement} instead.` : ""} Sunset target: ${sunset}.`,
  );
}
