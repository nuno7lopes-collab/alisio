type EnvMap = Record<string, string | undefined>;

const readEnvWithLegacyFallback = (
  env: EnvMap,
  canonicalKey: string,
  legacyKey: string,
): string | undefined => env[canonicalKey] ?? env[legacyKey];

const isEnabled = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

const isDisabled = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "0" || normalized === "false";
};

const isWindowsEnv = (env: EnvMap, platform: NodeJS.Platform): boolean => {
  if (platform === "win32") {
    return true;
  }
  const runnerOs = env.RUNNER_OS?.trim().toLowerCase();
  return runnerOs === "windows";
};

type VitestExperimentalConfig = {
  experimental?: {
    fsModuleCache?: true;
    fsModuleCachePath?: string;
    importDurations?: { print: true };
    printImportBreakdown?: true;
  };
};

export function loadVitestExperimentalConfig(
  env: EnvMap = process.env,
  platform: NodeJS.Platform = process.platform,
): VitestExperimentalConfig {
  const experimental: {
    fsModuleCache?: true;
    fsModuleCachePath?: string;
    importDurations?: { print: true };
    printImportBreakdown?: true;
  } = {};
  const windowsEnv = isWindowsEnv(env, platform);
  const fsModuleCache = readEnvWithLegacyFallback(
    env,
    "ALISIO_VITEST_FS_MODULE_CACHE",
    "OPENCLAW_VITEST_FS_MODULE_CACHE",
  );
  const fsModuleCachePath = readEnvWithLegacyFallback(
    env,
    "ALISIO_VITEST_FS_MODULE_CACHE_PATH",
    "OPENCLAW_VITEST_FS_MODULE_CACHE_PATH",
  );
  const importDurations = readEnvWithLegacyFallback(
    env,
    "ALISIO_VITEST_IMPORT_DURATIONS",
    "OPENCLAW_VITEST_IMPORT_DURATIONS",
  );
  const printImportBreakdown = readEnvWithLegacyFallback(
    env,
    "ALISIO_VITEST_PRINT_IMPORT_BREAKDOWN",
    "OPENCLAW_VITEST_PRINT_IMPORT_BREAKDOWN",
  );

  if (!windowsEnv && !isDisabled(fsModuleCache)) {
    experimental.fsModuleCache = true;
  }
  if (windowsEnv && isEnabled(fsModuleCache)) {
    experimental.fsModuleCache = true;
  }
  if (experimental.fsModuleCache && fsModuleCachePath?.trim()) {
    experimental.fsModuleCachePath = fsModuleCachePath.trim();
  }
  if (isEnabled(importDurations)) {
    experimental.importDurations = { print: true };
  }
  if (isEnabled(printImportBreakdown)) {
    experimental.printImportBreakdown = true;
  }

  return Object.keys(experimental).length > 0 ? { experimental } : {};
}
