import { describe, expect, it } from "vitest";
import {
  LEGACY_CANVAS_HANDLER_NAMES,
  LEGACY_MACOS_APP_SOURCES_DIRS,
  LEGACY_MANIFEST_KEYS,
  LEGACY_PLUGIN_MANIFEST_FILENAMES,
  LEGACY_PROJECT_NAMES,
  MACOS_APP_SOURCES_DIR,
  MANIFEST_KEY,
  PROJECT_NAME,
} from "./legacy-names.js";

describe("legacy-names", () => {
  it("keeps alisio as the canonical project name", () => {
    expect(PROJECT_NAME).toBe("alisio");
    expect(MANIFEST_KEY).toBe("alisio");
    expect(MACOS_APP_SOURCES_DIR).toBe("apps/macos/Sources/Alisio");
  });

  it("tracks openclaw as a legacy compatibility alias", () => {
    expect(LEGACY_PROJECT_NAMES).toContain("openclaw");
    expect(LEGACY_MANIFEST_KEYS).toContain("openclaw");
    expect(LEGACY_PLUGIN_MANIFEST_FILENAMES).toContain("openclaw.plugin.json");
    expect(LEGACY_CANVAS_HANDLER_NAMES).toContain("openclaw");
    expect(LEGACY_MACOS_APP_SOURCES_DIRS).toContain("apps/macos/Sources/OpenClaw");
  });
});
