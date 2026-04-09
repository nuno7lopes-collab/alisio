export const DEFAULT_PLUGIN_DISCOVERY_CACHE_MS = 1000;
export const DEFAULT_PLUGIN_MANIFEST_CACHE_MS = 1000;

function readPluginCacheEnv(env: NodeJS.ProcessEnv, suffix: string): string | undefined {
  return env[`ALISIO_${suffix}`] ?? env[`OPENCLAW_${suffix}`];
}

export function shouldUsePluginSnapshotCache(env: NodeJS.ProcessEnv): boolean {
  if (readPluginCacheEnv(env, "DISABLE_PLUGIN_DISCOVERY_CACHE")?.trim()) {
    return false;
  }
  if (readPluginCacheEnv(env, "DISABLE_PLUGIN_MANIFEST_CACHE")?.trim()) {
    return false;
  }
  const discoveryCacheMs = readPluginCacheEnv(env, "PLUGIN_DISCOVERY_CACHE_MS")?.trim();
  if (discoveryCacheMs === "0") {
    return false;
  }
  const manifestCacheMs = readPluginCacheEnv(env, "PLUGIN_MANIFEST_CACHE_MS")?.trim();
  if (manifestCacheMs === "0") {
    return false;
  }
  return true;
}

export function resolvePluginCacheMs(rawValue: string | undefined, defaultMs: number): number {
  const raw = rawValue?.trim();
  if (raw === "" || raw === "0") {
    return 0;
  }
  if (!raw) {
    return defaultMs;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return defaultMs;
  }
  return Math.max(0, parsed);
}

export function resolvePluginSnapshotCacheTtlMs(env: NodeJS.ProcessEnv): number {
  const discoveryCacheMs = resolvePluginCacheMs(
    readPluginCacheEnv(env, "PLUGIN_DISCOVERY_CACHE_MS"),
    DEFAULT_PLUGIN_DISCOVERY_CACHE_MS,
  );
  const manifestCacheMs = resolvePluginCacheMs(
    readPluginCacheEnv(env, "PLUGIN_MANIFEST_CACHE_MS"),
    DEFAULT_PLUGIN_MANIFEST_CACHE_MS,
  );
  return Math.min(discoveryCacheMs, manifestCacheMs);
}

export function buildPluginSnapshotCacheEnvKey(env: NodeJS.ProcessEnv) {
  return {
    bundledPluginsDir: readPluginCacheEnv(env, "BUNDLED_PLUGINS_DIR") ?? "",
    disablePluginDiscoveryCache: readPluginCacheEnv(env, "DISABLE_PLUGIN_DISCOVERY_CACHE") ?? "",
    disablePluginManifestCache: readPluginCacheEnv(env, "DISABLE_PLUGIN_MANIFEST_CACHE") ?? "",
    pluginDiscoveryCacheMs: readPluginCacheEnv(env, "PLUGIN_DISCOVERY_CACHE_MS") ?? "",
    pluginManifestCacheMs: readPluginCacheEnv(env, "PLUGIN_MANIFEST_CACHE_MS") ?? "",
    home: readPluginCacheEnv(env, "HOME") ?? "",
    stateDir: readPluginCacheEnv(env, "STATE_DIR") ?? "",
    configPath: readPluginCacheEnv(env, "CONFIG_PATH") ?? "",
    HOME: env.HOME ?? "",
    USERPROFILE: env.USERPROFILE ?? "",
    VITEST: env.VITEST ?? "",
  };
}
