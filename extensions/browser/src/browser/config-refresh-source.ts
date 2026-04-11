import { createConfigIO, getRuntimeConfigSnapshot, type AlisioConfig } from "../config/config.js";

export function loadBrowserConfigForRuntimeRefresh(): AlisioConfig {
  return getRuntimeConfigSnapshot() ?? createConfigIO().loadConfig();
}
