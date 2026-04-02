import { html, nothing } from "lit";
import {
  ALISIO_USERNAME_MAX_LENGTH,
  ALISIO_USERNAME_MIN_LENGTH,
  normalizeAlisioUsername,
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

type SetupStatus = "complete" | "current" | "review" | "blocked";
type RequiredSetupStep = "gateway" | "account" | "runtime";

type SetupProps = {
  connected: boolean;
  lastError: string | null;
  gatewayUrl: string;
  gatewayToken: string;
  gatewayPassword: string;
  showGatewayToken: boolean;
  showGatewayPassword: boolean;
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
  account: AlisioAccountState | null;
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
  onGatewayUrlChange: (value: string) => void;
  onGatewayTokenChange: (value: string) => void;
  onGatewayPasswordChange: (value: string) => void;
  onToggleGatewayToken: () => void;
  onToggleGatewayPassword: () => void;
  onConnect: () => void;
  onOpenWorkspace: () => void;
  onOpenAuthentications: () => void;
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
  onSaveAccount: () => void;
};

const FEATURED_CONNECTORS = [
  "google-docs",
  "google-calendar",
  "gmail-read",
  "github",
  "notion",
  "vercel",
] as const;

function setupStatusLabel(status: SetupStatus) {
  switch (status) {
    case "complete":
      return "Ready";
    case "current":
      return "Do now";
    case "review":
      return "Later";
    case "blocked":
    default:
      return "Locked";
  }
}

function permissionSummary(nativeShellState: NativeShellState | null) {
  if (!nativeShellState) {
    return { granted: 0, total: 0 };
  }
  const values = Object.values(nativeShellState.permissions);
  return {
    granted: values.filter(Boolean).length,
    total: values.length,
  };
}

function resolveWizardAnswer(step: WizardStep, props: SetupProps) {
  switch (step.type) {
    case "text":
      return props.wizardDraftText;
    case "confirm":
      return props.wizardDraftConfirm;
    case "select":
      return step.options?.[props.wizardDraftSelectIndex]?.value;
    case "multiselect":
      return (step.options ?? [])
        .filter((_, index) => props.wizardDraftMultiIndexes.includes(index))
        .map((option) => option.value);
    case "action":
      return true;
    case "note":
    case "progress":
    default:
      return undefined;
  }
}

function resolvePrimarySetupStep(props: SetupProps): RequiredSetupStep {
  const startupState =
    props.bootstrap?.startupState ?? props.startupBootstrap?.startupState ?? null;
  if (!props.connected && props.startupBootstrap?.manualConnectionRequired) {
    return "gateway";
  }
  if (startupState === "signed_out" || startupState === "needs_profile") {
    return "account";
  }
  return "runtime";
}

function stepNumber(step: RequiredSetupStep, connected: boolean, showGatewayStep: boolean) {
  const order =
    connected || !showGatewayStep ? ["account", "runtime"] : ["gateway", "account", "runtime"];
  return order.indexOf(step) + 1;
}

function accountValidationMessage(accountProfile: AlisioAccountState["profile"] | null) {
  if (!accountProfile) {
    return null;
  }
  return validateAlisioAccountDraft({
    username: accountProfile.username,
    displayName: accountProfile.displayName,
    email: accountProfile.email,
    avatarLabel: accountProfile.avatarLabel,
  });
}

function renderWizardStep(props: SetupProps) {
  const step = props.wizardStep;
  const bootstrap = props.bootstrap;
  if (!props.connected) {
    return html`<div class="callout info">Connect Alisio to this device first.</div>`;
  }
  if (bootstrap?.providerReady) {
    const providers = bootstrap.models.providers.join(", ") || "No providers detected";
    return html`
      <div class="setup-list">
        <div>
          <span>AI</span>
          <strong>Ready</strong>
        </div>
        <div>
          <span>Providers available</span>
          <strong>${providers}</strong>
        </div>
        <div>
          <span>Models</span>
          <strong>${bootstrap.models.total}</strong>
        </div>
      </div>
      <div class="setup-step__actions">
        <button class="btn primary" @click=${props.onOpenWorkspace}>Start chatting</button>
        <button class="btn" @click=${() => props.onStartWizard("local")}>Change AI</button>
      </div>
    `;
  }
  if (!step) {
    return html`
      ${props.wizardError ? html`<div class="callout danger">${props.wizardError}</div>` : nothing}
      <div class="callout info">
        Connect OpenAI to power Alisio. If you need another provider later, that can live in the
        advanced AI settings.
      </div>
      <div class="setup-step__actions">
        <button
          class="btn primary"
          ?disabled=${props.wizardLoading || props.wizardSubmitting}
          @click=${() => props.onStartWizard("local")}
        >
          ${props.wizardLoading ? "Opening OpenAI setup…" : "Connect OpenAI"}
        </button>
        ${props.wizardSessionId
          ? html`
              <button
                class="btn"
                ?disabled=${props.wizardSubmitting}
                @click=${props.onCancelWizard}
              >
                Stop
              </button>
            `
          : nothing}
      </div>
    `;
  }

  const submit = () =>
    props.onContinueWizard({
      stepId: step.id,
      value: resolveWizardAnswer(step, props),
    });

  return html`
    ${props.wizardError ? html`<div class="callout danger">${props.wizardError}</div>` : nothing}
    <div class="setup-list">
      <div>
        <span>Status</span>
        <strong>${props.wizardStatus ?? "running"}</strong>
      </div>
      <div>
        <span>Step type</span>
        <strong>${step.type}</strong>
      </div>
      <div>
        <span>Executor</span>
        <strong>${step.executor ?? "client"}</strong>
      </div>
    </div>
    ${step.title
      ? html`<div class="card-title" style="margin-top: 18px;">${step.title}</div>`
      : nothing}
    ${step.message ? html`<div class="card-sub">${step.message}</div>` : nothing}

    <div class="setup-step__form">
      ${step.type === "text"
        ? html`
            <label class="field">
              <span>Answer</span>
              <input
                type=${step.sensitive ? "password" : "text"}
                .value=${props.wizardDraftText}
                placeholder=${step.placeholder ?? ""}
                @input=${(event: Event) =>
                  props.onWizardDraftTextChange((event.target as HTMLInputElement).value)}
              />
            </label>
          `
        : nothing}
      ${step.type === "confirm"
        ? html`
            <label class="setup-permission">
              <span>${step.message ?? "Confirm this step"}</span>
              <input
                type="checkbox"
                .checked=${props.wizardDraftConfirm}
                @change=${(event: Event) =>
                  props.onWizardDraftConfirmChange((event.target as HTMLInputElement).checked)}
              />
            </label>
          `
        : nothing}
      ${step.type === "select"
        ? html`
            <div class="setup-choice-row">
              ${(step.options ?? []).map(
                (option, index) => html`
                  <button
                    class="chip ${props.wizardDraftSelectIndex === index ? "chip-active" : ""}"
                    @click=${() => props.onWizardDraftSelectIndexChange(index)}
                  >
                    ${option.label}
                  </button>
                `,
              )}
            </div>
            ${(step.options ?? []).length > 0
              ? html`
                  <div class="setup-step__hint">
                    ${step.options?.[props.wizardDraftSelectIndex]?.hint ?? ""}
                  </div>
                `
              : nothing}
          `
        : nothing}
      ${step.type === "multiselect"
        ? html`
            <div class="setup-choice-row">
              ${(step.options ?? []).map(
                (option, index) => html`
                  <button
                    class="chip ${props.wizardDraftMultiIndexes.includes(index)
                      ? "chip-active"
                      : ""}"
                    @click=${() =>
                      props.onWizardDraftMultiIndexesChange(
                        props.wizardDraftMultiIndexes.includes(index)
                          ? props.wizardDraftMultiIndexes.filter((value) => value !== index)
                          : [...props.wizardDraftMultiIndexes, index],
                      )}
                  >
                    ${option.label}
                  </button>
                `,
              )}
            </div>
          `
        : nothing}
      ${step.type === "progress"
        ? html`<div class="callout info">Finish the current AI setup step to continue.</div>`
        : nothing}
    </div>

    <div class="setup-step__actions">
      <button class="btn primary" ?disabled=${props.wizardSubmitting} @click=${submit}>
        ${step.type === "action" ? "Run step" : "Continue"}
      </button>
      <button class="btn" ?disabled=${props.wizardSubmitting} @click=${props.onCancelWizard}>
        Stop
      </button>
    </div>
  `;
}

export function renderSetup(props: SetupProps) {
  const bootstrap = props.bootstrap;
  const startupBootstrap = props.startupBootstrap;
  const startupState = bootstrap?.startupState ?? startupBootstrap?.startupState ?? "signed_out";
  const connectedAuthorizations = props.connectorAuthorizations.filter(
    (entry) => entry.state === "connected",
  );
  const featuredConnectors = FEATURED_CONNECTORS.map((connectorId) =>
    props.connectorCatalog.find((entry) => entry.id === connectorId),
  ).filter(Boolean) as AlisioConnectorDefinition[];
  const permissionState = permissionSummary(props.nativeShellState);
  const accountProfile = props.account?.profile ?? null;
  const accountSession = props.account?.session ?? null;
  const doctorIssues = props.doctor?.issues ?? [];
  const providerReady = bootstrap?.providerReady ?? false;
  const accountReady = bootstrap?.accountReady ?? false;
  const canOpenWorkspace = props.connected && startupState === "ready";
  const primaryStep = resolvePrimarySetupStep(props);
  const focusedStep = props.requestedStep ?? primaryStep;
  const showGatewayStep =
    Boolean(startupBootstrap?.manualConnectionRequired) || focusedStep === "gateway";
  const blockingDoneCount = [
    startupState !== "signed_out",
    startupState !== "signed_out" && startupState !== "needs_profile",
    startupState === "ready",
  ].filter(Boolean).length;
  const accountValidation = accountValidationMessage(accountProfile);
  const nextStepLabel =
    primaryStep === "account"
      ? "Create your account"
      : primaryStep === "runtime"
        ? "Connect your AI"
        : primaryStep === "gateway"
          ? "Connect Alisio"
          : "Start chatting";
  const blockingIssues = doctorIssues.filter((issue) => issue.severity === "error");
  const optionalIssues = doctorIssues.filter((issue) => issue.severity !== "error");

  const gatewayStatus: SetupStatus =
    startupBootstrap?.manualConnectionRequired && !props.connected ? "current" : "complete";
  const runtimeStatus: SetupStatus =
    !props.connected && startupBootstrap?.manualConnectionRequired
      ? "blocked"
      : providerReady
        ? "complete"
        : primaryStep === "runtime"
          ? "current"
          : "review";
  const accountStatus: SetupStatus =
    !props.connected && startupBootstrap?.manualConnectionRequired
      ? "blocked"
      : accountReady
        ? "complete"
        : primaryStep === "account"
          ? "current"
          : "review";

  return html`
    <section class="setup-surface">
      <div class="setup-shell">
        <header class="setup-hero">
          <div class="setup-hero__topbar">
            <div class="setup-hero__eyebrow">First run</div>
            <div class="setup-hero__counter">${blockingDoneCount}/3 ready</div>
          </div>
          <div class="setup-hero__headline">
            <h1>Finish setup, then start chatting</h1>
            <p>
              Create your Alisio account, connect OpenAI, and start the first real chat. Tools,
              organization, and Mac permissions can wait until after the first useful conversation.
            </p>
          </div>
          <div class="setup-hero__metrics">
            <div class="setup-metric">
              <span class="setup-metric__label">Setup</span>
              <strong>${blockingDoneCount}/3</strong>
            </div>
            <div class="setup-metric">
              <span class="setup-metric__label">Account</span>
              <strong>${startupState === "signed_out" ? "Sign in" : "Ready"}</strong>
            </div>
            <div class="setup-metric">
              <span class="setup-metric__label">Profile</span>
              <strong>${startupState === "needs_profile" ? "Finish it" : "Ready"}</strong>
            </div>
            <div class="setup-metric">
              <span class="setup-metric__label">AI</span>
              <strong>${providerReady ? "Ready" : "Connect it"}</strong>
            </div>
            ${startupBootstrap?.manualConnectionRequired
              ? html`
                  <div class="setup-metric">
                    <span class="setup-metric__label">Connection</span>
                    <strong>${props.connected ? "Live" : "Manual"}</strong>
                  </div>
                `
              : nothing}
          </div>
          <div class="setup-hero__summary">
            <strong>${canOpenWorkspace ? "Chat is ready." : `Next up: ${nextStepLabel}`}</strong>
            <span>
              ${canOpenWorkspace
                ? "Open the workspace now and leave the rest for later in Settings."
                : "Only sign-in, profile, and AI should block the first conversation."}
            </span>
          </div>
          <div class="setup-hero__actions">
            ${canOpenWorkspace
              ? html`
                  <button class="btn primary" @click=${props.onOpenWorkspace}>
                    Start chatting
                  </button>
                  <button class="btn" @click=${props.onOpenAuthentications}>
                    Connect tools later
                  </button>
                `
              : html`
                  <button
                    class="btn primary"
                    @click=${() =>
                      document
                        .getElementById(`setup-step-${primaryStep}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  >
                    Continue setup
                  </button>
                `}
          </div>
          ${props.lastError
            ? html`<div class="callout danger setup-hero__error">${props.lastError}</div>`
            : nothing}
          ${props.startupError
            ? html`<div class="callout danger setup-hero__error">${props.startupError}</div>`
            : nothing}
          ${props.bootstrapError
            ? html`<div class="callout danger setup-hero__error">${props.bootstrapError}</div>`
            : nothing}
          ${props.doctorError
            ? html`<div class="callout danger setup-hero__error">${props.doctorError}</div>`
            : nothing}
          ${blockingIssues.length > 0
            ? html`
                <div class="callout info">
                  <strong>Still needed before the first chat</strong>
                  <div class="setup-list" style="margin-top: 12px;">
                    ${blockingIssues.slice(0, 4).map(
                      (issue) => html`
                        <div>
                          <span>${issue.title}</span>
                          <strong>${issue.step ?? issue.code}</strong>
                        </div>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing}
          ${optionalIssues.length > 0
            ? html`
                <div class="callout info">
                  <strong>Leave this for later</strong>
                  <div class="setup-list" style="margin-top: 12px;">
                    ${optionalIssues.slice(0, 3).map(
                      (issue) => html`
                        <div>
                          <span>${issue.title}</span>
                          <strong>${issue.step ?? issue.code}</strong>
                        </div>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing}
        </header>

        <section class="setup-section">
          <div class="setup-section__head">
            <div>
              <div class="setup-section__kicker">Required now</div>
              <h2>
                ${showGatewayStep
                  ? "Get the first chat ready in three steps"
                  : "Two more steps and you are in"}
              </h2>
              <p>Keep the first run tight and only do what is needed to open the workspace.</p>
            </div>
          </div>
          <div class="setup-grid">
            ${showGatewayStep
              ? html`
                  <article
                    id="setup-step-gateway"
                    class="setup-step card ${focusedStep === "gateway" ? "setup-step--focus" : ""}"
                  >
                    <div class="setup-step__head">
                      <div>
                        <div class="setup-step__kicker">
                          Step ${stepNumber("gateway", props.connected, showGatewayStep)}
                        </div>
                        <h2>Connect this device</h2>
                        <p>
                          On macOS this is usually automatic. Use these fields only when you open
                          Alisio in the browser and need a manual gateway connection.
                        </p>
                      </div>
                      <span class="setup-status setup-status--${gatewayStatus}"
                        >${setupStatusLabel(gatewayStatus)}</span
                      >
                    </div>
                    <div class="setup-step__body">
                      <label class="field">
                        <span>Gateway URL</span>
                        <input
                          .value=${props.gatewayUrl}
                          placeholder="ws://127.0.0.1:18789"
                          @input=${(event: Event) =>
                            props.onGatewayUrlChange((event.target as HTMLInputElement).value)}
                        />
                      </label>
                      <div class="setup-step__dual">
                        <label class="field">
                          <span>Access token</span>
                          <div class="login-gate__secret-row">
                            <input
                              type=${props.showGatewayToken ? "text" : "password"}
                              autocomplete="off"
                              spellcheck="false"
                              .value=${props.gatewayToken}
                              placeholder="ALISIO_GATEWAY_TOKEN"
                              @input=${(event: Event) =>
                                props.onGatewayTokenChange(
                                  (event.target as HTMLInputElement).value,
                                )}
                            />
                            <button
                              type="button"
                              class="btn btn--icon ${props.showGatewayToken ? "active" : ""}"
                              @click=${props.onToggleGatewayToken}
                            >
                              ${props.showGatewayToken ? "Hide" : "Show"}
                            </button>
                          </div>
                        </label>
                        <label class="field">
                          <span>Password</span>
                          <div class="login-gate__secret-row">
                            <input
                              type=${props.showGatewayPassword ? "text" : "password"}
                              autocomplete="off"
                              spellcheck="false"
                              .value=${props.gatewayPassword}
                              placeholder="Gateway password"
                              @input=${(event: Event) =>
                                props.onGatewayPasswordChange(
                                  (event.target as HTMLInputElement).value,
                                )}
                            />
                            <button
                              type="button"
                              class="btn btn--icon ${props.showGatewayPassword ? "active" : ""}"
                              @click=${props.onToggleGatewayPassword}
                            >
                              ${props.showGatewayPassword ? "Hide" : "Show"}
                            </button>
                          </div>
                        </label>
                      </div>
                      <div class="setup-step__actions">
                        <button class="btn primary" @click=${props.onConnect}>
                          Connect Alisio
                        </button>
                      </div>
                    </div>
                  </article>
                `
              : nothing}

            <article
              id="setup-step-account"
              class="setup-step card ${focusedStep === "account" ? "setup-step--focus" : ""}"
            >
              <div class="setup-step__head">
                <div>
                  <div class="setup-step__kicker">
                    Step ${stepNumber("account", props.connected, showGatewayStep)}
                  </div>
                  <h2>Create your account</h2>
                  <p>
                    Start by creating an Alisio account or continue with the account already saved
                    on this device.
                  </p>
                </div>
                <span class="setup-status setup-status--${accountStatus}"
                  >${setupStatusLabel(accountStatus)}</span
                >
              </div>
              <div class="setup-step__body">
                ${props.accountLoading
                  ? html`<div class="empty-state">Loading account…</div>`
                  : props.accountError
                    ? html`<div class="callout danger">${props.accountError}</div>`
                    : accountSession?.state !== "signed_in"
                      ? html`
                          <div class="callout info">
                            ${startupBootstrap?.account
                              ? `Continue as @${startupBootstrap.account.username} or create a new Alisio account on this device.`
                              : "Create the first Alisio account for this device to unlock the chat."}
                          </div>
                          <div class="setup-step__actions">
                            <button class="btn primary" @click=${props.onSignUpAccount}>
                              Create account
                            </button>
                            ${startupBootstrap?.account
                              ? html`
                                  <button class="btn" @click=${props.onSignInAccount}>
                                    Continue as @${startupBootstrap.account.username}
                                  </button>
                                `
                              : nothing}
                          </div>
                        `
                      : accountProfile
                        ? html`
                            ${accountValidation
                              ? html`<div class="callout danger">${accountValidation}</div>`
                              : nothing}
                            <div class="setup-step__form">
                              <div class="setup-step__dual">
                                <label class="field">
                                  <span>Name</span>
                                  <input
                                    .value=${accountProfile.displayName}
                                    @input=${(event: Event) =>
                                      props.onAccountFieldChange(
                                        "displayName",
                                        (event.target as HTMLInputElement).value,
                                      )}
                                  />
                                </label>
                                <label class="field">
                                  <span>Username</span>
                                  <input
                                    .value=${accountProfile.username}
                                    maxlength=${ALISIO_USERNAME_MAX_LENGTH}
                                    autocapitalize="off"
                                    spellcheck="false"
                                    placeholder="nuno"
                                    @input=${(event: Event) =>
                                      props.onAccountFieldChange(
                                        "username",
                                        (event.target as HTMLInputElement).value,
                                      )}
                                  />
                                </label>
                              </div>
                              <div class="setup-step__hint">
                                Username preview:
                                <strong
                                  >@${normalizeAlisioUsername(accountProfile.username) ||
                                  "username"}</strong
                                >
                                <br />
                                Use ${ALISIO_USERNAME_MIN_LENGTH}-${ALISIO_USERNAME_MAX_LENGTH}
                                characters. Only letters, numbers, dots, and underscores.
                              </div>
                              <label class="field">
                                <span>Email</span>
                                <input
                                  type="email"
                                  .value=${accountProfile.email}
                                  @input=${(event: Event) =>
                                    props.onAccountFieldChange(
                                      "email",
                                      (event.target as HTMLInputElement).value,
                                    )}
                                />
                              </label>
                              <label class="field">
                                <span>Avatar initials</span>
                                <input
                                  .value=${accountProfile.avatarLabel}
                                  maxlength="2"
                                  @input=${(event: Event) =>
                                    props.onAccountFieldChange(
                                      "avatarLabel",
                                      (event.target as HTMLInputElement).value,
                                    )}
                                />
                              </label>
                            </div>
                            <div class="setup-step__actions">
                              <button
                                class="btn primary"
                                ?disabled=${Boolean(accountValidation)}
                                @click=${props.onSaveAccount}
                              >
                                ${accountSession.profileCompleted
                                  ? "Save profile"
                                  : "Finish profile"}
                              </button>
                              ${accountReady
                                ? html`<span class="setup-step__hint"
                                    >You can change this later in Settings.</span
                                  >`
                                : nothing}
                            </div>
                          `
                        : html`<div class="callout info">
                            Connect Alisio first so it can load your local profile.
                          </div>`}
              </div>
            </article>

            <article
              id="setup-step-runtime"
              class="setup-step card ${focusedStep === "runtime" ? "setup-step--focus" : ""}"
            >
              <div class="setup-step__head">
                <div>
                  <div class="setup-step__kicker">
                    Step ${stepNumber("runtime", props.connected, showGatewayStep)}
                  </div>
                  <h2>Connect your AI</h2>
                  <p>
                    Use OpenAI as the default intelligence for Alisio, then change it later if
                    needed.
                  </p>
                </div>
                <span class="setup-status setup-status--${runtimeStatus}"
                  >${setupStatusLabel(runtimeStatus)}</span
                >
              </div>
              <div class="setup-step__body">
                ${props.bootstrapLoading && !bootstrap
                  ? html`<div class="empty-state">Loading runtime status…</div>`
                  : renderWizardStep(props)}
              </div>
            </article>
          </div>
        </section>

        <section class="setup-section">
          <div class="setup-section__head">
            <div>
              <div class="setup-section__kicker">After the first chat</div>
              <h2>Everything else can wait</h2>
              <p>Add apps, team features, and native permissions only when they become useful.</p>
            </div>
          </div>
          <div class="setup-grid setup-grid--compact">
            <article class="setup-mini-card card">
              <div class="setup-mini-card__kicker">Tools</div>
              <h3>Connect apps when you actually need them</h3>
              <p>
                ${props.connectorsLoading
                  ? "Loading your tools…"
                  : `${connectedAuthorizations.length} connected now · ${featuredConnectors.length} good starting points`}
              </p>
              <button class="btn" @click=${props.onOpenAuthentications}>
                Open authentications
              </button>
            </article>
            <article class="setup-mini-card card">
              <div class="setup-mini-card__kicker">Organization</div>
              <h3>Keep this personal for now</h3>
              <p>
                Organizations are useful later if you want shared work. They should not slow down
                the first setup.
              </p>
            </article>
            <article class="setup-mini-card card">
              <div class="setup-mini-card__kicker">Mac features</div>
              <h3>Grant permissions only when you need them</h3>
              <p>
                ${props.nativeShellState
                  ? `${permissionState.granted}/${permissionState.total} permissions granted on ${props.nativeShellState.platform}.`
                  : "Browser mode keeps native permissions out of the way."}
              </p>
              ${props.nativeShellState
                ? html`<button class="btn" @click=${props.onOpenSettingsMac}>
                    Open Mac settings
                  </button>`
                : nothing}
            </article>
          </div>
        </section>
      </div>
    </section>
  `;
}
