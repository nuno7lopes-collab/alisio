import type { SandboxBackendHandle, SandboxBackendId } from "./backend.js";
import type { SandboxFsBridge } from "./fs-bridge.js";
import type { SandboxDockerConfig } from "./types.docker.js";

export type { SandboxDockerConfig } from "./types.docker.js";

export type SandboxToolPolicy = {
  allow?: string[];
  deny?: string[];
};

export type SandboxToolPolicySource = {
  source: "agent" | "global" | "default";
  /**
   * Config key path hint for humans.
   * (Arrays use `agents.list[].…` form.)
   */
  key: string;
};

export type SandboxToolPolicyResolved = {
  allow: string[];
  deny: string[];
  sources: {
    allow: SandboxToolPolicySource;
    deny: SandboxToolPolicySource;
  };
};

export type SandboxWorkspaceAccess = "none" | "ro" | "rw";

/**
 * Legacy browser-sandbox config shape kept only so existing config still parses.
 * The shared backend no longer provisions or exposes sandbox browsers.
 */
export type SandboxBrowserConfig = {
  enabled: boolean;
  image: string;
  containerPrefix: string;
  network: string;
  cdpPort: number;
  cdpSourceRange?: string;
  headless: boolean;
  allowHostControl: boolean;
  autoStart: boolean;
  autoStartTimeoutMs: number;
  binds?: string[];
};

export type SandboxPruneConfig = {
  idleHours: number;
  maxAgeDays: number;
};

export type SandboxSshConfig = {
  target?: string;
  command: string;
  workspaceRoot: string;
  strictHostKeyChecking: boolean;
  updateHostKeys: boolean;
  identityFile?: string;
  certificateFile?: string;
  knownHostsFile?: string;
  identityData?: string;
  certificateData?: string;
  knownHostsData?: string;
};

export type SandboxScope = "session" | "agent" | "shared";

export type SandboxConfig = {
  mode: "off" | "non-main" | "all";
  backend: SandboxBackendId;
  scope: SandboxScope;
  workspaceAccess: SandboxWorkspaceAccess;
  workspaceRoot: string;
  docker: SandboxDockerConfig;
  ssh: SandboxSshConfig;
  browser: SandboxBrowserConfig;
  tools: SandboxToolPolicy;
  prune: SandboxPruneConfig;
};

export type SandboxBrowserContext = {
  bridgeUrl: string;
  containerName: string;
};

export type SandboxContext = {
  enabled: boolean;
  backendId: SandboxBackendId;
  sessionKey: string;
  workspaceDir: string;
  agentWorkspaceDir: string;
  workspaceAccess: SandboxWorkspaceAccess;
  runtimeId: string;
  runtimeLabel: string;
  containerName: string;
  containerWorkdir: string;
  docker: SandboxDockerConfig;
  tools: SandboxToolPolicy;
  /** Deprecated: browser sandbox is no longer exposed and this stays false. */
  browserAllowHostControl: boolean;
  /** Deprecated: browser sandbox is no longer exposed and this stays undefined. */
  browser?: SandboxBrowserContext;
  fsBridge?: SandboxFsBridge;
  backend?: SandboxBackendHandle;
};

export type SandboxWorkspaceInfo = {
  workspaceDir: string;
  containerWorkdir: string;
};
