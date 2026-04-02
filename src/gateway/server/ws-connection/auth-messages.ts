import {
  isGatewayCliClient,
  isOperatorUiClient,
  isWebchatClient,
} from "../../../utils/message-channel.js";
import type { ResolvedGatewayAuth } from "../../auth.js";

export type AuthProvidedKind = "token" | "bootstrap-token" | "device-token" | "password" | "none";

export function formatGatewayAuthFailureMessage(params: {
  authMode: ResolvedGatewayAuth["mode"];
  authProvided: AuthProvidedKind;
  reason?: string;
  client?: { id?: string | null; mode?: string | null };
}): string {
  const { authMode, authProvided, reason, client } = params;
  const isCli = isGatewayCliClient(client);
  const isControlUi = isOperatorUiClient(client);
  const isWebchat = isWebchatClient(client);
  const uiHint = "open the dashboard URL and let Alisio reconnect automatically";
  const tokenHint = isCli
    ? "set gateway.remote.token to match gateway.auth.token"
    : isControlUi || isWebchat
      ? uiHint
      : "provide gateway auth token";
  const passwordHint = isCli
    ? "set gateway.remote.password to match gateway.auth.password"
    : isControlUi || isWebchat
      ? "enter the password in Control UI settings"
      : "provide gateway auth password";
  switch (reason) {
    case "token_missing":
      return `unauthorized: connection token missing (${tokenHint})`;
    case "token_mismatch":
      return `unauthorized: connection token mismatch (${tokenHint})`;
    case "token_missing_config":
      return "unauthorized: connection token not configured for this workspace";
    case "password_missing":
      return `unauthorized: gateway password missing (${passwordHint})`;
    case "password_mismatch":
      return `unauthorized: gateway password mismatch (${passwordHint})`;
    case "password_missing_config":
      return "unauthorized: workspace password not configured";
    case "bootstrap_token_invalid":
      return "unauthorized: bootstrap token invalid or expired (scan a fresh setup code)";
    case "tailscale_user_missing":
      return "unauthorized: tailscale identity missing (use Tailscale Serve auth or automatic setup)";
    case "tailscale_proxy_missing":
      return "unauthorized: tailscale proxy headers missing (use Tailscale Serve or automatic setup)";
    case "tailscale_whois_failed":
      return "unauthorized: tailscale identity check failed (use Tailscale Serve auth or automatic setup)";
    case "tailscale_user_mismatch":
      return "unauthorized: tailscale identity mismatch (use Tailscale Serve auth or automatic setup)";
    case "rate_limited":
      return "unauthorized: too many failed authentication attempts (retry later)";
    case "device_token_mismatch":
      return "unauthorized: device token mismatch (rotate/reissue device token)";
    default:
      break;
  }

  if (authMode === "token" && authProvided === "none") {
    return `unauthorized: connection token missing (${tokenHint})`;
  }
  if (authMode === "token" && authProvided === "device-token") {
    return "unauthorized: secure device session rejected (retry automatic setup)";
  }
  if (authProvided === "bootstrap-token") {
    return "unauthorized: bootstrap token invalid or expired (scan a fresh setup code)";
  }
  if (authMode === "password" && authProvided === "none") {
    return `unauthorized: gateway password missing (${passwordHint})`;
  }
  return "unauthorized";
}
