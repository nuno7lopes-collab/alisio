import { describe, expect, it, vi } from "vitest";
import { NodeRegistry } from "./node-registry.js";

function createGatewayWsClient() {
  const send = vi.fn();
  const client = {
    connId: "conn-node-1",
    socket: {
      send,
    },
    connect: {
      role: "node",
      client: {
        id: "node-1",
        mode: "node",
        version: "1.0.0",
        platform: "darwin",
      },
      caps: ["system"],
      capabilities: [
        {
          id: "exec.shell.v1",
          title: "Execucao remota",
          requiresCommands: ["system.run"],
        },
      ],
      commands: ["system.run"],
    },
  };
  return { client, send };
}

describe("NodeRegistry tasks", () => {
  it("tracks rich capabilities and resolves streamed task results", async () => {
    const { client, send } = createGatewayWsClient();
    const registry = new NodeRegistry();
    const session = registry.register(client as never, {});

    expect(session.capabilities).toEqual([
      expect.objectContaining({
        id: "exec.shell.v1",
        requiresCommands: ["system.run"],
      }),
    ]);

    const onEvent = vi.fn();
    const started = registry.startTask({
      nodeId: "node-1",
      capabilityId: "exec.shell.v1",
      input: { command: ["pwd"] },
      onEvent,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    expect(send).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(send.mock.calls[0]?.[0] ?? "{}") as {
      event?: string;
      payload?: { taskId?: string; capabilityId?: string; inputJSON?: string };
    };
    expect(frame.event).toBe("node.task.request");
    expect(frame.payload?.capabilityId).toBe("exec.shell.v1");
    expect(frame.payload?.inputJSON).toContain('"pwd"');

    const eventHandled = registry.handleTaskEvent({
      taskId: started.taskId,
      nodeId: "node-1",
      kind: "delta",
      seq: 1,
      payload: { text: "hel" },
    });
    expect(eventHandled).toBe(true);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: started.taskId,
        kind: "delta",
        seq: 1,
        payload: { text: "hel" },
      }),
    );

    const resultHandled = registry.handleTaskResult({
      taskId: started.taskId,
      nodeId: "node-1",
      ok: true,
      payloadJSON: JSON.stringify({ text: "hello" }),
    });
    expect(resultHandled).toBe(true);
    await expect(started.result).resolves.toEqual({
      ok: true,
      payload: undefined,
      payloadJSON: JSON.stringify({ text: "hello" }),
      error: null,
    });
  });
});
