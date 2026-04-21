import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const requireAuthenticatedAppAccountMock = vi.hoisted(() => vi.fn());

vi.mock("./account-required.js", () => ({
  requireAuthenticatedAppAccount: requireAuthenticatedAppAccountMock,
}));

const { computerHandlers } = await import("./computer.js");

function createOptions(
  params: Record<string, unknown>,
  invoke = vi.fn(),
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method: "computer.session.get", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      nodeRegistry: {
        invoke,
      },
      logGateway: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    },
  } as unknown as GatewayRequestHandlerOptions;
}

describe("computerHandlers account required", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedAppAccountMock.mockImplementation(async (respond) => {
      respond(false, undefined, {
        code: "INVALID_REQUEST",
        message: "Alisio account sign-in required before using the app.",
      });
      return null;
    });
  });

  it("rejects computer.session.get while signed out", async () => {
    const invoke = vi.fn();
    const opts = createOptions({ sessionKey: "main" }, invoke);

    await computerHandlers["computer.session.get"](opts);

    expect(requireAuthenticatedAppAccountMock).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
      }),
    );
  });
});
