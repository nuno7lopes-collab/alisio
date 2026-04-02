import { describe, expect, it } from "vitest";
import { mountApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

describe("sidebar connection status", () => {
  it("shows a single online status dot in the Alisio account footer", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.hello = {
      ok: true,
      server: { version: "1.2.3" },
    } as never;
    app.requestUpdate();
    await app.updateComplete;

    const footer = app.querySelector<HTMLElement>(".alisio-sidebar-account__status");
    const statusDot = app.querySelector<HTMLElement>(".alisio-sidebar-account__dot");
    expect(footer).not.toBeNull();
    expect(statusDot).not.toBeNull();
    expect(statusDot?.getAttribute("aria-label")).toContain("Online");
  });
});
