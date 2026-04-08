import { describe, expect, it } from "vitest";
import { normalizePackageTagInput } from "./package-tag.js";

describe("normalizePackageTagInput", () => {
  const packageNames = ["alisio", "@alisio/plugin"] as const;

  it.each([
    { input: undefined, expected: null },
    { input: "   ", expected: null },
    { input: "alisio@beta", expected: "beta" },
    { input: "@alisio/plugin@2026.2.24", expected: "2026.2.24" },
    { input: "alisio@   ", expected: null },
    { input: "alisio", expected: null },
    { input: " @alisio/plugin ", expected: null },
    { input: " latest ", expected: "latest" },
    { input: "@other/plugin@beta", expected: "@other/plugin@beta" },
    { input: "alisioer@beta", expected: "alisioer@beta" },
  ] satisfies ReadonlyArray<{ input: string | undefined; expected: string | null }>)(
    "normalizes %j",
    ({ input, expected }) => {
      expect(normalizePackageTagInput(input, packageNames)).toBe(expected);
    },
  );
});
