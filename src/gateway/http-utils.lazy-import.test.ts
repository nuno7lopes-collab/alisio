import { beforeEach, describe, expect, it, vi } from "vitest";

const lazyImportMocks = vi.hoisted(() => ({
  messageChannelLoaded: vi.fn(),
}));

vi.mock("../utils/message-channel.js", () => {
  lazyImportMocks.messageChannelLoaded();
  return {
    normalizeMessageChannel: vi.fn(),
  };
});

describe("http-utils lazy imports", () => {
  beforeEach(() => {
    vi.resetModules();
    lazyImportMocks.messageChannelLoaded.mockReset();
  });

  it("does not import message-channel during module evaluation", async () => {
    await import("./http-utils.js");
    expect(lazyImportMocks.messageChannelLoaded).not.toHaveBeenCalled();
  });
});
