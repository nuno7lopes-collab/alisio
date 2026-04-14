/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSafeLocalStorage } from "../../local-storage.ts";
import { renderChatDesktopToolbar, renderChatSessionSelect } from "../app-render.helpers.ts";
import type { AppViewState } from "../app-view-state.ts";
import {
  createModelCatalog,
  createSessionsListResult,
  DEEPSEEK_CHAT_MODEL,
  DEFAULT_CHAT_MODEL_CATALOG,
} from "../chat-model.test-helpers.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { DEFAULT_THEME_SELECTION } from "../theme.ts";
import type { ModelCatalogEntry } from "../types.ts";
import type { SessionsListResult } from "../types.ts";
import { cleanupChatModuleState, renderChat, type ChatProps } from "./chat.ts";

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { modelProvider: null, model: null, contextTokens: null },
    sessions: [],
  };
}

function createChatHeaderState(
  overrides: {
    model?: string | null;
    modelProvider?: string | null;
    modelOverride?: string | null;
    providerOverride?: string | null;
    models?: ModelCatalogEntry[];
    omitSessionFromList?: boolean;
  } = {},
): { state: AppViewState; request: ReturnType<typeof vi.fn> } {
  let currentModel = overrides.model ?? null;
  let currentModelProvider = overrides.modelProvider ?? (currentModel ? "openai" : null);
  let currentModelOverride =
    overrides.modelOverride === undefined ? currentModel : overrides.modelOverride;
  let currentProviderOverride =
    overrides.providerOverride === undefined
      ? currentModelOverride
        ? (currentModelProvider ?? "openai")
        : null
      : overrides.providerOverride;
  const omitSessionFromList = overrides.omitSessionFromList ?? false;
  const catalog = overrides.models ?? createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG);
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "sessions.patch") {
      const nextModel = (params.model as string | null | undefined) ?? null;
      if (!nextModel) {
        currentModel = null;
        currentModelProvider = null;
        currentModelOverride = null;
        currentProviderOverride = null;
      } else {
        const normalized = nextModel.trim();
        const slashIndex = normalized.indexOf("/");
        if (slashIndex > 0) {
          currentModelProvider = normalized.slice(0, slashIndex);
          currentModel = normalized.slice(slashIndex + 1);
          currentProviderOverride = currentModelProvider;
          currentModelOverride = currentModel;
        } else {
          currentModel = normalized;
          const matchingProviders = catalog
            .filter((entry) => entry.id === normalized)
            .map((entry) => entry.provider)
            .filter(Boolean);
          currentModelProvider =
            matchingProviders.length === 1 ? matchingProviders[0] : currentModelProvider;
          currentProviderOverride = currentModelProvider;
          currentModelOverride = currentModel;
        }
      }
      return { ok: true, key: "main" };
    }
    if (method === "chat.history") {
      return { messages: [], thinkingLevel: null };
    }
    if (method === "sessions.list") {
      return createSessionsListResult({
        model: currentModel,
        modelProvider: currentModelProvider,
        modelOverride: currentModelOverride,
        providerOverride: currentProviderOverride,
        omitSessionFromList,
      });
    }
    if (method === "models.list") {
      return { models: catalog };
    }
    if (method === "tools.effective") {
      return {
        agentId: "main",
        profile: "coding",
        groups: [],
      };
    }
    throw new Error(`Unexpected request: ${method}`);
  });
  const state = {
    sessionKey: "main",
    connected: true,
    sessionsHideCron: true,
    sessionsResult: createSessionsListResult({
      model: currentModel,
      modelProvider: currentModelProvider,
      modelOverride: currentModelOverride,
      providerOverride: currentProviderOverride,
      omitSessionFromList,
    }),
    chatModelOverrides: {},
    chatModelCatalog: catalog,
    chatModelsLoading: false,
    client: { request } as unknown as GatewayBrowserClient,
    settings: {
      gatewayUrl: "",
      token: "",
      locale: "en",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: "dark",
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
      chatFocusMode: false,
      chatShowThinking: true,
    },
    chatMessage: "",
    chatStream: null,
    chatStreamStartedAt: null,
    chatRunId: null,
    chatQueue: [],
    chatMessages: [],
    chatLoading: false,
    chatThinkingLevel: null,
    lastError: null,
    chatAvatarUrl: null,
    basePath: "",
    hello: null,
    agentsList: null,
    agentsPanel: "overview",
    agentsSelectedId: null,
    toolsEffectiveLoading: false,
    toolsEffectiveLoadingKey: null,
    toolsEffectiveResultKey: null,
    toolsEffectiveError: null,
    toolsEffectiveResult: null,
    applySettings(next: AppViewState["settings"]) {
      state.settings = next;
    },
    loadAssistantIdentity: vi.fn(),
    resetToolStream: vi.fn(),
    resetChatScroll: vi.fn(),
  } as unknown as AppViewState & {
    client: GatewayBrowserClient;
    settings: AppViewState["settings"];
  };
  return { state, request };
}

function flushTasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    showThinking: true,
    showToolCalls: true,
    loading: false,
    sending: false,
    canAbort: false,
    finalizing: false,
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
    sessions: createSessions(),
    focusMode: false,
    assistantName: "Alisio",
    assistantAvatar: null,
    assistantAgentId: "main",
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onOpenRuntimeSetup: () => undefined,
    onBeginConnector: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  cleanupChatModuleState();
  document.body.innerHTML = "";
});

describe("chat view", () => {
  it("renders a compact access menu in the composer and wires its actions", () => {
    const container = document.createElement("div");
    const onApplyAccessMode = vi.fn();
    render(
      renderChat(
        createProps({
          accessMode: "custom",
          onApplyAccessMode,
        }),
      ),
      container,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".alisio-chat__access-menu-option"),
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toContain("Safe");
    expect(buttons[1]?.textContent).toContain("Full");

    buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onApplyAccessMode).toHaveBeenNthCalledWith(1, "recommended");
    expect(onApplyAccessMode).toHaveBeenNthCalledWith(2, "full-access");
  });

  it("renders the chat security console as a compact control strip with approval actions", () => {
    const container = document.createElement("div");
    const onResolveApproval = vi.fn();
    const onOpenNativeSettings = vi.fn();
    render(
      renderChat(
        createProps({
          accessMode: "custom",
          securityDiagnostics: {
            mode: "custom",
            effectivePromptAsk: "on-miss",
            configDefaults: { security: "allowlist", ask: "on-miss" },
            approvalDefaults: {
              security: "allowlist",
              ask: "on-miss",
              askFallback: "deny",
              autoAllowSkills: false,
            },
            configOverrideAgentCount: 1,
            approvalOverrideAgentCount: 2,
          },
          approvalQueue: [
            {
              id: "approval-1",
              kind: "exec",
              request: {
                command: "rm -rf /tmp/demo",
                cwd: "/tmp",
                host: "gateway",
                security: "allowlist",
                ask: "on-miss",
                agentId: "main",
                sessionKey: "agent:main:main",
              },
              createdAtMs: Date.now() - 1_000,
              expiresAtMs: Date.now() + 120_000,
            },
          ],
          approvalAuditTrail: [
            {
              id: "audit-1",
              kind: "exec",
              title: "ls",
              summary: "ls",
              decision: "allow-once",
              resolvedBy: "operator",
              ts: Date.now() - 30_000,
              request: {
                command: "ls",
                host: "gateway",
                security: "allowlist",
                ask: "on-miss",
                agentId: "main",
                sessionKey: "agent:main:main",
              },
            },
          ],
          onApplyAccessMode: () => undefined,
          onResolveApproval,
          nativeShellState: {
            platform: "macos",
            launchAtLogin: true,
            permissions: {
              notifications: true,
              appleScript: false,
              accessibility: false,
              screenRecording: true,
              microphone: true,
              speechRecognition: true,
              camera: true,
              location: true,
            },
            voiceWake: {
              supported: true,
              enabled: false,
              talkEnabled: false,
              triggers: ["alisio"],
            },
            logsPath: null,
          },
          onOpenNativeSettings,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Custom");
    expect(container.textContent).toContain("Permissions 6/8");
    expect(container.textContent).toContain("1 pending");
    expect(container.textContent).not.toContain("Security in chat");
    expect(container.textContent).not.toContain("Policy plane");
    expect(container.textContent).not.toContain("Approval center");
    expect(container.textContent).not.toContain("Recent decisions");

    expect(container.textContent).not.toContain("Details");

    const computerAccessButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".alisio-chat__access-pill--status"),
    ).find((button) => button.textContent?.includes("Permissions 6/8"));
    expect(computerAccessButton).not.toBeUndefined();
    expect(computerAccessButton?.className).toContain("alisio-chat__access-pill--interactive");
    expect(computerAccessButton?.title).toContain("6/8 system permissions ready");
    expect(computerAccessButton?.title).toContain("Needs review:");
    expect(computerAccessButton?.title).toContain("Accessibility");
    expect(computerAccessButton?.getAttribute("aria-label")).toContain("Computer access:");
    computerAccessButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenNativeSettings).toHaveBeenCalledTimes(1);

    const allowOnceButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".exec-approval-actions .btn"),
    ).find((button) => button.textContent?.includes("Allow once"));
    expect(allowOnceButton).not.toBeUndefined();
    allowOnceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onResolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({ id: "approval-1" }),
      "allow-once",
    );
  });

  it("disables the already active quick access mode in chat", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          accessMode: "recommended",
          onApplyAccessMode: () => undefined,
        }),
      ),
      container,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".alisio-chat__access-menu-option"),
    );
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(false);
  });

  it("keeps only safe and full as direct chat security toggles", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          accessMode: "custom",
          onApplyAccessMode: () => undefined,
        }),
      ),
      container,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".alisio-chat__access-menu-option"),
    );
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["Safe", "Full"]);
  });

  it("resets transient search UI when switching sessions", () => {
    const container = document.createElement("div");
    let props = createProps({
      sessionKey: "main",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Primeira sessao" }],
          timestamp: 1,
        },
      ],
    });
    const rerender = () => {
      render(
        renderChat({
          ...props,
          onRequestUpdate: rerender,
        }),
        container,
      );
    };

    rerender();

    const composer = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(composer).not.toBeNull();
    composer?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }),
    );

    expect(container.querySelector(".agent-chat__search-bar")).not.toBeNull();

    props = createProps({
      sessionKey: "agent:alpha:main",
      messages: [],
    });
    rerender();

    expect(container.querySelector(".agent-chat__search-bar")).toBeNull();
    expect(container.textContent).not.toContain("No matching messages");
  });

  it("opens the file picker for the active composer instead of the first chat on the page", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);

    render(renderChat(createProps({ sessionKey: "main" })), first);
    render(renderChat(createProps({ sessionKey: "agent:alpha:main" })), second);

    const firstInput = first.querySelector<HTMLInputElement>(".agent-chat__file-input");
    const secondInput = second.querySelector<HTMLInputElement>(".agent-chat__file-input");
    expect(firstInput).not.toBeNull();
    expect(secondInput).not.toBeNull();
    if (!firstInput || !secondInput) {
      return;
    }

    const firstClick = vi.spyOn(firstInput, "click");
    const secondClick = vi.spyOn(secondInput, "click");

    const attachButton = second.querySelector<HTMLButtonElement>(".agent-chat__input-btn");
    expect(attachButton).not.toBeNull();
    attachButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(firstClick).not.toHaveBeenCalled();
    expect(secondClick).toHaveBeenCalledTimes(1);
  });

  it("blocks composer send actions when canSend is false", () => {
    const container = document.createElement("div");
    const onSend = vi.fn();
    render(
      renderChat(
        createProps({
          draft: "Mensagem pendente",
          canSend: false,
          onSend,
        }),
      ),
      container,
    );

    const sendButton = container.querySelector<HTMLButtonElement>(".chat-send-btn");
    expect(sendButton?.disabled).toBe(true);

    const composer = container.querySelector<HTMLTextAreaElement>("textarea");
    composer?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows a runtime setup callout instead of the raw error when setup is missing", () => {
    const container = document.createElement("div");
    const onOpenRuntimeSetup = vi.fn();
    render(
      renderChat(
        createProps({
          error: "No providers configured",
          runtimeSetupHint: {
            title: "Runtime setup required",
            message:
              "Configure um provider e as credenciais do runtime antes de enviar mensagens no chat.",
            ctaLabel: "Abrir setup do runtime",
          },
          onOpenRuntimeSetup,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Runtime setup required");
    expect(container.textContent).toContain("Abrir setup do runtime");
    expect(container.textContent).not.toContain("No providers configured");

    const button = container.querySelector("button.btn");
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent("click"));
    expect(onOpenRuntimeSetup).toHaveBeenCalledTimes(1);
  });

  it("renders first-load skeletons with the same grouped structure as real chat rows", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          loading: true,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-loading-skeleton")).not.toBeNull();
    expect(container.querySelectorAll(".chat-group--skeleton")).toHaveLength(4);
    expect(container.querySelector(".chat-line")).toBeNull();
    expect(container.querySelector(".chat-msg")).toBeNull();
    expect(container.querySelector(".chat-thread")?.getAttribute("aria-busy")).toBe("true");
  });

  it("shows a minimal inline refresh indicator when reloading existing history", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          loading: true,
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "Existing transcript" }],
              timestamp: 1,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".alisio-chat__refresh-indicator")).not.toBeNull();
    expect(container.querySelector(".chat-loading-skeleton")).toBeNull();
    expect(container.textContent).toContain("Loading chat");
    expect(container.querySelector(".chat-thread")?.getAttribute("aria-busy")).toBe("true");
  });

  it("renders a connector auth CTA in chat tool cards and wires the connector flow", () => {
    const container = document.createElement("div");
    const onBeginConnector = vi.fn();
    render(
      renderChat(
        createProps({
          toolMessages: [
            {
              role: "assistant",
              toolCallId: "tool-gmail-auth",
              toolPhase: "result",
              toolResultDetails: {
                ok: false,
                status: "auth_required",
                connectorId: "gmail-send",
                message: "Gmail Send is not connected in Alisio. Connect Gmail Send in Apps first.",
                reconnectRequired: false,
              },
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
                    message:
                      "Gmail Send is not connected in Alisio. Connect Gmail Send in Apps first.",
                    reconnectRequired: false,
                  },
                },
              ],
              timestamp: Date.now(),
              __alisio: { kind: "tool-stream", phase: "result", isError: false },
            },
          ],
          onBeginConnector,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Connect Google");
    const button = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("Connect Google"),
    );
    expect(button).not.toBeUndefined();
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onBeginConnector).toHaveBeenCalledWith("gmail-send");
  });

  it("hides the context notice when only cumulative inputTokens exceed the limit", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                inputTokens: 757_300,
                totalTokens: 46_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("context used");
    expect(container.textContent).not.toContain("757.3k / 200k");
  });

  it("uses totalTokens for the context notice detail when current usage is high", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                inputTokens: 757_300,
                totalTokens: 190_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("95% context used");
    expect(container.textContent).toContain("190k / 200k");
    expect(container.textContent).not.toContain("757.3k / 200k");
  });

  it("hides the context notice when totalTokens is missing even if inputTokens is high", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                inputTokens: 500_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("context used");
  });

  it("hides the context notice when totalTokens is marked stale", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                totalTokens: 190_000,
                totalTokensFresh: false,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("context used");
    expect(container.textContent).not.toContain("190k / 200k");
  });

  it("hides the context notice while the run is still finalizing", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          finalizing: true,
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                totalTokens: 190_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("95% context used");
    expect(container.textContent).not.toContain("190k / 200k");
  });

  it("uses the assistant avatar URL for the welcome state when the identity avatar is only initials", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: "/avatar/main",
        }),
      ),
      container,
    );

    const welcomeImage = container.querySelector<HTMLImageElement>(".agent-chat__welcome > img");
    expect(welcomeImage).not.toBeNull();
    expect(welcomeImage?.getAttribute("src")).toBe("/avatar/main");
  });

  it("falls back to the bundled logo in the welcome state when the assistant avatar is not a URL", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: null,
        }),
      ),
      container,
    );

    const welcomeImage = container.querySelector<HTMLImageElement>(".agent-chat__welcome > img");
    const logoImage = container.querySelector<HTMLImageElement>(
      ".agent-chat__welcome .agent-chat__avatar--logo img",
    );
    expect(welcomeImage).toBeNull();
    expect(logoImage).not.toBeNull();
    expect(logoImage?.getAttribute("src")).toBe("favicon.svg");
  });

  it("keeps the welcome logo fallback under the mounted base path", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: null,
          basePath: "/alisio/",
        }),
      ),
      container,
    );

    const logoImage = container.querySelector<HTMLImageElement>(
      ".agent-chat__welcome .agent-chat__avatar--logo img",
    );
    expect(logoImage).not.toBeNull();
    expect(logoImage?.getAttribute("src")).toBe("/alisio/favicon.svg");
  });

  it("keeps grouped assistant avatar fallbacks under the mounted base path", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: null,
          basePath: "/alisio/",
          messages: [
            {
              role: "assistant",
              content: "hello",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    const groupedLogo = container.querySelector<HTMLImageElement>(
      ".chat-group.assistant .chat-avatar--logo",
    );
    expect(groupedLogo).not.toBeNull();
    expect(groupedLogo?.getAttribute("src")).toBe("/alisio/favicon.svg");
  });

  it("renders compacting indicator as a badge", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: true,
            startedAt: Date.now(),
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--active");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Compacting context...");
  });

  it("renders completion indicator shortly after compaction", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 900,
            completedAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--complete");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Context compacted");
    nowSpy.mockRestore();
  });

  it("hides stale compaction completion indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 0,
            completedAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator")).toBeNull();
    nowSpy.mockRestore();
  });

  it("renders fallback indicator shortly after fallback event", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            selected: "fireworks/minimax-m2p5",
            active: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: ["fireworks/minimax-m2p5: rate limit"],
            occurredAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--fallback");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Fallback active: deepinfra/moonshotai/Kimi-K2.5");
    nowSpy.mockRestore();
  });

  it("hides stale fallback indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(20_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            selected: "fireworks/minimax-m2p5",
            active: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: [],
            occurredAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator--fallback")).toBeNull();
    nowSpy.mockRestore();
  });

  it("renders fallback-cleared indicator shortly after transition", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            phase: "cleared",
            selected: "fireworks/minimax-m2p5",
            active: "fireworks/minimax-m2p5",
            previous: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: [],
            occurredAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--fallback-cleared");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Fallback cleared: fireworks/minimax-m2p5");
    nowSpy.mockRestore();
  });

  it("shows a stop button when aborting is available", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          sending: true,
          onAbort,
        }),
      ),
      container,
    );

    const stopButton = container.querySelector<HTMLButtonElement>('button[title="Stop"]');
    expect(stopButton).not.toBeUndefined();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("New session");
  });

  it("shows a visible thinking indicator before the first streamed tokens arrive", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          canAbort: true,
          sending: true,
          stream: "",
          streamStartedAt: 1000,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-run-status")).not.toBeNull();
    expect(container.textContent).toContain("Thinking");
  });

  it("keeps run activity visible after tools finish and before the final assistant message lands", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          canAbort: true,
          sending: true,
          toolMessages: [
            {
              role: "assistant",
              toolCallId: "tool-read",
              toolPhase: "result",
              content: [
                {
                  type: "toolcall",
                  name: "Read",
                  arguments: {},
                },
                {
                  type: "toolresult",
                  name: "Read",
                  text: "done",
                },
              ],
              timestamp: 1000,
              __alisio: { kind: "tool-stream", phase: "result", isError: false },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-run-status")).not.toBeNull();
    expect(container.textContent).toContain("Preparing final response");
  });

  it("keeps a finalizing indicator visible even after the live run id is gone", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          finalizing: true,
          toolMessages: [
            {
              role: "assistant",
              toolCallId: "tool-read",
              toolPhase: "result",
              content: [
                {
                  type: "toolcall",
                  name: "Read",
                  arguments: {},
                },
                {
                  type: "toolresult",
                  name: "Read",
                  text: "done",
                },
              ],
              timestamp: 1000,
              __alisio: { kind: "tool-stream", phase: "result", isError: false },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-run-status")).not.toBeNull();
    expect(container.textContent).toContain("Preparing final response");
  });

  it("labels queued work so the user can tell what depends on the current run", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          finalizing: true,
          queue: [
            {
              id: "pending",
              text: "/steer tighten the plan",
              createdAt: 1,
              pendingRunId: "run-1",
            },
            {
              id: "queued",
              text: "follow up",
              createdAt: 2,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Waiting for the current reply to finish");
    expect(container.textContent).toContain("Next in line");
  });

  it("hides assistant message actions while the streamed answer is still being written", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          canAbort: true,
          sending: true,
          stream: "Draft response in progress",
          streamStartedAt: 1000,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-bubble-actions")).toBeNull();
    expect(container.querySelector(".chat-group-footer--active")).not.toBeNull();
    expect(container.textContent).toContain("Writing response");
  });

  it("keeps secondary composer actions hidden when aborting is unavailable", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          canAbort: false,
        }),
      ),
      container,
    );

    const newSessionButton = container.querySelector<HTMLButtonElement>(
      'button[title="New session"]',
    );
    expect(newSessionButton).toBeNull();
    expect(container.textContent).not.toContain("Stop");
  });

  it("shows sender labels from sanitized gateway messages instead of generic You", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: "hello from topic",
              senderLabel: "Iris",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    const senderLabels = Array.from(container.querySelectorAll(".chat-sender-name")).map((node) =>
      node.textContent?.trim(),
    );
    expect(senderLabels).toContain("Iris");
    expect(senderLabels).not.toContain("You");
  });

  it("keeps consecutive user messages from different senders in separate groups", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: "first",
              senderLabel: "Iris",
              timestamp: 1000,
            },
            {
              role: "user",
              content: "second",
              senderLabel: "Joaquin De Rojas",
              timestamp: 1001,
            },
          ],
        }),
      ),
      container,
    );

    const groups = container.querySelectorAll(".chat-group.user");
    expect(groups).toHaveLength(2);
    const senderLabels = Array.from(container.querySelectorAll(".chat-sender-name")).map((node) =>
      node.textContent?.trim(),
    );
    expect(senderLabels).toContain("Iris");
    expect(senderLabels).toContain("Joaquin De Rojas");
  });

  it("opens delete confirm on the left for user messages", () => {
    try {
      getSafeLocalStorage()?.removeItem("alisio:skipDeleteConfirm");
    } catch {
      /* noop */
    }
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: "hello from user",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    const deleteButton = container.querySelector<HTMLButtonElement>(
      ".chat-group.user .chat-group-delete",
    );
    expect(deleteButton).not.toBeNull();
    deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const confirm = container.querySelector<HTMLElement>(".chat-group.user .chat-delete-confirm");
    expect(confirm).not.toBeNull();
    expect(confirm?.classList.contains("chat-delete-confirm--left")).toBe(true);
  });

  it("opens delete confirm on the right for assistant messages", () => {
    try {
      getSafeLocalStorage()?.removeItem("alisio:skipDeleteConfirm");
    } catch {
      /* noop */
    }
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              content: "hello from assistant",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    const deleteButton = container.querySelector<HTMLButtonElement>(
      ".chat-group.assistant .chat-group-delete",
    );
    expect(deleteButton).not.toBeNull();
    deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const confirm = container.querySelector<HTMLElement>(
      ".chat-group.assistant .chat-delete-confirm",
    );
    expect(confirm).not.toBeNull();
    expect(confirm?.classList.contains("chat-delete-confirm--right")).toBe(true);
  });

  it("patches the current session model from the chat header picker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state, request } = createChatHeaderState();
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.value).toBe("");

    modelSelect!.value = "openai/gpt-5-mini";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: "openai/gpt-5-mini",
    });
    expect(request).not.toHaveBeenCalledWith("chat.history", expect.anything());
    expect(state.sessionsResult?.sessions[0]?.model).toBe("gpt-5-mini");
    expect(state.sessionsResult?.sessions[0]?.modelProvider).toBe("openai");
    vi.unstubAllGlobals();
  });

  it("does not render the default model twice in the chat header picker", () => {
    const { state } = createChatHeaderState();
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();

    const optionValues = Array.from(modelSelect?.querySelectorAll("option") ?? []).map(
      (option) => option.value,
    );
    expect(optionValues.filter((value) => value === "")).toHaveLength(1);
    expect(optionValues).not.toContain("openai/gpt-5");
    expect(optionValues).toContain("openai/gpt-5-mini");
  });

  it("shows Default when the session is using the default runtime model without an explicit override", () => {
    const { state } = createChatHeaderState({
      model: "gpt-5",
      modelProvider: "openai",
      modelOverride: null,
      providerOverride: null,
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.value).toBe("");
  });

  it("reloads effective tools after a chat-header model switch for the active tools panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state, request } = createChatHeaderState();
    state.agentsPanel = "tools";
    state.agentsSelectedId = "main";
    state.toolsEffectiveResultKey = "main:main";
    state.toolsEffectiveResult = {
      agentId: "main",
      profile: "coding",
      groups: [],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();

    modelSelect!.value = "openai/gpt-5-mini";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).toHaveBeenCalledWith("tools.effective", {
      agentId: "main",
      sessionKey: "main",
    });
    expect(state.toolsEffectiveResultKey).toBe("main:main:model=openai/gpt-5-mini");
    vi.unstubAllGlobals();
  });

  it("clears the session model override back to the default model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state, request } = createChatHeaderState({ model: "gpt-5-mini" });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.value).toBe("openai/gpt-5-mini");

    modelSelect!.value = "";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: null,
    });
    expect(state.sessionsResult?.sessions[0]?.model).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("treats selecting the explicit default-model option as clearing the override", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state, request } = createChatHeaderState({ model: "gpt-5-mini" });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();

    modelSelect!.value = "openai/gpt-5";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: null,
    });
    expect(state.chatModelOverrides.main).toBeNull();
    vi.unstubAllGlobals();
  });

  it("disables the chat header model picker while a run is active", () => {
    const { state } = createChatHeaderState();
    state.chatRunId = "run-123";
    state.chatStream = "Working";
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.disabled).toBe(true);
  });

  it("locks the chat header model picker while a model switch is still in flight", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    let resolvePatch!: () => void;
    const { state, request } = createChatHeaderState();
    request.mockImplementation(async (method: string, _params: Record<string, unknown>) => {
      if (method === "sessions.patch") {
        await new Promise<void>((resolve) => {
          resolvePatch = resolve;
        });
        return { ok: true, key: "main" };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      if (method === "sessions.list") {
        return createSessionsListResult();
      }
      if (method === "models.list") {
        return { models: createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG) };
      }
      if (method === "tools.effective") {
        return {
          agentId: "main",
          profile: "coding",
          groups: [],
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();

    modelSelect!.value = "openai/gpt-5-mini";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();
    render(renderChatSessionSelect(state), container);

    const pendingSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(state.chatModelSwitchPendingBySession?.main).toMatch(/^chat-model-switch-/);
    expect(pendingSelect?.disabled).toBe(true);

    resolvePatch();
    await flushTasks();
    render(renderChatSessionSelect(state), container);

    const settledSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(state.chatModelSwitchPendingBySession?.main).toBeUndefined();
    expect(settledSelect?.disabled).toBe(false);
    vi.unstubAllGlobals();
  });

  it("keeps the selected model visible when the active session is absent from sessions.list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();

    modelSelect!.value = "openai/gpt-5-mini";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();
    render(renderChatSessionSelect(state), container);

    const rerendered = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(rerendered?.value).toBe("openai/gpt-5-mini");
    vi.unstubAllGlobals();
  });

  it("normalizes cached bare /model overrides to the matching catalog option", () => {
    const { state } = createChatHeaderState();
    state.chatModelOverrides = { main: { kind: "raw", value: "gpt-5-mini" } };

    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.value).toBe("openai/gpt-5-mini");

    const optionValues = Array.from(modelSelect?.querySelectorAll("option") ?? []).map(
      (option) => option.value,
    );
    expect(optionValues).toContain("openai/gpt-5-mini");
    expect(optionValues).not.toContain("gpt-5-mini");
  });

  it("prefers the catalog provider when the active session reports a stale provider", () => {
    const { state } = createChatHeaderState({
      model: "deepseek-chat",
      modelProvider: "zai",
      models: createModelCatalog(DEEPSEEK_CHAT_MODEL),
    });

    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect?.value).toBe("deepseek/deepseek-chat");
  });

  it("falls back to the server-qualified session model when catalog lookup fails", () => {
    const { state } = createChatHeaderState({
      model: "gpt-5-mini",
      models: [],
    });

    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect?.value).toBe("openai/gpt-5-mini");

    const optionValues = Array.from(modelSelect?.querySelectorAll("option") ?? []).map(
      (option) => option.value,
    );
    expect(optionValues).toContain("openai/gpt-5-mini");
    expect(optionValues).not.toContain("gpt-5-mini");
  });

  it("prefers the session label over displayName in the grouped chat session selector", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b";
    state.settings.sessionKey = state.sessionKey;
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 1,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: state.sessionKey,
          kind: "direct",
          updatedAt: null,
          label: "cron-config-check",
          displayName: "webchat:g-agent-main-subagent-4f2146de-887b-4176-9abe-91140082959b",
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain("Subagent: cron-config-check");
    expect(labels).not.toContain(state.sessionKey);
    expect(labels).not.toContain(
      "subagent:4f2146de-887b-4176-9abe-91140082959b · webchat:g-agent-main-subagent-4f2146de-887b-4176-9abe-91140082959b",
    );
  });

  it("keeps a unique scoped fallback when the current grouped session is missing from sessions.list", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b";
    state.settings.sessionKey = state.sessionKey;
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain("subagent:4f2146de-887b-4176-9abe-91140082959b");
    expect(labels).not.toContain("Subagent:");
  });

  it("keeps a unique scoped fallback when a grouped session row has no label or displayName", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b";
    state.settings.sessionKey = state.sessionKey;
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 1,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: state.sessionKey,
          kind: "direct",
          updatedAt: null,
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain("subagent:4f2146de-887b-4176-9abe-91140082959b");
    expect(labels).not.toContain("Subagent:");
  });

  it("disambiguates duplicate grouped labels with the scoped key suffix", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b";
    state.settings.sessionKey = state.sessionKey;
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 2,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b",
          kind: "direct",
          updatedAt: null,
          label: "cron-config-check",
        },
        {
          key: "agent:main:subagent:6fb8b84b-c31f-410f-b7df-1553c82e43c9",
          kind: "direct",
          updatedAt: null,
          label: "cron-config-check",
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain(
      "Subagent: cron-config-check · subagent:4f2146de-887b-4176-9abe-91140082959b",
    );
    expect(labels).toContain(
      "Subagent: cron-config-check · subagent:6fb8b84b-c31f-410f-b7df-1553c82e43c9",
    );
    expect(labels).not.toContain("Subagent: cron-config-check");
  });

  it("prefixes duplicate agent session labels with the agent name", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:alpha:main";
    state.settings.sessionKey = state.sessionKey;
    state.agentsList = {
      defaultId: "alpha",
      mainKey: "agent:alpha:main",
      scope: "all",
      agents: [
        { id: "alpha", name: "Deep Chat" },
        { id: "beta", name: "Coding" },
      ],
    };
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 2,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: "agent:alpha:main",
          kind: "direct",
          updatedAt: null,
        },
        {
          key: "agent:beta:main",
          kind: "direct",
          updatedAt: null,
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain("Deep Chat (alpha) / main");
    expect(labels).toContain("Coding (beta) / main");
    expect(labels).not.toContain("main");
  });

  it("keeps agent-prefixed labels unique when a custom label already matches the prefix", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:alpha:main";
    state.settings.sessionKey = state.sessionKey;
    state.agentsList = {
      defaultId: "alpha",
      mainKey: "agent:alpha:main",
      scope: "all",
      agents: [
        { id: "alpha", name: "Deep Chat" },
        { id: "beta", name: "Coding" },
      ],
    };
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 3,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: "agent:alpha:main",
          kind: "direct",
          updatedAt: null,
        },
        {
          key: "agent:beta:main",
          kind: "direct",
          updatedAt: null,
        },
        {
          key: "agent:alpha:named-main",
          kind: "direct",
          updatedAt: null,
          label: "Deep Chat (alpha) / main",
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels.filter((label) => label === "Deep Chat (alpha) / main")).toHaveLength(1);
    expect(labels).toContain("Deep Chat (alpha) / main · named-main");
    expect(labels).toContain("Coding (beta) / main");
  });

  it("renders the desktop chat toolbar with a session picker and compact tools menu", () => {
    const { state } = createChatHeaderState();
    const container = document.createElement("div");
    render(renderChatDesktopToolbar(state), container);

    expect(container.querySelector(".alisio-chat-toolbar")).not.toBeNull();
    expect(container.querySelector(".chat-controls__session")).not.toBeNull();
    expect(
      container.querySelector('.chat-select-chip--session select[data-chat-session-select="true"]'),
    ).not.toBeNull();
    expect(container.querySelector('select[data-chat-model-select="true"]')).toBeNull();
    expect(container.querySelector(".chat-tools-menu")).not.toBeNull();
  });

  it("renders the Alisio chat shell wrappers for the redesigned layout", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          composerModelSelect: html`
            <label
              class="field chat-controls__session chat-controls__model chat-controls__model--composer"
            >
              <select data-chat-model-select="true">
                <option value="">Default</option>
              </select>
            </label>
          `,
        }),
      ),
      container,
    );

    expect(container.querySelector(".alisio-chat")).not.toBeNull();
    expect(container.querySelector(".alisio-chat__thread")).not.toBeNull();
    expect(container.querySelector(".alisio-chat__composer")).not.toBeNull();
    expect(container.querySelector(".alisio-chat__composer-toolbar")).not.toBeNull();
    expect(container.querySelector(".alisio-chat__composer-model")).not.toBeNull();
    expect(container.querySelector(".agent-chat__input-btn--attach")).not.toBeNull();
    expect(
      container.querySelector('.alisio-chat__composer-model select[data-chat-model-select="true"]'),
    ).not.toBeNull();
  });
});
