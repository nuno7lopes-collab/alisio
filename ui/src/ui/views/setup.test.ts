/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AlisioBootstrapState, NativeShellState } from "../types.ts";
import { renderOrganization } from "./organization.ts";
import { renderSetup } from "./setup.ts";

type SetupRenderProps = Parameters<typeof renderSetup>[0];

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

function createBootstrapAccount(): NonNullable<AlisioBootstrapState["account"]> {
  return {
    profile: {
      username: "nuno",
      displayName: "Nuno",
      email: "nuno@example.com",
      avatarLabel: "N",
      joinedAt: "2026-04-01T00:00:00.000Z",
      plan: "free",
    },
    preferences: {
      language: "pt-PT" as const,
      theme: "dark" as const,
    },
    session: {
      state: "signed_in" as const,
      profileCompleted: true,
    },
    devices: [],
  };
}

function createReadyBootstrap(overrides: Partial<AlisioBootstrapState> = {}): AlisioBootstrapState {
  return {
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
    account: createBootstrapAccount(),
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
    ...overrides,
  };
}

function createSetupProps(overrides: Partial<SetupRenderProps> = {}): SetupRenderProps {
  return {
    connected: true,
    lastError: null,
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
    requestedStep: "account",
    setupGuide: null,
    accountLoading: false,
    accountError: null,
    accountNotice: null,
    account: null,
    authEmail: "nuno@example.com",
    authPendingEmail: "",
    authCode: "",
    authStage: "entry",
    termsAccepted: false,
    marketingOptIn: false,
    birthdate: "",
    aiLoading: false,
    aiError: null,
    connectorsSearch: "",
    connectorsCategoryFilter: "all",
    onConnectorsSearchChange: vi.fn(),
    onConnectorsCategoryChange: vi.fn(),
    onDismissSetupGuide: vi.fn(),
    onOpenSupportUrl: vi.fn(),
    organizationLoading: false,
    organizationError: null,
    organization: { mode: "none" },
    organizationDraftMode: "create",
    organizationName: "",
    organizationInviteEmail: "",
    connectorsLoading: false,
    connectorsError: null,
    connectorCatalog: [],
    connectorAuthorizations: [],
    nativeShellLoading: false,
    nativeShellError: null,
    nativeShellState: createNativeShellState(),
    onAuthEmailChange: vi.fn(),
    onAuthPendingEmailChange: vi.fn(),
    onAuthCodeChange: vi.fn(),
    onAuthStageChange: vi.fn(),
    onTermsAcceptedChange: vi.fn(),
    onMarketingOptInChange: vi.fn(),
    onBirthdateChange: vi.fn(),
    onConnect: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onOpenChannels: vi.fn(),
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
    onBeginEmailAuth: vi.fn(),
    onVerifyEmailAuth: vi.fn(),
    onBeginGoogleAuth: vi.fn(),
    onBeginAiConnect: vi.fn(),
    onDisconnectAi: vi.fn(),
    onRefreshAi: vi.fn(),
    onSaveAccount: vi.fn(),
    ...overrides,
  };
}

describe("setup view", () => {
  it("keeps the current organization visible while organization refresh is in flight", () => {
    const container = document.createElement("div");

    render(
      renderOrganization({
        connected: true,
        accountReady: true,
        plan: "plus",
        loading: true,
        error: null,
        organization: {
          mode: "owner",
          organizationName: "Team Orbit",
          inviteEmail: "team@example.com",
        },
        draftMode: "create",
        organizationName: "",
        inviteEmail: "",
        onDraftModeChange: vi.fn(),
        onOrganizationNameChange: vi.fn(),
        onInviteEmailChange: vi.fn(),
        onCreateOrganization: vi.fn(),
        onJoinOrganization: vi.fn(),
        onResetOrganization: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("Team Orbit");
    expect(container.textContent).toContain("team@example.com");
    expect(container.textContent).toContain("Leave for now");
    expect(container.querySelector(".loading-state__list-item")).toBeNull();
  });

  it("keeps the organization form visible while a create or join save is in flight", () => {
    const container = document.createElement("div");

    render(
      renderOrganization({
        connected: true,
        accountReady: true,
        plan: "plus",
        loading: true,
        error: null,
        organization: null,
        draftMode: "join",
        organizationName: "Team Orbit",
        inviteEmail: "team@example.com",
        onDraftModeChange: vi.fn(),
        onOrganizationNameChange: vi.fn(),
        onInviteEmailChange: vi.fn(),
        onCreateOrganization: vi.fn(),
        onJoinOrganization: vi.fn(),
        onResetOrganization: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("Join organization");
    expect(container.textContent).toContain("Saving…");
    expect(container.querySelector(".loading-state__list-item")).toBeNull();
  });

  it("blocks organization edits until the gateway is connected", () => {
    const container = document.createElement("div");

    render(
      renderOrganization({
        connected: false,
        accountReady: false,
        plan: "plus",
        loading: false,
        error: null,
        organization: null,
        draftMode: "create",
        organizationName: "Team Orbit",
        inviteEmail: "",
        onDraftModeChange: vi.fn(),
        onOrganizationNameChange: vi.fn(),
        onInviteEmailChange: vi.fn(),
        onCreateOrganization: vi.fn(),
        onJoinOrganization: vi.fn(),
        onResetOrganization: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("Reconnect to Alisio before editing organizations.");
    const action = container.querySelector<HTMLButtonElement>(".btn.primary");
    expect(action?.disabled).toBe(true);
  });

  it("validates invitation emails before enabling join", () => {
    const container = document.createElement("div");

    render(
      renderOrganization({
        connected: true,
        accountReady: true,
        plan: "plus",
        loading: false,
        error: null,
        organization: null,
        draftMode: "join",
        organizationName: "Team Orbit",
        inviteEmail: "invalid-email",
        onDraftModeChange: vi.fn(),
        onOrganizationNameChange: vi.fn(),
        onInviteEmailChange: vi.fn(),
        onCreateOrganization: vi.fn(),
        onJoinOrganization: vi.fn(),
        onResetOrganization: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("Use a valid invitation email.");
    const action = container.querySelector<HTMLButtonElement>(".btn.primary");
    expect(action?.disabled).toBe(true);
  });

  it("shows the Plus upgrade path before creating an organization on Free", () => {
    const container = document.createElement("div");

    render(
      renderOrganization({
        connected: true,
        accountReady: true,
        plan: "free",
        loading: false,
        error: null,
        organization: null,
        draftMode: "create",
        organizationName: "Team Orbit",
        inviteEmail: "",
        onDraftModeChange: vi.fn(),
        onOrganizationNameChange: vi.fn(),
        onInviteEmailChange: vi.fn(),
        onCreateOrganization: vi.fn(),
        onJoinOrganization: vi.fn(),
        onResetOrganization: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("Organizations are available on Plus.");
    expect(container.textContent).toContain("Open Settings -> Billing");
    const action = container.querySelector<HTMLButtonElement>(".btn.primary");
    expect(action?.disabled).toBe(true);
  });

  it("renders the web-first setup flow and key steps", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          connected: false,
          lastError: "Runtime unavailable",
          startupBootstrap: {
            basePath: "/",
            controlUrl: "ws://127.0.0.1:18789/",
            startupState: "signed_out",
            account: {
              username: "nuno",
              displayName: "Nuno",
              email: "nuno@example.com",
              avatarLabel: "N",
              plan: "free",
            },
            ai: null,
          },
          requestedStep: "runtime",
          authEmail: "nuno@example.com",
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
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Welcome to Alisio");
    expect(container.textContent).toContain("Set up your personal agent.");
    expect(container.textContent).toContain("connect OpenAI");
    expect(container.textContent).toContain("Sign in to Alisio");
    expect(container.textContent).toContain("Email");
    expect(container.textContent).toContain("Continue with Google");
    expect(container.textContent).toContain("Use the email address for your Alisio account.");
    expect(container.textContent).toContain("Reconnect app");
    expect(container.textContent).toContain("Wait for Alisio to reconnect");
  });

  it("submete o formulário de email quando o utilizador carrega Enter", () => {
    const container = document.createElement("div");
    const onBeginEmailAuth = vi.fn();

    render(
      renderSetup(
        createSetupProps({
          onBeginEmailAuth,
        }),
      ),
      container,
    );

    const form = container.querySelector("form.alisio-setup-account");
    expect(form).not.toBeNull();

    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(onBeginEmailAuth).toHaveBeenCalledTimes(1);
  });

  it("desactiva os campos da conta enquanto um pedido está em curso", () => {
    const container = document.createElement("div");

    render(
      renderSetup(
        createSetupProps({
          accountLoading: true,
        }),
      ),
      container,
    );

    const fieldset = container.querySelector(".alisio-setup-account__fields");
    expect(fieldset).not.toBeNull();
    expect(fieldset?.hasAttribute("disabled")).toBe(true);
  });

  it("mostra o campo do nome do agente ao completar o perfil", () => {
    const container = document.createElement("div");

    render(
      renderSetup(
        createSetupProps({
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
              theme: "dark",
            },
            session: {
              state: "signed_in",
              profileCompleted: false,
              backend: "supabase",
            },
            devices: [],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("What should your agent be called?");
    expect(container.textContent).toContain("I agree to the Terms and Privacy Policy.");
    expect(container.textContent).toContain("Date of birth");
    const fields = Array.from(container.querySelectorAll(".field span")).map(
      (element) => element.textContent?.trim() ?? "",
    );
    expect(fields).toContain("What should your agent be called?");
  });

  it("shows the verification-code stage while email sign-in is pending", () => {
    const container = document.createElement("div");

    render(
      renderSetup(
        createSetupProps({
          authStage: "email-code",
          authPendingEmail: "nuno@example.com",
          authCode: "123456",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Verification code");
    expect(container.textContent).toContain("Send another code");
    expect(container.textContent).toContain("Use another email");
    expect(container.textContent).toContain("nuno@example.com");
  });

  it("shows the ready step instead of organization once onboarding is already complete", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          bootstrap: createReadyBootstrap({ nextStep: "organization" }),
          startupBootstrap: null,
          requestedStep: null,
          authEmail: "",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("You are ready");
    expect(container.textContent).not.toContain("Create organization");
  });

  it("renders connector skeletons instead of zeroed summary cards during connector loading", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          bootstrap: createReadyBootstrap({ nextStep: "connectors" }),
          startupBootstrap: null,
          requestedStep: "connectors",
          authEmail: "",
          connectorsLoading: true,
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".loading-state__stat-card")).toHaveLength(3);
    expect(container.querySelectorAll(".loading-state__list-item").length).toBeGreaterThan(1);
  });

  it("shows the connector upgrade path on Free after the first occupied slot", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          bootstrap: createReadyBootstrap({
            nextStep: "connectors",
            organizationState: { mode: "owner", organizationName: "Team" },
            organization: { mode: "owner", organizationName: "Team" },
          }),
          startupBootstrap: null,
          requestedStep: "connectors",
          authEmail: "",
          connectorCatalog: [
            {
              id: "google-calendar",
              title: "Google Calendar",
              providerLabel: "Google",
              category: "google",
              connectLabel: "Connect with Google",
              summary: "Calendar access.",
              availability: "ready",
              scopes: ["openid", "email"],
            },
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
          connectorAuthorizations: [
            {
              connectorId: "google-calendar",
              state: "connected",
              health: "healthy",
              scopes: ["openid", "email"],
            },
            {
              connectorId: "github",
              state: "not_connected",
              health: "healthy",
              scopes: ["repo"],
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Free includes 1 connected app.");
    const githubButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Connect with GitHub"),
    );
    expect(githubButton?.disabled).toBe(true);
  });

  it("ignores a stale runtime step once setup is already ready", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          bootstrap: createReadyBootstrap(),
          startupBootstrap: null,
          requestedStep: "runtime",
          authEmail: "",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("You are ready");
    expect(container.textContent).not.toContain("Connect OpenAI");
  });

  it("shows the ready step instead of connectors once onboarding is already complete", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          bootstrap: createReadyBootstrap({
            nextStep: "connectors",
            organizationState: { mode: "owner", organizationName: "Team" },
            organization: { mode: "owner", organizationName: "Team" },
            connectorSummary: {
              total: 1,
              ready: 1,
              connected: 0,
              needsReconnect: 0,
              inReview: 0,
              unavailable: 0,
              available: 1,
            },
            connectors: {
              catalog: [],
              authorizations: [],
              summary: {
                total: 1,
                ready: 1,
                connected: 0,
                needsReconnect: 0,
                inReview: 0,
                unavailable: 0,
                available: 1,
              },
            },
          }),
          startupBootstrap: null,
          requestedStep: null,
          authEmail: "",
          organization: { mode: "owner", organizationName: "Team" },
          organizationName: "Team",
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
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("You are ready");
    expect(container.textContent).not.toContain("GitHub");
  });

  it("shows the ready step instead of permissions once onboarding is already complete", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          connected: true,
          bootstrap: createReadyBootstrap({
            nextStep: "permissions",
            organizationState: { mode: "owner", organizationName: "Team" },
            organization: { mode: "owner", organizationName: "Team" },
          }),
          startupBootstrap: null,
          requestedStep: null,
          authEmail: "",
          organization: { mode: "owner", organizationName: "Team" },
          organizationName: "Team",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("You are ready");
    expect(container.textContent).not.toContain("Finish macOS permissions");
  });

  it("keeps explicit post-ready connectors visible without showing a warning state", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          connected: true,
          bootstrap: createReadyBootstrap({
            nextStep: "ready",
            connectorSummary: {
              total: 1,
              ready: 0,
              connected: 0,
              needsReconnect: 0,
              inReview: 0,
              unavailable: 0,
              available: 1,
            },
            connectors: {
              catalog: [],
              authorizations: [],
              summary: {
                total: 1,
                ready: 0,
                connected: 0,
                needsReconnect: 0,
                inReview: 0,
                unavailable: 0,
                available: 1,
              },
            },
          }),
          startupBootstrap: null,
          requestedStep: "connectors",
          authEmail: "",
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
          connectorAuthorizations: [
            {
              connectorId: "github",
              state: "not_connected",
              health: "config_missing",
              scopes: ["repo"],
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).toContain("Preparing");
    expect(container.querySelector(".alisio-setup-page__progress .chip-active")).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Connect with GitHub"),
      ),
    ).toBe(false);
  });

  it("shows reconnect instead of ready when the app is offline", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          connected: false,
          bootstrap: createReadyBootstrap({
            organizationState: { mode: "owner", organizationName: "Team" },
            organization: { mode: "owner", organizationName: "Team" },
          }),
          startupBootstrap: null,
          requestedStep: null,
          authEmail: "",
          organization: { mode: "owner", organizationName: "Team" },
          organizationName: "Team",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Reconnect app");
    expect(container.textContent).not.toContain("You are ready");
  });
});
