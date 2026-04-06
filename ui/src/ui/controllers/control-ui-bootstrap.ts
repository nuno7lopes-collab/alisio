import {
  ALISIO_BOOTSTRAP_HTTP_PATH,
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  type AlisioHttpBootstrap,
  type ControlUiBootstrapConfig,
} from "../../../../src/gateway/control-ui-contract.js";
import {
  deriveAlisioAvatarLabel,
  resolveAlisioAgentName,
} from "../../../../src/shared/alisio-account.js";
import { normalizeAssistantIdentity } from "../assistant-identity.ts";
import { normalizeBasePath } from "../base-path.ts";

export type ControlUiBootstrapState = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  alisioStartupLoading: boolean;
  alisioStartupError: string | null;
  alisioStartupBootstrap: AlisioHttpBootstrap | null;
  gatewayBootstrapUrl: string | null;
  gatewayBootstrapToken: string | null;
};

function looksLikeHtmlDocument(payload: string) {
  const normalized = payload.trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

function staleGatewayBootstrapMessage(serverVersion: string | null) {
  return serverVersion
    ? `The local Alisio app is still running an older build (${serverVersion}). Restart Alisio, then reload this page.`
    : "The local Alisio app is still serving an older workspace build. Restart Alisio, then reload this page.";
}

export async function loadControlUiBootstrapConfig(state: ControlUiBootstrapState) {
  if (typeof window === "undefined") {
    return;
  }
  if (typeof fetch !== "function") {
    return;
  }

  const basePath = normalizeBasePath(state.basePath ?? "");
  const configUrl = basePath
    ? `${basePath}${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`
    : CONTROL_UI_BOOTSTRAP_CONFIG_PATH;
  const alisioBootstrapUrl = basePath
    ? `${basePath}${ALISIO_BOOTSTRAP_HTTP_PATH}`
    : ALISIO_BOOTSTRAP_HTTP_PATH;

  state.alisioStartupLoading = true;
  state.alisioStartupError = null;
  state.alisioStartupBootstrap = null;
  state.gatewayBootstrapUrl = null;
  state.gatewayBootstrapToken = null;

  try {
    const res = await fetch(configUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (res.ok) {
      const parsed = (await res.json()) as ControlUiBootstrapConfig;
      const normalized = normalizeAssistantIdentity({
        agentId: parsed.assistantAgentId ?? null,
        name: parsed.assistantName,
        avatar: parsed.assistantAvatar ?? null,
      });
      state.assistantName = normalized.name;
      state.assistantAvatar = normalized.avatar;
      state.assistantAgentId = normalized.agentId ?? null;
      state.serverVersion = parsed.serverVersion ?? null;
    }
  } catch {
    // Ignore bootstrap failures; UI will update identity after connecting.
  }

  try {
    const res = await fetch(alisioBootstrapUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) {
      state.alisioStartupError = `startup bootstrap failed (${res.status})`;
      return;
    }
    const raw = await res.text();
    if (looksLikeHtmlDocument(raw)) {
      state.alisioStartupError = staleGatewayBootstrapMessage(state.serverVersion);
      return;
    }
    let parsed: AlisioHttpBootstrap;
    try {
      parsed = JSON.parse(raw) as AlisioHttpBootstrap;
    } catch {
      state.alisioStartupError = "Could not read the local startup bootstrap. Reload the page.";
      return;
    }
    state.alisioStartupBootstrap = parsed;
    state.gatewayBootstrapUrl = parsed.controlUrl ?? null;
    state.gatewayBootstrapToken = parsed.bootstrapToken ?? null;
    if (parsed.account && state.assistantName === "Assistant") {
      const nextAgentName = resolveAlisioAgentName(parsed.account.agentName);
      state.assistantName = nextAgentName;
      if (!state.assistantAvatar || state.assistantAvatar === "A") {
        state.assistantAvatar = deriveAlisioAvatarLabel({
          displayName: nextAgentName,
          username: nextAgentName,
        });
      }
    }
  } catch (error) {
    state.alisioStartupError = String(error);
  } finally {
    state.alisioStartupLoading = false;
  }
}
