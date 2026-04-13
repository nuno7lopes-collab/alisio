import { describe, expect, it } from "vitest";
import type { MsgContext } from "../../auto-reply/templating.js";
import { deriveSessionMetaPatch, deriveSessionOrigin } from "./metadata.js";
import type { SessionEntry } from "./types.js";

describe("session metadata origin handling", () => {
  it("ignores synthetic heartbeat-style runs when deriving session origin", () => {
    const ctx = {
      Provider: "heartbeat",
      Surface: "webchat",
      From: "heartbeat",
      To: "heartbeat",
      ChatType: "direct",
    } satisfies MsgContext;

    expect(deriveSessionOrigin(ctx)).toBeUndefined();
    expect(
      deriveSessionMetaPatch({
        ctx,
        sessionKey: "agent:main:main",
      }),
    ).toBeNull();
  });

  it("clears stale heartbeat placeholder identity on the next normal turn", () => {
    const existing = {
      sessionId: "sess-main",
      updatedAt: 1,
      origin: {
        label: "heartbeat",
        provider: "webchat",
        surface: "webchat",
        chatType: "direct",
        from: "heartbeat",
        to: "heartbeat",
      },
    } satisfies SessionEntry;

    const patch = deriveSessionMetaPatch({
      ctx: {
        OriginatingChannel: "webchat",
        Surface: "webchat",
        ChatType: "direct",
      },
      sessionKey: "agent:main:main",
      existing,
    });

    expect(patch).toEqual({
      origin: {
        provider: "webchat",
        surface: "webchat",
        chatType: "direct",
      },
    });
  });

  it("keeps normal user origin metadata intact", () => {
    const patch = deriveSessionMetaPatch({
      ctx: {
        Provider: "telegram",
        Surface: "telegram",
        ChatType: "direct",
        SenderName: "Nuno",
        From: "+351910000000",
        To: "123456789",
      },
      sessionKey: "agent:main:telegram:direct:+351910000000",
    });

    expect(patch).toEqual({
      origin: {
        label: "Nuno",
        provider: "telegram",
        surface: "telegram",
        chatType: "direct",
        from: "+351910000000",
        to: "123456789",
      },
    });
  });
});
