import { describe, expect, it, vi } from "vitest";
import { ComputerSessionArbiter } from "./session-arbiter.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ComputerSessionArbiter", () => {
  it("queues two observe sessions on the same target behind a shared capture lane", async () => {
    const arbiter = new ComputerSessionArbiter();
    const firstRelease = createDeferred<void>();
    const secondStarted = createDeferred<void>();
    const order: string[] = [];
    const queued = vi.fn();

    const first = arbiter.withObserveLane({
      sessionKey: "session-a",
      targetId: "local-mac:mac-local:display:main",
      onStarted: () => {
        order.push("session-a:start");
      },
      operation: async () => {
        order.push("session-a:observe");
        await firstRelease.promise;
        return "frame-a";
      },
    });

    const second = arbiter.withObserveLane({
      sessionKey: "session-b",
      targetId: "local-mac:mac-local:display:main",
      onQueued: queued,
      onStarted: () => {
        order.push("session-b:start");
        secondStarted.resolve();
      },
      operation: async () => {
        order.push("session-b:observe");
        return "frame-b";
      },
    });

    await Promise.resolve();

    expect(order).toEqual(["session-a:start", "session-a:observe"]);
    expect(queued).toHaveBeenCalledWith(1);

    firstRelease.resolve();
    await secondStarted.promise;

    await expect(Promise.all([first, second])).resolves.toEqual(["frame-a", "frame-b"]);
    expect(order).toEqual([
      "session-a:start",
      "session-a:observe",
      "session-b:start",
      "session-b:observe",
    ]);
  });

  it("blocks a second control session while another session owns the same target", async () => {
    const arbiter = new ComputerSessionArbiter();
    const releaseControl = createDeferred<void>();

    const firstControl = arbiter.withControlLane({
      sessionKey: "session-a",
      targetId: "local-mac:mac-local:display:main",
      actionType: "click",
      foregroundRequired: true,
      operation: async () => {
        await releaseControl.promise;
        return "clicked";
      },
    });

    await Promise.resolve();

    await expect(
      arbiter.withControlLane({
        sessionKey: "session-b",
        targetId: "local-mac:mac-local:display:main",
        actionType: "click",
        foregroundRequired: true,
        operation: async () => "blocked",
      }),
    ).rejects.toMatchObject({
      details: {
        reasonCode: "focus_required",
        ownerSessionKey: "session-a",
        foregroundControlRequired: true,
        actionType: "click",
      },
    });

    releaseControl.resolve();
    await expect(firstControl).resolves.toBe("clicked");
  });

  it("denies reentrant work in the same session", async () => {
    const arbiter = new ComputerSessionArbiter();

    await arbiter.withControlLane({
      sessionKey: "session-a",
      targetId: "local-mac:mac-local:display:main",
      actionType: "click",
      foregroundRequired: true,
      operation: async () => {
        await expect(
          arbiter.withObserveLane({
            sessionKey: "session-a",
            targetId: "local-mac:mac-local:display:main",
            operation: async () => "reentrant-observe",
          }),
        ).rejects.toMatchObject({
          details: {
            reasonCode: "concurrency_denied",
          },
        });
      },
    });
  });
});
