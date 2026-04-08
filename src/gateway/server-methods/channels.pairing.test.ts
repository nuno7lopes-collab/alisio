import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  readConfigFileSnapshot: vi.fn(),
  writeConfigFile: vi.fn(),
  listChannelPlugins: vi.fn(() => []),
  getChannelPlugin: vi.fn(() => null),
  normalizeChannelId: vi.fn((value: string) => value.trim().toLowerCase()),
  listChatChannels: vi.fn(() => []),
  isChannelConfigured: vi.fn(() => false),
  applyPluginAutoEnable: vi.fn(({ config }) => ({ config, changes: [] })),
  buildChannelAccountSnapshot: vi.fn(),
  getChannelActivity: vi.fn(),
  collectChannelStatusIssues: vi.fn(() => []),
  applyPairingApprovalToConfig: vi.fn(),
  getPairingAdapter: vi.fn(),
  notifyPairingApproved: vi.fn(),
  approveChannelPairingRequestById: vi.fn(),
  rejectChannelPairingRequest: vi.fn(),
  removeChannelAllowFromStoreEntry: vi.fn(),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
    readConfigFileSnapshot: mocks.readConfigFileSnapshot,
    writeConfigFile: mocks.writeConfigFile,
  };
});

vi.mock("../../channels/plugins/index.js", () => ({
  listChannelPlugins: mocks.listChannelPlugins,
  getChannelPlugin: mocks.getChannelPlugin,
  normalizeChannelId: mocks.normalizeChannelId,
}));

vi.mock("../../channels/plugins/pairing.js", () => ({
  applyPairingApprovalToConfig: mocks.applyPairingApprovalToConfig,
  getPairingAdapter: mocks.getPairingAdapter,
  notifyPairingApproved: mocks.notifyPairingApproved,
}));

vi.mock("../../channels/registry.js", () => ({
  listChatChannels: mocks.listChatChannels,
}));

vi.mock("../../config/channel-configured.js", () => ({
  isChannelConfigured: mocks.isChannelConfigured,
}));

vi.mock("../../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: mocks.applyPluginAutoEnable,
}));

vi.mock("../../channels/plugins/status.js", () => ({
  buildChannelAccountSnapshot: mocks.buildChannelAccountSnapshot,
}));

vi.mock("../../infra/channel-activity.js", () => ({
  getChannelActivity: mocks.getChannelActivity,
}));

vi.mock("../../infra/channels-status-issues.js", () => ({
  collectChannelStatusIssues: mocks.collectChannelStatusIssues,
}));

vi.mock("../../pairing/pairing-store.js", () => ({
  approveChannelPairingRequestById: mocks.approveChannelPairingRequestById,
  rejectChannelPairingRequest: mocks.rejectChannelPairingRequest,
  removeChannelAllowFromStoreEntry: mocks.removeChannelAllowFromStoreEntry,
}));

import { ErrorCodes } from "../protocol/index.js";
import { channelsHandlers } from "./channels.js";

function createOptions(
  method: "channels.pairing.approve" | "channels.pairing.reject",
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
      logGateway: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    },
    ...overrides,
  } as unknown as GatewayRequestHandlerOptions;
}

describe("channelsHandlers channel pairing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({});
    mocks.applyPairingApprovalToConfig.mockImplementation(async ({ cfg }) => cfg);
    mocks.getPairingAdapter.mockReturnValue({ idLabel: "telegramUserId" });
    mocks.notifyPairingApproved.mockResolvedValue(undefined);
    mocks.removeChannelAllowFromStoreEntry.mockResolvedValue(undefined);
    mocks.approveChannelPairingRequestById.mockResolvedValue({
      id: "6074269928",
      entry: {
        id: "6074269928",
        code: "PAIR1234",
        createdAt: "2026-04-07T10:00:00.000Z",
        lastSeenAt: "2026-04-07T10:00:00.000Z",
        meta: { accountId: "default" },
      },
    });
    mocks.rejectChannelPairingRequest.mockResolvedValue({
      id: "6074269928",
      entry: {
        id: "6074269928",
        code: "PAIR1234",
        createdAt: "2026-04-07T10:00:00.000Z",
        lastSeenAt: "2026-04-07T10:00:00.000Z",
        meta: { accountId: "alerts" },
      },
    });
  });

  it("approves Telegram pairing requests and persists the allowlist config", async () => {
    const currentCfg = {
      channels: {
        telegram: {
          dmPolicy: "pairing",
        },
      },
    };
    const nextCfg = {
      channels: {
        telegram: {
          dmPolicy: "allowlist",
          allowFrom: ["6074269928"],
        },
      },
    };
    mocks.loadConfig.mockReturnValue(currentCfg);
    mocks.applyPairingApprovalToConfig.mockResolvedValue(nextCfg);
    const respond = vi.fn();
    const context = {
      logGateway: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    };

    await channelsHandlers["channels.pairing.approve"](
      createOptions(
        "channels.pairing.approve",
        {
          channel: "telegram",
          requestId: "6074269928",
          accountId: "default",
        },
        {
          respond,
          context: context as never,
        },
      ),
    );

    expect(mocks.approveChannelPairingRequestById).toHaveBeenCalledWith({
      channel: "telegram",
      requestId: "6074269928",
      accountId: "default",
    });
    expect(mocks.applyPairingApprovalToConfig).toHaveBeenCalledWith({
      channelId: "telegram",
      id: "6074269928",
      cfg: currentCfg,
      accountId: "default",
    });
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(nextCfg);
    expect(mocks.removeChannelAllowFromStoreEntry).toHaveBeenCalledWith({
      channel: "telegram",
      entry: "6074269928",
      accountId: "default",
    });
    expect(mocks.notifyPairingApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "telegram",
        id: "6074269928",
        cfg: nextCfg,
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        channel: "telegram",
        accountId: "default",
        requestId: "6074269928",
      },
      undefined,
    );
  });

  it("rejects Telegram pairing requests by request id", async () => {
    const respond = vi.fn();

    await channelsHandlers["channels.pairing.reject"](
      createOptions(
        "channels.pairing.reject",
        {
          channel: "telegram",
          requestId: "6074269928",
        },
        { respond },
      ),
    );

    expect(mocks.rejectChannelPairingRequest).toHaveBeenCalledWith({
      channel: "telegram",
      requestId: "6074269928",
    });
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    expect(mocks.notifyPairingApproved).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        channel: "telegram",
        accountId: "alerts",
        requestId: "6074269928",
      },
      undefined,
    );
  });

  it("returns invalid_request when the pairing request does not exist", async () => {
    mocks.approveChannelPairingRequestById.mockResolvedValueOnce(null);
    const respond = vi.fn();

    await channelsHandlers["channels.pairing.approve"](
      createOptions(
        "channels.pairing.approve",
        {
          channel: "telegram",
          requestId: "missing",
        },
        { respond },
      ),
    );

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: "unknown requestId",
      }),
    );
  });
});
