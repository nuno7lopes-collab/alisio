import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { createCliRuntimeCapture } from "./test-runtime-capture.js";

const probeGatewayStatus = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
const resolveGatewayProgramArguments = vi.fn(async (_opts?: unknown) => ({
  programArguments: ["/bin/node", "cli", "gateway", "run", "--port", "40705"],
}));
const serviceInstall = vi.fn().mockResolvedValue(undefined);
const serviceStage = vi.fn().mockResolvedValue(undefined);
const serviceUninstall = vi.fn().mockResolvedValue(undefined);
const serviceStop = vi.fn().mockResolvedValue(undefined);
const serviceRestart = vi.fn().mockResolvedValue({ outcome: "completed" });
const serviceIsLoaded = vi.fn().mockResolvedValue(false);
const serviceReadCommand = vi.fn().mockResolvedValue(null);
const serviceReadRuntime = vi.fn().mockResolvedValue({ status: "running" });
const resolveGatewayProbeAuthWithSecretInputs = vi.fn(async (_opts?: unknown) => ({}));
const findExtraGatewayServices = vi.fn(async (_env: unknown, _opts?: unknown) => []);
const inspectPortUsage = vi.fn(async (port: number) => ({
  port,
  status: "free",
  listeners: [],
  hints: [],
}));
const buildGatewayInstallPlan = vi.fn(
  async (params: { port: number; token?: string; env?: NodeJS.ProcessEnv }) => ({
    programArguments: ["/bin/node", "cli", "gateway", "run", "--port", String(params.port)],
    workingDirectory: process.cwd(),
    environment: {
      ALISIO_GATEWAY_PORT: String(params.port),
      ...(params.token ? { ALISIO_GATEWAY_TOKEN: params.token } : {}),
    },
  }),
);

const { runtimeLogs, defaultRuntime, resetRuntimeCapture } = createCliRuntimeCapture();

vi.mock("./daemon-cli/probe.js", () => ({
  probeGatewayStatus: (opts: unknown) => probeGatewayStatus(opts),
}));

vi.mock("../gateway/probe-auth.js", () => ({
  resolveGatewayProbeAuthWithSecretInputs: (opts: unknown) =>
    resolveGatewayProbeAuthWithSecretInputs(opts),
}));

vi.mock("../daemon/program-args.js", () => ({
  resolveGatewayProgramArguments: (opts: unknown) => resolveGatewayProgramArguments(opts),
}));

vi.mock("../daemon/service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../daemon/service.js")>();
  return {
    ...actual,
    resolveGatewayService: () => ({
      label: "LaunchAgent",
      loadedText: "loaded",
      notLoadedText: "not loaded",
      stage: serviceStage,
      install: serviceInstall,
      uninstall: serviceUninstall,
      stop: serviceStop,
      restart: serviceRestart,
      isLoaded: serviceIsLoaded,
      readCommand: serviceReadCommand,
      readRuntime: serviceReadRuntime,
    }),
  };
});

vi.mock("../daemon/legacy.js", () => ({
  findLegacyGatewayServices: async () => [],
}));

vi.mock("../daemon/inspect.js", () => ({
  findExtraGatewayServices: (env: unknown, opts?: unknown) => findExtraGatewayServices(env, opts),
  renderGatewayServiceCleanupHints: () => [],
}));

vi.mock("../infra/ports.js", () => ({
  inspectPortUsage: (port: number) => inspectPortUsage(port),
  formatPortDiagnostics: () => ["Port 40705 is already in use."],
}));

vi.mock("../runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime.js")>()),
  defaultRuntime,
}));

vi.mock("../commands/daemon-install-helpers.js", () => ({
  buildGatewayInstallPlan: (params: { port: number; token?: string; env?: NodeJS.ProcessEnv }) =>
    buildGatewayInstallPlan(params),
}));

vi.mock("./deps.js", () => ({
  createDefaultDeps: () => {},
}));

vi.mock("./progress.js", () => ({
  withProgress: async (_opts: unknown, fn: () => Promise<unknown>) => await fn(),
}));

const { registerDaemonCli } = await import("./daemon-cli.js");
let daemonProgram: Command;

function createDaemonProgram() {
  const program = new Command();
  program.exitOverride();
  registerDaemonCli(program);
  return program;
}

async function runDaemonCommand(args: string[]) {
  await daemonProgram.parseAsync(args, { from: "user" });
}

function parseFirstJsonRuntimeLine<T>() {
  const jsonLine = runtimeLogs.find((line) => line.trim().startsWith("{"));
  return JSON.parse(jsonLine ?? "{}") as T;
}

describe("daemon-cli coverage", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    daemonProgram = createDaemonProgram();
    envSnapshot = captureEnv([
      "ALISIO_STATE_DIR",
      "ALISIO_CONFIG_PATH",
      "ALISIO_GATEWAY_PORT",
      "ALISIO_PROFILE",
    ]);
    process.env.ALISIO_STATE_DIR = "/tmp/alisio-cli-state";
    process.env.ALISIO_CONFIG_PATH = "/tmp/alisio-cli-state/alisio.json";
    delete process.env.ALISIO_GATEWAY_PORT;
    delete process.env.ALISIO_PROFILE;
    serviceReadCommand.mockResolvedValue(null);
    resolveGatewayProbeAuthWithSecretInputs.mockClear();
    buildGatewayInstallPlan.mockClear();
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it("probes gateway status by default", async () => {
    resetRuntimeCapture();
    probeGatewayStatus.mockClear();

    await runDaemonCommand(["daemon", "status"]);

    expect(probeGatewayStatus).toHaveBeenCalledTimes(1);
    expect(probeGatewayStatus).toHaveBeenCalledWith(
      expect.objectContaining({ url: "ws://127.0.0.1:40705" }),
    );
    expect(findExtraGatewayServices).toHaveBeenCalled();
    expect(inspectPortUsage).toHaveBeenCalled();
  });

  it("derives probe URL from service args + env (json)", async () => {
    resetRuntimeCapture();
    probeGatewayStatus.mockClear();
    inspectPortUsage.mockClear();

    serviceReadCommand.mockResolvedValueOnce({
      programArguments: ["/bin/node", "cli", "gateway", "run", "--port", "19001"],
      environment: {
        ALISIO_PROFILE: "dev",
        ALISIO_STATE_DIR: "/tmp/alisio-daemon-state",
        ALISIO_CONFIG_PATH: "/tmp/alisio-daemon-state/alisio.json",
        ALISIO_GATEWAY_PORT: "19001",
      },
      sourcePath: "/tmp/ai.alisio.gateway.plist",
    });

    await runDaemonCommand(["daemon", "status", "--json"]);

    expect(probeGatewayStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "ws://127.0.0.1:19001",
      }),
    );
    expect(inspectPortUsage).toHaveBeenCalledWith(19001);

    const parsed = parseFirstJsonRuntimeLine<{
      gateway?: { port?: number; portSource?: string; probeUrl?: string };
      config?: { mismatch?: boolean };
      rpc?: { url?: string; ok?: boolean };
    }>();
    expect(parsed.gateway?.port).toBe(19001);
    expect(parsed.gateway?.portSource).toBe("service args");
    expect(parsed.gateway?.probeUrl).toBe("ws://127.0.0.1:19001");
    expect(parsed.config?.mismatch).toBe(true);
    expect(parsed.rpc?.url).toBe("ws://127.0.0.1:19001");
    expect(parsed.rpc?.ok).toBe(true);
  });

  it("passes deep scan flag for daemon status", async () => {
    findExtraGatewayServices.mockClear();

    await runDaemonCommand(["daemon", "status", "--deep"]);

    expect(findExtraGatewayServices).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deep: true }),
    );
  });

  it("installs the daemon (json output)", async () => {
    resetRuntimeCapture();
    serviceIsLoaded.mockResolvedValueOnce(false);
    serviceInstall.mockClear();

    await runDaemonCommand([
      "daemon",
      "install",
      "--port",
      "40705",
      "--token",
      "test-token",
      "--json",
    ]);

    expect(serviceInstall).toHaveBeenCalledTimes(1);
    const parsed = parseFirstJsonRuntimeLine<{
      ok?: boolean;
      action?: string;
      result?: string;
    }>();
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("install");
    expect(parsed.result).toBe("installed");
  });

  it("starts and stops daemon (json output)", async () => {
    resetRuntimeCapture();
    serviceRestart.mockClear();
    serviceStop.mockClear();
    serviceIsLoaded.mockResolvedValue(true);

    await runDaemonCommand(["daemon", "start", "--json"]);
    await runDaemonCommand(["daemon", "stop", "--json"]);

    expect(serviceRestart).toHaveBeenCalledTimes(1);
    expect(serviceStop).toHaveBeenCalledTimes(1);
    const jsonLines = runtimeLogs.filter((line) => line.trim().startsWith("{"));
    const parsed = jsonLines.map((line) => JSON.parse(line) as { action?: string; ok?: boolean });
    expect(parsed.some((entry) => entry.action === "start" && entry.ok === true)).toBe(true);
    expect(parsed.some((entry) => entry.action === "stop" && entry.ok === true)).toBe(true);
  });
});
