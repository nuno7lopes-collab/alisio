import { describe, expect, it } from "vitest";
import {
  bindProfileRuntimeLastTargetId,
  createBrowserSessionSupervisor,
} from "./browser-session-supervisor.js";

describe("browser session state binding", () => {
  it("binds runtime lastTargetId to the supervisor as the single source of truth", () => {
    const supervisor = createBrowserSessionSupervisor();
    const runtimeA: { lastTargetId?: string | null } = {
      lastTargetId: " tab-a ",
    };

    bindProfileRuntimeLastTargetId({
      runtime: runtimeA,
      profileName: "alisio",
      supervisor,
    });

    expect(runtimeA.lastTargetId).toBe("tab-a");
    expect(supervisor.readProfileLastTargetId("alisio")).toBe("tab-a");
    expect(supervisor.getProfileSession("alisio")).toMatchObject({
      state: "active",
      lastTargetId: "tab-a",
    });

    const runtimeB: { lastTargetId?: string | null } = {};
    bindProfileRuntimeLastTargetId({
      runtime: runtimeB,
      profileName: "alisio",
      supervisor,
    });
    expect(runtimeB.lastTargetId).toBe("tab-a");

    runtimeB.lastTargetId = "tab-b";

    expect(runtimeA.lastTargetId).toBe("tab-b");
    expect(runtimeB.lastTargetId).toBe("tab-b");
    expect(supervisor.readProfileLastTargetId("alisio")).toBe("tab-b");
  });

  it("propagates supervisor state transitions back into bound runtime state", () => {
    const supervisor = createBrowserSessionSupervisor();
    const runtime: { lastTargetId?: string | null } = {};

    bindProfileRuntimeLastTargetId({
      runtime,
      profileName: "alisio",
      supervisor,
    });
    runtime.lastTargetId = "tab-a";

    supervisor.markProfileSessionState("alisio", "reconciling", {
      lastTargetId: null,
      reason: "profile invariants changed: cdpPort",
    });

    expect(runtime.lastTargetId).toBeNull();
    expect(supervisor.getProfileSession("alisio")).toMatchObject({
      state: "reconciling",
      lastTargetId: null,
      reason: "profile invariants changed: cdpPort",
    });
  });
});
