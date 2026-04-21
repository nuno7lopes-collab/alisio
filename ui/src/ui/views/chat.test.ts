/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSafeLocalStorage } from "../../local-storage.ts";
import {
  renderChatComposerModelSelect,
  renderChatDesktopToolbar,
  renderChatSessionSelect,
  switchChatSession,
} from "../app-render.helpers.ts";
import type { AppViewState } from "../app-view-state.ts";
import "../app.ts";
import type { AlisioApp } from "../app.ts";
import {
  createModelCatalog,
  createSessionsListResult,
  DEEPSEEK_CHAT_MODEL,
  DEFAULT_CHAT_MODEL_CATALOG,
  OPENAI_GPT5_MINI_MODEL,
  OPENAI_GPT5_MODEL,
} from "../chat-model.test-helpers.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { DEFAULT_THEME_SELECTION } from "../theme.ts";
import type { ComputerSessionState, ModelCatalogEntry } from "../types.ts";
import type { SessionsListResult } from "../types.ts";
import { renderBrowserPane } from "./browser-pane.ts";
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
    sessionKey?: string;
    model?: string | null;
    modelProvider?: string | null;
    modelOverride?: string | null;
    providerOverride?: string | null;
    models?: ModelCatalogEntry[];
    omitSessionFromList?: boolean;
    patchResolvedModel?: {
      model: string | null;
      modelProvider?: string | null;
    };
  } = {},
): { state: AppViewState; request: ReturnType<typeof vi.fn> } {
  const sessionKey = overrides.sessionKey ?? "main";
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
  const applySessionModel = (model: string | null, modelProvider?: string | null) => {
    if (!model) {
      currentModel = null;
      currentModelProvider = null;
      currentModelOverride = null;
      currentProviderOverride = null;
      return;
    }
    const normalized = model.trim();
    const slashIndex = normalized.indexOf("/");
    if (slashIndex > 0) {
      currentModelProvider = normalized.slice(0, slashIndex);
      currentModel = normalized.slice(slashIndex + 1);
    } else {
      currentModel = normalized;
      if (typeof modelProvider === "string" && modelProvider.trim()) {
        currentModelProvider = modelProvider.trim();
      } else {
        const matchingProviders = catalog
          .filter((entry) => entry.id === normalized)
          .map((entry) => entry.provider)
          .filter(Boolean);
        currentModelProvider =
          matchingProviders.length === 1 ? matchingProviders[0] : currentModelProvider;
      }
    }
    currentProviderOverride = currentModelProvider;
    currentModelOverride = currentModel;
  };
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "sessions.patch") {
      if ("model" in params) {
        const resolvedPatch = overrides.patchResolvedModel;
        if (resolvedPatch) {
          applySessionModel(resolvedPatch.model, resolvedPatch.modelProvider);
        } else {
          applySessionModel((params.model as string | null | undefined) ?? null);
        }
      }
      return {
        ok: true,
        key: sessionKey,
        resolved: currentModel
          ? {
              model: currentModel,
              modelProvider: currentModelProvider ?? undefined,
            }
          : undefined,
      };
    }
    if (method === "chat.history") {
      return { messages: [], thinkingLevel: null };
    }
    if (method === "sessions.list") {
      return createSessionsListResult({
        sessionKey,
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
    sessionKey,
    chatSessionRenameKey: null,
    chatSessionRenameDraft: "",
    chatSessionRenamePending: false,
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
      sessionKey,
      lastActiveSessionKey: sessionKey,
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: "dark",
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      chatHideCronSessions: true,
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
      state.sessionsHideCron = next.chatHideCronSessions;
    },
    setTab: vi.fn(),
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

function createWorkspaceComputerSession(
  overrides: Partial<ComputerSessionState> = {},
): ComputerSessionState {
  return {
    sessionKey: "main",
    backend: "local-mac",
    status: "running",
    mode: "foreground_supervised",
    target: {
      id: "local-mac:mac-local:display:display-main",
      label: "Local Mac (display-main)",
      kind: "local-mac-host",
      platform: "macos",
      nodeId: "mac-local",
      displayId: "display-main",
      globalInput: true,
      allowsConcurrentObserve: true,
    },
    capabilities: [
      {
        kind: "observe_only",
        available: true,
        exposure: "exposed",
        reasonCode: "local_mac_observe_supported",
        reason: "Read-only screen capture is supported on the local Mac.",
      },
      {
        kind: "foreground_control",
        available: true,
        exposure: "exposed",
        reasonCode: "local_mac_foreground_control_supported",
        reason:
          "Control uses real macOS Accessibility input and may move focus, cursor, or global input.",
      },
    ],
    approvedApps: ["com.apple.safari"],
    policy: {
      allow: { apps: [], paths: [], hosts: [], actions: [], surfaces: [] },
      deny: { apps: [], paths: [], hosts: [], actions: [], surfaces: [] },
      sensitive: { apps: [], paths: [], hosts: [], actions: [], surfaces: [] },
      commandLikeActions: [],
    },
    safety: {
      level: "elevated",
      lastEvent: {
        id: "safety-1",
        at: 800,
        type: "untrusted_external_content",
        reasonCode: "untrusted_external_content",
        summary: "External content is untrusted by default.",
        heuristic: true,
        appName: "Safari",
        appBundleId: "com.apple.Safari",
        windowTitle: "Docs",
      },
      recentEvents: [
        {
          id: "safety-1",
          at: 800,
          type: "untrusted_external_content",
          reasonCode: "untrusted_external_content",
          summary: "External content is untrusted by default.",
          heuristic: true,
          appName: "Safari",
          appBundleId: "com.apple.Safari",
          windowTitle: "Docs",
        },
      ],
    },
    replay: {
      frames: [
        {
          frameId: "frame-1",
          capturedAt: 900,
          stepId: "step-1",
          stepSequence: 1,
          stepPhase: "observe-before-action",
          observation: {
            frame: {
              id: "frame-1",
              dataUrl: "data:image/png;base64,frame-one",
              mimeType: "image/png",
              width: 1440,
              height: 900,
              pixelWidth: 2880,
              pixelHeight: 1800,
              logicalWidth: 1440,
              logicalHeight: 900,
              scaleFactor: 2,
              orientation: "landscape",
              displayId: "display-main",
              sourceSpace: "display-pixel",
              capturedAt: 900,
              maxAgeMs: 1500,
              staleAt: 2400,
              cursor: {
                x: 320,
                y: 210,
                visible: true,
              },
            },
            context: {
              display: {
                id: "display-main",
                width: 1440,
                height: 900,
                scale: 2,
                logicalWidth: 1440,
                logicalHeight: 900,
                pixelWidth: 2880,
                pixelHeight: 1800,
                orientation: "landscape",
              },
              activeApp: {
                name: "Safari",
                bundleId: "com.apple.Safari",
                processId: 77,
              },
              activeWindow: {
                title: "Docs",
              },
              capturedAt: 900,
            },
          },
          metadata: {
            frameHash: "frame-hash-1",
            sizeBytes: 1024,
            captureLatencyMs: 14,
            stale: false,
            stalenessMs: 14,
            transform: {
              sourceSpace: "display-pixel",
              sourceWidth: 2880,
              sourceHeight: 1800,
            },
            display: {
              id: "display-main",
              width: 1440,
              height: 900,
              scale: 2,
              logicalWidth: 1440,
              logicalHeight: 900,
              pixelWidth: 2880,
              pixelHeight: 1800,
              orientation: "landscape",
            },
            activeApp: {
              name: "Safari",
              bundleId: "com.apple.Safari",
              processId: 77,
            },
            activeWindow: {
              title: "Docs",
            },
          },
        },
        {
          frameId: "frame-2",
          capturedAt: 1000,
          stepId: "step-1",
          stepSequence: 1,
          stepPhase: "observe-after-action",
          observation: {
            frame: {
              id: "frame-2",
              dataUrl: "data:image/png;base64,frame-two",
              mimeType: "image/png",
              width: 1440,
              height: 900,
              pixelWidth: 2880,
              pixelHeight: 1800,
              logicalWidth: 1440,
              logicalHeight: 900,
              scaleFactor: 2,
              orientation: "landscape",
              displayId: "display-main",
              sourceSpace: "display-pixel",
              capturedAt: 1000,
              maxAgeMs: 1500,
              staleAt: 2500,
              cursor: {
                x: 640,
                y: 320,
                visible: true,
              },
            },
            context: {
              display: {
                id: "display-main",
                width: 1440,
                height: 900,
                scale: 2,
                logicalWidth: 1440,
                logicalHeight: 900,
                pixelWidth: 2880,
                pixelHeight: 1800,
                orientation: "landscape",
              },
              activeApp: {
                name: "Safari",
                bundleId: "com.apple.Safari",
                processId: 77,
              },
              activeWindow: {
                title: "Docs",
              },
              capturedAt: 1000,
            },
          },
          metadata: {
            frameHash: "frame-hash-2",
            sizeBytes: 1200,
            captureLatencyMs: 18,
            stale: false,
            stalenessMs: 18,
            transform: {
              sourceSpace: "display-pixel",
              sourceWidth: 2880,
              sourceHeight: 1800,
            },
            display: {
              id: "display-main",
              width: 1440,
              height: 900,
              scale: 2,
              logicalWidth: 1440,
              logicalHeight: 900,
              pixelWidth: 2880,
              pixelHeight: 1800,
              orientation: "landscape",
            },
            activeApp: {
              name: "Safari",
              bundleId: "com.apple.Safari",
              processId: 77,
            },
            activeWindow: {
              title: "Docs",
            },
          },
        },
      ],
      steps: [
        {
          id: "step-1",
          sequence: 1,
          toolCallId: "tool-1",
          kind: "action",
          phase: "observe-after-action",
          status: "completed",
          summary: "Click the docs navigation item",
          actionType: "click",
          sourceFrameId: "frame-1",
          resultFrameId: "frame-2",
          startedAt: 900,
          updatedAt: 1000,
          totalElapsedMs: 100,
          lastActionElapsedMs: 72,
          actionCount: 1,
          approvalCount: 0,
          safetyEventsCount: 1,
          action: {
            actionId: "action-1",
            type: "click",
            summary: "Click docs navigation item",
            coordinateSpace: "display-pixel",
            referenceWidth: 1440,
            referenceHeight: 900,
            target: {
              x: 320,
              y: 220,
            },
          },
        },
      ],
      actionCount: 1,
      safetyEventsCount: 1,
    },
    permissions: {
      accessibility: true,
      screenRecording: true,
      observation: "granted",
      control: "granted",
    },
    blocking: null,
    runtime: {
      connectionState: "running",
      launchCount: 1,
      helperProtocolVersion: 2,
      helperVersion: "1.0.0",
      helperProcessId: 4242,
      activeSession: {
        sessionKey: "main",
        state: "running",
        updatedAt: 1000,
      },
      lastError: null,
    },
    context: {
      display: {
        id: "display-main",
        width: 1440,
        height: 900,
        scale: 2,
        logicalWidth: 1440,
        logicalHeight: 900,
        pixelWidth: 2880,
        pixelHeight: 1800,
        orientation: "landscape",
      },
      activeApp: {
        name: "Safari",
        bundleId: "com.apple.Safari",
        processId: 77,
      },
      activeWindow: {
        title: "Docs",
      },
      capturedAt: 1000,
    },
    frame: {
      id: "frame-2",
      dataUrl: "data:image/png;base64,frame-two",
      mimeType: "image/png",
      width: 1440,
      height: 900,
      pixelWidth: 2880,
      pixelHeight: 1800,
      logicalWidth: 1440,
      logicalHeight: 900,
      scaleFactor: 2,
      orientation: "landscape",
      displayId: "display-main",
      sourceSpace: "display-pixel",
      capturedAt: 1000,
      maxAgeMs: 1500,
      staleAt: 2500,
      cursor: {
        x: 640,
        y: 320,
        visible: true,
      },
    },
    stepCounter: 1,
    activeStep: null,
    lastCompletedStep: {
      id: "step-1",
      sequence: 1,
      toolCallId: "tool-1",
      kind: "action",
      phase: "observe-after-action",
      status: "completed",
      summary: "Click the docs navigation item",
      actionType: "click",
      sourceFrameId: "frame-1",
      resultFrameId: "frame-2",
      startedAt: 900,
      updatedAt: 1000,
    },
    timeline: [
      {
        id: "timeline-1",
        at: 900,
        kind: "observation",
        summary: "Captured the source frame.",
        stepId: "step-1",
        stepSequence: 1,
        toolCallId: "tool-1",
        stepPhase: "observe-before-action",
        resultFrameId: "frame-1",
      },
      {
        id: "timeline-2",
        at: 950,
        kind: "action",
        summary: "Clicked the docs navigation item.",
        stepId: "step-1",
        stepSequence: 1,
        toolCallId: "tool-1",
        stepPhase: "action",
        actionId: "action-1",
        actionResultId: "action-result-1",
        sourceFrameId: "frame-1",
        success: true,
        elapsedMs: 72,
        retryCount: 0,
      },
      {
        id: "timeline-3",
        at: 1000,
        kind: "safety",
        summary: "External content kept the session elevated.",
        stepId: "step-1",
        stepSequence: 1,
        toolCallId: "tool-1",
        stepPhase: "observe-after-action",
        safetyEventType: "untrusted_external_content",
        reasonCode: "untrusted_external_content",
        heuristic: true,
      },
    ],
    eventLog: [
      {
        id: "event-1",
        ordinal: 1,
        at: 900,
        code: "frame_captured",
        summary: "Captured the source frame.",
        sessionId: "main",
        toolCallId: "tool-1",
        stepId: "step-1",
        stepSequence: 1,
        stepPhase: "observe-before-action",
        status: "observing",
        sourceFrameId: "frame-1",
      },
      {
        id: "event-2",
        ordinal: 2,
        at: 940,
        code: "action_validated",
        summary: "Action validated.",
        sessionId: "main",
        toolCallId: "tool-1",
        stepId: "step-1",
        stepSequence: 1,
        stepPhase: "action",
        status: "running",
        actionType: "click",
        actionId: "action-1",
      },
      {
        id: "event-3",
        ordinal: 3,
        at: 950,
        code: "action_executed",
        summary: "Clicked the docs navigation item.",
        sessionId: "main",
        toolCallId: "tool-1",
        stepId: "step-1",
        stepSequence: 1,
        stepPhase: "action",
        status: "running",
        actionType: "click",
        actionId: "action-1",
        nativeActionId: "action-result-1",
        success: true,
        elapsedMs: 72,
      },
      {
        id: "event-4",
        ordinal: 4,
        at: 1000,
        code: "safety_raised",
        summary: "External content is untrusted by default.",
        sessionId: "main",
        toolCallId: "tool-1",
        stepId: "step-1",
        stepSequence: 1,
        stepPhase: "observe-after-action",
        status: "running",
        actionType: "click",
        reasonCode: "untrusted_external_content",
        safetyEventType: "untrusted_external_content",
        heuristic: true,
      },
    ],
    buffers: {
      eventLimit: 160,
      replayFrameLimit: 24,
      replayStepLimit: 24,
      timelineLimit: 80,
      eventLogTruncated: false,
      replayFramesTruncated: false,
      replayStepsTruncated: false,
      timelineTruncated: false,
    },
    awaitingApproval: null,
    lastError: null,
    startedAt: 100,
    updatedAt: 1000,
    ...overrides,
  };
}

function createComputerPermissions(params: {
  accessibility: boolean | null;
  screenRecording: boolean | null;
}): ComputerSessionState["permissions"] {
  return {
    accessibility: params.accessibility,
    screenRecording: params.screenRecording,
    observation:
      params.screenRecording === true
        ? "granted"
        : params.screenRecording === false
          ? "missing"
          : "unknown",
    control:
      params.accessibility === true
        ? "granted"
        : params.accessibility === false
          ? "missing"
          : "unknown",
  };
}

afterEach(() => {
  vi.useRealTimers();
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
            configDefaults: { host: "gateway", security: "allowlist", ask: "on-miss" },
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

  it("hides unavailable local computer status in the web chat strip", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          accessMode: "recommended",
          onApplyAccessMode: () => undefined,
          nativeShellState: null,
          nativeShellLoading: false,
          nativeShellError: null,
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("No local access");
    expect(container.textContent).not.toContain("Computer access");
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

  it("ignores repeated Enter keydown events while a send is already in progress", () => {
    const container = document.createElement("div");
    const onSend = vi.fn();
    render(
      renderChat(
        createProps({
          draft: "abre o google",
          sending: true,
          onSend,
        }),
      ),
      container,
    );

    const composer = container.querySelector<HTMLTextAreaElement>("textarea");
    composer?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true }),
    );

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

  it("hides the generic disconnected notice when a more specific chat error is shown", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          connected: false,
          canSend: false,
          disabledReason: "Disconnected from Alisio.",
          error: "Reconnecting…",
        }),
      ),
      container,
    );

    const dangerCallouts = container.querySelectorAll(".callout.danger");
    expect(dangerCallouts).toHaveLength(1);
    expect(dangerCallouts[0]?.textContent).toContain("Reconnecting…");
    expect(container.textContent).not.toContain("Disconnected from Alisio.");
  });

  it("does not duplicate reconnect banners in the full chat shell", async () => {
    window.history.replaceState({}, "", "/chat?session=agent%3Amain%3Amain");
    const app = document.createElement("alisio-app") as AlisioApp;
    document.body.append(app);
    app.lastError = "Reconnecting…";
    app.requestUpdate();
    await app.updateComplete;

    const dangerCallouts = app.querySelectorAll(".callout.danger");
    expect(dangerCallouts).toHaveLength(1);
    expect(dangerCallouts[0]?.textContent).toContain("Reconnecting…");
    expect(app.textContent).not.toContain("Disconnected from Alisio.");
  });

  it("keeps the global error banner outside the chat tab", async () => {
    window.history.replaceState({}, "", "/settings");
    const app = document.createElement("alisio-app") as AlisioApp;
    document.body.append(app);
    app.tab = "settings";
    app.lastError = "Reconnecting…";
    app.requestUpdate();
    await app.updateComplete;

    const dangerCallouts = app.querySelectorAll(".callout.danger");
    expect(dangerCallouts).toHaveLength(1);
    expect(dangerCallouts[0]?.textContent).toContain("Reconnecting…");
  });

  it("renders markdown in the generic right pane host", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sidebarOpen: true,
          sidebarContent: "Hello **world**",
          browserPaneSurfaceKind: "tool_output",
          onCloseSidebar: () => undefined,
        }),
      ),
      container,
    );

    expect(container.querySelector(".browser-pane")).not.toBeNull();
    expect(container.querySelector(".sidebar-markdown strong")?.textContent).toBe("world");
    expect(container.querySelector("resizable-divider")).not.toBeNull();
  });

  it("keeps native computer panes hidden in the web shell even if backend state exists", async () => {
    window.history.replaceState({}, "", "/chat?session=main");
    const app = document.createElement("alisio-app") as AlisioApp;
    document.body.append(app);

    app.setComputerSession(
      "main",
      createWorkspaceComputerSession({
        status: "observing",
        mode: "approved_apps_only",
        approvedApps: [],
        safety: {
          level: "normal",
          recentEvents: [],
        },
        permissions: createComputerPermissions({
          accessibility: true,
          screenRecording: true,
        }),
        context: {
          display: {
            id: "display-1",
            width: 1440,
            height: 900,
            scale: 2,
            logicalWidth: 1440,
            logicalHeight: 900,
            pixelWidth: 2880,
            pixelHeight: 1800,
            orientation: "landscape",
          },
          capturedAt: 10,
        },
        frame: {
          id: "frame-sidebar",
          dataUrl: "data:image/jpeg;base64,abc",
          mimeType: "image/jpeg",
          width: 1440,
          height: 900,
          pixelWidth: 2880,
          pixelHeight: 1800,
          logicalWidth: 1440,
          logicalHeight: 900,
          scaleFactor: 2,
          orientation: "landscape",
          displayId: "display-1",
          sourceSpace: "display-pixel",
          capturedAt: 10,
          maxAgeMs: 1000,
          staleAt: 1010,
        },
        stepCounter: 0,
        timeline: [],
        startedAt: 1,
        updatedAt: 10,
      }),
    );
    await app.updateComplete;

    app.notifyBrowserPaneActivityForSurface("main", "computer");
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(false);
    expect(app.querySelector(".computer-pane")).toBeNull();
    expect(
      app.querySelector(".alisio-chat__workspace-toggle button")?.textContent ?? "",
    ).not.toContain("Live session");
  });

  it("reopens the preview pane only after real preview activity arrives", async () => {
    window.history.replaceState({}, "", "/chat?session=main");
    const app = document.createElement("alisio-app") as AlisioApp;
    document.body.append(app);

    const browserState = {
      title: "Live preview",
      subtitle: "Remote tool snapshot",
      url: "https://docs.alisio.ai",
      screenshotUrl: "data:image/png;base64,browser-shot",
      status: "running",
    };

    app.setBrowserPaneBrowserState("main", browserState);
    await app.updateComplete;

    expect(app.browserPaneSurfaceKind).toBe("preview");
    expect(app.sidebarOpen).toBe(false);
    expect(app.querySelector(".alisio-chat__workspace-toggle button")?.textContent).toContain(
      "Open Preview",
    );

    app.querySelector<HTMLButtonElement>(".alisio-chat__workspace-toggle button")?.click();
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(true);
    expect(app.textContent).toContain("Live preview");

    app.handleCloseSidebar();
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(false);

    // Keeping the same browser state around must not reopen the pane by itself.
    app.setBrowserPaneBrowserState("main", browserState);
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(false);

    app.notifyBrowserPaneActivityForSurface("main", "preview");
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(true);
    expect(app.browserPaneSurfaceKind).toBe("preview");
  });

  it("abre a pane de preview quando a actividade live chega antes do preview final", async () => {
    window.history.replaceState({}, "", "/chat?session=main");
    const app = document.createElement("alisio-app") as AlisioApp;
    document.body.append(app);

    app.notifyBrowserPaneActivityForSurface("main", "preview");
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(false);

    app.chatToolMessages = [
      {
        role: "assistant",
        toolName: "browser",
        toolPhase: "result",
        content: [
          {
            type: "toolresult",
            name: "browser",
            text: '{"ok":true}',
            details: { ok: true, url: "https://grokopedia.com" },
          },
        ],
      },
    ];

    app.refreshBrowserPaneBrowserState("main");
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(true);
    expect(app.browserPaneSurfaceKind).toBe("preview");

    (
      app as unknown as {
        syncBrowserPaneForSession: (sessionKey: string) => void;
      }
    ).syncBrowserPaneForSession("main");
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(true);
    expect(app.browserPaneBrowserState?.url).toBe("https://grokopedia.com");
  });

  it("keeps tool output minimized until a new tool-output activity is signalled", async () => {
    window.history.replaceState({}, "", "/chat?session=main");
    const app = document.createElement("alisio-app") as AlisioApp;
    document.body.append(app);

    app.handleOpenSidebar("Tool output body");
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(true);
    expect(app.browserPaneSurfaceKind).toBe("tool_output");
    expect(app.textContent).toContain("Tool output body");

    app.handleCloseSidebar();
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(false);

    // A plain resync must not reopen the pane while the same session output still exists.
    (
      app as unknown as {
        syncBrowserPaneForSession: (sessionKey: string) => void;
      }
    ).syncBrowserPaneForSession("main");
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(false);

    app.notifyBrowserPaneActivity("main");
    await app.updateComplete;

    expect(app.sidebarOpen).toBe(true);
    expect(app.browserPaneSurfaceKind).toBe("tool_output");
  });

  it("renders the workspace computer pane with replay, diff, metrics and step details", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1100));
    const container = document.createElement("div");
    render(
      renderBrowserPane({
        computer: createWorkspaceComputerSession(),
        selectedSurface: "computer",
        selectedComputerReplayStepId: "step-1",
        computerStepDetailsOpen: true,
      }),
      container,
    );

    expect(container.querySelector(".computer-pane")).not.toBeNull();
    expect(container.querySelector(".computer-pane__frame-image")).not.toBeNull();
    expect(container.querySelector(".computer-pane__diff-layer")).not.toBeNull();
    expect(container.querySelector(".computer-pane__action-overlay")).not.toBeNull();
    expect(container.querySelector(".computer-pane__cursor")).not.toBeNull();
    expect(container.querySelector(".computer-pane__scrubber")).not.toBeNull();
    expect(container.querySelectorAll(".computer-pane__step-card")).toHaveLength(1);
    expect(container.textContent).toContain("Safari");
    expect(container.textContent).toContain("Docs");
    expect(container.textContent).toContain("pid 4242");
    expect(container.textContent).toContain("Click docs navigation item");
    expect(container.textContent).toContain("External content is untrusted by default.");
    expect(container.textContent).toContain("Event log");
    expect(container.textContent).toContain("Capture latency");
    expect(container.textContent).toContain("Fresh frame");
  });

  it("renders partial replay and error inspector states without crashing on missing frames", () => {
    const container = document.createElement("div");
    render(
      renderBrowserPane({
        computer: createWorkspaceComputerSession({
          replay: {
            ...createWorkspaceComputerSession().replay,
            frames: [],
          },
          eventLog: [
            {
              id: "event-fail-1",
              ordinal: 1,
              at: 1000,
              code: "action_failed",
              summary: "Click failed because the frame was stale.",
              sessionId: "main",
              toolCallId: "tool-1",
              stepId: "step-1",
              stepSequence: 1,
              stepPhase: "action",
              status: "error",
              actionType: "click",
              actionId: "action-1",
              failureCategory: "stale-frame",
            },
          ],
          buffers: {
            eventLimit: 160,
            replayFrameLimit: 24,
            replayStepLimit: 24,
            timelineLimit: 80,
            eventLogTruncated: true,
            replayFramesTruncated: true,
            replayStepsTruncated: false,
            timelineTruncated: false,
          },
        }),
        selectedSurface: "computer",
        selectedComputerReplayStepId: "step-1",
        computerStepDetailsOpen: true,
      }),
      container,
    );

    expect(container.textContent).toContain("Replay data is partial");
    expect(container.textContent).toContain("Error inspector");
    expect(container.textContent).toContain("Click failed because the frame was stale.");
    expect(container.textContent).toContain("frame that is no longer in the local replay buffer");
  });

  it("renders explicit workspace surfaces and exposes replay interactions", () => {
    const onSelectSurface = vi.fn();
    const onSelectComputerReplayStep = vi.fn();
    const onToggleComputerStepDetails = vi.fn();
    const container = document.createElement("div");
    render(
      renderBrowserPane({
        browser: {
          title: "Live preview",
          subtitle: "Remote tool snapshot",
          url: "https://docs.alisio.ai",
          screenshotUrl: "data:image/png;base64,browser-shot",
          status: "running",
        },
        computer: createWorkspaceComputerSession(),
        toolOutput: {
          content: "Tool output body",
          error: null,
        },
        selectedSurface: "computer",
        selectedComputerReplayStepId: "step-1",
        computerStepDetailsOpen: true,
        onSelectSurface,
        onSelectComputerReplayStep,
        onToggleComputerStepDetails,
      }),
      container,
    );

    const switchButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".browser-pane__switch button"),
    );
    expect(switchButtons.map((button) => button.textContent?.trim())).toEqual([
      "Tool output",
      "Preview",
      "Live session",
    ]);

    switchButtons[1]?.click();
    expect(onSelectSurface).toHaveBeenCalledWith("preview");

    const scrubber = container.querySelector(".computer-pane__scrubber") as HTMLInputElement | null;
    scrubber?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSelectComputerReplayStep).toHaveBeenCalledWith("step-1");

    const detailToggle = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".computer-pane__replay-actions button"),
    ).find((button) => button.textContent?.includes("Hide details"));
    detailToggle?.click();
    expect(onToggleComputerStepDetails).toHaveBeenCalledWith(false);
  });

  it("renders a start control for stopped computer sessions", () => {
    const onComputerSessionCommand = vi.fn();
    const container = document.createElement("div");
    render(
      renderBrowserPane({
        computer: createWorkspaceComputerSession({
          status: "stopped",
        }),
        selectedSurface: "computer",
        onComputerSessionCommand,
      }),
      container,
    );

    Array.from(container.querySelectorAll<HTMLButtonElement>(".computer-pane button"))
      .find((button) => button.textContent?.includes("Start"))
      ?.click();

    expect(onComputerSessionCommand).toHaveBeenCalledWith("start");
  });

  it("shows approval controls and permission guidance from the workspace session state", () => {
    const onComputerSessionApproval = vi.fn();
    const onRequestComputerPermission = vi.fn();
    const container = document.createElement("div");
    render(
      renderBrowserPane({
        computer: createWorkspaceComputerSession({
          status: "blocked_on_approval",
          permissions: createComputerPermissions({
            accessibility: false,
            screenRecording: false,
          }),
          awaitingApproval: {
            id: "approval-1",
            createdAt: 1000,
            actionType: "open_url",
            actionSummary: "Open https://billing.example.com",
            reason: "Host is outside the approved scope.",
            reasonCode: "scope_escape_attempt",
            policyDecision: "require_once",
            sensitive: true,
            safetyEvents: [
              {
                id: "safety-2",
                at: 1000,
                type: "scope_escape_attempt",
                reasonCode: "scope_escape_attempt",
                summary: "Attempt to leave the approved scope.",
                heuristic: true,
                host: "billing.example.com",
              },
            ],
            stepId: "step-1",
            stepSequence: 1,
            toolCallId: "tool-1",
          },
        }),
        selectedSurface: "computer",
        onComputerSessionApproval,
        onRequestComputerPermission,
      }),
      container,
    );

    expect(container.textContent).toContain("Awaiting approval");
    expect(container.textContent).toContain("Host is outside the approved scope.");
    expect(container.textContent).toContain("scope_escape_attempt");

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".computer-pane button"),
    );
    buttons.find((button) => button.textContent?.includes("Approve once"))?.click();
    buttons.find((button) => button.textContent?.includes("Approve for session"))?.click();
    buttons.find((button) => button.textContent?.includes("Deny"))?.click();
    buttons
      .filter((button) => button.textContent?.includes("Grant access"))
      .forEach((button) => button.click());

    expect(onComputerSessionApproval).toHaveBeenCalledWith("allow-once");
    expect(onComputerSessionApproval).toHaveBeenCalledWith("allow-session");
    expect(onComputerSessionApproval).toHaveBeenCalledWith("deny");
    expect(onRequestComputerPermission).toHaveBeenCalledTimes(4);
    expect(onRequestComputerPermission).toHaveBeenCalledWith("screenRecording");
    expect(onRequestComputerPermission).toHaveBeenCalledWith("accessibility");
  });

  it("shows honest foreground control, background ownership and focus blocking", () => {
    const onOpenComputerSession = vi.fn();
    const container = document.createElement("div");
    render(
      renderBrowserPane({
        computer: createWorkspaceComputerSession({
          sessionKey: "observer-session",
          blocking: {
            kind: "blocked_on_focus",
            reasonCode: "focus_required",
            summary:
              "foreground control required; session main already owns local-mac:mac-local:display:display-main",
            at: 1100,
            targetId: "local-mac:mac-local:display:display-main",
            ownerSessionKey: "main",
            foregroundControlRequired: true,
            actionType: "click",
          },
          runtime: {
            connectionState: "running",
            launchCount: 1,
            helperProtocolVersion: 2,
            helperVersion: "1.0.0",
            helperProcessId: 4242,
            activeSession: {
              sessionKey: "main",
              state: "running",
              updatedAt: 1000,
            },
            lastError: null,
          },
        }),
        selectedSurface: "computer",
        onOpenComputerSession,
      }),
      container,
    );

    expect(container.textContent).toContain("Background session");
    expect(container.textContent).toContain("Foreground control required");
    expect(container.textContent).toContain("Control owner: main");

    const switchButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".computer-pane button"),
    ).find((button) => button.textContent?.includes("Open active session"));
    switchButton?.click();

    expect(onOpenComputerSession).toHaveBeenCalledWith("main");
  });

  it("does not open an empty split when the session has no real workspace pane activity", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sidebarOpen: true,
          browserPaneSurfaceKind: "preview",
          browserPaneBrowserState: {
            title: "   ",
            subtitle: "",
            url: "",
            screenshotUrl: null,
            status: "",
          },
          onCloseSidebar: () => undefined,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-split-container--open")).toBeNull();
    expect(container.querySelector(".chat-sidebar")).toBeNull();
    expect(container.querySelector(".computer-pane")).toBeNull();
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
    expect(container.querySelector(".alisio-chat__loading-state")?.textContent).toContain(
      "Loading session history",
    );
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

  it("shows explicit bootstrap and cold-start states instead of looking stuck", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          loading: true,
          startupLoading: true,
          bootstrapLoading: true,
          sending: true,
          messages: [],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Preparing the chat");
    expect(container.textContent).toContain("Starting the run");
    expect(container.textContent).toContain("remote runtime is warming up");
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

  it("keeps committed assistant stream segments and tool cards in a single assistant group", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          streamSegments: [
            { text: "Vou confirmar primeiro onde fica a configuração.", ts: 1_000 },
            { text: "Agora vou resumir o que encontrei.", ts: 1_200 },
          ],
          toolMessages: [
            {
              role: "assistant",
              runId: "run-1",
              toolCallId: "tool-read",
              toolPhase: "result",
              content: [
                {
                  type: "toolcall",
                  name: "Read",
                  arguments: { path: "/tmp/demo.txt" },
                },
                {
                  type: "toolresult",
                  name: "Read",
                  text: "done",
                },
              ],
              timestamp: 1_100,
              __alisio: { kind: "tool-stream", phase: "result", isError: false },
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".chat-group.assistant")).toHaveLength(1);
    expect(container.querySelectorAll(".chat-group.tool")).toHaveLength(0);
    expect(container.textContent).toContain("Vou confirmar primeiro onde fica a configuração.");
    expect(container.textContent).toContain("Agora vou resumir o que encontrei.");
    expect(container.textContent).toContain("/tmp/demo.txt");
  });

  it("renders repeated toolCallIds from different runs as separate tool cards", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          toolMessages: [
            {
              role: "assistant",
              runId: "run-a",
              toolCallId: "shared-tool-call-id",
              toolPhase: "result",
              content: [
                {
                  type: "toolcall",
                  name: "Read",
                  arguments: { path: "/tmp/a.txt" },
                },
                {
                  type: "toolresult",
                  name: "Read",
                  text: "done-a",
                },
              ],
              timestamp: 1_000,
              __alisio: { kind: "tool-stream", phase: "result", isError: false },
            },
            {
              role: "assistant",
              runId: "run-b",
              toolCallId: "shared-tool-call-id",
              toolPhase: "result",
              content: [
                {
                  type: "toolcall",
                  name: "Read",
                  arguments: { path: "/tmp/b.txt" },
                },
                {
                  type: "toolresult",
                  name: "Read",
                  text: "done-b",
                },
              ],
              timestamp: 1_100,
              __alisio: { kind: "tool-stream", phase: "result", isError: false },
            },
          ],
        }),
      ),
      container,
    );

    const cards = Array.from(container.querySelectorAll(".chat-tool-card"));
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("/tmp/a.txt");
    expect(cards[0]?.textContent).toContain("done-a");
    expect(cards[1]?.textContent).toContain("/tmp/b.txt");
    expect(cards[1]?.textContent).toContain("done-b");
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

  it("personalizes the welcome state with the viewer first name when available", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          viewerDisplayName: "Nuno Lopes",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Hello, Nuno.");
    expect(container.textContent).toContain("What do you want to handle?");
    expect(container.textContent).toContain("Create a task");
  });

  it("wires featured app actions in the welcome state for connect and use flows", () => {
    const container = document.createElement("div");
    const onBeginConnector = vi.fn();
    const onDraftChange = vi.fn();
    const onSend = vi.fn();
    render(
      renderChat(
        createProps({
          connectorCatalog: [
            {
              id: "gmail-send",
              title: "Gmail Send",
              providerLabel: "Google",
              category: "google",
              connectLabel: "Connect with Google",
              summary: "Send outbound email drafts.",
              availability: "ready",
              scopes: ["https://www.googleapis.com/auth/gmail.send"],
            },
            {
              id: "google-calendar",
              title: "Google Calendar",
              providerLabel: "Google",
              category: "google",
              connectLabel: "Connect with Google",
              summary: "Access your calendar.",
              availability: "ready",
              scopes: ["https://www.googleapis.com/auth/calendar"],
            },
          ],
          connectorAuthorizations: [
            {
              connectorId: "google-calendar",
              state: "connected",
              health: "healthy",
              scopes: ["https://www.googleapis.com/auth/calendar"],
              connectedAccount: {
                label: "Nuno",
                email: "nuno@example.com",
              },
            },
          ],
          onBeginConnector,
          onDraftChange,
          onSend,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Connect send");
    expect(container.textContent).toContain("View calendar");

    const connectButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".agent-chat__welcome-app"),
    ).find((button) => button.textContent?.includes("Connect"));
    expect(connectButton).not.toBeUndefined();
    connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onBeginConnector).toHaveBeenCalledWith("gmail-send");

    const useButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".agent-chat__welcome-app"),
    ).find((button) => button.textContent?.includes("View calendar"));
    expect(useButton).not.toBeUndefined();
    useButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onDraftChange).toHaveBeenCalledWith("Look at my calendar and help me organize the day.");
    expect(onSend).toHaveBeenCalledTimes(1);
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

  it("applies distinct queue tone classes for current and next items", () => {
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

    expect(container.querySelector(".chat-queue__item--current")).not.toBeNull();
    expect(container.querySelector(".chat-queue__state--next")).not.toBeNull();
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

    expect(container.querySelector(".chat-group-footer .chat-copy-btn")).toBeNull();
    expect(container.querySelector(".chat-group-footer .chat-expand-btn")).toBeNull();
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

  it("reconciles the picker with the backend-resolved model after a switch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state, request } = createChatHeaderState({
      sessionKey: "agent:main:subagent:child",
      models: createModelCatalog(OPENAI_GPT5_MODEL, OPENAI_GPT5_MINI_MODEL, {
        id: "qwen3-4b-q4-k-m",
        name: "Qwen3 4B",
        provider: "alisio-local-current-llama",
        providerLabel: "This device",
      }),
      patchResolvedModel: { model: "gpt-5-mini", modelProvider: "openai" },
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();

    modelSelect!.value = "alisio-local-current-llama/qwen3-4b-q4-k-m";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();
    render(renderChatSessionSelect(state), container);

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:subagent:child",
      model: "alisio-local-current-llama/qwen3-4b-q4-k-m",
    });
    expect(state.chatModelOverrides["agent:main:subagent:child"]).toEqual({
      kind: "qualified",
      value: "openai/gpt-5-mini",
    });

    const rerendered = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(rerendered?.value).toBe("openai/gpt-5-mini");
    expect(state.sessionsResult?.sessions[0]?.model).toBe("gpt-5-mini");
    expect(state.sessionsResult?.sessions[0]?.modelProvider).toBe("openai");
    vi.unstubAllGlobals();
  });

  it("blocks local managed models in the main chat picker before sending a patch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state, request } = createChatHeaderState({
      models: createModelCatalog(OPENAI_GPT5_MODEL, OPENAI_GPT5_MINI_MODEL, {
        id: "qwen3-4b-q4-k-m",
        name: "Qwen3 4B",
        provider: "alisio-local-current-llama",
        providerLabel: "This device",
      }),
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(
      Array.from(modelSelect?.querySelectorAll("option") ?? []).map((option) => option.value),
    ).not.toContain("alisio-local-current-llama/qwen3-4b-q4-k-m");

    modelSelect!.value = "alisio-local-current-llama/qwen3-4b-q4-k-m";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).not.toHaveBeenCalledWith("sessions.patch", expect.anything());
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

  it("renders the desktop chat toolbar with a compact chat dropdown and tools menu", () => {
    const { state } = createChatHeaderState();
    const container = document.createElement("div");
    render(renderChatDesktopToolbar(state), container);

    expect(container.querySelector(".alisio-chat-toolbar")).not.toBeNull();
    expect(container.textContent).toContain("New chat");
    expect(container.querySelector(".chat-session-dropdown")).not.toBeNull();
    expect(container.querySelector('[data-chat-session-dropdown-trigger="true"]')).not.toBeNull();
    expect(container.querySelector(".chat-session-header")).toBeNull();
    expect(container.querySelector('select[data-chat-model-select="true"]')).toBeNull();
    expect(container.querySelector(".chat-tools-menu")).not.toBeNull();
  });

  it("keeps only the cron chat visibility toggle in the chat tools menu", () => {
    const { state } = createChatHeaderState();
    const container = document.createElement("div");
    render(renderChatDesktopToolbar(state), container);

    const labels = Array.from(
      container.querySelectorAll<HTMLElement>(".chat-tools-menu__item-label"),
    ).map((node) => node.textContent?.trim());
    expect(labels).toContain("Cron chats");
    expect(labels).not.toContain("Cron");

    const cronChatsButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".chat-tools-menu__item"),
    ).find((button) => button.textContent?.includes("Cron chats"));
    expect(cronChatsButton).toBeTruthy();
    cronChatsButton?.click();
    expect(state.settings.chatHideCronSessions).toBe(false);
    expect(state.sessionsHideCron).toBe(false);
    expect(state.setTab).not.toHaveBeenCalled();
  });

  it("supports rendering the desktop chat toolbar inside the topbar with search", () => {
    const { state } = createChatHeaderState();
    const container = document.createElement("div");
    render(
      renderChatDesktopToolbar(state, {
        surface: "topbar",
        searchButton: html`
          <button class="topbar-search topbar-search--chat" type="button">
            <span class="topbar-search__label">Pesquisar</span>
          </button>
        `,
      }),
      container,
    );

    expect(container.querySelector(".alisio-chat-toolbar--topbar")).not.toBeNull();
    expect(container.querySelector(".topbar-search--chat")).not.toBeNull();
    const secondary = container.querySelector(".alisio-chat-toolbar__secondary");
    const children = Array.from(secondary?.children ?? []);
    expect(children.at(-1)?.classList.contains("topbar-search")).toBe(true);
  });

  it("shows the derived first-message title in the desktop chat toolbar", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:dashboard:new-chat";
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
          derivedTitle: "Plano de marketing para maio",
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatDesktopToolbar(state), container);

    const titleButton = container.querySelector<HTMLElement>(
      '[data-chat-session-dropdown-trigger="true"]',
    );
    expect(titleButton?.textContent).toContain("Plano de marketing para maio");
    expect(titleButton?.textContent).not.toContain("dashboard:");
  });

  it("keeps the generic new chat title when the server only has a synthetic session-id fallback", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:dashboard:new-chat";
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
          sessionId: "79bbe587-a9fa-4dd8-9b01-0d3e2a6f51d9",
          derivedTitle: "79bbe587 (2026-04-17)",
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatDesktopToolbar(state), container);

    const titleButton = container.querySelector<HTMLElement>(
      '[data-chat-session-dropdown-trigger="true"]',
    );
    expect(titleButton?.textContent).toContain("New chat");
    expect(titleButton?.textContent).not.toContain("79bbe587");
  });

  it("creates a real new chat from the desktop toolbar and switches the active conversation", async () => {
    const { state, request } = createChatHeaderState();
    request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.create") {
        expect(params).toEqual({ agentId: "main" });
        return { key: "agent:main:dashboard:new-chat" };
      }
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "agent:main:dashboard:new-chat" };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      if (method === "sessions.list") {
        return {
          ts: 0,
          path: "",
          count: 2,
          defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
          sessions: [
            {
              key: "main",
              kind: "direct",
              updatedAt: null,
            },
            {
              key: "agent:main:dashboard:new-chat",
              kind: "direct",
              updatedAt: null,
            },
          ],
        };
      }
      if (method === "models.list") {
        return { models: state.chatModelCatalog };
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
    render(renderChatDesktopToolbar(state), container);

    const newChatButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("New chat"),
    );
    expect(newChatButton).not.toBeUndefined();
    newChatButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushTasks();
    await flushTasks();

    expect(request).toHaveBeenCalledWith("sessions.create", { agentId: "main" });
    expect(state.sessionKey).toBe("agent:main:dashboard:new-chat");
    expect(state.settings.lastActiveSessionKey).toBe("agent:main:dashboard:new-chat");
    expect(state.resetToolStream).toHaveBeenCalled();
    expect(state.resetChatScroll).toHaveBeenCalled();
  });

  it("allows renaming the active chat from the desktop dropdown", async () => {
    const { state, request } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:dashboard:chat-1";
    state.settings.sessionKey = state.sessionKey;
    let currentLabel: string | null = null;
    request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.patch") {
        currentLabel = (params?.label as string | null | undefined) ?? null;
        return {
          ok: true,
          key: state.sessionKey,
          entry: {
            sessionId: "transcript-1",
          },
        };
      }
      if (method === "sessions.list") {
        return {
          ts: 0,
          path: "",
          count: 1,
          defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
          sessions: [
            {
              key: state.sessionKey,
              kind: "direct",
              updatedAt: null,
              derivedTitle: "Plano de marketing para maio",
              ...(currentLabel ? { label: currentLabel } : {}),
            },
          ],
        };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      if (method === "models.list") {
        return { models: state.chatModelCatalog };
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
          derivedTitle: "Plano de marketing para maio",
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatDesktopToolbar(state), container);

    const renameButton = container.querySelector<HTMLButtonElement>(
      '[data-chat-session-rename-button="agent:main:dashboard:chat-1"]',
    );
    expect(renameButton).not.toBeNull();
    renameButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    render(renderChatDesktopToolbar(state), container);

    const input = container.querySelector<HTMLInputElement>(
      '[data-chat-session-rename-input="agent:main:dashboard:chat-1"]',
    );
    expect(input).not.toBeNull();
    input!.value = "Marketing maio";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    await flushTasks();
    await flushTasks();
    render(renderChatDesktopToolbar(state), container);

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:dashboard:chat-1",
      label: "Marketing maio",
    });
    expect(
      container.querySelector<HTMLElement>('[data-chat-session-dropdown-trigger="true"]')
        ?.textContent,
    ).toContain("Marketing maio");
  });

  it("allows deleting the active chat from the desktop dropdown and falls back cleanly", async () => {
    const { state, request } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:dashboard:chat-1";
    state.settings.sessionKey = state.sessionKey;
    state.settings.lastActiveSessionKey = state.sessionKey;
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 2,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: "agent:main:dashboard:chat-1",
          kind: "direct",
          updatedAt: null,
          derivedTitle: "Chat para apagar",
        },
        {
          key: "main",
          kind: "direct",
          updatedAt: null,
          derivedTitle: "Main Session",
        },
      ],
    };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.delete") {
        expect(params).toEqual({
          key: "agent:main:dashboard:chat-1",
          deleteTranscript: true,
        });
        return { ok: true };
      }
      if (method === "sessions.list") {
        return {
          ts: 0,
          path: "",
          count: 1,
          defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
          sessions: [
            {
              key: "main",
              kind: "direct",
              updatedAt: null,
              derivedTitle: "Main Session",
            },
          ],
        };
      }
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "main" };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      if (method === "models.list") {
        return { models: state.chatModelCatalog };
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
    render(renderChatDesktopToolbar(state), container);

    const deleteButton = container.querySelector<HTMLButtonElement>(
      '[data-chat-session-delete-button="agent:main:dashboard:chat-1"]',
    );
    expect(deleteButton).not.toBeNull();
    deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushTasks();
    await flushTasks();
    render(renderChatDesktopToolbar(state), container);

    expect(state.sessionKey).toBe("main");
    expect(state.settings.lastActiveSessionKey).toBe("main");
    expect(request).toHaveBeenCalledWith("sessions.delete", {
      key: "agent:main:dashboard:chat-1",
      deleteTranscript: true,
    });
    expect(
      container.querySelector<HTMLElement>('[data-chat-session-dropdown-trigger="true"]')
        ?.textContent,
    ).toContain("Main Session");
  });

  it("switches to a known chat without reloading the full sessions list", async () => {
    const { state, request } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "main";
    state.settings.sessionKey = "main";
    state.assistantAgentId = "main";
    state.chatMessages = [{ role: "assistant", content: [{ type: "text", text: "Main chat" }] }];
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 2,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        { key: "main", kind: "direct", updatedAt: null, derivedTitle: "Main Session" },
        {
          key: "agent:main:dashboard:chat-1",
          kind: "direct",
          updatedAt: null,
          derivedTitle: "Chat um",
        },
      ],
    };
    request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "agent:main:dashboard:chat-1" };
      }
      if (method === "chat.history") {
        expect(params).toEqual({
          sessionKey: "agent:main:dashboard:chat-1",
          limit: 200,
        });
        return {
          messages: [{ role: "assistant", content: [{ type: "text", text: "Chat um" }] }],
          thinkingLevel: null,
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });

    switchChatSession(state, "agent:main:dashboard:chat-1");
    await flushTasks();

    expect(state.loadAssistantIdentity).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("sessions.messages.subscribe", {
      key: "agent:main:dashboard:chat-1",
    });
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Chat um" }] },
    ]);
  });

  it("renders compact model labels in the composer picker", () => {
    const { state } = createChatHeaderState({
      model: "gpt-5-mini",
      modelProvider: "openai",
      models: createModelCatalog(OPENAI_GPT5_MODEL, OPENAI_GPT5_MINI_MODEL, DEEPSEEK_CHAT_MODEL),
    });
    const container = document.createElement("div");
    render(renderChatComposerModelSelect(state), container);

    const select = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    const labels = Array.from(select?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toEqual(["GPT-5", "GPT-5 Mini", "DeepSeek Chat"]);
    expect(labels.some((label) => label?.includes("·"))).toBe(false);
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

  it("renders assistant task proposals inline and wires approve actions", () => {
    const container = document.createElement("div");
    const onResolveTaskProposal = vi.fn();
    render(
      renderChat(
        createProps({
          messages: [
            {
              id: "assistant-msg",
              role: "assistant",
              timestamp: 1,
              content: [
                {
                  type: "text",
                  text: [
                    "Vamos guardar isto como proposta.",
                    "```alisio-task",
                    JSON.stringify({
                      title: "Implementar task inbox",
                      summary: "Criar inbox e launch flow no chat.",
                      acceptance: ["Existe inbox", "Approve funciona"],
                      launchPrompt: "Implementa a task inbox no chat e na tab de tasks.",
                      kind: "project",
                    }),
                    "```",
                  ].join("\n"),
                },
              ],
            },
          ],
          onResolveTaskProposal,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Vamos guardar isto como proposta.");
    expect(container.textContent).toContain("Implementar task inbox");
    expect(container.textContent).not.toContain("alisio-task");

    const approveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Approve",
    );
    expect(approveButton).toBeTruthy();

    approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onResolveTaskProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        clientKey: "msg:assistant-msg:0",
        requesterSessionKey: "main",
        kind: "project",
        title: "Implementar task inbox",
      }),
      "approved",
    );
  });
});
