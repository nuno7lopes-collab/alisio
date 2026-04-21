import type { NodeListNode } from "../../../../src/shared/node-list-types.js";
import type { AlisioAccountState, AlisioSharingState } from "../types.ts";
import {
  normalizeComputerText,
  resolveComputerId,
  resolveComputerLabelText,
  resolveNodeRuntimeComputerId,
  resolveNodeRuntimePlatform,
} from "./computer-identity.ts";
import type { ComputersCatalogState } from "./computers.ts";
import { computerNodeSupportsExec, isComputerNodeConnected } from "./computers.ts";
import {
  groupPairedDevicesByComputer,
  type DevicePairingList,
  type PairedComputer,
} from "./devices.ts";
import { resolveRemoteComputerRecords, type RemoteComputerRecord } from "./remote-computers.ts";

type SharingIncomingRequest = NonNullable<AlisioSharingState["incomingRequests"]>[number];
type SharingOutgoingRequest = NonNullable<AlisioSharingState["outgoingRequests"]>[number];
type AccountDevice = NonNullable<AlisioAccountState["devices"]>[number];

export type ConnectionsModelInput = ComputersCatalogState;

export type ConnectionComputerModel = {
  computerId: string;
  label: string;
  platform: string | null;
  current: boolean;
  local: PairedComputer | null;
  remote: RemoteComputerRecord | null;
  fallback: AccountDevice | null;
  runtimeNodes: NodeListNode[];
  connected: boolean;
  execReady: boolean;
  sameAccount: boolean;
  external: boolean;
};

export type ConnectionsModel = {
  currentComputer: ConnectionComputerModel | null;
  sameAccountComputers: ConnectionComputerModel[];
  externalComputers: ConnectionComputerModel[];
  pendingDeviceRequests: DevicePairingList["pending"];
  pendingSharing: {
    incoming: SharingIncomingRequest[];
    outgoing: SharingOutgoingRequest[];
  };
  accountComputersCount: number;
  externalComputersCount: number;
  onlineComputersCount: number;
  execReadyNodesCount: number;
  hasAdvancedSharing: boolean;
};

type ConnectionsModelCache = {
  account?: AlisioAccountState | null;
  sharing?: AlisioSharingState | null;
  devicesList: DevicePairingList | null;
  currentDeviceId: string | null;
  nodes: NodeListNode[];
  nodePairingsList: ComputersCatalogState["nodePairingsList"];
  result: ConnectionsModel;
};

let lastConnectionsModelCache: ConnectionsModelCache | null = null;

function resolveCurrentFallbackComputer(
  account: AlisioAccountState | null | undefined,
  localComputers: readonly PairedComputer[],
) {
  if (localComputers.some((computer) => computer.isCurrentComputer)) {
    return null;
  }
  return account?.devices.find((device) => device.current) ?? account?.devices[0] ?? null;
}

export function resolveVisiblePendingSharingRequests(
  sharing: AlisioSharingState | null | undefined,
): ConnectionsModel["pendingSharing"] {
  const incoming = (sharing?.incomingRequests ?? []).filter(
    (request) => request.status === "pending",
  );
  const incomingIds = new Set(incoming.map((request) => request.requestId));
  const outgoing = (sharing?.outgoingRequests ?? []).filter(
    (request) => request.status === "pending" && !incomingIds.has(request.requestId),
  );
  return { incoming, outgoing };
}

function resolveRuntimeGroups(nodes: readonly NodeListNode[]) {
  const groups = new Map<string, NodeListNode[]>();
  for (const node of nodes) {
    const key = resolveNodeRuntimeComputerId(node);
    if (!key) {
      continue;
    }
    const current = groups.get(key);
    if (current) {
      current.push(node);
    } else {
      groups.set(key, [node]);
    }
  }
  return groups;
}

function resolveRemoteGroups(input: ConnectionsModelInput) {
  const all = resolveRemoteComputerRecords({
    sharing: input.sharing ?? null,
    nodes: input.nodes,
    devicesList: input.devicesList,
    nodePairingsList: input.nodePairingsList ?? null,
  });
  const sameAccount = all.filter((computer) => computer.sameAccount);
  const external = all.filter((computer) => !computer.sameAccount);
  return { sameAccount, external };
}

function buildComputerModel(params: {
  computerId: string;
  local?: PairedComputer | null;
  remote?: RemoteComputerRecord | null;
  fallback?: AccountDevice | null;
  runtimeNodes?: NodeListNode[];
}) {
  const runtimeNodes = params.runtimeNodes ?? [];
  const local = params.local ?? null;
  const remote = params.remote ?? null;
  const fallback = params.fallback ?? null;
  const label =
    resolveComputerLabelText({
      computerLabel: local?.label ?? remote?.label ?? runtimeNodes[0]?.computerLabel,
      displayName: runtimeNodes[0]?.displayName,
      platform: local?.platform ?? remote?.platform ?? fallback?.platform,
      fallbackLabel: fallback?.label ?? params.computerId,
    }) ?? params.computerId;
  const platform =
    normalizeComputerText(local?.platform) ??
    normalizeComputerText(remote?.platform) ??
    normalizeComputerText(fallback?.platform) ??
    runtimeNodes
      .map((node) => resolveNodeRuntimePlatform(node))
      .find((value): value is string => Boolean(value)) ??
    null;
  const connected =
    local?.isCurrentComputer === true ||
    fallback?.current === true ||
    remote?.connected === true ||
    runtimeNodes.some((node) => isComputerNodeConnected(node));
  return {
    computerId: params.computerId,
    label,
    platform,
    current: local?.isCurrentComputer === true || fallback?.current === true,
    local,
    remote,
    fallback,
    runtimeNodes,
    connected,
    execReady:
      remote?.supportsExec === true ||
      runtimeNodes.some((node) => isComputerNodeConnected(node) && computerNodeSupportsExec(node)),
    sameAccount: remote?.sameAccount ?? true,
    external: remote?.sameAccount === false,
  } satisfies ConnectionComputerModel;
}

export function resolveConnectionsModel(input: ConnectionsModelInput): ConnectionsModel {
  const cached = lastConnectionsModelCache;
  if (
    cached &&
    cached.account === input.account &&
    cached.sharing === input.sharing &&
    cached.devicesList === input.devicesList &&
    cached.currentDeviceId === input.currentDeviceId &&
    cached.nodes === input.nodes &&
    cached.nodePairingsList === input.nodePairingsList
  ) {
    return cached.result;
  }
  const localComputers = groupPairedDevicesByComputer(
    input.devicesList?.paired ?? [],
    input.currentDeviceId ?? null,
  );
  const fallbackCurrent = resolveCurrentFallbackComputer(input.account, localComputers);
  const runtimeGroups = resolveRuntimeGroups(input.nodes);
  const remoteGroups = resolveRemoteGroups(input);
  const sameAccountRemoteByComputerId = new Map(
    remoteGroups.sameAccount.map((computer) => [computer.computerId, computer] as const),
  );
  const pendingSharing = resolveVisiblePendingSharingRequests(input.sharing);

  const currentLocalComputer =
    localComputers.find((computer) => computer.isCurrentComputer) ?? null;
  const fallbackCurrentId = resolveComputerId({ fallbackId: fallbackCurrent?.id });
  const currentComputerId = currentLocalComputer?.computerId ?? fallbackCurrentId ?? null;
  const currentRemote = currentComputerId
    ? (sameAccountRemoteByComputerId.get(currentComputerId) ?? null)
    : null;
  if (currentComputerId) {
    sameAccountRemoteByComputerId.delete(currentComputerId);
  }
  const currentComputer = currentLocalComputer
    ? buildComputerModel({
        computerId: currentLocalComputer.computerId,
        local: currentLocalComputer,
        remote: currentRemote,
        runtimeNodes: runtimeGroups.get(currentLocalComputer.computerId) ?? [],
      })
    : fallbackCurrent && resolveComputerId({ fallbackId: fallbackCurrent.id })
      ? buildComputerModel({
          computerId: fallbackCurrent.id.trim(),
          fallback: fallbackCurrent,
          remote: currentRemote,
          runtimeNodes: runtimeGroups.get(fallbackCurrent.id.trim()) ?? [],
        })
      : null;

  const sameAccountComputers = [
    ...localComputers
      .filter((computer) => !computer.isCurrentComputer)
      .map((computer) => {
        const remote = sameAccountRemoteByComputerId.get(computer.computerId) ?? null;
        sameAccountRemoteByComputerId.delete(computer.computerId);
        return buildComputerModel({
          computerId: computer.computerId,
          local: computer,
          remote,
          runtimeNodes: runtimeGroups.get(computer.computerId) ?? [],
        });
      }),
    ...[...sameAccountRemoteByComputerId.values()].map((computer) =>
      buildComputerModel({
        computerId: computer.computerId,
        remote: computer,
        runtimeNodes: runtimeGroups.get(computer.computerId) ?? [],
      }),
    ),
  ];

  const externalComputers = remoteGroups.external.map((computer) =>
    buildComputerModel({
      computerId: computer.computerId,
      remote: computer,
      runtimeNodes: runtimeGroups.get(computer.computerId) ?? [],
    }),
  );

  const accountComputerIds = new Set<string>();
  if (currentComputer) {
    accountComputerIds.add(currentComputer.computerId);
  }
  for (const computer of sameAccountComputers) {
    accountComputerIds.add(computer.computerId);
  }

  const onlineComputerIds = new Set<string>();
  const allVisibleComputers = [
    ...(currentComputer ? [currentComputer] : []),
    ...sameAccountComputers,
    ...externalComputers,
  ];
  for (const computer of allVisibleComputers) {
    if (computer.connected) {
      onlineComputerIds.add(computer.computerId);
    }
  }

  const result = {
    currentComputer,
    sameAccountComputers,
    externalComputers,
    pendingDeviceRequests: input.devicesList?.pending ?? [],
    pendingSharing,
    accountComputersCount: accountComputerIds.size,
    externalComputersCount: new Set(externalComputers.map((computer) => computer.computerId)).size,
    onlineComputersCount: onlineComputerIds.size,
    execReadyNodesCount: input.nodes.filter(
      (node) => isComputerNodeConnected(node) && computerNodeSupportsExec(node),
    ).length,
    hasAdvancedSharing:
      (input.sharing?.devices.available?.length ?? 0) > 0 ||
      (input.sharing?.devices.sharedWithMe?.length ?? 0) > 0 ||
      pendingSharing.incoming.length > 0 ||
      pendingSharing.outgoing.length > 0 ||
      (input.sharing?.suggestions?.length ?? 0) > 0 ||
      input.sharing?.policy.resourcesEditable === true,
  };

  lastConnectionsModelCache = {
    account: input.account,
    sharing: input.sharing,
    devicesList: input.devicesList,
    currentDeviceId: input.currentDeviceId ?? null,
    nodes: input.nodes,
    nodePairingsList: input.nodePairingsList,
    result,
  };

  return result;
}
