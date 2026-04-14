import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import "../../styles.css";
import { renderChat, type ChatProps } from "./chat.ts";

const contextNoticeSessions: ChatProps["sessions"] = {
  ts: 0,
  path: "",
  count: 1,
  defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
  sessions: [
    {
      key: "main",
      kind: "direct",
      updatedAt: null,
      totalTokens: 3_800,
      inputTokens: 3_800,
      contextTokens: 4_000,
    },
  ],
};

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    showThinking: true,
    showToolCalls: true,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    runtimeSetupHint: null,
    sessions: {
      ts: 0,
      path: "",
      count: 1,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: "main",
          kind: "direct",
          updatedAt: null,
          inputTokens: 3_800,
          contextTokens: 4_000,
        },
      ],
    },
    focusMode: false,
    assistantName: "Alisio",
    assistantAvatar: null,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onOpenRuntimeSetup: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    ...overrides,
  };
}

async function renderContextNoticeChat() {
  const container = document.createElement("div");
  document.body.append(container);
  render(
    renderChat(
      createProps({
        sessions: contextNoticeSessions,
      }),
    ),
    container,
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return container;
}

async function renderWideChat() {
  const container = document.createElement("div");
  container.style.width = "1400px";
  container.style.minHeight = "900px";
  document.body.style.margin = "0";
  document.body.append(container);
  render(renderChat(createProps()), container);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  return container;
}

describe("chat context notice", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--warn");
    document.documentElement.style.removeProperty("--danger");
  });

  it("falls back to default notice colors when theme vars are not hex", async () => {
    document.documentElement.style.setProperty("--warn", "rgb(1, 2, 3)");
    document.documentElement.style.setProperty("--danger", "tomato");
    const container = await renderContextNoticeChat();

    const notice = container.querySelector<HTMLElement>(".context-notice");
    expect(notice).not.toBeNull();
    expect(notice?.style.getPropertyValue("--ctx-color")).toContain("rgb(");
    expect(notice?.style.getPropertyValue("--ctx-color")).not.toContain("NaN");
    expect(notice?.style.getPropertyValue("--ctx-bg")).not.toContain("NaN");
  });

  it("recomputes notice colors after theme tokens change", async () => {
    document.documentElement.style.setProperty("--warn", "#ff8800");
    document.documentElement.style.setProperty("--danger", "#cc2200");
    const first = await renderContextNoticeChat();
    const firstColor = first
      .querySelector<HTMLElement>(".context-notice")
      ?.style.getPropertyValue("--ctx-color");

    document.documentElement.style.setProperty("--warn", "#0f9d58");
    document.documentElement.style.setProperty("--danger", "#1a73e8");
    const second = await renderContextNoticeChat();
    const secondColor = second
      .querySelector<HTMLElement>(".context-notice")
      ?.style.getPropertyValue("--ctx-color");

    expect(firstColor).toContain("rgb(");
    expect(secondColor).toContain("rgb(");
    expect(secondColor).not.toBe(firstColor);
  });

  it("keeps the warning icon badge-sized", async () => {
    const container = await renderContextNoticeChat();

    const icon = container.querySelector<SVGElement>(".context-notice__icon");
    expect(icon).not.toBeNull();
    if (!icon) {
      return;
    }

    const iconStyle = getComputedStyle(icon);
    expect(iconStyle.width).toBe("16px");
    expect(iconStyle.height).toBe("16px");
    expect(icon.getBoundingClientRect().width).toBeLessThan(24);
  });

  it("allows the notice copy to wrap instead of overflowing narrow layouts", async () => {
    const container = await renderContextNoticeChat();

    const notice = container.querySelector<HTMLElement>(".context-notice");
    expect(notice).not.toBeNull();
    if (!notice) {
      return;
    }

    const noticeStyle = getComputedStyle(notice);
    expect(noticeStyle.flexWrap).toBe("wrap");
    expect(noticeStyle.whiteSpace).toBe("normal");
  });

  it("keeps the composer centered on wide chat layouts", async () => {
    const container = await renderWideChat();

    const chat = container.querySelector<HTMLElement>(".alisio-chat");
    const composer = container.querySelector<HTMLElement>(".alisio-chat__composer");
    expect(chat).not.toBeNull();
    expect(composer).not.toBeNull();
    if (!chat || !composer) {
      return;
    }

    const chatRect = chat.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const chatCenter = chatRect.left + chatRect.width / 2;
    const composerCenter = composerRect.left + composerRect.width / 2;

    expect(Math.abs(chatCenter - composerCenter)).toBeLessThan(1);
  });
});
