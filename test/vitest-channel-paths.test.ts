import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundledChannelTestRoots, channelTestRoots } from "../vitest.channel-paths.mjs";
import { createExtensionsVitestConfig } from "../vitest.extensions.config.ts";
import { bundledPluginRoot } from "./helpers/bundled-plugin-paths.js";

function listExpectedBundledChannelRoots() {
  return fs
    .readdirSync(path.join(process.cwd(), "extensions"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const packageJsonPath = path.join(process.cwd(), "extensions", entry.name, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        return [];
      }

      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
        alisio?: {
          channel?: {
            id?: string;
          };
        };
      };
      return pkg.alisio?.channel?.id ? [bundledPluginRoot(entry.name)] : [];
    })
    .toSorted((left, right) => left.localeCompare(right));
}

describe("vitest channel paths", () => {
  it("includes every bundled channel plugin root in the channel surface", () => {
    expect(bundledChannelTestRoots).toEqual(listExpectedBundledChannelRoots());
  });

  it("keeps shared channel-only helpers on the channel surface", () => {
    expect(channelTestRoots).toEqual(
      expect.arrayContaining([...bundledChannelTestRoots, "src/browser", "src/line"]),
    );
  });

  it("excludes bundled channel roots from the extensions config", () => {
    const config = createExtensionsVitestConfig({});
    const exclude = config.test?.exclude ?? [];

    for (const root of bundledChannelTestRoots) {
      expect(exclude).toContain(root.replace(/^extensions\//u, "") + "/**");
    }
  });
});
