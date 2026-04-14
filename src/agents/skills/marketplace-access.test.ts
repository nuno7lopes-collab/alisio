import { describe, expect, it } from "vitest";
import {
  evaluateSkillMarketplaceAccess,
  resolveEnabledMarketplaceFeatureFlags,
} from "./marketplace-access.js";

describe("marketplace-access", () => {
  it("allows plus-only skills on the free plan while plan distinctions are disabled", () => {
    const access = evaluateSkillMarketplaceAccess({
      subscription: {
        required: true,
        plan: "plus",
      },
      currentPlan: "free",
    });

    expect(access.allowed).toBe(true);
    expect(access.issues).toEqual([]);
  });

  it("allows plus-only skills on the plus plan", () => {
    const access = evaluateSkillMarketplaceAccess({
      subscription: {
        required: true,
        plan: "plus",
      },
      currentPlan: "plus",
    });

    expect(access.allowed).toBe(true);
    expect(access.issues).toEqual([]);
  });

  it("enforces feature flags independently from the plan gate", () => {
    const denied = evaluateSkillMarketplaceAccess({
      subscription: {
        required: true,
        plan: "plus",
        featureFlag: "mcp-beta",
      },
      currentPlan: "plus",
      enabledFeatureFlags: [],
    });
    const allowed = evaluateSkillMarketplaceAccess({
      subscription: {
        required: true,
        plan: "plus",
        featureFlag: "mcp-beta",
      },
      currentPlan: "plus",
      enabledFeatureFlags: ["mcp-beta"],
    });

    expect(denied.allowed).toBe(false);
    expect(denied.issues).toEqual([
      expect.objectContaining({
        code: "feature_flag_required",
      }),
    ]);
    expect(allowed.allowed).toBe(true);
    expect(allowed.issues).toEqual([]);
  });

  it("loads feature flags from env-compatible inputs", () => {
    const flags = resolveEnabledMarketplaceFeatureFlags({
      env: {
        ALISIO_SKILL_FEATURES: "mcp-beta, paid-skills",
        ALISIO_FEATURE_DEEP_RESEARCH: "true",
        ALISIO_FEATURE_LEGACY_BRIDGE: "1",
      } as NodeJS.ProcessEnv,
    });

    expect(Array.from(flags).toSorted()).toEqual([
      "deep-research",
      "legacy-bridge",
      "mcp-beta",
      "paid-skills",
    ]);
  });
});
