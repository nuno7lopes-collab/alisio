import { html, nothing } from "lit";
import {
  validateAlisioEmail,
  validateAlisioAccountDraft,
} from "../../../../src/shared/alisio-account.js";
import {
  alisioConnectorLimit,
  alisioConnectorUpgradeMessage,
  countAlisioConnectorPlanSlots,
  normalizeAlisioPlan,
} from "../../../../src/shared/alisio-billing.js";
import { summarizeAlisioConnectorUiStatuses } from "../../../../src/shared/alisio-connector-status.js";
import { t } from "../../i18n/index.ts";
import {
  isPostReadySetupStep,
  resolveCurrentStartupState,
  resolveDisplayedSetupStep,
} from "../alisio-setup-state.ts";
import { alisioSetupStepLabel } from "../alisio-setup-step-label.ts";
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
import { type AccountProfileField, renderAccountProfileFields } from "./account-profile-fields.ts";
import {
  buildConnectorRows,
  connectorStatusHint,
  connectorStatusLabel,
} from "./connector-state.ts";
import { renderSkeletonListItem, renderSkeletonStatCards } from "./loading-skeleton.ts";
import {
  nativeShellPermissionDescription,
  nativeShellPermissionLabel,
  NATIVE_SHELL_PERMISSION_ORDER,
} from "./native-shell-permissions.ts";
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
  authEmail: string;
  authPendingEmail: string;
  authCode: string;
  authStage: "entry" | "email-code";
  passwordResetRequired: boolean;
  termsAccepted: boolean;
  marketingOptIn: boolean;
  birthdate: string;
  aiLoading: boolean;
  aiError: string | null;
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
  onAuthEmailChange: (value: string) => void;
  onAuthPendingEmailChange: (value: string) => void;
  onAuthCodeChange: (value: string) => void;
  onAuthStageChange: (value: "entry" | "email-code") => void;
  onTermsAcceptedChange: (value: boolean) => void;
  onMarketingOptInChange: (value: boolean) => void;
  onBirthdateChange: (value: string) => void;
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
  onAccountFieldChange: (field: AccountProfileField, value: string) => void;
  onBeginEmailAuth: () => void;
  onVerifyEmailAuth: () => void;
  onBeginGoogleAuth: () => void;
  onBeginAiConnect: () => void;
  onDisconnectAi: () => void;
  onRefreshAi: () => void;
  onSaveAccount: () => void;
  onUpdatePassword: (password: string) => void;
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

function currentAccountCloudState(props: SetupProps) {
  return props.account?.cloud ?? props.startupBootstrap?.accountCloud ?? null;
}

function currentSetupProfile(props: SetupProps) {
  if (props.account?.profile) {
    return props.account.profile;
  }
  const startupAccount = props.startupBootstrap?.account;
  if (!startupAccount) {
    return null;
  }
  return {
    username: startupAccount.username,
    displayName: startupAccount.displayName,
    email: startupAccount.email,
    agentName: startupAccount.agentName,
    avatarLabel: startupAccount.avatarLabel,
    birthdate: undefined,
    plan: startupAccount.plan,
  };
}

function accountValidationMessage(props: SetupProps) {
  const profile = currentSetupProfile(props);
  if (!profile) {
    return null;
  }
  return validateAlisioAccountDraft({
    username: profile.username,
    displayName: profile.displayName,
    email: profile.email,
    agentName: profile.agentName,
    avatarLabel: profile.avatarLabel,
    birthdate: profile.birthdate,
  });
}

function renderSetupCardHeader(title: string, subtitle?: string | null) {
  return html`
    <div class="alisio-setup-card__header">
      <div class="alisio-setup-card__intro">
        <div class="card-title">${title}</div>
        ${subtitle ? html`<div class="card-sub">${subtitle}</div>` : nothing}
      </div>
    </div>
  `;
}

function renderAccountStep(props: SetupProps) {
  if (props.passwordResetRequired) {
    const resetEmail = props.account?.profile.email ?? props.authPendingEmail.trim();
    const handlePasswordResetSubmit = (event: Event) => {
      event.preventDefault();
      if (props.accountLoading) {
        return;
      }
      const form = event.currentTarget as HTMLFormElement;
      const passwordInput = form.elements.namedItem("alisio-reset-password");
      const password = passwordInput instanceof HTMLInputElement ? passwordInput.value : "";
      if (!form.reportValidity()) {
        return;
      }
      props.onUpdatePassword(password);
    };
    return html`
      <section class="card alisio-setup-card">
        ${renderSetupCardHeader(
          t("alisio.setup.account.resetTitle"),
          t("alisio.setup.account.resetSubtitle", {
            email: resetEmail || t("alisio.setup.account.resetSubjectFallback"),
          }),
        )}
        ${props.accountError
          ? html`<div class="callout danger">${props.accountError}</div>`
          : props.accountNotice
            ? html`<div class="callout info">${props.accountNotice}</div>`
            : nothing}
        <form class="alisio-setup-account" @submit=${handlePasswordResetSubmit}>
          <fieldset
            class="form-fieldset-reset alisio-setup-account__fields"
            ?disabled=${props.accountLoading}
          >
            <label class="field">
              <span>${t("alisio.setup.account.resetPassword")}</span>
              <input
                name="alisio-reset-password"
                type="password"
                autocomplete="new-password"
                minlength="8"
                required
                enterkeyhint="go"
                placeholder="********"
              />
              <small class="field-note">${t("alisio.setup.account.resetPasswordHint")}</small>
            </label>
          </fieldset>
          <div class="alisio-setup-actions">
            <button class="btn primary" type="submit" ?disabled=${props.accountLoading}>
              ${props.accountLoading
                ? t("alisio.setup.account.working")
                : t("alisio.setup.account.resetSave")}
            </button>
          </div>
        </form>
      </section>
    `;
  }
  if (props.account?.session.state === "signed_in" && !props.account.session.profileCompleted) {
    return renderProfileStep(props);
  }
  const authEmail = props.authEmail;
  const authPendingEmail = props.authPendingEmail.trim() || authEmail;
  const authCode = props.authCode;
  const emailError = validateAlisioEmail(authEmail);
  const suggestedEmail =
    props.account?.profile.email ?? props.startupBootstrap?.account?.email ?? "";
  const isEmailCodeStage = props.authStage === "email-code";
  const canBeginEmail = props.connected && !emailError;
  const canVerifyEmail = props.connected && authCode.trim().length > 0;
  const statusMessage =
    props.accountError ??
    props.accountNotice ??
    (!props.connected ? t("alisio.setup.account.waitForConnection") : null);
  const cloudState = currentAccountCloudState(props);
  const cloudUnavailable = cloudState?.available === false;
  const handleEntrySubmit = (event: Event) => {
    event.preventDefault();
    if (props.accountLoading || !canBeginEmail) {
      return;
    }
    props.onBeginEmailAuth();
  };
  const handleCodeSubmit = (event: Event) => {
    event.preventDefault();
    if (props.accountLoading || !canVerifyEmail) {
      return;
    }
    props.onVerifyEmailAuth();
  };
  if (cloudUnavailable && props.account?.session.state !== "signed_in") {
    return html`
      <section class="card alisio-setup-card">
        <div class="card-title">${t("alisio.setup.account.title")}</div>
        <div class="card-sub">${t("alisio.settings.account.localModeNotice")}</div>
        <div class="callout danger">${t("alisio.setup.profile.localModeNotice")}</div>
        ${cloudState?.missingEnvVars?.length
          ? html`
              <div class="agent-kv" style="margin-top: 16px;">
                <div class="label">Required cloud env vars</div>
                <div class="mono">${cloudState.missingEnvVars.join("\n")}</div>
              </div>
            `
          : nothing}
        ${!props.connected
          ? html`
              <div class="row" style="margin-top: 16px;">
                <button class="btn" ?disabled=${props.startupLoading} @click=${props.onConnect}>
                  ${props.startupLoading
                    ? t("alisio.setup.account.connecting")
                    : t("alisio.setup.gateway.reconnect")}
                </button>
              </div>
            `
          : nothing}
      </section>
    `;
  }
  return html`
    <section class="card alisio-setup-card">
      ${renderSetupCardHeader(
        isEmailCodeStage ? t("alisio.setup.account.verifyTitle") : t("alisio.setup.account.title"),
        isEmailCodeStage ? null : t("alisio.setup.account.subtitle"),
      )}
      ${statusMessage
        ? html`
            <div class="callout ${props.accountError ? "danger" : "info"}">${statusMessage}</div>
          `
        : nothing}
      ${isEmailCodeStage
        ? html`
            <form class="alisio-setup-account" @submit=${handleCodeSubmit}>
              <div class="alisio-setup-account__inline-row">
                <div class="alisio-setup-account__recipient">
                  <span class="pill">${authPendingEmail}</span>
                </div>
                <button
                  type="button"
                  class="btn btn--sm"
                  @click=${() => props.onAuthStageChange("entry")}
                >
                  ${t("alisio.setup.account.useAnotherEmail")}
                </button>
              </div>
              <div class="alisio-setup-surface-card">
                <fieldset
                  class="form-fieldset-reset alisio-setup-account__fields"
                  ?disabled=${props.accountLoading}
                >
                  <label class="field">
                    <span>${t("alisio.setup.account.code")}</span>
                    <input
                      class="alisio-setup-account__code-input"
                      type="text"
                      autocomplete="one-time-code"
                      autocapitalize="characters"
                      spellcheck="false"
                      inputmode="numeric"
                      enterkeyhint="go"
                      maxlength="6"
                      placeholder=${t("alisio.setup.account.codePlaceholder")}
                      .value=${authCode}
                      @input=${(event: Event) =>
                        props.onAuthCodeChange((event.target as HTMLInputElement).value)}
                    />
                    <small class="field-note">${t("alisio.setup.account.codeNote")}</small>
                  </label>
                </fieldset>
              </div>
              <div class="alisio-setup-actions">
                <button
                  class="btn primary"
                  type="submit"
                  ?disabled=${props.accountLoading || !canVerifyEmail}
                >
                  ${props.accountLoading
                    ? t("alisio.setup.account.working")
                    : t("alisio.setup.account.verifyAction")}
                </button>
                <button
                  type="button"
                  class="btn"
                  ?disabled=${props.accountLoading}
                  @click=${props.onBeginEmailAuth}
                >
                  ${t("alisio.setup.account.resendAction")}
                </button>
              </div>
            </form>
          `
        : html`
            <div class="alisio-setup-account-shell">
              <div class="alisio-setup-surface-card">
                <button
                  type="button"
                  class="btn alisio-setup-account__method-btn"
                  ?disabled=${props.accountLoading || !props.connected}
                  @click=${props.onBeginGoogleAuth}
                >
                  <span class="alisio-setup-account__method-copy">
                    <span class="alisio-setup-account__method-label">Google</span>
                    <span class="alisio-setup-account__method-title">
                      ${t("alisio.setup.account.googleAction")}
                    </span>
                  </span>
                </button>
              </div>
              <div class="alisio-setup-account__divider">
                <span>${t("alisio.setup.account.or")}</span>
              </div>
              <form class="alisio-setup-account" @submit=${handleEntrySubmit}>
                <div class="alisio-setup-surface-card">
                  <fieldset
                    class="form-fieldset-reset alisio-setup-account__fields"
                    ?disabled=${props.accountLoading}
                  >
                    <label class="field">
                      <span>${t("alisio.setup.account.email")}</span>
                      <input
                        type="email"
                        autocomplete="email"
                        autocapitalize="none"
                        spellcheck="false"
                        inputmode="email"
                        enterkeyhint="go"
                        aria-invalid=${authEmail.trim() && emailError ? "true" : "false"}
                        placeholder=${t("alisio.setup.account.emailPlaceholder")}
                        .value=${authEmail}
                        @input=${(event: Event) =>
                          props.onAuthEmailChange((event.target as HTMLInputElement).value)}
                      />
                      ${suggestedEmail && !authEmail.trim()
                        ? html`
                            <small class="field-note">
                              ${t("alisio.setup.account.savedAccount", { email: suggestedEmail })}
                            </small>
                          `
                        : html`
                            <small class="field-note">${t("alisio.setup.account.emailNote")}</small>
                          `}
                      ${authEmail.trim() && emailError
                        ? html`<small class="field-note field-note--danger">${emailError}</small>`
                        : nothing}
                    </label>
                  </fieldset>
                </div>
                <div class="alisio-setup-actions">
                  ${!props.connected
                    ? html`
                        <button
                          type="button"
                          class="btn"
                          ?disabled=${props.startupLoading}
                          @click=${props.onConnect}
                        >
                          ${props.startupLoading
                            ? t("alisio.setup.account.connecting")
                            : t("alisio.setup.gateway.reconnect")}
                        </button>
                      `
                    : nothing}
                  <button
                    class="btn primary"
                    type="submit"
                    ?disabled=${props.accountLoading || !canBeginEmail}
                  >
                    ${props.accountLoading
                      ? t("alisio.setup.account.working")
                      : t("alisio.setup.account.emailAction")}
                  </button>
                </div>
              </form>
            </div>
          `}
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
  const profile = currentSetupProfile(props);
  const validation = accountValidationMessage(props);
  const missingTerms = !props.termsAccepted;
  const emailManagedByCloud = props.account?.session.backend === "supabase";
  const authMethodLabel =
    props.account?.session.authMethod === "google"
      ? t("alisio.setup.profile.authMethodGoogle")
      : t("alisio.setup.profile.authMethodEmail");
  const profileMessage =
    props.accountError ??
    validation ??
    (missingTerms ? t("alisio.setup.profile.acceptTermsRequired") : null);
  const profileSubtitle = t("alisio.setup.profile.subtitle");
  const emailFallback = profile?.email ?? props.authEmail;
  const identityChip = profile?.email ?? (props.authPendingEmail || emailFallback || "");
  const handleSubmit = (event: Event) => {
    event.preventDefault();
    if (props.accountLoading || validation || missingTerms) {
      return;
    }
    props.onSaveAccount();
  };
  return html`
    <section class="card alisio-setup-card">
      ${renderSetupCardHeader(t("alisio.setup.profile.title"), profileSubtitle)}
      <div class="alisio-setup-account__inline-row">
        ${identityChip ? html`<span class="chip">${identityChip}</span>` : nothing}
        <span class="chip">${authMethodLabel}</span>
      </div>
      ${renderCallout("danger", profileMessage)}
      <form class="alisio-setup-account" @submit=${handleSubmit}>
        <fieldset
          class="form-fieldset-reset alisio-setup-account__fields"
          ?disabled=${props.accountLoading}
        >
          ${renderAccountProfileFields({
            profile: profile ?? null,
            emailFallback,
            emailManagedByCloud,
            mode: "live",
            labels: {
              displayName: t("alisio.setup.profile.name"),
              agentName: t("alisio.setup.profile.agentName"),
              username: t("alisio.setup.profile.username"),
              email: t("alisio.setup.profile.email"),
              avatarLabel: t("alisio.setup.profile.avatar"),
              emailManagedByCloud: t("alisio.setup.profile.emailManagedByCloud"),
            },
            onFieldChange: props.onAccountFieldChange,
          })}
          <label class="field">
            <span>${t("alisio.setup.profile.birthdate")}</span>
            <input
              type="date"
              autocomplete="bday"
              .value=${props.birthdate}
              @input=${(event: Event) =>
                props.onBirthdateChange((event.target as HTMLInputElement).value)}
            />
            <small class="field-note">${t("alisio.setup.profile.birthdateHint")}</small>
          </label>
          <div class="alisio-setup-consent">
            <label class="alisio-setup-checkbox">
              <input
                type="checkbox"
                .checked=${props.termsAccepted}
                @change=${(event: Event) =>
                  props.onTermsAcceptedChange((event.target as HTMLInputElement).checked)}
              />
              <span>${t("alisio.setup.profile.termsLabel")}</span>
            </label>
            <label class="alisio-setup-checkbox">
              <input
                type="checkbox"
                .checked=${props.marketingOptIn}
                @change=${(event: Event) =>
                  props.onMarketingOptInChange((event.target as HTMLInputElement).checked)}
              />
              <span>${t("alisio.setup.profile.marketingLabel")}</span>
            </label>
          </div>
        </fieldset>
        <div class="alisio-setup-actions">
          <button
            class="btn primary"
            type="submit"
            ?disabled=${props.accountLoading || validation !== null || missingTerms}
          >
            ${props.accountLoading
              ? t("alisio.setup.account.working")
              : t("alisio.setup.profile.save")}
          </button>
        </div>
      </form>
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

function renderPermissionsStep(props: SetupProps) {
  const state = props.nativeShellState;
  const showInitialLoading = props.nativeShellLoading && !state && !props.nativeShellError;
  return html`
    <section class="card alisio-setup-card">
      <div class="card-title">${t("alisio.setup.permissions.title")}</div>
      <div class="card-sub">${t("alisio.setup.permissions.subtitle")}</div>
      ${renderCallout("danger", props.nativeShellError)}
      ${showInitialLoading
        ? html`
            <div role="status" aria-label=${t("alisio.setup.permissions.loading")}>
              <div class="loading-state__list" style="margin-top: 16px;">
                ${renderSkeletonListItem({ lines: ["short", "medium", "short"], aside: "button" })}
                ${renderSkeletonListItem({ lines: ["short", "long"], aside: "button" })}
                ${renderSkeletonListItem({ lines: ["short", "medium"], aside: "button" })}
              </div>
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
                ${NATIVE_SHELL_PERMISSION_ORDER.map(
                  (permission) => html`
                    <div class="list-item">
                      <div
                        class="row"
                        style="justify-content: space-between; align-items: flex-start; gap: 12px;"
                      >
                        <div>
                          <div class="list-title">${nativeShellPermissionLabel(permission)}</div>
                          <div class="list-sub">
                            ${nativeShellPermissionDescription(permission)}
                          </div>
                        </div>
                        ${renderStatusPill(
                          state.permissions[permission]
                            ? t("alisio.settings.mac.granted")
                            : t("alisio.settings.mac.needsApproval"),
                          state.permissions[permission] ? "ok" : "warn",
                        )}
                      </div>
                      ${state.permissions[permission]
                        ? nothing
                        : html`
                            <div class="row" style="margin-top: 12px;">
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
  const currentPlan = normalizeAlisioPlan(
    props.account?.profile.plan ??
      props.bootstrap?.account?.profile.plan ??
      props.startupBootstrap?.account?.plan,
  );
  const connectorLimit = alisioConnectorLimit(currentPlan);
  const occupiedConnectorSlots = countAlisioConnectorPlanSlots(props.connectorAuthorizations);
  const connectorLimitReached = connectorLimit != null && occupiedConnectorSlots >= connectorLimit;
  const connectorLimitMessage = connectorLimitReached
    ? alisioConnectorUpgradeMessage(currentPlan)
    : null;
  const showInitialLoading =
    props.connectorsLoading &&
    props.connectorCatalog.length === 0 &&
    props.connectorAuthorizations.length === 0;
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
      ${renderCallout("info", connectorLimitMessage)}
      <div class="alisio-summary-grid">
        ${showInitialLoading
          ? renderSkeletonStatCards(3)
          : html`
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
            `}
      </div>
      ${showInitialLoading
        ? html`
            <div role="status" aria-label=${t("alisio.authentications.loading")}>
              <div class="loading-state__list" style="margin-top: 16px;">
                ${renderSkeletonListItem({ lines: ["medium", "long", "short"], aside: "pill" })}
                ${renderSkeletonListItem({ lines: ["short", "medium", "short"], aside: "button" })}
                ${renderSkeletonListItem({ lines: ["long", "medium", "short"], aside: "button" })}
              </div>
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
                                ?disabled=${row.status === "ready" && connectorLimitReached}
                                title=${row.status === "ready" && connectorLimitReached
                                  ? (connectorLimitMessage ?? "")
                                  : ""}
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
  const accountReady =
    props.bootstrap?.accountReady === true ||
    (props.account?.session.state === "signed_in" && props.account.session.profileCompleted);
  return renderOrganization({
    connected: props.connected,
    accountReady,
    plan:
      props.account?.profile.plan ??
      props.bootstrap?.account?.profile.plan ??
      props.startupBootstrap?.account?.plan,
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
          : alisioSetupStepLabel(displayStep);

  return html`
    <section class="alisio-setup-page">
      <div class="alisio-setup-page__hero">
        <h1>${t("alisio.setup.hero.title")}</h1>
        <div class="alisio-setup-page__progress">
          <span class="alisio-setup-page__progress-pill">${progressLabel}</span>
          ${renderStatusPill(alisioSetupStepLabel(displayStep), ready ? "ok" : "warn")}
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
