import { describe, expect, it } from "vitest";
import type { AlisioSharingState } from "../types.ts";
import { resolveConnectionsModel } from "./connections-model.ts";
import type { DevicePairingList } from "./devices.ts";
import type { RuntimeNodePairingList } from "./node-pairing.ts";

describe("connections model", () => {
  it("merges same-account device trust and remote runtime access into one computer row", () => {
    const devicesList = {
      pending: [],
      paired: [
        {
          deviceId: "windows-node",
          computerId: "local:windows-box",
          computerLabel: "Windows Box",
          displayName: "Windows Box",
          platform: "Windows",
          roles: ["node"],
          tokens: [],
        },
      ],
    } satisfies DevicePairingList;

    const sharing = {
      viewer: {
        ownerKey: "user:1",
        ownerScope: "user",
        label: "Nuno",
      },
      planSupported: true,
      policy: {
        allowExternalUse: false,
        editable: true,
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
            targetId: "windows-node",
            computerId: "local:windows-box",
            computerLabel: "Windows Box",
            label: "Windows Box",
            platform: "Windows",
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
      suggestions: [],
    } satisfies AlisioSharingState;

    const nodePairingsList = {
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
    } satisfies RuntimeNodePairingList;

    const model = resolveConnectionsModel({
      devicesList,
      currentDeviceId: null,
      sharing,
      nodes: [],
      nodePairingsList,
    });

    expect(model.sameAccountComputers).toHaveLength(1);
    expect(model.sameAccountComputers[0]).toEqual(
      expect.objectContaining({
        computerId: "local:windows-box",
        connected: true,
        execReady: true,
        local: expect.objectContaining({
          computerId: "local:windows-box",
        }),
        remote: expect.objectContaining({
          computerId: "local:windows-box",
          connected: true,
          supportsExec: true,
          execAccess: "requestable",
        }),
      }),
    );
    expect(model.onlineComputersCount).toBe(1);
  });

  it("counts connected exec runtimes announced only through caps", () => {
    const model = resolveConnectionsModel({
      devicesList: null,
      currentDeviceId: null,
      sharing: null,
      nodes: [
        {
          nodeId: "windows-node",
          computerId: "local:windows-box",
          connected: true,
          caps: ["exec.shell.v1"],
        },
      ],
      nodePairingsList: null,
    });

    expect(model.execReadyNodesCount).toBe(1);
  });
});
