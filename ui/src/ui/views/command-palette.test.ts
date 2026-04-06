import { describe, expect, it } from "vitest";
import { getPaletteItems } from "./command-palette.ts";

describe("command palette", () => {
  it("only exposes public navigation items besides slash commands", () => {
    const items = getPaletteItems();
    const labels = items.map((item) => item.label);

    expect(labels).toContain("Chat");
    expect(labels).toContain("Channels");
    expect(labels).toContain("Capabilities");
    expect(labels).toContain("Connections");
    expect(labels).toContain("Apps");
    expect(labels).toContain("Organization");
    expect(labels).toContain("Settings");
    expect(items.some((item) => item.category === "skills")).toBe(false);
  });
});
