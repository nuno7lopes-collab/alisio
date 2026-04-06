import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { patchChannelConfigForAccount } from "openclaw/plugin-sdk/setup";
import { resolveTelegramAccount } from "./accounts.js";
import { getTelegramRuntime } from "./runtime.js";

function normalizeAllowEntry(entry: string | number): string {
  return String(entry).trim();
}

export function buildTelegramOwnerAllowlistConfig(params: {
  cfg: OpenClawConfig;
  accountId: string;
  telegramUserId: string;
}): OpenClawConfig {
  const telegramUserId = normalizeAllowEntry(params.telegramUserId);
  if (!telegramUserId) {
    return params.cfg;
  }

  const account = resolveTelegramAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const currentAllowFrom = (account.config.allowFrom ?? [])
    .map(normalizeAllowEntry)
    .filter(Boolean);
  const nextAllowFrom = currentAllowFrom.includes(telegramUserId)
    ? currentAllowFrom
    : [...currentAllowFrom, telegramUserId];
  if (account.config.dmPolicy === "allowlist" && nextAllowFrom.length === currentAllowFrom.length) {
    return params.cfg;
  }

  return patchChannelConfigForAccount({
    cfg: params.cfg,
    channel: "telegram",
    accountId: params.accountId,
    patch: {
      dmPolicy: "allowlist",
      allowFrom: nextAllowFrom,
    },
  });
}

export async function persistTelegramOwnerAllowlist(params: {
  cfg: OpenClawConfig;
  accountId: string;
  telegramUserId: string;
  writeConfigFile: (cfg: OpenClawConfig) => Promise<void> | void;
}): Promise<OpenClawConfig> {
  const nextCfg = buildTelegramOwnerAllowlistConfig(params);
  if (nextCfg === params.cfg) {
    return params.cfg;
  }
  await params.writeConfigFile(nextCfg);
  return nextCfg;
}

export async function persistTelegramOwnerAllowlistFromRuntime(params: {
  accountId: string;
  telegramUserId: string;
}): Promise<OpenClawConfig> {
  const runtime = getTelegramRuntime();
  return await persistTelegramOwnerAllowlist({
    cfg: runtime.config.loadConfig(),
    accountId: params.accountId,
    telegramUserId: params.telegramUserId,
    writeConfigFile: runtime.config.writeConfigFile,
  });
}
