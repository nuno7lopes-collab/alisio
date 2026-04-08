import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetApprovalAuditTrailForTest,
  approvalAuditHandlers,
  listApprovalAuditTrail,
  logExecApprovalRequested,
  logExecApprovalResolved,
  logPluginApprovalRequested,
  logPluginApprovalResolved,
  rememberExecApprovalResolved,
  rememberPluginApprovalResolved,
} from "./approval-audit.js";

afterEach(() => {
  __resetApprovalAuditTrailForTest();
});

describe("approval audit logging", () => {
  it("logs exec approval request and resolution details", () => {
    const info = vi.fn();
    const logger = { info };

    logExecApprovalRequested(logger, {
      id: "approval-1",
      request: {
        command: "uname -a",
        host: "node",
        nodeId: "node-1",
        security: "allowlist",
        ask: "on-miss",
        agentId: "main",
        sessionKey: "agent:main:main",
      },
    });

    logExecApprovalResolved(logger, {
      id: "approval-1",
      request: {
        command: "uname -a",
        host: "node",
        nodeId: "node-1",
      },
      decision: "allow-once",
      resolvedBy: "Operator",
    });

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("approval audit kind=exec phase=requested id=approval-1"),
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining('nodeId="node-1"'));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(
        "approval audit kind=exec phase=resolved id=approval-1 decision=allow-once",
      ),
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining('resolvedBy="Operator"'));
  });

  it("logs plugin approval request and resolution details", () => {
    const info = vi.fn();
    const logger = { info };

    logPluginApprovalRequested(logger, {
      id: "plugin-1",
      request: {
        title: "Sensitive action",
        description: "Changes production data",
        pluginId: "marketplace.sage",
        severity: "warning",
        toolName: "functions.exec_command",
        toolCallId: "call-1",
        agentId: "main",
        sessionKey: "agent:main:main",
        turnSourceChannel: null,
        turnSourceTo: null,
        turnSourceAccountId: null,
        turnSourceThreadId: null,
      },
    });

    logPluginApprovalResolved(logger, {
      id: "plugin-1",
      request: {
        title: "Sensitive action",
        description: "Changes production data",
        pluginId: "marketplace.sage",
        severity: "warning",
        toolName: "functions.exec_command",
        toolCallId: "call-1",
        agentId: "main",
        sessionKey: "agent:main:main",
        turnSourceChannel: null,
        turnSourceTo: null,
        turnSourceAccountId: null,
        turnSourceThreadId: null,
      },
      decision: "deny",
      resolvedBy: "Operator",
    });

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("approval audit kind=plugin phase=requested id=plugin-1"),
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining('pluginId="marketplace.sage"'));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining(
        "approval audit kind=plugin phase=resolved id=plugin-1 decision=deny",
      ),
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining('resolvedBy="Operator"'));
  });

  it("stores recent resolved approvals and exposes them through the gateway handler", () => {
    rememberExecApprovalResolved({
      id: "approval-1",
      request: {
        command: "uname -a",
        commandPreview: "uname -a",
        envKeys: ["A_VAR", "Z_VAR"],
        host: "sandbox",
        security: "allowlist",
        ask: "on-miss",
        cwd: "/workspace",
        resolvedPath: "/workspace/file.txt",
        agentId: "main",
        sessionKey: "agent:main:main",
      },
      decision: "allow-once",
      resolvedBy: "Operator",
      ts: 1000,
    });
    rememberPluginApprovalResolved({
      id: "plugin-1",
      request: {
        title: "Sensitive action",
        description: "Changes production data",
        pluginId: "marketplace.sage",
        severity: "warning",
        toolName: "functions.exec_command",
        toolCallId: "call-1",
        agentId: "main",
        sessionKey: "agent:main:main",
        turnSourceChannel: null,
        turnSourceTo: null,
        turnSourceAccountId: null,
        turnSourceThreadId: null,
      },
      decision: "deny",
      resolvedBy: "Operator",
      ts: 2000,
    });

    expect(listApprovalAuditTrail()).toMatchObject([{ id: "plugin-1" }, { id: "approval-1" }]);

    const respond = vi.fn();
    void approvalAuditHandlers["approval.audit.get"]({
      req: { id: "req-1", type: "req", method: "approval.audit.get" },
      params: {},
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: "plugin-1", kind: "plugin" }),
          expect.objectContaining({ id: "approval-1", kind: "exec" }),
        ]),
      }),
      undefined,
    );
  });
});
