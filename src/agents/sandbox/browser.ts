import crypto from "node:crypto";
import fs from "node:fs";
import { getRuntimeConfig, type AlisioConfig } from "../../config/config.js";
import { deriveDefaultBrowserCdpPortRange } from "../../config/port-defaults.js";
import {
  DEFAULT_BROWSER_EVALUATE_ENABLED,
  DEFAULT_ALISIO_BROWSER_COLOR,
  DEFAULT_ALISIO_BROWSER_PROFILE_NAME,
  resolveProfile,
  startBrowserBridgeServer,
  stopBrowserBridgeServer,
  type ResolvedBrowserConfig,
} from "../../plugin-sdk/browser-runtime.js";
import { defaultRuntime } from "../../runtime.js";
import { resolveUserPath } from "../../utils.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { hasActiveEmbeddedRunForSandboxScope } from "../pi-embedded-runner/runs.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../workspace.js";
import { BROWSER_BRIDGES } from "./browser-bridges.js";
import { computeSandboxBrowserConfigHash } from "./config-hash.js";
import { resolveSandboxBrowserDockerCreateConfig, resolveSandboxConfigForAgent } from "./config.js";
import {
  DEFAULT_SANDBOX_BROWSER_IMAGE,
  SANDBOX_BROWSER_REGISTRY_PATH,
  SANDBOX_BROWSER_SECURITY_HASH_EPOCH,
} from "./constants.js";
import {
  buildSandboxCreateArgs,
  dockerContainerState,
  execDocker,
  readDockerContainerEnvVar,
  readDockerContainerLabel,
  readDockerPort,
} from "./docker.js";
import {
  buildNoVncObserverTargetUrl,
  buildNoVncObserverTokenUrl,
  consumeNoVncObserverToken,
  generateNoVncPassword,
  isNoVncEnabled,
  NOVNC_PASSWORD_ENV_KEY,
  issueNoVncObserverToken,
} from "./novnc-auth.js";
import {
  readBrowserRegistry,
  removeBrowserRegistryEntry,
  updateBrowserRegistry,
} from "./registry.js";
import {
  resolveSandboxAgentId,
  resolveSandboxScopeKey,
  resolveSandboxWorkspaceDir,
  slugifySessionKey,
} from "./shared.js";
import { isToolAllowed } from "./tool-policy.js";
import type { SandboxBrowserContext, SandboxConfig } from "./types.js";
import { validateNetworkMode } from "./validate-sandbox-security.js";
import { appendWorkspaceMountArgs } from "./workspace-mounts.js";

const HOT_BROWSER_WINDOW_MS = 5 * 60 * 1000;
const CDP_SOURCE_RANGE_ENV_KEY = "ALISIO_BROWSER_CDP_SOURCE_RANGE";
const SANDBOX_BROWSER_BRIDGE_BOOTSTRAP_INTERVAL_MS = 1_500;
const SANDBOX_BROWSER_BRIDGE_BOOTSTRAP_TIMEOUT_MS = 12_000;

let sandboxBrowserBridgeBootstrapPromise: Promise<void> | null = null;
let sandboxBrowserBridgeLastBootstrapAtMs = 0;
const sandboxBrowserBridgeHydrationByScope = new Map<string, Promise<string | undefined>>();

type SandboxBrowserRegistrySnapshotEntry = {
  containerName: string;
  sessionKey: string;
  createdAtMs: number;
  image: string;
  configHash?: string;
  cdpPort: number;
  noVncPort?: number;
  noVncPassword?: string;
};

type EnsureLiveSandboxBrowserBridgeOptions = {
  cfg?: AlisioConfig;
  sessionKey?: string;
  workspaceDir?: string;
  evaluateEnabled?: boolean;
};

async function waitForSandboxCdp(params: { cdpPort: number; timeoutMs: number }): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, params.timeoutMs);
  const url = `http://127.0.0.1:${params.cdpPort}/json/version`;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(ctrl.abort.bind(ctrl), 1000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (res.ok) {
          return true;
        }
      } finally {
        clearTimeout(t);
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function buildSandboxBrowserResolvedConfig(params: {
  controlPort: number;
  cdpPort: number;
  headless: boolean;
  evaluateEnabled: boolean;
}): ResolvedBrowserConfig {
  const cdpHost = "127.0.0.1";
  const cdpPortRange = deriveDefaultBrowserCdpPortRange(params.controlPort);
  return {
    enabled: true,
    evaluateEnabled: params.evaluateEnabled,
    controlPort: params.controlPort,
    cdpProtocol: "http",
    cdpHost,
    cdpIsLoopback: true,
    cdpPortRangeStart: cdpPortRange.start,
    cdpPortRangeEnd: cdpPortRange.end,
    remoteCdpTimeoutMs: 1500,
    remoteCdpHandshakeTimeoutMs: 3000,
    color: DEFAULT_ALISIO_BROWSER_COLOR,
    executablePath: undefined,
    headless: params.headless,
    noSandbox: false,
    attachOnly: true,
    defaultProfile: DEFAULT_ALISIO_BROWSER_PROFILE_NAME,
    extraArgs: [],
    profiles: {
      [DEFAULT_ALISIO_BROWSER_PROFILE_NAME]: {
        cdpPort: params.cdpPort,
        color: DEFAULT_ALISIO_BROWSER_COLOR,
      },
    },
  };
}

export function getLiveSandboxBrowserObserverUrl(scopeKey: string): string | undefined {
  scheduleSandboxBrowserBridgeBootstrap();
  const existing = BROWSER_BRIDGES.get(scopeKey);
  if (existing?.noVncPort) {
    const token = issueNoVncObserverToken({
      noVncPort: existing.noVncPort,
      password: existing.noVncPassword,
    });
    return buildNoVncObserverTokenUrl(existing.bridge.baseUrl, token);
  }
  const registryEntry = getSandboxBrowserRegistrySnapshot(scopeKey);
  if (!registryEntry?.noVncPort) {
    return undefined;
  }
  const expectedHash = resolveExpectedSandboxBrowserConfigHash(scopeKey);
  if (
    expectedHash &&
    (!registryEntry.configHash?.trim() || registryEntry.configHash.trim() !== expectedHash)
  ) {
    return undefined;
  }
  return buildNoVncObserverTargetUrl({
    port: registryEntry.noVncPort,
    password: registryEntry.noVncPassword,
  });
}

export function getLiveSandboxBrowserBridgeUrl(scopeKey: string): string | undefined {
  scheduleSandboxBrowserBridgeBootstrap();
  return BROWSER_BRIDGES.get(scopeKey)?.bridge.baseUrl?.trim() || undefined;
}

function getSandboxBrowserRegistrySnapshot(scopeKey: string) {
  try {
    const registry = readBrowserRegistrySync();
    return registry.entries.find((entry) => entry.sessionKey === scopeKey);
  } catch {
    return undefined;
  }
}

function readBrowserRegistrySync() {
  const raw = fs.readFileSync(SANDBOX_BROWSER_REGISTRY_PATH, "utf-8");
  const parsed = JSON.parse(raw) as { entries?: Array<Record<string, unknown>> };
  const entries: SandboxBrowserRegistrySnapshotEntry[] = Array.isArray(parsed.entries)
    ? parsed.entries
        .map((entry): SandboxBrowserRegistrySnapshotEntry | null => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const cdpPort =
            typeof entry.cdpPort === "number" && Number.isFinite(entry.cdpPort)
              ? entry.cdpPort
              : null;
          if (
            typeof entry.containerName !== "string" ||
            typeof entry.sessionKey !== "string" ||
            typeof entry.createdAtMs !== "number" ||
            !Number.isFinite(entry.createdAtMs) ||
            typeof entry.image !== "string" ||
            cdpPort === null
          ) {
            return null;
          }
          return {
            containerName: entry.containerName,
            sessionKey: entry.sessionKey,
            createdAtMs: entry.createdAtMs,
            image: entry.image,
            configHash:
              typeof entry.configHash === "string" && entry.configHash.trim()
                ? entry.configHash.trim()
                : undefined,
            cdpPort,
            noVncPort:
              typeof entry.noVncPort === "number" && Number.isFinite(entry.noVncPort)
                ? entry.noVncPort
                : undefined,
            noVncPassword:
              typeof entry.noVncPassword === "string" && entry.noVncPassword.trim()
                ? entry.noVncPassword.trim()
                : undefined,
          };
        })
        .filter((entry): entry is SandboxBrowserRegistrySnapshotEntry => entry !== null)
    : [];
  return {
    entries,
  };
}

function resolveSandboxScopeKind(scopeKey: string): SandboxConfig["scope"] {
  const trimmed = scopeKey.trim();
  if (trimmed === "shared") {
    return "shared";
  }
  return trimmed.startsWith("agent:") ? "agent" : "session";
}

function resolveExpectedSandboxBrowserConfigHash(
  scopeKey: string,
  cfg: AlisioConfig = getRuntimeConfig(),
  workspaceDir?: string,
): string | null {
  try {
    const trimmedScopeKey = scopeKey.trim();
    if (!trimmedScopeKey) {
      return null;
    }
    const agentId = resolveSessionAgentId({
      sessionKey: trimmedScopeKey,
      config: cfg,
    });
    const sandboxCfg = resolveSandboxConfigForAgent(cfg, agentId);
    if (!sandboxCfg.browser.enabled || !isToolAllowed(sandboxCfg.tools, "browser")) {
      return null;
    }
    const resolvedScopeKey = resolveSandboxScopeKey(sandboxCfg.scope, trimmedScopeKey);
    const browserImage = sandboxCfg.browser.image ?? DEFAULT_SANDBOX_BROWSER_IMAGE;
    const cdpSourceRange = sandboxCfg.browser.cdpSourceRange?.trim() || undefined;
    const browserDockerCfg = resolveSandboxBrowserDockerCreateConfig({
      docker: sandboxCfg.docker,
      browser: { ...sandboxCfg.browser, image: browserImage },
    });
    const agentWorkspaceDir = resolveUserPath(workspaceDir?.trim() || DEFAULT_AGENT_WORKSPACE_DIR);
    const workspaceRoot = resolveUserPath(sandboxCfg.workspaceRoot);
    const sandboxWorkspaceDir =
      sandboxCfg.scope === "shared"
        ? workspaceRoot
        : resolveSandboxWorkspaceDir(workspaceRoot, resolvedScopeKey);
    const effectiveWorkspaceDir =
      sandboxCfg.workspaceAccess === "rw" ? agentWorkspaceDir : sandboxWorkspaceDir;
    return computeSandboxBrowserConfigHash({
      docker: browserDockerCfg,
      browser: {
        cdpPort: sandboxCfg.browser.cdpPort,
        vncPort: sandboxCfg.browser.vncPort,
        noVncPort: sandboxCfg.browser.noVncPort,
        headless: sandboxCfg.browser.headless,
        enableNoVnc: sandboxCfg.browser.enableNoVnc,
        cdpSourceRange,
      },
      securityEpoch: SANDBOX_BROWSER_SECURITY_HASH_EPOCH,
      workspaceAccess: sandboxCfg.workspaceAccess,
      workspaceDir: effectiveWorkspaceDir,
      agentWorkspaceDir,
    });
  } catch {
    return null;
  }
}

async function ensureSandboxBrowserBridgeFromRuntimeOptions(
  scopeKey: string,
  opts: EnsureLiveSandboxBrowserBridgeOptions,
): Promise<string | undefined> {
  const cfg = opts.cfg;
  const sessionKey = opts.sessionKey?.trim();
  if (!cfg || !sessionKey) {
    return undefined;
  }
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  const sandboxCfg = resolveSandboxConfigForAgent(cfg, agentId);
  if (!sandboxCfg.browser.enabled || !isToolAllowed(sandboxCfg.tools, "browser")) {
    return undefined;
  }
  const resolvedScopeKey = resolveSandboxScopeKey(sandboxCfg.scope, sessionKey);
  if (resolvedScopeKey !== scopeKey.trim()) {
    return undefined;
  }
  const agentWorkspaceDir = resolveUserPath(
    opts.workspaceDir?.trim() || DEFAULT_AGENT_WORKSPACE_DIR,
  );
  const workspaceRoot = resolveUserPath(sandboxCfg.workspaceRoot);
  const sandboxWorkspaceDir =
    sandboxCfg.scope === "shared"
      ? workspaceRoot
      : resolveSandboxWorkspaceDir(workspaceRoot, resolvedScopeKey);
  const effectiveWorkspaceDir =
    sandboxCfg.workspaceAccess === "rw" ? agentWorkspaceDir : sandboxWorkspaceDir;
  const browser = await ensureSandboxBrowser({
    scopeKey: resolvedScopeKey,
    workspaceDir: effectiveWorkspaceDir,
    agentWorkspaceDir,
    cfg: sandboxCfg,
    evaluateEnabled: opts.evaluateEnabled,
  });
  return browser?.bridgeUrl?.trim() || undefined;
}

async function bootstrapSandboxBrowserBridges(): Promise<void> {
  const registry = await readBrowserRegistry();
  await Promise.all(
    registry.entries.map(async (entry) => {
      await ensureSandboxBrowserBridgeHydratedFromRegistryEntry(entry);
    }),
  );
}

async function ensureSandboxBrowserBridgeHydratedFromRegistryEntry(
  entry: SandboxBrowserRegistrySnapshotEntry,
): Promise<string | undefined> {
  const existing = BROWSER_BRIDGES.get(entry.sessionKey);
  const existingBaseUrl = existing?.bridge.baseUrl?.trim();
  if (existingBaseUrl) {
    return existingBaseUrl;
  }

  const state = await dockerContainerState(entry.containerName);
  if (!state.exists) {
    await removeBrowserRegistryEntry(entry.containerName).catch(() => undefined);
    return undefined;
  }

  const expectedHash = resolveExpectedSandboxBrowserConfigHash(entry.sessionKey);
  if (expectedHash) {
    const currentHash =
      (await readDockerContainerLabel(entry.containerName, "alisio.configHash"))?.trim() ||
      entry.configHash?.trim() ||
      "";
    if (currentHash !== expectedHash) {
      const activeRunForScope = hasActiveEmbeddedRunForSandboxScope({
        scope: resolveSandboxScopeKind(entry.sessionKey),
        scopeKey: entry.sessionKey,
      });
      if (!state.running || !activeRunForScope) {
        await execDocker(["rm", "-f", entry.containerName], { allowFailure: true });
        await removeBrowserRegistryEntry(entry.containerName).catch(() => undefined);
      }
      defaultRuntime.log(
        `Skipping stale sandbox browser bridge hydration for ${entry.containerName}: config mismatch.`,
      );
      return undefined;
    }
  }

  const noVncPassword =
    entry.noVncPassword?.trim() ||
    (entry.noVncPort
      ? ((await readDockerContainerEnvVar(entry.containerName, NOVNC_PASSWORD_ENV_KEY)) ??
        undefined)
      : undefined);
  const authToken = crypto.randomBytes(24).toString("hex");
  const bridge = await startBrowserBridgeServer({
    resolved: buildSandboxBrowserResolvedConfig({
      controlPort: 0,
      cdpPort: entry.cdpPort,
      headless: !entry.noVncPort,
      evaluateEnabled: DEFAULT_BROWSER_EVALUATE_ENABLED,
    }),
    authToken,
    onEnsureAttachTarget: async () => {
      const current = await dockerContainerState(entry.containerName);
      if (current.exists && !current.running) {
        await execDocker(["start", entry.containerName]);
      }
      const ok = await waitForSandboxCdp({
        cdpPort: entry.cdpPort,
        timeoutMs: SANDBOX_BROWSER_BRIDGE_BOOTSTRAP_TIMEOUT_MS,
      });
      if (!ok) {
        throw new Error(
          `Sandbox browser CDP did not become reachable on 127.0.0.1:${entry.cdpPort} within ${SANDBOX_BROWSER_BRIDGE_BOOTSTRAP_TIMEOUT_MS}ms.`,
        );
      }
    },
    resolveSandboxNoVncToken: consumeNoVncObserverToken,
  });
  BROWSER_BRIDGES.set(entry.sessionKey, {
    bridge,
    containerName: entry.containerName,
    authToken,
    noVncPort: entry.noVncPort,
    noVncPassword,
  });
  await updateBrowserRegistry({
    ...entry,
    lastUsedAtMs: Date.now(),
    noVncPassword,
  });
  return bridge.baseUrl?.trim() || undefined;
}

export async function ensureLiveSandboxBrowserBridgeUrl(
  scopeKey: string,
  opts?: EnsureLiveSandboxBrowserBridgeOptions,
): Promise<string | undefined> {
  const normalizedScopeKey = scopeKey.trim();
  if (!normalizedScopeKey) {
    return undefined;
  }

  const existingBaseUrl = BROWSER_BRIDGES.get(normalizedScopeKey)?.bridge.baseUrl?.trim();
  if (existingBaseUrl) {
    return existingBaseUrl;
  }

  const inFlight = sandboxBrowserBridgeHydrationByScope.get(normalizedScopeKey);
  if (inFlight) {
    return await inFlight;
  }

  const hydrationPromise = (async () => {
    try {
      const ensuredFromRuntime = await ensureSandboxBrowserBridgeFromRuntimeOptions(
        normalizedScopeKey,
        opts ?? {},
      );
      if (ensuredFromRuntime) {
        return ensuredFromRuntime;
      }
      const registry = await readBrowserRegistry();
      const entry = registry.entries.find(
        (candidate) => candidate.sessionKey === normalizedScopeKey,
      );
      if (!entry) {
        return undefined;
      }
      return await ensureSandboxBrowserBridgeHydratedFromRegistryEntry(entry);
    } catch (error) {
      defaultRuntime.log(
        `Failed to hydrate sandbox browser bridge for ${normalizedScopeKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    } finally {
      sandboxBrowserBridgeHydrationByScope.delete(normalizedScopeKey);
    }
  })();
  sandboxBrowserBridgeHydrationByScope.set(normalizedScopeKey, hydrationPromise);
  const hydratedBaseUrl = await hydrationPromise;
  if (hydratedBaseUrl) {
    return hydratedBaseUrl;
  }

  scheduleSandboxBrowserBridgeBootstrap();
  if (sandboxBrowserBridgeBootstrapPromise) {
    await sandboxBrowserBridgeBootstrapPromise.catch(() => undefined);
  }
  return BROWSER_BRIDGES.get(normalizedScopeKey)?.bridge.baseUrl?.trim() || undefined;
}

function scheduleSandboxBrowserBridgeBootstrap() {
  const now = Date.now();
  if (
    sandboxBrowserBridgeBootstrapPromise ||
    now - sandboxBrowserBridgeLastBootstrapAtMs < SANDBOX_BROWSER_BRIDGE_BOOTSTRAP_INTERVAL_MS
  ) {
    return;
  }
  sandboxBrowserBridgeLastBootstrapAtMs = now;
  sandboxBrowserBridgeBootstrapPromise = bootstrapSandboxBrowserBridges()
    .catch(() => undefined)
    .finally(() => {
      sandboxBrowserBridgeBootstrapPromise = null;
    });
}

async function ensureSandboxBrowserImage(image: string) {
  const result = await execDocker(["image", "inspect", image], {
    allowFailure: true,
  });
  if (result.code === 0) {
    return;
  }
  throw new Error(
    `Sandbox browser image not found: ${image}. Build it with scripts/sandbox-browser-setup.sh.`,
  );
}

async function ensureDockerNetwork(
  network: string,
  opts?: { allowContainerNamespaceJoin?: boolean },
) {
  validateNetworkMode(network, {
    allowContainerNamespaceJoin: opts?.allowContainerNamespaceJoin === true,
  });
  const normalized = network.trim().toLowerCase();
  if (!normalized || normalized === "bridge" || normalized === "none") {
    return;
  }
  const inspect = await execDocker(["network", "inspect", network], { allowFailure: true });
  if (inspect.code === 0) {
    return;
  }
  await execDocker(["network", "create", "--driver", "bridge", network]);
}

export async function ensureSandboxBrowser(params: {
  scopeKey: string;
  workspaceDir: string;
  agentWorkspaceDir: string;
  cfg: SandboxConfig;
  evaluateEnabled?: boolean;
  bridgeAuth?: { token?: string; password?: string };
}): Promise<SandboxBrowserContext | null> {
  if (!params.cfg.browser.enabled) {
    return null;
  }
  if (!isToolAllowed(params.cfg.tools, "browser")) {
    return null;
  }

  const slug = params.cfg.scope === "shared" ? "shared" : slugifySessionKey(params.scopeKey);
  const name = `${params.cfg.browser.containerPrefix}${slug}`;
  const containerName = name.slice(0, 63);
  const state = await dockerContainerState(containerName);
  const browserImage = params.cfg.browser.image ?? DEFAULT_SANDBOX_BROWSER_IMAGE;
  const cdpSourceRange = params.cfg.browser.cdpSourceRange?.trim() || undefined;
  const browserDockerCfg = resolveSandboxBrowserDockerCreateConfig({
    docker: params.cfg.docker,
    browser: { ...params.cfg.browser, image: browserImage },
  });
  const expectedHash = computeSandboxBrowserConfigHash({
    docker: browserDockerCfg,
    browser: {
      cdpPort: params.cfg.browser.cdpPort,
      vncPort: params.cfg.browser.vncPort,
      noVncPort: params.cfg.browser.noVncPort,
      headless: params.cfg.browser.headless,
      enableNoVnc: params.cfg.browser.enableNoVnc,
      cdpSourceRange,
    },
    securityEpoch: SANDBOX_BROWSER_SECURITY_HASH_EPOCH,
    workspaceAccess: params.cfg.workspaceAccess,
    workspaceDir: params.workspaceDir,
    agentWorkspaceDir: params.agentWorkspaceDir,
  });

  const now = Date.now();
  let hasContainer = state.exists;
  let running = state.running;
  let currentHash: string | null = null;
  let hashMismatch = false;
  let recreateSkippedBecauseRemovalFailed = false;
  const noVncEnabled = isNoVncEnabled(params.cfg.browser);
  let noVncPassword: string | undefined;

  if (hasContainer) {
    if (noVncEnabled) {
      noVncPassword =
        (await readDockerContainerEnvVar(containerName, NOVNC_PASSWORD_ENV_KEY)) ?? undefined;
    }
    const registry = await readBrowserRegistry();
    const registryEntry = registry.entries.find((entry) => entry.containerName === containerName);
    currentHash = await readDockerContainerLabel(containerName, "alisio.configHash");
    hashMismatch = !currentHash || currentHash !== expectedHash;
    if (!currentHash) {
      currentHash = registryEntry?.configHash ?? null;
      hashMismatch = !currentHash || currentHash !== expectedHash;
    }
    if (hashMismatch) {
      const lastUsedAtMs = registryEntry?.lastUsedAtMs;
      const isHot =
        running && (typeof lastUsedAtMs !== "number" || now - lastUsedAtMs < HOT_BROWSER_WINDOW_MS);
      const hasActiveRunForScope = hasActiveEmbeddedRunForSandboxScope({
        scope: params.cfg.scope,
        scopeKey: params.scopeKey,
      });
      if (isHot && hasActiveRunForScope) {
        const hint = (() => {
          if (params.cfg.scope === "session") {
            return `alisio sandbox recreate --browser --session ${params.scopeKey}`;
          }
          if (params.cfg.scope === "agent") {
            const agentId = resolveSandboxAgentId(params.scopeKey) ?? "main";
            return `alisio sandbox recreate --browser --agent ${agentId}`;
          }
          return "alisio sandbox recreate --browser --all";
        })();
        defaultRuntime.log(
          `Sandbox browser config changed for ${containerName} (recently used). Recreate to apply: ${hint}`,
        );
      } else {
        await execDocker(["rm", "-f", containerName], { allowFailure: true });
        const postRemoveState = await dockerContainerState(containerName);
        hasContainer = postRemoveState.exists;
        running = postRemoveState.running;
        recreateSkippedBecauseRemovalFailed = hasContainer;
        if (hasContainer) {
          defaultRuntime.log(
            `Sandbox browser recreate requested for ${containerName}, but the existing container still remains after rm -f. Reusing the current container instead of attempting a conflicting recreate.`,
          );
        }
      }
    }
  }

  if (!hasContainer) {
    if (noVncEnabled) {
      noVncPassword = generateNoVncPassword();
    }
    await ensureDockerNetwork(browserDockerCfg.network, {
      allowContainerNamespaceJoin: browserDockerCfg.dangerouslyAllowContainerNamespaceJoin === true,
    });
    await ensureSandboxBrowserImage(browserImage);
    const args = buildSandboxCreateArgs({
      name: containerName,
      cfg: browserDockerCfg,
      scopeKey: params.scopeKey,
      labels: {
        "alisio.sandboxBrowser": "1",
        "alisio.browserConfigEpoch": SANDBOX_BROWSER_SECURITY_HASH_EPOCH,
      },
      configHash: expectedHash,
      includeBinds: false,
      bindSourceRoots: [params.workspaceDir, params.agentWorkspaceDir],
    });
    appendWorkspaceMountArgs({
      args,
      workspaceDir: params.workspaceDir,
      agentWorkspaceDir: params.agentWorkspaceDir,
      workdir: params.cfg.docker.workdir,
      workspaceAccess: params.cfg.workspaceAccess,
    });
    if (browserDockerCfg.binds?.length) {
      for (const bind of browserDockerCfg.binds) {
        args.push("-v", bind);
      }
    }
    args.push("-p", `127.0.0.1::${params.cfg.browser.cdpPort}`);
    if (noVncEnabled) {
      args.push("-p", `127.0.0.1::${params.cfg.browser.noVncPort}`);
    }
    args.push("-e", `ALISIO_BROWSER_HEADLESS=${params.cfg.browser.headless ? "1" : "0"}`);
    args.push("-e", `ALISIO_BROWSER_ENABLE_NOVNC=${params.cfg.browser.enableNoVnc ? "1" : "0"}`);
    args.push("-e", `ALISIO_BROWSER_CDP_PORT=${params.cfg.browser.cdpPort}`);
    if (cdpSourceRange) {
      args.push("-e", `${CDP_SOURCE_RANGE_ENV_KEY}=${cdpSourceRange}`);
    }
    args.push("-e", `ALISIO_BROWSER_VNC_PORT=${params.cfg.browser.vncPort}`);
    args.push("-e", `ALISIO_BROWSER_NOVNC_PORT=${params.cfg.browser.noVncPort}`);
    // Chromium's setuid/namespace sandbox cannot work inside Docker containers
    // (PID namespace creation requires privileges Docker does not grant by default).
    // The container itself provides isolation, so --no-sandbox is safe here.
    args.push("-e", "ALISIO_BROWSER_NO_SANDBOX=1");
    if (noVncEnabled && noVncPassword) {
      args.push("-e", `${NOVNC_PASSWORD_ENV_KEY}=${noVncPassword}`);
    }
    args.push(browserImage);
    await execDocker(args);
    await execDocker(["start", containerName]);
  } else if (!running) {
    await execDocker(["start", containerName]);
  }

  const mappedCdp = await readDockerPort(containerName, params.cfg.browser.cdpPort);
  if (!mappedCdp) {
    throw new Error(`Failed to resolve CDP port mapping for ${containerName}.`);
  }

  const mappedNoVnc = noVncEnabled
    ? await readDockerPort(containerName, params.cfg.browser.noVncPort)
    : null;
  if (noVncEnabled && !noVncPassword) {
    noVncPassword =
      (await readDockerContainerEnvVar(containerName, NOVNC_PASSWORD_ENV_KEY)) ?? undefined;
  }

  const existing = BROWSER_BRIDGES.get(params.scopeKey);
  const existingProfile = existing
    ? resolveProfile(existing.bridge.state.resolved, DEFAULT_ALISIO_BROWSER_PROFILE_NAME)
    : null;

  let desiredAuthToken = params.bridgeAuth?.token?.trim() || undefined;
  let desiredAuthPassword = params.bridgeAuth?.password?.trim() || undefined;
  if (!desiredAuthToken && !desiredAuthPassword) {
    // Always require auth for the sandbox bridge server, even if gateway auth
    // mode doesn't produce a shared secret (e.g. trusted-proxy).
    // Keep it stable across calls by reusing the existing bridge auth.
    desiredAuthToken = existing?.authToken;
    desiredAuthPassword = existing?.authPassword;
    if (!desiredAuthToken && !desiredAuthPassword) {
      desiredAuthToken = crypto.randomBytes(24).toString("hex");
    }
  }

  const shouldReuse =
    existing && existing.containerName === containerName && existingProfile?.cdpPort === mappedCdp;
  const authMatches =
    !existing ||
    (existing.authToken === desiredAuthToken && existing.authPassword === desiredAuthPassword);
  if (existing && !shouldReuse) {
    await stopBrowserBridgeServer(existing.bridge.server).catch(() => undefined);
    BROWSER_BRIDGES.delete(params.scopeKey);
  }
  if (existing && shouldReuse && !authMatches) {
    await stopBrowserBridgeServer(existing.bridge.server).catch(() => undefined);
    BROWSER_BRIDGES.delete(params.scopeKey);
  }

  const bridge = (() => {
    if (shouldReuse && authMatches && existing) {
      return existing.bridge;
    }
    return null;
  })();

  const ensureBridge = async () => {
    if (bridge) {
      return bridge;
    }

    const onEnsureAttachTarget = params.cfg.browser.autoStart
      ? async () => {
          const state = await dockerContainerState(containerName);
          if (state.exists && !state.running) {
            await execDocker(["start", containerName]);
          }
          const ok = await waitForSandboxCdp({
            cdpPort: mappedCdp,
            timeoutMs: params.cfg.browser.autoStartTimeoutMs,
          });
          if (!ok) {
            throw new Error(
              `Sandbox browser CDP did not become reachable on 127.0.0.1:${mappedCdp} within ${params.cfg.browser.autoStartTimeoutMs}ms.`,
            );
          }
        }
      : undefined;

    return await startBrowserBridgeServer({
      resolved: buildSandboxBrowserResolvedConfig({
        controlPort: 0,
        cdpPort: mappedCdp,
        headless: params.cfg.browser.headless,
        evaluateEnabled: params.evaluateEnabled ?? DEFAULT_BROWSER_EVALUATE_ENABLED,
      }),
      authToken: desiredAuthToken,
      authPassword: desiredAuthPassword,
      onEnsureAttachTarget,
      resolveSandboxNoVncToken: consumeNoVncObserverToken,
    });
  };

  const resolvedBridge = await ensureBridge();
  BROWSER_BRIDGES.set(params.scopeKey, {
    bridge: resolvedBridge,
    containerName,
    authToken: desiredAuthToken,
    authPassword: desiredAuthPassword,
    noVncPort: mappedNoVnc ?? undefined,
    noVncPassword,
  });

  await updateBrowserRegistry({
    containerName,
    sessionKey: params.scopeKey,
    createdAtMs: now,
    lastUsedAtMs: now,
    image: browserImage,
    configHash:
      hashMismatch && (running || recreateSkippedBecauseRemovalFailed)
        ? (currentHash ?? undefined)
        : expectedHash,
    cdpPort: mappedCdp,
    noVncPort: mappedNoVnc ?? undefined,
    noVncPassword,
  });

  const noVncUrl =
    mappedNoVnc && noVncEnabled
      ? (() => {
          const token = issueNoVncObserverToken({
            noVncPort: mappedNoVnc,
            password: noVncPassword,
          });
          return buildNoVncObserverTokenUrl(resolvedBridge.baseUrl, token);
        })()
      : undefined;

  return {
    bridgeUrl: resolvedBridge.baseUrl,
    noVncUrl,
    containerName,
  };
}

export const __testing = {
  bootstrapSandboxBrowserBridges,
  ensureLiveSandboxBrowserBridgeUrl,
};
