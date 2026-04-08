import type { RequestClient } from "@buape/carbon";
import { describe, expect, it } from "vitest";
import { createDiscordRestClient } from "./client.js";

type DiscordClientConfig = NonNullable<Parameters<typeof createDiscordRestClient>[1]>;

describe("createDiscordRestClient error messaging", () => {
  it("surfaces an actionable config path for missing account tokens", () => {
    const fakeRest = {} as RequestClient;
    const cfg = {
      channels: {
        discord: {
          accounts: {
            ops: {},
          },
        },
      },
    } as DiscordClientConfig;

    expect(() =>
      createDiscordRestClient(
        {
          accountId: "ops",
          rest: fakeRest,
        },
        cfg,
      ),
    ).toThrow(
      'Discord bot token missing for account "ops" (set channels.discord.accounts.ops.token or DISCORD_BOT_TOKEN for the default account).',
    );
  });
});
