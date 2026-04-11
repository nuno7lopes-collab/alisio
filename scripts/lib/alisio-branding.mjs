import fs from "node:fs";
import path from "node:path";

export const APP_NAME = "Alisio";
export const APP_SLUG = "alisio";
export const LEGACY_SLUG = APP_SLUG;
export const LEGACY_TITLE = APP_NAME;
export const LEGACY_ENV_PREFIX = "ALISIO";
export const LEGACY_SCOPE = `@${APP_SLUG}`;
export const LEGACY_PLUGIN_MANIFEST = `${APP_SLUG}.plugin.json`;
export const LEGACY_ENTRYPOINT = `${APP_SLUG}.mjs`;
export const LEGACY_CONFIG_FILE = `${APP_SLUG}.json`;
export const LEGACY_PLUGIN_SDK_ROOT = `${APP_SLUG}/plugin-sdk`;
export const LEGACY_REPO_NWO = `${APP_SLUG}/${APP_SLUG}`;
export const LEGACY_REPO_URL = `https://github.com/${LEGACY_REPO_NWO}`;

export function legacyEnvName(suffix) {
  return `${LEGACY_ENV_PREFIX}_${suffix}`;
}

export function legacyScopedPackage(suffix) {
  return `${LEGACY_SCOPE}/${suffix}`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveRepoRoot(repoRoot = process.cwd()) {
  return path.resolve(repoRoot);
}

function collectExtensionPackageNames(repoRoot = process.cwd()) {
  const extensionsRoot = path.join(resolveRepoRoot(repoRoot), "extensions");
  if (!fs.existsSync(extensionsRoot)) {
    return [];
  }

  return fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .flatMap((dirent) => {
      const packageJson = readJsonIfExists(path.join(extensionsRoot, dirent.name, "package.json"));
      return typeof packageJson?.name === "string" && packageJson.name.trim().length > 0
        ? [packageJson.name.trim()]
        : [];
    });
}

export function hostPackageName(repoRoot = process.cwd()) {
  const packageJson = readJsonIfExists(path.join(resolveRepoRoot(repoRoot), "package.json"));
  return typeof packageJson?.name === "string" && packageJson.name.trim().length > 0
    ? packageJson.name.trim()
    : APP_SLUG;
}

export function hostPackageNames(repoRoot = process.cwd()) {
  return [...new Set([hostPackageName(repoRoot), APP_SLUG])];
}

export function currentExtensionScope(repoRoot = process.cwd()) {
  const counts = new Map();
  for (const packageName of collectExtensionPackageNames(repoRoot)) {
    const match = packageName.match(/^(@[^/]+)\/[^/]+$/u);
    if (!match) {
      continue;
    }
    const scope = match[1];
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }

  let resolved = `@${APP_SLUG}`;
  let bestCount = -1;
  for (const [scope, count] of counts) {
    if (count > bestCount) {
      resolved = scope;
      bestCount = count;
    }
  }
  return resolved;
}

export function currentPackageBrandKey(repoRoot = process.cwd()) {
  const extensionsRoot = path.join(resolveRepoRoot(repoRoot), "extensions");
  if (!fs.existsSync(extensionsRoot)) {
    return APP_SLUG;
  }

  for (const dirent of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const packageJson = readJsonIfExists(path.join(extensionsRoot, dirent.name, "package.json"));
    if (!isRecord(packageJson)) {
      continue;
    }
    for (const key of [APP_SLUG]) {
      if (isRecord(packageJson[key])) {
        return key;
      }
    }
  }
  return APP_SLUG;
}

export function currentPluginManifestName(repoRoot = process.cwd()) {
  const extensionsRoot = path.join(resolveRepoRoot(repoRoot), "extensions");
  if (!fs.existsSync(extensionsRoot)) {
    return `${APP_SLUG}.plugin.json`;
  }

  const counts = new Map();
  for (const dirent of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const pluginDir = path.join(extensionsRoot, dirent.name);
    const manifestName = fs
      .readdirSync(pluginDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".plugin.json"))
      .map((entry) => entry.name)[0];
    if (!manifestName) {
      continue;
    }
    counts.set(manifestName, (counts.get(manifestName) ?? 0) + 1);
  }

  let resolved = `${APP_SLUG}.plugin.json`;
  let bestCount = -1;
  for (const [manifestName, count] of counts) {
    if (count > bestCount) {
      resolved = manifestName;
      bestCount = count;
    }
  }
  return resolved;
}

export function readPackageBrandConfig(packageJson) {
  if (!isRecord(packageJson)) {
    return null;
  }
  for (const key of packageBrandConfigKeys(packageJson)) {
    if (isRecord(packageJson[key])) {
      return packageJson[key];
    }
  }
  return null;
}

export function packageBrandConfigKeys(packageJson) {
  if (!isRecord(packageJson)) {
    return [APP_SLUG];
  }
  const keys = [APP_SLUG].filter((key) => isRecord(packageJson[key]));
  return keys.length > 0 ? keys : [APP_SLUG];
}

export function packageBrandConfigKey(packageJson) {
  return packageBrandConfigKeys(packageJson)[0];
}

export function writePackageBrandConfig(packageJson, nextValue) {
  if (!isRecord(packageJson) || !isRecord(nextValue)) {
    return packageJson;
  }

  const nextPackageJson = { ...packageJson };
  let wrote = false;
  for (const key of packageBrandConfigKeys(packageJson)) {
    if (isRecord(packageJson[key])) {
      nextPackageJson[key] = nextValue;
      wrote = true;
    }
  }
  if (!wrote) {
    nextPackageJson[APP_SLUG] = nextValue;
  }
  return nextPackageJson;
}
