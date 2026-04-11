import { mergeDmAllowFromSources } from "alisio/plugin-sdk/allow-from";
import type { AlisioConfig } from "alisio/plugin-sdk/config-runtime";
import {
  listChannelPairingRequests,
  readChannelAllowFromStore,
} from "alisio/plugin-sdk/conversation-runtime";
import { DEFAULT_ACCOUNT_ID } from "alisio/plugin-sdk/routing";
import { mergeTelegramAccountConfig } from "./accounts.js";

export type TelegramDmOnboardingState = "waiting_for_first_dm" | "pending_approval";

export type TelegramPendingPairingRequest = {
  requestId: string;
  label: string;
  detail?: string | null;
};

export type TelegramDmOnboardingStatus = {
  state: TelegramDmOnboardingState;
  pendingPairingRequests: number;
  pendingRequests: TelegramPendingPairingRequest[];
};

function trimMetaValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildTelegramPendingRequestLabel(request: {
  id?: unknown;
  meta?: Record<string, unknown>;
}): TelegramPendingPairingRequest | null {
  const requestId = typeof request.id === "string" ? request.id.trim() : "";
  if (!requestId) {
    return null;
  }
  const firstName = trimMetaValue(request.meta?.firstName);
  const lastName = trimMetaValue(request.meta?.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const username = trimMetaValue(request.meta?.username).replace(/^@+/, "");
  const label = fullName || (username ? `@${username}` : requestId);
  const detailParts = [username ? `@${username}` : "", requestId].filter(Boolean);
  return {
    requestId,
    label,
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
  };
}

export async function resolveTelegramDmOnboardingStatus(params: {
  cfg: AlisioConfig;
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
    const pendingRequestSummaries = pendingRequests
      .map((entry) => buildTelegramPendingRequestLabel(entry))
      .filter((entry): entry is TelegramPendingPairingRequest => entry !== null);
    return {
      state: "pending_approval",
      pendingPairingRequests: pendingRequests.length,
      pendingRequests: pendingRequestSummaries,
    };
  }

  return {
    state: "waiting_for_first_dm",
    pendingPairingRequests: 0,
    pendingRequests: [],
  };
}
