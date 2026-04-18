import { describe, expect, it, vi } from "vitest";
import { formatAuthDoctorHint } from "./auth-profiles/doctor.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";

vi.mock("../plugins/provider-runtime.runtime.js", () => ({
  buildProviderAuthDoctorHintWithPlugin: async () => "",
}));

const EMPTY_STORE: AuthProfileStore = {
  version: 1,
  profiles: {},
};

describe("formatAuthDoctorHint", () => {
  it("returns an empty hint when no plugin-specific hint exists", async () => {
    const hint = await formatAuthDoctorHint({
      store: EMPTY_STORE,
      provider: "qwen-portal",
    });

    expect(hint).toBe("");
  });
});
