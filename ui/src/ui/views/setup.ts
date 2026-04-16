import { html, nothing } from "lit";
import {
  validateAlisioEmail,
  validateAlisioAccountDraft,
} from "../../../../src/shared/alisio-account.js";
import { t } from "../../i18n/index.ts";
import { resolveCurrentStartupState, resolveDisplayedSetupStep } from "../alisio-setup-state.ts";
import { alisioSetupStepLabel } from "../alisio-setup-step-label.ts";
import type {
  AlisioAccountState,
  AlisioAuthStage,
  AlisioBootstrapState,
  AlisioBootstrapStep,
} from "../types.ts";
import { type AccountProfileField, renderAccountProfileFields } from "./account-profile-fields.ts";

type SetupProps = {
  connected: boolean;
  lastError: string | null;
  startupLoading: boolean;
  startupError: string | null;
  startupBootstrap: import("../types.ts").AlisioHttpBootstrap | null;
  bootstrap: AlisioBootstrapState | null;
  requestedStep: AlisioBootstrapStep | null;
  accountLoading: boolean;
  accountError: string | null;
  accountNotice: string | null;
  account: AlisioAccountState | null;
  authEmail: string;
  authPendingEmail: string;
  authCode: string;
  authStage: AlisioAuthStage;
  passwordResetRequired: boolean;
  termsAccepted: boolean;
  marketingOptIn: boolean;
  birthdate: string;
  onAuthEmailChange: (value: string) => void;
  onAuthCodeChange: (value: string) => void;
  onAuthStageChange: (value: AlisioAuthStage) => void;
  onTermsAcceptedChange: (value: boolean) => void;
  onMarketingOptInChange: (value: boolean) => void;
  onBirthdateChange: (value: string) => void;
  onConnect: () => void;
  onOpenWorkspace: () => void;
  onOpenSettingsAi: () => void;
  onAccountFieldChange: (field: AccountProfileField, value: string) => void;
  onBeginEmailAuth: () => void;
  onVerifyEmailAuth: () => void;
  onSignInWithPassword: (email: string, password: string) => void;
  onSignUpWithPassword: (email: string, password: string) => void;
  onRequestRecoveryEmail: () => void;
  onSaveAccount: () => void;
  onUpdatePassword: (password: string) => void;
};

type EntryAction = "magic_link" | "sign_in" | "sign_up";

function renderCallout(kind: "info" | "danger", message: string | null | undefined) {
  if (!message) {
    return nothing;
  }
  return html`<div class="callout ${kind}">${message}</div>`;
}

function renderStatusPill(label: string, tone: "ok" | "warn" | "muted" = "muted") {
  return html`<span class="chip ${tone === "ok" ? "chip-active" : ""}">${label}</span>`;
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

function shouldShowWaitForConnectionNotice(props: SetupProps) {
  return !props.connected && !props.lastError && !props.startupError;
}

function readInputValue(form: HTMLFormElement, name: string) {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement ? field.value.trim() : "";
}

function validateEntryForm(form: HTMLFormElement, action: EntryAction) {
  const emailInput = form.elements.namedItem("alisio-auth-email");
  const passwordInput = form.elements.namedItem("alisio-auth-password");
  if (!(emailInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement)) {
    return null;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const emailError = validateAlisioEmail(email);
  const passwordError =
    action === "magic_link"
      ? null
      : !password.trim()
        ? t("alisio.setup.account.passwordRequired")
        : action === "sign_up" && password.trim().length < 8
          ? t("alisio.setup.account.passwordMinLength")
          : null;

  emailInput.setCustomValidity(emailError ?? "");
  passwordInput.setCustomValidity(passwordError ?? "");
  const valid = form.reportValidity();
  emailInput.setCustomValidity("");
  passwordInput.setCustomValidity("");
  if (!valid) {
    return null;
  }
  return { email, password };
}

function renderPasswordResetStep(props: SetupProps) {
  const resetEmail = props.account?.profile.email ?? props.authPendingEmail.trim();
  const handlePasswordResetSubmit = (event: Event) => {
    event.preventDefault();
    if (props.accountLoading) {
      return;
    }
    const form = event.currentTarget as HTMLFormElement;
    const password = readInputValue(form, "alisio-reset-password");
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
  const emailFallback = profile?.email ?? props.authEmail;
  const identityChip = profile?.email ?? props.authPendingEmail ?? emailFallback ?? "";

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    if (props.accountLoading || validation || missingTerms) {
      return;
    }
    props.onSaveAccount();
  };

  return html`
    <section class="card alisio-setup-card">
      ${renderSetupCardHeader(t("alisio.setup.profile.title"), t("alisio.setup.profile.subtitle"))}
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

function renderVerifyEmailStep(props: SetupProps) {
  const authPendingEmail = props.authPendingEmail.trim() || props.authEmail.trim();
  const authCode = props.authCode.trim();
  const canVerifyEmail = props.connected && authCode.length > 0;
  const statusMessage =
    props.accountError ??
    props.accountNotice ??
    (shouldShowWaitForConnectionNotice(props) ? t("alisio.setup.account.waitForConnection") : null);

  const handleCodeSubmit = (event: Event) => {
    event.preventDefault();
    if (props.accountLoading || !canVerifyEmail) {
      return;
    }
    props.onVerifyEmailAuth();
  };

  return html`
    <section class="card alisio-setup-card">
      ${renderSetupCardHeader(
        t("alisio.setup.account.verifyTitle"),
        t("alisio.setup.account.verifySubtitle"),
      )}
      ${statusMessage
        ? html`
            <div class="callout ${props.accountError ? "danger" : "info"}">${statusMessage}</div>
          `
        : nothing}
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
        <div class="alisio-setup-surface-card alisio-setup-account__verify-guide">
          <div class="alisio-setup-account__verify-guide-title">
            ${t("alisio.setup.account.verifyLinkTitle")}
          </div>
          <div class="alisio-setup-account__verify-guide-note">
            ${t("alisio.setup.account.verifyLinkNote", { email: authPendingEmail })}
          </div>
          <div class="alisio-setup-account__verify-guide-hint">
            ${t("alisio.setup.account.verifyLinkAuto")}
          </div>
        </div>
        <details class="alisio-setup-advanced" ?open=${authCode.length > 0}>
          <summary>${t("alisio.setup.account.codeFallbackSummary")}</summary>
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
                .value=${props.authCode}
                @input=${(event: Event) =>
                  props.onAuthCodeChange((event.target as HTMLInputElement).value)}
              />
              <small class="field-note">${t("alisio.setup.account.codeNote")}</small>
            </label>
          </fieldset>
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
          </div>
        </details>
        <div class="alisio-setup-actions">
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
    </section>
  `;
}

function renderAccountEntryStep(props: SetupProps) {
  const authEmail = props.authEmail;
  const emailError = validateAlisioEmail(authEmail);
  const suggestedEmail =
    props.account?.profile.email ?? props.startupBootstrap?.account?.email ?? "";
  const statusMessage =
    props.accountError ??
    props.accountNotice ??
    (shouldShowWaitForConnectionNotice(props) ? t("alisio.setup.account.waitForConnection") : null);
  const cloudState = currentAccountCloudState(props);

  if (cloudState?.available === false && props.account?.session.state !== "signed_in") {
    return html`
      <section class="card alisio-setup-card">
        ${renderSetupCardHeader(
          t("alisio.setup.account.title"),
          t("alisio.settings.account.localModeNotice"),
        )}
        <div class="callout danger">${t("alisio.setup.profile.localModeNotice")}</div>
        ${!props.connected
          ? html`
              <div class="alisio-setup-actions">
                <button class="btn" ?disabled=${props.startupLoading} @click=${props.onConnect}>
                  ${props.startupLoading
                    ? t("alisio.setup.account.connecting")
                    : t("alisio.setup.account.reconnect")}
                </button>
              </div>
            `
          : nothing}
      </section>
    `;
  }

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    if (props.accountLoading || !props.connected) {
      return;
    }
    const form = event.currentTarget as HTMLFormElement;
    const values = validateEntryForm(form, "sign_in");
    if (!values) {
      return;
    }
    props.onAuthEmailChange(values.email);
    props.onSignInWithPassword(values.email, values.password);
  };

  const handleEntryAction = (event: Event, action: EntryAction) => {
    event.preventDefault();
    if (props.accountLoading || !props.connected) {
      return;
    }
    const button = event.currentTarget as HTMLButtonElement;
    const form = button.form;
    if (!form) {
      return;
    }
    const values = validateEntryForm(form, action);
    if (!values) {
      return;
    }
    props.onAuthEmailChange(values.email);
    if (action === "magic_link") {
      props.onBeginEmailAuth();
      return;
    }
    if (action === "sign_up") {
      props.onSignUpWithPassword(values.email, values.password);
      return;
    }
    props.onSignInWithPassword(values.email, values.password);
  };

  return html`
    <section class="card alisio-setup-card">
      ${renderSetupCardHeader(t("alisio.setup.account.title"), t("alisio.setup.account.subtitle"))}
      ${statusMessage
        ? html`
            <div class="callout ${props.accountError ? "danger" : "info"}">${statusMessage}</div>
          `
        : nothing}
      <form class="alisio-setup-account" @submit=${handleSubmit}>
        <div class="alisio-setup-surface-card">
          <fieldset
            class="form-fieldset-reset alisio-setup-account__fields"
            ?disabled=${props.accountLoading}
          >
            <label class="field">
              <span>${t("alisio.setup.account.email")}</span>
              <input
                name="alisio-auth-email"
                type="email"
                autocomplete="email"
                autocapitalize="none"
                spellcheck="false"
                inputmode="email"
                enterkeyhint="next"
                required
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
                : html` <small class="field-note">${t("alisio.setup.account.emailNote")}</small> `}
              ${authEmail.trim() && emailError
                ? html`<small class="field-note field-note--danger">${emailError}</small>`
                : nothing}
            </label>
            <label class="field">
              <span>${t("alisio.setup.account.password")}</span>
              <input
                name="alisio-auth-password"
                type="password"
                autocomplete="current-password"
                enterkeyhint="go"
                placeholder=${t("alisio.setup.account.passwordPlaceholder")}
              />
              <small class="field-note">${t("alisio.setup.account.passwordNote")}</small>
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
                    : t("alisio.setup.account.reconnect")}
                </button>
              `
            : nothing}
          <button class="btn primary" type="submit" ?disabled=${props.accountLoading}>
            ${props.accountLoading
              ? t("alisio.setup.account.working")
              : t("alisio.setup.account.signInAction")}
          </button>
          <button
            type="button"
            class="btn"
            ?disabled=${props.accountLoading || !props.connected}
            @click=${(event: Event) => handleEntryAction(event, "sign_up")}
          >
            ${t("alisio.setup.account.signUpAction")}
          </button>
        </div>
        <div class="alisio-setup-actions alisio-setup-actions--muted">
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${props.accountLoading || !props.connected}
            @click=${(event: Event) => handleEntryAction(event, "magic_link")}
          >
            ${t("alisio.setup.account.magicLinkAction")}
          </button>
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${props.accountLoading || !props.connected}
            @click=${(event: Event) => {
              event.preventDefault();
              if (props.accountLoading || !props.connected) {
                return;
              }
              const button = event.currentTarget as HTMLButtonElement;
              const form = button.form;
              if (!form) {
                return;
              }
              const values = validateEntryForm(form, "magic_link");
              if (!values) {
                return;
              }
              props.onAuthEmailChange(values.email);
              props.onRequestRecoveryEmail();
            }}
          >
            ${t("alisio.setup.account.recoveryAction")}
          </button>
        </div>
      </form>
    </section>
  `;
}

function renderAccountStep(props: SetupProps) {
  if (props.passwordResetRequired) {
    return renderPasswordResetStep(props);
  }
  if (props.account?.session.state === "signed_in" && !props.account.session.profileCompleted) {
    return renderProfileStep(props);
  }
  if (props.authStage === "email-link") {
    return renderVerifyEmailStep(props);
  }
  return renderAccountEntryStep(props);
}

function renderReadyStep(props: SetupProps) {
  const aiConnected = currentAiStatus(props) === "connected";
  return html`
    <section class="card alisio-setup-card">
      ${renderSetupCardHeader(t("alisio.setup.ready.title"), t("alisio.setup.ready.subtitle"))}
      ${!aiConnected
        ? html` <div class="callout info">${t("alisio.setup.ready.aiOptionalNotice")}</div> `
        : nothing}
      <div class="alisio-setup-actions">
        <button class="btn primary" @click=${props.onOpenWorkspace}>
          ${t("alisio.setup.ready.startChatting")}
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
    case "account":
      return renderAccountStep(props);
    case "ready":
    default:
      return renderReadyStep(props);
  }
}

export function renderSetup(props: SetupProps) {
  const displayStep = resolveDisplayedSetupStep({
    connected: props.connected,
    requestedStep: props.requestedStep,
    bootstrap: props.bootstrap,
    startupBootstrap: props.startupBootstrap,
  });
  const startupState = currentStartupState(props);
  const ready = displayStep === "ready";
  const showGlobalCallout = !props.connected && (props.lastError || props.startupError);
  const heroSubtitle =
    startupState === "needs_profile"
      ? t("alisio.setup.hero.profileSubtitle")
      : t("alisio.setup.hero.subtitle");

  return html`
    <section class="alisio-setup-page">
      <div class="alisio-setup-page__hero">
        <h1>${t("alisio.setup.hero.title")}</h1>
        <div class="card-sub">${heroSubtitle}</div>
        <div class="alisio-setup-page__progress">
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
