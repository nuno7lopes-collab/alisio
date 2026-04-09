import { describe, expect, it } from "vitest";
import { listGatewayMethods } from "./server-methods-list.js";

describe("gateway public method list", () => {
  it("hides legacy connector compatibility methods", () => {
    const methods = listGatewayMethods();
    expect(methods).not.toContain("alisio.connectors.catalog");
    expect(methods).not.toContain("alisio.connectors.list");
    expect(methods).not.toContain("alisio.connectors.begin");
    expect(methods).not.toContain("alisio.connectors.complete");
    expect(methods).not.toContain("alisio.connectors.revoke");
  });
});
