import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAlisioSharingTargetAccessIndexMock, listDevicePairingMock } = vi.hoisted(() => ({
  getAlisioSharingTargetAccessIndexMock: vi.fn(),
  listDevicePairingMock: vi.fn(),
}));

vi.mock("../../infra/alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/alisio-store.js")>();
  return {
    ...actual,
    getAlisioSharingTargetAccessIndex: getAlisioSharingTargetAccessIndexMock,
  };
});

vi.mock("../../infra/device-pairing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/device-pairing.js")>();
  return {
    ...actual,
    listDevicePairing: listDevicePairingMock,
  };
});

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

function createPairedNode(nodeId: string) {
  return {
    deviceId: nodeId,
    publicKey: `pk-${nodeId}`,
    displayName: nodeId,
    platform: "macOS",
    roles: ["node"],
    createdAtMs: 1,
    approvedAtMs: 1,
  };
}

function createSharingAccess(
  targetId: string,
  overrides?: Partial<{
    deviceAccess: "owner" | "shared" | "requestable" | "blocked";
    modelAccess: "owner" | "shared" | "requestable" | "blocked";
    execAccess: "owner" | "shared" | "requestable" | "blocked";
  }>,
) {
  return {
    targetId,
    label: targetId,
    sourceKind: "node" as const,
    connected: true,
    current: false,
    ownerKey: "user:user-1",
    ownerScope: "user" as const,
    ownerLabel: "Owner",
    registeredAt: "2026-04-08T10:00:00.000Z",
    updatedAt: "2026-04-08T10:00:00.000Z",
    deviceAccess: overrides?.deviceAccess ?? "owner",
    modelAccess: overrides?.modelAccess ?? "owner",
    execAccess: overrides?.execAccess ?? "owner",
  };
}

describe("node.task handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDevicePairingMock.mockResolvedValue({
      pending: [],
      paired: [createPairedNode("node-1")],
    });
    getAlisioSharingTargetAccessIndexMock.mockImplementation(
      async (input?: { targets?: Array<{ targetId: string }> }) =>
        Object.fromEntries(
          (input?.targets ?? []).map((target) => [
            target.targetId,
            createSharingAccess(target.targetId),
          ]),
        ),
    );
  });

  it("accepts exec shell tasks and emits a final response when the node finishes", async () => {
    const task = deferred<{
      ok: boolean;
      payloadJSON?: string | null;
      error?: { code?: string; message?: string } | null;
    }>();
    const respond = vi.fn();
    const broadcast = vi.fn();
    const nodeSession = {
      nodeId: "node-1",
      commands: ["system.run"],
      capabilities: [{ id: "exec.shell.v1", requiresCommands: ["system.run"] }],
    };
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
          get: vi.fn(() => nodeSession),
          listConnected: vi.fn(() => [nodeSession]),
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

  it("blocks mutating node tasks on shared devices even when exec access exists", async () => {
    const respond = vi.fn();
    const startTask = vi.fn();
    const sharedNode = {
      nodeId: "node-1",
      commands: ["system.run"],
      capabilities: [{ id: "model.manage.llamacpp.v1" }],
    };
    getAlisioSharingTargetAccessIndexMock.mockResolvedValue({
      "node-1": createSharingAccess("node-1", {
        deviceAccess: "shared",
        modelAccess: "shared",
        execAccess: "shared",
      }),
    });

    await nodeHandlers["node.task.start"]({
      params: {
        nodeId: "node-1",
        capabilityId: "model.manage.llamacpp.v1",
        input: { action: "install", modelId: "qwen3:8b" },
        idempotencyKey: "idem-task-readonly",
      },
      respond: respond as never,
      context: {
        nodeRegistry: {
          get: vi.fn(() => sharedNode),
          listConnected: vi.fn(() => [sharedNode]),
          startTask,
        },
        execApprovalManager: undefined,
        broadcast: vi.fn(),
        logGateway: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        },
      } as never,
      client: null,
      req: { type: "req", id: "req-task-readonly", method: "node.task.start" },
      isWebchatConnect: () => false,
    });

    expect(startTask).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "shared devices are read-only",
      }),
    );
  });

  it("requires an explicit exec grant before starting tasks on linked devices", async () => {
    const respond = vi.fn();
    const startTask = vi.fn();
    const sharedNode = {
      nodeId: "node-1",
      commands: ["system.run"],
      capabilities: [{ id: "exec.shell.v1", requiresCommands: ["system.run"] }],
    };
    getAlisioSharingTargetAccessIndexMock.mockResolvedValue({
      "node-1": createSharingAccess("node-1", {
        deviceAccess: "shared",
        modelAccess: "shared",
        execAccess: "requestable",
      }),
    });

    await nodeHandlers["node.task.start"]({
      params: {
        nodeId: "node-1",
        capabilityId: "exec.shell.v1",
        input: { command: ["pwd"] },
        idempotencyKey: "idem-task-needs-grant",
      },
      respond: respond as never,
      context: {
        nodeRegistry: {
          get: vi.fn(() => sharedNode),
          listConnected: vi.fn(() => [sharedNode]),
          startTask,
        },
        execApprovalManager: undefined,
        broadcast: vi.fn(),
        logGateway: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        },
      } as never,
      client: null,
      req: { type: "req", id: "req-task-needs-grant", method: "node.task.start" },
      isWebchatConnect: () => false,
    });

    expect(startTask).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "unknown nodeId",
      }),
    );
  });
});
