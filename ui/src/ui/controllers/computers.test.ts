import { describe, expect, it } from "vitest";
import {
  computerNodeSupportsExec,
  isComputerNodeConnected,
  resolveComputersViewState,
  type ComputersViewStateSource,
} from "./computers.ts";

describe("computers controller", () => {
  it("treats online nodes as connected", () => {
    expect(isComputerNodeConnected({ connected: false, online: true })).toBe(true);
    expect(isComputerNodeConnected({ connected: false, online: false })).toBe(false);
  });

  it("detects exec support from commands, caps and capability ids", () => {
    expect(computerNodeSupportsExec({ commands: ["system.run"] })).toBe(true);
    expect(computerNodeSupportsExec({ caps: ["exec.shell.v1"] })).toBe(true);
    expect(computerNodeSupportsExec({ capabilities: [{ id: "exec.shell.v1" }] })).toBe(true);
    expect(computerNodeSupportsExec({ commands: ["health.ping"] })).toBe(false);
  });

  it("groups the computer surface state into a single object", () => {
    const state: ComputersViewStateSource = {
      alisioAccount: null,
      alisioSharing: null,
      nodesLoading: true,
      nodesLoaded: false,
      nodes: [],
      nodesError: "nodes failed",
      devicesLoading: false,
      devicesError: null,
      devicesList: null,
      currentDeviceId: "device-1",
      alisioSharingLoading: true,
      alisioSharingError: "sharing failed",
      nodePairingsLoading: false,
      nodePairingsError: null,
      nodePairingsList: null,
      remoteComputerDrafts: { studio: { command: "uname -a", cwd: "/tmp" } },
      remoteComputerBusy: { studio: true },
      remoteComputerErrors: { studio: "busy" },
      remoteComputerTasks: { studio: [] },
    };

    expect(resolveComputersViewState(state)).toEqual({
      account: null,
      sharing: null,
      nodesLoading: true,
      nodesLoaded: false,
      nodes: [],
      nodesError: "nodes failed",
      devicesLoading: false,
      devicesError: null,
      devicesList: null,
      currentDeviceId: "device-1",
      sharingLoading: true,
      sharingError: "sharing failed",
      nodePairingsLoading: false,
      nodePairingsError: null,
      nodePairingsList: null,
      remote: {
        drafts: { studio: { command: "uname -a", cwd: "/tmp" } },
        busy: { studio: true },
        errors: { studio: "busy" },
        tasks: { studio: [] },
      },
    });
  });
});
