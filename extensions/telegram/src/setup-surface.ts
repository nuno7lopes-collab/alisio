import { listChannelPairingRequests } from "openclaw/plugin-sdk/conversation-runtime";
import {
  createAllowFromSection,
  createTopLevelChannelDmPolicy,
  createStandardChannelSetupStatus,
  DEFAULT_ACCOUNT_ID,
  hasConfiguredSecretInput,
  type OpenClawConfig,
  patchChannelConfigForAccount,
  setSetupChannelEnabled,
  splitSetupEntries,
} from "openclaw/plugin-sdk/setup";
import type { ChannelSetupWizard } from "openclaw/plugin-sdk/setup";
import { formatDocsLink } from "openclaw/plugin-sdk/setup-tools";
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
import { buildTelegramOwnerAllowlistConfig } from "./owner-allowlist.js";
import { armTelegramOwnerAutoApproval } from "./owner-auto-approval.js";
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
  cfg: OpenClawConfig,
  accountId: string,
): OpenClawConfig {
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

async function resolveTelegramConfiguredState(cfg: OpenClawConfig): Promise<{
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

function shouldShowTelegramDmAccessWarning(cfg: OpenClawConfig, accountId: string): boolean {
  const merged = mergeTelegramAccountConfig(cfg, accountId);
  const policy = merged.dmPolicy ?? "pairing";
  const hasAllowFrom =
    Array.isArray(merged.allowFrom) && merged.allowFrom.some((entry) => String(entry).trim());
  return policy === "pairing" && !hasAllowFrom;
}

function buildTelegramDmAccessWarningLines(_accountId: string): string[] {
  return [
    "Telegram is connected, but it still needs to identify your account.",
    "Open Telegram and send a message to the bot from the account that should use it.",
    "OpenClaw will authorize that first direct message automatically.",
    "Keep this setup window open until Telegram is ready.",
    `Docs: ${formatDocsLink("/channels/pairing", "channels/pairing")}`,
  ];
}

async function shouldArmTelegramOwnerAutoApproval(params: {
  cfg: OpenClawConfig;
  accountId: string;
}): Promise<boolean> {
  const onboarding = await resolveTelegramDmOnboardingStatus(params);
  return onboarding !== null;
}

async function resolvePendingTelegramPairingUserIds(accountId: string): Promise<string[]> {
  const pendingRequests = await listChannelPairingRequests(
    "telegram",
    process.env,
    accountId,
  ).catch(() => []);
  return Array.from(
    new Set(pendingRequests.map((entry) => String(entry.id ?? "").trim()).filter(Boolean)),
  );
}

async function maybeAutoApproveExistingTelegramRequest(params: {
  cfg: OpenClawConfig;
  accountId: string;
}): Promise<{ cfg: OpenClawConfig; autoApproved: boolean }> {
  if (!shouldShowTelegramDmAccessWarning(params.cfg, params.accountId)) {
    return { cfg: params.cfg, autoApproved: false };
  }
  const pendingUserIds = await resolvePendingTelegramPairingUserIds(params.accountId);
  if (pendingUserIds.length !== 1) {
    return { cfg: params.cfg, autoApproved: false };
  }
  return {
    cfg: buildTelegramOwnerAllowlistConfig({
      cfg: params.cfg,
      accountId: params.accountId,
      telegramUserId: pendingUserIds[0]!,
    }),
    autoApproved: true,
  };
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
    const autoApproved = await maybeAutoApproveExistingTelegramRequest({ cfg, accountId });
    if (autoApproved.autoApproved) {
      await prompter.note(
        [
          "OpenClaw found your previous Telegram message and finished the first approval automatically.",
          "You can go back to Telegram and start chatting.",
        ].join("\n"),
        "Telegram ready",
      );
      return { cfg: autoApproved.cfg };
    }
    if (!shouldShowTelegramDmAccessWarning(cfg, accountId)) {
      return;
    }
    await prompter.note(
      buildTelegramDmAccessWarningLines(accountId).join("\n"),
      "Telegram DM access warning",
    );
  },
  afterConfigWritten: async ({ cfg, accountId }) => {
    if (!(await shouldArmTelegramOwnerAutoApproval({ cfg, accountId }))) {
      return;
    }
    armTelegramOwnerAutoApproval({ accountId });
  },
  dmPolicy,
  disable: (cfg) => setSetupChannelEnabled(cfg, channel, false),
};

export { parseTelegramAllowFromId, telegramSetupAdapter };
