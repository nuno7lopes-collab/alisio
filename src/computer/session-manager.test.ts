import { describe, expect, it } from "vitest";
import { ComputerSessionManager } from "./session-manager.js";
import type { ComputerObservation, ComputerStructuredAction } from "./types.js";

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

function createObservation(params?: {
  frameId?: string;
  capturedAt?: number;
  appName?: string;
  bundleId?: string;
  windowTitle?: string;
}): ComputerObservation {
  const capturedAt = params?.capturedAt ?? 10;
  return {
    frame: {
      id: params?.frameId ?? `frame-${capturedAt}`,
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
      ...(params?.appName || params?.bundleId
        ? {
            activeApp: {
              ...(params?.appName ? { name: params.appName } : {}),
              ...(params?.bundleId ? { bundleId: params.bundleId } : {}),
            },
          }
        : {}),
      ...(params?.windowTitle ? { activeWindow: { title: params.windowTitle } } : {}),
      capturedAt,
    },
  };
}

function createFrameBoundClickAction(frameId = "frame-10"): ComputerStructuredAction {
  return {
    id: "action-1",
    type: "click",
    x: 10,
    y: 12,
    coordinateSpace: "display-pixel",
    frame: {
      frameId,
      displayId: "display-1",
      capturedAt: 10,
      maxAgeMs: 5000,
      sourceSpace: "display-pixel",
      pixelWidth: 1440,
      pixelHeight: 900,
      logicalWidth: 720,
      logicalHeight: 450,
      scaleFactor: 2,
      orientation: "landscape",
    },
    transform: {
      sourceSpace: "display-pixel",
      sourceWidth: 1440,
      sourceHeight: 900,
    },
  };
}

describe("ComputerSessionManager", () => {
  it("seeds an honest local-mac capability matrix and target descriptor", () => {
    const manager = createManager();

    const session = manager.getSession("main");

    expect(session?.target).toMatchObject({
      id: "local-mac:local:host",
      label: "Local Mac",
      kind: "local-mac-host",
      nodeId: "local",
      globalInput: true,
      allowsConcurrentObserve: true,
    });
    expect(session?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "observe_only",
          available: true,
          exposure: "exposed",
        }),
        expect.objectContaining({
          kind: "foreground_control",
          available: true,
          exposure: "exposed",
        }),
      ]),
    );
    expect(session?.capabilities).toHaveLength(2);
  });

  it("updates permissions from explicit patches", () => {
    const manager = createManager();

    const session = manager.setPermissions("main", {
      screenRecording: false,
    });

    expect(session.permissions).toEqual({
      accessibility: true,
      screenRecording: false,
      observation: "missing",
      control: "granted",
    });
  });

  it("marks permission loss when the native runtime reports it", () => {
    const manager = createManager();

    const session = manager.recordError("main", "PERMISSION_MISSING: accessibility");

    expect(session.status).toBe("blocked_on_restart_required");
    expect(session.blocking).toMatchObject({
      kind: "blocked_on_restart_required",
      reasonCode: "control_restart_required",
    });
    expect(session.permissions).toMatchObject({
      accessibility: true,
      control: "restart_required",
    });
  });

  it("hides local computer control on web and windows-local backends", () => {
    const manager = new ComputerSessionManager();

    const webSession = manager.ensureSession({
      sessionKey: "web",
      backend: "web",
    });
    const windowsSession = manager.ensureSession({
      sessionKey: "windows",
      backend: "windows-local",
    });

    expect(webSession.status).toBe("blocked_on_runtime");
    expect(
      webSession.capabilities.every((entry) => !entry.available && entry.exposure === "hidden"),
    ).toBe(true);
    expect(webSession.permissions).toMatchObject({
      observation: "not_supported",
      control: "not_supported",
    });

    expect(windowsSession.status).toBe("blocked_on_runtime");
    expect(
      windowsSession.capabilities.every((entry) => !entry.available && entry.exposure === "hidden"),
    ).toBe(true);
    expect(windowsSession.permissions).toMatchObject({
      observation: "not_supported",
      control: "not_supported",
    });
  });

  it("reports helper cold start as blocked_on_runtime instead of a generic error", () => {
    const manager = createManager();

    const session = manager.setRuntime("main", {
      connectionState: "starting",
      launchCount: 0,
    });

    expect(session.status).toBe("blocked_on_runtime");
    expect(session.blocking).toMatchObject({
      kind: "blocked_on_runtime",
      reasonCode: "runtime_busy",
      summary: "computer helper cold start in progress",
    });
  });

  it("requires approval for unapproved apps in approved-apps mode", () => {
    const manager = createManager();

    const decision = manager.shouldRequireApproval({
      sessionKey: "main",
      action: { type: "click", x: 10, y: 12 },
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
          id: "frame-10",
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
          capturedAt: 10,
          maxAgeMs: 5000,
          staleAt: 5010,
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
          capturedAt: 10,
        },
      },
      "captured fresh frame before click",
      {
        phase: "observe-before-action",
      },
    );
    manager.recordAction(
      "main",
      {
        id: "action-1",
        type: "click",
        x: 10,
        y: 12,
        coordinateSpace: "display-pixel",
        frame: {
          frameId: "frame-10",
          displayId: "display-1",
          capturedAt: 10,
          maxAgeMs: 5000,
          sourceSpace: "display-pixel",
          pixelWidth: 1440,
          pixelHeight: 900,
          logicalWidth: 720,
          logicalHeight: 450,
          scaleFactor: 2,
          orientation: "landscape",
        },
        transform: {
          sourceSpace: "display-pixel",
          sourceWidth: 1440,
          sourceHeight: 900,
        },
      },
      undefined,
      {
        actionId: "action-1",
        sourceFrameId: "frame-10",
      },
    );
    manager.recordActionResult("main", {
      id: "result-1",
      actionId: "action-1",
      type: "click",
      success: true,
      elapsedMs: 18,
      retryCount: 0,
      summary: "clicked",
      sourceFrameId: "frame-10",
      resultFrameId: "frame-11",
    });
    const session = manager.completeStep("main", "click completed", "observe-after-action");

    expect(session.stepCounter).toBe(1);
    expect(session.activeStep).toBeNull();
    expect(session.lastCompletedStep).toMatchObject({
      toolCallId: "tool-1",
      sequence: 1,
      phase: "observe-after-action",
      status: "completed",
      actionType: "click",
      sourceFrameId: "frame-10",
      resultFrameId: "frame-11",
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
          actionId: "action-1",
          sourceFrameId: "frame-10",
        }),
        expect.objectContaining({
          kind: "action",
          stepSequence: 1,
          toolCallId: "tool-1",
          actionResultId: "result-1",
          sourceFrameId: "frame-10",
          resultFrameId: "frame-11",
          elapsedMs: 18,
        }),
      ]),
    );
    expect(session.replay.actionCount).toBe(1);
    expect(session.replay.frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          frameId: "frame-10",
          stepSequence: 1,
          stepPhase: "observe-before-action",
        }),
      ]),
    );
    expect(session.replay.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sequence: 1,
          actionCount: 1,
          sourceFrameId: "frame-10",
          resultFrameId: "frame-11",
          action: expect.objectContaining({
            actionId: "action-1",
            type: "click",
          }),
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
      summary: "prepare focus app",
      actionType: "focus_app",
    });

    const decisionPromise = manager.requestApproval({
      sessionKey: "main",
      action: { type: "focus_app", app: "Finder" },
      reason: "action targets unapproved app com.apple.finder",
      reasonCode: "unapproved_app",
      policyDecision: "require_session",
      safetyEvents: [],
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
    expect(session?.replay.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "tool-2",
          approvalCount: 1,
          status: "cancelled",
        }),
      ]),
    );
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

  it("records arbitration and blocking events with reason codes", () => {
    const manager = createManager();
    manager.startStep({
      sessionKey: "main",
      toolCallId: "tool-3",
      kind: "action",
      phase: "observe-before-action",
      summary: "prepare click",
      actionType: "click",
    });

    const arbitrated = manager.markSessionArbitrated({
      sessionKey: "main",
      summary: "foreground control required on local macOS",
      eventCode: "focus_required",
    });

    expect(arbitrated.timeline.at(-1)).toMatchObject({
      kind: "status",
      eventCode: "focus_required",
      stepSequence: 1,
    });

    const blocked = manager.setBlocking("main", {
      kind: "blocked_on_focus",
      reasonCode: "focus_required",
      summary: "foreground control required; session other already owns local-mac:local:host",
      at: 20,
      targetId: "local-mac:local:host",
      ownerSessionKey: "other",
      foregroundControlRequired: true,
      actionType: "click",
    });

    expect(blocked.blocking).toMatchObject({
      kind: "blocked_on_focus",
      reasonCode: "focus_required",
      ownerSessionKey: "other",
      actionType: "click",
    });
    expect(blocked.status).toBe("blocked_on_focus");
    expect(blocked.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "status",
          eventCode: "focus_required",
          stepSequence: 1,
          actionType: "click",
        }),
        expect.objectContaining({
          kind: "status",
          eventCode: "lazy_open_requested",
          stepSequence: 1,
          actionType: "click",
          openTrigger: "open_computer",
        }),
      ]),
    );
  });

  it("keeps structured event ordering stable across observe, validate, execute and export", () => {
    const manager = createManager();
    manager.setMode("main", "foreground_supervised");
    manager.startStep({
      sessionKey: "main",
      toolCallId: "tool-ordered",
      kind: "action",
      phase: "observe-before-action",
      summary: "prepare click",
      actionType: "click",
    });
    const before = createObservation({
      frameId: "frame-10",
      appName: "Finder",
      bundleId: "com.apple.finder",
      windowTitle: "Downloads",
    });
    manager.recordObservation("main", before, "captured fresh frame before click", {
      phase: "observe-before-action",
      stepSummary: "captured fresh frame before click",
    });
    const action = createFrameBoundClickAction("frame-10");
    manager.recordActionRequested("main", action);
    manager.evaluateActionPolicy({
      sessionKey: "main",
      action,
      context: before.context,
    });
    manager.recordAction("main", action, undefined, {
      actionId: "action-1",
      sourceFrameId: "frame-10",
    });
    manager.recordActionResult("main", {
      id: "native-1",
      actionId: "action-1",
      type: "click",
      success: true,
      elapsedMs: 22,
      retryCount: 0,
      summary: "clicked",
      sourceFrameId: "frame-10",
      resultFrameId: "frame-11",
    });
    manager.recordObservation(
      "main",
      createObservation({
        frameId: "frame-11",
        capturedAt: 20,
        appName: "Finder",
        bundleId: "com.apple.finder",
        windowTitle: "Downloads",
      }),
      "captured frame after click",
      {
        phase: "observe-after-action",
        stepSummary: "captured frame after click",
      },
    );
    manager.completeStep("main", "click completed", "observe-after-action");

    const exported = manager.exportSession("main");
    expect(exported.eventLog.map((entry) => entry.code)).toEqual([
      "capability_exposed",
      "capability_exposed",
      "state_transition",
      "frame_captured",
      "action_requested",
      "action_validated",
      "action_executed",
      "frame_captured",
    ]);
    expect(exported.eventLog.map((entry) => entry.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(exported.replay.frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          frameId: "frame-10",
          redacted: true,
          frameHash: expect.any(String),
          captureLatencyMs: expect.any(Number),
        }),
      ]),
    );
    expect(exported.summary.correlationCoverage).toMatchObject({
      hasToolCallId: true,
      hasStepId: true,
      hasActionId: true,
      hasNativeActionId: true,
      hasRunId: false,
      hasResponseId: false,
    });
    expect(exported.summary).toMatchObject({
      blocking: null,
      runtime: null,
    });
  });

  it("includes approval and safety history in the exported session summary", async () => {
    const manager = createManager();
    manager.setMode("main", "foreground_supervised");
    manager.startStep({
      sessionKey: "main",
      toolCallId: "tool-approval",
      kind: "action",
      phase: "observe-before-action",
      summary: "prepare click",
      actionType: "click",
    });
    const observation = createObservation({
      frameId: "frame-20",
      appName: "Safari",
      bundleId: "com.apple.Safari",
      windowTitle: "Example Domain",
    });
    manager.recordObservation("main", observation, "captured fresh frame before click", {
      phase: "observe-before-action",
    });
    const action = createFrameBoundClickAction("frame-20");
    manager.recordActionRequested("main", action);
    const { evaluation } = manager.evaluateActionPolicy({
      sessionKey: "main",
      action,
      context: observation.context,
    });
    expect(evaluation.decision).toBe("require_once");
    const pendingDecision = manager.requestApproval({
      sessionKey: "main",
      action,
      reason: evaluation.reason,
      reasonCode: evaluation.reasonCode,
      policyDecision: "require_once",
      safetyEvents: evaluation.safetyEvents,
      context: observation.context,
      appIdentity: evaluation.appIdentity,
    });
    const awaiting = manager.getSession("main");
    manager.resolveApproval({
      sessionKey: "main",
      requestId: awaiting?.awaitingApproval?.id ?? "",
      decision: "allow-once",
    });
    await expect(pendingDecision).resolves.toBe("allow-once");

    const exported = manager.exportSession("main");
    expect(exported.approvalHistory.map((entry) => entry.code)).toEqual([
      "approval_requested",
      "approval_decided",
    ]);
    expect(exported.safetyHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "untrusted_external_content",
          reasonCode: "untrusted_external_content",
        }),
      ]),
    );
    expect(exported.eventLog.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["safety_raised", "approval_requested", "approval_decided"]),
    );
  });
});
