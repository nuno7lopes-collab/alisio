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
  it("maps legacy stored values onto theme + mode", () => {
    expect(parseThemeSelection("system", undefined)).toEqual({
      theme: "claw",
      mode: "system",
    });
    expect(parseThemeSelection("fieldmanual", undefined)).toEqual({
      theme: "dash",
      mode: "dark",
    });
  });
});

describe("theme bootstrap", () => {
  it("keeps the inline first-paint legacy aliases aligned with the runtime parser", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

    for (const alias of ["defaultTheme", "docsTheme", "lightTheme", "landingTheme", "newTheme"]) {
      expect(html).toContain(`${alias}:`);
    }
    expect(html).toContain("document.documentElement.style.colorScheme");
  });
});
