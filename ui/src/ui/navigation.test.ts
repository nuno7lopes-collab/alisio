import { describe, expect, it } from "vitest";
import {
  TAB_GROUPS,
  iconForTab,
  inferBasePathFromPathname,
  normalizeBasePath,
  normalizePath,
  pathForTab,
  subtitleForTab,
  tabFromPath,
  titleForTab,
  type Tab,
} from "./navigation.ts";

/** All valid tab identifiers derived from TAB_GROUPS */
const ALL_TABS: Tab[] = ["setup", ...(TAB_GROUPS.flatMap((group) => group.tabs) as Tab[])];

describe("iconForTab", () => {
  it("returns a non-empty string for every tab", () => {
    for (const tab of ALL_TABS) {
      const icon = iconForTab(tab);
      expect(icon).toBeTruthy();
      expect(typeof icon).toBe("string");
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  it("returns stable icons for known tabs", () => {
    expect(iconForTab("setup")).toBe("terminal");
    expect(iconForTab("chat")).toBe("messageSquare");
    expect(iconForTab("memory")).toBe("book");
    expect(iconForTab("tasks")).toBe("scrollText");
    expect(iconForTab("models")).toBe("brain");
    expect(iconForTab("channels")).toBe("radio");
    expect(iconForTab("capabilities")).toBe("spark");
    expect(iconForTab("connections")).toBe("monitor");
    expect(iconForTab("security")).toBe("shield");
    expect(iconForTab("authentications")).toBe("link");
    expect(iconForTab("organization")).toBe("barChart");
    expect(iconForTab("settings")).toBe("settings");
  });

  it("returns a fallback icon for unknown tab", () => {
    // TypeScript won't allow this normally, but runtime could receive unexpected values
    const unknownTab = "unknown" as Tab;
    expect(iconForTab(unknownTab)).toBe("messageSquare");
  });
});

describe("titleForTab", () => {
  it("returns a non-empty string for every tab", () => {
    for (const tab of ALL_TABS) {
      const title = titleForTab(tab);
      expect(title).toBeTruthy();
      expect(typeof title).toBe("string");
    }
  });

  it("returns expected titles", () => {
    expect(titleForTab("setup")).toBe("Setup");
    expect(titleForTab("chat")).toBe("Chat");
    expect(titleForTab("memory")).toBe("Memory");
    expect(titleForTab("tasks")).toBe("Tasks");
    expect(titleForTab("models")).toBe("Models");
    expect(titleForTab("channels")).toBe("Channels");
    expect(titleForTab("capabilities")).toBe("Capabilities");
    expect(titleForTab("connections")).toBe("Connections");
    expect(titleForTab("security")).toBe("Security");
    expect(titleForTab("authentications")).toBe("Apps");
    expect(titleForTab("organization")).toBe("Organization");
    expect(titleForTab("settings")).toBe("Settings");
  });
});

describe("subtitleForTab", () => {
  it("returns a string for every tab", () => {
    for (const tab of ALL_TABS) {
      const subtitle = subtitleForTab(tab);
      expect(typeof subtitle).toBe("string");
    }
  });

  it("returns descriptive subtitles", () => {
    expect(subtitleForTab("setup")).toContain("OpenAI");
    expect(subtitleForTab("chat")).toContain("tool");
    expect(subtitleForTab("memory")).toContain("memory");
    expect(subtitleForTab("tasks")).toMatch(/background/i);
    expect(subtitleForTab("models")).toContain("OpenAI");
    expect(subtitleForTab("channels")).toContain("WhatsApp");
    expect(subtitleForTab("capabilities")).toContain("simpler");
    expect(subtitleForTab("connections")).toContain("Devices");
    expect(subtitleForTab("security")).toContain("Approvals");
    expect(subtitleForTab("authentications")).toContain("external apps");
    expect(subtitleForTab("settings")).toContain("General");
  });
});

describe("normalizeBasePath", () => {
  it("returns empty string for falsy input", () => {
    expect(normalizeBasePath("")).toBe("");
  });

  it("adds leading slash if missing", () => {
    expect(normalizeBasePath("ui")).toBe("/ui");
  });

  it("removes trailing slash", () => {
    expect(normalizeBasePath("/ui/")).toBe("/ui");
  });

  it("returns empty string for root path", () => {
    expect(normalizeBasePath("/")).toBe("");
  });

  it("handles nested paths", () => {
    expect(normalizeBasePath("/apps/\u006fpen\u0063law")).toBe("/apps/\u006fpen\u0063law");
  });
});

describe("normalizePath", () => {
  it("returns / for falsy input", () => {
    expect(normalizePath("")).toBe("/");
  });

  it("adds leading slash if missing", () => {
    expect(normalizePath("chat")).toBe("/chat");
  });

  it("removes trailing slash except for root", () => {
    expect(normalizePath("/chat/")).toBe("/chat");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("pathForTab", () => {
  it("returns correct path without base", () => {
    expect(pathForTab("setup")).toBe("/setup");
    expect(pathForTab("chat")).toBe("/chat");
    expect(pathForTab("memory")).toBe("/memory");
    expect(pathForTab("tasks")).toBe("/tasks");
    expect(pathForTab("models")).toBe("/models");
    expect(pathForTab("channels")).toBe("/channels");
    expect(pathForTab("capabilities")).toBe("/capabilities");
    expect(pathForTab("connections")).toBe("/connections");
    expect(pathForTab("security")).toBe("/security");
    expect(pathForTab("authentications")).toBe("/authentications");
    expect(pathForTab("organization")).toBe("/organization");
  });

  it("prepends base path", () => {
    expect(pathForTab("chat", "/ui")).toBe("/ui/chat");
    expect(pathForTab("settings", "/apps/alisio")).toBe("/apps/alisio/settings");
  });
});

describe("tabFromPath", () => {
  it("returns tab for valid path", () => {
    expect(tabFromPath("/setup")).toBe("setup");
    expect(tabFromPath("/chat")).toBe("chat");
    expect(tabFromPath("/memory")).toBe("memory");
    expect(tabFromPath("/tasks")).toBe("tasks");
    expect(tabFromPath("/models")).toBe("models");
    expect(tabFromPath("/channels")).toBe("channels");
    expect(tabFromPath("/capabilities")).toBe("capabilities");
    expect(tabFromPath("/security")).toBe("security");
    expect(tabFromPath("/authentications")).toBe("authentications");
    expect(tabFromPath("/organization")).toBe("organization");
  });

  it("returns setup for root path", () => {
    expect(tabFromPath("/")).toBe("setup");
  });

  it("handles base paths", () => {
    expect(tabFromPath("/ui/chat", "/ui")).toBe("chat");
    expect(tabFromPath("/apps/alisio/settings", "/apps/alisio")).toBe("settings");
  });

  it("returns null for unknown path", () => {
    expect(tabFromPath("/unknown")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(tabFromPath("/CHAT")).toBe("chat");
    expect(tabFromPath("/SETTINGS")).toBe("settings");
  });

  it("rejects retired legacy routes", () => {
    expect(tabFromPath("/overview")).toBeNull();
    expect(tabFromPath("/home")).toBeNull();
    expect(tabFromPath("/sessions")).toBeNull();
    expect(tabFromPath("/cron")).toBeNull();
    expect(tabFromPath("/automations")).toBeNull();
    expect(tabFromPath("/agents")).toBeNull();
    expect(tabFromPath("/skills")).toBeNull();
    expect(tabFromPath("/instances")).toBeNull();
    expect(tabFromPath("/usage")).toBeNull();
    expect(tabFromPath("/config")).toBeNull();
  });
});

describe("inferBasePathFromPathname", () => {
  it("returns empty string for root", () => {
    expect(inferBasePathFromPathname("/")).toBe("");
  });

  it("returns empty string for direct tab path", () => {
    expect(inferBasePathFromPathname("/setup")).toBe("");
    expect(inferBasePathFromPathname("/chat")).toBe("");
    expect(inferBasePathFromPathname("/models")).toBe("");
    expect(inferBasePathFromPathname("/tasks")).toBe("");
    expect(inferBasePathFromPathname("/authentications")).toBe("");
    expect(inferBasePathFromPathname("/settings")).toBe("");
  });

  it("infers base path from nested paths", () => {
    expect(inferBasePathFromPathname("/ui/chat")).toBe("/ui");
    expect(inferBasePathFromPathname("/apps/alisio/settings")).toBe("/apps/alisio");
  });

  it("handles index.html suffix", () => {
    expect(inferBasePathFromPathname("/index.html")).toBe("");
    expect(inferBasePathFromPathname("/ui/index.html")).toBe("/ui");
  });
});

describe("TAB_GROUPS", () => {
  it("contains all expected groups", () => {
    const labels = TAB_GROUPS.map((g) => g.label);
    expect(labels).toEqual(["product"]);
  });

  it("all tabs are unique", () => {
    const allTabs = TAB_GROUPS.flatMap((g) => g.tabs);
    const uniqueTabs = new Set(allTabs);
    expect(uniqueTabs.size).toBe(allTabs.length);
  });
});
