import { html, nothing } from "lit";
import {
  ALISIO_USERNAME_MAX_LENGTH,
  ALISIO_USERNAME_MIN_LENGTH,
  validateAlisioEmail,
  validateAlisioAccountDraft,
} from "../../../../src/shared/alisio-account.js";
import { summarizeAlisioConnectorUiStatuses } from "../../../../src/shared/alisio-connector-status.js";
import { t } from "../../i18n/index.ts";
import {
  isPostReadySetupStep,
  resolveCurrentStartupState,
  resolveDisplayedSetupStep,
} from "../alisio-setup-state.ts";
import type {
  AlisioAccountState,
  AlisioBootstrapState,
  AlisioBootstrapStep,
  AlisioConnectorsBeginResult,
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  AlisioDoctorSummaryState,
  AlisioOrganizationMembershipState,
  NativeShellPermission,
  NativeShellState,
  WizardStep,
} from "../types.ts";
import {
  buildConnectorRows,
  connectorStatusHint,
  connectorStatusLabel,
} from "./connector-state.ts";
import { renderOrganization } from "./organization.ts";

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
  setupGuide: AlisioConnectorsBeginResult | null;
  accountLoading: boolean;
  accountError: string | null;
  accountNotice: string | null;
  account: AlisioAccountState | null;
  authMode: "sign-up" | "sign-in";
  authEmail: string;
  authPassword: string;
  aiLoading: boolean;
  aiError: string | null;
  connectorsSearch: string;
  connectorsCategoryFilter: string;
  onConnectorsSearchChange: (value: string) => void;
  onConnectorsCategoryChange: (value: string) => void;
  onDismissSetupGuide: () => void;
  onOpenSupportUrl: (url: string) => void;
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
  onOpenChannels: () => void;
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
  return resolveCurrentStartupState({
    bootstrap: props.bootstrap,
    startupBootstrap: props.startupBootstrap,
  });
}

function currentAiStatus(props: SetupProps) {
  return props.bootstrap?.ai.status ?? props.startupBootstrap?.ai?.status ?? "disconnected";
}

const MAC_PERMISSION_ORDER: readonly NativeShellPermission[] = [
  "notifications",
  "appleScript",
  "accessibility",
  "screenRecording",
  "microphone",
  "speechRecognition",
  "camera",
  "location",
];

function setupStepLabel(step: AlisioBootstrapStep | null) {
  switch (step) {
    case "gateway":
      return t("alisio.setup.steps.gateway");
    case "account":
      return t("alisio.setup.steps.account");
    case "runtime":
      return t("alisio.setup.steps.runtime");
    case "organization":
      return t("alisio.setup.steps.organization");
    case "connectors":
      return t("alisio.setup.steps.connectors");
    case "permissions":
      return t("alisio.setup.steps.permissions");
    case "ready":
      return t("alisio.setup.steps.ready");
    default:
      return t("alisio.setup.steps.setup");
  }
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
  if (props.account?.session.state === "signed_in" && !props.account.session.profileCompleted) {
    return renderProfileStep(props);
  }
  const authMode = props.authMode ?? "sign-up";
  const authEmail = props.authEmail ?? "";
  const authPassword = props.authPassword ?? "";
  const emailError = validateAlisioEmail(authEmail);
  const suggestedEmail =
    props.account?.profile.email ?? props.startupBootstrap?.account?.email ?? "";
  const canSubmit = props.connected && !emailError && authPassword.trim().length > 0;
  const submitBlocker = !props.connected
    ? t("alisio.setup.account.waitForConnection")
    : authEmail.trim().length === 0
      ? t("alisio.setup.account.enterEmail")
      : emailError
        ? t("alisio.setup.account.validEmail")
        : authPassword.trim().length === 0
          ? t("alisio.setup.account.enterPassword")
          : null;
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">
        ${authMode === "sign-up"
          ? t("alisio.setup.account.createTitle")
          : t("alisio.setup.account.signInTitle")}
      </div>
      <div class="card-sub">${t("alisio.setup.account.subtitle")}</div>
      ${suggestedEmail && !authEmail.trim()
        ? html`
            <div class="callout info">
              ${t("alisio.setup.account.savedAccount", { email: suggestedEmail })}
            </div>
          `
        : nothing}
      ${renderCallout("danger", props.accountError)}
      ${authEmail.trim() && emailError
        ? html`<div class="callout danger">${emailError}</div>`
        : nothing}
      ${renderCallout("info", props.accountNotice)}
      ${!props.connected
        ? html` <div class="callout info">${t("alisio.setup.account.autoConnectHint")}</div> `
        : nothing}
      <div class="row" style="margin-top: 16px;">
        <button
          class="chip ${authMode === "sign-up" ? "chip-active" : ""}"
          @click=${() => props.onAuthModeChange("sign-up")}
        >
          ${t("alisio.setup.account.createTab")}
        </button>
        <button
          class="chip ${authMode === "sign-in" ? "chip-active" : ""}"
          @click=${() => props.onAuthModeChange("sign-in")}
        >
          ${t("alisio.setup.account.signInTab")}
        </button>
      </div>
      <div class="alisio-settings-form" style="margin-top: 16px;">
        <label class="field">
          <span>${t("alisio.setup.account.email")}</span>
          <input
            type="email"
            autocomplete="email"
            placeholder=${t("alisio.setup.account.emailPlaceholder")}
            .value=${authEmail}
            @input=${(event: Event) =>
              props.onAuthEmailChange((event.target as HTMLInputElement).value)}
          />
          <small class="field-note">${t("alisio.setup.account.emailNote")}</small>
        </label>
        <label class="field">
          <span>${t("alisio.setup.account.password")}</span>
          <input
            type="password"
            autocomplete=${authMode === "sign-up" ? "new-password" : "current-password"}
            placeholder=${authMode === "sign-up"
              ? t("alisio.setup.account.createPasswordPlaceholder")
              : t("alisio.setup.account.passwordPlaceholder")}
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
                ${props.startupLoading
                  ? t("alisio.setup.account.connecting")
                  : t("alisio.setup.gateway.reconnect")}
              </button>
            `
          : nothing}
        <button
          class="btn primary"
          ?disabled=${props.accountLoading || !canSubmit}
          @click=${authMode === "sign-up" ? props.onSignUpAccount : props.onSignInAccount}
        >
          ${props.accountLoading
            ? t("alisio.setup.account.working")
            : authMode === "sign-up"
              ? (submitBlocker ?? t("alisio.setup.account.createAction"))
              : (submitBlocker ?? t("alisio.setup.account.signInAction"))}
        </button>
        ${authMode === "sign-in"
          ? html`
              <button
                class="btn"
                ?disabled=${props.accountLoading || !authEmail.trim() || Boolean(emailError)}
                @click=${props.onRequestPasswordReset}
              >
                ${t("alisio.setup.account.resetPassword")}
              </button>
            `
          : nothing}
      </div>
    </section>
  `;
}

function renderGatewayStep(props: SetupProps) {
  const savedEmail = props.account?.profile.email ?? props.startupBootstrap?.account?.email ?? "";
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">${t("alisio.setup.gateway.title")}</div>
      <div class="card-sub">${t("alisio.setup.gateway.subtitle")}</div>
      ${savedEmail
        ? html`
            <div class="callout info" style="margin-top: 16px;">
              ${t("alisio.setup.gateway.savedAccount", { email: savedEmail })}
            </div>
          `
        : nothing}
      ${renderCallout("danger", props.startupError ?? props.lastError)}
      <div class="row" style="margin-top: 16px;">
        <button class="btn primary" ?disabled=${props.startupLoading} @click=${props.onConnect}>
          ${props.startupLoading
            ? t("alisio.setup.account.connecting")
            : t("alisio.setup.gateway.reconnect")}
        </button>
      </div>
    </section>
  `;
}

function renderProfileStep(props: SetupProps) {
  const profile = props.account?.profile;
  const validation = accountValidationMessage(props);
  const emailManagedByCloud = props.account?.session.backend === "supabase";
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">${t("alisio.setup.profile.title")}</div>
      <div class="card-sub">${t("alisio.setup.profile.subtitle")}</div>
      ${renderCallout("danger", props.accountError ?? validation)}
      <div class="alisio-settings-form" style="margin-top: 16px;">
        <label class="field">
          <span>${t("alisio.setup.profile.name")}</span>
          <input
            type="text"
            .value=${profile?.displayName ?? ""}
            @input=${(event: Event) =>
              props.onAccountFieldChange("displayName", (event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>${t("alisio.setup.profile.username")}</span>
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
          <span>${t("alisio.setup.profile.email")}</span>
          <input
            type="email"
            .value=${profile?.email ?? props.authEmail}
            ?disabled=${emailManagedByCloud}
            @input=${(event: Event) =>
              props.onAccountFieldChange("email", (event.target as HTMLInputElement).value)}
          />
          ${emailManagedByCloud
            ? html`
                <small class="field-note">${t("alisio.setup.profile.emailManagedByCloud")}</small>
              `
            : nothing}
        </label>
        <label class="field">
          <span>${t("alisio.setup.profile.avatar")}</span>
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
          ${t("alisio.setup.profile.save")}
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
      <div class="card-title">${t("alisio.setup.runtime.title")}</div>
      <div class="card-sub">${t("alisio.setup.runtime.subtitle")}</div>
      ${renderCallout("danger", props.aiError ?? props.bootstrapError)}
      <div class="list-item" style="margin-top: 16px;">
        <div class="list-title">
          ${isAiReady(currentAiStatus(props))
            ? t("alisio.setup.runtime.connected")
            : t("alisio.setup.runtime.notConnected")}
        </div>
        <div class="list-sub">${ai?.email ?? t("alisio.setup.runtime.noAccount")}</div>
      </div>
      ${windows.length > 0
        ? html`
            <div style="display: grid; gap: 12px; margin-top: 16px;">
              ${windows.map(
                (window) => html`
                  <div class="list-item">
                    <div class="list-title">${window.label}</div>
                    <div class="list-sub">
                      ${t("alisio.setup.runtime.percentUsed", {
                        value: String(window.usedPercent),
                      })}
                    </div>
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
                ${t("alisio.setup.runtime.refresh")}
              </button>
              <button
                class="btn danger"
                ?disabled=${props.aiLoading}
                @click=${props.onDisconnectAi}
              >
                ${t("alisio.setup.runtime.disconnect")}
              </button>
            `
          : html`
              <button
                class="btn primary"
                ?disabled=${props.aiLoading}
                @click=${props.onBeginAiConnect}
              >
                ${props.aiLoading
                  ? t("alisio.setup.runtime.opening")
                  : t("alisio.setup.runtime.connect")}
              </button>
            `}
      </div>
    </section>
  `;
}

function permissionLabel(permission: NativeShellPermission) {
  switch (permission) {
    case "notifications":
      return t("alisio.settings.mac.permissions.notifications");
    case "appleScript":
      return t("alisio.settings.mac.permissions.appleScript");
    case "accessibility":
      return t("alisio.settings.mac.permissions.accessibility");
    case "screenRecording":
      return t("alisio.settings.mac.permissions.screenRecording");
    case "microphone":
      return t("alisio.settings.mac.permissions.microphone");
    case "speechRecognition":
      return t("alisio.settings.mac.permissions.speechRecognition");
    case "camera":
      return t("alisio.settings.mac.permissions.camera");
    case "location":
      return t("alisio.settings.mac.permissions.location");
  }
}

function renderPermissionsStep(props: SetupProps) {
  const state = props.nativeShellState;
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">${t("alisio.setup.permissions.title")}</div>
      <div class="card-sub">${t("alisio.setup.permissions.subtitle")}</div>
      ${renderCallout("danger", props.nativeShellError)}
      ${props.nativeShellLoading
        ? html`
            <div class="empty-state" style="margin-top: 16px;">
              ${t("alisio.setup.permissions.loading")}
            </div>
          `
        : !state
          ? html`
              <div class="callout info" style="margin-top: 16px;">
                ${t("alisio.setup.permissions.unavailable")}
              </div>
            `
          : html`
              <div class="agent-kv" style="margin-top: 16px;">
                <div class="label">${t("alisio.settings.mac.launchAtLogin")}</div>
                <div>
                  ${state.launchAtLogin
                    ? t("alisio.settings.mac.enabled")
                    : t("alisio.settings.mac.disabled")}
                </div>
                <div class="row" style="margin-top: 10px;">
                  <button
                    class="btn"
                    @click=${() => props.onSetLaunchAtLogin(!state.launchAtLogin)}
                  >
                    ${state.launchAtLogin
                      ? t("alisio.setup.permissions.disableLaunch")
                      : t("alisio.setup.permissions.enableLaunch")}
                  </button>
                </div>
              </div>
              <div style="display: grid; gap: 12px; margin-top: 16px;">
                ${MAC_PERMISSION_ORDER.map(
                  (permission) => html`
                    <div class="list-item">
                      <div class="list-title">${permissionLabel(permission)}</div>
                      <div class="list-sub">
                        ${state.permissions[permission]
                          ? t("alisio.settings.mac.granted")
                          : t("alisio.settings.mac.needsApproval")}
                      </div>
                      ${state.permissions[permission]
                        ? nothing
                        : html`
                            <div class="row" style="margin-top: 8px;">
                              <button
                                class="btn btn--sm"
                                @click=${() => props.onRequestPermission(permission)}
                              >
                                ${t("alisio.settings.mac.request")}
                              </button>
                            </div>
                          `}
                    </div>
                  `,
                )}
              </div>
              <div class="row" style="margin-top: 16px;">
                <button class="btn" @click=${props.onOpenSettingsMac}>
                  ${t("alisio.setup.permissions.openSettings")}
                </button>
              </div>
            `}
    </section>
  `;
}

function renderConnectorSetupGuide(props: SetupProps) {
  const guide = props.setupGuide;
  if (!guide) {
    return nothing;
  }

  const title =
    guide.statusReason === "review_required"
      ? t("alisio.authentications.setupGuide.reviewTitle")
      : guide.statusReason === "unavailable"
        ? t("alisio.authentications.setupGuide.unavailableTitle")
        : guide.statusReason === "missing_token_encryption"
          ? t("alisio.authentications.setupGuide.missingTokenEncryptionTitle")
          : t("alisio.authentications.setupGuide.missingConfigTitle");

  const body =
    guide.statusReason === "review_required"
      ? t("alisio.authentications.setupGuide.reviewBody")
      : guide.statusReason === "unavailable"
        ? t("alisio.authentications.setupGuide.unavailableBody")
        : guide.statusReason === "missing_token_encryption"
          ? t("alisio.authentications.setupGuide.missingTokenEncryptionBody")
          : t("alisio.authentications.setupGuide.missingConfigBody");

  const callbackValue = guide.redirectUri?.trim() || guide.callbackPath?.trim() || null;

  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">${title}</div>
      <div class="card-sub">${body}</div>
      ${guide.providerLabel
        ? html`
            <div class="row" style="margin-top: 16px;">
              ${renderStatusPill(guide.providerLabel)}
              ${guide.connectorId ? renderStatusPill(guide.connectorId, "warn") : nothing}
            </div>
          `
        : nothing}
      ${Array.isArray(guide.requiredEnvVars) && guide.requiredEnvVars.length > 0
        ? html`
            <div class="agent-kv" style="margin-top: 16px;">
              <div class="label">${t("alisio.authentications.setupGuide.envVars")}</div>
              <div class="mono">${guide.requiredEnvVars.join("\n")}</div>
            </div>
          `
        : nothing}
      ${callbackValue
        ? html`
            <div class="agent-kv" style="margin-top: 16px;">
              <div class="label">${t("alisio.authentications.setupGuide.callback")}</div>
              <div class="mono">${callbackValue}</div>
              <div class="agent-kv-sub">${t("alisio.authentications.setupGuide.callbackHint")}</div>
            </div>
          `
        : nothing}
      <div class="row" style="margin-top: 16px;">
        ${guide.setupUrl
          ? html`
              <button class="btn" @click=${() => props.onOpenSupportUrl(guide.setupUrl!)}>
                ${t("alisio.authentications.setupGuide.support")}
              </button>
            `
          : nothing}
        <button class="btn" @click=${props.onDismissSetupGuide}>
          ${t("alisio.authentications.setupGuide.dismiss")}
        </button>
      </div>
    </section>
  `;
}

function renderConnectorsStep(props: SetupProps) {
  const connectorRows = buildConnectorRows(props.connectorCatalog, props.connectorAuthorizations);
  const connectorSummary = summarizeAlisioConnectorUiStatuses({
    definitions: props.connectorCatalog,
    authorizations: props.connectorAuthorizations,
  });
  const visibleRows = connectorRows.filter(
    (row) =>
      row.status === "ready" ||
      row.status === "needs_reconnect" ||
      row.status === "connected" ||
      row.status === "setup_required",
  );

  return html`
    ${renderConnectorSetupGuide(props)}
    <section class="card alisio-setup-card">
      <div class="card-title">${t("alisio.setup.steps.connectors")}</div>
      <div class="card-sub">${t("alisio.authentications.subtitle")}</div>
      ${renderCallout("danger", props.connectorsError)}
      <div
        style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-top: 16px;"
      >
        <article class="list-item">
          <div class="list-title">${connectorSummary.connected}</div>
          <div class="list-sub">${t("alisio.authentications.summary.connected")}</div>
        </article>
        <article class="list-item">
          <div class="list-title">${connectorSummary.ready}</div>
          <div class="list-sub">${t("alisio.authentications.summary.ready")}</div>
        </article>
        <article class="list-item">
          <div class="list-title">${connectorSummary.needsReconnect}</div>
          <div class="list-sub">${t("alisio.authentications.summary.attention")}</div>
        </article>
      </div>
      ${props.connectorsLoading
        ? html`
            <div class="empty-state" style="margin-top: 16px;">
              ${t("alisio.authentications.loading")}
            </div>
          `
        : visibleRows.length === 0
          ? html`
              <div class="callout info" style="margin-top: 16px;">
                ${t("alisio.authentications.emptyAuthorized")}
              </div>
            `
          : html`
              <div style="display: grid; gap: 12px; margin-top: 16px;">
                ${visibleRows.map(
                  (row) => html`
                    <article class="list-item">
                      <div
                        class="row"
                        style="justify-content: space-between; align-items: flex-start; gap: 12px;"
                      >
                        <div>
                          <div class="list-title">${row.definition.title}</div>
                          <div class="list-sub">${row.definition.summary}</div>
                          <div class="muted" style="margin-top: 8px;">
                            ${connectorStatusHint(row.status)}
                          </div>
                        </div>
                        <span class="pill">${connectorStatusLabel(row.status)}</span>
                      </div>
                      <div class="row" style="margin-top: 12px;">
                        ${row.status === "connected"
                          ? html`
                              <button
                                class="btn danger"
                                @click=${() => props.onRevokeConnector(row.definition.id)}
                              >
                                ${t("alisio.authentications.actions.revoke")}
                              </button>
                            `
                          : html`
                              <button
                                class="btn primary"
                                @click=${() => props.onBeginConnector(row.definition.id)}
                              >
                                ${row.status === "setup_required"
                                  ? t("alisio.authentications.actions.reviewSetup")
                                  : row.status === "needs_reconnect"
                                    ? t("alisio.authentications.actions.reconnect")
                                    : row.definition.connectLabel}
                              </button>
                            `}
                      </div>
                    </article>
                  `,
                )}
              </div>
            `}
    </section>
  `;
}

function renderOrganizationStep(props: SetupProps) {
  return renderOrganization({
    loading: props.organizationLoading,
    error: props.organizationError,
    organization: props.organization,
    draftMode: props.organizationDraftMode,
    organizationName: props.organizationName,
    inviteEmail: props.organizationInviteEmail,
    onDraftModeChange: props.onDraftModeChange,
    onOrganizationNameChange: props.onOrganizationNameChange,
    onInviteEmailChange: props.onInviteEmailChange,
    onCreateOrganization: props.onCreateOrganization,
    onJoinOrganization: props.onJoinOrganization,
    onResetOrganization: props.onResetOrganization,
  });
}

function renderReadyStep(props: SetupProps) {
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">${t("alisio.setup.ready.title")}</div>
      <div class="card-sub">${t("alisio.setup.ready.subtitle")}</div>
      <div class="row" style="margin-top: 16px;">
        <button class="btn primary" @click=${props.onOpenWorkspace}>
          ${t("alisio.setup.ready.startChatting")}
        </button>
        <button class="btn" @click=${props.onOpenChannels}>
          ${t("alisio.setup.ready.connectToolsLater")}
        </button>
        <button class="btn" @click=${props.onOpenSettingsAi}>
          ${t("alisio.setup.ready.aiSettings")}
        </button>
      </div>
    </section>
  `;
}

function renderSetupStep(props: SetupProps, step: AlisioBootstrapStep) {
  switch (step) {
    case "gateway":
      return renderGatewayStep(props);
    case "account":
      return renderAccountStep(props);
    case "runtime":
      return renderAiStep(props);
    case "organization":
      return renderOrganizationStep(props);
    case "connectors":
      return renderConnectorsStep(props);
    case "permissions":
      return renderPermissionsStep(props);
    case "ready":
    default:
      return renderReadyStep(props);
  }
}

export function renderSetup(props: SetupProps) {
  const startupState = currentStartupState(props);
  const aiStatus = currentAiStatus(props);
  const displayStep = resolveDisplayedSetupStep({
    connected: props.connected,
    requestedStep: props.requestedStep,
    bootstrap: props.bootstrap,
    startupBootstrap: props.startupBootstrap,
  });
  const ready =
    startupState === "ready" &&
    isAiReady(aiStatus) &&
    (displayStep === "ready" || isPostReadySetupStep(displayStep));
  const showGlobalCallout =
    !props.connected && displayStep !== "gateway" && (props.lastError || props.startupError);
  const progressLabel =
    displayStep === "account"
      ? t("alisio.setup.progress.oneOfThree")
      : displayStep === "runtime"
        ? t("alisio.setup.progress.twoOfThree")
        : displayStep === "ready"
          ? t("alisio.setup.steps.ready")
          : setupStepLabel(displayStep);

  return html`
    <section class="alisio-setup-page">
      <div class="alisio-setup-page__hero">
        <div class="alisio-page__eyebrow">${t("alisio.setup.hero.eyebrow")}</div>
        <h1>${t("alisio.setup.hero.title")}</h1>
        <p>${t("alisio.setup.hero.subtitle")}</p>
        <div class="alisio-setup-page__progress">
          <span class="alisio-setup-page__progress-pill">${progressLabel}</span>
          ${renderStatusPill(setupStepLabel(displayStep), ready ? "ok" : "warn")}
        </div>
      </div>

      <div class="alisio-setup-page__card">
        <div class="alisio-setup-minimal__stack">
          ${showGlobalCallout
            ? html`<div class="callout danger">${props.lastError ?? props.startupError}</div>`
            : nothing}
          ${renderSetupStep(props, displayStep)}
        </div>
      </div>
    </section>
  `;
}
