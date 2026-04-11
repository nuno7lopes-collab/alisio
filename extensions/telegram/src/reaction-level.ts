import type { AlisioConfig } from "alisio/plugin-sdk/config-runtime";
import {
  resolveReactionLevel,
  type ReactionLevel,
  type ResolvedReactionLevel as BaseResolvedReactionLevel,
} from "alisio/plugin-sdk/text-runtime";
import { resolveTelegramAccount } from "./accounts.js";

export type TelegramReactionLevel = ReactionLevel;
export type ResolvedReactionLevel = BaseResolvedReactionLevel;

/**
 * Resolve the effective reaction level and its implications.
 */
export function resolveTelegramReactionLevel(params: {
  cfg: AlisioConfig;
  accountId?: string;
}): ResolvedReactionLevel {
  const account = resolveTelegramAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return resolveReactionLevel({
    value: account.config.reactionLevel,
    defaultLevel: "minimal",
    invalidFallback: "ack",
  });
}
