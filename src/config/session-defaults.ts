import type { DmScope } from "./types.base.js";

export const DEFAULT_DM_SCOPE: DmScope = "per-channel-peer";

const DM_SCOPE_VALUES = [
  "main",
  "per-peer",
  "per-channel-peer",
  "per-account-channel-peer",
] as const satisfies readonly DmScope[];

function isDmScope(value: string | null | undefined): value is DmScope {
  return typeof value === "string" && DM_SCOPE_VALUES.some((candidate) => candidate === value);
}

export function resolveDmScope(dmScope?: string | null): DmScope {
  return isDmScope(dmScope) ? dmScope : DEFAULT_DM_SCOPE;
}
