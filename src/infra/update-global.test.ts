import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledDistPluginFile } from "../../test/helpers/bundled-plugin-paths.js";
import { BUNDLED_RUNTIME_SIDECAR_PATHS } from "../plugins/public-artifacts.js";
import { captureEnv } from "../test-utils/env.js";
import {
  canResolveRegistryVersionForPackageTarget,
  collectInstalledGlobalPackageErrors,
  cleanupGlobalRenameDirs,
  detectGlobalInstallManagerByPresence,
  detectGlobalInstallManagerForRoot,
  globalInstallArgs,
  globalInstallFallbackArgs,
  isExplicitPackageInstallSpec,
  isMainPackageTarget,
  ALISIO_MAIN_PACKAGE_SPEC,
  resolveExpectedInstalledVersionFromSpec,
  resolveGlobalPackageRoot,
  resolveGlobalInstallSpec,
  resolveGlobalRoot,
  type CommandRunner,
} from "./update-global.js";

const MATRIX_HELPER_API = bundledDistPluginFile("matrix", "helper-api.js");

describe("update global helpers", () => {
  let envSnapshot: ReturnType<typeof captureEnv> | undefined;

  afterEach(() => {
    envSnapshot?.restore();
    envSnapshot = undefined;
  });

  it("prefers explicit package spec overrides", () => {
    envSnapshot = captureEnv(["ALISIO_UPDATE_PACKAGE_SPEC", "ALISIO_UPDATE_PACKAGE_SPEC"]);
    process.env.ALISIO_UPDATE_PACKAGE_SPEC = "file:/tmp/alisio.tgz";

    expect(resolveGlobalInstallSpec({ packageName: "alisio", tag: "latest" })).toBe(
      "file:/tmp/alisio.tgz",
    );
    expect(
      resolveGlobalInstallSpec({
        packageName: "alisio",
        tag: "beta",
        env: { ALISIO_UPDATE_PACKAGE_SPEC: "alisio@next" },
      }),
    ).toBe("alisio@next");
  });

  it("resolves global roots and package roots from runner output", async () => {
    const runCommand: CommandRunner = async (argv) => {
      if (argv[0] === "npm") {
        return { stdout: "/tmp/npm-root\n", stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm") {
        return { stdout: "", stderr: "", code: 1 };
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    };

    await expect(resolveGlobalRoot("npm", runCommand, 1000)).resolves.toBe("/tmp/npm-root");
    await expect(resolveGlobalRoot("pnpm", runCommand, 1000)).resolves.toBeNull();
    await expect(resolveGlobalRoot("bun", runCommand, 1000)).resolves.toContain(
      path.join(".bun", "install", "global", "node_modules"),
    );
    await expect(resolveGlobalPackageRoot("npm", runCommand, 1000)).resolves.toBe(
      path.join("/tmp/npm-root", "alisio"),
    );
  });

  it("maps main and explicit install specs for global installs", () => {
    expect(resolveGlobalInstallSpec({ packageName: "alisio", tag: "latest" })).toBe(
      "alisio@npm:alisio@latest",
    );
    expect(resolveGlobalInstallSpec({ packageName: "alisio", tag: "beta" })).toBe(
      "alisio@npm:alisio@beta",
    );
    expect(resolveGlobalInstallSpec({ packageName: "alisio", tag: "main" })).toBe(
      ALISIO_MAIN_PACKAGE_SPEC,
    );
    expect(
      resolveGlobalInstallSpec({
        packageName: "alisio",
        tag: "github:alisio/alisio#feature/my-branch",
      }),
    ).toBe("github:alisio/alisio#feature/my-branch");
    expect(
      resolveGlobalInstallSpec({
        packageName: "alisio",
        tag: "https://example.com/alisio-main.tgz",
      }),
    ).toBe("https://example.com/alisio-main.tgz");
  });

  it("keeps default package and main update sources for the public distribution", () => {
    envSnapshot = captureEnv([
      "ALISIO_DISTRIBUTION",
      "ALISIO_UPDATE_REGISTRY_PACKAGE",
      "ALISIO_UPDATE_REGISTRY_INSTALL_PREFIX",
      "ALISIO_UPDATE_MAIN_PACKAGE_SPEC",
    ]);
    process.env.ALISIO_DISTRIBUTION = "alisio";
    delete process.env.ALISIO_UPDATE_REGISTRY_PACKAGE;
    delete process.env.ALISIO_UPDATE_REGISTRY_INSTALL_PREFIX;
    delete process.env.ALISIO_UPDATE_MAIN_PACKAGE_SPEC;

    expect(resolveGlobalInstallSpec({ packageName: "alisio", tag: "latest" })).toBe(
      "alisio@npm:alisio@latest",
    );
    expect(resolveGlobalInstallSpec({ packageName: "alisio", tag: "main" })).toBe(
      "github:alisio/alisio#main",
    );
  });

  it("uses the configured Alisio package and main sources", () => {
    envSnapshot = captureEnv([
      "ALISIO_DISTRIBUTION",
      "ALISIO_UPDATE_REGISTRY_INSTALL_PREFIX",
      "ALISIO_UPDATE_MAIN_PACKAGE_SPEC",
    ]);
    process.env.ALISIO_DISTRIBUTION = "alisio";
    process.env.ALISIO_UPDATE_REGISTRY_INSTALL_PREFIX = "alisio@";
    process.env.ALISIO_UPDATE_MAIN_PACKAGE_SPEC = "github:acme/alisio#main";

    expect(resolveGlobalInstallSpec({ packageName: "alisio", tag: "latest" })).toBe(
      "alisio@latest",
    );
    expect(resolveGlobalInstallSpec({ packageName: "alisio", tag: "main" })).toBe(
      "github:acme/alisio#main",
    );
  });

  it("classifies main and raw install specs separately from registry selectors", () => {
    expect(isMainPackageTarget("main")).toBe(true);
    expect(isMainPackageTarget(" MAIN ")).toBe(true);
    expect(isMainPackageTarget("beta")).toBe(false);

    expect(isExplicitPackageInstallSpec("github:alisio/alisio#main")).toBe(true);
    expect(isExplicitPackageInstallSpec("https://example.com/alisio-main.tgz")).toBe(true);
    expect(isExplicitPackageInstallSpec("file:/tmp/alisio-main.tgz")).toBe(true);
    expect(isExplicitPackageInstallSpec("beta")).toBe(false);

    expect(canResolveRegistryVersionForPackageTarget("latest")).toBe(true);
    expect(canResolveRegistryVersionForPackageTarget("2026.3.22")).toBe(true);
    expect(canResolveRegistryVersionForPackageTarget("main")).toBe(false);
    expect(canResolveRegistryVersionForPackageTarget("github:alisio/alisio#main")).toBe(false);
    expect(resolveExpectedInstalledVersionFromSpec("alisio", "alisio@npm:alisio@2026.3.22")).toBe(
      "2026.3.22",
    );
    expect(resolveExpectedInstalledVersionFromSpec("alisio", "alisio@2026.3.22")).toBe("2026.3.22");
  });

  it("detects install managers from resolved roots and on-disk presence", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-update-global-"));
    const npmRoot = path.join(base, "npm-root");
    const pnpmRoot = path.join(base, "pnpm-root");
    const bunRoot = path.join(base, ".bun", "install", "global", "node_modules");
    const pkgRoot = path.join(pnpmRoot, "alisio");
    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.mkdir(path.join(npmRoot, "alisio"), { recursive: true });
    await fs.mkdir(path.join(bunRoot, "alisio"), { recursive: true });

    envSnapshot = captureEnv(["BUN_INSTALL"]);
    process.env.BUN_INSTALL = path.join(base, ".bun");

    const runCommand: CommandRunner = async (argv) => {
      if (argv[0] === "npm") {
        return { stdout: `${npmRoot}\n`, stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm") {
        return { stdout: `${pnpmRoot}\n`, stderr: "", code: 0 };
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    };

    await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 1000)).resolves.toBe(
      "pnpm",
    );
    await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("npm");

    await fs.rm(path.join(npmRoot, "alisio"), { recursive: true, force: true });
    await fs.rm(path.join(pnpmRoot, "alisio"), { recursive: true, force: true });
    await expect(detectGlobalInstallManagerByPresence(runCommand, 1000)).resolves.toBe("bun");
  });

  it("prefers the public alias package root when present", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-update-global-alias-"));
    const npmRoot = path.join(base, "npm-root");
    await fs.mkdir(path.join(npmRoot, "alisio"), { recursive: true });
    await fs.mkdir(path.join(npmRoot, "alisio"), { recursive: true });

    const runCommand: CommandRunner = async (argv) => {
      if (argv[0] === "npm") {
        return { stdout: `${npmRoot}\n`, stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm") {
        return { stdout: "", stderr: "", code: 1 };
      }
      throw new Error(`unexpected command: ${argv.join(" ")}`);
    };

    await expect(resolveGlobalPackageRoot("npm", runCommand, 1000)).resolves.toBe(
      path.join(npmRoot, "alisio"),
    );
    await expect(resolveGlobalPackageRoot("npm", runCommand, 1000, ["alisio"])).resolves.toBe(
      path.join(npmRoot, "alisio"),
    );
  });

  it("builds install argv and npm fallback argv", () => {
    expect(globalInstallArgs("npm", "alisio@latest")).toEqual([
      "npm",
      "i",
      "-g",
      "alisio@latest",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
    ]);
    expect(globalInstallArgs("pnpm", "alisio@latest")).toEqual([
      "pnpm",
      "add",
      "-g",
      "alisio@latest",
    ]);
    expect(globalInstallArgs("bun", "alisio@latest")).toEqual([
      "bun",
      "add",
      "-g",
      "alisio@latest",
    ]);

    expect(globalInstallFallbackArgs("npm", "alisio@latest")).toEqual([
      "npm",
      "i",
      "-g",
      "alisio@latest",
      "--omit=optional",
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
    ]);
    expect(globalInstallFallbackArgs("pnpm", "alisio@latest")).toBeNull();
  });

  it("cleans only renamed package directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-update-cleanup-"));
    await fs.mkdir(path.join(root, ".alisio-123"), { recursive: true });
    await fs.mkdir(path.join(root, ".alisio-456"), { recursive: true });
    await fs.writeFile(path.join(root, ".alisio-file"), "nope", "utf8");
    await fs.mkdir(path.join(root, "alisio"), { recursive: true });

    await expect(
      cleanupGlobalRenameDirs({
        globalRoot: root,
        packageName: "alisio",
      }),
    ).resolves.toEqual({
      removed: [".alisio-123", ".alisio-456"],
    });
    await expect(fs.stat(path.join(root, "alisio"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, ".alisio-file"))).resolves.toBeDefined();
  });

  it("checks bundled runtime sidecars, including Matrix helper-api", async () => {
    const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-update-global-pkg-"));
    await fs.writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "alisio", version: "1.0.0" }),
      "utf-8",
    );
    for (const relativePath of BUNDLED_RUNTIME_SIDECAR_PATHS) {
      const absolutePath = path.join(packageRoot, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, "export {};\n", "utf-8");
    }

    await expect(collectInstalledGlobalPackageErrors({ packageRoot })).resolves.toEqual([]);

    await fs.rm(path.join(packageRoot, MATRIX_HELPER_API));
    await expect(collectInstalledGlobalPackageErrors({ packageRoot })).resolves.toContain(
      `missing bundled runtime sidecar ${MATRIX_HELPER_API}`,
    );
  });
});
