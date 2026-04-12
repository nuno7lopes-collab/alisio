import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_PLUGIN_ROOT_DIR, bundledPluginRoot } from "./scripts/lib/bundled-plugin-paths.mjs";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

function listBundledChannelTestRoots() {
  const bundledPluginsDir = path.join(repoRoot, BUNDLED_PLUGIN_ROOT_DIR);
  if (!fs.existsSync(bundledPluginsDir)) {
    return [];
  }

  return fs
    .readdirSync(bundledPluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const packageJsonPath = path.join(bundledPluginsDir, entry.name, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        return [];
      }

      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        return pkg.alisio?.channel?.id ? [bundledPluginRoot(entry.name)] : [];
      } catch {
        return [];
      }
    })
    .toSorted((left, right) => left.localeCompare(right));
}

export const bundledChannelTestRoots = listBundledChannelTestRoots();

export const channelTestRoots = [...bundledChannelTestRoots, "src/browser", "src/line"];

export const channelTestPrefixes = channelTestRoots.map((root) => `${root}/`);
export const channelTestInclude = channelTestRoots.map((root) => `${root}/**/*.test.ts`);
export const channelTestExclude = channelTestRoots.map((root) => `${root}/**`);
