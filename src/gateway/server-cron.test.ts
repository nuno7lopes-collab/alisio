import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../cli/deps.js";
import type { AlisioConfig } from "../config/config.js";
import { SsrFBlockedError } from "../infra/net/ssrf.js";
import { mergeMockedModule } from "../test-utils/vitest-module-mocks.js";

const {
  enqueueSystemEventMock,
  requestHeartbeatNowMock,
  loadConfigMock,
  fetchWithSsrFGuardMock,
  runCronIsolatedAgentTurnMock,
  loadAlisioGatewayAccountContextMock,
} = vi.hoisted(() => ({
  enqueueSystemEventMock: vi.fn(),
  requestHeartbeatNowMock: vi.fn(),
  loadConfigMock: vi.fn(),
  fetchWithSsrFGuardMock: vi.fn(),
  runCronIsolatedAgentTurnMock: vi.fn(async () => ({ status: "ok" as const, summary: "ok" })),
  loadAlisioGatewayAccountContextMock: vi.fn(),
}));

function enqueueSystemEvent(...args: unknown[]) {
  return enqueueSystemEventMock(...args);
}

function requestHeartbeatNow(...args: unknown[]) {
  return requestHeartbeatNowMock(...args);
}

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent,
}));

vi.mock("../infra/heartbeat-wake.js", async (importOriginal) => {
  return await mergeMockedModule(
    await importOriginal<typeof import("../infra/heartbeat-wake.js")>(),
    () => ({
      requestHeartbeatNow,
    }),
  );
});

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: () => loadConfigMock(),
  };
});

vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard: fetchWithSsrFGuardMock,
}));

vi.mock("../cron/isolated-agent.js", () => ({
  runCronIsolatedAgentTurn: runCronIsolatedAgentTurnMock,
}));

vi.mock("./alisio-account-context.js", async () => {
  const actual = await vi.importActual<typeof import("./alisio-account-context.js")>(
    "./alisio-account-context.js",
  );
  return {
    ...actual,
    loadAlisioGatewayAccountContext: loadAlisioGatewayAccountContextMock,
  };
});

import { buildGatewayCronService } from "./server-cron.js";

function createAccountContext(accountId = "user-1") {
  return {
    account: {},
    canonical: {
      scopeRoot: "account",
      accountId,
      source: "account_id",
      authenticated: true,
      authRequired: true,
    },
    currentDevice: {
      id: "device-1",
      label: "Mac",
      platform: "macos",
      current: true,
    },
    deviceBinding: {
      binding: "account_bound",
      runtime: "local",
      current: true,
      accountId,
      deviceId: "device-1",
      label: "Mac",
      platform: "macos",
    },
    runtimeContract: {
      scopeRoot: "account",
      backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
      localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
    },
  };
}

function createCronConfig(name: string): AlisioConfig {
  const tmpDir = path.join(os.tmpdir(), `${name}-${Date.now()}`);
  return {
    session: {
      mainKey: "main",
    },
    cron: {
      store: path.join(tmpDir, "cron.json"),
    },
  } as AlisioConfig;
}

describe("buildGatewayCronService", () => {
  beforeEach(() => {
    enqueueSystemEventMock.mockClear();
    requestHeartbeatNowMock.mockClear();
    loadConfigMock.mockClear();
    fetchWithSsrFGuardMock.mockClear();
    runCronIsolatedAgentTurnMock.mockClear();
    loadAlisioGatewayAccountContextMock.mockReset();
    loadAlisioGatewayAccountContextMock.mockResolvedValue(createAccountContext());
  });

  it("uses an account-scoped default cron store", async () => {
    const prevSkipCron = process.env.ALISIO_SKIP_CRON;
    process.env.ALISIO_SKIP_CRON = "0";
    const cfg = {
      session: {
        mainKey: "main",
      },
    } as AlisioConfig;
    loadConfigMock.mockReturnValue(cfg);
    loadAlisioGatewayAccountContextMock.mockResolvedValueOnce(
      createAccountContext("Person@Example.com"),
    );

    const state = await buildGatewayCronService({
      cfg,
      deps: {} as CliDeps,
      broadcast: () => {},
    });

    try {
      expect(path.normalize(state.storePath)).toContain(
        path.normalize("accounts/person-example-com/cron/jobs.json"),
      );
      expect(state.cronEnabled).toBe(true);
    } finally {
      state.cron.stop();
      if (prevSkipCron === undefined) {
        delete process.env.ALISIO_SKIP_CRON;
      } else {
        process.env.ALISIO_SKIP_CRON = prevSkipCron;
      }
    }
  });

  it("routes main-target jobs to the scoped session for enqueue + wake", async () => {
    const cfg = createCronConfig("server-cron");
    loadConfigMock.mockReturnValue(cfg);

    const state = await buildGatewayCronService({
      cfg,
      deps: {} as CliDeps,
      broadcast: () => {},
    });
    try {
      const job = await state.cron.add({
        name: "canonicalize-session-key",
        enabled: true,
        schedule: { kind: "at", at: new Date(1).toISOString() },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        sessionKey: "discord:channel:ops",
        payload: { kind: "systemEvent", text: "hello" },
      });

      await state.cron.run(job.id, "force");

      expect(enqueueSystemEventMock).toHaveBeenCalledWith(
        "hello",
        expect.objectContaining({
          sessionKey: "agent:main:discord:channel:ops",
        }),
      );
      expect(requestHeartbeatNowMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey: "agent:main:discord:channel:ops",
        }),
      );
    } finally {
      state.cron.stop();
    }
  });

  it("blocks private webhook URLs via SSRF-guarded fetch", async () => {
    const cfg = createCronConfig("server-cron-ssrf");
    loadConfigMock.mockReturnValue(cfg);
    fetchWithSsrFGuardMock.mockRejectedValue(
      new SsrFBlockedError("Blocked: resolves to private/internal/special-use IP address"),
    );

    const state = await buildGatewayCronService({
      cfg,
      deps: {} as CliDeps,
      broadcast: () => {},
    });
    try {
      const job = await state.cron.add({
        name: "ssrf-webhook-blocked",
        enabled: true,
        schedule: { kind: "at", at: new Date(1).toISOString() },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "hello" },
        delivery: {
          mode: "webhook",
          to: "http://127.0.0.1:8080/cron-finished",
        },
      });

      await state.cron.run(job.id, "force");

      expect(fetchWithSsrFGuardMock).toHaveBeenCalledOnce();
      expect(fetchWithSsrFGuardMock).toHaveBeenCalledWith({
        url: "http://127.0.0.1:8080/cron-finished",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"action":"finished"'),
          signal: expect.any(AbortSignal),
        },
      });
    } finally {
      state.cron.stop();
    }
  });

  it("passes custom session targets through to isolated cron runs", async () => {
    const tmpDir = path.join(os.tmpdir(), `server-cron-custom-session-${Date.now()}`);
    const cfg = {
      session: {
        mainKey: "main",
      },
      cron: {
        store: path.join(tmpDir, "cron.json"),
      },
    } as AlisioConfig;
    loadConfigMock.mockReturnValue(cfg);

    const state = await buildGatewayCronService({
      cfg,
      deps: {} as CliDeps,
      broadcast: () => {},
    });
    try {
      const job = await state.cron.add({
        name: "custom-session",
        enabled: true,
        schedule: { kind: "at", at: new Date(1).toISOString() },
        sessionTarget: "session:project-alpha-monitor",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "hello" },
      });

      await state.cron.run(job.id, "force");

      expect(runCronIsolatedAgentTurnMock).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({ id: job.id }),
          sessionKey: "project-alpha-monitor",
        }),
      );
    } finally {
      state.cron.stop();
    }
  });
});
