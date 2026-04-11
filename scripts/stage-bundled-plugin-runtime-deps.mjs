import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hostPackageNames, readPackageBrandConfig } from "./lib/alisio-branding.mjs";

const WINDOWS_UNSAFE_CMD_CHARS_RE = /[&|<>^%\r\n]/;
const RUNTIME_DEPS_LAYOUT_VERSION = 2;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function removePathIfExists(targetPath) {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function listBundledPluginRuntimeDirs(repoRoot) {
  const extensionsRoot = path.join(repoRoot, "dist", "extensions");
  if (!fs.existsSync(extensionsRoot)) {
    return [];
  }

  return fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(extensionsRoot, dirent.name))
    .filter((pluginDir) => fs.existsSync(path.join(pluginDir, "package.json")));
}

function hasRuntimeDeps(packageJson) {
  return (
    Object.keys(packageJson.dependencies ?? {}).length > 0 ||
    Object.keys(packageJson.optionalDependencies ?? {}).length > 0
  );
}

function shouldStageRuntimeDeps(packageJson) {
  return readPackageBrandConfig(packageJson)?.bundle?.stageRuntimeDependencies === true;
}

function sanitizeBundledManifestForRuntimeInstall(pluginDir, repoRoot = process.cwd()) {
  const removableHostPackages = new Set(hostPackageNames(repoRoot));
  const manifestPath = path.join(pluginDir, "package.json");
  let packageJson;
  let shouldWriteManifest = false;

  if (fs.existsSync(manifestPath)) {
    packageJson = readJson(manifestPath);
  } else {
    const sourceManifestPath = path.join(
      repoRoot,
      "extensions",
      path.basename(pluginDir),
      "package.json",
    );
    if (!fs.existsSync(sourceManifestPath)) {
      throw new Error(`missing bundled plugin manifest: ${manifestPath}`);
    }
    packageJson = readJson(sourceManifestPath);
    shouldWriteManifest = true;
  }
  let changed = false;

  if (
    Object.keys(packageJson.peerDependencies ?? {}).some((name) => removableHostPackages.has(name))
  ) {
    const nextPeerDependencies = { ...packageJson.peerDependencies };
    for (const name of removableHostPackages) {
      delete nextPeerDependencies[name];
    }
    if (Object.keys(nextPeerDependencies).length === 0) {
      delete packageJson.peerDependencies;
    } else {
      packageJson.peerDependencies = nextPeerDependencies;
    }
    changed = true;
  }

  if (
    Object.keys(packageJson.peerDependenciesMeta ?? {}).some((name) =>
      removableHostPackages.has(name),
    )
  ) {
    const nextPeerDependenciesMeta = { ...packageJson.peerDependenciesMeta };
    for (const name of removableHostPackages) {
      delete nextPeerDependenciesMeta[name];
    }
    if (Object.keys(nextPeerDependenciesMeta).length === 0) {
      delete packageJson.peerDependenciesMeta;
    } else {
      packageJson.peerDependenciesMeta = nextPeerDependenciesMeta;
    }
    changed = true;
  }

  if (
    Object.keys(packageJson.devDependencies ?? {}).some((name) => removableHostPackages.has(name))
  ) {
    const nextDevDependencies = { ...packageJson.devDependencies };
    for (const name of removableHostPackages) {
      delete nextDevDependencies[name];
    }
    if (Object.keys(nextDevDependencies).length === 0) {
      delete packageJson.devDependencies;
    } else {
      packageJson.devDependencies = nextDevDependencies;
    }
    changed = true;
  }

  if (changed || shouldWriteManifest) {
    fs.mkdirSync(pluginDir, { recursive: true });
    writeJson(manifestPath, packageJson);
  }

  return packageJson;
}

function resolveRuntimeDepsStampPath(pluginDir) {
  return path.join(pluginDir, ".alisio-runtime-deps-stamp.json");
}

function createRuntimeDepsFingerprint(packageJson) {
  return createHash("sha256").update(JSON.stringify(packageJson)).digest("hex");
}

function readRuntimeDepsStamp(stampPath) {
  if (!fs.existsSync(stampPath)) {
    return null;
  }
  try {
    return readJson(stampPath);
  } catch {
    return null;
  }
}

export function resolveNpmRunner(params = {}) {
  const execPath = params.execPath ?? process.execPath;
  const npmArgs = params.npmArgs ?? [];
  const existsSync = params.existsSync ?? fs.existsSync;
  const env = params.env ?? process.env;
  const platform = params.platform ?? process.platform;
  const comSpec = params.comSpec ?? env.ComSpec ?? "cmd.exe";
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  const nodeDir = pathImpl.dirname(execPath);
  const npmToolchain = resolveToolchainNpmRunner({
    comSpec,
    existsSync,
    nodeDir,
    npmArgs,
    pathImpl,
    platform,
  });
  if (npmToolchain) {
    return npmToolchain;
  }
  if (platform === "win32") {
    const expectedPaths = [
      pathImpl.resolve(nodeDir, "../lib/node_modules/npm/bin/npm-cli.js"),
      pathImpl.resolve(nodeDir, "node_modules/npm/bin/npm-cli.js"),
      pathImpl.resolve(nodeDir, "npm.exe"),
      pathImpl.resolve(nodeDir, "npm.cmd"),
    ];
    throw new Error(
      `failed to resolve a toolchain-local npm next to ${execPath}. ` +
        `Checked: ${expectedPaths.join(", ")}. ` +
        "Alisio refuses to shell out to bare npm on Windows; install a Node.js toolchain that bundles npm or run with a matching Node installation.",
    );
  }
  const pathKey = resolvePathEnvKey(env);
  const currentPath = env[pathKey];
  return {
    command: "npm",
    args: npmArgs,
    shell: false,
    env: {
      ...env,
      [pathKey]:
        typeof currentPath === "string" && currentPath.length > 0
          ? `${nodeDir}${path.delimiter}${currentPath}`
          : nodeDir,
    },
  };
}

function resolveToolchainNpmRunner(params) {
  const npmCliCandidates = [
    params.pathImpl.resolve(params.nodeDir, "../lib/node_modules/npm/bin/npm-cli.js"),
    params.pathImpl.resolve(params.nodeDir, "node_modules/npm/bin/npm-cli.js"),
  ];
  const npmCliPath = npmCliCandidates.find((candidate) => params.existsSync(candidate));
  if (npmCliPath) {
    return {
      command:
        params.platform === "win32"
          ? params.pathImpl.join(params.nodeDir, "node.exe")
          : params.pathImpl.join(params.nodeDir, "node"),
      args: [npmCliPath, ...params.npmArgs],
      shell: false,
    };
  }
  if (params.platform !== "win32") {
    return null;
  }
  const npmExePath = params.pathImpl.resolve(params.nodeDir, "npm.exe");
  if (params.existsSync(npmExePath)) {
    return {
      command: npmExePath,
      args: params.npmArgs,
      shell: false,
    };
  }
  const npmCmdPath = params.pathImpl.resolve(params.nodeDir, "npm.cmd");
  if (params.existsSync(npmCmdPath)) {
    return {
      command: params.comSpec,
      args: ["/d", "/s", "/c", buildCmdExeCommandLine(npmCmdPath, params.npmArgs)],
      shell: false,
      windowsVerbatimArguments: true,
    };
  }
  return null;
}

function resolvePathEnvKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function escapeForCmdExe(arg) {
  if (WINDOWS_UNSAFE_CMD_CHARS_RE.test(arg)) {
    throw new Error(`unsafe Windows cmd.exe argument detected: ${JSON.stringify(arg)}`);
  }
  if (!arg.includes(" ") && !arg.includes('"')) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}

function buildCmdExeCommandLine(command, args) {
  return [escapeForCmdExe(command), ...args.map(escapeForCmdExe)].join(" ");
}

function installPluginRuntimeDeps(params) {
  const { fingerprint, packageJson, pluginDir, pluginId } = params;
  const nodeModulesDir = path.join(pluginDir, "node_modules");
  const stampPath = resolveRuntimeDepsStampPath(pluginDir);
  const tempInstallDir = makeTempDir(`alisio-runtime-deps-${pluginId}-`);
  const npmRunner = resolveNpmRunner({
    npmArgs: [
      "install",
      "--omit=dev",
      "--silent",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--package-lock=false",
    ],
  });
  try {
    writeJson(path.join(tempInstallDir, "package.json"), packageJson);
    const result = spawnSync(npmRunner.command, npmRunner.args, {
      cwd: tempInstallDir,
      encoding: "utf8",
      env: npmRunner.env,
      stdio: "pipe",
      shell: npmRunner.shell,
      windowsVerbatimArguments: npmRunner.windowsVerbatimArguments,
    });
    if (result.status !== 0) {
      const output = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      throw new Error(
        `failed to stage bundled runtime deps for ${pluginId}: ${output || "npm install failed"}`,
      );
    }

    const stagedNodeModulesDir = path.join(tempInstallDir, "node_modules");
    if (!fs.existsSync(stagedNodeModulesDir)) {
      throw new Error(
        `failed to stage bundled runtime deps for ${pluginId}: npm install produced no node_modules directory`,
      );
    }

    removePathIfExists(nodeModulesDir);
    fs.mkdirSync(pluginDir, { recursive: true });
    try {
      fs.renameSync(stagedNodeModulesDir, nodeModulesDir);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "ENOTEMPTY" || error.code === "EEXIST")
      ) {
        removePathIfExists(nodeModulesDir);
        fs.renameSync(stagedNodeModulesDir, nodeModulesDir);
        writeJson(stampPath, {
          fingerprint,
          layoutVersion: RUNTIME_DEPS_LAYOUT_VERSION,
          generatedAt: new Date().toISOString(),
        });
        return;
      }
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EXDEV") {
        throw error;
      }
      fs.cpSync(stagedNodeModulesDir, nodeModulesDir, {
        recursive: true,
      });
      removePathIfExists(stagedNodeModulesDir);
    }
    writeJson(stampPath, {
      fingerprint,
      layoutVersion: RUNTIME_DEPS_LAYOUT_VERSION,
      generatedAt: new Date().toISOString(),
    });
  } finally {
    removePathIfExists(tempInstallDir);
  }
}

export function stageBundledPluginRuntimeDeps(params = {}) {
  const repoRoot = params.cwd ?? params.repoRoot ?? process.cwd();
  const installPluginRuntimeDepsImpl =
    params.installPluginRuntimeDepsImpl ?? installPluginRuntimeDeps;
  for (const pluginDir of listBundledPluginRuntimeDirs(repoRoot)) {
    const pluginId = path.basename(pluginDir);
    const packageJson = sanitizeBundledManifestForRuntimeInstall(pluginDir, repoRoot);
    const nodeModulesDir = path.join(pluginDir, "node_modules");
    const stampPath = resolveRuntimeDepsStampPath(pluginDir);
    if (!hasRuntimeDeps(packageJson) || !shouldStageRuntimeDeps(packageJson)) {
      removePathIfExists(nodeModulesDir);
      removePathIfExists(stampPath);
      continue;
    }
    const fingerprint = createRuntimeDepsFingerprint(packageJson);
    const stamp = readRuntimeDepsStamp(stampPath);
    if (
      fs.existsSync(nodeModulesDir) &&
      stamp?.fingerprint === fingerprint &&
      stamp?.layoutVersion === RUNTIME_DEPS_LAYOUT_VERSION
    ) {
      continue;
    }
    installPluginRuntimeDepsImpl({
      fingerprint,
      packageJson,
      pluginDir,
      pluginId,
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  stageBundledPluginRuntimeDeps();
}
