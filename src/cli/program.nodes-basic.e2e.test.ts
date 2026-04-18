import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeListResponse } from "./program.nodes-test-helpers.js";
import { callGateway, installBaseProgramMocks, runtime } from "./program.test-mocks.js";

installBaseProgramMocks();
let registerNodesCli: (program: Command) => void;

function formatRuntimeLogCallArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

describe("cli program (nodes basics)", () => {
  let program: Command;

  beforeAll(async () => {
    ({ registerNodesCli } = await import("./nodes-cli.js"));
    program = new Command();
    program.exitOverride();
    registerNodesCli(program);
  });

  async function runProgram(argv: string[]) {
    runtime.log.mockClear();
    await program.parseAsync(argv, { from: "user" });
  }

  function getRuntimeOutput() {
    return runtime.log.mock.calls.map((c) => formatRuntimeLogCallArg(c[0])).join("\n");
  }

  function mockGatewayWithNodeListAnd(method: "node.describe" | "node.invoke", result: unknown) {
    callGateway.mockImplementation(async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as { method?: string };
      if (opts.method === "node.list") {
        return createNodeListResponse();
      }
      if (opts.method === method) {
        return result;
      }
      return { ok: true };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs nodes list --connected and filters to connected nodes", async () => {
    const now = Date.now();
    callGateway.mockImplementation(async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as { method?: string };
      if (opts.method === "node.pair.list") {
        return {
          pending: [],
          paired: [
            {
              nodeId: "n1",
              displayName: "One",
              remoteIp: "10.0.0.1",
              lastConnectedAtMs: now - 1_000,
            },
            {
              nodeId: "n2",
              displayName: "Two",
              remoteIp: "10.0.0.2",
              lastConnectedAtMs: now - 1_000,
            },
          ],
        };
      }
      if (opts.method === "node.list") {
        return {
          nodes: [
            { nodeId: "n1", connected: true },
            { nodeId: "n2", connected: false },
          ],
        };
      }
      return { ok: true };
    });
    await runProgram(["nodes", "list", "--connected"]);

    expect(callGateway).toHaveBeenCalledWith(expect.objectContaining({ method: "node.list" }));
    const output = getRuntimeOutput();
    expect(output).toContain("One");
    expect(output).not.toContain("Two");
  });

  it("runs nodes status --last-connected and filters by age", async () => {
    const now = Date.now();
    callGateway.mockImplementation(async (...args: unknown[]) => {
      const opts = (args[0] ?? {}) as { method?: string };
      if (opts.method === "node.list") {
        return {
          ts: now,
          nodes: [
            { nodeId: "n1", displayName: "One", connected: false },
            { nodeId: "n2", displayName: "Two", connected: false },
          ],
        };
      }
      if (opts.method === "node.pair.list") {
        return {
          pending: [],
          paired: [
            { nodeId: "n1", lastConnectedAtMs: now - 1_000 },
            { nodeId: "n2", lastConnectedAtMs: now - 2 * 24 * 60 * 60 * 1000 },
          ],
        };
      }
      return { ok: true };
    });
    await runProgram(["nodes", "status", "--last-connected", "24h"]);

    expect(callGateway).toHaveBeenCalledWith(expect.objectContaining({ method: "node.pair.list" }));
    const output = getRuntimeOutput();
    expect(output).toContain("One");
    expect(output).not.toContain("Two");
  });

  it.each([
    {
      label: "paired node details",
      node: {
        nodeId: "mac-node",
        displayName: "Mac Node",
        remoteIp: "192.168.0.88",
        deviceFamily: "Mac",
        modelIdentifier: "Mac14,10",
        caps: ["canvas", "camera"],
        paired: true,
        connected: true,
      },
      expectedOutput: [
        "Known: 1 · Paired: 1 · Connected: 1",
        "Mac Node",
        "Detail",
        "device: Mac",
        "hw: Mac14,10",
        "Status",
        "paired",
        "Caps",
        "camera",
        "canvas",
      ],
    },
    {
      label: "unpaired node details",
      node: {
        nodeId: "linux-node",
        displayName: "Linux Worker",
        remoteIp: "192.168.0.99",
        deviceFamily: "Linux",
        modelIdentifier: "linux-x64",
        caps: ["canvas", "camera"],
        paired: false,
        connected: true,
      },
      expectedOutput: [
        "Known: 1 · Paired: 0 · Connected: 1",
        "Linux Worker",
        "Detail",
        "device: Linux",
        "hw: linux-x64",
        "Status",
        "unpaired",
        "connected",
        "Caps",
        "camera",
        "canvas",
      ],
    },
  ])("runs nodes status and renders $label", async ({ node, expectedOutput }) => {
    callGateway.mockResolvedValue({
      ts: Date.now(),
      nodes: [node],
    });
    await runProgram(["nodes", "status"]);

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({ method: "node.list", params: {} }),
    );

    const output = getRuntimeOutput();
    for (const expected of expectedOutput) {
      expect(output).toContain(expected);
    }
  });

  it("runs nodes describe and calls node.describe", async () => {
    mockGatewayWithNodeListAnd("node.describe", {
      ts: Date.now(),
      nodeId: "mac-node",
      displayName: "Mac Node",
      caps: ["canvas", "camera"],
      commands: ["canvas.eval", "canvas.snapshot", "camera.snap"],
      connected: true,
    });

    await runProgram(["nodes", "describe", "--node", "mac-node"]);

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({ method: "node.list", params: {} }),
    );
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "node.describe",
        params: { nodeId: "mac-node" },
      }),
    );

    const out = getRuntimeOutput();
    expect(out).toContain("Commands");
    expect(out).toContain("canvas.eval");
  });

  it("runs nodes approve and calls node.pair.approve", async () => {
    callGateway.mockResolvedValue({
      requestId: "r1",
      node: { nodeId: "n1", token: "t1" },
    });
    await expect(runProgram(["nodes", "approve", "r1"])).rejects.toThrow("exit");
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "node.pair.approve",
        params: { requestId: "r1" },
      }),
    );
  });

  it("runs nodes invoke and calls node.invoke", async () => {
    mockGatewayWithNodeListAnd("node.invoke", {
      ok: true,
      nodeId: "mac-node",
      command: "canvas.eval",
      payload: { result: "ok" },
    });

    await expect(
      runProgram([
        "nodes",
        "invoke",
        "--node",
        "mac-node",
        "--command",
        "canvas.eval",
        "--params",
        '{"javaScript":"1+1"}',
      ]),
    ).rejects.toThrow("exit");

    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({ method: "node.list", params: {} }),
    );
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "node.invoke",
        params: {
          nodeId: "mac-node",
          command: "canvas.eval",
          params: { javaScript: "1+1" },
          timeoutMs: 15000,
          idempotencyKey: "idem-test",
        },
      }),
    );
  });
});
