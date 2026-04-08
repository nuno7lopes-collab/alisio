import type { Message } from "@grammyjs/types";
import { createChannelPairingChallengeIssuer } from "alisio/plugin-sdk/channel-pairing";
import type { DmPolicy } from "alisio/plugin-sdk/config-runtime";
import {
  addChannelAllowFromStoreEntry,
  rejectChannelPairingRequest,
  removeChannelAllowFromStoreEntry,
  upsertChannelPairingRequest,
} from "alisio/plugin-sdk/conversation-runtime";
import { logVerbose } from "alisio/plugin-sdk/runtime-env";
import type { Bot } from "grammy";
import { withTelegramApiErrorLogging } from "./api-logging.js";
import { resolveSenderAllowMatch, type NormalizedAllowFrom } from "./bot-access.js";
import { renderTelegramHtmlText } from "./format.js";
import { persistTelegramOwnerAllowlistFromRuntime } from "./owner-allowlist.js";
import { clearTelegramOwnerOnboarding, readTelegramOwnerOnboarding } from "./owner-onboarding.js";

type TelegramDmAccessLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
};

type TelegramSenderIdentity = {
  username: string;
  userId: string | null;
  candidateId: string;
  firstName?: string;
  lastName?: string;
};

function resolveTelegramSenderIdentity(msg: Message, chatId: number): TelegramSenderIdentity {
  const from = msg.from;
  const userId = from?.id != null ? String(from.id) : null;
  return {
    username: from?.username ?? "",
    userId,
    candidateId: userId ?? String(chatId),
    firstName: from?.first_name,
    lastName: from?.last_name,
  };
}

function resolveTelegramStartPayload(msg: Message): string | null {
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text) {
    return null;
  }
  const match = text.match(/^\/start(?:@[a-z0-9_]+)?(?:\s+(.+))?$/i);
  const payload = match?.[1]?.trim() || "";
  return payload || null;
}

function buildTelegramPendingApprovalReply(params: { senderIdLine: string }): string {
  return [
    "Alisio: this Telegram account is waiting for approval.",
    "",
    params.senderIdLine,
    "",
    "If you own this bot, open Alisio and approve this Telegram request in Channels.",
  ].join("\n");
}

const TELEGRAM_OWNER_ONBOARDING_APPROVED_MESSAGE =
  "Alisio: Telegram is ready. Send a message to start chatting.";

export async function enforceTelegramDmAccess(params: {
  isGroup: boolean;
  dmPolicy: DmPolicy;
  msg: Message;
  chatId: number;
  effectiveDmAllow: NormalizedAllowFrom;
  accountId: string;
  bot: Bot;
  logger: TelegramDmAccessLogger;
  upsertPairingRequest?: typeof upsertChannelPairingRequest;
}): Promise<boolean> {
  const {
    isGroup,
    dmPolicy,
    msg,
    chatId,
    effectiveDmAllow,
    accountId,
    bot,
    logger,
    upsertPairingRequest,
  } = params;
  if (isGroup) {
    return true;
  }
  if (dmPolicy === "disabled") {
    return false;
  }
  if (dmPolicy === "open") {
    return true;
  }

  const sender = resolveTelegramSenderIdentity(msg, chatId);
  const allowMatch = resolveSenderAllowMatch({
    allow: effectiveDmAllow,
    senderId: sender.candidateId,
    senderUsername: sender.username,
  });
  const allowMatchMeta = `matchKey=${allowMatch.matchKey ?? "none"} matchSource=${
    allowMatch.matchSource ?? "none"
  }`;
  const allowed =
    effectiveDmAllow.hasWildcard || (effectiveDmAllow.hasEntries && allowMatch.allowed);
  if (allowed) {
    return true;
  }

  if (dmPolicy === "pairing") {
    const telegramUserId = sender.userId ?? sender.candidateId;
    const onboardingPayload = resolveTelegramStartPayload(msg);
    const ownerOnboarding =
      telegramUserId && onboardingPayload
        ? await readTelegramOwnerOnboarding({ accountId }).catch(() => null)
        : null;
    if (telegramUserId && ownerOnboarding?.token === onboardingPayload) {
      try {
        await addChannelAllowFromStoreEntry({
          channel: "telegram",
          entry: telegramUserId,
          accountId,
        });
        if (!effectiveDmAllow.entries.includes(telegramUserId)) {
          effectiveDmAllow.entries.push(telegramUserId);
        }
        effectiveDmAllow.hasEntries = true;
        let persistedAllowlist = false;
        try {
          await persistTelegramOwnerAllowlistFromRuntime({
            accountId,
            telegramUserId,
          });
          persistedAllowlist = true;
        } catch (err) {
          logVerbose(
            `telegram setup allowlist persistence failed for chat ${chatId}: ${String(err)}`,
          );
        }
        if (persistedAllowlist) {
          await removeChannelAllowFromStoreEntry({
            channel: "telegram",
            entry: telegramUserId,
            accountId,
          }).catch(() => {});
        }
        await rejectChannelPairingRequest({
          channel: "telegram",
          requestId: telegramUserId,
          accountId,
        }).catch(() => {});
        await clearTelegramOwnerOnboarding({ accountId }).catch(() => {});
        try {
          await withTelegramApiErrorLogging({
            operation: "sendMessage",
            fn: () =>
              bot.api.sendMessage(
                chatId,
                renderTelegramHtmlText(TELEGRAM_OWNER_ONBOARDING_APPROVED_MESSAGE),
                {
                  parse_mode: "HTML",
                },
              ),
          });
        } catch (err) {
          logVerbose(
            `telegram onboarding approval reply failed for chat ${chatId}: ${String(err)}`,
          );
        }
        logger.info(
          {
            chatId: String(chatId),
            senderUserId: sender.userId ?? undefined,
            username: sender.username || undefined,
            firstName: sender.firstName,
            lastName: sender.lastName,
          },
          "telegram owner onboarding approved",
        );
        return false;
      } catch (err) {
        logVerbose(`telegram owner onboarding approval failed for chat ${chatId}: ${String(err)}`);
      }
    }
    try {
      await createChannelPairingChallengeIssuer({
        channel: "telegram",
        upsertPairingRequest: async ({ id, meta }) =>
          await (upsertPairingRequest ?? upsertChannelPairingRequest)({
            channel: "telegram",
            id,
            accountId,
            meta,
          }),
      })({
        senderId: telegramUserId,
        senderIdLine: `Your Telegram user id: ${telegramUserId}`,
        meta: {
          username: sender.username || undefined,
          firstName: sender.firstName,
          lastName: sender.lastName,
        },
        buildReplyText: ({ senderIdLine }) => buildTelegramPendingApprovalReply({ senderIdLine }),
        onCreated: () => {
          logger.info(
            {
              chatId: String(chatId),
              senderUserId: sender.userId ?? undefined,
              username: sender.username || undefined,
              firstName: sender.firstName,
              lastName: sender.lastName,
              matchKey: allowMatch.matchKey ?? "none",
              matchSource: allowMatch.matchSource ?? "none",
            },
            "telegram pairing request",
          );
        },
        sendPairingReply: async (text) => {
          const html = renderTelegramHtmlText(text);
          await withTelegramApiErrorLogging({
            operation: "sendMessage",
            fn: () => bot.api.sendMessage(chatId, html, { parse_mode: "HTML" }),
          });
        },
        onReplyError: (err) => {
          logVerbose(`telegram pairing reply failed for chat ${chatId}: ${String(err)}`);
        },
      });
    } catch (err) {
      logVerbose(`telegram pairing reply failed for chat ${chatId}: ${String(err)}`);
    }
    return false;
  }

  logVerbose(
    `Blocked unauthorized telegram sender ${sender.candidateId} (dmPolicy=${dmPolicy}, ${allowMatchMeta})`,
  );
  return false;
}
