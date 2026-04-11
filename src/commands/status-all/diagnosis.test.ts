import { describe, expect, it, vi } from "vitest";
import type { ProgressReporter } from "../../cli/progress.js";

vi.mock("../../daemon/launchd.js", () => ({
  resolveGatewayLogPaths: () => {
    throw new Error("skip log tail");
  },
}));

vi.mock("./gateway.js", () => ({
  readFileTailLines: vi.fn(async () => []),
  summarizeLogTail: vi.fn(() => []),
}));

import { appendStatusAllDiagnosis } from "./diagnosis.js";

type DiagnosisParams = Parameters<typeof appendStatusAllDiagnosis>[0];

function createProgressReporter(): ProgressReporter {
  return {
    setLabel: () => {},
    setPercent: () => {},
    tick: () => {},
    done: () => {},
  };
}

function createBaseParams(
  listeners: NonNullable<DiagnosisParams["portUsage"]>["listeners"],
): DiagnosisParams {
  return {
    lines: [] as string[],
    progress: createProgressReporter(),
    muted: (text: string) => text,
    ok: (text: string) => text,
    warn: (text: string) => text,
    fail: (text: string) => text,
    connectionDetailsForReport: "ws://127.0.0.1:40705",
    snap: null,
    remoteUrlMissing: false,
    secretDiagnostics: [],
    sentinel: null,
    lastErr: null,
    port: 40705,
    portUsage: { port: 40705, status: "busy", listeners, hints: [] },
    tailscaleMode: "off",
    tailscale: {
      backendState: null,
      dnsName: null,
      ips: [],
      error: null,
    },
    tailscaleHttpsUrl: null,
    skillStatus: null,
    pluginCompatibility: [],
    channelsStatus: null,
    channelIssues: [],
    gatewayReachable: false,
    health: null,
    nodeOnlyGateway: null,
  };
}

describe("status-all diagnosis port checks", () => {
  it("treats same-process dual-stack loopback listeners as healthy", async () => {
    const params = createBaseParams([
      { pid: 5001, commandLine: "alisio-gateway", address: "127.0.0.1:40705" },
      { pid: 5001, commandLine: "alisio-gateway", address: "[::1]:40705" },
    ]);

    await appendStatusAllDiagnosis(params);

    const output = params.lines.join("\n");
    expect(output).toContain("✓ Port 40705");
    expect(output).toContain("Detected dual-stack loopback listeners");
    expect(output).not.toContain("Port 40705 is already in use.");
  });

  it("keeps warning for multi-process listener conflicts", async () => {
    const params = createBaseParams([
      { pid: 5001, commandLine: "alisio-gateway", address: "127.0.0.1:40705" },
      { pid: 5002, commandLine: "alisio-gateway", address: "[::1]:40705" },
    ]);

    await appendStatusAllDiagnosis(params);

    const output = params.lines.join("\n");
    expect(output).toContain("! Port 40705");
    expect(output).toContain("Port 40705 is already in use.");
  });

  it("avoids unreachable gateway diagnosis in node-only mode", async () => {
    const params = createBaseParams([]);
    params.connectionDetailsForReport = [
      "Node-only mode detected",
      "Local gateway: not expected on this machine",
      "Remote gateway target: gateway.example.com:19000",
    ].join("\n");
    params.tailscale.backendState = "Running";
    params.health = undefined;
    params.nodeOnlyGateway = {
      gatewayTarget: "gateway.example.com:19000",
      gatewayValue: "node → gateway.example.com:19000 · no local gateway",
      connectionDetails: [
        "Node-only mode detected",
        "Local gateway: not expected on this machine",
        "Remote gateway target: gateway.example.com:19000",
        "Inspect the remote gateway host for live channel and health details.",
      ].join("\n"),
    };

    await appendStatusAllDiagnosis(params);

    const output = params.lines.join("\n");
    expect(output).toContain("Node-only mode detected");
    expect(output).toContain(
      "Channel issues skipped (node-only mode; query gateway.example.com:19000)",
    );
    expect(output).not.toContain("Channel issues skipped (gateway unreachable)");
    expect(output).not.toContain("Gateway health:");
  });
});
