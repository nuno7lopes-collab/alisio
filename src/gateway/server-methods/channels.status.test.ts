import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  applyPluginAutoEnable: vi.fn(),
  listChannelPlugins: vi.fn(),
  listChatChannels: vi.fn(),
  isChannelConfigured: vi.fn(),
  buildChannelAccountSnapshot: vi.fn(),
  getChannelActivity: vi.fn(),
  collectChannelStatusIssues: vi.fn(),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
  };
});

vi.mock("../../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: mocks.applyPluginAutoEnable,
}));

vi.mock("../../config/channel-configured.js", () => ({
  isChannelConfigured: mocks.isChannelConfigured,
}));

vi.mock("../../channels/plugins/index.js", () => ({
  listChannelPlugins: mocks.listChannelPlugins,
  getChannelPlugin: vi.fn(),
  normalizeChannelId: (value: string) => value,
}));

vi.mock("../../channels/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../../channels/registry.js")>(
    "../../channels/registry.js",
  );
  return {
    ...actual,
    listChatChannels: mocks.listChatChannels,
  };
});

vi.mock("../../channels/plugins/status.js", () => ({
  buildChannelAccountSnapshot: mocks.buildChannelAccountSnapshot,
}));

vi.mock("../../infra/channel-activity.js", () => ({
  getChannelActivity: mocks.getChannelActivity,
}));

vi.mock("../../infra/channels-status-issues.js", () => ({
  collectChannelStatusIssues: mocks.collectChannelStatusIssues,
}));

import { channelsHandlers } from "./channels.js";

function createOptions(
  params: Record<string, unknown>,
  overrides?: Partial<GatewayRequestHandlerOptions>,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method: "channels.status", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      getRuntimeSnapshot: () => ({
        channels: {},
        channelAccounts: {},
      }),
      getRunningChannelWizard: () => null,
    },
    ...overrides,
  } as unknown as GatewayRequestHandlerOptions;
}

describe("channelsHandlers channels.status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({});
    mocks.applyPluginAutoEnable.mockImplementation(({ config }) => ({ config, changes: [] }));
    mocks.listChatChannels.mockReturnValue([
      {
        id: "telegram",
        label: "Telegram",
        selectionLabel: "Telegram",
        detailLabel: "Bot, groups, and direct messages",
        docsPath: "/channels/telegram",
        blurb: "Message through a Telegram bot.",
      },
      {
        id: "whatsapp",
        label: "WhatsApp",
        selectionLabel: "WhatsApp",
        detailLabel: "Phone link and QR pairing",
        docsPath: "/channels/whatsapp",
        blurb: "Send and receive WhatsApp messages.",
      },
      {
        id: "discord",
        label: "Discord",
        selectionLabel: "Discord",
        detailLabel: "Server channels, DMs, and threads",
        docsPath: "/channels/discord",
        blurb: "Use Discord servers and DMs.",
      },
      {
        id: "slack",
        label: "Slack",
        selectionLabel: "Slack",
        detailLabel: "Workspace channels and DMs",
        docsPath: "/channels/slack",
        blurb: "Should stay hidden from the public shortlist.",
      },
    ]);
    mocks.isChannelConfigured.mockImplementation(
      (_cfg: unknown, channelId: string) => channelId === "telegram",
    );
    mocks.buildChannelAccountSnapshot.mockResolvedValue({
      accountId: "default",
      configured: true,
    });
    mocks.getChannelActivity.mockReturnValue({
      inboundAt: null,
      outboundAt: null,
    });
    mocks.collectChannelStatusIssues.mockReturnValue([]);
    mocks.listChannelPlugins.mockReturnValue([
      {
        id: "whatsapp",
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => ({}),
          isEnabled: () => true,
          isConfigured: async (_account: unknown, cfg: { autoEnabled?: boolean }) =>
            Boolean(cfg.autoEnabled),
        },
      },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("usa o snapshot auto-enabled e expõe só a shortlist pública", async () => {
    const autoEnabledConfig = { autoEnabled: true };
    mocks.applyPluginAutoEnable.mockReturnValue({ config: autoEnabledConfig, changes: [] });
    const respond = vi.fn();

    await channelsHandlers["channels.status"](
      createOptions(
        { probe: false, timeoutMs: 2000 },
        {
          respond,
        },
      ),
    );

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledWith({
      config: {},
      env: process.env,
    });
    expect(mocks.buildChannelAccountSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: autoEnabledConfig,
        accountId: "default",
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channelSurfaceMode: "focused",
        channelOrder: ["telegram", "whatsapp", "discord"],
        channelMeta: [
          expect.objectContaining({
            id: "telegram",
            docsPath: "/channels/telegram",
          }),
          expect.objectContaining({
            id: "whatsapp",
            docsPath: "/channels/whatsapp",
          }),
          expect.objectContaining({
            id: "discord",
            docsPath: "/channels/discord",
          }),
        ],
        channelIssues: {
          telegram: [
            expect.objectContaining({
              accountId: "default",
              kind: "config",
              message:
                "Channel configuration is saved, but the runtime channel is not loaded on this host yet.",
              fix: "Finish setup or install the channel runtime so the gateway can start it.",
            }),
          ],
        },
        channels: {
          telegram: expect.objectContaining({
            configured: true,
            setupOnly: true,
            setupAvailable: true,
            logoutAvailable: false,
            linkMode: "wizard",
          }),
          whatsapp: expect.objectContaining({
            configured: true,
            setupAvailable: true,
            logoutAvailable: false,
            linkMode: "qr",
          }),
          discord: expect.objectContaining({
            configured: false,
            setupOnly: true,
            setupAvailable: true,
            logoutAvailable: false,
            linkMode: "wizard",
          }),
        },
      }),
      undefined,
    );
  });

  it("sinaliza canais configurados que ficaram apenas em modo setup-only", async () => {
    const autoEnabledConfig = { autoEnabled: true };
    mocks.applyPluginAutoEnable.mockReturnValue({ config: autoEnabledConfig, changes: [] });
    const respond = vi.fn();

    await channelsHandlers["channels.status"](
      createOptions(
        { probe: false, timeoutMs: 2000 },
        {
          respond,
        },
      ),
    );

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channelIssues: expect.objectContaining({
          telegram: [
            expect.objectContaining({
              kind: "config",
              message:
                "Channel configuration is saved, but the runtime channel is not loaded on this host yet.",
            }),
          ],
        }),
      }),
      undefined,
    );
  });

  it("pode expor a superfície alargada no status atrás da flag de product surface", async () => {
    vi.stubEnv("OPENCLAW_CHANNEL_SURFACE", "all");
    const respond = vi.fn();

    await channelsHandlers["channels.status"](
      createOptions(
        { probe: false, timeoutMs: 2000 },
        {
          respond,
        },
      ),
    );

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channelSurfaceMode: "all",
        channelOrder: ["telegram", "whatsapp", "discord", "slack"],
        channelMeta: expect.arrayContaining([
          expect.objectContaining({
            id: "slack",
            docsPath: "/channels/slack",
          }),
        ]),
        channels: expect.objectContaining({
          slack: expect.objectContaining({
            configured: false,
            setupOnly: true,
            setupAvailable: true,
          }),
        }),
      }),
      undefined,
    );
  });

  it("redige lastError nos snapshots e resumos de status", async () => {
    const respond = vi.fn();
    const rawToken = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
    mocks.buildChannelAccountSnapshot.mockResolvedValue({
      accountId: "default",
      configured: true,
      lastError: `Telegram token ${rawToken}`,
    });
    mocks.listChannelPlugins.mockReturnValue([
      {
        id: "whatsapp",
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => ({}),
          isEnabled: () => true,
          isConfigured: async () => true,
        },
        status: {
          buildChannelSummary: () => ({
            configured: true,
            connected: false,
            lastError: `Telegram token ${rawToken}`,
          }),
        },
      },
    ]);

    await channelsHandlers["channels.status"](
      createOptions(
        { probe: false, timeoutMs: 2000 },
        {
          respond,
        },
      ),
    );

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channels: expect.objectContaining({
          whatsapp: expect.objectContaining({
            lastError: "Telegram token 123456…cdef",
          }),
        }),
        channelAccounts: expect.objectContaining({
          whatsapp: [
            expect.objectContaining({
              lastError: "Telegram token 123456…cdef",
            }),
          ],
        }),
      }),
      undefined,
    );
  });

  it("agrupa issues por canal no payload", async () => {
    const respond = vi.fn();
    mocks.collectChannelStatusIssues.mockReturnValue([
      {
        channel: "whatsapp",
        accountId: "default",
        kind: "runtime",
        message: "Channel error: socket closed",
        fix: "Refresh the connection.",
      },
    ]);

    await channelsHandlers["channels.status"](
      createOptions(
        { probe: false, timeoutMs: 2000 },
        {
          respond,
        },
      ),
    );

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        channelIssues: expect.objectContaining({
          whatsapp: [
            expect.objectContaining({
              accountId: "default",
              kind: "runtime",
              message: "Channel error: socket closed",
              fix: "Refresh the connection.",
            }),
          ],
        }),
      }),
      undefined,
    );
  });

  it("expõe o wizard de canal em curso para a UI poder recuperar o setup", async () => {
    const respond = vi.fn();

    await channelsHandlers["channels.status"](
      createOptions(
        { probe: false, timeoutMs: 2000 },
        {
          respond,
          context: {
            getRuntimeSnapshot: () => ({
              channels: {},
              channelAccounts: {},
            }),
            getRunningChannelWizard: () => ({
              sessionId: "wiz-telegram-1",
              channelId: "telegram",
            }),
          } as never,
        },
      ),
    );

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        wizard: {
          running: true,
          sessionId: "wiz-telegram-1",
          channelId: "telegram",
        },
      }),
      undefined,
    );
  });
});
