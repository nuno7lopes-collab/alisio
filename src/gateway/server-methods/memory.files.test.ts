import { describe, expect, it, vi } from "vitest";
import {
  validateMemoryFilesGetRequest,
  validateMemoryFilesListRequest,
} from "./memory.files.js";

describe("memory files server-method validators", () => {
  it("accepts a list request with canonical query filters", () => {
    const respond = vi.fn();
    const params: Record<string, unknown> = {
      agentId: "main",
      query: "atlas",
    };

    expect(validateMemoryFilesListRequest(params, respond)).toBe(true);
    expect(respond).not.toHaveBeenCalled();
  });

  it("rejects a list request without an agent id", () => {
    const respond = vi.fn();

    expect(validateMemoryFilesListRequest({}, respond)).toBe(false);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "invalid memory.files.list params: agentId",
      }),
    );
  });

  it("accepts a file detail request with canonical ids", () => {
    const respond = vi.fn();
    const params: Record<string, unknown> = {
      agentId: "main",
      fileId: "brief",
      query: "atlas",
    };

    expect(validateMemoryFilesGetRequest(params, respond)).toBe(true);
    expect(respond).not.toHaveBeenCalled();
  });

  it("rejects a file detail request without fileId", () => {
    const respond = vi.fn();
    const params: Record<string, unknown> = {
      agentId: "main",
    };

    expect(validateMemoryFilesGetRequest(params, respond)).toBe(false);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "invalid memory.files.get params: fileId",
      }),
    );
  });
});
