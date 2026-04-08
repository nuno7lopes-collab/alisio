import type { ChannelAccountSnapshot } from "openclaw/plugin-sdk/channel-contract";
import { describe, expect, it } from "vitest";
import { collectTelegramStatusIssues } from "./status-issues.js";

describe("collectTelegramStatusIssues", () => {
  it("redacts sensitive runtime error details", () => {
    const raw = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
    const issues = collectTelegramStatusIssues([
      {
        accountId: "default",
        enabled: true,
        configured: true,
        running: true,
        connected: false,
        lastError: raw,
      } as ChannelAccountSnapshot,
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("123456…cdef");
    expect(issues[0]?.message).not.toContain(raw);
  });
});
