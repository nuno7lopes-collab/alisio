import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteSessionsAndRefresh,
  subscribeSessions,
  syncSessionMessageSubscription,
  type SessionsState,
} from "./sessions.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;
type TestSessionsState = SessionsState & {
  settings?: {
    sessionKey?: string;
    lastActiveSessionKey?: string;
  };
  applySettings?: ReturnType<typeof vi.fn>;
};

if (!("window" in globalThis)) {
  Object.assign(globalThis, {
    window: {
      confirm: () => false,
    },
  });
}

function createState(
  request: RequestFn,
  overrides: Partial<TestSessionsState> = {},
): TestSessionsState {
  return {
    client: { request } as unknown as SessionsState["client"],
    connected: true,
    sessionKey: "main",
    sessionMessageSubscribedKey: null,
    settings: {
      sessionKey: "main",
      lastActiveSessionKey: "main",
    },
    applySettings: vi.fn(),
    sessionsLoading: false,
    sessionsResult: null,
    sessionsError: null,
    sessionsFilterActive: "0",
    sessionsFilterLimit: "0",
    sessionsIncludeGlobal: true,
    sessionsIncludeUnknown: true,
    ...overrides,
  } as TestSessionsState;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("subscribeSessions", () => {
  it("registers for session change events", async () => {
    const request = vi.fn(async () => ({ subscribed: true }));
    const state = createState(request);

    await subscribeSessions(state);

    expect(request).toHaveBeenCalledWith("sessions.subscribe", {});
    expect(state.sessionsError).toBeNull();
  });
});

describe("syncSessionMessageSubscription", () => {
  it("subscribes to transcript updates for the active session", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "agent:main:main" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request, { sessionKey: "main" });

    await syncSessionMessageSubscription(state);

    expect(request).toHaveBeenCalledWith("sessions.messages.subscribe", { key: "main" });
    expect(state.sessionMessageSubscribedKey).toBe("agent:main:main");
    expect(state.sessionKey).toBe("agent:main:main");
    expect(state.applySettings).toHaveBeenCalledWith({
      sessionKey: "agent:main:main",
      lastActiveSessionKey: "agent:main:main",
    });
  });

  it("moves the subscription when the active session changes", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "sessions.messages.unsubscribe") {
        return { subscribed: false, key: (params as { key?: string }).key };
      }
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "agent:main:next" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request, {
      sessionKey: "agent:main:next",
      sessionMessageSubscribedKey: "main",
    });

    await syncSessionMessageSubscription(state);

    expect(request).toHaveBeenNthCalledWith(1, "sessions.messages.unsubscribe", { key: "main" });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.messages.subscribe", {
      key: "agent:main:next",
    });
    expect(state.sessionMessageSubscribedKey).toBe("agent:main:next");
  });

  it("clears the cached subscription when disconnected", async () => {
    const request = vi.fn(async () => {
      throw new Error("should not call request when disconnected");
    });
    const state = createState(request, {
      connected: false,
      sessionMessageSubscribedKey: "main",
    });

    await syncSessionMessageSubscription(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.sessionMessageSubscribedKey).toBeNull();
  });

  it("allows two surfaces to subscribe to the same conversation without clobbering each other", async () => {
    const requestA = vi.fn(async (method: string) => {
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "agent:main:main" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const requestB = vi.fn(async (method: string) => {
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "agent:main:main" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const stateA = createState(requestA, { sessionKey: "main" });
    const stateB = createState(requestB, { sessionKey: "main" });

    await syncSessionMessageSubscription(stateA);
    await syncSessionMessageSubscription(stateB);

    expect(requestA).toHaveBeenCalledWith("sessions.messages.subscribe", { key: "main" });
    expect(requestB).toHaveBeenCalledWith("sessions.messages.subscribe", { key: "main" });
    expect(stateA.sessionMessageSubscribedKey).toBe("agent:main:main");
    expect(stateB.sessionMessageSubscribedKey).toBe("agent:main:main");
    expect(stateA.applySettings).toHaveBeenCalledWith({
      sessionKey: "agent:main:main",
      lastActiveSessionKey: "agent:main:main",
    });
    expect(stateB.applySettings).toHaveBeenCalledWith({
      sessionKey: "agent:main:main",
      lastActiveSessionKey: "agent:main:main",
    });
  });

  it("keeps different surfaces on different conversations under the same agent", async () => {
    const requestA = vi.fn(async (method: string) => {
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "agent:main:main" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const requestB = vi.fn(async (method: string) => {
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "agent:main:dashboard:new-chat" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const stateA = createState(requestA, { sessionKey: "main" });
    const stateB = createState(requestB, { sessionKey: "agent:main:dashboard:new-chat" });

    await syncSessionMessageSubscription(stateA);
    await syncSessionMessageSubscription(stateB);

    expect(stateA.sessionMessageSubscribedKey).toBe("agent:main:main");
    expect(stateB.sessionMessageSubscribedKey).toBe("agent:main:dashboard:new-chat");
    expect(stateA.sessionKey).toBe("agent:main:main");
    expect(stateB.sessionKey).toBe("agent:main:dashboard:new-chat");
    expect(stateA.applySettings).toHaveBeenCalledWith({
      sessionKey: "agent:main:main",
      lastActiveSessionKey: "agent:main:main",
    });
    expect(stateB.applySettings).not.toHaveBeenCalled();
  });
});

describe("deleteSessionsAndRefresh", () => {
  it("deletes multiple sessions and refreshes", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        return { ok: true };
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionsAndRefresh(state, ["key-a", "key-b"]);

    expect(deleted).toEqual(["key-a", "key-b"]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(1, "sessions.delete", {
      key: "key-a",
      deleteTranscript: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.delete", {
      key: "key-b",
      deleteTranscript: true,
    });
    expect(request).toHaveBeenNthCalledWith(3, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
      includeDerivedTitles: true,
    });
    expect(state.sessionsLoading).toBe(false);
  });

  it("returns empty array when user cancels", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const deleted = await deleteSessionsAndRefresh(state, ["key-a"]);

    expect(deleted).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("returns partial results when some deletes fail", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "sessions.delete") {
        const p = params as { key: string };
        if (p.key === "key-b" || p.key === "key-c") {
          throw new Error(`delete failed: ${p.key}`);
        }
        return { ok: true };
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionsAndRefresh(state, ["key-a", "key-b", "key-c", "key-d"]);

    expect(deleted).toEqual(["key-a", "key-d"]);
    expect(state.sessionsError).toBe("Error: delete failed: key-b; Error: delete failed: key-c");
    expect(state.sessionsLoading).toBe(false);
  });

  it("returns empty array when already loading", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request, { sessionsLoading: true });

    const deleted = await deleteSessionsAndRefresh(state, ["key-a"]);

    expect(deleted).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
