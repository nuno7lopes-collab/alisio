import { describe, expect, it } from "vitest";
import { GENERIC_NODE, createNodeListResponse } from "./program.nodes-test-helpers.js";

describe("program.nodes-test-helpers", () => {
  it("builds a node.list response with a generic node fixture", () => {
    const response = createNodeListResponse(1234);
    expect(response).toEqual({
      ts: 1234,
      nodes: [GENERIC_NODE],
    });
  });
});
