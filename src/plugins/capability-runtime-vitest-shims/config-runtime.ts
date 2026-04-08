import { resolveActiveTalkProviderConfig } from "../../config/talk.js";
import type { AlisioConfig } from "../../config/types.js";

export { resolveActiveTalkProviderConfig };

export function getRuntimeConfigSnapshot(): AlisioConfig | null {
  return null;
}
