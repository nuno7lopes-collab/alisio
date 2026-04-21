/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import "../app.ts";
import type { AlisioApp } from "../app.ts";
import { DEFAULT_THEME_SELECTION } from "../theme.ts";
import type { AlisioBootstrapState } from "../types.ts";
import { renderOrganization } from "./organization.ts";
import { renderSetup } from "./setup.ts";

type SetupRenderProps = Parameters<typeof renderSetup>[0];

function createBootstrapAccount(): NonNullable<AlisioBootstrapState["account"]> {
  const runtimeContract: NonNullable<AlisioBootstrapState["account"]>["runtimeContract"] = {
    scopeRoot: "account",
    backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
    localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
  };
  return {
    accountId: "user-1",
    scopeRoot: "account",
    canonical: {
      scopeRoot: "account",
      accountId: "user-1",
      source: "account_id",
      authenticated: true,
      authRequired: true,
    },
    profile: {
      accountId: "user-1",
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
      authRequired: true,
      authenticated: true,
      accountId: "user-1",
    },
    devices: [],
    cloud: {
      backend: "supabase",
      available: true,
      missingEnvVars: [],
    },
    deviceBinding: {
      binding: "account_bound",
      runtime: "local",
      current: true,
      accountId: "user-1",
      deviceId: "device-1",
      label: "Mac",
      platform: "macos",
    },
    runtimeContract,
  };
}

function createReadyBootstrap(overrides: Partial<AlisioBootstrapState> = {}): AlisioBootstrapState {
  const account = createBootstrapAccount();
  return {
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
    runtimeContract: account.runtimeContract,
    ...overrides,
  };
}

function createSetupProps(overrides: Partial<SetupRenderProps> = {}): SetupRenderProps {
  return {
    connected: true,
    lastError: null,
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
    requestedStep: "account",
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
    onAuthEmailChange: vi.fn(),
    onAuthCodeChange: vi.fn(),
    onAuthStageChange: vi.fn(),
    onTermsAcceptedChange: vi.fn(),
    onMarketingOptInChange: vi.fn(),
    onBirthdateChange: vi.fn(),
    onConnect: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onOpenSettingsAi: vi.fn(),
    onAccountFieldChange: vi.fn(),
    onBeginEmailAuth: vi.fn(),
    onVerifyEmailAuth: vi.fn(),
    onSignInWithPassword: vi.fn(),
    onSignUpWithPassword: vi.fn(),
    onRequestRecoveryEmail: vi.fn(),
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
    connectionError: null,
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

  it("shows a specific connection error instead of the generic organization reconnect hint", () => {
    const container = document.createElement("div");

    render(
      renderOrganization(
        createOrganizationProps({
          connected: false,
          accountReady: false,
          connectionError: "Reconnecting…",
        }),
      ),
      container,
    );

    const dangerCallouts = container.querySelectorAll(".callout.danger");
    expect(dangerCallouts).toHaveLength(1);
    expect(dangerCallouts[0]?.textContent).toContain("Reconnecting…");
    expect(container.textContent).not.toContain(
      "Reconnect to Alisio before editing organizations.",
    );
  });

  it("does not duplicate reconnect banners in the full organization shell", async () => {
    window.history.replaceState({}, "", "/organization");
    const app = document.createElement("alisio-app") as AlisioApp;
    document.body.append(app);
    app.tab = "organization";
    app.lastError = "Reconnecting…";
    app.requestUpdate();
    await app.updateComplete;

    const dangerCallouts = app.querySelectorAll(".callout.danger");
    expect(dangerCallouts).toHaveLength(1);
    expect(dangerCallouts[0]?.textContent).toContain("Reconnecting…");
    expect(app.textContent).not.toContain("Reconnect to Alisio before editing organizations.");
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
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Set up your personal agent.");
    expect(container.textContent).toContain("Sign in or create an account");
    expect(container.textContent).toContain("Email");
    expect(container.textContent).toContain("Password");
    expect(container.textContent).toContain("Sign in");
    expect(container.textContent).toContain("Create account");
    expect(container.textContent).toContain("Send magic link");
    expect(container.textContent).toContain("Recover account");
    expect(container.textContent).toContain("Reconnect app");
    expect(container.textContent).not.toContain("Wait for Alisio to reconnect");
    expect(container.textContent).not.toContain("Continue with Google");
  });

  it("hides the generic reconnect notice when a specific connection error is already shown", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          connected: false,
          lastError: "Reconnecting…",
        }),
      ),
      container,
    );

    const dangerCallouts = container.querySelectorAll(".callout.danger");
    expect(dangerCallouts).toHaveLength(1);
    expect(dangerCallouts[0]?.textContent).toContain("Reconnecting…");
    expect(container.textContent).not.toContain("Wait for Alisio to reconnect");
  });

  it("keeps the generic reconnect notice when no specific connection error exists", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          connected: false,
          lastError: null,
          startupError: null,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Wait for Alisio to reconnect");
  });

  it("submete o formulário de entrada com palavra-passe quando o utilizador carrega Enter", () => {
    const container = document.createElement("div");
    const onSignInWithPassword = vi.fn();

    render(
      renderSetup(
        createSetupProps({
          onSignInWithPassword,
        }),
      ),
      container,
    );

    const form = container.querySelector("form.alisio-setup-account");
    const passwordInput = container.querySelector<HTMLInputElement>(
      'input[name="alisio-auth-password"]',
    );
    expect(form).not.toBeNull();
    expect(passwordInput).not.toBeNull();
    if (passwordInput) {
      passwordInput.value = "hunter22";
    }

    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(onSignInWithPassword).toHaveBeenCalledTimes(1);
    expect(onSignInWithPassword).toHaveBeenCalledWith("nuno@example.com", "hunter22");
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
    expect(container.textContent).not.toContain("ALISIO_SUPABASE_URL");
    expect(container.textContent).not.toContain("ALISIO_SUPABASE_ANON_KEY");
  });

  it("never renders the technical OAuth setup guide for missing local connector config", () => {
    const container = document.createElement("div");

    render(
      renderSetup(
        createSetupProps({
          connected: true,
          requestedStep: "connectors",
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("Finish OAuth setup in Alisio");
    expect(container.textContent).not.toContain("ALISIO_GITHUB_CLIENT_ID");
    expect(container.textContent).not.toContain("/oauth/github/callback");
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
            ...createBootstrapAccount(),
            session: {
              ...createBootstrapAccount().session,
              profileCompleted: false,
              backend: "supabase",
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
            ...createBootstrapAccount(),
            session: {
              ...createBootstrapAccount().session,
              backend: "supabase",
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

    expect(container.textContent).toContain("Account ready");
    expect(container.textContent).not.toContain("Create organization");
  });

  it("ignores a stale connectors step once setup is already ready", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          bootstrap: createReadyBootstrap({ nextStep: "connectors" }),
          startupBootstrap: null,
          requestedStep: "connectors",
          authEmail: "",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Account ready");
    expect(container.textContent).not.toContain("Apps externas");
    expect(container.textContent).not.toContain("Connect with Google");
  });

  it("never renders connector actions inside setup", () => {
    const container = document.createElement("div");
    render(
      renderSetup(
        createSetupProps({
          bootstrap: createReadyBootstrap({ nextStep: "connectors" }),
          startupBootstrap: null,
          requestedStep: "connectors",
          authEmail: "",
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("Connect with Google");
    expect(container.textContent).not.toContain("No services connected yet");
    expect(container.textContent).not.toContain("OAuth");
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

    expect(container.textContent).toContain("Account ready");
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
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Account ready");
    expect(container.textContent).not.toContain("Gmail Send");
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
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Account ready");
    expect(container.textContent).not.toContain("Finish macOS permissions");
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
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Reconnect app");
    expect(container.textContent).not.toContain("Account ready");
  });
});
