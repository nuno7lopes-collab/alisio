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
        dataUrl: "data:image/jpeg;base64,abc",
        mimeType: "image/jpeg",
        width: 1440,
        height: 900,
        capturedAt,
      },
      context: {
        display: {
          width: 1440,
          height: 900,
          scale: 2,
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
  it("captures a fresh frame before control actions even when the session already has a frame", async () => {
    const sessionKey = "computer-tool-fresh-preobserve";
    computerSessionManager.ensureSession({
      sessionKey,
      mode: "elevated-watch",
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
    });
    computerSessionManager.recordObservation(
      sessionKey,
      {
        frame: {
          dataUrl: "data:image/jpeg;base64,stale",
          mimeType: "image/jpeg",
          width: 1280,
          height: 720,
          capturedAt: 5,
        },
        context: {
          display: {
            width: 1280,
            height: 720,
            scale: 2,
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
      }),
    );
    expect(gatewayMocks.callGatewayTool).toHaveBeenNthCalledWith(
      2,
      "node.invoke",
      {},
      expect.objectContaining({
        nodeId: "mac-local",
        command: "computer.act",
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
    });
    expect(state?.timeline).toEqual(
      expect.arrayContaining([
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
});
