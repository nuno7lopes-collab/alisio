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
});
