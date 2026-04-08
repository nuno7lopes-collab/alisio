import { describe, expect, it } from "vitest";
import {
  addExecApprovalAuditEntry,
  parseApprovalAuditEntry,
  parseExecApprovalRequested,
  parsePluginApprovalRequested,
} from "./exec-approval.ts";

describe("parseExecApprovalRequested", () => {
  it("returns entries with kind 'exec'", () => {
    const result = parseExecApprovalRequested({
      id: "exec-1",
      request: {
        command: "rm -rf /",
        commandPreview: "rm -rf /tmp/demo",
        envKeys: ["A_VAR", "Z_VAR"],
        nodeId: "node-1",
      },
      createdAtMs: 1000,
      expiresAtMs: 2000,
    });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("exec");
    expect(result!.request.command).toBe("rm -rf /");
    expect(result!.request.commandPreview).toBe("rm -rf /tmp/demo");
    expect(result!.request.envKeys).toEqual(["A_VAR", "Z_VAR"]);
    expect(result!.request.nodeId).toBe("node-1");
  });
});

describe("parsePluginApprovalRequested", () => {
  // Matches the actual gateway broadcast shape: title/description/severity/pluginId
  // are nested inside payload.request (PluginApprovalRequestPayload)
  const validPayload = {
    id: "plugin-1",
    createdAtMs: 1000,
    expiresAtMs: 120_000,
    request: {
      title: "Dangerous command detected",
      description: "chmod 777 script.sh modifies file permissions",
      severity: "high",
      pluginId: "sage",
      agentId: "agent-1",
      sessionKey: "sess-1",
    },
  };

  it("parses a valid payload", () => {
    const result = parsePluginApprovalRequested(validPayload);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("plugin");
    expect(result!.pluginTitle).toBe("Dangerous command detected");
    expect(result!.pluginDescription).toBe("chmod 777 script.sh modifies file permissions");
    expect(result!.pluginSeverity).toBe("high");
    expect(result!.pluginId).toBe("sage");
    expect(result!.pluginToolName).toBeNull();
    expect(result!.request.command).toBe("Dangerous command detected");
    expect(result!.request.agentId).toBe("agent-1");
    expect(result!.request.sessionKey).toBe("sess-1");
    expect(result!.createdAtMs).toBe(1000);
    expect(result!.expiresAtMs).toBe(120_000);
  });

  it("returns null when title is missing from request", () => {
    const {
      request: { title: _, ...restRequest },
      ...rest
    } = validPayload;
    expect(parsePluginApprovalRequested({ ...rest, request: restRequest })).toBeNull();
  });

  it("returns null when request is missing entirely", () => {
    const { request: _, ...noRequest } = validPayload;
    expect(parsePluginApprovalRequested(noRequest)).toBeNull();
  });

  it("returns null when id is missing", () => {
    const { id: _, ...noId } = validPayload;
    expect(parsePluginApprovalRequested(noId)).toBeNull();
  });

  it("returns null when timestamps are missing", () => {
    const { createdAtMs: _, expiresAtMs: __, ...noTimestamps } = validPayload;
    expect(parsePluginApprovalRequested(noTimestamps)).toBeNull();
  });

  it("returns null for null payload", () => {
    expect(parsePluginApprovalRequested(null)).toBeNull();
  });

  it("returns null for non-object payload", () => {
    expect(parsePluginApprovalRequested("not an object")).toBeNull();
  });

  it("handles missing optional fields gracefully", () => {
    const minimal = {
      id: "plugin-2",
      createdAtMs: 500,
      expiresAtMs: 60_000,
      request: { title: "Alert" },
    };
    const result = parsePluginApprovalRequested(minimal);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("plugin");
    expect(result!.pluginTitle).toBe("Alert");
    expect(result!.pluginDescription).toBeNull();
    expect(result!.pluginSeverity).toBeNull();
    expect(result!.pluginId).toBeNull();
    expect(result!.request.agentId).toBeNull();
    expect(result!.request.sessionKey).toBeNull();
  });
});

describe("parseApprovalAuditEntry", () => {
  it("parses resolved exec approvals into audit entries", () => {
    expect(
      parseApprovalAuditEntry("exec", {
        id: "exec-1",
        decision: "allow-once",
        resolvedBy: "Operator",
        ts: 1234,
        request: {
          command: "uname -a",
          host: "gateway",
          security: "allowlist",
          ask: "on-miss",
        },
      }),
    ).toMatchObject({
      id: "exec-1",
      kind: "exec",
      decision: "allow-once",
      resolvedBy: "Operator",
      request: { command: "uname -a" },
    });
  });

  it("parses resolved plugin approvals into audit entries", () => {
    expect(
      parseApprovalAuditEntry("plugin", {
        id: "plugin-1",
        decision: "deny",
        ts: 4567,
        request: {
          title: "Dangerous action",
          description: "Changes production data",
          severity: "high",
          pluginId: "sage",
        },
      }),
    ).toMatchObject({
      id: "plugin-1",
      kind: "plugin",
      decision: "deny",
      title: "Dangerous action",
      pluginId: "sage",
      pluginSeverity: "high",
    });
  });
});

describe("addExecApprovalAuditEntry", () => {
  it("keeps the newest unique audit entries first", () => {
    expect(
      addExecApprovalAuditEntry(
        [
          {
            id: "old",
            kind: "exec",
            title: "echo old",
            summary: "echo old",
            decision: "allow-once",
            ts: 1,
            request: { command: "echo old" },
          },
        ],
        {
          id: "new",
          kind: "exec",
          title: "echo new",
          summary: "echo new",
          decision: "deny",
          ts: 2,
          request: { command: "echo new" },
        },
      ),
    ).toMatchObject([{ id: "new" }, { id: "old" }]);
  });
});
