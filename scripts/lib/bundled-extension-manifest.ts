import { validateMinHostVersion } from "../../src/plugins/min-host-version.ts";
import { packageBrandConfigKey, readPackageBrandConfig } from "./alisio-branding.mjs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type ExtensionPackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  alisio?: {
    install?: unknown;
    releaseChecks?: unknown;
  };
};

export type BundledExtension = { id: string; packageJson: ExtensionPackageJson };

export function collectBundledExtensionManifestErrors(extensions: BundledExtension[]): string[] {
  const errors: string[] = [];

  for (const extension of extensions) {
    const install = readPackageBrandConfig(extension.packageJson)?.install;
    const brandKey = packageBrandConfigKey(extension.packageJson);
    if (install !== undefined && !isRecord(install)) {
      errors.push(
        `bundled extension '${extension.id}' manifest invalid | ${brandKey}.install must be an object`,
      );
      continue;
    }
    const hasNpmSpec = isRecord(install) && "npmSpec" in install;
    if (
      hasNpmSpec &&
      (!install.npmSpec || typeof install.npmSpec !== "string" || !install.npmSpec.trim())
    ) {
      errors.push(
        `bundled extension '${extension.id}' manifest invalid | ${brandKey}.install.npmSpec must be a non-empty string`,
      );
    }
    const minHostVersionError = validateMinHostVersion(install?.minHostVersion);
    if (minHostVersionError) {
      errors.push(`bundled extension '${extension.id}' manifest invalid | ${minHostVersionError}`);
    }
  }

  return errors;
}
