import { describe, expect, it } from "vitest";
import {
  alisioPlanTranslationKey,
  isAlisioPaidPlan,
  isAlisioPlan,
  normalizeAlisioPlan,
} from "./alisio-billing.js";

describe("alisio-billing", () => {
  it("normalizes legacy and canonical plan labels", () => {
    expect(normalizeAlisioPlan("Free Plan")).toBe("free");
    expect(normalizeAlisioPlan("free")).toBe("free");
    expect(normalizeAlisioPlan("Plus Plan")).toBe("plus");
    expect(normalizeAlisioPlan("plus")).toBe("plus");
    expect(normalizeAlisioPlan("unknown")).toBe("free");
  });

  it("recognizes canonical plan ids only", () => {
    expect(isAlisioPlan("free")).toBe(true);
    expect(isAlisioPlan("plus")).toBe(true);
    expect(isAlisioPlan("Free Plan")).toBe(false);
  });

  it("detects paid plans explicitly", () => {
    expect(isAlisioPaidPlan("free")).toBe(false);
    expect(isAlisioPaidPlan("plus")).toBe(true);
  });

  it("maps plans to billing translation keys", () => {
    expect(alisioPlanTranslationKey("free")).toBe("alisio.settings.billing.freePlan");
    expect(alisioPlanTranslationKey("plus")).toBe("alisio.settings.billing.plusPlan");
  });
});
