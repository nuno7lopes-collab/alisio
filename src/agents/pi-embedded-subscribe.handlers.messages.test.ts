import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitAgentEvent } from "../infra/agent-events.js";
import { createInlineCodeState } from "../markdown/code-spans.js";
import {
  buildAssistantStreamData,
  consumePendingToolMediaIntoReply,
  consumePendingToolMediaReply,
  handleMessageEnd,
  hasAssistantVisibleReply,
  resolveSilentReplyFallbackText,
} from "./pi-embedded-subscribe.handlers.messages.js";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";

vi.mock("../infra/agent-events.js", () => ({
  emitAgentEvent: vi.fn(),
}));

function createMessageContext(): EmbeddedPiSubscribeContext {
  return {
    params: {
      runId: "run-1",
      sessionKey: "agent:main:main",
      session: { id: "session-1" } as never,
      silentExpected: false,
      enforceFinalTag: false,
    },
    state: {
      deterministicApprovalPromptSent: false,
      includeReasoning: false,
      streamReasoning: false,
      emittedAssistantUpdate: false,
      messagingToolSentTexts: [],
      assistantTexts: [],
      assistantTextBaseline: 0,
      blockReplyBreak: "text_end",
      lastReasoningSent: undefined,
      reasoningStreamOpen: false,
      pendingToolMediaUrls: [],
      pendingToolAudioAsVoice: false,
      deltaBuffer: "",
      blockBuffer: "",
      blockState: {
        thinking: false,
        final: false,
        inlineCode: createInlineCodeState(),
      },
      partialBlockState: {
        thinking: false,
        final: false,
        inlineCode: createInlineCodeState(),
      },
      assistantMessageIndex: 0,
      lastAssistantTextMessageIndex: -1,
      suppressBlockChunks: false,
      toolMetas: [],
      toolMetaById: new Map(),
      toolSummaryById: new Set(),
      shouldEmitPartialReplies: false,
      reasoningMode: "off",
      compactionInFlight: false,
      pendingCompactionRetry: 0,
      compactionRetryPromise: null,
      unsubscribed: false,
      messagingToolSentTextsNormalized: [],
      messagingToolSentTargets: [],
      messagingToolSentMediaUrls: [],
      pendingMessagingTexts: new Map(),
      pendingMessagingTargets: new Map(),
      successfulCronAdds: 0,
      pendingMessagingMediaUrls: new Map(),
    },
    log: {
      debug: vi.fn(),
      warn: vi.fn(),
    },
    blockChunker: null,
    noteLastAssistant: vi.fn(),
    shouldEmitToolResult: () => false,
    shouldEmitToolOutput: () => false,
    emitToolSummary: vi.fn(),
    emitToolOutput: vi.fn(),
    stripBlockTags: (text: string) => text,
    emitBlockChunk: vi.fn(),
    flushBlockReplyBuffer: vi.fn(),
    emitReasoningStream: vi.fn(),
    consumeReplyDirectives: vi.fn(),
    consumePartialReplyDirectives: vi.fn(),
    resetAssistantMessageState: vi.fn(),
    resetForCompactionRetry: vi.fn(),
    finalizeAssistantTexts: vi.fn(),
    trimMessagingToolSent: vi.fn(),
    ensureCompactionPromise: vi.fn(),
    noteCompactionRetry: vi.fn(),
    resolveCompactionRetry: vi.fn(),
    maybeResolveCompactionWait: vi.fn(),
    recordAssistantUsage: vi.fn(),
    incrementCompactionCount: vi.fn(),
    getUsageTotals: vi.fn(),
    getCompactionCount: vi.fn(),
    emitBlockReply: vi.fn(),
  } as unknown as EmbeddedPiSubscribeContext;
}

describe("resolveSilentReplyFallbackText", () => {
  beforeEach(() => {
    vi.mocked(emitAgentEvent).mockReset();
  });

  it("replaces NO_REPLY with latest messaging tool text when available", () => {
    expect(
      resolveSilentReplyFallbackText({
        text: "NO_REPLY",
        messagingToolSentTexts: ["first", "final delivered text"],
      }),
    ).toBe("final delivered text");
  });

  it("keeps original text when response is not NO_REPLY", () => {
    expect(
      resolveSilentReplyFallbackText({
        text: "normal assistant reply",
        messagingToolSentTexts: ["final delivered text"],
      }),
    ).toBe("normal assistant reply");
  });

  it("keeps NO_REPLY when there is no messaging tool text to mirror", () => {
    expect(
      resolveSilentReplyFallbackText({
        text: "NO_REPLY",
        messagingToolSentTexts: [],
      }),
    ).toBe("NO_REPLY");
  });
});

describe("hasAssistantVisibleReply", () => {
  it("treats audio-only payloads as visible", () => {
    expect(hasAssistantVisibleReply({ audioAsVoice: true })).toBe(true);
  });

  it("detects text or media visibility", () => {
    expect(hasAssistantVisibleReply({ text: "hello" })).toBe(true);
    expect(hasAssistantVisibleReply({ mediaUrls: ["https://example.com/a.png"] })).toBe(true);
    expect(hasAssistantVisibleReply({})).toBe(false);
  });
});

describe("buildAssistantStreamData", () => {
  it("normalizes media payloads for assistant stream events", () => {
    expect(
      buildAssistantStreamData({
        text: "hello",
        delta: "he",
        mediaUrl: "https://example.com/a.png",
      }),
    ).toEqual({
      text: "hello",
      delta: "he",
      mediaUrls: ["https://example.com/a.png"],
    });
  });
});

describe("consumePendingToolMediaIntoReply", () => {
  it("attaches queued tool media to the next assistant reply", () => {
    const state = {
      pendingToolMediaUrls: ["/tmp/a.png", "/tmp/b.png"],
      pendingToolAudioAsVoice: false,
    };

    expect(
      consumePendingToolMediaIntoReply(state, {
        text: "done",
      }),
    ).toEqual({
      text: "done",
      mediaUrls: ["/tmp/a.png", "/tmp/b.png"],
      audioAsVoice: undefined,
    });
    expect(state.pendingToolMediaUrls).toEqual([]);
  });

  it("preserves reasoning replies without consuming queued media", () => {
    const state = {
      pendingToolMediaUrls: ["/tmp/a.png"],
      pendingToolAudioAsVoice: true,
    };

    expect(
      consumePendingToolMediaIntoReply(state, {
        text: "thinking",
        isReasoning: true,
      }),
    ).toEqual({
      text: "thinking",
      isReasoning: true,
    });
    expect(state.pendingToolMediaUrls).toEqual(["/tmp/a.png"]);
    expect(state.pendingToolAudioAsVoice).toBe(true);
  });
});

describe("consumePendingToolMediaReply", () => {
  it("builds a media-only reply for orphaned tool media", () => {
    const state = {
      pendingToolMediaUrls: ["/tmp/reply.opus"],
      pendingToolAudioAsVoice: true,
    };

    expect(consumePendingToolMediaReply(state)).toEqual({
      mediaUrls: ["/tmp/reply.opus"],
      audioAsVoice: true,
    });
    expect(state.pendingToolMediaUrls).toEqual([]);
    expect(state.pendingToolAudioAsVoice).toBe(false);
  });
});

describe("handleMessageEnd", () => {
  it("includes sessionKey on assistant events for non-streaming replies", () => {
    const ctx = createMessageContext();

    handleMessageEnd(ctx, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Resposta final" }],
      },
    } as never);

    expect(vi.mocked(emitAgentEvent)).toHaveBeenCalledWith({
      runId: "run-1",
      stream: "assistant",
      sessionKey: "agent:main:main",
      data: {
        text: "Resposta final",
        delta: "Resposta final",
        mediaUrls: undefined,
      },
    });
  });
});
