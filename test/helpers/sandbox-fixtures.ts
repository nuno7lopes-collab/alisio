import type {
  SandboxBrowserConfig,
  SandboxPruneConfig,
  SandboxSshConfig,
} from "../../src/agents/sandbox/types.js";

export function createSandboxBrowserConfig(
  overrides: Partial<SandboxBrowserConfig> = {},
): SandboxBrowserConfig {
  return {
    enabled: false,
    image: "alisio-browser",
    containerPrefix: "alisio-browser-",
    network: "bridge",
    cdpPort: 9222,
    headless: true,
    allowHostControl: false,
    autoStart: false,
    autoStartTimeoutMs: 1000,
    ...overrides,
  };
}

export function createSandboxPruneConfig(
  overrides: Partial<SandboxPruneConfig> = {},
): SandboxPruneConfig {
  return {
    idleHours: 24,
    maxAgeDays: 7,
    ...overrides,
  };
}

export function createSandboxSshConfig(
  workspaceRoot: string,
  overrides: Partial<SandboxSshConfig> = {},
): SandboxSshConfig {
  return {
    command: "ssh",
    workspaceRoot,
    strictHostKeyChecking: true,
    updateHostKeys: true,
    ...overrides,
  };
}
