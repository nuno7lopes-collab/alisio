import { describe, expect, it } from "vitest";
import {
  EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS,
  listMissingExternalCodePluginFieldPaths,
  normalizeExternalPluginCompatibility,
  validateExternalCodePluginPackageJson,
} from "./index.js";

describe("@openclaw/plugin-package-contract", () => {
  it("normalizes the canonical Alisio compatibility block for external plugins", () => {
    expect(
      normalizeExternalPluginCompatibility({
        version: "1.2.3",
        alisio: {
          compat: {
            pluginApi: ">=2026.3.24-beta.2",
            minGatewayVersion: "2026.3.24-beta.2",
          },
          build: {
            alisioVersion: "2026.3.24-beta.2",
            pluginSdkVersion: "0.9.0",
          },
        },
      }),
    ).toEqual({
      pluginApiRange: ">=2026.3.24-beta.2",
      builtWithOpenClawVersion: "2026.3.24-beta.2",
      pluginSdkVersion: "0.9.0",
      minGatewayVersion: "2026.3.24-beta.2",
    });
  });

  it("falls back to install.minHostVersion and package version when compatible", () => {
    expect(
      normalizeExternalPluginCompatibility({
        version: "1.2.3",
        alisio: {
          compat: {
            pluginApi: ">=1.0.0",
          },
          install: {
            minHostVersion: "2026.3.24-beta.2",
          },
        },
      }),
    ).toEqual({
      pluginApiRange: ">=1.0.0",
      builtWithOpenClawVersion: "1.2.3",
      minGatewayVersion: "2026.3.24-beta.2",
    });
  });

  it("accepts the legacy OpenClaw compatibility block as a fallback", () => {
    expect(
      normalizeExternalPluginCompatibility({
        version: "1.2.3",
        openclaw: {
          compat: {
            pluginApi: ">=2026.3.24-beta.2",
          },
          build: {
            openclawVersion: "2026.3.24-beta.2",
          },
        },
      }),
    ).toEqual({
      pluginApiRange: ">=2026.3.24-beta.2",
      builtWithOpenClawVersion: "2026.3.24-beta.2",
    });
  });

  it("lists the required external code-plugin fields", () => {
    expect(EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS).toEqual([
      "alisio.compat.pluginApi",
      "alisio.build.alisioVersion",
    ]);
  });

  it("reports missing required fields with stable field paths", () => {
    const packageJson = {
      alisio: {
        compat: {},
        build: {},
      },
    };

    expect(listMissingExternalCodePluginFieldPaths(packageJson)).toEqual([
      "alisio.compat.pluginApi",
      "alisio.build.alisioVersion",
    ]);
    expect(validateExternalCodePluginPackageJson(packageJson).issues).toEqual([
      {
        fieldPath: "alisio.compat.pluginApi",
        message:
          "alisio.compat.pluginApi is required for external code plugins published to Local Marketplace.",
      },
      {
        fieldPath: "alisio.build.alisioVersion",
        message:
          "alisio.build.alisioVersion is required for external code plugins published to Local Marketplace.",
      },
    ]);
  });
});
