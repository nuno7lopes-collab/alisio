import { beforeEach, describe, expect, it, vi } from "vitest";

const getMemoryJobsController = vi.hoisted(() => vi.fn());
const resolveMemoryJobsAgentId = vi.hoisted(() => vi.fn((value) => String(value ?? "main")));

vi.mock("./runtime.js", () => ({
  getMemoryJobsController,
  resolveMemoryJobsAgentId,
}));

import {
  handleMemoryJobsCancelGatewayRequest,
  handleMemoryJobsRunOnceGatewayRequest,
  handleMemoryJobsStatusGatewayRequest,
  withMemoryJobsGatewayActivity,
} from "./gateway.js";

describe("memory jobs gateway handlers", () => {
  beforeEach(() => {
    getMemoryJobsController.mockReset();
    resolveMemoryJobsAgentId.mockClear();
  });

  it("returns status through the controller", async () => {
    const noteGatewayRequest = vi.fn(() => 11);
    const getStatus = vi.fn(() => ({ agentId: "main", runtime: { state: "idle" } }));
    getMemoryJobsController.mockReturnValue({
      noteGatewayRequest,
      getStatus,
    });
    const respond = vi.fn();

    await handleMemoryJobsStatusGatewayRequest({
      req: {} as never,
      params: { agentId: "main" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(noteGatewayRequest).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ agentId: "main" }),
      undefined,
    );
  });

  it("passes the request sequence through runOnce", async () => {
    const noteGatewayRequest = vi.fn(() => 7);
    const runOnce = vi.fn().mockResolvedValue({
      ok: true,
      run: { status: "completed" },
      status: { agentId: "main" },
    });
    getMemoryJobsController.mockReturnValue({
      noteGatewayRequest,
      runOnce,
    });
    const respond = vi.fn();

    await handleMemoryJobsRunOnceGatewayRequest({
      req: {} as never,
      params: { agentId: "main" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(runOnce).toHaveBeenCalledWith({ allowedRequestSeq: 7 });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
      }),
      undefined,
    );
  });

  it("waits for controller cancellation and returns the resulting status", async () => {
    const noteGatewayRequest = vi.fn(() => 5);
    const cancel = vi.fn().mockResolvedValue({
      ok: true,
      cancelled: true,
      status: { agentId: "main", runtime: { state: "waiting" } },
    });
    getMemoryJobsController.mockReturnValue({
      noteGatewayRequest,
      cancel,
    });
    const respond = vi.fn();

    await handleMemoryJobsCancelGatewayRequest({
      req: {} as never,
      params: { agentId: "main" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(noteGatewayRequest).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        cancelled: true,
      }),
      undefined,
    );
  });

  it("marks activity before delegating wrapped handlers", async () => {
    const noteGatewayRequest = vi.fn(() => 3);
    getMemoryJobsController.mockReturnValue({
      noteGatewayRequest,
    });
    const inner = vi.fn();
    const wrapped = withMemoryJobsGatewayActivity(inner);

    await wrapped({
      req: {} as never,
      params: { agentId: "main" },
      client: null,
      isWebchatConnect: () => false,
      respond: vi.fn() as never,
      context: {} as never,
    });

    expect(noteGatewayRequest).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
