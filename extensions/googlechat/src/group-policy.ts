import { resolveChannelGroupRequireMention } from "alisio/plugin-sdk/channel-policy";
import type { AlisioConfig } from "alisio/plugin-sdk/core";

type GoogleChatGroupContext = {
  cfg: AlisioConfig;
  accountId?: string | null;
  groupId?: string | null;
};

export function resolveGoogleChatGroupRequireMention(params: GoogleChatGroupContext): boolean {
  return resolveChannelGroupRequireMention({
    cfg: params.cfg,
    channel: "googlechat",
    groupId: params.groupId,
    accountId: params.accountId,
  });
}
