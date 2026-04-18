import { beforeEach, describe, expect, it, vi } from "vitest";
import { computerSessionManager } from "../../computer/session-manager.js";
import { computerHandlers } from "./computer.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

function createOptions(params: Record<string, unknown>, invoke = vi.fn()): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method: "computer.session.get", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      nodeRegistry: {
        invoke,
      },
      logGateway: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    },
  } as unknown as GatewayRequestHandlerOptions;
}

describe("computerHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs helper runtime and permissions on session get", async () => {
    const sessionKey = "computer-session-get-runtime";
    computerSessionManager.ensureSession({
      sessionKey,
      nodeId: "mac-node-1",
    });
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        payloadJSON: JSON.stringify({
          connectionState: "running",
          launchCount: 2,
          helper: {
            protocolVersion: 1,
            helperVersion: "1.2.3",
            processId: 4242,
            activeSession: {
              sessionId: sessionKey,
              state: "running",
              updatedAt: 123,
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        payloadJSON: JSON.stringify({
          accessibility: true,
          screenRecording: false,
        }),
      });
    const opts = createOptions({ sessionKey }, invoke);

    await computerHandlers["computer.session.get"](opts);

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        nodeId: "mac-node-1",
        command: "computer.health",
        params: { sessionId: sessionKey },
      }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nodeId: "mac-node-1",
        command: "computer.permissions",
        params: {},
      }),
    );
    expect(opts.respond).toHaveBeenCalledTimes(1);
    const responsePayload = (opts.respond as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(responsePayload).toMatchObject({
      sessionKey,
      session: {
        permissions: {
          accessibility: true,
          screenRecording: false,
        },
        runtime: {
          connectionState: "running",
          launchCount: 2,
          helperVersion: "1.2.3",
          helperProcessId: 4242,
          activeSession: {
            sessionKey,
            state: "running",
            updatedAt: 123,
          },
        },
      },
    });
  });

  it("forwards pause to the node helper session command", async () => {
    const sessionKey = "computer-session-pause";
    computerSessionManager.ensureSession({
      sessionKey,
      nodeId: "mac-node-2",
    });
    const invoke = vi.fn().mockResolvedValueOnce({
      ok: true,
      payloadJSON: JSON.stringify({
        sessionId: sessionKey,
        state: "paused",
        permissions: {
          accessibility: true,
          screenRecording: true,
        },
        health: {
          connectionState: "running",
          launchCount: 1,
          helper: {
            protocolVersion: 1,
            helperVersion: "dev",
            processId: 501,
            activeSession: {
              sessionId: sessionKey,
              state: "paused",
              updatedAt: 456,
            },
          },
        },
      }),
    });
    const opts = createOptions({ sessionKey, command: "pause" }, invoke);

    await computerHandlers["computer.session.update"](opts);

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "mac-node-2",
        command: "computer.session.pause",
        params: { sessionId: sessionKey },
      }),
    );
    expect(opts.respond).toHaveBeenCalledTimes(1);
    const responsePayload = (opts.respond as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(responsePayload).toMatchObject({
      sessionKey,
      session: {
        status: "paused",
        runtime: {
          connectionState: "running",
          activeSession: {
            sessionKey,
            state: "paused",
            updatedAt: 456,
          },
        },
      },
    });
  });

  it("marks the helper as disabled when the node no longer declares computer helper commands", async () => {
    const sessionKey = "computer-session-disabled";
    computerSessionManager.ensureSession({
      sessionKey,
      nodeId: "mac-node-3",
    });
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          message: "command not declared by node",
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          message: "command not declared by node",
        },
      });
    const opts = createOptions({ sessionKey }, invoke);

    await computerHandlers["computer.session.get"](opts);

    expect(opts.respond).toHaveBeenCalledTimes(1);
    const responsePayload = (opts.respond as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(responsePayload).toMatchObject({
      sessionKey,
      session: {
        status: "error",
        lastError: "command not declared by node",
        runtime: {
          connectionState: "disabled",
          lastError: {
            code: "HELPER_UNAVAILABLE",
            message: "command not declared by node",
            retryable: false,
          },
        },
      },
    });
  });

  it("applies computer policy patches through session.update", async () => {
    const sessionKey = "computer-session-policy";
    computerSessionManager.ensureSession({
      sessionKey,
      nodeId: "mac-node-4",
    });
    const opts = createOptions(
      {
        sessionKey,
        policy: {
          allow: {
            hosts: ["intranet.example.com"],
          },
          deny: {
            apps: ["1password"],
          },
        },
      },
      vi.fn(),
    );

    await computerHandlers["computer.session.update"](opts);

    expect(opts.respond).toHaveBeenCalledTimes(1);
    const responsePayload = (opts.respond as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(responsePayload).toMatchObject({
      sessionKey,
      session: {
        policy: {
          allow: {
            hosts: ["intranet.example.com"],
          },
          deny: {
            apps: ["1password"],
          },
        },
      },
    });
  });

  it("exports the structured session summary for debugging", async () => {
    const sessionKey = "computer-session-export";
    computerSessionManager.ensureSession({
      sessionKey,
      nodeId: "mac-node-5",
    });
    const exported = computerSessionManager.exportSession(sessionKey);
    const opts = createOptions({ sessionKey }, vi.fn());

    await computerHandlers["computer.session.export"](opts);

    expect(opts.respond).toHaveBeenCalledTimes(1);
    const responsePayload = (opts.respond as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(responsePayload).toMatchObject({
      sessionKey,
      sessionExport: {
        sessionKey,
        exportedAt: expect.any(Number),
        summary: {
          status: exported.summary.status,
          mode: exported.summary.mode,
        },
        buffers: {
          eventLimit: 160,
          replayFrameLimit: 24,
          replayStepLimit: 24,
          timelineLimit: 80,
        },
      },
    });
  });
});
