/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { resolveDisplayedSetupStep } from "../../ui/src/ui/alisio-setup-state.ts";
import { syncUrlWithTab } from "../../ui/src/ui/app-settings.ts";
import { DEFAULT_THEME_SELECTION } from "../../ui/src/ui/theme.ts";

function createRoutingHost(): Parameters<typeof syncUrlWithTab>[0] {
  const runtimeContract: NonNullable<
    NonNullable<Parameters<typeof syncUrlWithTab>[0]["alisioBootstrap"]>["runtimeContract"]
  > = {
    scopeRoot: "account",
    backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
    localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
  };
  const account = {
    accountId: "user-1",
    scopeRoot: "account" as const,
    canonical: {
      scopeRoot: "account" as const,
      accountId: "user-1",
      source: "account_id" as const,
      authenticated: true,
      authRequired: true as const,
    },
    profile: {
      accountId: "user-1",
      username: "nuno",
      displayName: "Nuno",
      email: "nuno@example.com",
      avatarLabel: "N",
      joinedAt: "2026-04-01T00:00:00.000Z",
      plan: "free" as const,
    },
    preferences: {
      language: "pt-PT" as const,
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: "dark" as const,
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
    },
    session: {
      state: "signed_in" as const,
      profileCompleted: true,
      authRequired: true as const,
      authenticated: true,
      accountId: "user-1",
    },
    devices: [],
    cloud: {
      backend: "supabase" as const,
      available: true,
      missingEnvVars: [],
    },
    deviceBinding: {
      binding: "account_bound" as const,
      runtime: "local" as const,
      current: true,
      accountId: "user-1",
      deviceId: "device-1",
      label: "Mac",
      platform: "macos",
    },
    runtimeContract: {
      ...runtimeContract,
    },
  };
  return {
    settings: {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: DEFAULT_THEME_SELECTION.themeMode,
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      chatHideCronSessions: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 220,
      navGroupsCollapsed: {},
    },
    themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
    themeMode: DEFAULT_THEME_SELECTION.themeMode,
    themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
    themeResolved: "mood-dark",
    applySessionKey: "main",
    sessionKey: "main",
    basePath: "",
    settingsSection: "general",
    setupStep: "connectors",
    connected: true,
    chatHasAutoScrolled: false,
    logsAtBottom: false,
    eventLog: [],
    eventLogBuffer: [],
    tab: "setup",
    alisioBootstrap: {
      accountId: "user-1",
      scopeRoot: "account",
      authRequired: true,
      connectionRequired: false,
      wizardRequired: false,
      wizardRunning: false,
      providerReady: true,
      accountReady: true,
      startupState: "ready",
      organizationState: { mode: "none" },
      connectorSummary: {
        total: 0,
        ready: 0,
        connected: 0,
        needsReconnect: 0,
        inReview: 0,
        unavailable: 0,
        available: 0,
      },
      nextStep: "ready",
      account,
      ai: {
        provider: "openai",
        status: "connected",
      },
      organization: { mode: "none" },
      connectors: {
        catalog: [],
        authorizations: [],
        summary: {
          total: 0,
          ready: 0,
          connected: 0,
          needsReconnect: 0,
          inReview: 0,
          unavailable: 0,
          available: 0,
        },
      },
      wizard: { running: false, sessionId: null },
      models: { total: 0, defaultProvider: "openai", providers: [] },
      deviceBinding: account.deviceBinding,
      runtimeContract,
    },
  };
}

describe("Alisio setup routing", () => {
  it("drops stale runtime requests once startup is ready", () => {
    expect(
      resolveDisplayedSetupStep({
        connected: true,
        requestedStep: "runtime",
        bootstrap: {
          connectionRequired: false,
          startupState: "ready",
          nextStep: "ready",
        },
        startupBootstrap: null,
      }),
    ).toBe("ready");
  });

  it("collapses explicit post-ready steps once startup is ready", () => {
    expect(
      resolveDisplayedSetupStep({
        connected: true,
        requestedStep: "connectors",
        bootstrap: {
          connectionRequired: false,
          startupState: "ready",
          nextStep: "ready",
        },
        startupBootstrap: null,
      }),
    ).toBe("ready");
  });

  it("drops explicit post-ready setup steps from the URL", () => {
    window.history.replaceState({}, "", "/setup");
    syncUrlWithTab(createRoutingHost(), "setup", true);
    expect(window.location.pathname).toBe("/setup");
    expect(window.location.search).toBe("");
  });
});
