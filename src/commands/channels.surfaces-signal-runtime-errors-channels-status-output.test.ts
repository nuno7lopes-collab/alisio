import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectStatusIssuesFromLastError } from "../plugin-sdk/status-helpers.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createChannelTestPluginBase, createTestRegistry } from "../test-utils/channel-plugins.js";
import { createIMessageTestPlugin } from "../test-utils/imessage-test-plugin.js";
import { formatGatewayChannelsStatusLines } from "./channels/status.js";

const signalPlugin = {
  ...createChannelTestPluginBase({ id: "signal" }),
  status: {
    collectStatusIssues: (accounts: Parameters<typeof collectStatusIssuesFromLastError>[1]) =>
      collectStatusIssuesFromLastError("signal", accounts),
  },
};

const discordPlugin = {
  ...createChannelTestPluginBase({ id: "discord" }),
  status: {
    collectStatusIssues: (accounts: Parameters<typeof collectStatusIssuesFromLastError>[1]) =>
      collectStatusIssuesFromLastError("discord", accounts),
  },
};

describe("channels command", () => {
  beforeEach(() => {
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "signal", source: "test", plugin: signalPlugin }]),
    );
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
  });

  it("hides Signal runtime errors from the default channels status surface", () => {
    const lines = formatGatewayChannelsStatusLines({
      channelAccounts: {
        signal: [
          {
            accountId: "default",
            enabled: true,
            configured: true,
            running: false,
            lastError: "signal-cli unreachable",
          },
        ],
      },
    });
    expect(lines.join("\n")).not.toMatch(/Warnings:/);
    expect(lines.join("\n")).not.toMatch(/signal/i);
  });

  it("hides iMessage runtime errors from the default channels status surface", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "imessage",
          source: "test",
          plugin: createIMessageTestPlugin(),
        },
      ]),
    );
    const lines = formatGatewayChannelsStatusLines({
      channelAccounts: {
        imessage: [
          {
            accountId: "default",
            enabled: true,
            configured: true,
            running: false,
            lastError: "imsg permission denied",
          },
        ],
      },
    });
    expect(lines.join("\n")).not.toMatch(/Warnings:/);
    expect(lines.join("\n")).not.toMatch(/imessage/i);
  });

  it("still surfaces Discord runtime errors in channels status output", () => {
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "discord", source: "test", plugin: discordPlugin }]),
    );

    const lines = formatGatewayChannelsStatusLines({
      channelAccounts: {
        discord: [
          {
            accountId: "default",
            enabled: true,
            configured: true,
            running: false,
            lastError: "gateway unreachable",
          },
        ],
      },
    });
    expect(lines.join("\n")).toMatch(/Warnings:/);
    expect(lines.join("\n")).toMatch(/discord/i);
    expect(lines.join("\n")).toMatch(/Channel error/i);
  });
});
