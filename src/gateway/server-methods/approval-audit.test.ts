import { describe, expect, it, vi } from "vitest";
import {
  logExecApprovalRequested,
  logExecApprovalResolved,
  logPluginApprovalRequested,
  logPluginApprovalResolved,
} from "./approval-audit.js";

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
        severity: "high",
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
        severity: "high",
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
});
