import type { AlisioConfig } from "alisio/plugin-sdk/config-runtime";
import { DEFAULT_ACCOUNT_ID } from "alisio/plugin-sdk/setup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWizardPrompter,
  runSetupWizardFinalize,
  runSetupWizardPrepare,
} from "../../../test/helpers/plugins/setup-wizard.js";
const readChannelAllowFromStore = vi.hoisted(() => vi.fn(async () => [] as string[]));
const listChannelPairingRequests = vi.hoisted(() => vi.fn(async () => [] as Array<{ id: string }>));
const beginTelegramOwnerOnboarding = vi.hoisted(() =>
  vi.fn(async () => ({
    token: "SETUP12345",
    deepLink: "https://t.me/alizio_bot?start=SETUP12345",
    startCommand: "/start SETUP12345",
    createdAtMs: 1,
    expiresAtMs: 2,
    botUsername: "alizio_bot",
  })),
);
const clearTelegramOwnerOnboarding = vi.hoisted(() => vi.fn(async () => undefined));
const probeTelegram = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, elapsedMs: 1, bot: { username: "alizio_bot" } })),
);

vi.mock("alisio/plugin-sdk/conversation-runtime", () => ({
  readChannelAllowFromStore,
  listChannelPairingRequests,
}));

vi.mock("./owner-onboarding.js", () => ({
  beginTelegramOwnerOnboarding,
  clearTelegramOwnerOnboarding,
}));

vi.mock("./probe.js", () => ({
  probeTelegram,
}));

import { resolveTelegramAllowFromEntries } from "./setup-core.js";
import { telegramSetupWizard } from "./setup-surface.js";

async function runPrepare(cfg: AlisioConfig, accountId: string) {
  return await runSetupWizardPrepare({
    prepare: telegramSetupWizard.prepare,
    cfg,
    accountId,
    options: {},
  });
}

async function runFinalize(cfg: AlisioConfig, accountId: string) {
  const note = vi.fn(async () => undefined);

  const result = await runSetupWizardFinalize({
    finalize: telegramSetupWizard.finalize,
    cfg,
    accountId,
    prompter: createTestWizardPrompter({ note }),
  });

  return { note, result };
}

function expectPreparedResult(
  prepared: Awaited<ReturnType<typeof runPrepare>>,
): { cfg: AlisioConfig } & Exclude<Awaited<ReturnType<typeof runPrepare>>, void | undefined> {
  expect(prepared).toBeDefined();
  if (
    !prepared ||
    typeof prepared !== "object" ||
    !("cfg" in prepared) ||
    prepared.cfg === undefined
  ) {
    throw new Error("Expected prepare result with cfg");
  }
  return prepared as { cfg: AlisioConfig } & Exclude<
    Awaited<ReturnType<typeof runPrepare>>,
    void | undefined
  >;
}

beforeEach(() => {
  readChannelAllowFromStore.mockReset();
  listChannelPairingRequests.mockReset();
  beginTelegramOwnerOnboarding.mockClear();
  clearTelegramOwnerOnboarding.mockClear();
  probeTelegram.mockClear();
  readChannelAllowFromStore.mockResolvedValue([]);
  listChannelPairingRequests.mockResolvedValue([]);
});

describe("telegramSetupWizard.prepare", () => {
  it('adds groups["*"].requireMention=true for fresh setups', async () => {
    const prepared = expectPreparedResult(
      await runPrepare(
        {
          channels: {
            telegram: {
              botToken: "tok",
            },
          },
        },
        DEFAULT_ACCOUNT_ID,
      ),
    );

    expect(prepared.cfg.channels?.telegram?.groups).toEqual({
      "*": { requireMention: true },
    });
  });

  it("preserves an explicit wildcard group mention setting", async () => {
    const prepared = expectPreparedResult(
      await runPrepare(
        {
          channels: {
            telegram: {
              botToken: "tok",
              groups: {
                "*": { requireMention: false },
              },
            },
          },
        },
        DEFAULT_ACCOUNT_ID,
      ),
    );

    expect(prepared.cfg.channels?.telegram?.groups).toEqual({
      "*": { requireMention: false },
    });
  });
});

describe("telegramSetupWizard.finalize", () => {
  it("shows first-DM guidance for the default account", async () => {
    const { note } = await runFinalize(
      {
        channels: {
          telegram: {
            botToken: "tok",
          },
        },
      },
      DEFAULT_ACCOUNT_ID,
    );

    expect(note).toHaveBeenCalledWith(
      expect.stringContaining("https://t.me/alizio_bot?start=SETUP12345"),
      "Finish Telegram setup",
    );
    expect(note).toHaveBeenCalledWith(
      expect.stringContaining("/start SETUP12345"),
      "Finish Telegram setup",
    );
  });

  it("shows the same onboarding guidance for named accounts", async () => {
    const { note } = await runFinalize(
      {
        channels: {
          telegram: {
            accounts: {
              alerts: {
                botToken: "tok",
              },
            },
          },
        },
      },
      "alerts",
    );

    expect(note).toHaveBeenCalledWith(
      expect.stringContaining("Now Alisio needs to confirm which Telegram account is yours."),
      "Finish Telegram setup",
    );
    expect(beginTelegramOwnerOnboarding).toHaveBeenCalledWith({
      accountId: "alerts",
      botUsername: "alizio_bot",
    });
    expect(probeTelegram).toHaveBeenCalledWith("tok", 2500, {
      accountId: "alerts",
      proxyUrl: undefined,
      network: undefined,
      apiRoot: undefined,
    });
  });

  it("keeps stale Telegram requests pending instead of auto-approving them", async () => {
    listChannelPairingRequests.mockResolvedValue([{ id: "6074269928" }]);

    const { note, result } = await runFinalize(
      {
        channels: {
          telegram: {
            botToken: "tok",
          },
        },
      },
      DEFAULT_ACCOUNT_ID,
    );

    expect(result).toBeUndefined();
    expect(note).toHaveBeenCalledWith(
      expect.stringContaining("https://t.me/alizio_bot?start=SETUP12345"),
      "Finish Telegram setup",
    );
  });

  it("skips the warning when an allowFrom entry already exists", async () => {
    const { note } = await runFinalize(
      {
        channels: {
          telegram: {
            botToken: "tok",
            allowFrom: ["123"],
          },
        },
      },
      DEFAULT_ACCOUNT_ID,
    );

    expect(note).not.toHaveBeenCalled();
  });
});

describe("telegramSetupWizard.afterConfigWritten", () => {
  it("does not clear Telegram onboarding while pairing is still pending", async () => {
    await telegramSetupWizard.afterConfigWritten?.({
      previousCfg: {},
      cfg: {
        channels: {
          telegram: {
            botToken: "tok",
          },
        },
      },
      accountId: DEFAULT_ACCOUNT_ID,
      runtime: {} as never,
    });

    expect(clearTelegramOwnerOnboarding).not.toHaveBeenCalled();
  });

  it("clears stale Telegram onboarding once an allowFrom entry already exists", async () => {
    await telegramSetupWizard.afterConfigWritten?.({
      previousCfg: {},
      cfg: {
        channels: {
          telegram: {
            botToken: "tok",
            allowFrom: ["123"],
          },
        },
      },
      accountId: DEFAULT_ACCOUNT_ID,
      runtime: {} as never,
    });

    expect(clearTelegramOwnerOnboarding).toHaveBeenCalledWith({
      accountId: DEFAULT_ACCOUNT_ID,
    });
  });
});

describe("resolveTelegramAllowFromEntries", () => {
  it("passes apiRoot through username lookups", async () => {
    const globalFetch = vi.fn(async () => {
      throw new Error("global fetch should not be called");
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { id: 12345 } }),
    }));
    vi.stubGlobal("fetch", globalFetch);
    const proxyFetch = vi.fn();
    const fetchModule = await import("./fetch.js");
    const proxyModule = await import("./proxy.js");
    const resolveTelegramFetch = vi.spyOn(fetchModule, "resolveTelegramFetch");
    const makeProxyFetch = vi.spyOn(proxyModule, "makeProxyFetch");
    makeProxyFetch.mockReturnValue(proxyFetch as unknown as typeof fetch);
    resolveTelegramFetch.mockReturnValue(fetchMock as unknown as typeof fetch);

    try {
      const resolved = await resolveTelegramAllowFromEntries({
        entries: ["@user"],
        credentialValue: "tok",
        apiRoot: "https://custom.telegram.test/root/",
        proxyUrl: "http://127.0.0.1:8080",
        network: { autoSelectFamily: false, dnsResultOrder: "ipv4first" },
      });

      expect(resolved).toEqual([{ input: "@user", resolved: true, id: "12345" }]);
      expect(makeProxyFetch).toHaveBeenCalledWith("http://127.0.0.1:8080");
      expect(resolveTelegramFetch).toHaveBeenCalledWith(proxyFetch, {
        network: { autoSelectFamily: false, dnsResultOrder: "ipv4first" },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://custom.telegram.test/root/bottok/getChat?chat_id=%40user",
        undefined,
      );
    } finally {
      makeProxyFetch.mockRestore();
      resolveTelegramFetch.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
