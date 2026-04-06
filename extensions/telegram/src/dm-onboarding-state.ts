import { mergeDmAllowFromSources } from "openclaw/plugin-sdk/allow-from";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import {
  listChannelPairingRequests,
  readChannelAllowFromStore,
} from "openclaw/plugin-sdk/conversation-runtime";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/routing";
import { mergeTelegramAccountConfig } from "./accounts.js";

export type TelegramDmOnboardingState = "waiting_for_first_dm" | "pending_approval";

export type TelegramDmOnboardingStatus = {
  state: TelegramDmOnboardingState;
  pendingPairingRequests: number;
};

export async function resolveTelegramDmOnboardingStatus(params: {
  cfg: OpenClawConfig;
  accountId: string;
}): Promise<TelegramDmOnboardingStatus | null> {
  const accountId = params.accountId.trim() || DEFAULT_ACCOUNT_ID;
  const merged = mergeTelegramAccountConfig(params.cfg, accountId);
  const dmPolicy = merged.dmPolicy ?? "pairing";
  if (dmPolicy !== "pairing") {
    return null;
  }

  const [storeAllowFrom, pendingRequests] = await Promise.all([
    readChannelAllowFromStore("telegram", process.env, accountId).catch(() => [] as string[]),
    listChannelPairingRequests("telegram", process.env, accountId).catch(() => []),
  ]);
  const effectiveAllowFrom = mergeDmAllowFromSources({
    allowFrom: merged.allowFrom,
    storeAllowFrom,
    dmPolicy,
  });
  const hasApprovedDmSender = effectiveAllowFrom.some((entry) => String(entry).trim());
  if (hasApprovedDmSender) {
    return null;
  }

  if (pendingRequests.length > 0) {
    return {
      state: "pending_approval",
      pendingPairingRequests: pendingRequests.length,
    };
  }

  return {
    state: "waiting_for_first_dm",
    pendingPairingRequests: 0,
  };
}
