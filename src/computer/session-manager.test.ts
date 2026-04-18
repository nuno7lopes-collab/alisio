import { describe, expect, it } from "vitest";
import { ComputerSessionManager } from "./session-manager.js";

function createManager() {
  const manager = new ComputerSessionManager();
  manager.ensureSession({
    sessionKey: "main",
    permissions: {
      accessibility: true,
      screenRecording: true,
    },
  });
  return manager;
}

describe("ComputerSessionManager", () => {
  it("updates permissions from explicit patches", () => {
    const manager = createManager();

    const session = manager.setPermissions("main", {
      screenRecording: false,
    });

    expect(session.permissions).toEqual({
      accessibility: true,
      screenRecording: false,
    });
  });

  it("marks permission loss when the native runtime reports it", () => {
    const manager = createManager();

    const session = manager.recordError("main", "PERMISSION_MISSING: accessibility");

    expect(session.status).toBe("error");
    expect(session.permissions.accessibility).toBe(false);
  });

  it("requires approval for unapproved apps in approved-apps mode", () => {
    const manager = createManager();

    const decision = manager.shouldRequireApproval({
      sessionKey: "main",
      action: { type: "click", x: 10, y: 12 },
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
        capturedAt: 10,
      },
    });

    expect(decision).toEqual({
      required: true,
      reason: "action targets unapproved app com.apple.finder",
      appIdentity: "com.apple.finder",
    });
  });

  it("tracks active and completed steps with timeline linkage", () => {
    const manager = createManager();

    manager.startStep({
      sessionKey: "main",
      toolCallId: "tool-1",
      kind: "action",
      phase: "observe-before-action",
      summary: "prepare click",
      actionType: "click",
    });
    manager.recordObservation(
      "main",
      {
        frame: {
          dataUrl: "data:image/jpeg;base64,abc",
          mimeType: "image/jpeg",
          width: 1440,
          height: 900,
          capturedAt: 10,
        },
        context: {
          display: {
            width: 1440,
            height: 900,
            scale: 2,
          },
          capturedAt: 10,
        },
      },
      "captured fresh frame before click",
      {
        phase: "observe-before-action",
      },
    );
    manager.recordAction("main", { type: "click", x: 10, y: 12 });
    const session = manager.completeStep("main", "click completed", "observe-after-action");

    expect(session.stepCounter).toBe(1);
    expect(session.activeStep).toBeNull();
    expect(session.lastCompletedStep).toMatchObject({
      toolCallId: "tool-1",
      sequence: 1,
      phase: "observe-after-action",
      status: "completed",
      actionType: "click",
    });
    expect(session.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "observation",
          stepSequence: 1,
          toolCallId: "tool-1",
          stepPhase: "observe-before-action",
        }),
        expect.objectContaining({
          kind: "action",
          stepSequence: 1,
          toolCallId: "tool-1",
          stepPhase: "action",
        }),
      ]),
    );
  });

  it("cancels the active step when approval is denied", async () => {
    const manager = createManager();
    manager.startStep({
      sessionKey: "main",
      toolCallId: "tool-2",
      kind: "action",
      phase: "observe-before-action",
      summary: "prepare app focus",
      actionType: "app_focus",
    });

    const decisionPromise = manager.requestApproval({
      sessionKey: "main",
      action: { type: "app_focus", app: "Finder" },
      reason: "action targets unapproved app com.apple.finder",
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
        capturedAt: 10,
      },
      appIdentity: "com.apple.finder",
    });
    const awaiting = manager.getSession("main");

    expect(awaiting?.awaitingApproval).toMatchObject({
      stepSequence: 1,
      toolCallId: "tool-2",
    });

    manager.resolveApproval({
      sessionKey: "main",
      requestId: awaiting?.awaitingApproval?.id ?? "",
      decision: "deny",
    });
    await expect(decisionPromise).resolves.toBe("deny");

    const session = manager.getSession("main");
    expect(session?.status).toBe("paused");
    expect(session?.activeStep).toBeNull();
    expect(session?.lastCompletedStep).toMatchObject({
      toolCallId: "tool-2",
      status: "cancelled",
    });
  });

  it("rejects concurrent steps for the same session", () => {
    const manager = createManager();
    manager.startStep({
      sessionKey: "main",
      toolCallId: "tool-1",
      kind: "observe",
      phase: "observe",
      summary: "capture current frame",
    });

    expect(() =>
      manager.startStep({
        sessionKey: "main",
        toolCallId: "tool-2",
        kind: "observe",
        phase: "observe",
        summary: "capture current frame",
      }),
    ).toThrow("computer session already has an active step");
  });
});
