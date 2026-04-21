import type { NodeListNode } from "../../../../src/shared/node-list-types.js";
import type { AlisioAccountState, AlisioSharingState } from "../types.ts";
import type { DevicePairingList } from "./devices.ts";
import type { RuntimeNodePairingList } from "./node-pairing.ts";
import type { RemoteComputerDraft, RemoteComputerTaskRecord } from "./remote-computers.ts";

type ExecCapabilityRecord = {
  commands?: string[];
  caps?: string[];
  capabilities?: Array<{ id?: string | null }>;
};

type ConnectivityRecord = {
  connected?: unknown;
  online?: unknown;
};

export type ComputersCatalogState = {
  account?: AlisioAccountState | null;
  sharing?: AlisioSharingState | null;
  devicesList: DevicePairingList | null;
  currentDeviceId?: string | null;
  nodes: NodeListNode[];
  nodePairingsList: RuntimeNodePairingList | null;
};

export type ComputersRemoteState = {
  drafts: Record<string, RemoteComputerDraft>;
  busy: Record<string, boolean>;
  errors: Record<string, string | null>;
  tasks: Record<string, RemoteComputerTaskRecord[]>;
};

export type ComputersViewState = ComputersCatalogState & {
  nodesLoading: boolean;
  nodesLoaded: boolean;
  nodesError: string | null;
  devicesLoading: boolean;
  devicesError: string | null;
  sharingLoading: boolean;
  sharingError: string | null;
  nodePairingsLoading: boolean;
  nodePairingsError: string | null;
  remote: ComputersRemoteState;
};

export type ComputersViewStateSource = {
  alisioAccount: AlisioAccountState | null;
  alisioSharing: AlisioSharingState | null;
  nodesLoading: boolean;
  nodesLoaded: boolean;
  nodes: NodeListNode[];
  nodesError: string | null;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  currentDeviceId: string | null;
  alisioSharingLoading: boolean;
  alisioSharingError: string | null;
  nodePairingsLoading: boolean;
  nodePairingsError: string | null;
  nodePairingsList: RuntimeNodePairingList | null;
  remoteComputerDrafts: Record<string, RemoteComputerDraft>;
  remoteComputerBusy: Record<string, boolean>;
  remoteComputerErrors: Record<string, string | null>;
  remoteComputerTasks: Record<string, RemoteComputerTaskRecord[]>;
};

export function isComputerNodeConnected(node: ConnectivityRecord | null | undefined) {
  return Boolean(node?.connected) || Boolean(node?.online);
}

export function computerNodeSupportsExec(node: ExecCapabilityRecord | null | undefined) {
  const commands = Array.isArray(node?.commands) ? node.commands : [];
  if (commands.includes("system.run")) {
    return true;
  }
  const caps = Array.isArray(node?.caps) ? node.caps : [];
  if (caps.some((capability) => capability.trim() === "exec.shell.v1")) {
    return true;
  }
  const capabilities = Array.isArray(node?.capabilities) ? node.capabilities : [];
  return capabilities.some((capability) => capability.id?.trim() === "exec.shell.v1");
}

export function resolveComputersViewState(state: ComputersViewStateSource): ComputersViewState {
  return {
    account: state.alisioAccount,
    sharing: state.alisioSharing,
    nodesLoading: state.nodesLoading,
    nodesLoaded: state.nodesLoaded,
    nodes: state.nodes,
    nodesError: state.nodesError ?? null,
    devicesLoading: state.devicesLoading,
    devicesError: state.devicesError,
    devicesList: state.devicesList,
    currentDeviceId: state.currentDeviceId,
    sharingLoading: state.alisioSharingLoading,
    sharingError: state.alisioSharingError,
    nodePairingsLoading: state.nodePairingsLoading,
    nodePairingsError: state.nodePairingsError,
    nodePairingsList: state.nodePairingsList,
    remote: {
      drafts: state.remoteComputerDrafts,
      busy: state.remoteComputerBusy,
      errors: state.remoteComputerErrors,
      tasks: state.remoteComputerTasks,
    },
  };
}
