import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getPackageManifestMetadata,
  loadPluginManifest,
  PLUGIN_MANIFEST_FILENAMES,
  resolvePluginManifestPath,
  type OpenClawPackageManifest,
  type PackageManifest,
} from "./manifest.js";

const tempDirs: string[] = [];

function makeTempPluginDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeManifestFile(rootDir: string, fileName: string, id: string): void {
  fs.writeFileSync(
    path.join(rootDir, fileName),
    JSON.stringify(
      {
        id,
        configSchema: {
          type: "object",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("plugin manifest compatibility", () => {
  it("checks current manifest names before legacy aliases", () => {
    expect(PLUGIN_MANIFEST_FILENAMES).toEqual(["alisio.plugin.json", "openclaw.plugin.json"]);
  });

  it("prefers alisio.plugin.json when both manifest filenames exist", () => {
    const rootDir = makeTempPluginDir("alisio-plugin-manifest-");
    writeManifestFile(rootDir, "openclaw.plugin.json", "legacy");
    writeManifestFile(rootDir, "alisio.plugin.json", "current");

    expect(resolvePluginManifestPath(rootDir)).toBe(path.join(rootDir, "alisio.plugin.json"));

    const loaded = loadPluginManifest(rootDir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.manifest.id).toBe("current");
      expect(loaded.manifestPath).toBe(path.join(rootDir, "alisio.plugin.json"));
    }
  });

  it("falls back to openclaw.plugin.json when the current manifest is absent", () => {
    const rootDir = makeTempPluginDir("openclaw-plugin-manifest-");
    writeManifestFile(rootDir, "openclaw.plugin.json", "legacy");

    expect(resolvePluginManifestPath(rootDir)).toBe(path.join(rootDir, "openclaw.plugin.json"));

    const loaded = loadPluginManifest(rootDir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.manifest.id).toBe("legacy");
      expect(loaded.manifestPath).toBe(path.join(rootDir, "openclaw.plugin.json"));
    }
  });

  it("reads package metadata from current and legacy package.json keys", () => {
    const current: OpenClawPackageManifest = { extensions: ["./current.js"] };
    const legacy: OpenClawPackageManifest = { extensions: ["./legacy.js"] };

    expect(
      getPackageManifestMetadata({
        alisio: current,
        openclaw: legacy,
      } as PackageManifest),
    ).toEqual(current);

    expect(
      getPackageManifestMetadata({
        openclaw: legacy,
      } as PackageManifest),
    ).toEqual(legacy);
  });
});
