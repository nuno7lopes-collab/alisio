import type { ChannelsStatusSnapshot, WizardStep } from "./types.ts";

export const DEFAULT_CHANNEL_ACCOUNT_ID = "default";

export type ChannelBusyAction =
  | "login-start"
  | "login-wait"
  | "logout"
  | "pairing-approve"
  | "pairing-reject";

export function normalizeChannelAccountId(accountId?: string | null): string {
  return accountId?.trim() || DEFAULT_CHANNEL_ACCOUNT_ID;
}

export function makeChannelBusyKey(params: {
  channelId: string;
  action: ChannelBusyAction;
  accountId?: string | null;
}): string {
  return `${params.channelId}|${params.action}|${normalizeChannelAccountId(params.accountId)}`;
}

export function isChannelBusyKey(
  busyKey: string | null | undefined,
  params: {
    channelId: string;
    action: ChannelBusyAction;
    accountId?: string | null;
  },
): boolean {
  return busyKey === makeChannelBusyKey(params);
}

export function isLegacyWhatsAppInlineLinkStep(
  channelId: string | null | undefined,
  step: WizardStep | null | undefined,
) {
  if (channelId?.trim() !== "whatsapp" || step?.type !== "confirm") {
    return false;
  }
  return /\b(?:re-)?link whatsapp now\b/i.test(step.message?.trim() ?? "");
}

export function readRunningChannelWizard(snapshot: ChannelsStatusSnapshot | null): {
  sessionId: string;
  channelId: string | null;
} | null {
  const wizard = snapshot?.wizard;
  if (!wizard?.running || typeof wizard.sessionId !== "string" || !wizard.sessionId.trim()) {
    return null;
  }
  return {
    sessionId: wizard.sessionId.trim(),
    channelId:
      typeof wizard.channelId === "string" && wizard.channelId.trim()
        ? wizard.channelId.trim()
        : null,
  };
}
