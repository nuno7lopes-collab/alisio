import type { AlisioConfig } from "alisio/plugin-sdk/browser-support";
import {
  normalizePluginsConfig,
  resolveEffectiveEnableState,
} from "alisio/plugin-sdk/browser-support";

export function isDefaultBrowserPluginEnabled(cfg: AlisioConfig): boolean {
  return resolveEffectiveEnableState({
    id: "browser",
    origin: "bundled",
    config: normalizePluginsConfig(cfg.plugins),
    rootConfig: cfg,
    enabledByDefault: true,
  }).enabled;
}
