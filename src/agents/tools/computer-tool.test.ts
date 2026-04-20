import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  callGatewayTool: vi.fn(),
}));

const nodeMocks = vi.hoisted(() => ({
  resolveNode: vi.fn(),
}));

vi.mock("./gateway.js", () => ({
  callGatewayTool: (...args: unknown[]) => gatewayMocks.callGatewayTool(...args),
  readGatewayCallOptions: () => ({}),
}));

vi.mock("./nodes-utils.js", () => ({
  resolveNode: (...args: unknown[]) => nodeMocks.resolveNode(...args),
}));

let createComputerTool: typeof import("./computer-tool.js").createComputerTool;
let computerSessionManager: typeof import("../../computer/session-manager.js").computerSessionManager;

beforeEach(async () => {
  vi.resetModules();
  gatewayMocks.callGatewayTool.mockReset();
  nodeMocks.resolveNode.mockReset();
  ({ createComputerTool } = await import("./computer-tool.js"));
  ({ computerSessionManager } = await import("../../computer/session-manager.js"));
  nodeMocks.resolveNode.mockResolvedValue({
    nodeId: "mac-local",
    platform: "macos",
    permissions: {
      accessibility: true,
      screenRecording: true,
    },
  });
});

function observePayload(capturedAt: number) {
  return {
    payload: {
      frame: {
        id: `frame-${capturedAt}`,
        dataUrl: "data:image/jpeg;base64,abc",
        mimeType: "image/jpeg",
        width: 1440,
        height: 900,
        pixelWidth: 1440,
        pixelHeight: 900,
        logicalWidth: 720,
        logicalHeight: 450,
        scaleFactor: 2,
        orientation: "landscape",
        displayId: "display-1",
        sourceSpace: "display-pixel",
        capturedAt,
        maxAgeMs: 5000,
        staleAt: capturedAt + 5000,
      },
      context: {
        display: {
          id: "display-1",
          width: 1440,
          height: 900,
          scale: 2,
          logicalWidth: 720,
          logicalHeight: 450,
          pixelWidth: 1440,
          pixelHeight: 900,
          orientation: "landscape",
        },
        activeApp: {
          name: "Finder",
          bundleId: "com.apple.finder",
        },
        activeWindow: {
          title: "Downloads",
        },
        capturedAt,
      },
    },
  };
}

describe("createComputerTool", () => {
  it("does not execute actions while the session is paused", async () => {
    const sessionKey = "computer-tool-paused";
    computerSessionManager.ensureSession({
      sessionKey,
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
    });
    computerSessionManager.pause(sessionKey);

    const tool = createComputerTool({ agentSessionKey: sessionKey });

    await expect(
      tool.execute?.("tool-call-paused", {
        action: "click",
        x: 12,
        y: 24,
      }),
    ).rejects.toThrow("session paused");
    expect(gatewayMocks.callGatewayTool).not.toHaveBeenCalled();
  });

  it("does not execute actions while the session is awaiting approval", async () => {
    const sessionKey = "computer-tool-awaiting-approval";
    computerSessionManager.ensureSession({
      sessionKey,
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
    });
    computerSessionManager.setBlocking(sessionKey, {
      kind: "blocked_on_approval",
      reasonCode: "approval_required",
      summary: "approval pending",
      at: 1,
      targetId: "local-mac:local:host",
      openTrigger: "open_approval",
    });

    const tool = createComputerTool({ agentSessionKey: sessionKey });

    await expect(
      tool.execute?.("tool-call-awaiting-approval", {
        action: "click",
        x: 12,
        y: 24,
      }),
    ).rejects.toThrow("awaiting approval");
    expect(gatewayMocks.callGatewayTool).not.toHaveBeenCalled();
  });

  it("does not observe when screen recording permission is missing", async () => {
    const sessionKey = "computer-tool-observe-permission-missing";
    nodeMocks.resolveNode.mockResolvedValueOnce({
      nodeId: "mac-local",
      platform: "macos",
      permissions: {
        accessibility: true,
        screenRecording: false,
      },
    });

    const tool = createComputerTool({ agentSessionKey: sessionKey });

    await expect(
      tool.execute?.("tool-call-observe-permission", {
        action: "observe",
      }),
    ).rejects.toThrow("Screen recording permission is missing");
    expect(gatewayMocks.callGatewayTool).not.toHaveBeenCalled();
    expect(computerSessionManager.getSession(sessionKey)).toMatchObject({
      status: "blocked_on_permissions",
      blocking: {
        kind: "blocked_on_permissions",
        reasonCode: "observation_permission_missing",
      },
    });
  });

  it("does not claim local computer control on windows-local", async () => {
    const sessionKey = "computer-tool-windows";
    nodeMocks.resolveNode.mockResolvedValueOnce({
      nodeId: "windows-local",
      platform: "windows",
      permissions: {},
    });

    const tool = createComputerTool({ agentSessionKey: sessionKey });

    await expect(
      tool.execute?.("tool-call-windows", {
        action: "session",
      }),
    ).rejects.toThrow("windows-local");
    expect(gatewayMocks.callGatewayTool).not.toHaveBeenCalled();
    expect(computerSessionManager.getSession(sessionKey)).toMatchObject({
      backend: "windows-local",
      status: "blocked_on_runtime",
      permissions: {
        observation: "not_supported",
        control: "not_supported",
      },
    });
  });

  it("captures a fresh frame before control actions even when the session already has a frame", async () => {
    const sessionKey = "computer-tool-fresh-preobserve";
    computerSessionManager.ensureSession({
      sessionKey,
      mode: "foreground_supervised",
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
    });
    computerSessionManager.recordObservation(
      sessionKey,
      {
        frame: {
          id: "frame-stale",
          dataUrl: "data:image/jpeg;base64,stale",
          mimeType: "image/jpeg",
          width: 1280,
          height: 720,
          pixelWidth: 1280,
          pixelHeight: 720,
          logicalWidth: 640,
          logicalHeight: 360,
          scaleFactor: 2,
          orientation: "landscape",
          displayId: "display-stale",
          sourceSpace: "display-pixel",
          capturedAt: 5,
          maxAgeMs: 5000,
          staleAt: 5005,
        },
        context: {
          display: {
            id: "display-stale",
            width: 1280,
            height: 720,
            scale: 2,
            logicalWidth: 640,
            logicalHeight: 360,
            pixelWidth: 1280,
            pixelHeight: 720,
            orientation: "landscape",
          },
          activeApp: {
            name: "Old App",
            bundleId: "com.example.old",
          },
          capturedAt: 5,
        },
      },
      "stale frame",
    );

    gatewayMocks.callGatewayTool.mockResolvedValueOnce(observePayload(10)).mockResolvedValueOnce({
      payload: {
        ok: true,
        summary: "Clicked Finder",
        observation: observePayload(20).payload,
      },
    });

    const tool = createComputerTool({ agentSessionKey: sessionKey });
    const result = await tool.execute?.("tool-call-1", {
      action: "click",
      x: 12,
      y: 24,
    });
    const state = (result as { details?: { computerSession?: unknown } }).details
      ?.computerSession as import("../../computer/types.js").ComputerSessionState | undefined;

    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledTimes(2);
    expect(gatewayMocks.callGatewayTool).toHaveBeenNthCalledWith(
      1,
      "node.invoke",
      {},
      expect.objectContaining({
        nodeId: "mac-local",
        command: "computer.observe",
        params: expect.objectContaining({
          sessionId: sessionKey,
        }),
      }),
    );
    expect(gatewayMocks.callGatewayTool).toHaveBeenNthCalledWith(
      2,
      "node.invoke",
      {},
      expect.objectContaining({
        nodeId: "mac-local",
        command: "computer.act",
        params: expect.objectContaining({
          sessionId: sessionKey,
          action: expect.objectContaining({
            id: expect.any(String),
            coordinateSpace: "display-pixel",
            frame: expect.objectContaining({
              frameId: "frame-10",
              displayId: "display-1",
              pixelWidth: 1440,
              logicalWidth: 720,
            }),
            transform: expect.objectContaining({
              sourceSpace: "display-pixel",
              sourceWidth: 1440,
              sourceHeight: 900,
            }),
          }),
        }),
      }),
    );
    expect(state).toMatchObject({
      stepCounter: 1,
      activeStep: null,
      lastCompletedStep: {
        sequence: 1,
        toolCallId: "tool-call-1",
        phase: "observe-after-action",
        status: "completed",
        actionType: "click",
      },
      frame: {
        capturedAt: 20,
      },
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          kind: "foreground_control",
          available: true,
          exposure: "exposed",
        }),
      ]),
    });
    expect(state?.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "status",
          eventCode: "focus_required",
        }),
        expect.objectContaining({
          kind: "observation",
          stepSequence: 1,
          toolCallId: "tool-call-1",
          stepPhase: "observe-before-action",
        }),
        expect.objectContaining({
          kind: "action",
          stepSequence: 1,
          toolCallId: "tool-call-1",
          stepPhase: "action",
        }),
        expect.objectContaining({
          kind: "observation",
          stepSequence: 1,
          toolCallId: "tool-call-1",
          stepPhase: "observe-after-action",
        }),
      ]),
    );
  });

  it("starts the helper-backed session through computer.session.update", async () => {
    const sessionKey = "computer-tool-session-start";
    gatewayMocks.callGatewayTool.mockResolvedValueOnce({
      session: {
        sessionKey,
        backend: "local-mac",
        status: "idle",
        mode: "approved_apps_only",
        nodeId: "mac-local",
        approvedApps: [],
        permissions: {
          accessibility: true,
          screenRecording: true,
        },
        runtime: {
          connectionState: "running",
          launchCount: 1,
          helperProcessId: 321,
        },
        timeline: [],
        stepCounter: 0,
        startedAt: 1,
        updatedAt: 1,
      },
    });

    const tool = createComputerTool({ agentSessionKey: sessionKey });
    const result = await tool.execute?.("tool-call-session", {
      action: "session",
    });

    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "computer.session.update",
      {},
      {
        sessionKey,
        nodeId: "mac-local",
        command: "start",
      },
    );
    expect(result).toMatchObject({
      details: {
        ok: true,
        computerSession: {
          sessionKey,
          runtime: {
            connectionState: "running",
          },
        },
      },
    });
  });

  it("blocks policy-denied actions before computer.act is invoked", async () => {
    const sessionKey = "computer-tool-policy-deny";
    computerSessionManager.ensureSession({
      sessionKey,
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
      policy: {
        deny: {
          apps: ["1password"],
          paths: [],
          hosts: [],
          actions: [],
          surfaces: [],
        },
      },
    });
    gatewayMocks.callGatewayTool.mockResolvedValueOnce(observePayload(10));

    const tool = createComputerTool({ agentSessionKey: sessionKey });

    await expect(
      tool.execute?.("tool-call-deny", {
        action: "open_app",
        app: "1Password",
      }),
    ).rejects.toThrow("action targets blocked app 1Password");
    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledTimes(1);
    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "node.invoke",
      {},
      expect.objectContaining({
        command: "computer.observe",
      }),
    );
    const session = computerSessionManager.getSession(sessionKey);
    expect(session?.status).toBe("paused");
    expect(session?.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "safety",
          policyDecision: "deny",
          reasonCode: "blocked_app",
        }),
      ]),
    );
  });
});
