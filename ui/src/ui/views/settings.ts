import { html, nothing } from "lit";
import { resolveAlisioAgentName } from "../../../../src/shared/alisio-account.js";
import {
  alisioPlanTranslationKey,
  isAlisioPaidPlan,
  normalizeAlisioPlan,
} from "../../../../src/shared/alisio-billing.js";
import { i18n, t } from "../../i18n/index.ts";
import { alisioSetupStepLabel } from "../alisio-setup-step-label.ts";
import { icons } from "../icons.ts";
import {
  PUBLIC_SETTINGS_SECTIONS,
  publicSettingsSectionFor,
  type PublicSettingsSection,
  type SettingsSection,
} from "../navigation.ts";
import {
  isPublicPresentationLocale,
  type PublicPresentationLocale,
} from "../presentation-preferences.ts";
import type { ThemeTransitionContext } from "../theme-transition.ts";
import type { ThemeAccents, ThemeFamily } from "../theme.ts";
import type {
  AlisioAccountState,
  AlisioDoctorSummaryState,
  NativeShellPermission,
  NativeShellState,
} from "../types.ts";
import { renderAccountProfileFields } from "./account-profile-fields.ts";
import { renderAppearanceControls } from "./appearance.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
  renderSkeletonPill,
  renderSurfaceEmptyState,
} from "./loading-skeleton.ts";
import {
  nativeShellPermissionDescription,
  nativeShellPermissionLabel,
  NATIVE_SHELL_PERMISSION_ORDER,
} from "./native-shell-permissions.ts";

const SETTINGS_SECTION_ICONS = {
  general: icons.sun,
  account: icons.user,
  mac: icons.terminal,
  support: icons.messageSquare,
} as const;

function settingsSectionLabel(section: PublicSettingsSection) {
  switch (section) {
    case "general":
      return t("alisio.settings.sections.general");
    case "account":
      return t("alisio.settings.sections.account");
    case "mac":
      return t("alisio.settings.sections.mac");
    case "support":
      return t("alisio.settings.sections.support");
  }
  return section;
}

function settingsSectionIcon(section: PublicSettingsSection) {
  return SETTINGS_SECTION_ICONS[section] ?? icons.settings;
}

function renderDoctorCard(props: {
  doctorLoading: boolean;
  doctorError: string | null;
  doctor: AlisioDoctorSummaryState | null;
  onReconnectRuntime: () => void;
  onOpenSetup: () => void;
  rebuildAvailable?: boolean;
  rebuildInFlight?: boolean;
  rebuildStatus?: string | null;
  rebuildError?: string | null;
  onRebuildApp?: () => void;
}) {
  const reconnectRequired =
    props.doctor?.issues.some(
      (issue) =>
        issue.step === "gateway" ||
        issue.code === "gateway_not_connected" ||
        issue.code === "gateway_unhealthy",
    ) ?? false;
  const text = {
    loading: t("alisio.settings.doctor.loading"),
    healthy: t("alisio.settings.doctor.healthy"),
    needsAttention: t("alisio.settings.doctor.needsAttention"),
    title: t("alisio.settings.doctor.title"),
    openChecks: t("alisio.settings.doctor.openChecks", {
      count: String(props.doctor?.issues.length ?? 0),
    }),
    restartRuntime: t("alisio.settings.doctor.restartRuntime"),
    rebuildApp: t("alisio.settings.doctor.rebuildApp"),
    rebuildingApp: t("alisio.settings.doctor.rebuildingApp"),
    reconnectApp: t("alisio.settings.doctor.reconnectApp"),
    openSetup: t("alisio.settings.doctor.openSetup"),
  };
  if (props.doctorError) {
    return html`<div class="callout danger">${props.doctorError}</div>`;
  }
  if (props.doctorLoading && !props.doctor) {
    return html`
      <section class="alisio-settings-doctor" role="status" aria-label=${text.loading}>
        <div class="loading-state__header">
          <div class="loading-state__header-copy">
            <div class="skeleton loading-state__title"></div>
            <div class="skeleton skeleton-line loading-state__subtitle"></div>
          </div>
          ${renderSkeletonPill()}
        </div>
        <div class="loading-state__list">
          ${renderSkeletonListItem({ lines: ["long", "medium"] })}
          ${renderSkeletonListItem({ lines: ["medium", "short"] })}
        </div>
      </section>
    `;
  }
  if (!props.doctor) {
    return nothing;
  }

  const statusText = props.doctor.ok ? text.healthy : text.needsAttention;
  const compact = props.doctor.ok && props.doctor.issues.length === 0;
  const showRefreshAppAction = Boolean(props.rebuildAvailable && props.onRebuildApp);
  return html`
    <section
      class="alisio-settings-doctor ${props.doctor.ok ? "is-ok" : "is-attention"} ${compact
        ? "alisio-settings-doctor--compact"
        : ""}"
      aria-busy=${props.doctorLoading ? "true" : "false"}
    >
      <div class="alisio-settings-doctor__head">
        <div>
          <h3>${text.title}</h3>
          ${compact ? nothing : html`<p>${text.openChecks}</p>`}
        </div>
        <span class="alisio-settings-doctor__status">${statusText}</span>
      </div>
      ${!compact && props.doctor.issues.length > 0
        ? html`
            <div class="alisio-settings-doctor__issues">
              ${props.doctor.issues.slice(0, 4).map(
                (issue) => html`
                  <div class="alisio-settings-doctor__issue">
                    <span>${issue.title}</span>
                    <strong>${issue.step ? alisioSetupStepLabel(issue.step) : issue.code}</strong>
                  </div>
                `,
              )}
            </div>
          `
        : nothing}
      ${compact
        ? html`
            <div class="alisio-settings-doctor__actions">
              <button class="btn btn--sm" @click=${props.onOpenSetup}>${text.openSetup}</button>
              ${showRefreshAppAction
                ? html`
                    <button
                      class="btn btn--sm"
                      ?disabled=${Boolean(props.rebuildInFlight)}
                      @click=${props.onRebuildApp}
                    >
                      ${props.rebuildInFlight ? text.rebuildingApp : text.rebuildApp}
                    </button>
                  `
                : nothing}
            </div>
            ${props.rebuildStatus
              ? html`<div class="list-sub" style="margin-top: 8px;">${props.rebuildStatus}</div>`
              : nothing}
            ${props.rebuildError
              ? html`<div class="callout danger" style="margin-top: 8px;">
                  ${props.rebuildError}
                </div>`
              : nothing}
          `
        : html`
            <div class="alisio-settings-doctor__actions">
              ${showRefreshAppAction
                ? html`
                    <button
                      class="btn"
                      ?disabled=${Boolean(props.rebuildInFlight)}
                      @click=${props.onRebuildApp}
                    >
                      ${props.rebuildInFlight ? text.rebuildingApp : text.rebuildApp}
                    </button>
                  `
                : html`
                    <button class="btn" @click=${props.onReconnectRuntime}>
                      ${reconnectRequired ? text.reconnectApp : text.restartRuntime}
                    </button>
                  `}
              <button class="btn" @click=${props.onOpenSetup}>${text.openSetup}</button>
            </div>
            ${props.rebuildStatus
              ? html`<div class="list-sub" style="margin-top: 8px;">${props.rebuildStatus}</div>`
              : nothing}
            ${props.rebuildError
              ? html`<div class="callout danger" style="margin-top: 8px;">
                  ${props.rebuildError}
                </div>`
              : nothing}
          `}
    </section>
  `;
}

function languageOptions() {
  return [
    { value: "en", label: t("alisio.settings.language.options.en") },
    { value: "pt-PT", label: t("alisio.settings.language.options.ptPT") },
    { value: "es", label: t("alisio.settings.language.options.es") },
  ] as const;
}

type PublicLanguageOption = PublicPresentationLocale;

function resolveSelectedLanguageOption(locale: string | undefined): PublicLanguageOption {
  if (isPublicPresentationLocale(locale)) {
    return locale;
  }
  const activeLocale = i18n.getLocale();
  return isPublicPresentationLocale(activeLocale) ? activeLocale : "en";
}

const BILLING_SUPPORT_EMAIL = "support@alisio.pt";
const BILLING_SUPPORT_HREF = `mailto:${BILLING_SUPPORT_EMAIL}?subject=Alisio%20Billing`;

function resolveBillingPlan(account: AlisioAccountState | null | undefined) {
  return normalizeAlisioPlan(account?.profile.plan);
}

function renderSettingsCardSkeleton(params: {
  title: string;
  subtitle?: string;
  rows?: number;
  button?: boolean;
}) {
  return html`
    <div class="card alisio-settings-card" role="status" aria-label=${params.title}>
      <div class="card-title">${params.title}</div>
      ${params.subtitle ? html`<div class="card-sub">${params.subtitle}</div>` : nothing}
      <div class="loading-state__list" style="margin-top: 16px;">
        ${Array.from({ length: params.rows ?? 2 }, () =>
          renderSkeletonListItem({ lines: ["short", "medium"], aside: "pill" }),
        )}
      </div>
      ${params.button
        ? html`<div class="row" style="margin-top: 16px;">${renderSkeletonButton()}</div>`
        : nothing}
    </div>
  `;
}

function renderMacSection(props: {
  nativeShellLoading: boolean;
  nativeShellError: string | null;
  nativeShellState: NativeShellState | null;
  onRefreshNative: () => void;
  onSetLaunchAtLogin: (enabled: boolean) => void;
  onRequestPermission: (permission: NativeShellPermission) => void;
  onSetVoiceWake: (params: { enabled?: boolean; talkEnabled?: boolean }) => void;
  onOpenNativeSettings: () => void;
  onRevealLogs: () => void;
}) {
  const text = {
    loading: t("alisio.settings.mac.loading"),
    title: t("alisio.settings.mac.title"),
    subtitle: t("alisio.settings.mac.subtitle"),
    unavailable: t("alisio.settings.mac.unavailable"),
    unavailableValue: t("alisio.settings.common.unavailable"),
    bridge: t("alisio.settings.mac.bridge"),
    launchAtLogin: t("alisio.settings.mac.launchAtLogin"),
    launchEnable: t("alisio.settings.mac.launchEnable"),
    launchDisable: t("alisio.settings.mac.launchDisable"),
    enabled: t("alisio.settings.mac.enabled"),
    disabled: t("alisio.settings.mac.disabled"),
    voiceWake: t("alisio.settings.mac.voiceWake"),
    listening: t("alisio.settings.mac.listening"),
    off: t("alisio.settings.mac.off"),
    talkMode: (enabled: string) => t("alisio.settings.mac.talkMode", { enabled }),
    notSupported: t("alisio.settings.mac.notSupported"),
    disableWake: t("alisio.settings.mac.disableWake"),
    enableWake: t("alisio.settings.mac.enableWake"),
    disableTalk: t("alisio.settings.mac.disableTalk"),
    enableTalk: t("alisio.settings.mac.enableTalk"),
    logs: t("alisio.settings.mac.logs"),
    revealLogs: t("alisio.settings.mac.revealLogs"),
    openNativeSettings: t("alisio.settings.mac.openNativeSettings"),
    permissions: t("alisio.settings.mac.permissionsTitle"),
    granted: t("alisio.settings.mac.granted"),
    needsApproval: t("alisio.settings.mac.needsApproval"),
    request: t("alisio.settings.mac.request"),
    refresh: t("alisio.settings.mac.refresh"),
  };
  if (props.nativeShellLoading && !props.nativeShellState && !props.nativeShellError) {
    return html`
      <div class="card alisio-settings-card" role="status" aria-label=${text.loading}>
        <div class="loading-state__header">
          <div class="loading-state__header-copy">
            <div class="skeleton loading-state__title"></div>
            <div class="skeleton skeleton-line loading-state__subtitle"></div>
          </div>
          ${renderSkeletonButton()}
        </div>
        <div class="loading-state__list" style="margin-top: 16px;">
          ${renderSkeletonListItem({ lines: ["short", "medium", "short"], aside: "button" })}
          ${renderSkeletonListItem({ lines: ["short", "long", "short"], aside: "button" })}
          ${renderSkeletonListItem({ lines: ["short", "medium"], aside: "button" })}
        </div>
      </div>
    `;
  }

  if (!props.nativeShellState) {
    return html`
      <div class="card alisio-settings-card">
        <div class="card-title">${text.title}</div>
        ${props.nativeShellError
          ? html`<div class="callout danger" style="margin-top: 16px;">
              ${props.nativeShellError}
            </div>`
          : html`<div class="card-sub">${text.unavailable}</div>`}
      </div>
    `;
  }

  const state = props.nativeShellState;
  return html`
    <div class="card alisio-settings-card" aria-busy=${props.nativeShellLoading ? "true" : "false"}>
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.bridge}</div>
      ${props.nativeShellError
        ? html`<div class="callout danger" style="margin-top: 16px;">
            ${props.nativeShellError}
          </div>`
        : nothing}
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">${text.launchAtLogin}</div>
          <div>${state.launchAtLogin ? text.enabled : text.disabled}</div>
          <div class="row" style="margin-top: 10px;">
            <button
              class="btn"
              ?disabled=${props.nativeShellLoading}
              @click=${() => props.onSetLaunchAtLogin(!state.launchAtLogin)}
            >
              ${state.launchAtLogin ? text.launchDisable : text.launchEnable}
            </button>
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">${text.voiceWake}</div>
          <div>${state.voiceWake.enabled ? text.listening : text.off}</div>
          <div class="agent-kv-sub">
            ${state.voiceWake.supported
              ? text.talkMode(state.voiceWake.talkEnabled ? text.enabled : text.disabled)
              : text.notSupported}
          </div>
          ${state.voiceWake.supported
            ? html`
                <div class="row" style="margin-top: 10px;">
                  <button
                    class="btn"
                    ?disabled=${props.nativeShellLoading}
                    @click=${() => props.onSetVoiceWake({ enabled: !state.voiceWake.enabled })}
                  >
                    ${state.voiceWake.enabled ? text.disableWake : text.enableWake}
                  </button>
                  <button
                    class="btn"
                    ?disabled=${props.nativeShellLoading}
                    @click=${() =>
                      props.onSetVoiceWake({ talkEnabled: !state.voiceWake.talkEnabled })}
                  >
                    ${state.voiceWake.talkEnabled ? text.disableTalk : text.enableTalk}
                  </button>
                </div>
              `
            : nothing}
        </div>
        <div class="agent-kv">
          <div class="label">${text.logs}</div>
          <div class="mono">${state.logsPath ?? text.unavailableValue}</div>
          <div class="row" style="margin-top: 10px;">
            <button class="btn" ?disabled=${props.nativeShellLoading} @click=${props.onRevealLogs}>
              ${text.revealLogs}
            </button>
            <button
              class="btn"
              ?disabled=${props.nativeShellLoading}
              @click=${props.onOpenNativeSettings}
            >
              ${text.openNativeSettings}
            </button>
          </div>
        </div>
      </div>
      <div style="margin-top: 20px;">
        <div class="label">${text.permissions}</div>
        <div style="display: grid; gap: 12px; margin-top: 12px;">
          ${NATIVE_SHELL_PERMISSION_ORDER.map(
            (permission) => html`
              <div class="list-item">
                <div
                  class="row"
                  style="justify-content: space-between; align-items: flex-start; gap: 12px;"
                >
                  <div>
                    <div class="list-title">${nativeShellPermissionLabel(permission)}</div>
                    <div class="list-sub">${nativeShellPermissionDescription(permission)}</div>
                  </div>
                  <span class="pill">
                    ${state.permissions[permission] ? text.granted : text.needsApproval}
                  </span>
                </div>
                ${state.permissions[permission]
                  ? nothing
                  : html`
                      <div class="row" style="margin-top: 12px;">
                        <button
                          class="btn btn--sm"
                          ?disabled=${props.nativeShellLoading}
                          @click=${() => props.onRequestPermission(permission)}
                        >
                          ${text.request}
                        </button>
                      </div>
                    `}
              </div>
            `,
          )}
        </div>
      </div>
      <div class="row" style="margin-top: 16px;">
        <button class="btn" ?disabled=${props.nativeShellLoading} @click=${props.onRefreshNative}>
          ${text.refresh}
        </button>
      </div>
    </div>
  `;
}

function renderAppearanceSection(props: {
  themeFamily: ThemeFamily;
  themeMode: "system" | "light" | "dark";
  themeAccents: ThemeAccents;
  onThemeFamilyChange: (value: ThemeFamily, context?: ThemeTransitionContext) => void;
  onThemeAccentChange: (themeFamily: ThemeFamily, accent: string) => void;
  onThemeModeChange: (value: "system" | "light" | "dark") => void;
  onResetPresentation: () => void;
}) {
  return html`
    <div class="settings-appearance">
      ${renderAppearanceControls({
        themeFamily: props.themeFamily,
        themeMode: props.themeMode,
        themeAccents: props.themeAccents,
        onThemeFamilyChange: props.onThemeFamilyChange,
        onThemeAccentChange: props.onThemeAccentChange,
        onThemeModeChange: props.onThemeModeChange,
        onResetPresentation: props.onResetPresentation,
      })}
    </div>
  `;
}

function renderLanguageSection(props: {
  locale: string | undefined;
  onLocaleChange: (value: PublicLanguageOption) => void;
}) {
  const selectedLocale = resolveSelectedLanguageOption(props.locale);
  const text = {
    title: t("alisio.settings.language.title"),
    displayLanguage: t("alisio.settings.language.displayLanguage"),
  };
  return html`
    <div class="card alisio-settings-card alisio-settings-card--setting-row">
      <div class="alisio-settings-setting-row">
        <div class="alisio-settings-setting__lead">
          <span class="alisio-settings-setting__icon" aria-hidden="true">${icons.globe}</span>
          <div class="alisio-settings-setting__content">
            <div class="card-title">${text.title}</div>
          </div>
        </div>
        <label class="field alisio-settings-field--inline">
          <span>${text.displayLanguage}</span>
          <select
            @change=${(event: Event) =>
              props.onLocaleChange(
                (event.target as HTMLSelectElement).value as PublicLanguageOption,
              )}
          >
            ${languageOptions().map(
              (option) =>
                html`<option value=${option.value} ?selected=${option.value === selectedLocale}>
                  ${option.label}
                </option>`,
            )}
          </select>
        </label>
      </div>
    </div>
  `;
}

function renderAccountSection(props: {
  accountLoading: boolean;
  accountError: string | null;
  accountNotice: string | null;
  account: AlisioAccountState | null;
  onSaveField: (patch: {
    username?: string;
    displayName?: string;
    email?: string;
    agentName?: string;
    avatarLabel?: string;
  }) => void;
  locale?: string;
  onSignOut: () => void;
  onRequestRecoveryEmail: () => void;
  onChangeEmail: (email: string) => void;
  onUpdatePassword: (password: string) => void;
}) {
  const text = {
    title: t("alisio.settings.account.title"),
    subtitle: t("alisio.settings.account.subtitle"),
    loading: t("alisio.settings.account.loading"),
    localUser: t("alisio.settings.account.localUser"),
    displayName: t("alisio.settings.account.displayName"),
    agentName: t("alisio.settings.account.agentName"),
    username: t("alisio.settings.account.username"),
    email: t("alisio.settings.account.email"),
    avatarLabel: t("alisio.settings.account.avatarLabel"),
    emailManagedByCloud: t("alisio.settings.account.emailManagedByCloud"),
    localModeNotice: t("alisio.settings.account.localModeNotice"),
    recoveryEmail: t("alisio.settings.account.recoveryEmail"),
    signOut: t("alisio.settings.account.signOut"),
    changeEmail: t("alisio.settings.account.changeEmail"),
    changeEmailPlaceholder: t("alisio.settings.account.changeEmailPlaceholder"),
    changeEmailHint: t("alisio.settings.account.changeEmailHint"),
    changeEmailAction: t("alisio.settings.account.changeEmailAction"),
    updatePassword: t("alisio.settings.account.updatePassword"),
    updatePasswordPlaceholder: t("alisio.settings.account.updatePasswordPlaceholder"),
    updatePasswordHint: t("alisio.settings.account.updatePasswordHint"),
    updatePasswordAction: t("alisio.settings.account.updatePasswordAction"),
  };
  const joinedFormatter = new Intl.DateTimeFormat(props.locale);
  const account = props.account;
  const localOnlyAccountMode = account?.cloud?.available === false;
  const emailManagedByCloud = account?.session.backend === "supabase" && !localOnlyAccountMode;
  const showRecoveryEmail =
    account?.cloud?.available === true && account.session.authMethod !== "google";
  const showCredentialForms =
    account?.cloud?.available === true && account.session.state === "signed_in";
  const showSignOut = account?.cloud?.available === true;
  const handleChangeEmailSubmit = (event: Event) => {
    event.preventDefault();
    if (props.accountLoading) {
      return;
    }
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) {
      return;
    }
    const emailInput = form.elements.namedItem("alisio-next-email");
    const email = emailInput instanceof HTMLInputElement ? emailInput.value : "";
    props.onChangeEmail(email);
  };
  const handlePasswordSubmit = (event: Event) => {
    event.preventDefault();
    if (props.accountLoading) {
      return;
    }
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) {
      return;
    }
    const passwordInput = form.elements.namedItem("alisio-next-password");
    const password = passwordInput instanceof HTMLInputElement ? passwordInput.value : "";
    props.onUpdatePassword(password);
  };
  return html`
    <div class="card alisio-settings-card">
      <div class="card-title">${text.title}</div>
      ${props.accountError
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.accountError}</div>`
        : nothing}
      ${props.accountNotice
        ? html`<div class="callout info" style="margin-top: 16px;">${props.accountNotice}</div>`
        : nothing}
      ${localOnlyAccountMode
        ? html`<div class="callout info" style="margin-top: 16px;">${text.localModeNotice}</div>`
        : nothing}
      ${props.accountLoading && !props.account
        ? html`
            <div role="status" aria-label=${text.loading} style="margin-top: 16px;">
              <div class="alisio-profile-pill">
                <div
                  class="skeleton"
                  style="width: 44px; height: 44px; border-radius: var(--radius-full);"
                ></div>
                <div style="flex: 1; min-width: 0;">
                  ${renderSkeletonLines(["short", "medium"], { compact: true })}
                </div>
              </div>
              <div class="loading-state__list" style="margin-top: 16px;">
                ${renderSkeletonListItem({ lines: ["short", "full"] })}
                ${renderSkeletonListItem({ lines: ["short", "full"] })}
                ${renderSkeletonListItem({ lines: ["short", "full"] })}
              </div>
            </div>
          `
        : html`
            <div
              class="alisio-settings-account"
              aria-busy=${props.accountLoading ? "true" : "false"}
            >
              <div class="alisio-profile-pill">
                <span class="alisio-profile-pill__avatar"
                  >${props.account?.profile.avatarLabel ?? "A"}</span
                >
                <div class="alisio-profile-pill__identity">
                  <div class="list-title">
                    ${props.account?.profile.displayName ?? text.localUser}
                  </div>
                  <div class="list-sub">
                    ${t("alisio.settings.account.joined", {
                      date: joinedFormatter.format(
                        new Date(props.account?.profile.joinedAt ?? Date.now()),
                      ),
                    })}
                  </div>
                </div>
                <div class="alisio-profile-pill__agent">
                  <span class="alisio-profile-pill__agent-label">${text.agentName}</span>
                  <strong class="alisio-profile-pill__agent-name"
                    >${resolveAlisioAgentName(props.account?.profile.agentName)}</strong
                  >
                </div>
              </div>
              <fieldset
                class="form-fieldset-reset alisio-settings-form"
                ?disabled=${props.accountLoading}
              >
                ${renderAccountProfileFields({
                  profile: props.account?.profile ?? null,
                  emailManagedByCloud,
                  mode: "commit",
                  labels: {
                    displayName: text.displayName,
                    agentName: text.agentName,
                    username: text.username,
                    email: text.email,
                    avatarLabel: text.avatarLabel,
                    emailManagedByCloud: text.emailManagedByCloud,
                  },
                  onFieldChange: (field, value) => {
                    switch (field) {
                      case "displayName":
                        props.onSaveField({ displayName: value });
                        return;
                      case "username":
                        props.onSaveField({ username: value });
                        return;
                      case "email":
                        props.onSaveField({ email: value });
                        return;
                      case "agentName":
                        props.onSaveField({ agentName: value });
                        return;
                      case "avatarLabel":
                        props.onSaveField({ avatarLabel: value });
                        return;
                    }
                  },
                })}
              </fieldset>
              ${showCredentialForms
                ? html`
                    <form class="alisio-settings-form" @submit=${handleChangeEmailSubmit}>
                      <fieldset
                        class="form-fieldset-reset alisio-settings-form"
                        ?disabled=${props.accountLoading}
                      >
                        <label class="field">
                          <span>${text.changeEmail}</span>
                          <input
                            name="alisio-next-email"
                            type="email"
                            autocomplete="email"
                            required
                            placeholder=${props.account?.profile.email ??
                            text.changeEmailPlaceholder}
                          />
                          <small class="field-note"> ${text.changeEmailHint} </small>
                        </label>
                      </fieldset>
                      <div class="row" style="margin-top: 12px;">
                        <button class="btn" type="submit" ?disabled=${props.accountLoading}>
                          ${text.changeEmailAction}
                        </button>
                      </div>
                    </form>
                    <form class="alisio-settings-form" @submit=${handlePasswordSubmit}>
                      <fieldset
                        class="form-fieldset-reset alisio-settings-form"
                        ?disabled=${props.accountLoading}
                      >
                        <label class="field">
                          <span>${text.updatePassword}</span>
                          <input
                            name="alisio-next-password"
                            type="password"
                            autocomplete="new-password"
                            minlength="8"
                            required
                            placeholder=${text.updatePasswordPlaceholder}
                          />
                          <small class="field-note">${text.updatePasswordHint}</small>
                        </label>
                      </fieldset>
                      <div class="row" style="margin-top: 12px;">
                        <button class="btn" type="submit" ?disabled=${props.accountLoading}>
                          ${text.updatePasswordAction}
                        </button>
                      </div>
                    </form>
                  `
                : nothing}
              <div class="row" style="margin-top: 16px;">
                ${showRecoveryEmail
                  ? html`
                      <button
                        class="btn"
                        ?disabled=${props.accountLoading}
                        @click=${props.onRequestRecoveryEmail}
                      >
                        ${text.recoveryEmail}
                      </button>
                    `
                  : nothing}
                ${showSignOut
                  ? html`
                      <button
                        class="btn danger"
                        ?disabled=${props.accountLoading}
                        @click=${props.onSignOut}
                      >
                        ${text.signOut}
                      </button>
                    `
                  : nothing}
              </div>
            </div>
          `}
    </div>
  `;
}

function renderDevicesSection(props: { account: AlisioAccountState | null; loading: boolean }) {
  const text = {
    title: t("alisio.settings.devices.title"),
    subtitle: t("alisio.settings.devices.subtitle"),
    thisDevice: t("alisio.settings.devices.thisDevice"),
    linkedDevice: t("alisio.settings.devices.linkedDevice"),
    active: t("alisio.settings.devices.active"),
    empty: t("alisio.settings.devices.empty"),
  };
  if (props.loading && !props.account) {
    return renderSettingsCardSkeleton({
      title: text.title,
      subtitle: text.subtitle,
      rows: 2,
    });
  }
  if (!props.account) {
    return nothing;
  }
  return html`
    <div class="card alisio-settings-card" aria-busy=${props.loading ? "true" : "false"}>
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.subtitle}</div>
      ${(props.account.devices ?? []).length === 0
        ? html`
            <div style="margin-top: 16px;">
              ${renderSurfaceEmptyState({
                title: text.empty,
                body: text.subtitle,
                compact: true,
                centered: true,
              })}
            </div>
          `
        : html`
            <div style="display: grid; gap: 12px; margin-top: 16px;">
              ${props.account.devices.map(
                (device) => html`
                  <div class="list-item">
                    <div class="list-title">${device.label}</div>
                    <div class="list-sub">
                      ${device.platform} · ${device.current ? text.thisDevice : text.linkedDevice} ·
                      ${text.active}
                    </div>
                  </div>
                `,
              )}
            </div>
          `}
    </div>
  `;
}

function renderBillingSection(props: {
  account: AlisioAccountState | null;
  loading: boolean;
  focused: boolean;
}) {
  const text = {
    title: t("alisio.settings.billing.title"),
    subtitle: t("alisio.settings.billing.subtitle"),
    currentPlan: t("alisio.settings.billing.currentPlan"),
    active: t("alisio.settings.billing.active"),
    comingSoon: t("alisio.settings.billing.comingSoon"),
    freeDescription: t("alisio.settings.billing.freeDescription"),
    plusDescription: t("alisio.settings.billing.plusDescription"),
    note: t("alisio.settings.billing.note"),
    plusActiveNote: t("alisio.settings.billing.plusActiveNote"),
    contactSupport: t("alisio.settings.billing.contactSupport"),
    freePlan: t("alisio.settings.billing.freePlan"),
    plusPlan: t("alisio.settings.billing.plusPlan"),
  };
  if (props.loading && !props.account) {
    return renderSettingsCardSkeleton({
      title: text.title,
      subtitle: text.subtitle,
      rows: 2,
      button: true,
    });
  }
  if (!props.account) {
    return nothing;
  }
  const currentPlan = resolveBillingPlan(props.account);
  const planLabel = t(alisioPlanTranslationKey(currentPlan));
  const isPlusActive = isAlisioPaidPlan(currentPlan);
  return html`
    <div
      class="card alisio-settings-card ${props.focused ? "alisio-settings-card--focused" : ""}"
      aria-busy=${props.loading ? "true" : "false"}
    >
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.subtitle}</div>
      <div class="alisio-settings-billing">
        <div class="alisio-billing-summary">
          <span class="alisio-billing-summary__label">${text.currentPlan}</span>
          <strong class="alisio-billing-summary__value">${planLabel}</strong>
          <p class="alisio-billing-summary__note">
            ${isPlusActive ? text.plusActiveNote : text.note}
          </p>
        </div>
        <div class="alisio-billing-plan-grid">
          <article
            class="alisio-billing-plan ${currentPlan === "free" ? "is-current" : ""}"
            aria-current=${currentPlan === "free" ? "true" : "false"}
          >
            <div class="alisio-billing-plan__top">
              <div>
                <div class="alisio-billing-plan__title">${text.freePlan}</div>
                <div class="alisio-billing-plan__body">${text.freeDescription}</div>
              </div>
              ${currentPlan === "free"
                ? html`<span class="alisio-billing-plan__badge">${text.active}</span>`
                : nothing}
            </div>
          </article>
          <article
            class="alisio-billing-plan ${currentPlan === "plus" ? "is-current" : "is-muted"}"
            aria-current=${currentPlan === "plus" ? "true" : "false"}
          >
            <div class="alisio-billing-plan__top">
              <div>
                <div class="alisio-billing-plan__title">${text.plusPlan}</div>
                <div class="alisio-billing-plan__body">${text.plusDescription}</div>
              </div>
              <span class="alisio-billing-plan__badge">
                ${currentPlan === "plus" ? text.active : text.comingSoon}
              </span>
            </div>
          </article>
        </div>
        <div class="alisio-billing-actions">
          <a class="btn" href=${BILLING_SUPPORT_HREF}>${text.contactSupport}</a>
        </div>
      </div>
    </div>
  `;
}

function renderSupportSection() {
  const text = {
    title: t("alisio.settings.support.title"),
    email: t("alisio.settings.support.email"),
  };
  return html`
    <div class="card alisio-settings-card">
      <div class="card-title">${text.title}</div>
      <div class="list-item" style="margin-top: 16px;">
        <div class="list-title">${text.email}</div>
        <div class="list-sub">
          <a href="mailto:support@alisio.pt">support@alisio.pt</a>
        </div>
      </div>
    </div>
  `;
}

function renderRuntimeSection(props: { onOpenSetup: () => void }) {
  const text = {
    title: t("alisio.settings.runtime.title"),
    setupTitle: t("alisio.settings.runtime.setupTitle"),
    setupSubtitle: t("alisio.settings.runtime.setupSubtitle"),
    openSetup: t("alisio.settings.runtime.openSetup"),
  };
  return html`
    <div class="card alisio-settings-card">
      <div class="card-title">${text.title}</div>
      <div class="list-item" style="margin-top: 16px;">
        <div class="list-title">${text.setupTitle}</div>
        <div class="list-sub">${text.setupSubtitle}</div>
      </div>
      <div class="row" style="margin-top: 16px;">
        <button class="btn" @click=${props.onOpenSetup}>${text.openSetup}</button>
      </div>
    </div>
  `;
}

function renderMainSection(title: string, content: unknown) {
  return html`
    <div class="alisio-settings-section">
      <div class="alisio-settings-section__header">
        <h2>${title}</h2>
      </div>
      <div class="alisio-settings-section__body">${content}</div>
    </div>
  `;
}

export function renderSettingsHub(props: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  accountLoading: boolean;
  accountError: string | null;
  accountNotice: string | null;
  account: AlisioAccountState | null;
  doctorLoading: boolean;
  doctorError: string | null;
  doctor: AlisioDoctorSummaryState | null;
  locale: string | undefined;
  themeFamily: ThemeFamily;
  themeMode: "system" | "light" | "dark";
  themeAccents: ThemeAccents;
  onLocaleChange: (value: "en" | "pt-PT" | "es") => void;
  onThemeFamilyChange: (value: ThemeFamily, context?: ThemeTransitionContext) => void;
  onThemeAccentChange: (themeFamily: ThemeFamily, accent: string) => void;
  onThemeModeChange: (value: "system" | "light" | "dark") => void;
  onResetPresentation: () => void;
  onSaveAccountField: (patch: {
    username?: string;
    displayName?: string;
    email?: string;
    agentName?: string;
    avatarLabel?: string;
  }) => void;
  nativeShellLoading: boolean;
  nativeShellError: string | null;
  nativeShellState: NativeShellState | null;
  onRefreshNative: () => void;
  onSetLaunchAtLogin: (enabled: boolean) => void;
  onRequestPermission: (permission: NativeShellPermission) => void;
  onSetVoiceWake: (params: { enabled?: boolean; talkEnabled?: boolean }) => void;
  onOpenNativeSettings: () => void;
  onRevealLogs: () => void;
  onOpenSetup: () => void;
  onSignOutAccount: () => void;
  onRequestRecoveryEmail: () => void;
  onChangeEmail: (email: string) => void;
  onUpdatePassword: (password: string) => void;
  onReconnectRuntime: () => void;
  nativeRebuildAvailable: boolean;
  nativeRebuildInFlight: boolean;
  nativeRebuildStatus: string | null;
  nativeRebuildError: string | null;
  onRebuildNativeApp: () => void;
}) {
  const activeSection = publicSettingsSectionFor(props.section);
  const billingFocused = props.section === "billing";
  const showDoctor =
    activeSection === "mac" ||
    props.doctorError != null ||
    (props.doctor != null && !props.doctor.ok);
  const sectionContent = (() => {
    switch (activeSection) {
      case "general":
        return renderMainSection(
          settingsSectionLabel("general"),
          html`
            ${renderAppearanceSection({
              themeFamily: props.themeFamily,
              themeMode: props.themeMode,
              themeAccents: props.themeAccents,
              onThemeFamilyChange: props.onThemeFamilyChange,
              onThemeAccentChange: props.onThemeAccentChange,
              onThemeModeChange: props.onThemeModeChange,
              onResetPresentation: props.onResetPresentation,
            })}
            ${renderLanguageSection({
              locale: props.locale,
              onLocaleChange: props.onLocaleChange,
            })}
          `,
        );
      case "account":
        return renderMainSection(
          settingsSectionLabel("account"),
          billingFocused
            ? html`
                ${renderBillingSection({
                  account: props.account,
                  loading: props.accountLoading,
                  focused: true,
                })}
                ${renderAccountSection({
                  accountLoading: props.accountLoading,
                  accountError: props.accountError,
                  accountNotice: props.accountNotice,
                  account: props.account,
                  locale: props.locale,
                  onSaveField: props.onSaveAccountField,
                  onSignOut: props.onSignOutAccount,
                  onRequestRecoveryEmail: props.onRequestRecoveryEmail,
                  onChangeEmail: props.onChangeEmail,
                  onUpdatePassword: props.onUpdatePassword,
                })}
                ${renderDevicesSection({
                  account: props.account,
                  loading: props.accountLoading,
                })}
              `
            : html`
                ${renderAccountSection({
                  accountLoading: props.accountLoading,
                  accountError: props.accountError,
                  accountNotice: props.accountNotice,
                  account: props.account,
                  locale: props.locale,
                  onSaveField: props.onSaveAccountField,
                  onSignOut: props.onSignOutAccount,
                  onRequestRecoveryEmail: props.onRequestRecoveryEmail,
                  onChangeEmail: props.onChangeEmail,
                  onUpdatePassword: props.onUpdatePassword,
                })}
                ${renderDevicesSection({
                  account: props.account,
                  loading: props.accountLoading,
                })}
                ${renderBillingSection({
                  account: props.account,
                  loading: props.accountLoading,
                  focused: false,
                })}
              `,
        );
      case "mac":
        return renderMainSection(
          settingsSectionLabel("mac"),
          html`
            ${renderMacSection({
              nativeShellLoading: props.nativeShellLoading,
              nativeShellError: props.nativeShellError,
              nativeShellState: props.nativeShellState,
              onRefreshNative: props.onRefreshNative,
              onSetLaunchAtLogin: props.onSetLaunchAtLogin,
              onRequestPermission: props.onRequestPermission,
              onSetVoiceWake: props.onSetVoiceWake,
              onOpenNativeSettings: props.onOpenNativeSettings,
              onRevealLogs: props.onRevealLogs,
            })}
            ${renderRuntimeSection({
              onOpenSetup: props.onOpenSetup,
            })}
          `,
        );
      case "support":
        return renderMainSection(settingsSectionLabel("support"), renderSupportSection());
      default:
        return nothing;
    }
  })();

  return html`
    <section class="alisio-page alisio-settings-page">
      <div class="alisio-settings-frame">
        <aside class="alisio-settings-sidebar">
          <nav class="alisio-settings-links" aria-label=${t("alisio.settings.sections.ariaLabel")}>
            ${PUBLIC_SETTINGS_SECTIONS.map(
              (section) => html`
                <button
                  class="alisio-settings-link ${activeSection === section
                    ? "alisio-settings-link--active"
                    : ""}"
                  @click=${() => props.onSectionChange(section)}
                >
                  <span class="alisio-settings-link__icon" aria-hidden="true"
                    >${settingsSectionIcon(section)}</span
                  >
                  <span class="alisio-settings-link__label">${settingsSectionLabel(section)}</span>
                </button>
              `,
            )}
          </nav>
          ${showDoctor
            ? renderDoctorCard({
                doctorLoading: props.doctorLoading,
                doctorError: props.doctorError,
                doctor: props.doctor,
                onReconnectRuntime: props.onReconnectRuntime,
                onOpenSetup: props.onOpenSetup,
                rebuildAvailable: props.nativeRebuildAvailable,
                rebuildInFlight: props.nativeRebuildInFlight,
                rebuildStatus: props.nativeRebuildStatus,
                rebuildError: props.nativeRebuildError,
                onRebuildApp: props.onRebuildNativeApp,
              })
            : nothing}
        </aside>
        <div class="alisio-settings-main">${sectionContent}</div>
      </div>
    </section>
  `;
}
