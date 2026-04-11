import { describe, expect, it } from "vitest";
import { listGatewayMethods } from "./server-methods-list.js";

describe("gateway public method list", () => {
  it("lists canonical connector methods and hides retired aliases", () => {
    const methods = listGatewayMethods();
    expect(methods).toContain("connectors.catalog");
    expect(methods).toContain("connectors.list");
    expect(methods).toContain("connectors.begin");
    expect(methods).toContain("connectors.complete");
    expect(methods).toContain("connectors.revoke");
    expect(methods).not.toContain("alisio.connectors.catalog");
    expect(methods).not.toContain("alisio.connectors.list");
    expect(methods).not.toContain("alisio.connectors.begin");
    expect(methods).not.toContain("alisio.connectors.complete");
    expect(methods).not.toContain("alisio.connectors.revoke");
    expect(methods).not.toContain("alisio.sharing.get");
    expect(methods).not.toContain("alisio.sharing.request");
  });
});
