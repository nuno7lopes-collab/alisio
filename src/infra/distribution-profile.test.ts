import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveDistributionId,
  resolveUpdateSourceConfig,
  ALISIO_GIT_REPO_URL,
  ALISIO_MAIN_PACKAGE_SPEC,
  ALISIO_REGISTRY_INSTALL_PREFIX,
  ALISIO_REGISTRY_PACKAGE_NAME,
} from "./distribution-profile.js";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-distribution-profile-"));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeJsonFixture(root: string, relativePath: string, value: unknown) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf-8");
}

function moduleUrlFrom(root: string, relativePath: string): string {
  return pathToFileURL(path.join(root, relativePath)).href;
}

describe("distribution profile", () => {
  it("keeps default update sources available for the Alisio package", () => {
    const resolved = resolveUpdateSourceConfig({
      moduleUrl: import.meta.url,
      env: {},
    });

    expect(resolved).toEqual({
      distribution: "alisio",
      registryPackageName: ALISIO_REGISTRY_PACKAGE_NAME,
      registryInstallPrefix: ALISIO_REGISTRY_INSTALL_PREFIX,
      mainPackageSpec: ALISIO_MAIN_PACKAGE_SPEC,
      gitRepoUrl: ALISIO_GIT_REPO_URL,
    });
  });

  it("keeps the default update sources when the public distribution is selected explicitly", () => {
    const resolved = resolveUpdateSourceConfig({
      moduleUrl: import.meta.url,
      env: { ALISIO_DISTRIBUTION: "alisio" },
    });

    expect(resolved).toEqual({
      distribution: "alisio",
      registryPackageName: ALISIO_REGISTRY_PACKAGE_NAME,
      registryInstallPrefix: ALISIO_REGISTRY_INSTALL_PREFIX,
      mainPackageSpec: ALISIO_MAIN_PACKAGE_SPEC,
      gitRepoUrl: ALISIO_GIT_REPO_URL,
    });
  });

  it("loads Alisio update sources from build metadata", async () => {
    await withTempDir(async (root) => {
      await writeJsonFixture(root, "package.json", {
        name: "alisio",
        version: "1.0.0",
      });
      await writeJsonFixture(root, "dist/build-info.json", {
        distribution: "alisio",
        update: {
          registryPackageName: "alisio",
          registryInstallPrefix: "alisio@",
          mainPackageSpec: "github:acme/alisio#main",
          gitRepoUrl: "https://github.com/acme/alisio.git",
        },
      });
      const moduleUrl = moduleUrlFrom(root, "dist/infra/distribution-profile.js");

      expect(resolveDistributionId({ moduleUrl, env: {} })).toBe("alisio");
      expect(resolveUpdateSourceConfig({ moduleUrl, env: {} })).toEqual({
        distribution: "alisio",
        registryPackageName: "alisio",
        registryInstallPrefix: "alisio@",
        mainPackageSpec: "github:acme/alisio#main",
        gitRepoUrl: "https://github.com/acme/alisio.git",
      });
    });
  });

  it("recognizes a renamed package root as Alisio", async () => {
    await withTempDir(async (root) => {
      await writeJsonFixture(root, "package.json", {
        name: "alisio",
        version: "1.0.0",
      });
      const moduleUrl = moduleUrlFrom(root, "src/infra/distribution-profile.ts");
      expect(resolveDistributionId({ moduleUrl, env: {} })).toBe("alisio");
    });
  });
});
