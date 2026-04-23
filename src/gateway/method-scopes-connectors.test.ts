import { describe, expect, it } from "vitest";
import {
  authorizeOperatorScopesForMethod,
  resolveLeastPrivilegeOperatorScopesForMethod,
} from "./method-scopes.js";
import { listGatewayMethods } from "./server-methods-list.js";

describe("connector gateway method scopes", () => {
  it("keeps connectors.begin on operator.write and removes connectors.complete", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("connectors.begin")).toEqual([
      "operator.write",
    ]);
    expect(resolveLeastPrivilegeOperatorScopesForMethod("connectors.complete")).toEqual([]);
    expect(authorizeOperatorScopesForMethod("connectors.begin", ["operator.write"])).toEqual({
      allowed: true,
    });
  });

  it("does not expose the retired connectors.complete method", () => {
    const methods = listGatewayMethods();
    expect(methods).toContain("connectors.begin");
    expect(methods).toContain("connectors.revoke");
    expect(methods).not.toContain("connectors.complete");
    expect(methods).not.toContain("alisio.connectors.complete");
  });
});
