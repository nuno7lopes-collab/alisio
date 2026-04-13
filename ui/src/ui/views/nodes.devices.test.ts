/* @vitest-environment jsdom */
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderConnections } from "./connections.ts";
import { renderNodes, type NodesProps } from "./nodes.ts";

function baseProps(overrides: Partial<NodesProps> = {}): NodesProps {
  const base: NodesProps = {
    assistantName: "Alisio",
    assistantAgentId: "main",
    loading: false,
    nodes: [],
    nodesError: null,
    devicesLoading: false,
    devicesError: null,
    devicesList: {
      pending: [],
      paired: [],
    },
    nodePairingsLoading: false,
    nodePairingsError: null,
    nodePairingsList: {
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
    onNodePairingsRefresh: () => undefined,
    onDeviceApprove: () => undefined,
    onDeviceReject: () => undefined,
    onDeviceRemove: () => undefined,
    onNodeApprove: () => undefined,
    onNodeReject: () => undefined,
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
    onSharingSetResourcePolicy: () => undefined,
  };
  return { ...base, ...overrides };
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
          nodePairingsList: {
            pending: [],
            paired: [],
          },
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".alisio-connections-overview-card")).toHaveLength(2);
    expect(container.querySelectorAll(".alisio-connections-panel")).toHaveLength(2);

    const text = container.textContent ?? "";
    expect(text).toContain("Devices");
    expect(text).toContain("Alisio nodes and execution");
    expect(text).toContain("Execution");
    expect(text).toContain("Alisio nodes");
    expect(text).toContain("Node requests");
  });

  it("lets the operator remove a linked device from the paired list", () => {
    const onDeviceRemove = vi.fn();
    const container = document.createElement("div");

    render(
      renderNodes(
        baseProps({
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
          onDeviceRemove,
        }),
      ),
      container,
    );

    const removeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Remove device"),
    );
    expect(removeButton).toBeDefined();

    removeButton?.click();

    expect(onDeviceRemove).toHaveBeenCalledWith("device-1");
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

  it("uses the shared live-node heuristic when a node reports online without connected", () => {
    const container = document.createElement("div");
    render(
      renderNodes(
        baseProps({
          nodes: [
            {
              nodeId: "node-1",
              displayName: "Runner",
              online: true,
              paired: true,
              commands: ["system.run"],
            },
          ],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("connected");
    expect(text).not.toContain("offline");
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

  it("shows loading skeletons instead of empty counters during the first load", () => {
    const container = document.createElement("div");

    render(
      renderConnections(
        baseProps({
          loading: true,
          devicesLoading: true,
          devicesList: null,
          nodePairingsLoading: true,
          nodePairingsList: null,
          nodes: [],
          configForm: null,
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".loading-state__stat-card").length).toBeGreaterThan(1);
    expect(container.querySelectorAll(".loading-state__list-item").length).toBeGreaterThan(1);
  });

  it("renders pending node approvals with approve and reject actions", () => {
    const container = document.createElement("div");

    render(
      renderConnections(
        baseProps({
          nodePairingsList: {
            pending: [
              {
                requestId: "node-req-1",
                nodeId: "node-1",
                displayName: "Runner",
                platform: "darwin",
                version: "1.2.3",
                commands: ["system.run"],
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
    expect(text).toContain("Node requests");
    expect(text).toContain("Runner");
    expect(text).toContain("1 commands");
    expect(text).toContain("Approve");
    expect(text).toContain("Reject");
  });

  it("renders sharing controls with scope-aware request actions", () => {
    const onSharingRequest = vi.fn();
    const onSharingApprove = vi.fn();
    const onSharingRevoke = vi.fn();
    const container = document.createElement("div");

    render(
      renderConnections(
        baseProps({
          sharing: {
            viewer: {
              ownerKey: "user:1",
              ownerScope: "user",
              label: "Nuno",
            },
            planSupported: true,
            policy: {
              allowExternalUse: false,
              editable: false,
            },
            devices: {
              owned: [],
              sharedWithMe: [
                {
                  targetId: "remote-2",
                  label: "Render Box",
                  sourceKind: "node",
                  connected: true,
                  current: false,
                  ownerKey: "user:3",
                  ownerScope: "user",
                  ownerLabel: "Office",
                  registeredAt: new Date(0).toISOString(),
                  updatedAt: new Date(0).toISOString(),
                  deviceAccess: "shared",
                  modelAccess: "shared",
                  execAccess: "blocked",
                  grantId: "grant-1",
                  grantScopes: ["model-use"],
                },
              ],
              available: [
                {
                  targetId: "remote-1",
                  label: "Studio Mac",
                  sourceKind: "node",
                  connected: true,
                  current: false,
                  ownerKey: "user:2",
                  ownerScope: "user",
                  ownerLabel: "Work laptop",
                  registeredAt: new Date(0).toISOString(),
                  updatedAt: new Date(0).toISOString(),
                  deviceAccess: "requestable",
                  modelAccess: "requestable",
                  execAccess: "requestable",
                },
              ],
            },
            incomingRequests: [
              {
                requestId: "req-1",
                targetId: "remote-3",
                targetLabel: "Travel Mini",
                targetSourceKind: "node",
                requester: {
                  ownerKey: "user:4",
                  ownerScope: "user",
                  label: "Teammate",
                },
                owner: {
                  ownerKey: "user:1",
                  ownerScope: "user",
                  label: "Nuno",
                },
                scopes: ["exec"],
                status: "pending",
                createdAt: new Date(0).toISOString(),
              },
            ],
            outgoingRequests: [],
            approvals: [],
            grants: [],
            audit: [],
          },
          onSharingRequest,
          onSharingApprove,
          onSharingRevoke,
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Sharing");
    expect(text).toContain("Request models");
    expect(text).toContain("Request models and execution");
    expect(text).toContain("Current scopes");
    expect(text).toContain("Models");
    expect(text).toContain("Execution");

    const requestButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Request models and execution"),
    );
    requestButton?.click();
    expect(onSharingRequest).toHaveBeenCalledWith("remote-1", ["read-only", "model-use", "exec"]);

    const approveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Approve Execution"),
    );
    approveButton?.click();
    expect(onSharingApprove).toHaveBeenCalledWith("req-1", ["read-only", "model-use", "exec"]);

    const revokeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Revoke"),
    );
    revokeButton?.click();
    expect(onSharingRevoke).toHaveBeenCalledWith("grant-1");
  });

  it("renders sharing suggestions and per-resource policy controls", () => {
    const onSharingSetResourcePolicy = vi.fn();
    const container = document.createElement("div");

    render(
      renderConnections(
        baseProps({
          onSharingSetResourcePolicy,
          sharing: {
            viewer: {
              ownerKey: "user:1",
              ownerScope: "user",
              label: "Nuno",
            },
            planSupported: true,
            policy: {
              ownerKey: "user:1",
              ownerScope: "user",
              ownerLabel: "Nuno",
              allowExternalUse: false,
              editable: false,
              resourcesEditable: true,
              resourcePolicies: {
                compute: "light-approval",
                models: "paired-device",
                jobs: "light-approval",
                artifacts: "paired-device",
                cache: "paired-device",
                memory: "explicit-consent",
                vault: "explicit-consent",
                files: "explicit-consent",
                context: "explicit-consent",
              },
            },
            devices: {
              owned: [],
              sharedWithMe: [
                {
                  targetId: "linked-1",
                  label: "Office Mac",
                  sourceKind: "node",
                  connected: true,
                  current: false,
                  ownerKey: "user:1",
                  ownerScope: "user",
                  ownerLabel: "Nuno",
                  registeredAt: new Date(0).toISOString(),
                  updatedAt: new Date(0).toISOString(),
                  deviceAccess: "shared",
                  modelAccess: "shared",
                  execAccess: "requestable",
                  grantScopes: ["read-only", "model-use"],
                },
              ],
              available: [],
            },
            incomingRequests: [],
            outgoingRequests: [],
            approvals: [],
            grants: [],
            audit: [],
            suggestions: [
              {
                suggestionId: "cache-reuse:linked-1",
                kind: "cache-reuse",
                resource: "cache",
                targetId: "linked-1",
                targetLabel: "Office Mac",
                sameAccount: true,
              },
            ],
          },
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Suggested sharing");
    expect(text).toContain("Reuse cache from Office Mac");
    expect(text).toContain("Sharing policy");
    expect(text).toContain("Cache");

    const cacheSelect = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find(
      (select) => select.closest(".list-item")?.textContent?.includes("Cache"),
    );
    expect(cacheSelect).toBeDefined();

    cacheSelect!.value = "light-approval";
    cacheSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onSharingSetResourcePolicy).toHaveBeenCalledWith("cache", "light-approval");
  });

  it("collapses passive sharing states into one compact empty block", () => {
    const container = document.createElement("div");

    render(
      renderConnections(
        baseProps({
          sharing: {
            viewer: {
              ownerKey: "user:1",
              ownerScope: "user",
              label: "Nuno",
            },
            planSupported: true,
            policy: {
              ownerKey: "user:1",
              ownerScope: "user",
              ownerLabel: "Nuno",
              allowExternalUse: false,
              editable: false,
              resourcesEditable: true,
              resourcePolicies: {
                compute: "light-approval",
                models: "paired-device",
                jobs: "light-approval",
                artifacts: "paired-device",
                cache: "paired-device",
                memory: "explicit-consent",
                vault: "explicit-consent",
                files: "explicit-consent",
                context: "explicit-consent",
              },
            },
            devices: {
              owned: [],
              sharedWithMe: [],
              available: [],
            },
            incomingRequests: [],
            outgoingRequests: [],
            approvals: [],
            grants: [],
            audit: [],
            suggestions: [
              {
                suggestionId: "sensitive-consent",
                kind: "sensitive-consent",
                resource: "context",
              },
            ],
          },
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("No shared devices, requests, or approvals right now.");
    expect(text).not.toContain("Available to request");
    expect(text).not.toContain("Shared with you");
    expect(text).not.toContain("Incoming requests");
    expect(text).not.toContain("Suggested sharing");
  });

  it("labels linked sharing targets from the same account explicitly", () => {
    const container = document.createElement("div");

    render(
      renderConnections(
        baseProps({
          sharing: {
            viewer: {
              ownerKey: "user:1",
              ownerScope: "user",
              label: "Nuno",
            },
            planSupported: true,
            policy: {
              allowExternalUse: false,
              editable: false,
            },
            devices: {
              owned: [],
              sharedWithMe: [
                {
                  targetId: "linked-1",
                  label: "Office Mac",
                  sourceKind: "node",
                  connected: true,
                  current: false,
                  ownerKey: "user:1",
                  ownerScope: "user",
                  ownerLabel: "Nuno",
                  registeredAt: new Date(0).toISOString(),
                  updatedAt: new Date(0).toISOString(),
                  deviceAccess: "shared",
                  modelAccess: "shared",
                  execAccess: "requestable",
                  grantScopes: ["read-only", "model-use"],
                },
              ],
              available: [],
            },
            incomingRequests: [],
            outgoingRequests: [],
            approvals: [],
            grants: [],
            audit: [],
          },
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Same account");
  });

  it("allows requesting execution upgrades from the shared devices list", () => {
    const onSharingRequest = vi.fn();
    const container = document.createElement("div");

    render(
      renderConnections(
        baseProps({
          onSharingRequest,
          sharing: {
            viewer: {
              ownerKey: "user:1",
              ownerScope: "user",
              label: "Nuno",
            },
            planSupported: true,
            policy: {
              allowExternalUse: false,
              editable: false,
            },
            devices: {
              owned: [],
              sharedWithMe: [
                {
                  targetId: "linked-1",
                  label: "Office Mac",
                  sourceKind: "node",
                  connected: true,
                  current: false,
                  ownerKey: "user:1",
                  ownerScope: "user",
                  ownerLabel: "Nuno",
                  registeredAt: new Date(0).toISOString(),
                  updatedAt: new Date(0).toISOString(),
                  deviceAccess: "shared",
                  modelAccess: "shared",
                  execAccess: "requestable",
                  grantScopes: ["read-only", "model-use"],
                },
              ],
              available: [],
            },
            incomingRequests: [],
            outgoingRequests: [],
            approvals: [],
            grants: [],
            audit: [],
          },
        }),
      ),
      container,
    );

    const requestButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Request execution"),
    );
    expect(requestButton).toBeDefined();

    requestButton?.click();

    expect(onSharingRequest).toHaveBeenCalledWith("linked-1", ["read-only", "model-use", "exec"]);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((button) =>
        button.textContent?.includes("Revoke"),
      ),
    ).toHaveLength(0);
  });
});
