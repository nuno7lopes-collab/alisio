import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_SELECTION,
  parseThemeSelection,
  resolveSystemTheme,
  resolveTheme,
} from "./theme.ts";

describe("resolveTheme", () => {
  it("resolves named theme families when mode is provided", () => {
    expect(resolveTheme("noir", "dark")).toBe("noir-dark");
    expect(resolveTheme("matte", "light")).toBe("matte-light");
  });

  it("uses system preference when mode is system", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(resolveTheme("noir", "system")).toBe("noir-light");
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
  it("falls back to defaults for retired stored aliases and migrates legacy families", () => {
    expect(parseThemeSelection("system", undefined)).toEqual({
      ...DEFAULT_THEME_SELECTION,
    });
    expect(parseThemeSelection("fieldmanual", undefined)).toEqual({
      ...DEFAULT_THEME_SELECTION,
    });
    expect(parseThemeSelection("knot", "dark")).toEqual({
      themeFamily: "noir",
      themeMode: "dark",
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
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
