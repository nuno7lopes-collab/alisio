import { describe, expect, it } from "vitest";
import { validateAlisioBirthdate } from "./alisio-account.js";

describe("validateAlisioBirthdate", () => {
  it("rejects impossible calendar dates", () => {
    expect(validateAlisioBirthdate("2026-02-31")).toBe("Use a real calendar date.");
  });

  it("rejects birthdates in the future", () => {
    expect(validateAlisioBirthdate("2999-01-01")).toBe("Use a birthdate in the past.");
  });

  it("accepts valid past dates", () => {
    expect(validateAlisioBirthdate("1990-06-14")).toBeNull();
  });
});
