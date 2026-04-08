import { getChannelPlugin } from "../channels/plugins/index.js";
import type { AlisioConfig } from "../config/config.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";

export function resolveApprovalCommandAuthorization(params: {
  cfg: AlisioConfig;
  channel?: string | null;
  accountId?: string | null;
  senderId?: string | null;
  kind: "exec" | "plugin";
}): { authorized: boolean; reason?: string } {
  const channel = normalizeMessageChannel(params.channel);
  if (!channel) {
    return { authorized: true };
  }
  return (
    getChannelPlugin(channel)?.auth?.authorizeActorAction?.({
      cfg: params.cfg,
      accountId: params.accountId,
      senderId: params.senderId,
      action: "approve",
      approvalKind: params.kind,
    }) ?? { authorized: true }
  );
}
