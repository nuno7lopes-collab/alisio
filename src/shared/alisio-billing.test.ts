import { describe, expect, it } from "vitest";
import {
  alisioPlanTranslationKey,
  alisioConnectorOccupiesPlanSlot,
  countAlisioConnectorPlanSlots,
  alisioConnectorLimit,
  alisioConnectorUpgradeMessage,
  alisioOrganizationsUpgradeMessage,
  alisioSupportsSharing,
  alisioSupportsOrganizations,
  getAlisioPlanEntitlements,
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

  it("exposes the Free and Plus entitlement matrix", () => {
    expect(getAlisioPlanEntitlements("free")).toEqual({
      connectors: { maxConnected: 1 },
      organizations: false,
      sharing: false,
    });
    expect(getAlisioPlanEntitlements("plus")).toEqual({
      connectors: { maxConnected: null },
      organizations: true,
      sharing: true,
    });
  });

  it("derives plan-specific feature helpers and upgrade copy", () => {
    expect(alisioConnectorLimit("free")).toBe(1);
    expect(alisioConnectorLimit("plus")).toBeNull();
    expect(alisioSupportsOrganizations("free")).toBe(false);
    expect(alisioSupportsOrganizations("plus")).toBe(true);
    expect(alisioSupportsSharing("free")).toBe(false);
    expect(alisioSupportsSharing("plus")).toBe(true);
    expect(alisioConnectorUpgradeMessage("free")).toContain("1 connected app");
    expect(alisioOrganizationsUpgradeMessage()).toContain("Plus");
  });

  it("counts connector slots using connected and reconnect-required authorizations", () => {
    expect(alisioConnectorOccupiesPlanSlot("connected")).toBe(true);
    expect(alisioConnectorOccupiesPlanSlot("needs_reconnect")).toBe(true);
    expect(alisioConnectorOccupiesPlanSlot("not_connected")).toBe(false);
    expect(
      countAlisioConnectorPlanSlots([
        { state: "connected" },
        { state: "needs_reconnect" },
        { state: "not_connected" },
      ]),
    ).toBe(2);
  });
});
