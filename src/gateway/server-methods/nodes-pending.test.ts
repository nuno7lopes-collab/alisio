import { beforeEach, describe, expect, it, vi } from "vitest";
import { nodePendingHandlers } from "./nodes-pending.js";

const mocks = vi.hoisted(() => ({
  drainNodePendingWork: vi.fn(),
  enqueueNodePendingWork: vi.fn(),
}));

vi.mock("../node-pending-work.js", () => ({
  drainNodePendingWork: mocks.drainNodePendingWork,
  enqueueNodePendingWork: mocks.enqueueNodePendingWork,
}));

type RespondCall = [
  boolean,
  unknown?,
  {
    code?: number;
    message?: string;
    details?: unknown;
  }?,
];

function makeContext(overrides?: Partial<Record<string, unknown>>) {
  return {
    nodeRegistry: {
      get: vi.fn(() => undefined),
    },
    logGateway: {
      info: vi.fn(),
      warn: vi.fn(),
    },
    ...overrides,
  };
}

describe("node.pending handlers", () => {
  beforeEach(() => {
    mocks.drainNodePendingWork.mockReset();
    mocks.enqueueNodePendingWork.mockReset();
  });

  it("drains pending work for the connected node identity", async () => {
    mocks.drainNodePendingWork.mockReturnValue({
      revision: 2,
      items: [{ id: "baseline-status", type: "status.request", priority: "default" }],
      hasMore: false,
    });
    const respond = vi.fn();

    await nodePendingHandlers["node.pending.drain"]({
      params: { maxItems: 3 },
      respond: respond as never,
      client: { connect: { device: { id: "mac-node-1" } } } as never,
      context: makeContext() as never,
      req: { type: "req", id: "req-node-pending-drain", method: "node.pending.drain" },
      isWebchatConnect: () => false,
    });

    expect(mocks.drainNodePendingWork).toHaveBeenCalledWith("mac-node-1", {
      maxItems: 3,
      includeDefaultStatus: true,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        nodeId: "mac-node-1",
        revision: 2,
        items: [{ id: "baseline-status", type: "status.request", priority: "default" }],
        hasMore: false,
      },
      undefined,
    );
  });

  it("rejects node.pending.drain without a connected device identity", async () => {
    const respond = vi.fn();

    await nodePendingHandlers["node.pending.drain"]({
      params: {},
      respond: respond as never,
      client: null,
      context: makeContext() as never,
      req: { type: "req", id: "req-node-pending-drain-missing", method: "node.pending.drain" },
      isWebchatConnect: () => false,
    });

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.message).toContain("connected device identity");
  });

  it("enqueues pending work without trying to wake the node", async () => {
    mocks.enqueueNodePendingWork.mockReturnValue({
      revision: 4,
      deduped: false,
      item: {
        id: "pending-1",
        type: "location.request",
        priority: "high",
        createdAtMs: 100,
        expiresAtMs: null,
      },
    });
    const respond = vi.fn();

    await nodePendingHandlers["node.pending.enqueue"]({
      params: {
        nodeId: "mac-node-2",
        type: "location.request",
        priority: "high",
      },
      respond: respond as never,
      client: null,
      context: makeContext() as never,
      req: { type: "req", id: "req-node-pending-enqueue", method: "node.pending.enqueue" },
      isWebchatConnect: () => false,
    });

    expect(mocks.enqueueNodePendingWork).toHaveBeenCalledWith({
      nodeId: "mac-node-2",
      type: "location.request",
      priority: "high",
      expiresInMs: undefined,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        nodeId: "mac-node-2",
        revision: 4,
        wakeTriggered: false,
      }),
      undefined,
    );
  });
});
