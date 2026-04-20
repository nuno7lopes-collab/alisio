import type { AlisioConfig } from "../../config/config.js";
import type { SandboxBrowserContext, SandboxConfig } from "./types.js";

type EnsureLiveSandboxBrowserBridgeOptions = {
  cfg?: AlisioConfig;
  sessionKey?: string;
  workspaceDir?: string;
  evaluateEnabled?: boolean;
};

type EnsureSandboxBrowserParams = {
  scopeKey: string;
  workspaceDir: string;
  agentWorkspaceDir: string;
  cfg: SandboxConfig;
  evaluateEnabled?: boolean;
  bridgeAuth?: { token?: string; password?: string };
};

export function getLiveSandboxBrowserBridgeUrl(_scopeKey: string): string | undefined {
  return undefined;
}

export async function ensureLiveSandboxBrowserBridgeUrl(
  _scopeKey: string,
  _opts?: EnsureLiveSandboxBrowserBridgeOptions,
): Promise<string | undefined> {
  return undefined;
}

export async function ensureSandboxBrowser(
  _params: EnsureSandboxBrowserParams,
): Promise<SandboxBrowserContext | null> {
  return null;
}

async function noop(): Promise<void> {}

export const __testing = {
  bootstrapSandboxBrowserBridges: noop,
  ensureLiveSandboxBrowserBridgeUrl,
};
