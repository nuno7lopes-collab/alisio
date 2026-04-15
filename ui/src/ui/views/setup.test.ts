/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_SELECTION } from "../theme.ts";
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
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: "dark" as const,
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
    },
    session: {
      state: "signed_in" as const,
      profileCompleted: true,
    },
    devices: [],
    cloud: {
      backend: "supabase",
      available: true,
      missingEnvVars: [],
    },
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
      controlUrl: "ws://127.0.0.1:40705/",
      startupState: "signed_out",
      account: null,
      accountCloud: {
        backend: "supabase",
        available: true,
        missingEnvVars: [],
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
    passwordResetRequired: false,
    termsAccepted: false,
    marketingOptIn: false,
    birthdate: "",
    aiLoading: false,
    aiError: null,
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
    onUpdatePassword: vi.fn(),
    ...overrides,
  };
}

function createOrganizationProps(
  overrides: Partial<Parameters<typeof renderOrganization>[0]> = {},
): Parameters<typeof renderOrganization>[0] {
  return {
    connected: true,
    accountReady: true,
    plan: "plus",
    loading: false,
    error: null,
    organization: null,
    draftMode: "create",
    organizationName: "",
    inviteEmail: "",
    onDraftModeChange: vi.fn(),
    onOrganizationNameChange: vi.fn(),
    onInviteEmailChange: vi.fn(),
    onCreateOrganization: vi.fn(),
    onJoinOrganization: vi.fn(),
    onResetOrganization: vi.fn(),
    ...overrides,
  };
}

describe("setup view", () => {
  it("keeps the current organization visible while organization refresh is in flight", () => {
    const container = document.createElement("div");

    render(
      renderOrganization(
        createOrganizationProps({
          loading: true,
          organization: {
            mode: "owner",
            organizationName: "Team Orbit",
            inviteEmail: "team@example.com",
          },
        }),
      ),
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
      renderOrganization(
        createOrganizationProps({
          loading: true,
          draftMode: "join",
          organizationName: "Team Orbit",
          inviteEmail: "team@example.com",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Join organization");
    expect(container.textContent).toContain("Saving…");
    expect(container.querySelector(".loading-state__list-item")).toBeNull();
  });

  it("blocks organization edits until the gateway is connected", () => {
    const container = document.createElement("div");

    render(
      renderOrganization(
        createOrganizationProps({
          connected: false,
          accountReady: false,
          draftMode: "create",
          organizationName: "Team Orbit",
          inviteEmail: "",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Reconnect to Alisio before editing organizations.");
    const action = container.querySelector<HTMLButtonElement>(".btn.primary");
    expect(action?.disabled).toBe(true);
  });

  it("validates invitation emails before enabling join", () => {
    const container = document.createElement("div");

    render(
      renderOrganization(
        createOrganizationProps({
          draftMode: "join",
          organizationName: "Team Orbit",
          inviteEmail: "invalid-email",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Use a valid invitation email.");
    const action = container.querySelector<HTMLButtonElement>(".btn.primary");
    expect(action?.disabled).toBe(true);
  });

  it("allows creating an organization on Free", () => {
    const container = document.createElement("div");

    render(
      renderOrganization(
        createOrganizationProps({
          plan: "free",
          draftMode: "create",
          organizationName: "Team Orbit",
          inviteEmail: "",
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("Organizations require Plus");
    const action = container.querySelector<HTMLButtonElement>(".btn.primary");
    expect(action?.disabled).toBe(false);
  });

  it("keeps the organization page focused on membership only", () => {
    const container = document.createElement("div");

    render(
      renderOrganization(
        createOrganizationProps({
          organization: {
            mode: "owner",
            organizationName: "Team Orbit",
            inviteEmail: "team@example.com",
          },
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Current organization");
    expect(text).not.toContain("Devices");
    expect(text).not.toContain("Sharing policy");
    expect(text).not.toContain("Suggested sharing");
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
            controlUrl: "ws://127.0.0.1:40705/",
            startupState: "signed_out",
            account: {
              username: "nuno",
              displayName: "Nuno",
              email: "nuno@example.com",
              avatarLabel: "N",
              plan: "free",
            },
            accountCloud: {
              backend: "supabase",
              available: true,
              missingEnvVars: [],
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

    expect(container.textContent).toContain("Set up your personal agent.");
    expect(container.textContent).toContain("Sign in or create an account");
    expect(container.textContent).toContain("Email");
    expect(container.textContent).toContain("Continue with Google");
    expect(container.textContent).toContain("Magic link by email");
    expect(container.textContent).toContain("Send sign-in link");
    expect(container.textContent).toContain("We will send a secure sign-in link");
    expect(container.textContent).toContain("Reconnect app");
    expect(container.textContent).toContain("Wait for Alisio to reconnect");
    expect(
      container.querySelector(
        '.alisio-setup-account__method-btn--google img[src="brand-icons/google.svg"]',
      ),
    ).not.toBeNull();
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

  it("bloqueia o setup quando o backend cloud nao esta configurado", () => {
    const container = document.createElement("div");

    render(
      renderSetup(
        createSetupProps({
          connected: true,
          startupBootstrap: {
            basePath: "/",
            controlUrl: "ws://127.0.0.1:40705/",
            startupState: "signed_out",
            account: {
              username: "nuno",
              displayName: "Nuno",
              email: "nuno@example.com",
              avatarLabel: "N",
              plan: "free",
            },
            accountCloud: {
              backend: "supabase",
              available: false,
              missingEnvVars: ["ALISIO_SUPABASE_URL", "ALISIO_SUPABASE_ANON_KEY"],
            },
            ai: null,
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("The Alisio cloud backend is not configured");
    expect(container.textContent).toContain("ALISIO_SUPABASE_URL");
    expect(container.textContent).toContain("ALISIO_SUPABASE_ANON_KEY");
    expect(container.textContent).not.toContain("We verify the email first and finish the rest");
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
              themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
              themeMode: "dark",
              themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
            },
            session: {
              state: "signed_in",
              profileCompleted: false,
              backend: "supabase",
            },
            devices: [],
            cloud: {
              backend: "supabase",
              available: true,
              missingEnvVars: [],
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Agent name");
    expect(container.textContent).toContain("I agree to the Terms and Privacy Policy.");
    expect(container.textContent).toContain("Date of birth");
    const fields = Array.from(container.querySelectorAll(".field span")).map(
      (element) => element.textContent?.trim() ?? "",
    );
    expect(fields).toContain("Agent name");
  });

  it("shows the verification-code stage while email sign-in is pending", () => {
    const container = document.createElement("div");

    render(
      renderSetup(
        createSetupProps({
          authStage: "email-link",
          authPendingEmail: "nuno@example.com",
          authCode: "123456",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Check your email");
    expect(container.textContent).toContain("The email link is the main sign-in step");
    expect(container.textContent).toContain("I have a 6-digit code");
    expect(container.textContent).toContain("Sign in with code");
    expect(container.textContent).toContain("Resend link");
    expect(container.textContent).toContain("Change email");
    expect(container.textContent).toContain("nuno@example.com");
    expect(container.querySelector("details.alisio-setup-advanced")).not.toBeNull();
    expect(container.querySelector("details.alisio-setup-advanced")?.hasAttribute("open")).toBe(
      true,
    );
  });

  it("mostra o formulário de nova password quando o recovery já abriu sessão", () => {
    const container = document.createElement("div");

    render(
      renderSetup(
        createSetupProps({
          passwordResetRequired: true,
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
              backend: "supabase",
            },
            devices: [],
            cloud: {
              backend: "supabase",
              available: true,
              missingEnvVars: [],
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Set a new password");
    expect(container.textContent).toContain("Save password");
    expect(container.textContent).not.toContain("Verification code");
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

  it("keeps connectors available on Free after the first occupied slot", () => {
    const container = document.createElement("div");
    const onBeginConnector = vi.fn();
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
          onBeginConnector,
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("Free includes 1 connected app.");
    const githubButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Connect with GitHub"),
    );
    expect(githubButton?.disabled).toBe(false);
    githubButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onBeginConnector).toHaveBeenCalledWith("github");
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
    expect(container.textContent).toContain("Setup required");
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
