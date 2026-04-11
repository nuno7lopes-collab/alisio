import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseThemeSelection, resolveSystemTheme, resolveTheme } from "./theme.ts";

describe("resolveTheme", () => {
  it("resolves named theme families when mode is provided", () => {
    expect(resolveTheme("knot", "dark")).toBe("openknot");
    expect(resolveTheme("dash", "light")).toBe("dash-light");
  });

  it("uses system preference when mode is system", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(resolveTheme("knot", "system")).toBe("openknot-light");
    vi.unstubAllGlobals();
  });
});

describe("resolveSystemTheme", () => {
  it("mirrors the active preferred color scheme", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(resolveSystemTheme()).toBe("light");
    vi.unstubAllGlobals();
  });
});

describe("parseThemeSelection", () => {
  it("falls back to defaults for retired stored aliases", () => {
    expect(parseThemeSelection("system", undefined)).toEqual({
      theme: "claw",
      mode: "system",
    });
    expect(parseThemeSelection("fieldmanual", undefined)).toEqual({
      theme: "claw",
      mode: "system",
    });
  });
});

describe("theme bootstrap", () => {
  it("uses only canonical theme names during first paint", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

    expect(html).not.toContain("defaultTheme:");
    expect(html).not.toContain("fieldmanual:");
    expect(html).toContain("document.documentElement.style.colorScheme");
  });
});
