export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__alisio/control-ui-config.json";
export const ALISIO_BOOTSTRAP_HTTP_PATH = "/__alisio/bootstrap";
export const CONTROL_UI_DEVICE_IDENTITY_PATH = "/__alisio/device-identity";
export const CONTROL_UI_DEVICE_SIGN_PATH = "/__alisio/device-sign";

export type ControlUiBootstrapConfig = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string;
  assistantAgentId: string;
  serverVersion?: string;
};

export type AlisioHttpBootstrapAccount = {
  username: string;
  displayName: string;
  email: string;
  agentName?: string;
  avatarLabel: string;
  plan: import("../shared/alisio-billing.js").AlisioPlan;
} | null;

export type AlisioHttpBootstrapAi = {
  provider: "openai";
  status: import("../infra/alisio-ai.js").AlisioAiStatus;
  email?: string;
  planLabel?: string;
} | null;

export type AlisioHttpBootstrapAccountCloud =
  import("../infra/alisio-store.js").AlisioAccountCloudState;

export type AlisioHttpBootstrap = {
  basePath: string;
  controlUrl: string;
  connectionRequired?: boolean;
  startupState: import("../infra/alisio-store.js").AlisioStartupState;
  providerReady?: boolean;
  accountReady?: boolean;
  nextStep?: import("../infra/alisio-store.js").AlisioBootstrapStep;
  account: AlisioHttpBootstrapAccount;
  accountCloud: AlisioHttpBootstrapAccountCloud;
  ai: AlisioHttpBootstrapAi;
  bootstrapToken?: string;
};

export type ControlUiLocalDeviceIdentity = {
  deviceId: string;
  publicKey: string;
  platform?: string;
  deviceFamily?: string;
};

export type ControlUiLocalDeviceSignRequest = {
  payload: string;
};

export type ControlUiLocalDeviceSignResponse = {
  signature: string;
};
