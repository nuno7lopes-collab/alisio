import { describe, expect, it } from "vitest";
import {
  extractText,
  extractTextCached,
  extractThinking,
  extractThinkingCached,
  extractThinkingSummaryText,
  extractThinkingSummary,
} from "./message-extract.ts";

describe("extractTextCached", () => {
  it("matches extractText output", () => {
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "Hello there" }],
    };
    expect(extractTextCached(message)).toBe(extractText(message));
  });

  it("returns consistent output for repeated calls", () => {
    const message = {
      role: "user",
      content: "plain text",
    };
    expect(extractTextCached(message)).toBe("plain text");
    expect(extractTextCached(message)).toBe("plain text");
  });

  it("strips assistant relevant-memories scaffolding", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: [
            "<relevant-memories>",
            "Internal memory context",
            "</relevant-memories>",
            "Final user answer",
          ].join("\n"),
        },
      ],
    };
    expect(extractText(message)).toBe("Final user answer");
    expect(extractTextCached(message)).toBe("Final user answer");
  });
});

describe("extractThinkingCached", () => {
  it("matches extractThinking output", () => {
    const message = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Plan A" }],
    };
    expect(extractThinkingCached(message)).toBe(extractThinking(message));
  });

  it("returns consistent output for repeated calls", () => {
    const message = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Plan A" }],
    };
    expect(extractThinkingCached(message)).toBe("Plan A");
    expect(extractThinkingCached(message)).toBe("Plan A");
  });

  it("keeps provider reasoning summaries as visible summaries", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "Plan A\nPlan B",
          thinkingSignature: JSON.stringify({ id: "rs_789", type: "reasoning.summary" }),
        },
      ],
    };

    expect(extractThinkingSummary(message)).toEqual({
      source: "summary",
      label: "Reasoning summary",
      meta: "2 notes",
      preview: "Plan A Plan B",
      lineCount: 2,
    });
  });

  it("does not expose raw thinking as a visible reasoning summary", () => {
    const message = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Check files\nCompare answers" }],
    };

    expect(extractThinkingSummary(message)).toEqual({
      source: "raw",
      label: "Internal reasoning",
      meta: "2 blocks",
      preview: null,
      lineCount: 2,
    });
  });

  it("renders only provider reasoning summary blocks when raw thinking is also present", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "Visible summary",
          thinkingSignature: { type: "reasoning.summary", id: "rs_123" },
        },
        {
          type: "thinking",
          thinking: "Raw hidden reasoning",
          thinkingSignature: { type: "reasoning", id: "r_123" },
        },
      ],
    };

    expect(extractThinking(message)).toBe("Visible summary\nRaw hidden reasoning");
    expect(extractThinkingSummaryText(message)).toBe("Visible summary");
    expect(extractThinkingSummary(message)).toEqual({
      source: "summary",
      label: "Reasoning summary",
      meta: "1 note",
      preview: "Visible summary",
      lineCount: 1,
    });
  });
});
