/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { NativeShellState } from "../types.ts";
import { renderSetup } from "./setup.ts";

function createNativeShellState(): NativeShellState {
  return {
    platform: "macos",
    launchAtLogin: true,
    permissions: {
      notifications: true,
      appleScript: false,
      accessibility: true,
      screenRecording: false,
      microphone: true,
      speechRecognition: false,
      camera: true,
      location: false,
    },
    voiceWake: {
      supported: true,
      enabled: false,
      talkEnabled: false,
      triggers: ["Hey Alisio"],
    },
    logsPath: "~/Library/Logs/Alisio",
  };
}

describe("setup view", () => {
  it("renders the web-first setup flow and key steps", () => {
    const container = document.createElement("div");
    render(
      renderSetup({
        connected: false,
        lastError: "Runtime unavailable",
        bootstrapLoading: false,
        bootstrapError: null,
        bootstrap: null,
        startupLoading: false,
        startupError: null,
        startupBootstrap: {
          basePath: "/",
          controlUrl: "ws://127.0.0.1:18789/",
          startupState: "signed_out",
          account: {
            username: "nuno",
            displayName: "Nuno",
            email: "nuno@example.com",
            avatarLabel: "N",
            plan: "Free Plan",
          },
          ai: null,
        },
        doctorLoading: false,
        doctorError: null,
        doctor: null,
        wizardLoading: false,
        wizardSubmitting: false,
        wizardSessionId: null,
        wizardStep: null,
        wizardStatus: null,
        wizardError: null,
        wizardDraftText: "",
        wizardDraftConfirm: false,
        wizardDraftSelectIndex: 0,
        wizardDraftMultiIndexes: [],
        requestedStep: "runtime",
        accountLoading: false,
        accountError: null,
        accountNotice: null,
        account: null,
        authMode: "sign-up",
        authEmail: "nuno@example.com",
        authPassword: "password123",
        aiLoading: false,
        aiError: null,
        organizationLoading: false,
        organizationError: null,
        organization: { mode: "none" },
        organizationDraftMode: "create",
        organizationName: "",
        organizationInviteEmail: "",
        connectorsLoading: false,
        connectorsError: null,
        connectorCatalog: [
          {
            id: "github",
            title: "GitHub",
            providerLabel: "GitHub",
            category: "development",
            connectLabel: "Connect with GitHub",
            summary: "Repositories and pull requests.",
            availability: "ready",
            scopes: ["repo"],
          },
        ],
        connectorAuthorizations: [],
        nativeShellLoading: false,
        nativeShellError: null,
        nativeShellState: createNativeShellState(),
        onAuthModeChange: vi.fn(),
        onAuthEmailChange: vi.fn(),
        onAuthPasswordChange: vi.fn(),
        onConnect: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onOpenAuthentications: vi.fn(),
        onOpenSettingsAi: vi.fn(),
        onOpenSettingsMac: vi.fn(),
        onSetLaunchAtLogin: vi.fn(),
        onRequestPermission: vi.fn(),
        onDraftModeChange: vi.fn(),
        onOrganizationNameChange: vi.fn(),
        onInviteEmailChange: vi.fn(),
        onCreateOrganization: vi.fn(),
        onJoinOrganization: vi.fn(),
        onResetOrganization: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
        onStartWizard: vi.fn(),
        onContinueWizard: vi.fn(),
        onCancelWizard: vi.fn(),
        onWizardDraftTextChange: vi.fn(),
        onWizardDraftConfirmChange: vi.fn(),
        onWizardDraftSelectIndexChange: vi.fn(),
        onWizardDraftMultiIndexesChange: vi.fn(),
        onAccountFieldChange: vi.fn(),
        onSignUpAccount: vi.fn(),
        onSignInAccount: vi.fn(),
        onRequestPasswordReset: vi.fn(),
        onBeginAiConnect: vi.fn(),
        onDisconnectAi: vi.fn(),
        onRefreshAi: vi.fn(),
        onSaveAccount: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("Welcome to Alisio");
    expect(container.textContent).toContain("Set up your personal agent.");
    expect(container.textContent).toContain("connect OpenAI");
    expect(container.textContent).toContain("Create your account");
    expect(container.textContent).toContain("Email");
    expect(container.textContent).toContain("Password");
    expect(container.textContent).toContain("Use the email you want to use to sign in to Alisio.");
    expect(container.textContent).toContain("Reconnect Alisio");
    expect(container.textContent).toContain("Alisio should connect automatically on this host.");
  });
});
