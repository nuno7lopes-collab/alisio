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
    const product = navigation.TAB_GROUPS.find((group) => group.label === "product");
    expect(product?.tabs).toEqual([
      "chat",
      "memory",
      "tasks",
      "models",
      "channels",
      "authentications",
      "capabilities",
      "connections",
      "organization",
      "settings",
    ]);
  });

  it("keeps setup routable without promoting it into the sidebar", () => {
    expect(navigation.pathForTab("setup")).toBe("/setup");
    expect(navigation.tabFromPath("/")).toBe("setup");
    expect(navigation.tabFromPath("/setup")).toBe("setup");
    const allTabs = navigation.TAB_GROUPS.flatMap((group) => [...group.tabs]);
    expect(allTabs).not.toContain("setup");
  });

  it("keeps security routable even after removing it from the primary sidebar", () => {
    const allTabs = navigation.TAB_GROUPS.flatMap((group) => [...group.tabs]);
    expect(allTabs).not.toContain("security");
    expect(navigation.pathForTab("security")).toBe("/security");
    expect(navigation.tabFromPath("/security")).toBe("security");
  });

  it("rejects retired route aliases", () => {
    expect(navigation.tabFromPath("/home")).toBeNull();
    expect(navigation.tabFromPath("/sessions")).toBeNull();
    expect(navigation.tabFromPath("/cron")).toBeNull();
    expect(navigation.tabFromPath("/automations")).toBeNull();
    expect(navigation.tabFromPath("/agents")).toBeNull();
    expect(navigation.tabFromPath("/skills")).toBeNull();
  });

  it("keeps settings section fallback query-driven only", () => {
    expect(navigation.tabFromPath("/communications")).toBeNull();
    expect(navigation.tabFromPath("/appearance")).toBeNull();
    expect(navigation.tabFromPath("/automation")).toBeNull();
    expect(navigation.tabFromPath("/infrastructure")).toBeNull();
    expect(navigation.tabFromPath("/ai-agents")).toBeNull();
    expect(navigation.tabFromPath("/config")).toBeNull();
    expect(navigation.settingsSectionFromPath("/communications")).toBeNull();
    expect(navigation.settingsSectionFromPath("/appearance")).toBeNull();
    expect(navigation.settingsSectionFromPath("/automation")).toBeNull();
    expect(navigation.settingsSectionFromPath("/infrastructure")).toBeNull();
    expect(navigation.settingsSectionFromPath("/ai-agents")).toBeNull();
    expect(navigation.settingsSectionFromPath("/config")).toBeNull();
    expect(navigation.normalizeSettingsSection("billing")).toBe("billing");
    expect(navigation.normalizeSettingsSection("ai")).toBe("general");
  });
});
