import { describe, expect, it, vi } from "vitest";
import {
  applyRemoteComputerTaskUpdate,
  resolveRemoteComputerRecords,
  runRemoteComputerCommand,
  type RemoteComputersState,
} from "./remote-computers.ts";

function createState(overrides: Partial<RemoteComputersState> = {}): RemoteComputersState {
  return {
    client: null,
    connected: true,
    sessionKey: "main",
    remoteComputerDrafts: {},
    remoteComputerBusy: {},
    remoteComputerErrors: {},
    remoteComputerTasks: {},
    ...overrides,
  };
}

describe("remote computer controller", () => {
  it("derives remote control readiness from sharing and live node state", () => {
    const computers = resolveRemoteComputerRecords({
      sharing: {
        viewer: {
          ownerKey: "user:1",
          ownerScope: "user",
          label: "Nuno",
        },
        planSupported: true,
        policy: {
          allowExternalUse: false,
          editable: true,
        },
        devices: {
          owned: [],
          sharedWithMe: [
            {
              targetId: "office-mac",
              label: "Office Mac",
              sourceKind: "node",
              connected: true,
              current: false,
              ownerKey: "user:1",
              ownerScope: "user",
              ownerLabel: "Nuno",
              registeredAt: "2026-04-08T10:00:00.000Z",
              updatedAt: "2026-04-08T10:00:00.000Z",
              deviceAccess: "shared",
              modelAccess: "shared",
              execAccess: "shared",
              grantScopes: ["read-only", "model-use", "exec"],
              grantId: "grant-1",
            },
          ],
          available: [
            {
              targetId: "lab-mac",
              label: "Lab Mac",
              sourceKind: "node",
              connected: false,
              current: false,
              ownerKey: "user:1",
              ownerScope: "user",
              ownerLabel: "Nuno",
              registeredAt: "2026-04-08T10:00:00.000Z",
              updatedAt: "2026-04-08T10:00:00.000Z",
              deviceAccess: "shared",
              modelAccess: "shared",
              execAccess: "requestable",
            },
          ],
        },
        incomingRequests: [],
        outgoingRequests: [],
        approvals: [],
        grants: [],
        audit: [],
      },
      nodes: [
        {
          nodeId: "office-mac",
          displayName: "Office Mac",
          connected: true,
          commands: ["system.run"],
        },
      ],
      devicesList: {
        pending: [],
        paired: [
          {
            deviceId: "office-mac",
            displayName: "Office Mac",
            roles: ["node"],
            tokens: [],
          },
        ],
      },
      nodePairingsList: null,
    });

    expect(computers).toEqual([
      expect.objectContaining({
        id: "office-mac",
        phase: "ready",
        connected: true,
        trusted: true,
        supportsExec: true,
      }),
      expect.objectContaining({
        id: "lab-mac",
        phase: "needs-approval",
        connected: false,
        trusted: false,
      }),
    ]);
  });

  it("starts a remote command and reconciles the final task result event", async () => {
    const request = vi.fn();
    const state = createState({
      client: {
        request,
      } as unknown as RemoteComputersState["client"],
      remoteComputerDrafts: {
        "office-mac": {
          command: "pwd",
          cwd: "/tmp/project",
        },
      },
    });
    request.mockResolvedValue({
      status: "accepted",
      taskId: "task-1",
    });

    await runRemoteComputerCommand(state, {
      computerId: "office-mac",
      nodeId: "office-mac",
    });

    expect(request).toHaveBeenCalledWith(
      "node.task.start",
      expect.objectContaining({
        nodeId: "office-mac",
        capabilityId: "exec.shell.v1",
        input: {
          command: ["pwd"],
          cwd: "/tmp/project",
          sessionKey: "main",
        },
      }),
    );
    expect(state.remoteComputerBusy["office-mac"]).toBe(true);
    expect(state.remoteComputerTasks["office-mac"]?.[0]).toEqual(
      expect.objectContaining({
        taskId: "task-1",
        phase: "running",
        commandText: "pwd",
      }),
    );

    const applied = applyRemoteComputerTaskUpdate(state, {
      phase: "result",
      taskId: "task-1",
      nodeId: "office-mac",
      capabilityId: "exec.shell.v1",
      ok: true,
      payload: {
        stdout: "/tmp/project\n",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        success: true,
        error: null,
      },
    });

    expect(applied).toBe(true);
    expect(state.remoteComputerBusy["office-mac"]).toBe(false);
    expect(state.remoteComputerTasks["office-mac"]?.[0]).toEqual(
      expect.objectContaining({
        phase: "succeeded",
        stdout: "/tmp/project\n",
        exitCode: 0,
        success: true,
      }),
    );
  });

  it("groups same-account targets by computerId and keeps the best action target", () => {
    const computers = resolveRemoteComputerRecords({
      sharing: {
        viewer: {
          ownerKey: "user:1",
          ownerScope: "user",
          label: "Nuno",
        },
        planSupported: true,
        policy: {
          allowExternalUse: false,
          editable: true,
        },
        devices: {
          owned: [],
          sharedWithMe: [
            {
              targetId: "office-node-shell",
              computerId: "local:office-mac",
              computerLabel: "Office Mac",
              label: "Office Mac",
              sourceKind: "node",
              connected: false,
              current: false,
              ownerKey: "user:1",
              ownerScope: "user",
              ownerLabel: "Nuno",
              registeredAt: "2026-04-08T10:00:00.000Z",
              updatedAt: "2026-04-08T10:00:00.000Z",
              deviceAccess: "shared",
              modelAccess: "shared",
              execAccess: "requestable",
              grantScopes: ["read-only", "model-use"],
            },
            {
              targetId: "office-node-exec",
              computerId: "local:office-mac",
              computerLabel: "Office Mac",
              label: "Office Mac",
              sourceKind: "node",
              connected: true,
              current: false,
              ownerKey: "user:1",
              ownerScope: "user",
              ownerLabel: "Nuno",
              registeredAt: "2026-04-08T10:00:00.000Z",
              updatedAt: "2026-04-08T10:00:00.000Z",
              deviceAccess: "shared",
              modelAccess: "shared",
              execAccess: "shared",
              grantScopes: ["read-only", "model-use", "exec"],
              grantId: "grant-1",
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
      nodes: [
        {
          nodeId: "office-node-exec",
          computerId: "local:office-mac",
          computerLabel: "Office Mac",
          displayName: "Office Mac",
          connected: true,
          commands: ["system.run"],
        },
      ],
      devicesList: {
        pending: [],
        paired: [
          {
            deviceId: "office-node-exec",
            computerId: "local:office-mac",
            computerLabel: "Office Mac",
            displayName: "Office Mac",
            roles: ["node"],
            tokens: [],
          },
        ],
      },
      nodePairingsList: null,
    });

    expect(computers).toHaveLength(1);
    expect(computers[0]).toEqual(
      expect.objectContaining({
        id: "local:office-mac",
        computerId: "local:office-mac",
        targetId: "office-node-exec",
        targetIds: ["office-node-exec", "office-node-shell"],
        nodeId: "office-node-exec",
        phase: "ready",
        connected: true,
        supportsExec: true,
        trusted: true,
        grantId: "grant-1",
      }),
    );
  });

  it("marks a remote computer as trusted and pending when pairings match by computerId", () => {
    const computers = resolveRemoteComputerRecords({
      sharing: {
        viewer: {
          ownerKey: "user:1",
          ownerScope: "user",
          label: "Nuno",
        },
        planSupported: true,
        policy: {
          allowExternalUse: false,
          editable: true,
        },
        devices: {
          owned: [],
          sharedWithMe: [
            {
              targetId: "windows-node",
              computerId: "local:windows-box",
              computerLabel: "Windows Box",
              label: "Windows Box",
              sourceKind: "node",
              connected: false,
              current: false,
              ownerKey: "user:2",
              ownerScope: "user",
              ownerLabel: "Work",
              registeredAt: "2026-04-08T10:00:00.000Z",
              updatedAt: "2026-04-08T10:00:00.000Z",
              deviceAccess: "shared",
              modelAccess: "shared",
              execAccess: "requestable",
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
      nodes: [],
      devicesList: {
        pending: [
          {
            requestId: "req-1",
            deviceId: "windows-device-pending",
            computerId: "local:windows-box",
            displayName: "Windows Box",
            roles: ["node"],
          },
        ],
        paired: [
          {
            deviceId: "windows-device-approved",
            computerId: "local:windows-box",
            displayName: "Windows Box",
            roles: ["node"],
            tokens: [],
          },
        ],
      },
      nodePairingsList: null,
    });

    expect(computers).toEqual([
      expect.objectContaining({
        computerId: "local:windows-box",
        trusted: true,
        pairingPending: true,
      }),
    ]);
  });

  it("keeps connected exec-capable state from sharing and paired-node metadata when node inventory is filtered", () => {
    const computers = resolveRemoteComputerRecords({
      sharing: {
        viewer: {
          ownerKey: "user:1",
          ownerScope: "user",
          label: "Nuno",
        },
        planSupported: true,
        policy: {
          allowExternalUse: false,
          editable: true,
        },
        devices: {
          owned: [],
          sharedWithMe: [
            {
              targetId: "windows-node",
              computerId: "local:windows-box",
              computerLabel: "Windows Box",
              label: "Windows Box",
              sourceKind: "node",
              connected: true,
              current: false,
              ownerKey: "user:1",
              ownerScope: "user",
              ownerLabel: "Nuno",
              registeredAt: "2026-04-08T10:00:00.000Z",
              updatedAt: "2026-04-08T10:00:00.000Z",
              deviceAccess: "shared",
              modelAccess: "shared",
              execAccess: "requestable",
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
      nodes: [],
      devicesList: {
        pending: [],
        paired: [
          {
            deviceId: "windows-node",
            computerId: "local:windows-box",
            computerLabel: "Windows Box",
            displayName: "Windows Box",
            roles: ["node"],
            tokens: [],
          },
        ],
      },
      nodePairingsList: {
        pending: [],
        paired: [
          {
            nodeId: "windows-node",
            displayName: "Windows Box",
            platform: "Windows",
            deviceFamily: "Windows",
            commands: ["system.run"],
            caps: ["exec.shell.v1"],
          },
        ],
      },
    });

    expect(computers).toHaveLength(1);
    expect(computers[0]).toEqual(
      expect.objectContaining({
        computerId: "local:windows-box",
        connected: true,
        supportsExec: true,
        phase: "needs-approval",
        trusted: true,
      }),
    );
  });
});
