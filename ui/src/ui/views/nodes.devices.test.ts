/* @vitest-environment jsdom */
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderConnections } from "./connections.ts";
import { renderNodes, type NodesProps } from "./nodes.ts";

function baseProps(overrides: Partial<NodesProps> = {}): NodesProps {
  return {
    assistantName: "Alisio",
    assistantAgentId: "main",
    loading: false,
    nodes: [],
    devicesLoading: false,
    devicesError: null,
    devicesList: {
      pending: [],
      paired: [],
    },
    configForm: null,
    configLoading: false,
    configSaving: false,
    configDirty: false,
    configFormMode: "form",
    execApprovalsLoading: false,
    execApprovalsSaving: false,
    execApprovalsDirty: false,
    execApprovalsSnapshot: null,
    execApprovalsForm: null,
    execApprovalsSelectedAgent: null,
    execApprovalsTarget: "gateway",
    execApprovalsTargetNodeId: null,
    onRefresh: () => undefined,
    onDevicesRefresh: () => undefined,
    onDeviceApprove: () => undefined,
    onDeviceReject: () => undefined,
    onDeviceRotate: () => undefined,
    onDeviceRevoke: () => undefined,
    onLoadConfig: () => undefined,
    onLoadExecApprovals: () => undefined,
    onBindDefault: () => undefined,
    onBindAgent: () => undefined,
    onSaveBindings: () => undefined,
    onExecApprovalsTargetChange: () => undefined,
    onExecApprovalsSelectAgent: () => undefined,
    onExecApprovalsPatch: () => undefined,
    onExecApprovalsRemove: () => undefined,
    onSaveExecApprovals: () => undefined,
    ...overrides,
  };
}

describe("nodes devices pending rendering", () => {
  it("shows pending role and scopes from effective pending auth", () => {
    const container = document.createElement("div");
    render(
      renderNodes(
        baseProps({
          devicesList: {
            pending: [
              {
                requestId: "req-1",
                deviceId: "device-1",
                displayName: "Device One",
                role: "operator",
                scopes: ["operator.admin", "operator.read"],
                ts: Date.now(),
              },
            ],
            paired: [],
          },
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("role: operator");
    expect(text).toContain("scopes: operator.admin, operator.read");
  });

  it("falls back to roles when role is absent", () => {
    const container = document.createElement("div");
    render(
      renderNodes(
        baseProps({
          devicesList: {
            pending: [
              {
                requestId: "req-2",
                deviceId: "device-2",
                roles: ["node", "operator"],
                scopes: ["operator.read"],
                ts: Date.now(),
              },
            ],
            paired: [],
          },
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("role: node, operator");
    expect(text).toContain("scopes: operator.read");
  });

  it("renders a clean split between devices and runtime", () => {
    const container = document.createElement("div");
    render(
      renderConnections(
        baseProps({
          nodes: [
            {
              nodeId: "node-1",
              displayName: "Runner",
              connected: true,
              paired: true,
              commands: ["system.run"],
            },
          ],
          devicesList: {
            pending: [],
            paired: [
              {
                deviceId: "device-1",
                displayName: "Studio Mac",
                roles: ["operator"],
                scopes: ["operator.read"],
                tokens: [],
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".alisio-connections-overview-card")).toHaveLength(2);
    expect(container.querySelectorAll(".alisio-connections-panel")).toHaveLength(2);

    const text = container.textContent ?? "";
    expect(text).toContain("Devices");
    expect(text).toContain("Nodes and execution");
    expect(text).toContain("Execution");
    expect(text).toContain("Nodes");
  });

  it("summarizes node details instead of listing raw capability chips", () => {
    const container = document.createElement("div");
    render(
      renderNodes(
        baseProps({
          nodes: [
            {
              nodeId: "node-1",
              displayName: "Runner",
              connected: true,
              paired: true,
              remoteIp: "10.0.0.8",
              version: "1.2.3",
              commands: ["system.run", "health.ping", "jobs.list"],
              capabilities: [{ title: "filesystem" }, { title: "browser" }],
            },
          ],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("exec ready");
    expect(text).toContain("2 capabilities");
    expect(text).toContain("3 commands");
    expect(text).not.toContain("filesystem");
    expect(text).not.toContain("browser");
  });

  it("uses node labels in execution routing summaries", () => {
    const container = document.createElement("div");
    render(
      renderNodes(
        baseProps({
          nodes: [
            {
              nodeId: "node-1",
              displayName: "Runner",
              connected: true,
              paired: true,
              commands: ["system.run"],
            },
          ],
          configForm: {
            tools: {
              exec: {
                node: "node-1",
              },
            },
            agents: {
              list: [
                {
                  id: "main",
                  default: true,
                },
              ],
            },
          },
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Runner");
    expect(text).toContain("follows default (Runner · node-1)");
  });
});
