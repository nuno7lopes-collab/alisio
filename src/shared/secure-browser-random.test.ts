import { describe, expect, it } from "vitest";
import { generateSecureBrowserUuid } from "./secure-browser-random.js";

describe("generateSecureBrowserUuid", () => {
  it("uses crypto.randomUUID when available", () => {
    expect(
      generateSecureBrowserUuid({
        randomUUID: () => "browser-random-uuid",
        getRandomValues: () => {
          throw new Error("should not be called");
        },
      }),
    ).toBe("browser-random-uuid");
  });

  it("falls back to crypto.getRandomValues", () => {
    expect(
      generateSecureBrowserUuid({
        getRandomValues: (bytes) => {
          // @ts-expect-error test fixture populates the typed array directly.
          for (let i = 0; i < bytes.length; i += 1) {
            // @ts-expect-error test fixture populates the typed array directly.
            bytes[i] = i;
          }
          return bytes;
        },
      }),
    ).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("throws when secure browser crypto is unavailable", () => {
    expect(() => generateSecureBrowserUuid(null)).toThrow(
      "Secure browser randomness requires the Web Crypto API.",
    );
  });
});
