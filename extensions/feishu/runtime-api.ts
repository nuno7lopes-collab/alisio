// Private runtime barrel for the bundled Feishu extension.
// Keep this barrel thin and aligned with the local extension surface.

export type {
  ChannelMessageActionName,
  ChannelMeta,
  ChannelOutboundAdapter,
  AlisioConfig as ClawdbotConfig,
  AlisioConfig,
  AlisioConfig as OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
  RuntimeEnv,
} from "alisio/plugin-sdk/feishu";
export {
  DEFAULT_ACCOUNT_ID,
  PAIRING_APPROVED_MESSAGE,
  buildChannelConfigSchema,
  buildProbeChannelStatusSummary,
  createActionGate,
  createDefaultChannelRuntimeState,
} from "alisio/plugin-sdk/feishu";
export * from "alisio/plugin-sdk/feishu";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "alisio/plugin-sdk/webhook-ingress";
