import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  currentPluginManifestName,
  readPackageBrandConfig,
  writePackageBrandConfig,
} from "./lib/alisio-branding.mjs";
import { shouldBuildBundledCluster } from "./lib/optional-bundled-clusters.mjs";
import {
  removeFileIfExists,
  removePathIfExists,
  writeTextFileIfChanged,
} from "./runtime-postbuild-shared.mjs";

const GENERATED_BUNDLED_SKILLS_DIR = "bundled-skills";
const TRANSIENT_COPY_ERROR_CODES = new Set(["EEXIST", "ENOENT", "ENOTEMPTY", "EBUSY"]);
const COPY_RETRY_DELAYS_MS = [10, 25, 50];
const TOP_LEVEL_PUBLIC_SURFACE_EXTENSIONS = new Set([".ts", ".js", ".mts", ".cts", ".mjs", ".cjs"]);
const BUNDLED_SKILL_BRANDING_FILE_NAMES = new Set([
  "LICENSE",
  "README.md",
  "SKILL.md",
  "package.json",
]);
const LEGACY_BRAND_SLUG = ["open", "claw"].join("");
const LEGACY_BRAND_NAME = ["Open", "Claw"].join("");
const LEGACY_BRAND_UPPER = ["OPEN", "CLAW"].join("");
const BUNDLED_SKILL_BRANDING_REPLACEMENTS = [
  [`${LEGACY_BRAND_NAME} Settings Manager`, "Alisio Settings Manager"],
  [`${LEGACY_BRAND_NAME} ACP`, "Alisio ACP"],
  [`${LEGACY_BRAND_NAME} config`, "Alisio config"],
  [`${LEGACY_BRAND_NAME} settings`, "Alisio settings"],
  [`${LEGACY_BRAND_NAME} agents`, "Alisio agents"],
  [LEGACY_BRAND_NAME, "Alisio"],
  [LEGACY_BRAND_UPPER, "ALISIO"],
  [`${LEGACY_BRAND_SLUG}/${LEGACY_BRAND_SLUG}`, "alisio/alisio"],
  [`${LEGACY_BRAND_SLUG}/acpx`, "alisio/acpx"],
  [`dev@${LEGACY_BRAND_SLUG}.ai`, "dev@alisio.ai"],
  [`${LEGACY_BRAND_SLUG}.ai`, "alisio.ai"],
  [`${LEGACY_BRAND_SLUG} acp`, "alisio acp"],
  [`.${LEGACY_BRAND_SLUG}`, ".alisio"],
  [LEGACY_BRAND_SLUG, "alisio"],
];
const CAPABILITY_ONLY_PUBLIC_SURFACE_BASENAMES = new Set([
  "api",
  "channel-config-api",
  "provider-catalog",
  "runtime-api",
  "session-key-api",
]);

export function rewritePackageExtensions(entries) {
  if (!Array.isArray(entries)) {
    return undefined;
  }

  return entries
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => {
      const normalized = entry.replace(/^\.\//, "");
      const rewritten = normalized.replace(/\.[^.]+$/u, ".js");
      return `./${rewritten}`;
    });
}

function rewritePackageEntry(entry) {
  if (typeof entry !== "string" || entry.trim().length === 0) {
    return undefined;
  }
  const normalized = entry.replace(/^\.\//, "");
  const rewritten = normalized.replace(/\.[^.]+$/u, ".js");
  return `./${rewritten}`;
}

function hasCapabilityOnlyPublicSurfaces(pluginDir) {
  if (!fs.existsSync(pluginDir)) {
    return false;
  }

  return fs.readdirSync(pluginDir, { withFileTypes: true }).some((entry) => {
    if (!entry.isFile()) {
      return false;
    }
    const ext = path.extname(entry.name);
    if (!TOP_LEVEL_PUBLIC_SURFACE_EXTENSIONS.has(ext)) {
      return false;
    }
    const normalizedName = entry.name.toLowerCase();
    if (
      normalizedName.endsWith(".d.ts") ||
      normalizedName.includes(".test.") ||
      normalizedName.includes(".spec.") ||
      normalizedName.includes(".fixture.") ||
      normalizedName.includes(".snap")
    ) {
      return false;
    }
    return CAPABILITY_ONLY_PUBLIC_SURFACE_BASENAMES.has(path.basename(entry.name, ext));
  });
}

function ensurePathInsideRoot(rootDir, rawPath) {
  const resolved = path.resolve(rootDir, rawPath);
  const relative = path.relative(rootDir, resolved);
  if (
    relative === "" ||
    relative === "." ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    return resolved;
  }
  throw new Error(`path escapes plugin root: ${rawPath}`);
}

function normalizeManifestRelativePath(rawPath) {
  return rawPath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function resolveDeclaredSkillSourcePath(params) {
  const normalized = normalizeManifestRelativePath(params.rawPath);
  const pluginLocalPath = ensurePathInsideRoot(params.pluginDir, normalized);
  if (fs.existsSync(pluginLocalPath)) {
    return pluginLocalPath;
  }
  if (!/^node_modules(?:\/|$)/u.test(normalized)) {
    return pluginLocalPath;
  }
  return ensurePathInsideRoot(params.repoRoot, normalized);
}

function resolveBundledSkillTarget(rawPath) {
  const normalized = normalizeManifestRelativePath(rawPath);
  if (/^node_modules(?:\/|$)/u.test(normalized)) {
    // Bundled dist/plugin roots must not publish nested node_modules trees. Relocate
    // dependency-backed skill assets into a dist-owned directory and rewrite the manifest.
    const trimmed = normalized.replace(/^node_modules\/?/u, "");
    if (!trimmed) {
      throw new Error(`node_modules skill path must point to a package: ${rawPath}`);
    }
    const bundledRelativePath = `${GENERATED_BUNDLED_SKILLS_DIR}/${trimmed}`;
    return {
      manifestPath: `./${bundledRelativePath}`,
      outputPath: bundledRelativePath,
    };
  }
  return {
    manifestPath: rawPath,
    outputPath: normalized,
  };
}

function isTransientCopyError(error) {
  return (
    !!error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    TRANSIENT_COPY_ERROR_CODES.has(error.code)
  );
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function copySkillPathWithRetry(params) {
  const maxAttempts = COPY_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      removePathIfExists(params.targetPath);
      fs.mkdirSync(path.dirname(params.targetPath), { recursive: true });
      fs.cpSync(params.sourcePath, params.targetPath, params.copyOptions);
      return;
    } catch (error) {
      if (!isTransientCopyError(error) || attempt === maxAttempts - 1) {
        throw error;
      }
      sleepSync(COPY_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }
}

function rewriteBundledSkillBranding(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  const queue = [targetPath];
  while (queue.length > 0) {
    const currentPath = queue.pop();
    if (!currentPath) {
      continue;
    }
    const stat = fs.statSync(currentPath);
    if (stat.isDirectory()) {
      for (const dirent of fs.readdirSync(currentPath, { withFileTypes: true })) {
        queue.push(path.join(currentPath, dirent.name));
      }
      continue;
    }
    if (!stat.isFile() || !BUNDLED_SKILL_BRANDING_FILE_NAMES.has(path.basename(currentPath))) {
      continue;
    }
    const original = fs.readFileSync(currentPath, "utf8");
    let rewritten = original;
    for (const [from, to] of BUNDLED_SKILL_BRANDING_REPLACEMENTS) {
      rewritten = rewritten.replaceAll(from, to);
    }
    if (rewritten !== original) {
      fs.writeFileSync(currentPath, rewritten, "utf8");
    }
  }
}

function copyDeclaredPluginSkillPaths(params) {
  const skills = Array.isArray(params.manifest.skills) ? params.manifest.skills : [];
  const copiedSkills = [];
  for (const raw of skills) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      continue;
    }
    const sourcePath = resolveDeclaredSkillSourcePath({
      rawPath: raw,
      pluginDir: params.pluginDir,
      repoRoot: params.repoRoot,
    });
    const target = resolveBundledSkillTarget(raw);
    if (!fs.existsSync(sourcePath)) {
      // Some Docker/lightweight builds intentionally omit optional plugin-local
      // dependencies. Only advertise skill paths that were actually bundled.
      console.warn(
        `[bundled-plugin-metadata] skipping missing skill path ${sourcePath} (plugin ${params.manifest.id ?? path.basename(params.pluginDir)})`,
      );
      continue;
    }
    const targetPath = ensurePathInsideRoot(params.distPluginDir, target.outputPath);
    const shouldExcludeNestedNodeModules = /^node_modules(?:\/|$)/u.test(
      normalizeManifestRelativePath(raw),
    );
    copySkillPathWithRetry({
      sourcePath,
      targetPath,
      copyOptions: {
        dereference: true,
        force: true,
        recursive: true,
        filter: (candidatePath) => {
          if (!shouldExcludeNestedNodeModules || candidatePath === sourcePath) {
            return true;
          }
          const relativeCandidate = path.relative(sourcePath, candidatePath).replaceAll("\\", "/");
          return !relativeCandidate.split("/").includes("node_modules");
        },
      },
    });
    if (shouldExcludeNestedNodeModules) {
      // Dependency-backed skill bundles can carry upstream branding in docs and
      // metadata files. Rewrite those copied text assets so generated runtime
      // artifacts stay aligned with the repo-wide Alisio brand.
      rewriteBundledSkillBranding(targetPath);
    }
    copiedSkills.push(target.manifestPath);
  }
  return copiedSkills;
}

/**
 * @param {{
 *   cwd?: string;
 *   repoRoot?: string;
 *   env?: NodeJS.ProcessEnv;
 * }} [params]
 */
export function copyBundledPluginMetadata(params = {}) {
  const repoRoot = params.cwd ?? params.repoRoot ?? process.cwd();
  const env = params.env ?? process.env;
  const pluginManifestName = currentPluginManifestName(repoRoot);
  const extensionsRoot = path.join(repoRoot, "extensions");
  const distExtensionsRoot = path.join(repoRoot, "dist", "extensions");
  if (!fs.existsSync(extensionsRoot)) {
    return;
  }

  const sourcePluginDirs = new Set();
  for (const dirent of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const pluginDir = path.join(extensionsRoot, dirent.name);
    const manifestPath = path.join(pluginDir, pluginManifestName);
    const distPluginDir = path.join(distExtensionsRoot, dirent.name);
    const packageJsonPath = path.join(pluginDir, "package.json");
    let packageJson = fs.existsSync(packageJsonPath)
      ? JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
      : undefined;
    if (!shouldBuildBundledCluster(dirent.name, env, { packageJson })) {
      removePathIfExists(distPluginDir);
      continue;
    }

    sourcePluginDirs.add(dirent.name);

    const distManifestPath = path.join(distPluginDir, pluginManifestName);
    const distPackageJsonPath = path.join(distPluginDir, "package.json");
    if (!fs.existsSync(manifestPath)) {
      if (!hasCapabilityOnlyPublicSurfaces(pluginDir)) {
        removePathIfExists(distPluginDir);
        continue;
      }
      if (packageJson) {
        writeTextFileIfChanged(distPackageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
      } else {
        removeFileIfExists(distPackageJsonPath);
      }
      removeFileIfExists(distManifestPath);
      continue;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    // Generated skill assets live under a dedicated dist-owned directory. Also
    // remove the older bad node_modules tree so release packs cannot pick it up.
    removePathIfExists(path.join(distPluginDir, GENERATED_BUNDLED_SKILLS_DIR));
    removePathIfExists(path.join(distPluginDir, "node_modules"));
    const copiedSkills = copyDeclaredPluginSkillPaths({
      manifest,
      pluginDir,
      distPluginDir,
      repoRoot,
    });
    const bundledManifest = Array.isArray(manifest.skills)
      ? { ...manifest, skills: copiedSkills }
      : manifest;
    writeTextFileIfChanged(distManifestPath, `${JSON.stringify(bundledManifest, null, 2)}\n`);

    if (!fs.existsSync(packageJsonPath)) {
      removeFileIfExists(distPackageJsonPath);
      continue;
    }
    const brandConfig = readPackageBrandConfig(packageJson);
    if (brandConfig && "extensions" in brandConfig) {
      packageJson = writePackageBrandConfig(packageJson, {
        ...brandConfig,
        extensions: rewritePackageExtensions(brandConfig.extensions),
        ...(typeof brandConfig.setupEntry === "string"
          ? { setupEntry: rewritePackageEntry(brandConfig.setupEntry) }
          : {}),
      });
    }

    writeTextFileIfChanged(distPackageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  if (!fs.existsSync(distExtensionsRoot)) {
    return;
  }

  for (const dirent of fs.readdirSync(distExtensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory() || sourcePluginDirs.has(dirent.name)) {
      continue;
    }
    const distPluginDir = path.join(distExtensionsRoot, dirent.name);
    removePathIfExists(distPluginDir);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  copyBundledPluginMetadata();
}
