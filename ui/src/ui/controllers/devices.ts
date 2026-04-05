import { t } from "../../i18n/index.ts";
import { clearDeviceAuthToken, storeDeviceAuthToken } from "../device-auth.ts";
import { loadOrCreateDeviceIdentity } from "../device-identity.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

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
  displayName?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  isRepair?: boolean;
  ts?: number;
};

export type PairedDevice = {
  deviceId: string;
  displayName?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  tokens?: DeviceTokenSummary[];
  createdAtMs?: number;
  approvedAtMs?: number;
};

export type DevicePairingList = {
  pending: PendingDevice[];
  paired: PairedDevice[];
};

export type DevicesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
};

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
    const res = await state.client.request<{
      pending?: Array<PendingDevice>;
      paired?: Array<PairedDevice>;
    }>("device.pair.list", {});
    state.devicesList = {
      pending: Array.isArray(res?.pending) ? res.pending : [],
      paired: Array.isArray(res?.paired) ? res.paired : [],
    };
  } catch (err) {
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
  if (!state.client || !state.connected) {
    return;
  }
  const trimmed = deviceId.trim();
  if (!trimmed) {
    return;
  }
  const confirmed = window.confirm(
    t("alisio.connections.devices.removeConfirm", { deviceId: trimmed }),
  );
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("device.pair.remove", { deviceId: trimmed });
    const identity = await loadOrCreateDeviceIdentity();
    if (trimmed === identity.deviceId) {
      const pairedDevice =
        state.devicesList?.paired.find((entry) => entry.deviceId === trimmed) ?? null;
      for (const role of collectPairedDeviceRoles(pairedDevice)) {
        clearDeviceAuthToken({ deviceId: identity.deviceId, role });
      }
    }
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}

export async function rotateDeviceToken(
  state: DevicesState,
  params: { deviceId: string; role: string; scopes?: string[] },
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{
      token: string;
      role?: string;
      deviceId?: string;
      scopes?: Array<string>;
    }>("device.token.rotate", params);
    if (res?.token) {
      const identity = await loadOrCreateDeviceIdentity();
      const role = res.role ?? params.role;
      if (res.deviceId === identity.deviceId || params.deviceId === identity.deviceId) {
        storeDeviceAuthToken({
          deviceId: identity.deviceId,
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
  params: { deviceId: string; role: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(
    t("alisio.connections.devices.revokeConfirm", {
      deviceId: params.deviceId,
      role: params.role,
    }),
  );
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("device.token.revoke", params);
    const identity = await loadOrCreateDeviceIdentity();
    if (params.deviceId === identity.deviceId) {
      clearDeviceAuthToken({ deviceId: identity.deviceId, role: params.role });
    }
    await loadDevices(state);
  } catch (err) {
    state.devicesError = String(err);
  }
}
