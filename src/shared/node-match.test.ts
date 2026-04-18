import { describe, expect, it } from "vitest";
import { normalizeNodeKey, resolveNodeIdFromCandidates, resolveNodeMatches } from "./node-match.js";

describe("shared/node-match", () => {
  it("normalizes node keys by lowercasing and collapsing separators", () => {
    expect(normalizeNodeKey(" Mac Studio! ")).toBe("mac-studio");
    expect(normalizeNodeKey("---PI__Node---")).toBe("pi-node");
    expect(normalizeNodeKey("###")).toBe("");
  });

  it("matches candidates by node id, remote ip, normalized name, and long prefix", () => {
    const nodes = [
      { nodeId: "mac-abcdef", displayName: "Mac Studio", remoteIp: "100.0.0.1" },
      { nodeId: "pi-456789", displayName: "Raspberry Pi", remoteIp: "100.0.0.2" },
    ];

    expect(resolveNodeMatches(nodes, "mac-abcdef")).toEqual([nodes[0]]);
    expect(resolveNodeMatches(nodes, "100.0.0.2")).toEqual([nodes[1]]);
    expect(resolveNodeMatches(nodes, "mac studio")).toEqual([nodes[0]]);
    expect(resolveNodeMatches(nodes, "  Mac---Studio!! ")).toEqual([nodes[0]]);
    expect(resolveNodeMatches(nodes, "pi-456")).toEqual([nodes[1]]);
    expect(resolveNodeMatches(nodes, "pi")).toEqual([]);
    expect(resolveNodeMatches(nodes, "   ")).toEqual([]);
  });

  it("resolves unique matches and prefers a unique connected node", () => {
    expect(
      resolveNodeIdFromCandidates(
        [
          { nodeId: "mac-old", displayName: "MacBook", connected: false },
          { nodeId: "mac-live", displayName: "MacBook", connected: true },
        ],
        "macbook",
      ),
    ).toBe("mac-live");
  });

  it("prefers the strongest match type before client heuristics", () => {
    expect(
      resolveNodeIdFromCandidates(
        [
          { nodeId: "mac-studio", displayName: "Other Node", connected: false },
          { nodeId: "mac-2", displayName: "Mac Studio", connected: true },
        ],
        "mac-studio",
      ),
    ).toBe("mac-studio");
  });

  it("prefers a unique current Alisio client over an unprefixed duplicate match", () => {
    expect(
      resolveNodeIdFromCandidates(
        [
          {
            nodeId: "legacy-mac",
            displayName: "Peter’s Mac Studio",
            clientId: "custom-macos",
            connected: false,
          },
          {
            nodeId: "current-mac",
            displayName: "Peter’s Mac Studio",
            clientId: "alisio-macos",
            connected: false,
          },
        ],
        "Peter's Mac Studio",
      ),
    ).toBe("current-mac");
  });

  it("falls back to raw ambiguous matches when none of them are connected", () => {
    expect(() =>
      resolveNodeIdFromCandidates(
        [
          { nodeId: "mac-a", displayName: "MacBook", connected: false },
          { nodeId: "mac-b", displayName: "MacBook", connected: false },
        ],
        "macbook",
      ),
    ).toThrow(/ambiguous node: macbook.*node=mac-a.*node=mac-b/);
  });

  it("throws clear unknown and ambiguous node errors", () => {
    expect(() =>
      resolveNodeIdFromCandidates(
        [
          { nodeId: "mac-123", displayName: "Mac Studio", remoteIp: "100.0.0.1" },
          { nodeId: "pi-456" },
        ],
        "nope",
      ),
    ).toThrow(/unknown node: nope.*known: Mac Studio, pi-456/);

    expect(() =>
      resolveNodeIdFromCandidates(
        [
          { nodeId: "mac-a", displayName: "MacBook", connected: true },
          { nodeId: "mac-b", displayName: "MacBook", connected: true },
        ],
        "macbook",
      ),
    ).toThrow(/ambiguous node: macbook.*node=mac-a.*node=mac-b/);

    expect(() => resolveNodeIdFromCandidates([], "")).toThrow(/node required/);
  });

  it("prints client ids in ambiguous-node errors when available", () => {
    expect(() =>
      resolveNodeIdFromCandidates(
        [
          {
            nodeId: "legacy-mac",
            displayName: "Peter’s Mac Studio",
            clientId: "custom-macos",
            connected: true,
          },
          {
            nodeId: "other-mac",
            displayName: "Peter’s Mac Studio",
            clientId: "alisio-macos",
            connected: true,
          },
          {
            nodeId: "third-mac",
            displayName: "Peter’s Mac Studio",
            clientId: "alisio-macos",
            connected: true,
          },
        ],
        "Peter's Mac Studio",
      ),
    ).toThrow(
      /ambiguous node: Peter's Mac Studio.*node=other-mac.*client=alisio-macos.*node=third-mac.*client=alisio-macos/,
    );
  });

  it("lists remote ips in unknown-node errors when display names are missing", () => {
    expect(() =>
      resolveNodeIdFromCandidates(
        [{ nodeId: "mac-123", remoteIp: "100.0.0.1" }, { nodeId: "pi-456" }],
        "nope",
      ),
    ).toThrow(/unknown node: nope.*known: 100.0.0.1, pi-456/);
  });
});
