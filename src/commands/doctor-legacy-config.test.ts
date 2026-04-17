import { describe, expect, it } from "vitest";
import { normalizeCompatibilityConfigValues } from "./doctor-legacy-config.js";

describe("normalizeCompatibilityConfigValues preview streaming aliases", () => {
  it("does not rewrite removed telegram streaming aliases", () => {
    const res = normalizeCompatibilityConfigValues({
      channels: {
        telegram: {
          streamMode: "off",
        },
      },
    } as never);

    expect(res.config.channels?.telegram).toEqual({ streamMode: "off" });
    expect(res.changes).toEqual([]);
  });

  it("does not rewrite removed discord/slack streaming aliases", () => {
    const res = normalizeCompatibilityConfigValues({
      channels: {
        discord: { streaming: true },
        slack: { streamMode: "status_final", streaming: false },
      },
    } as never);

    expect(res.config.channels?.discord).toEqual({ streaming: true });
    expect(res.config.channels?.slack).toEqual({
      streamMode: "status_final",
      streaming: false,
    });
    expect(res.changes).toEqual([]);
  });
});
