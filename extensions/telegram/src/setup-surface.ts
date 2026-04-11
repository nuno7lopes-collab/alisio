import {
  createAllowFromSection,
  createTopLevelChannelDmPolicy,
  createStandardChannelSetupStatus,
  DEFAULT_ACCOUNT_ID,
  hasConfiguredSecretInput,
  type AlisioConfig,
  patchChannelConfigForAccount,
  setSetupChannelEnabled,
  splitSetupEntries,
} from "alisio/plugin-sdk/setup";
import type { ChannelSetupWizard } from "alisio/plugin-sdk/setup";
import { inspectTelegramAccount } from "./account-inspect.js";
import {
  listTelegramAccountIds,
  mergeTelegramAccountConfig,
  resolveTelegramAccount,
} from "./accounts.js";
import {
  resolveTelegramDmOnboardingStatus,
  type TelegramDmOnboardingStatus,
} from "./dm-onboarding-state.js";
import {
  beginTelegramOwnerOnboarding,
  clearTelegramOwnerOnboarding,
  type TelegramOwnerOnboardingSession,
} from "./owner-onboarding.js";
import { probeTelegram } from "./probe.js";
import {
  parseTelegramAllowFromId,
  promptTelegramAllowFromForAccount,
  resolveTelegramAllowFromEntries,
  TELEGRAM_TOKEN_HELP_LINES,
  TELEGRAM_USER_ID_HELP_LINES,
  telegramSetupAdapter,
} from "./setup-core.js";

const channel = "telegram" as const;

function ensureTelegramDefaultGroupMentionGate(
  cfg: AlisioConfig,
  accountId: string,
): AlisioConfig {
  const resolved = resolveTelegramAccount({ cfg, accountId });
  const wildcardGroup = resolved.config.groups?.["*"];
  if (wildcardGroup?.requireMention !== undefined) {
    return cfg;
  }
  return patchChannelConfigForAccount({
    cfg,
    channel,
    accountId,
    patch: {
      groups: {
        ...resolved.config.groups,
        "*": {
          ...wildcardGroup,
          requireMention: true,
        },
      },
    },
  });
}

async function resolveTelegramConfiguredState(cfg: AlisioConfig): Promise<{
  configured: boolean;
  onboarding: TelegramDmOnboardingStatus | null;
}> {
  const configuredAccountIds = listTelegramAccountIds(cfg).filter(
    (accountId) => inspectTelegramAccount({ cfg, accountId }).configured,
  );
  if (configuredAccountIds.length === 0) {
    return { configured: false, onboarding: null };
  }
  for (const accountId of configuredAccountIds) {
    const onboarding = await resolveTelegramDmOnboardingStatus({ cfg, accountId });
    if (onboarding) {
      return { configured: true, onboarding };
    }
  }
  return { configured: true, onboarding: null };
}

function shouldShowTelegramDmAccessWarning(cfg: AlisioConfig, accountId: string): boolean {
  const merged = mergeTelegramAccountConfig(cfg, accountId);
  const policy = merged.dmPolicy ?? "pairing";
  const hasAllowFrom =
    Array.isArray(merged.allowFrom) && merged.allowFrom.some((entry) => String(entry).trim());
  return policy === "pairing" && !hasAllowFrom;
}

async function createTelegramOwnerOnboardingSession(params: {
  cfg: AlisioConfig;
  accountId: string;
}): Promise<TelegramOwnerOnboardingSession> {
  const inspected = inspectTelegramAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const probe = inspected.token
    ? await probeTelegram(inspected.token, 2500, {
        accountId: params.accountId,
        proxyUrl: inspected.config.proxy,
        network: inspected.config.network,
        apiRoot: inspected.config.apiRoot,
      }).catch(() => null)
    : null;
  return await beginTelegramOwnerOnboarding({
    accountId: params.accountId,
    botUsername: probe?.bot?.username ?? null,
  });
}

function buildTelegramDmAccessWarningLines(onboarding: TelegramOwnerOnboardingSession): string[] {
  const lines = [
    "Telegram is connected. Now Alisio needs to confirm which Telegram account is yours.",
  ];
  if (onboarding.deepLink) {
    lines.push("Open Telegram with this link and tap Start:");
    lines.push(onboarding.deepLink);
    lines.push("If the link does not open Telegram, send this one-time setup message instead:");
    lines.push(onboarding.startCommand);
  } else {
    lines.push(
      "Send this one-time setup message to the bot from the Telegram account that should use it:",
    );
    lines.push(onboarding.startCommand);
  }
  lines.push("As soon as Telegram receives it, Alisio will approve that account automatically.");
  return lines;
}

const dmPolicy = createTopLevelChannelDmPolicy({
  label: "Telegram",
  channel,
  policyKey: "channels.telegram.dmPolicy",
  allowFromKey: "channels.telegram.allowFrom",
  getCurrent: (cfg) => cfg.channels?.telegram?.dmPolicy ?? "pairing",
  promptAllowFrom: promptTelegramAllowFromForAccount,
});

const baseStatus = createStandardChannelSetupStatus({
  channelLabel: "Telegram",
  configuredLabel: "configured",
  unconfiguredLabel: "needs token",
  configuredHint: "recommended · configured",
  unconfiguredHint: "recommended · newcomer-friendly",
  configuredScore: 1,
  unconfiguredScore: 10,
  resolveConfigured: async ({ cfg }) => (await resolveTelegramConfiguredState(cfg)).configured,
});

export const telegramSetupWizard: ChannelSetupWizard = {
  channel,
  status: {
    ...baseStatus,
    resolveStatusLines: async ({ cfg, configured }) => {
      if (!configured) {
        return ["Telegram: needs token"];
      }
      const { onboarding } = await resolveTelegramConfiguredState(cfg);
      if (onboarding?.state === "pending_approval") {
        const label =
          onboarding.pendingPairingRequests === 1
            ? "1 DM approval pending"
            : `${onboarding.pendingPairingRequests} DM approvals pending`;
        return [`Telegram: configured, ${label}`];
      }
      if (onboarding?.state === "waiting_for_first_dm") {
        return ["Telegram: configured, waiting for first Telegram DM"];
      }
      return ["Telegram: configured"];
    },
    resolveSelectionHint: async ({ cfg, configured }) => {
      if (!configured) {
        return baseStatus.unconfiguredHint;
      }
      const { onboarding } = await resolveTelegramConfiguredState(cfg);
      if (onboarding?.state === "pending_approval") {
        return "recommended · pending approval";
      }
      if (onboarding?.state === "waiting_for_first_dm") {
        return "recommended · waiting for first Telegram DM";
      }
      return baseStatus.configuredHint;
    },
  },
  prepare: async ({ cfg, accountId, credentialValues }) => ({
    cfg: ensureTelegramDefaultGroupMentionGate(cfg, accountId),
    credentialValues,
  }),
  credentials: [
    {
      inputKey: "token",
      providerHint: channel,
      credentialLabel: "Telegram bot token",
      preferredEnvVar: "TELEGRAM_BOT_TOKEN",
      helpTitle: "Telegram bot token",
      helpLines: TELEGRAM_TOKEN_HELP_LINES,
      envPrompt: "TELEGRAM_BOT_TOKEN detected. Use env var?",
      keepPrompt: "Telegram token already configured. Keep it?",
      inputPrompt: "Enter Telegram bot token",
      allowEnv: ({ accountId }) => accountId === DEFAULT_ACCOUNT_ID,
      inspect: ({ cfg, accountId }) => {
        const resolved = resolveTelegramAccount({ cfg, accountId });
        const hasConfiguredBotToken = hasConfiguredSecretInput(resolved.config.botToken);
        const hasConfiguredValue =
          hasConfiguredBotToken || Boolean(resolved.config.tokenFile?.trim());
        return {
          accountConfigured: Boolean(resolved.token) || hasConfiguredValue,
          hasConfiguredValue,
          resolvedValue: resolved.token?.trim() || undefined,
          envValue:
            accountId === DEFAULT_ACCOUNT_ID
              ? process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined
              : undefined,
        };
      },
    },
  ],
  allowFrom: createAllowFromSection({
    helpTitle: "Telegram user id",
    helpLines: TELEGRAM_USER_ID_HELP_LINES,
    credentialInputKey: "token",
    message: "Telegram allowFrom (numeric sender id; @username resolves to id)",
    placeholder: "@username",
    invalidWithoutCredentialNote:
      "Telegram token missing; use numeric sender ids (usernames require a bot token).",
    parseInputs: splitSetupEntries,
    parseId: parseTelegramAllowFromId,
    resolveEntries: async ({ cfg, accountId, credentialValues, entries }) =>
      resolveTelegramAllowFromEntries({
        credentialValue: credentialValues.token,
        entries,
        apiRoot: resolveTelegramAccount({ cfg, accountId }).config.apiRoot,
      }),
    apply: async ({ cfg, accountId, allowFrom }) =>
      patchChannelConfigForAccount({
        cfg,
        channel,
        accountId,
        patch: { dmPolicy: "allowlist", allowFrom },
      }),
  }),
  finalize: async ({ cfg, accountId, prompter }) => {
    if (!shouldShowTelegramDmAccessWarning(cfg, accountId)) {
      await clearTelegramOwnerOnboarding({ accountId }).catch(() => {});
      return;
    }
    const onboarding = await createTelegramOwnerOnboardingSession({ cfg, accountId });
    await prompter.note(
      buildTelegramDmAccessWarningLines(onboarding).join("\n"),
      "Finish Telegram setup",
    );
  },
  afterConfigWritten: async ({ cfg, accountId }) => {
    if (!shouldShowTelegramDmAccessWarning(cfg, accountId)) {
      await clearTelegramOwnerOnboarding({ accountId }).catch(() => {});
    }
  },
  dmPolicy,
  disable: (cfg) => setSetupChannelEnabled(cfg, channel, false),
};

export { parseTelegramAllowFromId, telegramSetupAdapter };
