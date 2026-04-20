import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBundledBrowserPluginFixture } from "../../test/helpers/browser-bundled-plugin-fixture.js";
import type { AlisioConfig } from "../config/config.js";
import { clearPluginDiscoveryCache } from "../plugins/discovery.js";
import { clearPluginLoaderCache } from "../plugins/loader.js";
import { clearPluginManifestRegistryCache } from "../plugins/manifest-registry.js";
import { resetPluginRuntimeStateForTest } from "../plugins/runtime.js";
import { createAlisioTools } from "./alisio-tools.js";

function resetPluginState() {
  clearPluginLoaderCache();
  clearPluginDiscoveryCache();
  clearPluginManifestRegistryCache();
  resetPluginRuntimeStateForTest();
}

describe("createAlisioTools browser plugin integration", () => {
  let bundledFixture: ReturnType<typeof createBundledBrowserPluginFixture> | null = null;

  beforeEach(() => {
    bundledFixture = createBundledBrowserPluginFixture();
    vi.stubEnv("ALISIO_BUNDLED_PLUGINS_DIR", bundledFixture.rootDir);
    resetPluginState();
  });

  afterEach(() => {
    resetPluginState();
    vi.unstubAllEnvs();
    bundledFixture?.cleanup();
    bundledFixture = null;
  });

  it("filters the bundled browser tool out of the agent tool surface", () => {
    const tools = createAlisioTools({
      config: {
        plugins: {
          allow: ["browser"],
        },
      } as AlisioConfig,
    });

    expect(tools.map((tool) => tool.name)).not.toContain("browser");
  });

  it("still omits the browser tool when the bundled browser plugin is explicitly disabled", () => {
    const tools = createAlisioTools({
      config: {
        plugins: {
          allow: ["browser"],
          entries: {
            browser: {
              enabled: false,
            },
          },
        },
      } as AlisioConfig,
    });

    expect(tools.map((tool) => tool.name)).not.toContain("browser");
  });
});
