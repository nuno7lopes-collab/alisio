export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openclaw/control-ui-config.json";
export const ALISIO_BOOTSTRAP_HTTP_PATH = "/__alisio/bootstrap";

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
  avatarLabel: string;
  plan: string;
} | null;

export type AlisioHttpBootstrapAi = {
  provider: "openai";
  status: import("../infra/alisio-ai.js").AlisioAiStatus;
  email?: string;
  planLabel?: string;
} | null;

export type AlisioHttpBootstrap = {
  basePath: string;
  controlUrl: string;
  startupState: import("../infra/alisio-store.js").AlisioStartupState;
  account: AlisioHttpBootstrapAccount;
  ai: AlisioHttpBootstrapAi;
  bootstrapToken?: string;
};
