import { afterEach, describe, expect, it } from "vitest";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createChannelTestPluginBase, createTestRegistry } from "../test-utils/channel-plugins.js";
import {
  CHANNEL_SURFACE_MODE_ENV,
  EXPERIMENTAL_CHANNELS_ENV,
  filterProductChannelEntries,
  listProductChannelPlugins,
  listProductChatChannels,
  resolveProductChannelSurfaceMode,
} from "./product-surface.js";

describe("product channel surface", () => {
  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
  });

  it("keeps the default product shortlist limited to Telegram, WhatsApp, and Discord", () => {
    expect(
      listProductChatChannels()
        .map((channel) => channel.id)
        .toSorted(),
    ).toEqual(["discord", "telegram", "whatsapp"]);
  });

  it("filters generic channel entries by the product shortlist", () => {
    const entries = filterProductChannelEntries([
      { id: "telegram", label: "Telegram" },
      { id: "signal", label: "Signal" },
      { id: "discord", label: "Discord" },
    ]);

    expect(entries).toEqual([
      { id: "telegram", label: "Telegram" },
      { id: "discord", label: "Discord" },
    ]);
  });

  it("filters installed plugin surfaces to product channels only", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "discord",
          source: "test",
          plugin: createChannelTestPluginBase({ id: "discord" }),
        },
        {
          pluginId: "signal",
          source: "test",
          plugin: createChannelTestPluginBase({ id: "signal" }),
        },
      ]),
    );

    expect(listProductChannelPlugins().map((plugin) => plugin.id)).toEqual(["discord"]);
  });

  it("exposes the broader built-in surface when the channel surface flag is enabled", () => {
    expect(
      listProductChatChannels({
        env: {
          [CHANNEL_SURFACE_MODE_ENV]: "all",
        } as NodeJS.ProcessEnv,
      }).map((channel) => channel.id),
    ).toContain("slack");
  });

  it("accepts the legacy experimental flag as an alias for the broader surface", () => {
    expect(
      resolveProductChannelSurfaceMode({
        [EXPERIMENTAL_CHANNELS_ENV]: "1",
      } as NodeJS.ProcessEnv),
    ).toBe("all");
  });
});
