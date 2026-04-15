import { describe, expect, it } from "vitest";
import { createBrowserSessionLeaseRegistry } from "./browser-session-lease.js";

describe("browser session lease registry", () => {
  it("increments fencing tokens and rejects stale releases", () => {
    let nowMs = 1_000;
    const events: string[] = [];
    const registry = createBrowserSessionLeaseRegistry({
      now: () => nowMs,
      onEvent: (event) => events.push(event.kind),
    });

    const first = registry.acquire({
      sessionKey: "Agent:Main:Main",
      owner: "Browser Writer",
    });
    expect(first).toEqual({
      sessionKey: "agent:main:main",
      owner: "browser writer",
      fencingToken: 1,
      acquiredAt: 1_000,
    });

    nowMs = 2_000;
    const second = registry.acquire({
      sessionKey: "agent:main:main",
      owner: "browser writer",
    });
    expect(second.fencingToken).toBe(2);
    expect(registry.current("AGENT:MAIN:MAIN")?.fencingToken).toBe(2);

    expect(
      registry.release({
        sessionKey: "agent:main:main",
        owner: "browser writer",
        fencingToken: 1,
      }),
    ).toBe(false);
    expect(registry.current("agent:main:main")?.fencingToken).toBe(2);

    nowMs = 3_000;
    expect(
      registry.release({
        sessionKey: "AGENT:MAIN:MAIN",
        owner: "BROWSER WRITER",
        fencingToken: 2,
      }),
    ).toBe(true);
    expect(registry.current("agent:main:main")).toBeNull();
    expect(events).toEqual([
      "session.lease.acquired",
      "session.lease.acquired",
      "session.lease.released",
    ]);
  });

  it("clears all lease state", () => {
    const registry = createBrowserSessionLeaseRegistry();
    registry.acquire({
      sessionKey: "agent:main",
      owner: "writer",
    });

    registry.clear();

    expect(registry.current("agent:main")).toBeNull();
  });
});
