import { html, nothing } from "lit";
import {
  ALISIO_USERNAME_MAX_LENGTH,
  ALISIO_USERNAME_MIN_LENGTH,
  validateAlisioEmail,
  validateAlisioAccountDraft,
} from "../../../../src/shared/alisio-account.js";
import type {
  AlisioAccountState,
  AlisioBootstrapState,
  AlisioBootstrapStep,
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  AlisioDoctorSummaryState,
  AlisioOrganizationMembershipState,
  NativeShellPermission,
  NativeShellState,
  WizardStep,
} from "../types.ts";

type SetupProps = {
  connected: boolean;
  lastError: string | null;
  bootstrapLoading: boolean;
  bootstrapError: string | null;
  bootstrap: AlisioBootstrapState | null;
  startupLoading: boolean;
  startupError: string | null;
  startupBootstrap: import("../types.ts").AlisioHttpBootstrap | null;
  doctorLoading: boolean;
  doctorError: string | null;
  doctor: AlisioDoctorSummaryState | null;
  wizardLoading: boolean;
  wizardSubmitting: boolean;
  wizardSessionId: string | null;
  wizardStep: WizardStep | null;
  wizardStatus: string | null;
  wizardError: string | null;
  wizardDraftText: string;
  wizardDraftConfirm: boolean;
  wizardDraftSelectIndex: number;
  wizardDraftMultiIndexes: number[];
  requestedStep: AlisioBootstrapStep | null;
  accountLoading: boolean;
  accountError: string | null;
  accountNotice: string | null;
  account: AlisioAccountState | null;
  authMode: "sign-up" | "sign-in";
  authEmail: string;
  authPassword: string;
  aiLoading: boolean;
  aiError: string | null;
  organizationLoading: boolean;
  organizationError: string | null;
  organization: AlisioOrganizationMembershipState | null;
  organizationDraftMode: "create" | "join";
  organizationName: string;
  organizationInviteEmail: string;
  connectorsLoading: boolean;
  connectorsError: string | null;
  connectorCatalog: AlisioConnectorDefinition[];
  connectorAuthorizations: AlisioConnectorAuthorization[];
  nativeShellLoading: boolean;
  nativeShellError: string | null;
  nativeShellState: NativeShellState | null;
  onAuthModeChange: (value: "sign-up" | "sign-in") => void;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onConnect: () => void;
  onOpenWorkspace: () => void;
  onOpenAuthentications: () => void;
  onOpenSettingsAi: () => void;
  onOpenSettingsMac: () => void;
  onSetLaunchAtLogin: (enabled: boolean) => void;
  onRequestPermission: (permission: NativeShellPermission) => void;
  onDraftModeChange: (mode: "create" | "join") => void;
  onOrganizationNameChange: (value: string) => void;
  onInviteEmailChange: (value: string) => void;
  onCreateOrganization: () => void;
  onJoinOrganization: () => void;
  onResetOrganization: () => void;
  onBeginConnector: (connectorId: string) => void;
  onRevokeConnector: (connectorId: string) => void;
  onStartWizard: (mode?: "local" | "remote") => void;
  onContinueWizard: (answer?: { stepId: string; value?: unknown }) => void;
  onCancelWizard: () => void;
  onWizardDraftTextChange: (value: string) => void;
  onWizardDraftConfirmChange: (value: boolean) => void;
  onWizardDraftSelectIndexChange: (value: number) => void;
  onWizardDraftMultiIndexesChange: (value: number[]) => void;
  onAccountFieldChange: (
    field: "username" | "displayName" | "email" | "avatarLabel",
    value: string,
  ) => void;
  onSignUpAccount: () => void;
  onSignInAccount: () => void;
  onRequestPasswordReset: () => void;
  onBeginAiConnect: () => void;
  onDisconnectAi: () => void;
  onRefreshAi: () => void;
  onSaveAccount: () => void;
};

function renderCallout(kind: "info" | "danger", message: string | null | undefined) {
  if (!message) {
    return nothing;
  }
  return html`<div class="callout ${kind}">${message}</div>`;
}

function renderStatusPill(label: string, tone: "ok" | "warn" | "muted" = "muted") {
  return html`<span class="chip ${tone === "ok" ? "chip-active" : ""}">${label}</span>`;
}

function isAiReady(status: string | null | undefined) {
  return status === "connected" || status === "limits_unavailable";
}

function currentStartupState(props: SetupProps) {
  return props.bootstrap?.startupState ?? props.startupBootstrap?.startupState ?? "signed_out";
}

function currentAiStatus(props: SetupProps) {
  return props.bootstrap?.ai.status ?? props.startupBootstrap?.ai?.status ?? "disconnected";
}

function accountValidationMessage(props: SetupProps) {
  const profile = props.account?.profile;
  if (!profile) {
    return null;
  }
  return validateAlisioAccountDraft({
    username: profile.username,
    displayName: profile.displayName,
    email: profile.email,
    avatarLabel: profile.avatarLabel,
  });
}

function renderAccountStep(props: SetupProps) {
  const authMode = props.authMode ?? "sign-up";
  const authEmail = props.authEmail ?? "";
  const authPassword = props.authPassword ?? "";
  const emailError = validateAlisioEmail(authEmail);
  const suggestedEmail =
    props.account?.profile.email ?? props.startupBootstrap?.account?.email ?? "";
  const canSubmit = props.connected && !emailError && authPassword.trim().length > 0;
  const submitBlocker = !props.connected
    ? "Wait for Alisio to connect automatically, then continue."
    : authEmail.trim().length === 0
      ? "Enter your email to continue."
      : emailError
        ? "Use a valid email such as name@example.com."
        : authPassword.trim().length === 0
          ? "Add your password to continue."
          : null;
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">${authMode === "sign-up" ? "Create your account" : "Sign in"}</div>
      <div class="card-sub">
        Start with your Alisio account. The secure connection happens automatically in the
        background.
      </div>
      ${suggestedEmail && !authEmail.trim()
        ? html`
            <div class="callout info">
              Saved account found for <strong>${suggestedEmail}</strong>. You can sign in with that
              email or create a different account.
            </div>
          `
        : nothing}
      ${renderCallout("danger", props.accountError)}
      ${authEmail.trim() && emailError
        ? html`<div class="callout danger">${emailError}</div>`
        : nothing}
      ${renderCallout("info", props.accountNotice)}
      ${!props.connected
        ? html`
            <div class="callout info">
              Alisio should connect automatically on this host. If it has not yet finished, retry
              once.
            </div>
          `
        : nothing}
      <div class="row" style="margin-top: 16px;">
        <button
          class="chip ${authMode === "sign-up" ? "chip-active" : ""}"
          @click=${() => props.onAuthModeChange("sign-up")}
        >
          Create account
        </button>
        <button
          class="chip ${authMode === "sign-in" ? "chip-active" : ""}"
          @click=${() => props.onAuthModeChange("sign-in")}
        >
          Sign in
        </button>
      </div>
      <div class="alisio-settings-form" style="margin-top: 16px;">
        <label class="field">
          <span>Email</span>
          <input
            type="email"
            autocomplete="email"
            placeholder="name@example.com"
            .value=${authEmail}
            @input=${(event: Event) =>
              props.onAuthEmailChange((event.target as HTMLInputElement).value)}
          />
          <small class="field-note">Use the email you want to use to sign in to Alisio.</small>
        </label>
        <label class="field">
          <span>Password</span>
          <input
            type="password"
            autocomplete=${authMode === "sign-up" ? "new-password" : "current-password"}
            placeholder=${authMode === "sign-up" ? "Create a password" : "Your password"}
            .value=${authPassword}
            @input=${(event: Event) =>
              props.onAuthPasswordChange((event.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      ${submitBlocker
        ? html`<div class="callout info" style="margin-top: 16px;">${submitBlocker}</div>`
        : nothing}
      <div class="row" style="margin-top: 16px;">
        ${!props.connected
          ? html`
              <button class="btn" ?disabled=${props.startupLoading} @click=${props.onConnect}>
                ${props.startupLoading ? "Connecting…" : "Reconnect Alisio"}
              </button>
            `
          : nothing}
        <button
          class="btn primary"
          ?disabled=${props.accountLoading || !canSubmit}
          @click=${authMode === "sign-up" ? props.onSignUpAccount : props.onSignInAccount}
        >
          ${props.accountLoading
            ? "Working…"
            : authMode === "sign-up"
              ? (submitBlocker ?? "Create account")
              : (submitBlocker ?? "Sign in")}
        </button>
        ${authMode === "sign-in"
          ? html`
              <button
                class="btn"
                ?disabled=${props.accountLoading || !authEmail.trim() || Boolean(emailError)}
                @click=${props.onRequestPasswordReset}
              >
                Send password reset email
              </button>
            `
          : nothing}
      </div>
    </section>
  `;
}

function renderProfileStep(props: SetupProps) {
  const profile = props.account?.profile;
  const validation = accountValidationMessage(props);
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">Complete your profile</div>
      <div class="card-sub">
        Tell Alisio who you are. Your username must be unique and can use letters, numbers, dots,
        and underscores.
      </div>
      ${renderCallout("danger", props.accountError ?? validation)}
      <div class="alisio-settings-form" style="margin-top: 16px;">
        <label class="field">
          <span>Name</span>
          <input
            type="text"
            .value=${profile?.displayName ?? ""}
            @input=${(event: Event) =>
              props.onAccountFieldChange("displayName", (event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>Username</span>
          <input
            type="text"
            minlength=${String(ALISIO_USERNAME_MIN_LENGTH)}
            maxlength=${String(ALISIO_USERNAME_MAX_LENGTH)}
            .value=${profile?.username ?? ""}
            @input=${(event: Event) =>
              props.onAccountFieldChange("username", (event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>Email</span>
          <input
            type="email"
            .value=${profile?.email ?? props.authEmail}
            @input=${(event: Event) =>
              props.onAccountFieldChange("email", (event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>Avatar</span>
          <input
            type="text"
            maxlength="2"
            .value=${profile?.avatarLabel ?? ""}
            @input=${(event: Event) =>
              props.onAccountFieldChange("avatarLabel", (event.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="row" style="margin-top: 16px;">
        <button class="btn primary" ?disabled=${Boolean(validation)} @click=${props.onSaveAccount}>
          Save profile
        </button>
      </div>
    </section>
  `;
}

function renderAiStep(props: SetupProps) {
  const ai = props.bootstrap?.ai;
  const windows = ai?.limits?.windows ?? [];
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">Connect OpenAI</div>
      <div class="card-sub">
        OpenAI is the default intelligence for Alisio. You can change that later in settings.
      </div>
      ${renderCallout("danger", props.aiError ?? props.bootstrapError)}
      <div class="list-item" style="margin-top: 16px;">
        <div class="list-title">
          ${isAiReady(currentAiStatus(props)) ? "Connected" : "Not connected"}
        </div>
        <div class="list-sub">${ai?.email ?? "No OpenAI account connected yet."}</div>
      </div>
      ${windows.length > 0
        ? html`
            <div style="display: grid; gap: 12px; margin-top: 16px;">
              ${windows.map(
                (window) => html`
                  <div class="list-item">
                    <div class="list-title">${window.label}</div>
                    <div class="list-sub">${window.usedPercent}% used</div>
                  </div>
                `,
              )}
            </div>
          `
        : nothing}
      <div class="row" style="margin-top: 16px;">
        ${isAiReady(currentAiStatus(props))
          ? html`
              <button class="btn" ?disabled=${props.aiLoading} @click=${props.onRefreshAi}>
                Refresh limits
              </button>
              <button
                class="btn danger"
                ?disabled=${props.aiLoading}
                @click=${props.onDisconnectAi}
              >
                Disconnect OpenAI
              </button>
            `
          : html`
              <button
                class="btn primary"
                ?disabled=${props.aiLoading}
                @click=${props.onBeginAiConnect}
              >
                ${props.aiLoading ? "Opening OpenAI…" : "Connect OpenAI"}
              </button>
            `}
      </div>
    </section>
  `;
}

function renderReadyStep(props: SetupProps) {
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">You are ready</div>
      <div class="card-sub">
        Your account, profile, and AI are ready. The rest can wait until after the first chat.
      </div>
      <div class="row" style="margin-top: 16px;">
        <button class="btn primary" @click=${props.onOpenWorkspace}>Start chatting</button>
        <button class="btn" @click=${props.onOpenAuthentications}>Connect tools later</button>
        <button class="btn" @click=${props.onOpenSettingsAi}>AI settings</button>
      </div>
    </section>
  `;
}

export function renderSetup(props: SetupProps) {
  const startupState = currentStartupState(props);
  const aiStatus = currentAiStatus(props);
  const ready = startupState === "ready" && isAiReady(aiStatus);
  const progressLabel =
    startupState === "signed_out"
      ? "1 of 3"
      : startupState === "needs_profile"
        ? "2 of 3"
        : startupState === "needs_ai"
          ? "3 of 3"
          : "Ready";

  return html`
    <section class="alisio-setup-page">
      <div class="alisio-setup-page__hero">
        <div class="alisio-page__eyebrow">Welcome to Alisio</div>
        <h1>Set up your personal agent.</h1>
        <p>
          Create your account, finish your profile, connect OpenAI, and start the first
          conversation.
        </p>
        <div class="alisio-setup-page__progress">
          <span class="alisio-setup-page__progress-pill">${progressLabel}</span>
          ${renderStatusPill(
            startupState === "signed_out"
              ? "Account"
              : startupState === "needs_profile"
                ? "Profile"
                : startupState === "needs_ai"
                  ? "OpenAI"
                  : "Ready",
            ready ? "ok" : "warn",
          )}
        </div>
      </div>

      <div class="alisio-setup-page__card">
        <div class="alisio-setup-minimal__stack">
          ${!props.connected && (props.lastError || props.startupError)
            ? html` <div class="callout danger">${props.lastError ?? props.startupError}</div> `
            : nothing}
          ${startupState === "signed_out" ? renderAccountStep(props) : nothing}
          ${startupState === "needs_profile" ? renderProfileStep(props) : nothing}
          ${startupState === "needs_ai" ? renderAiStep(props) : nothing}
          ${ready ? renderReadyStep(props) : nothing}
        </div>
      </div>
    </section>
  `;
}
