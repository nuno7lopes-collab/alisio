import { describe, expect, it, vi } from "vitest";
import { nodeHandlers } from "./nodes.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("node.task handlers", () => {
  it("accepts exec shell tasks and emits a final response when the node finishes", async () => {
    const task = deferred<{
      ok: boolean;
      payloadJSON?: string | null;
      error?: { code?: string; message?: string } | null;
    }>();
    const respond = vi.fn();
    const broadcast = vi.fn();
    const startTask = vi.fn(() => ({
      ok: true as const,
      taskId: "task-1",
      result: task.promise,
    }));

    await nodeHandlers["node.task.start"]({
      params: {
        nodeId: "node-1",
        capabilityId: "exec.shell.v1",
        input: { command: ["pwd"] },
        idempotencyKey: "idem-task-1",
      },
      respond: respond as never,
      context: {
        nodeRegistry: {
          get: vi.fn(() => ({
            nodeId: "node-1",
            commands: ["system.run"],
            capabilities: [{ id: "exec.shell.v1", requiresCommands: ["system.run"] }],
          })),
          startTask,
        },
        execApprovalManager: undefined,
        broadcast,
        logGateway: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        },
      } as never,
      client: null,
      req: { type: "req", id: "req-task-1", method: "node.task.start" },
      isWebchatConnect: () => false,
    });

    expect(startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "node-1",
        capabilityId: "exec.shell.v1",
        input: { command: ["pwd"] },
      }),
    );
    expect(respond).toHaveBeenNthCalledWith(
      1,
      true,
      expect.objectContaining({
        status: "accepted",
        taskId: "task-1",
        nodeId: "node-1",
        capabilityId: "exec.shell.v1",
      }),
      undefined,
      expect.objectContaining({ taskId: "task-1" }),
    );

    task.resolve({
      ok: true,
      payloadJSON: JSON.stringify({ text: "done" }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(broadcast).toHaveBeenCalledWith(
      "node.task.updated",
      expect.objectContaining({
        phase: "result",
        taskId: "task-1",
        nodeId: "node-1",
        capabilityId: "exec.shell.v1",
        ok: true,
        payload: { text: "done" },
      }),
      { dropIfSlow: true },
    );
    expect(respond).toHaveBeenNthCalledWith(
      2,
      true,
      expect.objectContaining({
        status: "ok",
        taskId: "task-1",
        nodeId: "node-1",
        capabilityId: "exec.shell.v1",
        payload: { text: "done" },
      }),
      undefined,
      expect.objectContaining({ taskId: "task-1" }),
    );
  });
});
