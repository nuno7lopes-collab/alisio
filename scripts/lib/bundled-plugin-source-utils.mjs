import fs from "node:fs";
import path from "node:path";
import { currentPluginManifestName } from "./alisio-branding.mjs";

export function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function collectBundledPluginSources(params = {}) {
  const repoRoot = path.resolve(params.repoRoot ?? process.cwd());
  const extensionsRoot = path.join(repoRoot, "extensions");
  const pluginManifestName = currentPluginManifestName(repoRoot);
  if (!fs.existsSync(extensionsRoot)) {
    return [];
  }

  const requirePackageJson = params.requirePackageJson === true;
  const entries = [];
  for (const dirent of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const pluginDir = path.join(extensionsRoot, dirent.name);
    const manifestPath = path.join(pluginDir, pluginManifestName);
    const packageJsonPath = path.join(pluginDir, "package.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    if (requirePackageJson && !fs.existsSync(packageJsonPath)) {
      continue;
    }

    entries.push({
      dirName: dirent.name,
      pluginDir,
      manifestPath,
      manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
      ...(fs.existsSync(packageJsonPath)
        ? {
            packageJsonPath,
            packageJson: JSON.parse(fs.readFileSync(packageJsonPath, "utf8")),
          }
        : {}),
    });
  }

  return entries.toSorted((left, right) => left.dirName.localeCompare(right.dirName));
}
