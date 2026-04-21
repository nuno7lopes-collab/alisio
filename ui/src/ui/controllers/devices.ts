import { t } from "../../i18n/index.ts";
import { clearDeviceAuthToken, storeDeviceAuthToken } from "../device-auth.ts";
import { loadManagedDeviceIdentity } from "../device-identity.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { resolveComputerGroupKey, resolveComputerLabelText } from "./computer-identity.ts";

export type DeviceTokenSummary = {
  role: string;
  scopes?: string[];
  createdAtMs?: number;
  rotatedAtMs?: number;
  revokedAtMs?: number;
  lastUsedAtMs?: number;
};

export type PendingDevice = {
  requestId: string;
  deviceId: string;
  computerId?: string;
  computerLabel?: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  isRepair?: boolean;
  ts?: number;
};

export type PairedDevice = {
  deviceId: string;
  computerId?: string;
  computerLabel?: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  clientId?: string;
  clientMode?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  tokens?: DeviceTokenSummary[];
  createdAtMs?: number;
  approvedAtMs?: number;
};

export type PairedComputerToken = DeviceTokenSummary & {
  deviceId: string;
};

export type PairedComputer = {
  key: string;
  computerId: string;
  label: string;
  platform?: string;
  deviceFamily?: string;
  clientId?: string;
  clientMode?: string;
  roles: string[];
  scopes: string[];
  tokens: PairedComputerToken[];
  primaryDeviceId: string;
  allDeviceIds: string[];
  staleDeviceIds: string[];
  staleRecordCount: number;
  isCurrentComputer: boolean;
};

export type DevicePairingList = {
  pending: PendingDevice[];
  paired: PairedDevice[];
};

type GroupedPairedDevicesCache = {
  paired: readonly PairedDevice[];
  currentDeviceId: string | null;
  result: PairedComputer[];
};

export type DevicesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  currentDeviceId: string | null;
};

let lastGroupedPairedDevicesCache: GroupedPairedDevicesCache | null = null;

function collectPairedDeviceRoles(device: PairedDevice | null | undefined): string[] {
  const roles = new Set<string>();

  for (const role of device?.roles ?? []) {
    const trimmed = role.trim();
    if (trimmed) {
      roles.add(trimmed);
    }
  }

  for (const token of device?.tokens ?? []) {
    const trimmed = token.role.trim();
    if (trimmed) {
      roles.add(trimmed);
    }
  }

  return [...roles];
}

function collectPairedDeviceScopes(device: PairedDevice | null | undefined): string[] {
  const scopes = new Set<string>();

  for (const scope of device?.scopes ?? []) {
    const trimmed = scope.trim();
    if (trimmed) {
      scopes.add(trimmed);
    }
  }

  for (const token of device?.tokens ?? []) {
    for (const scope of token.scopes ?? []) {
      const trimmed = scope.trim();
      if (trimmed) {
        scopes.add(trimmed);
      }
    }
  }

  return [...scopes];
}

export function resolveComputerLabel(
  device: Pick<
    PairedDevice,
    "computerLabel" | "displayName" | "platform" | "clientId" | "clientMode" | "deviceFamily"
  >,
): string {
  return (
    resolveComputerLabelText({
      computerLabel: device.computerLabel,
      displayName: device.displayName,
      platform: device.platform,
      clientId: device.clientId,
      clientMode: device.clientMode,
      deviceFamily: device.deviceFamily,
    }) || t("alisio.connections.devices.computerFallback")
  );
}

function resolveComputerKey(device: PairedDevice) {
  return resolveComputerGroupKey({
    computerId: device.computerId,
    fallbackId: `device:${device.deviceId}`,
  })!;
}

function comparePairedDeviceRecency(a: PairedDevice, b: PairedDevice) {
  const aTs = a.approvedAtMs ?? a.createdAtMs ?? 0;
  const bTs = b.approvedAtMs ?? b.createdAtMs ?? 0;
  return bTs - aTs;
}

export function groupPairedDevicesByComputer(
  paired: readonly PairedDevice[],
  currentDeviceId: string | null,
): PairedComputer[] {
  const cached = lastGroupedPairedDevicesCache;
  if (cached && cached.paired === paired && cached.currentDeviceId === currentDeviceId) {
    return cached.result;
  }
  const groups = new Map<string, PairedDevice[]>();

  for (const device of paired) {
    const key = resolveComputerKey(device);
    const current = groups.get(key);
    if (current) {
      current.push(device);
    } else {
      groups.set(key, [device]);
    }
  }

  const result = [...groups.entries()]
    .map(([key, devices]) => {
      const sorted = [...devices].toSorted(comparePairedDeviceRecency);
      const currentDevice = currentDeviceId
        ? (sorted.find((device) => device.deviceId === currentDeviceId) ?? null)
        : null;
      const primary = currentDevice ?? sorted[0];
      const roles = new Set<string>();
      const scopes = new Set<string>();

      for (const device of sorted) {
        for (const role of collectPairedDeviceRoles(device)) {
          roles.add(role);
        }
        for (const scope of collectPairedDeviceScopes(device)) {
          scopes.add(scope);
        }
      }

      return {
        key,
        computerId: primary.computerId?.trim() || key,
        label: resolveComputerLabel(primary),
        platform: primary.platform,
        deviceFamily: primary.deviceFamily,
        clientId: primary.clientId,
        clientMode: primary.clientMode,
        roles: [...roles],
        scopes: [...scopes],
        tokens: (primary.tokens ?? []).map((token) => ({
          ...token,
          deviceId: primary.deviceId,
        })),
        primaryDeviceId: primary.deviceId,
        allDeviceIds: sorted.map((device) => device.deviceId),
        staleDeviceIds: sorted
          .filter((device) => device.deviceId !== primary.deviceId)
          .map((device) => device.deviceId),
        staleRecordCount: Math.max(0, sorted.length - 1),
        isCurrentComputer: currentDevice !== null,
      } satisfies PairedComputer;
    })
    .toSorted((a, b) => {
      if (a.isCurrentComputer !== b.isCurrentComputer) {
        return a.isCurrentComputer ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });

  lastGroupedPairedDevicesCache = {
    paired,
    currentDeviceId,
    result,
  };

  return result;
}

async function clearLocalTokensForDevice(state: DevicesState, deviceId: string) {
  if (state.currentDeviceId !== deviceId) {
    return;
  }
  const pairedDevice =
    state.devicesList?.paired.find((entry) => entry.deviceId === deviceId) ?? null;
  for (const role of collectPairedDeviceRoles(pairedDevice)) {
    clearDeviceAuthToken({ deviceId, role });
  }
}

async function removeDevicePairings(
  state: DevicesState,
  params: {
    deviceIds: readonly string[];
    confirmMessage: string;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const deviceIds = [
    ...new Set(params.deviceIds.map((deviceId) => deviceId.trim()).filter(Boolean)),
  ];
  if (deviceIds.length === 0) {
    return;
  }
  const confirmed = window.confirm(params.confirmMessage);
  if (!confirmed) {
    return;
  }

  let firstError: string | null = null;
  for (const deviceId of deviceIds) {
    try {
      await state.client.request("device.pair.remove", { deviceId });
      await clearLocalTokensForDevice(state, deviceId);
    } catch (err) {
      firstError ??= String(err);
    }
  }

  await loadDevices(state, { quiet: true });
  if (firstError) {
    state.devicesError = firstError;
  }
}

export async function loadDevices(state: DevicesState, opts?: { quiet?: boolean }) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.devicesLoading) {
    return;
  }
  state.devicesLoading = true;
  if (!opts?.quiet) {
    state.devicesError = null;
  }
  try {
    const [res, identity] = await Promise.all([
      state.client.request<{
        pending?: Array<PendingDevice>;
        paired?: Array<PairedDevice>;
      }>("device.pair.list", {}),
      loadManagedDeviceIdentity(),
    ]);
    state.devicesList = {
      pending: Array.isArray(res?.pending) ? res.pending : [],
      paired: Array.isArray(res?.paired) ? res.paired : [],
    };
    state.currentDeviceId = identity?.deviceId ?? null;
  } catch (err) {
    state.currentDeviceId = null;
    if (!opts?.quiet) {
      state.devicesError = String(err);
    }
  } finally {
    state.devicesLoading = false;
  }
}

export async function approveDevicePairing(state: DevicesState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("device.pair.approve", { requestId });
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function rejectDevicePairing(state: DevicesState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(t("alisio.connections.devices.rejectConfirm"));
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("device.pair.reject", { requestId });
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function removeDevicePairing(state: DevicesState, deviceId: string) {
  const trimmed = deviceId.trim();
  if (!trimmed) {
    return;
  }
  await removeDevicePairings(state, {
    deviceIds: [trimmed],
    confirmMessage: t("alisio.connections.devices.removeConfirm", {
      label: trimmed,
    }),
  });
}

export async function removeComputerPairings(
  state: DevicesState,
  params: { label: string; deviceIds: readonly string[] },
) {
  await removeDevicePairings(state, {
    deviceIds: params.deviceIds,
    confirmMessage: t("alisio.connections.devices.removeConfirm", {
      label: params.label,
    }),
  });
}

export async function cleanupComputerPairings(
  state: DevicesState,
  params: { label: string; staleDeviceIds: readonly string[] },
) {
  const staleDeviceIds = params.staleDeviceIds.map((deviceId) => deviceId.trim()).filter(Boolean);
  if (staleDeviceIds.length === 0) {
    return;
  }
  await removeDevicePairings(state, {
    deviceIds: staleDeviceIds,
    confirmMessage: t("alisio.connections.devices.cleanupConfirm", {
      label: params.label,
      count: String(staleDeviceIds.length),
    }),
  });
}

export async function rotateDeviceToken(
  state: DevicesState,
  params: { deviceId: string; role: string; scopes?: string[]; label?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const { label: _label, ...request } = params;
    const res = await state.client.request<{
      token: string;
      role?: string;
      deviceId?: string;
      scopes?: Array<string>;
    }>("device.token.rotate", request);
    if (res?.token) {
      const role = res.role ?? params.role;
      if (
        state.currentDeviceId &&
        (res.deviceId === state.currentDeviceId || params.deviceId === state.currentDeviceId)
      ) {
        storeDeviceAuthToken({
          deviceId: state.currentDeviceId,
          role,
          token: res.token,
          scopes: res.scopes ?? params.scopes ?? [],
        });
      }
      window.prompt(t("alisio.connections.devices.rotatePrompt"), res.token);
    }
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function revokeDeviceToken(
  state: DevicesState,
  params: { deviceId: string; role: string; label?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(
    t("alisio.connections.devices.revokeConfirm", {
      label: params.label?.trim() || resolveComputerLabel({}),
      role: params.role,
    }),
  );
  if (!confirmed) {
    return;
  }
  try {
    const { label: _label, ...request } = params;
    await state.client.request("device.token.revoke", request);
    if (params.deviceId === state.currentDeviceId) {
      clearDeviceAuthToken({ deviceId: state.currentDeviceId, role: params.role });
    }
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}
