import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const EXTENSIONS_ROOT = path.dirname(fileURLToPath(import.meta.url));

describe("plugin manifest filename shims", () => {
  it("keeps alisio.plugin.json byte-identical to openclaw.plugin.json during the transition", () => {
    const pluginDirs = fs
      .readdirSync(EXTENSIONS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(EXTENSIONS_ROOT, entry.name))
      .sort();

    let checkedPairs = 0;
    for (const pluginDir of pluginDirs) {
      const alisioManifest = path.join(pluginDir, "alisio.plugin.json");
      const openClawManifest = path.join(pluginDir, "openclaw.plugin.json");
      const hasAlisioManifest = fs.existsSync(alisioManifest);
      const hasOpenClawManifest = fs.existsSync(openClawManifest);

      expect(hasAlisioManifest).toBe(hasOpenClawManifest);
      if (!hasAlisioManifest || !hasOpenClawManifest) {
        continue;
      }

      checkedPairs += 1;
      expect(fs.readFileSync(alisioManifest, "utf8")).toBe(
        fs.readFileSync(openClawManifest, "utf8"),
      );
    }

    expect(checkedPairs).toBeGreaterThan(0);
  });
});
