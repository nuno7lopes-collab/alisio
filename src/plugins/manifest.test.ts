import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getPackageManifestMetadata,
  loadPluginManifest,
  PLUGIN_MANIFEST_FILENAMES,
  resolvePluginManifestPath,
  type AlisioPackageManifest,
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
  it("uses only the canonical manifest filename", () => {
    expect(PLUGIN_MANIFEST_FILENAMES).toEqual(["alisio.plugin.json"]);
  });

  it("resolves the canonical manifest filename", () => {
    const rootDir = makeTempPluginDir("alisio-plugin-manifest-");
    writeManifestFile(rootDir, "alisio.plugin.json", "current");

    expect(resolvePluginManifestPath(rootDir)).toBe(path.join(rootDir, "alisio.plugin.json"));

    const loaded = loadPluginManifest(rootDir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.manifest.id).toBe("current");
      expect(loaded.manifestPath).toBe(path.join(rootDir, "alisio.plugin.json"));
    }
  });

  it("returns the canonical manifest path when the manifest is absent", () => {
    const rootDir = makeTempPluginDir("alisio-plugin-manifest-");
    const expectedPath = path.join(rootDir, "alisio.plugin.json");
    expect(resolvePluginManifestPath(rootDir)).toBe(expectedPath);
    const loaded = loadPluginManifest(rootDir);
    expect(loaded.ok).toBe(false);
    expect(loaded.manifestPath).toBe(expectedPath);
  });

  it("reads package metadata from the canonical package.json key", () => {
    const current: AlisioPackageManifest = { extensions: ["./current.js"] };

    expect(
      getPackageManifestMetadata({
        alisio: current,
      } as PackageManifest),
    ).toEqual(current);

    expect(getPackageManifestMetadata({} as PackageManifest)).toBeUndefined();
  });
});
