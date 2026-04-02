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
        gatewayUrl: "ws://127.0.0.1:18789",
        gatewayToken: "",
        gatewayPassword: "",
        showGatewayToken: false,
        showGatewayPassword: false,
        bootstrapLoading: false,
        bootstrapError: null,
        bootstrap: null,
        startupLoading: false,
        startupError: null,
        startupBootstrap: {
          basePath: "/",
          controlUrl: "ws://127.0.0.1:18789/",
          startupState: "signed_out",
          account: null,
          manualConnectionRequired: false,
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
        account: null,
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
        onGatewayUrlChange: vi.fn(),
        onGatewayTokenChange: vi.fn(),
        onGatewayPasswordChange: vi.fn(),
        onToggleGatewayToken: vi.fn(),
        onToggleGatewayPassword: vi.fn(),
        onConnect: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onOpenAuthentications: vi.fn(),
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
        onSaveAccount: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain(
      "Create your Alisio account, connect OpenAI, and start the first real chat",
    );
    expect(container.textContent).toContain("Two more steps and you are in");
    expect(container.textContent).toContain("Create your account");
    expect(container.textContent).toContain("Connect your AI");
    expect(container.textContent).toContain("Everything else can wait");
    expect(container.textContent).toContain("Connect apps when you actually need them");
    expect(container.textContent).toContain("Runtime unavailable");
    expect(container.textContent).toContain("Open authentications");
  });
});
