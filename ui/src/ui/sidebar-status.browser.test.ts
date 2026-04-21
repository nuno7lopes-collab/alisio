import { describe, expect, it } from "vitest";
import { mountApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

describe("sidebar connection status", () => {
  it("shows the online dot in the Nero heartbeat card and removes the old footer status", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.hello = {
      ok: true,
      server: { version: "1.2.3" },
    } as never;
    app.healthResult = {
      ok: true,
      ts: Date.now(),
      durationMs: 5,
      heartbeatSeconds: 30 * 60,
      nextHeartbeatDueAtMs: Date.now() + 30 * 60_000,
      defaultAgentId: "main",
      agents: [],
      sessions: { path: "/tmp/sessions.json", count: 0, recent: [] },
    };
    app.requestUpdate();
    await app.updateComplete;

    const footer = app.querySelector<HTMLElement>(".alisio-sidebar-account__status");
    const statusDot = app.querySelector<HTMLElement>(".sidebar-brand__status-dot");
    const countdown = app.querySelector<HTMLElement>(".sidebar-brand__popover-value");
    expect(footer).toBeNull();
    expect(statusDot).not.toBeNull();
    expect(statusDot?.classList.contains("is-online")).toBe(true);
    expect(countdown?.textContent?.trim()).not.toBe("");
  });
});
