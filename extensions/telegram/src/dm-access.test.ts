import type { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TelegramOwnerOnboardingSession = {
  token: string;
  deepLink: string | null;
  startCommand: string;
  createdAtMs: number;
  expiresAtMs: number;
  botUsername: string | null;
};

const createChannelPairingChallengeIssuerMock = vi.hoisted(() => vi.fn());
const upsertChannelPairingRequestMock = vi.hoisted(() =>
  vi.fn(async () => ({ code: "123456", created: true })),
);
const addChannelAllowFromStoreEntryMock = vi.hoisted(() =>
  vi.fn(async () => ({ changed: true, allowFrom: ["12345"] })),
);
const removeChannelAllowFromStoreEntryMock = vi.hoisted(() => vi.fn(async () => undefined));
const rejectChannelPairingRequestMock = vi.hoisted(() => vi.fn(async () => undefined));
const persistTelegramOwnerAllowlistFromRuntimeMock = vi.hoisted(() => vi.fn(async () => undefined));
const readTelegramOwnerOnboardingMock = vi.hoisted(() =>
  vi.fn<() => Promise<TelegramOwnerOnboardingSession | null>>(async () => null),
);
const clearTelegramOwnerOnboardingMock = vi.hoisted(() => vi.fn(async () => undefined));
const withTelegramApiErrorLoggingMock = vi.hoisted(() => vi.fn(async ({ fn }) => await fn()));
const createPairingPrefixStripperMock = vi.hoisted(
  () => (prefix: RegExp, normalize: (value: string) => string) => (value: string) =>
    normalize(value.replace(prefix, "")),
);

vi.mock("openclaw/plugin-sdk/channel-pairing", () => ({
  createChannelPairingChallengeIssuer: createChannelPairingChallengeIssuerMock,
  createPairingPrefixStripper: createPairingPrefixStripperMock,
  createLoggedPairingApprovalNotifier: () => undefined,
  createTextPairingAdapter: () => undefined,
  createChannelPairingController: () => ({}),
}));

vi.mock("openclaw/plugin-sdk/conversation-runtime", () => ({
  addChannelAllowFromStoreEntry: addChannelAllowFromStoreEntryMock,
  removeChannelAllowFromStoreEntry: removeChannelAllowFromStoreEntryMock,
  rejectChannelPairingRequest: rejectChannelPairingRequestMock,
  upsertChannelPairingRequest: upsertChannelPairingRequestMock,
  createStaticReplyToModeResolver: (mode: string) => () => mode,
  createTopLevelChannelReplyToModeResolver: () => () => "off",
  createScopedAccountReplyToModeResolver: () => () => "off",
  resolvePinnedMainDmOwnerFromAllowlist: () => undefined,
}));

vi.mock("./api-logging.js", () => ({
  withTelegramApiErrorLogging: withTelegramApiErrorLoggingMock,
}));

vi.mock("./owner-allowlist.js", () => ({
  buildTelegramOwnerAllowlistConfig: (params: { cfg: unknown }) => params.cfg,
  persistTelegramOwnerAllowlistFromRuntime: persistTelegramOwnerAllowlistFromRuntimeMock,
}));

vi.mock("./owner-onboarding.js", () => ({
  readTelegramOwnerOnboarding: readTelegramOwnerOnboardingMock,
  clearTelegramOwnerOnboarding: clearTelegramOwnerOnboardingMock,
}));

import type { Message } from "@grammyjs/types";
import { normalizeAllowFrom } from "./bot-access.js";
let enforceTelegramDmAccess: typeof import("./dm-access.js").enforceTelegramDmAccess;

function createDmMessage(overrides: Partial<Message> = {}): Message {
  return {
    message_id: 1,
    date: 1,
    chat: { id: 42, type: "private" },
    from: {
      id: 12345,
      is_bot: false,
      first_name: "Test",
      username: "tester",
    },
    text: "hello",
    ...overrides,
  } as Message;
}

describe("enforceTelegramDmAccess", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    readTelegramOwnerOnboardingMock.mockResolvedValue(null);
    ({ enforceTelegramDmAccess } = await import("./dm-access.js"));
  });

  it("allows DMs when policy is open", async () => {
    const bot = { api: { sendMessage: vi.fn(async () => undefined) } };

    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "open",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom([]),
      accountId: "main",
      bot: bot as never,
      logger: { info: vi.fn() },
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(true);
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks DMs when policy is disabled", async () => {
    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "disabled",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom([]),
      accountId: "main",
      bot: { api: { sendMessage: vi.fn(async () => undefined) } } as never,
      logger: { info: vi.fn() },
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(false);
  });

  it("allows DMs for allowlisted senders under pairing policy", async () => {
    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "pairing",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom(["12345"]),
      accountId: "main",
      bot: { api: { sendMessage: vi.fn(async () => undefined) } } as never,
      logger: { info: vi.fn() },
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(true);
    expect(createChannelPairingChallengeIssuerMock).not.toHaveBeenCalled();
  });

  it("issues a pairing challenge for unauthorized DMs under pairing policy", async () => {
    const sendMessage = vi.fn(async () => undefined);
    const logger = { info: vi.fn() };
    createChannelPairingChallengeIssuerMock.mockReturnValueOnce(
      ({
        sendPairingReply,
        onCreated,
        buildReplyText,
      }: Parameters<ReturnType<typeof createChannelPairingChallengeIssuer>>[0]) =>
        (async () => {
          onCreated?.({ code: "123456" });
          await sendPairingReply(
            buildReplyText?.({
              code: "123456",
              senderIdLine: "Your Telegram user id: 12345",
            }) ?? "fallback",
          );
        })(),
    );

    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "pairing",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom([]),
      accountId: "main",
      bot: { api: { sendMessage } } as never,
      logger,
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [firstCall] = sendMessage.mock.calls as Array<unknown[]>;
    expect(firstCall?.[0]).toBe(42);
    const sentText = String(firstCall?.[1] ?? "");
    expect(sentText).toContain("this Telegram account is waiting for approval");
    expect(sentText).toContain("Your Telegram user id: 12345");
    expect(sentText).toContain("approve this Telegram request in Channels");
    expect(sentText).not.toContain("Pairing code:");
    expect(firstCall?.[2]).toEqual(expect.objectContaining({ parse_mode: "HTML" }));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "42",
        senderUserId: "12345",
        username: "tester",
      }),
      "telegram pairing request",
    );
  });

  it("aprova o deep link de setup sem emitir desafio de pairing", async () => {
    readTelegramOwnerOnboardingMock.mockResolvedValueOnce({
      token: "SETUP12345",
      deepLink: "https://t.me/alizio_bot?start=SETUP12345",
      startCommand: "/start SETUP12345",
      createdAtMs: 1,
      expiresAtMs: 2,
      botUsername: "alizio_bot",
    });
    const effectiveDmAllow = normalizeAllowFrom([]);

    const sendMessage = vi.fn(async () => undefined);
    const logger = { info: vi.fn() };

    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "pairing",
      msg: createDmMessage({ text: "/start SETUP12345" }),
      chatId: 42,
      effectiveDmAllow,
      accountId: "main",
      bot: { api: { sendMessage } } as never,
      logger,
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(false);
    expect(addChannelAllowFromStoreEntryMock).toHaveBeenCalledWith({
      channel: "telegram",
      entry: "12345",
      accountId: "main",
    });
    expect(persistTelegramOwnerAllowlistFromRuntimeMock).toHaveBeenCalledWith({
      accountId: "main",
      telegramUserId: "12345",
    });
    expect(removeChannelAllowFromStoreEntryMock).toHaveBeenCalledWith({
      channel: "telegram",
      entry: "12345",
      accountId: "main",
    });
    expect(rejectChannelPairingRequestMock).toHaveBeenCalledWith({
      channel: "telegram",
      requestId: "12345",
      accountId: "main",
    });
    expect(clearTelegramOwnerOnboardingMock).toHaveBeenCalledWith({
      accountId: "main",
    });
    expect(effectiveDmAllow.entries).toContain("12345");
    expect(effectiveDmAllow.hasEntries).toBe(true);
    expect(createChannelPairingChallengeIssuerMock).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      42,
      expect.stringContaining("Telegram is ready"),
      expect.objectContaining({ parse_mode: "HTML" }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "42",
        senderUserId: "12345",
        username: "tester",
      }),
      "telegram owner onboarding approved",
    );
  });
});
