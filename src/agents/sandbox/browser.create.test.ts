import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlisioConfig } from "../../config/config.js";
import { slugifySessionKey } from "./shared.js";
import { collectDockerFlagValues, findDockerArgsCall } from "./test-args.js";
import type { SandboxConfig } from "./types.js";

let BROWSER_BRIDGES: Map<string, unknown>;
let ensureSandboxBrowser: typeof import("./browser.js").ensureSandboxBrowser;
let getLiveSandboxBrowserBridgeUrl: typeof import("./browser.js").getLiveSandboxBrowserBridgeUrl;
let browserTesting: typeof import("./browser.js").__testing;

const dockerMocks = vi.hoisted(() => ({
  dockerContainerState: vi.fn(),
  execDocker: vi.fn(),
  readDockerContainerEnvVar: vi.fn(),
  readDockerContainerLabel: vi.fn(),
  readDockerPort: vi.fn(),
}));

const registryMocks = vi.hoisted(() => ({
  readBrowserRegistry: vi.fn(),
  removeBrowserRegistryEntry: vi.fn(),
  updateBrowserRegistry: vi.fn(),
}));

const embeddedRunMocks = vi.hoisted(() => ({
  hasActiveEmbeddedRunForSandboxScope: vi.fn(),
}));

const bridgeMocks = vi.hoisted(() => ({
  startBrowserBridgeServer: vi.fn(),
  stopBrowserBridgeServer: vi.fn(),
}));

vi.mock("./docker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./docker.js")>();
  return {
    ...actual,
    dockerContainerState: dockerMocks.dockerContainerState,
    execDocker: dockerMocks.execDocker,
    readDockerContainerEnvVar: dockerMocks.readDockerContainerEnvVar,
    readDockerContainerLabel: dockerMocks.readDockerContainerLabel,
    readDockerPort: dockerMocks.readDockerPort,
  };
});

vi.mock("./registry.js", () => ({
  readBrowserRegistry: registryMocks.readBrowserRegistry,
  removeBrowserRegistryEntry: registryMocks.removeBrowserRegistryEntry,
  updateBrowserRegistry: registryMocks.updateBrowserRegistry,
}));

vi.mock("../pi-embedded-runner/runs.js", () => ({
  hasActiveEmbeddedRunForSandboxScope: embeddedRunMocks.hasActiveEmbeddedRunForSandboxScope,
}));

vi.mock("../../plugin-sdk/browser-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../plugin-sdk/browser-runtime.js")>();
  return {
    ...actual,
    startBrowserBridgeServer: bridgeMocks.startBrowserBridgeServer,
    stopBrowserBridgeServer: bridgeMocks.stopBrowserBridgeServer,
  };
});

async function loadFreshBrowserModulesForTest() {
  vi.resetModules();
  ({ BROWSER_BRIDGES } = await import("./browser-bridges.js"));
  ({
    ensureSandboxBrowser,
    getLiveSandboxBrowserBridgeUrl,
    __testing: browserTesting,
  } = await import("./browser.js"));
}

function buildConfig(): SandboxConfig {
  return {
    mode: "all",
    backend: "docker",
    scope: "session",
    workspaceAccess: "none",
    workspaceRoot: "/tmp/alisio-sandboxes",
    docker: {
      image: "alisio-sandbox:bookworm-slim",
      containerPrefix: "alisio-sbx-",
      workdir: "/workspace",
      readOnlyRoot: true,
      tmpfs: ["/tmp", "/var/tmp", "/run"],
      network: "none",
      capDrop: ["ALL"],
      env: { LANG: "C.UTF-8" },
    },
    ssh: {
      command: "ssh",
      workspaceRoot: "/tmp/alisio-sandboxes",
      strictHostKeyChecking: true,
      updateHostKeys: true,
    },
    browser: {
      enabled: true,
      image: "alisio-sandbox-browser:bookworm-slim",
      containerPrefix: "alisio-sbx-browser-",
      network: "alisio-sandbox-browser",
      cdpPort: 9222,
      headless: false,
      allowHostControl: false,
      autoStart: true,
      autoStartTimeoutMs: 12_000,
    },
    tools: {
      allow: ["browser"],
      deny: [],
    },
    prune: {
      idleHours: 24,
      maxAgeDays: 7,
    },
  };
}

function buildRuntimeConfig(): AlisioConfig {
  const sandbox = buildConfig();
  return {
    agents: {
      defaults: {
        sandbox: {
          mode: sandbox.mode,
          backend: sandbox.backend,
          scope: sandbox.scope,
          workspaceAccess: sandbox.workspaceAccess,
          workspaceRoot: sandbox.workspaceRoot,
          docker: sandbox.docker,
          browser: sandbox.browser,
          tools: sandbox.tools,
          prune: sandbox.prune,
        },
      },
    },
    tools: {
      sandbox: {
        tools: {
          allow: ["browser"],
        },
      },
    },
  } as AlisioConfig;
}

describe("ensureSandboxBrowser create args", () => {
  beforeEach(async () => {
    await loadFreshBrowserModulesForTest();
    BROWSER_BRIDGES.clear();
    dockerMocks.dockerContainerState.mockClear();
    dockerMocks.execDocker.mockClear();
    dockerMocks.readDockerContainerEnvVar.mockClear();
    dockerMocks.readDockerContainerLabel.mockClear();
    dockerMocks.readDockerPort.mockClear();
    registryMocks.readBrowserRegistry.mockClear();
    registryMocks.removeBrowserRegistryEntry.mockClear();
    registryMocks.updateBrowserRegistry.mockClear();
    embeddedRunMocks.hasActiveEmbeddedRunForSandboxScope.mockReset().mockReturnValue(false);
    bridgeMocks.startBrowserBridgeServer.mockClear();
    bridgeMocks.stopBrowserBridgeServer.mockClear();

    dockerMocks.dockerContainerState.mockResolvedValue({ exists: false, running: false });
    dockerMocks.execDocker.mockImplementation(async (args: string[]) => {
      if (args[0] === "image" && args[1] === "inspect") {
        return { stdout: "[]", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    });
    dockerMocks.readDockerContainerLabel.mockResolvedValue(null);
    dockerMocks.readDockerContainerEnvVar.mockResolvedValue(null);
    dockerMocks.readDockerPort.mockImplementation(async (_containerName: string, port: number) => {
      if (port === 9222) {
        return 49100;
      }
      return null;
    });
    registryMocks.readBrowserRegistry.mockResolvedValue({ entries: [] });
    registryMocks.updateBrowserRegistry.mockResolvedValue(undefined);
    bridgeMocks.startBrowserBridgeServer.mockResolvedValue({
      server: {} as never,
      port: 19000,
      baseUrl: "http://127.0.0.1:19000",
      state: {
        server: null,
        port: 19000,
        resolved: { profiles: {} },
        profiles: new Map(),
      },
    });
    bridgeMocks.stopBrowserBridgeServer.mockResolvedValue(undefined);
  });

  it("publishes only loopback CDP and returns bridge metadata only", async () => {
    const result = await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg: buildConfig(),
    });

    const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");

    expect(createArgs).toBeDefined();
    const envEntries = collectDockerFlagValues(createArgs ?? [], "-e");
    expect(envEntries).toContain("ALISIO_BROWSER_NO_SANDBOX=1");
    expect(envEntries.some((entry) => /^ALISIO_BROWSER_.*PASSWORD=/.test(entry))).toBe(false);
    expect(result).toStrictEqual({
      bridgeUrl: "http://127.0.0.1:19000",
      containerName: expect.any(String),
    });
  });

  it("mounts the main workspace read-only when workspaceAccess is none", async () => {
    const cfg = buildConfig();
    cfg.workspaceAccess = "none";

    await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
    });

    const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");

    expect(createArgs).toBeDefined();
    expect(createArgs).toContain("/tmp/workspace:/workspace:ro");
  });

  it("keeps the main workspace writable when workspaceAccess is rw", async () => {
    const cfg = buildConfig();
    cfg.workspaceAccess = "rw";

    await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
    });

    const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");

    expect(createArgs).toBeDefined();
    expect(createArgs).toContain("/tmp/workspace:/workspace");
    expect(createArgs).not.toContain("/tmp/workspace:/workspace:ro");
  });

  it("recreates hot browser containers immediately when no active run uses the sandbox scope", async () => {
    const cfg = buildConfig();
    const containerName = `alisio-sbx-browser-${slugifySessionKey("session:test")}`.slice(0, 63);

    dockerMocks.dockerContainerState.mockResolvedValue({ exists: true, running: true });
    dockerMocks.readDockerContainerLabel.mockResolvedValue("stale-hash");
    registryMocks.readBrowserRegistry.mockResolvedValue({
      entries: [
        {
          containerName,
          sessionKey: "session:test",
          createdAtMs: 1,
          lastUsedAtMs: Date.now(),
          image: cfg.browser.image,
          configHash: "stale-hash",
          cdpPort: 49100,
        },
      ],
    });

    await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
    });

    expect(dockerMocks.execDocker).toHaveBeenCalledWith(["rm", "-f", containerName], {
      allowFailure: true,
    });
  });

  it("reuses the current browser container when rm -f fails to remove a stale runtime", async () => {
    const cfg = buildConfig();
    const containerName = `alisio-sbx-browser-${slugifySessionKey("session:test")}`.slice(0, 63);

    dockerMocks.dockerContainerState
      .mockResolvedValueOnce({ exists: true, running: true })
      .mockResolvedValueOnce({ exists: true, running: true });
    dockerMocks.readDockerContainerLabel.mockResolvedValue("stale-hash");
    registryMocks.readBrowserRegistry.mockResolvedValue({
      entries: [
        {
          containerName,
          sessionKey: "session:test",
          createdAtMs: 1,
          lastUsedAtMs: Date.now() - 10 * 60_000,
          image: cfg.browser.image,
          configHash: "stale-hash",
          cdpPort: 49100,
        },
      ],
    });

    const result = await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
    });

    expect(result?.bridgeUrl).toBe("http://127.0.0.1:19000");
    expect(dockerMocks.execDocker).toHaveBeenCalledWith(["rm", "-f", containerName], {
      allowFailure: true,
    });
    expect(findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create")).toBeUndefined();
    expect(registryMocks.updateBrowserRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName,
        configHash: "stale-hash",
      }),
    );
  });

  it("keeps hot browser containers running when an active run still uses the sandbox scope", async () => {
    const cfg = buildConfig();
    const containerName = `alisio-sbx-browser-${slugifySessionKey("session:test")}`.slice(0, 63);

    embeddedRunMocks.hasActiveEmbeddedRunForSandboxScope.mockReturnValue(true);
    dockerMocks.dockerContainerState.mockResolvedValue({ exists: true, running: true });
    dockerMocks.readDockerContainerLabel.mockResolvedValue("stale-hash");
    registryMocks.readBrowserRegistry.mockResolvedValue({
      entries: [
        {
          containerName,
          sessionKey: "session:test",
          createdAtMs: 1,
          lastUsedAtMs: Date.now(),
          image: cfg.browser.image,
          configHash: "stale-hash",
          cdpPort: 49100,
        },
      ],
    });

    await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
    });

    expect(dockerMocks.execDocker).not.toHaveBeenCalledWith(["rm", "-f", containerName], {
      allowFailure: true,
    });
  });

  it("rehydrates a live browser bridge from the registry after process restart", async () => {
    registryMocks.readBrowserRegistry.mockResolvedValue({
      entries: [
        {
          containerName: "alisio-sbx-browser-session-test",
          sessionKey: "session:test",
          createdAtMs: 1,
          lastUsedAtMs: Date.now(),
          image: "alisio-sandbox-browser:bookworm-slim",
          cdpPort: 49100,
        },
      ],
    });
    dockerMocks.dockerContainerState.mockResolvedValue({ exists: true, running: true });

    await browserTesting.bootstrapSandboxBrowserBridges();

    expect(getLiveSandboxBrowserBridgeUrl("session:test")).toBe("http://127.0.0.1:19000");
    expect(bridgeMocks.startBrowserBridgeServer).toHaveBeenCalledTimes(1);
  });

  it("hydrates a requested browser bridge from the registry on demand", async () => {
    registryMocks.readBrowserRegistry.mockResolvedValue({
      entries: [
        {
          containerName: "alisio-sbx-browser-session-test",
          sessionKey: "session:test",
          createdAtMs: 1,
          lastUsedAtMs: Date.now(),
          image: "alisio-sandbox-browser:bookworm-slim",
          cdpPort: 49100,
        },
      ],
    });
    dockerMocks.dockerContainerState.mockResolvedValue({ exists: true, running: true });

    const first = await browserTesting.ensureLiveSandboxBrowserBridgeUrl("session:test");
    const second = await browserTesting.ensureLiveSandboxBrowserBridgeUrl("session:test");

    expect(first).toBe("http://127.0.0.1:19000");
    expect(second).toBe("http://127.0.0.1:19000");
    expect(bridgeMocks.startBrowserBridgeServer).toHaveBeenCalledTimes(1);
    expect(getLiveSandboxBrowserBridgeUrl("session:test")).toBe("http://127.0.0.1:19000");
  });

  it("recreates a stale browser runtime from the active config when lazy resolution needs a bridge", async () => {
    const containerName = `alisio-sbx-browser-${slugifySessionKey("session:test")}`.slice(0, 63);
    registryMocks.readBrowserRegistry.mockResolvedValue({
      entries: [
        {
          containerName,
          sessionKey: "session:test",
          createdAtMs: 1,
          lastUsedAtMs: Date.now() - 10 * 60_000,
          image: "alisio-sandbox-browser:bookworm-slim",
          configHash: "stale-hash",
          cdpPort: 49100,
        },
      ],
    });
    dockerMocks.dockerContainerState
      .mockResolvedValueOnce({ exists: true, running: false })
      .mockResolvedValueOnce({ exists: false, running: false });
    dockerMocks.readDockerContainerLabel.mockResolvedValue("stale-hash");

    const ensured = await browserTesting.ensureLiveSandboxBrowserBridgeUrl("session:test", {
      cfg: buildRuntimeConfig(),
      sessionKey: "session:test",
    });

    expect(ensured).toBe("http://127.0.0.1:19000");
    expect(dockerMocks.execDocker).toHaveBeenCalledWith(["rm", "-f", containerName], {
      allowFailure: true,
    });
    expect(findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create")).toBeDefined();
    expect(bridgeMocks.startBrowserBridgeServer).toHaveBeenCalledTimes(1);
  });
});
