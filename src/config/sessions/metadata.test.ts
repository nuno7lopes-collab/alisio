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
    ).toEqual({
      category: "dashboard",
      surfaceRef: {
        type: "dashboard_chat",
        id: "agent:main:main",
        parent: undefined,
        account: undefined,
        channel: undefined,
      },
      relationship: {
        kind: "root",
      },
    });
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
      category: "dashboard",
      origin: {
        provider: "webchat",
        surface: "webchat",
        chatType: "direct",
      },
      surfaceRef: {
        type: "dashboard_chat",
        id: "agent:main:main",
        parent: undefined,
        account: undefined,
        channel: undefined,
      },
      relationship: {
        kind: "root",
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
      category: "external_dm",
      origin: {
        label: "Nuno",
        provider: "telegram",
        surface: "telegram",
        chatType: "direct",
        from: "+351910000000",
        to: "123456789",
      },
      surfaceRef: {
        type: "telegram_chat",
        id: "123456789",
        parent: undefined,
        account: undefined,
        channel: "telegram",
      },
      relationship: {
        kind: "root",
      },
    });
  });

  it("derives typed topic surfaces from binding context instead of key heuristics", () => {
    const patch = deriveSessionMetaPatch({
      ctx: {
        Provider: "telegram",
        Surface: "telegram",
        ChatType: "group",
        From: "-100200300:topic:77",
        To: "-100200300:topic:77",
        MessageThreadId: 77,
      },
      sessionKey: "agent:main:telegram:group:-100200300:topic:77",
      bindingContext: {
        channel: "telegram",
        accountId: "default",
        conversationId: "-100200300:topic:77",
        parentConversationId: "-100200300",
        threadId: "77",
      },
    });

    expect(patch).toMatchObject({
      category: "topic",
      surfaceRef: {
        type: "telegram_topic",
        id: "-100200300:topic:77",
        parent: "-100200300",
        account: "default",
        channel: "telegram",
      },
      relationship: {
        kind: "root",
      },
    });
  });
});
