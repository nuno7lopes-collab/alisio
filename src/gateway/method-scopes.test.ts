import { afterEach, describe, expect, it } from "vitest";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import {
  authorizeOperatorScopesForMethod,
  isGatewayMethodClassified,
  resolveLeastPrivilegeOperatorScopesForMethod,
} from "./method-scopes.js";
import { listGatewayMethods } from "./server-methods-list.js";
import { coreGatewayHandlers } from "./server-methods.js";

afterEach(() => {
  setActivePluginRegistry(createEmptyPluginRegistry());
});

describe("method scope resolution", () => {
  it.each([
    ["approval.audit.get", ["operator.approvals"]],
    ["approval.pending.get", ["operator.approvals"]],
    ["sessions.resolve", ["operator.read"]],
    ["config.schema.lookup", ["operator.read"]],
    ["sessions.create", ["operator.write"]],
    ["sessions.send", ["operator.write"]],
    ["sessions.abort", ["operator.write"]],
    ["sessions.messages.subscribe", ["operator.read"]],
    ["sessions.messages.unsubscribe", ["operator.read"]],
    ["node.pair.approve", ["operator.write"]],
    ["poll", ["operator.write"]],
    ["alisio.account.completeEmailLinkAuth", ["operator.write"]],
    ["alisio.account.changeEmail", ["operator.write"]],
    ["alisio.account.requestRecoveryEmail", ["operator.write"]],
    ["alisio.account.updatePassword", ["operator.write"]],
    ["alisio.account.signUp", ["operator.write"]],
    ["alisio.account.signIn", ["operator.write"]],
    ["alisio.sharing.request", ["operator.write"]],
    ["alisio.models.runtime.start", ["operator.write"]],
    ["alisio.models.uninstall", ["operator.write"]],
    ["alisio.security.policy.get", ["operator.admin"]],
    ["alisio.security.policy.applyProfile", ["operator.admin"]],
    ["alisio.runtime.restart", ["operator.admin"]],
    ["config.patch", ["operator.admin"]],
    ["wizard.start", ["operator.admin"]],
    ["update.run", ["operator.admin"]],
  ])("resolves least-privilege scopes for %s", (method, expected) => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod(method)).toEqual(expected);
  });

  it("leaves node-only pending drain outside operator scopes", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("node.pending.drain")).toEqual([]);
  });

  it("returns empty scopes for unknown methods", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("totally.unknown.method")).toEqual([]);
  });

  it("reads plugin-registered gateway method scopes from the active plugin registry", () => {
    const registry = createEmptyPluginRegistry();
    registry.gatewayMethodScopes = {
      "browser.request": "operator.write",
    };
    setActivePluginRegistry(registry);

    expect(resolveLeastPrivilegeOperatorScopesForMethod("browser.request")).toEqual([
      "operator.write",
    ]);
  });
});

describe("operator scope authorization", () => {
  it.each([
    ["health", ["operator.read"], { allowed: true }],
    ["health", ["operator.write"], { allowed: true }],
    ["alisio.bootstrap.get", ["operator.read"], { allowed: true }],
    ["alisio.models.get", ["operator.read"], { allowed: true }],
    ["alisio.sharing.get", ["operator.read"], { allowed: true }],
    ["alisio.doctor.summary", ["operator.read"], { allowed: true }],
    ["alisio.runtime.restart", ["operator.admin"], { allowed: true }],
    ["config.schema.lookup", ["operator.read"], { allowed: true }],
    ["alisio.models.install", ["operator.write"], { allowed: true }],
    ["alisio.models.uninstall", ["operator.write"], { allowed: true }],
    ["alisio.models.runtime.start", ["operator.write"], { allowed: true }],
    ["alisio.account.completeEmailLinkAuth", ["operator.write"], { allowed: true }],
    ["alisio.account.changeEmail", ["operator.write"], { allowed: true }],
    ["alisio.account.signUp", ["operator.write"], { allowed: true }],
    ["alisio.account.signIn", ["operator.write"], { allowed: true }],
    ["alisio.account.updatePassword", ["operator.write"], { allowed: true }],
    ["alisio.security.policy.get", ["operator.admin"], { allowed: true }],
    ["alisio.security.policy.applyProfile", ["operator.admin"], { allowed: true }],
    ["alisio.sharing.approve", ["operator.write"], { allowed: true }],
    ["alisio.sharing.reject", ["operator.write"], { allowed: true }],
    ["alisio.sharing.revoke", ["operator.write"], { allowed: true }],
    ["alisio.sharing.policy.set", ["operator.write"], { allowed: true }],
    ["config.patch", ["operator.admin"], { allowed: true }],
  ])("authorizes %s for scopes %j", (method, scopes, expected) => {
    expect(authorizeOperatorScopesForMethod(method, scopes)).toEqual(expected);
  });

  it("requires operator.write for write methods", () => {
    expect(authorizeOperatorScopesForMethod("send", ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.write",
    });
    expect(authorizeOperatorScopesForMethod("node.pair.approve", ["operator.pairing"])).toEqual({
      allowed: false,
      missingScope: "operator.write",
    });
  });

  it("requires approvals scope for approval methods", () => {
    expect(authorizeOperatorScopesForMethod("approval.audit.get", ["operator.write"])).toEqual({
      allowed: false,
      missingScope: "operator.approvals",
    });
    expect(authorizeOperatorScopesForMethod("approval.pending.get", ["operator.write"])).toEqual({
      allowed: false,
      missingScope: "operator.approvals",
    });
    expect(authorizeOperatorScopesForMethod("exec.approval.resolve", ["operator.write"])).toEqual({
      allowed: false,
      missingScope: "operator.approvals",
    });
  });

  it.each(["plugin.approval.request", "plugin.approval.waitDecision", "plugin.approval.resolve"])(
    "requires approvals scope for %s",
    (method) => {
      expect(authorizeOperatorScopesForMethod(method, ["operator.write"])).toEqual({
        allowed: false,
        missingScope: "operator.approvals",
      });
      expect(authorizeOperatorScopesForMethod(method, ["operator.approvals"])).toEqual({
        allowed: true,
      });
    },
  );

  it("requires admin for unknown methods", () => {
    expect(authorizeOperatorScopesForMethod("unknown.method", ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.admin",
    });
  });
});

describe("plugin approval method registration", () => {
  it("lists all plugin approval methods", () => {
    const methods = listGatewayMethods();
    expect(methods).toContain("approval.audit.get");
    expect(methods).toContain("approval.pending.get");
    expect(methods).toContain("alisio.security.policy.get");
    expect(methods).toContain("alisio.security.policy.applyProfile");
    expect(methods).toContain("plugin.approval.request");
    expect(methods).toContain("plugin.approval.waitDecision");
    expect(methods).toContain("plugin.approval.resolve");
  });

  it("lists the public recovery-email method and hides the legacy password-reset alias", () => {
    const methods = listGatewayMethods();
    expect(methods).toContain("alisio.account.completeEmailLinkAuth");
    expect(methods).toContain("alisio.account.changeEmail");
    expect(methods).toContain("alisio.account.requestRecoveryEmail");
    expect(methods).toContain("alisio.account.signUp");
    expect(methods).toContain("alisio.account.signIn");
    expect(methods).toContain("alisio.account.updatePassword");
    expect(methods).not.toContain("alisio.account.requestPasswordReset");
  });

  it("lists the sharing methods", () => {
    const methods = listGatewayMethods();
    expect(methods).toContain("alisio.sharing.get");
    expect(methods).toContain("alisio.sharing.request");
    expect(methods).toContain("alisio.sharing.approve");
    expect(methods).toContain("alisio.sharing.reject");
    expect(methods).toContain("alisio.sharing.revoke");
    expect(methods).toContain("alisio.sharing.policy.set");
  });

  it("classifies plugin approval methods", () => {
    expect(isGatewayMethodClassified("approval.audit.get")).toBe(true);
    expect(isGatewayMethodClassified("approval.pending.get")).toBe(true);
    expect(isGatewayMethodClassified("plugin.approval.request")).toBe(true);
    expect(isGatewayMethodClassified("plugin.approval.waitDecision")).toBe(true);
    expect(isGatewayMethodClassified("plugin.approval.resolve")).toBe(true);
  });
});

describe("core gateway method classification", () => {
  it("treats node-role methods as classified even without operator scopes", () => {
    expect(isGatewayMethodClassified("node.pending.drain")).toBe(true);
    expect(isGatewayMethodClassified("node.pending.pull")).toBe(true);
  });

  it("classifies every exposed core gateway handler method", () => {
    const unclassified = Object.keys(coreGatewayHandlers).filter(
      (method) => !isGatewayMethodClassified(method),
    );
    expect(unclassified).toEqual([]);
  });

  it("classifies every listed gateway method name", () => {
    const unclassified = listGatewayMethods().filter(
      (method) => !isGatewayMethodClassified(method),
    );
    expect(unclassified).toEqual([]);
  });
});
