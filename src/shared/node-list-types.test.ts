import { describe, expect, it } from "vitest";
import {
  normalizeNodeComputerText,
  resolveNodeComputerId,
  resolveNodeComputerLabel,
} from "./node-list-types.ts";

describe("node list computer helpers", () => {
  it("normalizes text values", () => {
    expect(normalizeNodeComputerText("  Studio Mac  ")).toBe("Studio Mac");
    expect(normalizeNodeComputerText("   ")).toBeNull();
    expect(normalizeNodeComputerText(null)).toBeNull();
  });

  it("resolves a canonical computer id from node metadata", () => {
    expect(resolveNodeComputerId({ nodeId: "node-1", computerId: "  mac-studio " })).toBe(
      "mac-studio",
    );
    expect(resolveNodeComputerId({ nodeId: "node-1" })).toBe("node-1");
  });

  it("resolves the best available computer label", () => {
    expect(
      resolveNodeComputerLabel({
        nodeId: "node-1",
        computerLabel: "  Studio Mac ",
        displayName: "Node host",
      }),
    ).toBe("Studio Mac");
    expect(
      resolveNodeComputerLabel({
        nodeId: "node-1",
        displayName: "Node host",
      }),
    ).toBe("Node host");
    expect(resolveNodeComputerLabel({ nodeId: "node-1" })).toBe("node-1");
  });
});
