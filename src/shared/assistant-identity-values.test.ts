import { describe, expect, it } from "vitest";
import { coerceIdentityValue } from "./assistant-identity-values.js";

describe("shared/assistant-identity-values", () => {
  it("returns undefined for missing or blank values", () => {
    expect(coerceIdentityValue(undefined, 10)).toBeUndefined();
    expect(coerceIdentityValue("   ", 10)).toBeUndefined();
    expect(coerceIdentityValue(42 as unknown as string, 10)).toBeUndefined();
  });

  it("trims values and preserves strings within the limit", () => {
    expect(coerceIdentityValue("  Alisio  ", 20)).toBe("Alisio");
    expect(coerceIdentityValue("  Alisio  ", 8)).toBe("Alisio");
  });

  it("truncates overlong trimmed values at the exact limit", () => {
    expect(coerceIdentityValue("  Alisio Assistant  ", 8)).toBe("Alisio A");
  });

  it("returns an empty string at zero length and slices negative lengths", () => {
    expect(coerceIdentityValue("  Alisio  ", 0)).toBe("");
    expect(coerceIdentityValue("  Alisio  ", -1)).toBe("Alisi");
  });
});
