import { afterEach, describe, expect, it } from "vitest";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createChannelTestPluginBase, createTestRegistry } from "../test-utils/channel-plugins.js";
import {
  filterProductChannelEntries,
  listProductChannelPlugins,
  listProductChatChannels,
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
});
