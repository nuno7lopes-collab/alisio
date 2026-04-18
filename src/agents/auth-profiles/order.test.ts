import { describe, expect, it } from "vitest";
import { resolveAuthProfileEligibility, resolveAuthProfileOrder } from "./order.js";
import type { AuthProfileStore } from "./types.js";

describe("resolveAuthProfileOrder", () => {
  it("accepts base-provider credentials for volcengine-plan auth lookup", () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "volcengine:default": {
          type: "api_key",
          provider: "volcengine",
          key: "sk-test",
        },
      },
    };

    const order = resolveAuthProfileOrder({
      store,
      provider: "volcengine-plan",
    });

    expect(order).toEqual(["volcengine:default"]);
  });

  it("rejects token credentials when config mode expects oauth", () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "anthropic:default": {
          type: "token",
          provider: "anthropic",
          token: "tok-test",
        },
      },
    };

    const eligibility = resolveAuthProfileEligibility({
      cfg: {
        auth: {
          profiles: {
            "anthropic:default": {
              provider: "anthropic",
              mode: "oauth",
            },
          },
        },
      },
      store,
      provider: "anthropic",
      profileId: "anthropic:default",
    });

    expect(eligibility).toEqual({
      eligible: false,
      reasonCode: "mode_mismatch",
    });
  });
});
