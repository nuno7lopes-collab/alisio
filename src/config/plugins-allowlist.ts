import type { AlisioConfig } from "./config.js";

export function ensurePluginAllowlisted(cfg: AlisioConfig, pluginId: string): AlisioConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}
