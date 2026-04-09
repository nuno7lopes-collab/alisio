/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { extractToolCards, renderToolCardSidebar, renderToolCardStack } from "./tool-cards.ts";

describe("tool cards", () => {
  it("renders anthropic tool_use input details in tool cards", () => {
    const cards = extractToolCards({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_123",
          name: "Bash",
          input: { command: 'time claude -p "say ok"' },
        },
      ],
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: "call",
      name: "Bash",
      args: { command: 'time claude -p "say ok"' },
    });

    const container = document.createElement("div");
    render(renderToolCardSidebar(cards[0]), container);

    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.textContent).toContain('time claude -p "say ok"');
    expect(container.textContent).toContain("Bash");
  });

  it("renders merged tool rows with done state and input/output sections", () => {
    const message = {
      role: "assistant",
      toolCallId: "call_123",
      toolPhase: "result",
      toolError: false,
      content: [
        {
          type: "toolcall",
          name: "read",
          arguments: { path: "/tmp/demo.txt" },
        },
        {
          type: "toolresult",
          name: "read",
          text: "hello world",
        },
      ],
      timestamp: Date.now(),
      __alisio: { kind: "tool-stream", phase: "result", isError: false },
    };

    const cards = extractToolCards(message);
    const container = document.createElement("div");
    render(
      renderToolCardStack(cards, () => undefined),
      container,
    );

    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.textContent).toContain("Done");
    expect(container.textContent).toContain("Input");
    expect(container.textContent).toContain("Output");
    expect(container.textContent).toContain("/tmp/demo.txt");
    expect(container.textContent).toContain("hello world");
  });

  it("renders error state when tool execution fails", () => {
    const message = {
      role: "assistant",
      toolCallId: "call_456",
      toolPhase: "result",
      toolError: true,
      content: [
        {
          type: "toolcall",
          name: "gmail_send",
          arguments: { to: "test@example.com" },
        },
        {
          type: "toolresult",
          name: "gmail_send",
          text: '{"status":"rejected","error":"auth missing"}',
        },
      ],
      timestamp: Date.now(),
      __alisio: { kind: "tool-stream", phase: "result", isError: true },
    };

    const cards = extractToolCards(message);
    const container = document.createElement("div");
    render(
      renderToolCardStack(cards, () => undefined),
      container,
    );

    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.textContent).toContain("Rejected");
    expect(container.textContent).toContain("Error");
  });

  it("matches repeated tool names by block-level ids instead of FIFO name order", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "read",
          input: { path: "/tmp/one.txt" },
        },
        {
          type: "tool_use",
          id: "toolu_2",
          name: "read",
          input: { path: "/tmp/two.txt" },
        },
        {
          type: "tool_result",
          name: "read",
          tool_use_id: "toolu_2",
          content: "second result",
        },
        {
          type: "tool_result",
          name: "read",
          tool_use_id: "toolu_1",
          content: "first result",
        },
      ],
    };

    const cards = extractToolCards(message);
    const container = document.createElement("div");
    render(
      renderToolCardStack(cards, () => undefined),
      container,
    );

    const renderedCards = Array.from(container.querySelectorAll(".chat-tool-card"));
    expect(renderedCards).toHaveLength(2);
    expect(renderedCards[0]?.textContent).toContain("/tmp/one.txt");
    expect(renderedCards[0]?.textContent).toContain("first result");
    expect(renderedCards[1]?.textContent).toContain("/tmp/two.txt");
    expect(renderedCards[1]?.textContent).toContain("second result");
  });

  it("renders structured tool result payloads and truncates oversized previews", () => {
    const longOutput = `head-${"x".repeat(5_800)}-tail-marker`;
    const message = {
      role: "assistant",
      content: [
        {
          type: "toolcall",
          name: "exec",
          arguments: { command: "echo ok" },
        },
        {
          type: "toolresult",
          name: "exec",
          content: [{ type: "text", text: longOutput }],
        },
      ],
    };

    const cards = extractToolCards(message);
    const container = document.createElement("div");
    render(
      renderToolCardStack(cards, () => undefined),
      container,
    );

    expect(container.textContent).toContain("Open full output");
    expect(container.textContent).toContain("… truncated");
    expect(container.textContent).not.toContain("-tail-marker");
  });

  it("renders a connector auth CTA when a tool result needs Gmail auth", () => {
    const onBeginConnector = vi.fn();
    const message = {
      role: "assistant",
      toolCallId: "call_gmail_auth",
      toolPhase: "result",
      content: [
        {
          type: "toolcall",
          name: "gmail_send",
          arguments: { to: "nuno@example.com", subject: "Hello" },
        },
        {
          type: "toolresult",
          name: "gmail_send",
          text: "Gmail Send is not connected in Alisio. Connect Gmail Send in Apps first.",
          details: {
            ok: false,
            status: "auth_required",
            connectorId: "gmail-send",
            message: "Gmail Send is not connected in Alisio. Connect Gmail Send in Apps first.",
            reconnectRequired: false,
          },
        },
      ],
      timestamp: Date.now(),
      __alisio: { kind: "tool-stream", phase: "result", isError: false },
    };

    const cards = extractToolCards(message);
    const container = document.createElement("div");
    render(
      renderToolCardStack(cards, () => undefined, onBeginConnector),
      container,
    );

    expect(container.textContent).toContain("Needs auth");
    expect(container.textContent).toContain("Connect Google");
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onBeginConnector).toHaveBeenCalledWith("gmail-send");
  });
});
