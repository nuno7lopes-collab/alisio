import { beforeEach, describe, expect, it, vi } from "vitest";
import { slugifySessionKey } from "./shared.js";
import { collectDockerFlagValues, findDockerArgsCall } from "./test-args.js";
import type { SandboxConfig } from "./types.js";

let BROWSER_BRIDGES: Map<string, unknown>;
let ensureSandboxBrowser: typeof import("./browser.js").ensureSandboxBrowser;
let getLiveSandboxBrowserBridgeUrl: typeof import("./browser.js").getLiveSandboxBrowserBridgeUrl;
let getLiveSandboxBrowserObserverUrl: typeof import("./browser.js").getLiveSandboxBrowserObserverUrl;
let browserTesting: typeof import("./browser.js").__testing;
let resetNoVncObserverTokensForTests: typeof import("./novnc-auth.js").resetNoVncObserverTokensForTests;

const dockerMocks = vi.hoisted(() => ({
  dockerContainerState: vi.fn(),
  execDocker: vi.fn(),
  readDockerContainerEnvVar: vi.fn(),
  readDockerContainerLabel: vi.fn(),
  readDockerPort: vi.fn(),
}));

const registryMocks = vi.hoisted(() => ({
  readBrowserRegistry: vi.fn(),
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
    getLiveSandboxBrowserObserverUrl,
    __testing: browserTesting,
  } = await import("./browser.js"));
  ({ resetNoVncObserverTokensForTests } = await import("./novnc-auth.js"));
}

function buildConfig(enableNoVnc: boolean): SandboxConfig {
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
      vncPort: 5900,
      noVncPort: 6080,
      headless: false,
      enableNoVnc,
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

describe("ensureSandboxBrowser create args", () => {
  beforeEach(async () => {
    await loadFreshBrowserModulesForTest();
    BROWSER_BRIDGES.clear();
    resetNoVncObserverTokensForTests();
    dockerMocks.dockerContainerState.mockClear();
    dockerMocks.execDocker.mockClear();
    dockerMocks.readDockerContainerEnvVar.mockClear();
    dockerMocks.readDockerContainerLabel.mockClear();
    dockerMocks.readDockerPort.mockClear();
    registryMocks.readBrowserRegistry.mockClear();
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
      if (port === 6080) {
        return 49101;
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

  it("publishes noVNC on loopback and injects noVNC password env", async () => {
    const result = await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg: buildConfig(true),
    });

    const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");

    expect(createArgs).toBeDefined();
    expect(createArgs).toContain("127.0.0.1::6080");
    const envEntries = collectDockerFlagValues(createArgs ?? [], "-e");
    expect(envEntries).toContain("ALISIO_BROWSER_NO_SANDBOX=1");
    const passwordEntry = envEntries.find((entry) =>
      entry.startsWith("ALISIO_BROWSER_NOVNC_PASSWORD="),
    );
    expect(passwordEntry).toMatch(/^ALISIO_BROWSER_NOVNC_PASSWORD=[A-Za-z0-9]{8}$/);
    expect(result?.noVncUrl).toMatch(/^http:\/\/127\.0\.0\.1:19000\/sandbox\/novnc\?token=/);
    expect(result?.noVncUrl).not.toContain("password=");
  });

  it("does not inject noVNC password env when noVNC is disabled", async () => {
    const result = await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg: buildConfig(false),
    });

    const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");
    const envEntries = collectDockerFlagValues(createArgs ?? [], "-e");
    expect(envEntries.some((entry) => entry.startsWith("ALISIO_BROWSER_NOVNC_PASSWORD="))).toBe(
      false,
    );
    expect(result?.noVncUrl).toBeUndefined();
  });

  it("mounts the main workspace read-only when workspaceAccess is none", async () => {
    const cfg = buildConfig(false);
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
    const cfg = buildConfig(false);
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
    const cfg = buildConfig(true);
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
          noVncPort: 49101,
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

  it("keeps hot browser containers running when an active run still uses the sandbox scope", async () => {
    const cfg = buildConfig(true);
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
          noVncPort: 49101,
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
          noVncPort: 49101,
          noVncPassword: "Abc12345",
        },
      ],
    });
    dockerMocks.dockerContainerState.mockResolvedValue({ exists: true, running: true });

    await browserTesting.bootstrapSandboxBrowserBridges();

    expect(getLiveSandboxBrowserBridgeUrl("session:test")).toBe("http://127.0.0.1:19000");
    expect(getLiveSandboxBrowserObserverUrl("session:test")).toMatch(
      /^http:\/\/127\.0\.0\.1:19000\/sandbox\/novnc\?token=/,
    );
    expect(bridgeMocks.startBrowserBridgeServer).toHaveBeenCalledTimes(1);
  });
});
