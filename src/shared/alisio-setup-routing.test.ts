/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { resolveDisplayedSetupStep } from "../../ui/src/ui/alisio-setup-state.ts";
import { syncUrlWithTab } from "../../ui/src/ui/app-settings.ts";
import { DEFAULT_THEME_SELECTION } from "../../ui/src/ui/theme.ts";

function createRoutingHost(): Parameters<typeof syncUrlWithTab>[0] {
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
      account: {
        profile: {
          username: "nuno",
          displayName: "Nuno",
          email: "nuno@example.com",
          avatarLabel: "N",
          joinedAt: "2026-04-01T00:00:00.000Z",
          plan: "free",
        },
        preferences: {
          language: "pt-PT",
          themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
          themeMode: "dark",
          themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
        },
        session: {
          state: "signed_in",
          profileCompleted: true,
        },
        devices: [],
        cloud: {
          backend: "supabase",
          available: true,
          missingEnvVars: [],
        },
      },
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

  it("allows explicit post-ready steps once startup is ready", () => {
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
    ).toBe("connectors");
  });

  it("keeps explicit post-ready setup steps in the URL", () => {
    window.history.replaceState({}, "", "/setup");
    syncUrlWithTab(createRoutingHost(), "setup", true);
    expect(window.location.pathname).toBe("/setup");
    expect(window.location.search).toBe("?step=connectors");
  });
});
