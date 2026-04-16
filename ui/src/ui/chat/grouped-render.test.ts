/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { MessageGroup } from "../types/chat-types.ts";
import { renderMessageGroup } from "./grouped-render.ts";

function renderGroup(group: MessageGroup, onOpenSidebar?: (content: string) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  render(
    renderMessageGroup(group, {
      showReasoning: true,
      sessionKey: "main",
      onOpenSidebar,
    }),
    container,
  );
  return container;
}

function createAssistantGroup(message: unknown): MessageGroup {
  return {
    kind: "group",
    key: "group-1",
    role: "assistant",
    messages: [{ key: "message-1", message }],
    timestamp: Date.now(),
    isStreaming: false,
  };
}

function createUserGroup(message: unknown): MessageGroup {
  return {
    kind: "group",
    key: "group-user",
    role: "user",
    messages: [{ key: "message-user-1", message }],
    timestamp: Date.now(),
    isStreaming: false,
  };
}

describe("grouped chat rendering", () => {
  it("keeps long assistant replies expanded and uses icon-only actions", () => {
    const longText = Array.from({ length: 32 }, (_, index) => `Line ${index + 1}: detailed status`)
      .join("\n")
      .concat("\n\n```ts\nconsole.log('long block');\n```");

    const container = renderGroup(
      createAssistantGroup({
        role: "assistant",
        content: [{ type: "text", text: longText }],
      }),
    );

    const collapse = container.querySelector<HTMLElement>(".chat-message-collapse");
    const footer = container.querySelector<HTMLElement>(".chat-group-footer");

    expect(collapse).toBeNull();
    expect(footer?.querySelector(".chat-copy-btn--labelled")).toBeNull();
    expect(footer?.querySelector(".chat-copy-btn")).not.toBeNull();
  });

  it("keeps canvas actions out of short assistant replies", () => {
    const container = renderGroup(
      createAssistantGroup({
        role: "assistant",
        content: [{ type: "text", text: "Resposta curta." }],
      }),
      () => undefined,
    );

    expect(container.querySelector('[aria-label="Open in canvas"]')).toBeNull();
  });

  it("collapses long user prompts without hiding the whole message", () => {
    const longText = Array.from(
      { length: 24 },
      (_, index) => `Pedido ${index + 1}: confirma o texto e mantém o contexto.`,
    ).join("\n");

    const container = renderGroup(
      createUserGroup({
        role: "user",
        content: [{ type: "text", text: longText }],
      }),
    );

    const collapse = container.querySelector<HTMLElement>(".chat-message-collapse");
    expect(collapse).not.toBeNull();
    expect(collapse?.textContent).toContain("Show more");
  });

  it("shows hidden-thinking chrome without exposing raw private reasoning text", () => {
    const container = renderGroup(
      createAssistantGroup({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret internal trace" },
          { type: "text", text: "Final answer for the user." },
        ],
      }),
    );

    expect(container.textContent).toContain("Thinking");
    expect(container.textContent).toContain("Hidden");
    expect(container.textContent).not.toContain("secret internal trace");
  });
});
