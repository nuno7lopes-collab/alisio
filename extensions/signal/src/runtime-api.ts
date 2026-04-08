// Private runtime barrel for the bundled Signal extension.
// Prefer narrower SDK subpaths plus local extension seams over the legacy signal barrel.

export type { ChannelMessageActionAdapter } from "alisio/plugin-sdk/channel-contract";
export { SignalConfigSchema } from "alisio/plugin-sdk/channel-config-schema";
export { PAIRING_APPROVED_MESSAGE } from "alisio/plugin-sdk/channel-status";
import type { AlisioConfig as RuntimeAlisioConfig } from "alisio/plugin-sdk/config-runtime";
export type { RuntimeAlisioConfig as AlisioConfig, RuntimeAlisioConfig as OpenClawConfig };
export type { OpenClawPluginApi, PluginRuntime } from "alisio/plugin-sdk/core";
export type { ChannelPlugin } from "alisio/plugin-sdk/core";
export {
  DEFAULT_ACCOUNT_ID,
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  deleteAccountFromConfigSection,
  emptyPluginConfigSchema,
  formatPairingApproveHint,
  getChatChannelMeta,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  setAccountEnabledInConfigSection,
} from "alisio/plugin-sdk/core";
export { resolveChannelMediaMaxBytes } from "alisio/plugin-sdk/media-runtime";
export { formatCliCommand, formatDocsLink } from "alisio/plugin-sdk/setup-tools";
export { chunkText } from "alisio/plugin-sdk/reply-runtime";
export { detectBinary, installSignalCli } from "alisio/plugin-sdk/setup-tools";
export {
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "alisio/plugin-sdk/config-runtime";
export {
  buildBaseAccountStatusSnapshot,
  buildBaseChannelStatusSummary,
  collectStatusIssuesFromLastError,
  createDefaultChannelRuntimeState,
} from "alisio/plugin-sdk/status-helpers";
export { normalizeE164 } from "alisio/plugin-sdk/text-runtime";
export { looksLikeSignalTargetId, normalizeSignalMessagingTarget } from "./normalize.js";
export {
  listEnabledSignalAccounts,
  listSignalAccountIds,
  resolveDefaultSignalAccountId,
  resolveSignalAccount,
} from "./accounts.js";
export { monitorSignalProvider } from "./monitor.js";
export { probeSignal } from "./probe.js";
export { resolveSignalReactionLevel } from "./reaction-level.js";
export { removeReactionSignal, sendReactionSignal } from "./send-reactions.js";
export { sendMessageSignal } from "./send.js";
export { signalMessageActions } from "./message-actions.js";
export type { ResolvedSignalAccount } from "./accounts.js";
export type SignalAccountConfig = Omit<
  Exclude<NonNullable<RuntimeAlisioConfig["channels"]>["signal"], undefined>,
  "accounts"
>;
