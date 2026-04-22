import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceHandlers } from "./devices.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const {
  approveAlisioSharingRequestMock,
  getAlisioSharingStateMock,
  listDevicePairingMock,
  loadAlisioGatewayAccountContextMock,
  removePairedDeviceMock,
  revokeAlisioSharingGrantMock,
  revokeDeviceTokenMock,
} = vi.hoisted(() => ({
  approveAlisioSharingRequestMock: vi.fn(async ({ requestId }: { requestId: string }) => ({
    ok: true as const,
    requestId,
    grantId: "grant-1",
  })),
  getAlisioSharingStateMock: vi.fn(async () => ({
    viewer: {
      ownerKey: "user-1",
      label: "Nuno",
      ownerScope: "user",
    },
    planSupported: true,
    policy: {
      allowExternalUse: true,
      editable: true,
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
  })),
  listDevicePairingMock: vi.fn(async () => ({
    pending: [],
    paired: [],
  })),
  loadAlisioGatewayAccountContextMock: vi.fn(async () => ({
    account: {},
    canonical: {
      scopeRoot: "account",
      accountId: "user-1",
      source: "account_id",
      authenticated: true,
      authRequired: true,
    },
    currentDevice: {
      id: "device-1",
      label: "Mac",
      platform: "macos",
      current: true,
    },
    deviceBinding: {
      binding: "account_bound",
      runtime: "local",
      current: true,
      accountId: "user-1",
      deviceId: "device-1",
      label: "Mac",
      platform: "macos",
    },
    runtimeContract: {
      scopeRoot: "account",
      backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
      localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
    },
  })),
  removePairedDeviceMock: vi.fn(),
  revokeAlisioSharingGrantMock: vi.fn(async ({ grantId }: { grantId: string }) => ({
    ok: true as const,
    grantId,
    targetId: "device-1",
  })),
  revokeDeviceTokenMock: vi.fn(),
}));

vi.mock("../../infra/alisio-store.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/alisio-store.js")>(
    "../../infra/alisio-store.js",
  );
  return {
    ...actual,
    approveAlisioSharingRequest: approveAlisioSharingRequestMock,
    getAlisioSharingState: getAlisioSharingStateMock,
    revokeAlisioSharingGrant: revokeAlisioSharingGrantMock,
  };
});

vi.mock("../../infra/device-pairing.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/device-pairing.js")>(
    "../../infra/device-pairing.js",
  );
  return {
    ...actual,
    listDevicePairing: listDevicePairingMock,
    removePairedDevice: removePairedDeviceMock,
    revokeDeviceToken: revokeDeviceTokenMock,
  };
});

vi.mock("../alisio-account-context.js", async () => {
  const actual = await vi.importActual<typeof import("../alisio-account-context.js")>(
    "../alisio-account-context.js",
  );
  return {
    ...actual,
    loadAlisioGatewayAccountContext: loadAlisioGatewayAccountContextMock,
  };
});

function createOptions(
  method: string,
  params: Record<string, unknown>,
  overrides?: Partial<GatewayRequestHandlerOptions>,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      dedupe: new Map(),
      broadcast: vi.fn(),
      disconnectClientsForDevice: vi.fn(),
      nodeRegistry: {
        listConnected: vi.fn(() => []),
      },
      logGateway: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    },
    ...overrides,
  } as unknown as GatewayRequestHandlerOptions;
}

describe("deviceHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDevicePairingMock.mockResolvedValue({
      pending: [],
      paired: [],
    });
    getAlisioSharingStateMock.mockResolvedValue({
      viewer: {
        ownerKey: "user-1",
        label: "Nuno",
        ownerScope: "user",
      },
      planSupported: true,
      policy: {
        allowExternalUse: true,
        editable: true,
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
    });
    loadAlisioGatewayAccountContextMock.mockResolvedValue({
      account: {},
      canonical: {
        scopeRoot: "account",
        accountId: "user-1",
        source: "account_id",
        authenticated: true,
        authRequired: true,
      },
      currentDevice: {
        id: "device-1",
        label: "Mac",
        platform: "macos",
        current: true,
      },
      deviceBinding: {
        binding: "account_bound",
        runtime: "local",
        current: true,
        accountId: "user-1",
        deviceId: "device-1",
        label: "Mac",
        platform: "macos",
      },
      runtimeContract: {
        scopeRoot: "account",
        backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
        localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
      },
    });
  });

  it("disconnects active clients after removing a paired device", async () => {
    removePairedDeviceMock.mockResolvedValue({ deviceId: "device-1", removedAtMs: 123 });
    const opts = createOptions("device.pair.remove", { deviceId: " device-1 " });

    await deviceHandlers["device.pair.remove"](opts);
    await Promise.resolve();

    expect(removePairedDeviceMock).toHaveBeenCalledWith(" device-1 ");
    expect(opts.context.disconnectClientsForDevice).toHaveBeenCalledWith("device-1");
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      { deviceId: "device-1", removedAtMs: 123 },
      undefined,
    );
  });

  it("does not disconnect clients when device removal fails", async () => {
    removePairedDeviceMock.mockResolvedValue(null);
    const opts = createOptions("device.pair.remove", { deviceId: "device-1" });

    await deviceHandlers["device.pair.remove"](opts);

    expect(opts.context.disconnectClientsForDevice).not.toHaveBeenCalled();
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "unknown deviceId" }),
    );
  });

  it("disconnects active clients after revoking a device token", async () => {
    revokeDeviceTokenMock.mockResolvedValue({ role: "operator", revokedAtMs: 456 });
    const opts = createOptions("device.token.revoke", {
      deviceId: " device-1 ",
      role: " operator ",
    });

    await deviceHandlers["device.token.revoke"](opts);
    await Promise.resolve();

    expect(revokeDeviceTokenMock).toHaveBeenCalledWith({
      deviceId: " device-1 ",
      role: " operator ",
    });
    expect(opts.context.disconnectClientsForDevice).toHaveBeenCalledWith("device-1", {
      role: "operator",
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      { deviceId: "device-1", role: "operator", revokedAtMs: 456 },
      undefined,
    );
  });

  it("does not disconnect clients when token revocation fails", async () => {
    revokeDeviceTokenMock.mockResolvedValue(null);
    const opts = createOptions("device.token.revoke", {
      deviceId: "device-1",
      role: "operator",
    });

    await deviceHandlers["device.token.revoke"](opts);

    expect(opts.context.disconnectClientsForDevice).not.toHaveBeenCalled();
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "unknown deviceId/role" }),
    );
  });

  it("approves a sharing request with canonical grantId output", async () => {
    const opts = createOptions("devices.share.approve", {
      requestId: "request-1",
      idempotencyKey: "approve-1",
    });

    await deviceHandlers["devices.share.approve"](opts);

    expect(approveAlisioSharingRequestMock).toHaveBeenCalledWith({
      requestId: "request-1",
      scopes: undefined,
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      {
        ok: true,
        requestId: "request-1",
        status: "approved",
        grantId: "grant-1",
      },
      undefined,
    );
    expect(opts.context.broadcast).toHaveBeenCalledWith(
      "devices.changed",
      expect.objectContaining({
        reason: "share.approve",
      }),
      { dropIfSlow: true },
    );
  });

  it("returns canonical account-root metadata for devices.list", async () => {
    const opts = createOptions("devices.list", {});

    await deviceHandlers["devices.list"](opts);

    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        accountId: "user-1",
        scopeRoot: "account",
        authRequired: true,
        canonical: expect.objectContaining({
          accountId: "user-1",
          authenticated: true,
        }),
        deviceBinding: expect.objectContaining({
          binding: "account_bound",
          accountId: "user-1",
          deviceId: "device-1",
        }),
      }),
      undefined,
    );
  });

  it("rejects signed-out callers before exposing device state", async () => {
    loadAlisioGatewayAccountContextMock.mockResolvedValueOnce({
      account: {},
      canonical: {
        scopeRoot: "account",
        accountId: "user-1",
        source: "missing",
        authenticated: false,
        authRequired: true,
      },
      currentDevice: {
        id: "device-1",
        label: "Mac",
        platform: "macos",
        current: true,
      },
      deviceBinding: {
        binding: "auth_required",
        runtime: "local",
        current: true,
        accountId: "user-1",
        deviceId: "device-1",
        label: "Mac",
        platform: "macos",
      },
      runtimeContract: {
        scopeRoot: "account",
        backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
        localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
      },
    });
    const opts = createOptions("devices.list", {});

    await deviceHandlers["devices.list"](opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "Alisio account sign-in required before using the app.",
      }),
    );
  });

  it("revokes a sharing grant with canonical grantId input", async () => {
    const opts = createOptions("devices.share.revoke", {
      grantId: "grant-1",
      idempotencyKey: "revoke-1",
    });

    await deviceHandlers["devices.share.revoke"](opts);

    expect(revokeAlisioSharingGrantMock).toHaveBeenCalledWith({ grantId: "grant-1" });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      {
        ok: true,
        grantId: "grant-1",
        targetId: "device-1",
      },
      undefined,
    );
    expect(opts.context.broadcast).toHaveBeenCalledWith(
      "devices.changed",
      expect.objectContaining({
        reason: "share.revoke",
        targetId: "device-1",
      }),
      { dropIfSlow: true },
    );
  });
});
