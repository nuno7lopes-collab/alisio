import type { AlisioConfig } from "../../config/config.js";
import { resolveDmScope } from "../../config/session-defaults.js";
import { buildAgentSessionKey, type RoutePeer } from "../../routing/resolve-route.js";

export function buildOutboundBaseSessionKey(params: {
  cfg: AlisioConfig;
  agentId: string;
  channel: string;
  accountId?: string | null;
  peer: RoutePeer;
}): string {
  return buildAgentSessionKey({
    agentId: params.agentId,
    channel: params.channel,
    accountId: params.accountId,
    peer: params.peer,
    dmScope: resolveDmScope(params.cfg.session?.dmScope),
    identityLinks: params.cfg.session?.identityLinks,
  });
}
