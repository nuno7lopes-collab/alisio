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

  it("keeps legacy routes on public destinations", () => {
    expect(navigation.tabFromPath("/home")).toBe("chat");
    expect(navigation.tabFromPath("/sessions")).toBe("chat");
    expect(navigation.tabFromPath("/cron")).toBe("chat");
    expect(navigation.tabFromPath("/automations")).toBe("chat");
    expect(navigation.tabFromPath("/agents")).toBe("chat");
    expect(navigation.tabFromPath("/skills")).toBe("capabilities");
    expect(navigation.tabFromPath("/channels")).toBe("channels");
  });

  it("routes every published settings slice", () => {
    expect(navigation.tabFromPath("/communications")).toBe("settings");
    expect(navigation.tabFromPath("/appearance")).toBe("settings");
    expect(navigation.tabFromPath("/automation")).toBe("settings");
    expect(navigation.tabFromPath("/infrastructure")).toBe("settings");
    expect(navigation.tabFromPath("/ai-agents")).toBe("models");
    expect(navigation.tabFromPath("/config")).toBe("settings");
    expect(navigation.settingsSectionFromPath("/communications")).toBe("support");
    expect(navigation.settingsSectionFromPath("/appearance")).toBe("general");
    expect(navigation.settingsSectionFromPath("/automation")).toBe("account");
    expect(navigation.settingsSectionFromPath("/infrastructure")).toBe("mac");
    expect(navigation.settingsSectionFromPath("/ai-agents")).toBeNull();
    expect(navigation.settingsSectionFromPath("/config")).toBe("account");
    expect(navigation.normalizeSettingsSection("billing")).toBe("billing");
    expect(navigation.normalizeSettingsSection("ai")).toBe("general");
  });
});
