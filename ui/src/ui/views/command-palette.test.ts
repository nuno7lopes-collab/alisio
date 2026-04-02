import { describe, expect, it } from "vitest";
import { getPaletteItems } from "./command-palette.ts";

describe("command palette", () => {
  it("only exposes public navigation items besides slash commands", () => {
    const items = getPaletteItems();
    const labels = items.map((item) => item.label);

    expect(labels).toContain("tabs.chat");
    expect(labels).toContain("tabs.authentications");
    expect(labels).toContain("tabs.organization");
    expect(labels).toContain("tabs.settings");
    expect(items.some((item) => item.category === "skills")).toBe(false);
  });
});
