import { describe, expect, it } from "vitest";
import { createBrowserSessionSupervisor } from "./browser-session-supervisor.js";

describe("browser session supervisor", () => {
  it("tracks tabs, leases sessions, and keeps a minimal timeline", () => {
    let nowMs = 1_000;
    const supervisor = createBrowserSessionSupervisor({
      now: () => ++nowMs,
    });

    supervisor.trackSessionTab({
      sessionKey: "Agent:Main:Main",
      targetId: "tab-a",
      baseUrl: "http://127.0.0.1:9222",
      profile: "Alisio",
    });
    supervisor.trackSessionTab({
      sessionKey: "agent:main:main",
      targetId: "tab-b",
      baseUrl: "http://127.0.0.1:9222",
      profile: "Alisio",
    });

    expect(supervisor.getTrackedSession("AGENT:MAIN:MAIN")).toMatchObject({
      sessionKey: "agent:main:main",
      state: "active",
      lastTargetId: "tab-b",
    });
    expect(supervisor.getTrackedSession("agent:main:main")?.trackedTabs).toEqual([
      expect.objectContaining({
        sessionKey: "agent:main:main",
        targetId: "tab-a",
        baseUrl: "http://127.0.0.1:9222",
        profile: "alisio",
      }),
      expect.objectContaining({
        sessionKey: "agent:main:main",
        targetId: "tab-b",
        baseUrl: "http://127.0.0.1:9222",
        profile: "alisio",
      }),
    ]);

    const lease = supervisor.acquireSessionLease({
      sessionKey: "agent:main:main",
      owner: "writer",
    });
    expect(lease.fencingToken).toBe(1);
    expect(supervisor.getTrackedSession("agent:main:main")?.state).toBe("leased");

    supervisor.untrackSessionTab({
      sessionKey: "agent:main:main",
      targetId: "tab-b",
      baseUrl: "http://127.0.0.1:9222",
      profile: "ALISIO",
    });
    expect(supervisor.getTrackedSession("agent:main:main")).toMatchObject({
      state: "leased",
      lastTargetId: "tab-a",
    });

    const taken = supervisor.takeTrackedTabsForSessions(["agent:main:main", "main"]);
    expect(taken).toEqual([
      expect.objectContaining({
        sessionKey: "agent:main:main",
        targetId: "tab-a",
        baseUrl: "http://127.0.0.1:9222",
        profile: "alisio",
      }),
    ]);
    expect(supervisor.getTrackedSession("agent:main:main")).toMatchObject({
      state: "leased",
      lastTargetId: null,
    });

    expect(
      supervisor.releaseSessionLease({
        sessionKey: "agent:main:main",
        owner: "writer",
        fencingToken: lease.fencingToken,
      }),
    ).toBe(true);
    expect(supervisor.getTrackedSession("agent:main:main")).toMatchObject({
      state: "idle",
      lastTargetId: null,
    });
    expect(supervisor.listTimeline().map((event) => event.kind)).toEqual([
      "session.tab.tracked",
      "session.tab.tracked",
      "session.lease.acquired",
      "session.tab.untracked",
      "session.tab.taken",
      "session.lease.released",
    ]);
  });

  it("records action, recovery, and auth state on tracked sessions", () => {
    const supervisor = createBrowserSessionSupervisor({
      now: () => 2_000,
    });

    supervisor.trackSessionTab({
      sessionKey: "agent:main:main",
      targetId: "tab-a",
    });
    supervisor.ensureSessionLease({
      sessionKey: "agent:main:main",
      owner: "agent:main:main",
    });
    supervisor.recordSessionRecovery({
      sessionKey: "agent:main:main",
      code: "stale-dom",
      targetId: "tab-a",
      recovered: true,
    });
    supervisor.recordSessionAction({
      sessionKey: "agent:main:main",
      kind: "click",
      layer: "geometric",
      targetId: "tab-a",
      recovered: true,
      recoveryCode: "stale-dom",
    });
    supervisor.recordSessionAuth({
      sessionKey: "agent:main:main",
      origin: "https://example.com",
      status: "primed",
      method: "blind-fill",
      targetId: "tab-a",
      fields: 2,
    });

    expect(supervisor.getTrackedSession("agent:main:main")).toMatchObject({
      state: "leased",
      lastAction: {
        kind: "click",
        layer: "geometric",
        recovered: true,
        recoveryCode: "stale-dom",
      },
      lastRecovery: {
        code: "stale-dom",
        recovered: true,
      },
      auth: {
        origin: "https://example.com",
        status: "primed",
        method: "blind-fill",
        fields: 2,
      },
    });
    expect(supervisor.listTimeline().map((event) => event.kind)).toEqual([
      "session.tab.tracked",
      "session.lease.acquired",
      "session.recovery",
      "session.action",
      "session.auth",
    ]);
  });

  it("deduplicates tracked tabs when taking multiple sessions", () => {
    const supervisor = createBrowserSessionSupervisor();
    supervisor.trackSessionTab({
      sessionKey: "agent:main",
      targetId: "tab-a",
    });
    supervisor.trackSessionTab({
      sessionKey: "main",
      targetId: "tab-a",
    });
    supervisor.trackSessionTab({
      sessionKey: "main",
      targetId: "tab-b",
    });

    const taken = supervisor.takeTrackedTabsForSessions(["agent:main", "main"]);

    expect(taken.map((tab) => tab.targetId)).toEqual(["tab-a", "tab-b"]);
    expect(supervisor.getTrackedSession("agent:main")?.trackedTabs).toEqual([]);
    expect(supervisor.getTrackedSession("main")?.trackedTabs).toEqual([]);
  });
});
