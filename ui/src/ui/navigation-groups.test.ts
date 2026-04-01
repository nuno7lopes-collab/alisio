import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../test-helpers/storage.ts";

type NavigationModule = typeof import("./navigation.ts");

describe("TAB_GROUPS", () => {
  let navigation: NavigationModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    navigation = await import("./navigation.ts");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not expose unfinished settings slices in the sidebar", () => {
    const settings = navigation.TAB_GROUPS.find((group) => group.label === "settings");
    expect(settings?.tabs).toEqual(["settings"]);
  });

  it("routes every published settings slice", () => {
    expect(navigation.tabFromPath("/communications")).toBe("settings");
    expect(navigation.tabFromPath("/appearance")).toBe("settings");
    expect(navigation.tabFromPath("/automation")).toBe("settings");
    expect(navigation.tabFromPath("/infrastructure")).toBe("settings");
    expect(navigation.tabFromPath("/ai-agents")).toBe("settings");
    expect(navigation.tabFromPath("/config")).toBe("settings");
    expect(navigation.settingsSectionFromPath("/communications")).toBe("communications");
    expect(navigation.settingsSectionFromPath("/appearance")).toBe("appearance");
    expect(navigation.settingsSectionFromPath("/automation")).toBe("automation");
    expect(navigation.settingsSectionFromPath("/infrastructure")).toBe("infrastructure");
    expect(navigation.settingsSectionFromPath("/ai-agents")).toBe("aiAgents");
    expect(navigation.settingsSectionFromPath("/config")).toBe("workspace");
  });
});
