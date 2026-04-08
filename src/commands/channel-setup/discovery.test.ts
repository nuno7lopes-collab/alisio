import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginAutoEnableResult } from "../../config/plugin-auto-enable.js";

const loadPluginManifestRegistry = vi.hoisted(() => vi.fn());
const listChannelPluginCatalogEntries = vi.hoisted(() => vi.fn());
const listChatChannels = vi.hoisted(() => vi.fn());
const applyPluginAutoEnable = vi.hoisted(() =>
  vi.fn<(args: { config: unknown; env?: NodeJS.ProcessEnv }) => PluginAutoEnableResult>(
    ({ config }) => ({ config: config as never, changes: [] as string[] }),
  ),
);

vi.mock("../../plugins/manifest-registry.js", () => ({
  loadPluginManifestRegistry: (...args: unknown[]) => loadPluginManifestRegistry(...args),
}));

vi.mock("../../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: (args: unknown) =>
    applyPluginAutoEnable(args as { config: unknown; env?: NodeJS.ProcessEnv }),
}));

vi.mock("../../channels/plugins/catalog.js", () => ({
  listChannelPluginCatalogEntries: (...args: unknown[]) => listChannelPluginCatalogEntries(...args),
}));

vi.mock("../../channels/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../channels/registry.js")>();
  return {
    ...actual,
    listChatChannels: (...args: unknown[]) => listChatChannels(...args),
  };
});

import { listManifestInstalledChannelIds, resolveChannelSetupEntries } from "./discovery.js";

describe("listManifestInstalledChannelIds", () => {
  beforeEach(() => {
    loadPluginManifestRegistry.mockReset();
    listChannelPluginCatalogEntries.mockReset();
    listChatChannels.mockReset();
    applyPluginAutoEnable
      .mockReset()
      .mockImplementation(({ config }) => ({ config: config as never, changes: [] as string[] }));
  });

  it("uses the auto-enabled config snapshot for manifest discovery", () => {
    const autoEnabledConfig = {
      channels: { slack: { enabled: true } },
      plugins: { allow: ["slack"] },
      autoEnabled: true,
    } as never;
    applyPluginAutoEnable.mockReturnValue({
      config: autoEnabledConfig,
      changes: ["slack"] as string[],
    });
    loadPluginManifestRegistry.mockReturnValue({
      plugins: [{ id: "slack", channels: ["slack"] }],
      diagnostics: [],
    });

    const installedIds = listManifestInstalledChannelIds({
      cfg: {} as never,
      workspaceDir: "/tmp/workspace",
      env: { OPENCLAW_HOME: "/tmp/home" } as NodeJS.ProcessEnv,
    });

    expect(applyPluginAutoEnable).toHaveBeenCalledWith({
      config: {},
      env: { OPENCLAW_HOME: "/tmp/home" },
    });
    expect(loadPluginManifestRegistry).toHaveBeenCalledWith({
      config: autoEnabledConfig,
      workspaceDir: "/tmp/workspace",
      env: { OPENCLAW_HOME: "/tmp/home" },
    });
    expect(installedIds).toEqual(new Set(["slack"]));
  });

  it("filters setup discovery to telegram, whatsapp, and discord", () => {
    loadPluginManifestRegistry.mockReturnValue({
      plugins: [],
      diagnostics: [],
    });
    listChatChannels.mockReturnValue([
      {
        id: "telegram",
        label: "Telegram",
        selectionLabel: "Telegram",
        docsPath: "/channels/telegram",
        blurb: "Telegram",
      },
      {
        id: "whatsapp",
        label: "WhatsApp",
        selectionLabel: "WhatsApp",
        docsPath: "/channels/whatsapp",
        blurb: "WhatsApp",
      },
      {
        id: "discord",
        label: "Discord",
        selectionLabel: "Discord",
        docsPath: "/channels/discord",
        blurb: "Discord",
      },
      {
        id: "slack",
        label: "Slack",
        selectionLabel: "Slack",
        docsPath: "/channels/slack",
        blurb: "Slack",
      },
    ]);
    listChannelPluginCatalogEntries.mockReturnValue([
      {
        id: "discord",
        meta: {
          id: "discord",
          label: "Discord",
          selectionLabel: "Discord",
          docsPath: "/channels/discord",
          blurb: "Discord",
        },
      },
      {
        id: "slack",
        meta: {
          id: "slack",
          label: "Slack",
          selectionLabel: "Slack",
          docsPath: "/channels/slack",
          blurb: "Slack",
        },
      },
    ]);

    const resolved = resolveChannelSetupEntries({
      cfg: {} as never,
      installedPlugins: [
        {
          id: "telegram",
          meta: {
            id: "telegram",
            label: "Telegram",
            selectionLabel: "Telegram",
            docsPath: "/channels/telegram",
            blurb: "Telegram",
          },
        },
        {
          id: "slack",
          meta: {
            id: "slack",
            label: "Slack",
            selectionLabel: "Slack",
            docsPath: "/channels/slack",
            blurb: "Slack",
          },
        },
      ] as never,
      workspaceDir: "/tmp/workspace",
    });

    expect(resolved.entries.map((entry) => entry.id)).toEqual(["telegram", "whatsapp", "discord"]);
    expect(resolved.installableCatalogEntries.map((entry) => entry.id)).toEqual(["discord"]);
  });

  it("can expose the broader setup catalog behind the product-surface flag", () => {
    loadPluginManifestRegistry.mockReturnValue({
      plugins: [],
      diagnostics: [],
    });
    listChatChannels.mockReturnValue([
      {
        id: "telegram",
        label: "Telegram",
        selectionLabel: "Telegram",
        docsPath: "/channels/telegram",
        blurb: "Telegram",
      },
      {
        id: "slack",
        label: "Slack",
        selectionLabel: "Slack",
        docsPath: "/channels/slack",
        blurb: "Slack",
      },
    ]);
    listChannelPluginCatalogEntries.mockReturnValue([
      {
        id: "slack",
        meta: {
          id: "slack",
          label: "Slack",
          selectionLabel: "Slack",
          docsPath: "/channels/slack",
          blurb: "Slack",
        },
      },
    ]);

    const resolved = resolveChannelSetupEntries({
      cfg: {} as never,
      installedPlugins: [] as never,
      workspaceDir: "/tmp/workspace",
      env: {
        OPENCLAW_CHANNEL_SURFACE: "all",
      } as NodeJS.ProcessEnv,
    });

    expect(resolved.entries.map((entry) => entry.id)).toEqual(["telegram", "slack"]);
    expect(resolved.installableCatalogEntries.map((entry) => entry.id)).toEqual(["slack"]);
  });
});
