import type { ChannelAccountSnapshot } from "alisio/plugin-sdk/channel-contract";
import { describe, expect, it } from "vitest";
import { collectDiscordStatusIssues } from "./status-issues.js";

describe("collectDiscordStatusIssues", () => {
  it("reports disabled message content intent and unresolved channel ids", () => {
    const issues = collectDiscordStatusIssues([
      {
        accountId: "ops",
        enabled: true,
        configured: true,
        application: {
          intents: {
            messageContent: "disabled",
          },
        },
        audit: {
          unresolvedChannels: 2,
        },
      } as ChannelAccountSnapshot,
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "discord",
          accountId: "ops",
          kind: "intent",
        }),
        expect.objectContaining({
          channel: "discord",
          accountId: "ops",
          kind: "config",
        }),
      ]),
    );
  });

  it("reports channel permission failures with match metadata", () => {
    const issues = collectDiscordStatusIssues([
      {
        accountId: "ops",
        enabled: true,
        configured: true,
        audit: {
          channels: [
            {
              channelId: "123",
              ok: false,
              missing: ["ViewChannel", "SendMessages"],
              error: "403",
              matchKey: "alerts",
              matchSource: "guilds.ops.channels",
            },
          ],
        },
      } as ChannelAccountSnapshot,
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      channel: "discord",
      accountId: "ops",
      kind: "permissions",
    });
    expect(issues[0]?.message).toContain("Channel 123 permission check failed");
    expect(issues[0]?.message).toContain("alerts");
    expect(issues[0]?.message).toContain("guilds.ops.channels");
  });

  it("ignores accounts that are not enabled and configured", () => {
    expect(
      collectDiscordStatusIssues([
        {
          accountId: "ops",
          enabled: false,
          configured: true,
        } as ChannelAccountSnapshot,
      ]),
    ).toEqual([]);
  });

  it("reports disconnected runtime state with reconnect guidance", () => {
    const issues = collectDiscordStatusIssues([
      {
        accountId: "ops",
        enabled: true,
        configured: true,
        running: true,
        connected: false,
        reconnectAttempts: 4,
        lastError: "gateway closed",
      } as ChannelAccountSnapshot,
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        channel: "discord",
        accountId: "ops",
        kind: "runtime",
        message: "Discord gateway disconnected (reconnectAttempts=4): gateway closed",
      }),
    ]);
    expect(issues[0]?.fix).toContain("channels status --probe");
  });

  it("reports reconnecting runtime state explicitly", () => {
    const issues = collectDiscordStatusIssues([
      {
        accountId: "ops",
        enabled: true,
        configured: true,
        running: true,
        connected: false,
        reconnectAttempts: 2,
        healthState: "reconnecting",
        lastError: "hello-timeout",
      } as ChannelAccountSnapshot,
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        channel: "discord",
        accountId: "ops",
        kind: "runtime",
        message: "Discord gateway reconnecting (reconnectAttempts=2): hello-timeout",
      }),
    ]);
  });

  it("redacts sensitive runtime error details", () => {
    const raw = "OPENAI_API_KEY=sk-1234567890abcdef";
    const issues = collectDiscordStatusIssues([
      {
        accountId: "ops",
        enabled: true,
        configured: true,
        running: true,
        connected: false,
        lastError: raw,
      } as ChannelAccountSnapshot,
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("OPENAI_API_KEY=sk-123…cdef");
    expect(issues[0]?.message).not.toContain(raw);
  });
});
