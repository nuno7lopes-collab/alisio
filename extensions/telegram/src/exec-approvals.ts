import { getExecApprovalReplyMetadata } from "alisio/plugin-sdk/approval-runtime";
import { resolveApprovalApprovers } from "alisio/plugin-sdk/approval-runtime";
import type { AlisioConfig } from "alisio/plugin-sdk/config-runtime";
import type { TelegramExecApprovalConfig } from "alisio/plugin-sdk/config-runtime";
import type { ReplyPayload } from "alisio/plugin-sdk/reply-runtime";
import { normalizeAccountId } from "alisio/plugin-sdk/routing";
import { resolveTelegramAccount } from "./accounts.js";
import { resolveTelegramInlineButtonsConfigScope } from "./inline-buttons.js";
import { normalizeTelegramChatId, resolveTelegramTargetChatType } from "./targets.js";

function normalizeApproverId(value: string | number): string {
  return String(value).trim();
}

function normalizeTelegramDirectApproverId(value: string | number): string | undefined {
  const normalized = normalizeApproverId(value);
  const chatId = normalizeTelegramChatId(normalized);
  if (!chatId || chatId.startsWith("-")) {
    return undefined;
  }
  return chatId;
}

export function resolveTelegramExecApprovalConfig(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
}): TelegramExecApprovalConfig | undefined {
  return resolveTelegramAccount(params).config.execApprovals;
}

export function getTelegramExecApprovalApprovers(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
}): string[] {
  const account = resolveTelegramAccount(params).config;
  return resolveApprovalApprovers({
    explicit: resolveTelegramExecApprovalConfig(params)?.approvers,
    allowFrom: account.allowFrom,
    defaultTo: account.defaultTo ? String(account.defaultTo) : null,
    normalizeApprover: normalizeTelegramDirectApproverId,
  });
}

export function isTelegramExecApprovalClientEnabled(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
}): boolean {
  const config = resolveTelegramExecApprovalConfig(params);
  return Boolean(config?.enabled && getTelegramExecApprovalApprovers(params).length > 0);
}

export function isTelegramExecApprovalApprover(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
  senderId?: string | null;
}): boolean {
  const senderId = params.senderId?.trim();
  if (!senderId) {
    return false;
  }
  const approvers = getTelegramExecApprovalApprovers(params);
  return approvers.includes(senderId);
}

function isTelegramExecApprovalTargetsMode(cfg: AlisioConfig): boolean {
  const execApprovals = cfg.approvals?.exec;
  if (!execApprovals?.enabled) {
    return false;
  }
  return execApprovals.mode === "targets" || execApprovals.mode === "both";
}

export function isTelegramExecApprovalTargetRecipient(params: {
  cfg: AlisioConfig;
  senderId?: string | null;
  accountId?: string | null;
}): boolean {
  const senderId = params.senderId?.trim();
  if (!senderId || !isTelegramExecApprovalTargetsMode(params.cfg)) {
    return false;
  }
  const targets = params.cfg.approvals?.exec?.targets;
  if (!targets) {
    return false;
  }
  const accountId = params.accountId ? normalizeAccountId(params.accountId) : undefined;
  return targets.some((target) => {
    const channel = target.channel?.trim().toLowerCase();
    if (channel !== "telegram") {
      return false;
    }
    if (accountId && target.accountId && normalizeAccountId(target.accountId) !== accountId) {
      return false;
    }
    const to = target.to ? normalizeTelegramChatId(target.to) : undefined;
    if (!to || to.startsWith("-")) {
      return false;
    }
    return to === senderId;
  });
}

export function isTelegramExecApprovalAuthorizedSender(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
  senderId?: string | null;
}): boolean {
  return isTelegramExecApprovalApprover(params) || isTelegramExecApprovalTargetRecipient(params);
}

export function resolveTelegramExecApprovalTarget(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
}): "dm" | "channel" | "both" {
  return resolveTelegramExecApprovalConfig(params)?.target ?? "dm";
}

export function shouldInjectTelegramExecApprovalButtons(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
  to: string;
}): boolean {
  if (!isTelegramExecApprovalClientEnabled(params)) {
    return false;
  }
  const target = resolveTelegramExecApprovalTarget(params);
  const chatType = resolveTelegramTargetChatType(params.to);
  if (chatType === "direct") {
    return target === "dm" || target === "both";
  }
  if (chatType === "group") {
    return target === "channel" || target === "both";
  }
  return target === "both";
}

function resolveExecApprovalButtonsExplicitlyDisabled(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
}): boolean {
  const capabilities = resolveTelegramAccount(params).config.capabilities;
  return resolveTelegramInlineButtonsConfigScope(capabilities) === "off";
}

export function shouldEnableTelegramExecApprovalButtons(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
  to: string;
}): boolean {
  if (!shouldInjectTelegramExecApprovalButtons(params)) {
    return false;
  }
  return !resolveExecApprovalButtonsExplicitlyDisabled(params);
}

export function shouldSuppressLocalTelegramExecApprovalPrompt(params: {
  cfg: AlisioConfig;
  accountId?: string | null;
  payload: ReplyPayload;
}): boolean {
  void params.cfg;
  void params.accountId;
  return getExecApprovalReplyMetadata(params.payload) !== null;
}
