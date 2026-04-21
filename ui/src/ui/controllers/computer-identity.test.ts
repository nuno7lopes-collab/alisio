import { describe, expect, it } from "vitest";
import {
  normalizeComputerText,
  resolveComputerGroupKey,
  resolveComputerId,
  resolveComputerLabelText,
  resolveNodeRuntimeComputerId,
} from "./computer-identity.ts";

describe("computer identity helpers", () => {
  it("normalizes optional strings", () => {
    expect(normalizeComputerText("  Studio Mac  ")).toBe("Studio Mac");
    expect(normalizeComputerText(" ")).toBeNull();
    expect(normalizeComputerText(undefined)).toBeNull();
  });

  it("resolves a canonical computer id", () => {
    expect(resolveComputerId({ computerId: "  studio-1 ", fallbackId: "node-1" })).toBe("studio-1");
    expect(resolveComputerId({ fallbackId: "node-1" })).toBe("node-1");
    expect(resolveNodeRuntimeComputerId({ nodeId: "node-1", computerId: " studio-1 " })).toBe(
      "studio-1",
    );
    expect(resolveComputerGroupKey({ computerId: " Studio Mac " })).toBe("studio mac");
  });

  it("resolves the best available computer label", () => {
    expect(
      resolveComputerLabelText({
        computerLabel: "  Studio Mac ",
        displayName: "Node host",
        fallbackLabel: "Fallback",
      }),
    ).toBe("Studio Mac");
    expect(
      resolveComputerLabelText({
        displayName: "Node host",
        fallbackLabel: "Fallback",
      }),
    ).toBe("Node host");
    expect(resolveComputerLabelText({ fallbackLabel: "Fallback" })).toBe("Fallback");
  });
});
