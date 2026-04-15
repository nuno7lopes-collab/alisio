import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBrowserSessionSupervisorForPort } from "./browser-session-runtime-registry.js";
import { createBrowserSessionSupervisor } from "./browser-session-supervisor.js";
import {
  __countTrackedSessionBrowserTabsForTests,
  __resetTrackedSessionBrowserTabsForTests,
  closeTrackedBrowserTabsForSessions,
  trackSessionBrowserTab,
  untrackSessionBrowserTab,
} from "./session-tab-registry.js";

describe("session tab registry", () => {
  beforeEach(() => {
    __resetTrackedSessionBrowserTabsForTests();
  });

  afterEach(() => {
    __resetTrackedSessionBrowserTabsForTests();
  });

  it("tracks and closes tabs for normalized session keys", async () => {
    trackSessionBrowserTab({
      sessionKey: "Agent:Main:Main",
      targetId: "tab-a",
      baseUrl: "http://127.0.0.1:9222",
      profile: "Alisio",
    });
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-b",
      baseUrl: "http://127.0.0.1:9222",
      profile: "Alisio",
    });
    expect(__countTrackedSessionBrowserTabsForTests("agent:main:main")).toBe(2);

    const closeTab = vi.fn(async () => {});
    const closed = await closeTrackedBrowserTabsForSessions({
      sessionKeys: ["agent:main:main"],
      closeTab,
    });

    expect(closed).toBe(2);
    expect(closeTab).toHaveBeenCalledTimes(2);
    expect(closeTab).toHaveBeenNthCalledWith(1, {
      targetId: "tab-a",
      baseUrl: "http://127.0.0.1:9222",
      profile: "alisio",
    });
    expect(closeTab).toHaveBeenNthCalledWith(2, {
      targetId: "tab-b",
      baseUrl: "http://127.0.0.1:9222",
      profile: "alisio",
    });
    expect(__countTrackedSessionBrowserTabsForTests()).toBe(0);
  });

  it("untracks specific tabs", async () => {
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-a",
    });
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-b",
    });
    untrackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-a",
    });

    const closeTab = vi.fn(async () => {});
    const closed = await closeTrackedBrowserTabsForSessions({
      sessionKeys: ["agent:main:main"],
      closeTab,
    });

    expect(closed).toBe(1);
    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "tab-b",
      baseUrl: undefined,
      profile: undefined,
    });
  });

  it("deduplicates tabs and ignores expected close errors", async () => {
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-a",
    });
    trackSessionBrowserTab({
      sessionKey: "main",
      targetId: "tab-a",
    });
    trackSessionBrowserTab({
      sessionKey: "main",
      targetId: "tab-b",
    });
    const warnings: string[] = [];
    const closeTab = vi
      .fn()
      .mockRejectedValueOnce(new Error("target not found"))
      .mockRejectedValueOnce(new Error("network down"));

    const closed = await closeTrackedBrowserTabsForSessions({
      sessionKeys: ["agent:main:main", "main"],
      closeTab,
      onWarn: (message) => warnings.push(message),
    });

    expect(closed).toBe(0);
    expect(closeTab).toHaveBeenCalledTimes(2);
    expect(warnings).toEqual([expect.stringContaining("network down")]);
    expect(__countTrackedSessionBrowserTabsForTests()).toBe(0);
  });

  it("isolates tracked tabs by registered runtime instead of a global active supervisor", async () => {
    const controlSupervisor = createBrowserSessionSupervisor();
    const bridgeSupervisor = createBrowserSessionSupervisor();
    registerBrowserSessionSupervisorForPort({
      port: 40707,
      supervisor: controlSupervisor,
    });
    registerBrowserSessionSupervisorForPort({
      port: 40708,
      supervisor: bridgeSupervisor,
    });

    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-control",
      baseUrl: "http://127.0.0.1:40707",
    });
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-bridge",
      baseUrl: "http://127.0.0.1:40708",
    });

    expect(controlSupervisor.getTrackedSession("agent:main:main")?.trackedTabs).toHaveLength(1);
    expect(bridgeSupervisor.getTrackedSession("agent:main:main")?.trackedTabs).toHaveLength(1);

    const closeTab = vi.fn(async () => {});
    const closed = await closeTrackedBrowserTabsForSessions({
      sessionKeys: ["agent:main:main"],
      closeTab,
    });

    expect(closed).toBe(2);
    expect(closeTab).toHaveBeenCalledTimes(2);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "tab-control",
      baseUrl: "http://127.0.0.1:40707",
      profile: undefined,
    });
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "tab-bridge",
      baseUrl: "http://127.0.0.1:40708",
      profile: undefined,
    });
  });
});
