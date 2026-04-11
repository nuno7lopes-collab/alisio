import fs from "node:fs";
import path from "node:path";
import { currentPluginManifestName, readPackageBrandConfig } from "./alisio-branding.mjs";
import {
  BUNDLED_PLUGIN_ROOT_DIR,
  bundledDistPluginFile,
  bundledPluginFile,
} from "./bundled-plugin-paths.mjs";
import { shouldBuildBundledCluster } from "./optional-bundled-clusters.mjs";

const TOP_LEVEL_PUBLIC_SURFACE_EXTENSIONS = new Set([".ts", ".js", ".mts", ".cts", ".mjs", ".cjs"]);
const CAPABILITY_ONLY_PUBLIC_SURFACE_BASENAMES = new Set([
  "api",
  "channel-config-api",
  "provider-catalog",
  "runtime-api",
  "session-key-api",
]);

function readBundledPluginPackageJson(packageJsonPath) {
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return null;
  }
}

function collectPluginSourceEntries(packageJson) {
  const brandConfig = readPackageBrandConfig(packageJson);
  let packageEntries = Array.isArray(brandConfig?.extensions)
    ? brandConfig.extensions.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const setupEntry =
    typeof brandConfig?.setupEntry === "string" && brandConfig.setupEntry.trim().length > 0
      ? brandConfig.setupEntry
      : undefined;
  if (setupEntry) {
    packageEntries = Array.from(new Set([...packageEntries, setupEntry]));
  }
  return packageEntries.length > 0 ? packageEntries : ["./index.ts"];
}

function collectTopLevelPublicSurfaceEntries(pluginDir) {
  if (!fs.existsSync(pluginDir)) {
    return [];
  }

  return fs
    .readdirSync(pluginDir, { withFileTypes: true })
    .flatMap((dirent) => {
      if (!dirent.isFile()) {
        return [];
      }

      const ext = path.extname(dirent.name);
      if (!TOP_LEVEL_PUBLIC_SURFACE_EXTENSIONS.has(ext)) {
        return [];
      }

      const normalizedName = dirent.name.toLowerCase();
      if (
        normalizedName.endsWith(".d.ts") ||
        normalizedName.includes(".test.") ||
        normalizedName.includes(".spec.") ||
        normalizedName.includes(".fixture.") ||
        normalizedName.includes(".snap")
      ) {
        return [];
      }

      return [`./${dirent.name}`];
    })
    .toSorted((left, right) => left.localeCompare(right));
}

function collectCapabilityOnlyPublicSurfaceEntries(pluginDir) {
  return collectTopLevelPublicSurfaceEntries(pluginDir).filter((entry) =>
    CAPABILITY_ONLY_PUBLIC_SURFACE_BASENAMES.has(path.basename(entry, path.extname(entry))),
  );
}

export function collectBundledPluginBuildEntries(params = {}) {
  const cwd = params.cwd ?? process.cwd();
  const env = params.env ?? process.env;
  const extensionsRoot = path.join(cwd, BUNDLED_PLUGIN_ROOT_DIR);
  const pluginManifestName = currentPluginManifestName(cwd);
  const entries = [];

  for (const dirent of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const pluginDir = path.join(extensionsRoot, dirent.name);
    const manifestPath = path.join(pluginDir, pluginManifestName);
    const packageJsonPath = path.join(pluginDir, "package.json");
    const packageJson = readBundledPluginPackageJson(packageJsonPath);
    if (!shouldBuildBundledCluster(dirent.name, env, { packageJson })) {
      continue;
    }

    if (!fs.existsSync(manifestPath)) {
      const capabilitySourceEntries = collectCapabilityOnlyPublicSurfaceEntries(pluginDir);
      if (capabilitySourceEntries.length === 0) {
        continue;
      }
      entries.push({
        id: dirent.name,
        hasPackageJson: packageJson !== null,
        packageJson,
        sourceEntries: capabilitySourceEntries,
      });
      continue;
    }

    entries.push({
      id: dirent.name,
      hasPackageJson: packageJson !== null,
      packageJson,
      sourceEntries: Array.from(
        new Set([
          ...collectPluginSourceEntries(packageJson),
          ...collectTopLevelPublicSurfaceEntries(pluginDir),
        ]),
      ),
    });
  }

  return entries;
}

export function listBundledPluginBuildEntries(params = {}) {
  return Object.fromEntries(
    collectBundledPluginBuildEntries(params).flatMap(({ id, sourceEntries }) =>
      sourceEntries.map((entry) => {
        const normalizedEntry = entry.replace(/^\.\//, "");
        const entryKey = bundledPluginFile(id, normalizedEntry.replace(/\.[^.]+$/u, ""));
        return [entryKey, path.join(BUNDLED_PLUGIN_ROOT_DIR, id, normalizedEntry)];
      }),
    ),
  );
}

export function listBundledPluginPackArtifacts(params = {}) {
  const entries = collectBundledPluginBuildEntries(params);
  const pluginManifestName = currentPluginManifestName(params.cwd ?? process.cwd());
  const artifacts = new Set();

  for (const { id, hasPackageJson, sourceEntries } of entries) {
    artifacts.add(bundledDistPluginFile(id, pluginManifestName));
    if (hasPackageJson) {
      artifacts.add(bundledDistPluginFile(id, "package.json"));
    }
    for (const entry of sourceEntries) {
      const normalizedEntry = entry.replace(/^\.\//, "").replace(/\.[^.]+$/u, "");
      artifacts.add(bundledDistPluginFile(id, `${normalizedEntry}.js`));
    }
  }

  return [...artifacts].toSorted((left, right) => left.localeCompare(right));
}
