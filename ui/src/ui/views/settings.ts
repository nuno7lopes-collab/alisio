import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { SettingsSection } from "../navigation.ts";
import type {
  AlisioAccountState,
  AlisioDoctorSummaryState,
  NativeShellPermission,
  NativeShellState,
} from "../types.ts";

const PUBLIC_SETTINGS_SECTIONS = [
  "appearance",
  "language",
  "account",
  "security",
  "devices",
  "billing",
  "support",
  "mac",
] as const;

type PublicSettingsSection = (typeof PUBLIC_SETTINGS_SECTIONS)[number];

const SETTINGS_SECTION_LABELS: Record<PublicSettingsSection, string> = {
  appearance: t("alisio.settings.sections.appearance"),
  language: t("alisio.settings.sections.language"),
  account: t("alisio.settings.sections.account"),
  security: t("alisio.settings.sections.security"),
  devices: t("alisio.settings.sections.devices"),
  billing: t("alisio.settings.sections.billing"),
  support: t("alisio.settings.sections.support"),
  mac: t("alisio.settings.sections.mac"),
};

function settingsSectionLabel(section: PublicSettingsSection) {
  return SETTINGS_SECTION_LABELS[section] ?? section;
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
    default:
      return permission;
  }
}

function languageOptions() {
  return [
    { value: "en", label: t("alisio.settings.language.options.en") },
    { value: "pt-PT", label: t("alisio.settings.language.options.ptPT") },
    { value: "es", label: t("alisio.settings.language.options.es") },
  ] as const;
}

const PERMISSION_ORDER: readonly NativeShellPermission[] = [
  "notifications",
  "appleScript",
  "accessibility",
  "screenRecording",
  "microphone",
  "speechRecognition",
  "camera",
  "location",
] as const;

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
  if (props.nativeShellLoading) {
    return html`<div class="card"><div class="card-sub">${text.loading}</div></div>`;
  }

  if (props.nativeShellError) {
    return html`
      <div class="card">
        <div class="card-title">${text.title}</div>
        <div class="callout danger" style="margin-top: 16px;">${props.nativeShellError}</div>
      </div>
    `;
  }

  if (!props.nativeShellState) {
    return html`
      <div class="card">
        <div class="card-title">${text.title}</div>
        <div class="card-sub">${text.unavailable}</div>
      </div>
    `;
  }

  const state = props.nativeShellState;
  return html`
    <div class="card">
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.bridge}</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">${text.launchAtLogin}</div>
          <div>${state.launchAtLogin ? text.enabled : text.disabled}</div>
          <div class="row" style="margin-top: 10px;">
            <button class="btn" @click=${() => props.onSetLaunchAtLogin(!state.launchAtLogin)}>
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
                    @click=${() => props.onSetVoiceWake({ enabled: !state.voiceWake.enabled })}
                  >
                    ${state.voiceWake.enabled ? text.disableWake : text.enableWake}
                  </button>
                  <button
                    class="btn"
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
            <button class="btn" @click=${props.onRevealLogs}>${text.revealLogs}</button>
            <button class="btn" @click=${props.onOpenNativeSettings}>
              ${text.openNativeSettings}
            </button>
          </div>
        </div>
      </div>
      <div style="margin-top: 20px;">
        <div class="label">${text.permissions}</div>
        <div style="display: grid; gap: 12px; margin-top: 12px;">
          ${PERMISSION_ORDER.map(
            (permission) => html`
              <div class="list-item">
                <div class="list-title">${permissionLabel(permission)}</div>
                <div class="list-sub">
                  ${state.permissions[permission] ? text.granted : text.needsApproval}
                </div>
                ${state.permissions[permission]
                  ? nothing
                  : html`
                      <div class="row" style="margin-top: 8px;">
                        <button
                          class="btn btn--sm"
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
        <button class="btn" @click=${props.onRefreshNative}>${text.refresh}</button>
      </div>
    </div>
  `;
}

function renderAppearanceSection(props: {
  themeMode: "system" | "light" | "dark";
  onThemeModeChange: (value: "system" | "light" | "dark") => void;
}) {
  const text = {
    title: t("alisio.settings.appearance.title"),
    subtitle: t("alisio.settings.appearance.subtitle"),
    system: t("alisio.settings.appearance.options.system"),
    light: t("alisio.settings.appearance.options.light"),
    dark: t("alisio.settings.appearance.options.dark"),
  };
  return html`
    <div class="card">
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.subtitle}</div>
      <div class="alisio-settings-options">
        ${(["system", "light", "dark"] as const).map(
          (mode) => html`
            <button
              class="chip ${props.themeMode === mode ? "chip-active" : ""}"
              @click=${() => props.onThemeModeChange(mode)}
            >
              ${mode === "system" ? text.system : mode === "light" ? text.light : text.dark}
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

function renderLanguageSection(props: {
  locale: string | undefined;
  onLocaleChange: (value: "en" | "pt-PT" | "es") => void;
}) {
  const text = {
    title: t("alisio.settings.language.title"),
    subtitle: t("alisio.settings.language.subtitle"),
    displayLanguage: t("alisio.settings.language.displayLanguage"),
  };
  return html`
    <div class="card">
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.subtitle}</div>
      <label class="field" style="margin-top: 16px;">
        <span>${text.displayLanguage}</span>
        <select
          .value=${props.locale ?? "en"}
          @change=${(event: Event) =>
            props.onLocaleChange(
              (event.target as HTMLSelectElement).value as "en" | "pt-PT" | "es",
            )}
        >
          ${languageOptions().map(
            (option) => html`<option value=${option.value}>${option.label}</option>`,
          )}
        </select>
      </label>
    </div>
  `;
}

function renderAccountSection(props: {
  accountLoading: boolean;
  accountError: string | null;
  account: AlisioAccountState | null;
  onSaveField: (patch: {
    username?: string;
    displayName?: string;
    email?: string;
    avatarLabel?: string;
  }) => void;
  locale?: string;
  onSignOut: () => void;
}) {
  const text = {
    title: t("alisio.settings.account.title"),
    subtitle: t("alisio.settings.account.subtitle"),
    loading: t("alisio.settings.account.loading"),
    localUser: t("alisio.settings.account.localUser"),
    displayName: t("alisio.settings.account.displayName"),
    username: t("alisio.settings.account.username"),
    email: t("alisio.settings.account.email"),
    avatarLabel: t("alisio.settings.account.avatarLabel"),
  };
  const joinedFormatter = new Intl.DateTimeFormat(props.locale ?? undefined);
  return html`
    <div class="card">
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.subtitle}</div>
      ${props.accountError
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.accountError}</div>`
        : nothing}
      ${props.accountLoading && !props.account
        ? html`<div class="empty-state" style="margin-top: 16px;">${text.loading}</div>`
        : html`
            <div class="alisio-settings-account">
              <div class="alisio-profile-pill">
                <span class="alisio-profile-pill__avatar"
                  >${props.account?.profile.avatarLabel ?? "A"}</span
                >
                <div>
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
              </div>
              <div class="alisio-settings-form">
                <label class="field">
                  <span>${text.displayName}</span>
                  <input
                    type="text"
                    .value=${props.account?.profile.displayName ?? ""}
                    @change=${(event: Event) =>
                      props.onSaveField({
                        displayName: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
                <label class="field">
                  <span>${text.username}</span>
                  <input
                    type="text"
                    .value=${props.account?.profile.username ?? ""}
                    @change=${(event: Event) =>
                      props.onSaveField({
                        username: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
                <label class="field">
                  <span>${text.email}</span>
                  <input
                    type="email"
                    .value=${props.account?.profile.email ?? ""}
                    @change=${(event: Event) =>
                      props.onSaveField({
                        email: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
                <label class="field">
                  <span>${text.avatarLabel}</span>
                  <input
                    type="text"
                    maxlength="2"
                    .value=${props.account?.profile.avatarLabel ?? ""}
                    @change=${(event: Event) =>
                      props.onSaveField({
                        avatarLabel: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
              </div>
              <div class="row" style="margin-top: 16px;">
                <button class="btn" @click=${props.onSignOut}>Sign out</button>
              </div>
            </div>
          `}
    </div>
  `;
}

function renderSecuritySection() {
  const text = {
    title: t("alisio.settings.security.title"),
    subtitle: t("alisio.settings.security.subtitle"),
    password: t("alisio.settings.security.password"),
    placeholder: t("alisio.settings.security.placeholder"),
  };
  return html`
    <div class="card">
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.subtitle}</div>
      <div class="list-item" style="margin-top: 16px;">
        <div class="list-title">${text.password}</div>
        <div class="list-sub">${text.placeholder}</div>
      </div>
    </div>
  `;
}

function renderDevicesSection(props: { account: AlisioAccountState | null }) {
  const text = {
    title: t("alisio.settings.devices.title"),
    subtitle: t("alisio.settings.devices.subtitle"),
    thisDevice: t("alisio.settings.devices.thisDevice"),
    linkedDevice: t("alisio.settings.devices.linkedDevice"),
    active: t("alisio.settings.devices.active"),
    empty: t("alisio.settings.devices.empty"),
  };
  return html`
    <div class="card">
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.subtitle}</div>
      ${(props.account?.devices ?? []).length === 0
        ? html`<div class="empty-state" style="margin-top: 16px;">${text.empty}</div>`
        : html`
            <div style="display: grid; gap: 12px; margin-top: 16px;">
              ${(props.account?.devices ?? []).map(
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

function renderBillingSection(props: { account: AlisioAccountState | null }) {
  const text = {
    title: t("alisio.settings.billing.title"),
    subtitle: t("alisio.settings.billing.subtitle"),
    upgrade: t("alisio.settings.billing.upgrade"),
    note: t("alisio.settings.billing.note"),
    freePlan: t("alisio.settings.billing.freePlan"),
  };
  return html`
    <div class="card">
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.subtitle}</div>
      <div class="alisio-settings-billing" style="margin-top: 16px;">
        <div class="list-item">
          <div class="list-title">${props.account?.profile.plan ?? text.freePlan}</div>
          <div class="list-sub">${text.note}</div>
        </div>
        <button class="btn">${text.upgrade}</button>
      </div>
    </div>
  `;
}

function renderSupportSection() {
  const text = {
    title: t("alisio.settings.support.title"),
    subtitle: t("alisio.settings.support.subtitle"),
    email: t("alisio.settings.support.email"),
  };
  return html`
    <div class="card">
      <div class="card-title">${text.title}</div>
      <div class="card-sub">${text.subtitle}</div>
      <div class="list-item" style="margin-top: 16px;">
        <div class="list-title">${text.email}</div>
        <div class="list-sub">
          <a href="mailto:support@alisio.pt">support@alisio.pt</a>
        </div>
      </div>
    </div>
  `;
}

export function renderSettingsHub(props: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  accountLoading: boolean;
  accountError: string | null;
  account: AlisioAccountState | null;
  doctorLoading: boolean;
  doctorError: string | null;
  doctor: AlisioDoctorSummaryState | null;
  locale: string | undefined;
  themeMode: "system" | "light" | "dark";
  onLocaleChange: (value: "en" | "pt-PT" | "es") => void;
  onThemeModeChange: (value: "system" | "light" | "dark") => void;
  onSaveAccountField: (patch: {
    username?: string;
    displayName?: string;
    email?: string;
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
  onReconnectRuntime: () => void;
}) {
  const text = {
    title: t("alisio.settings.title"),
    subtitle: t("alisio.settings.subtitle"),
  };
  const sectionContent = (() => {
    switch (props.section) {
      case "appearance":
        return renderAppearanceSection({
          themeMode: props.themeMode,
          onThemeModeChange: props.onThemeModeChange,
        });
      case "language":
        return renderLanguageSection({
          locale: props.locale,
          onLocaleChange: props.onLocaleChange,
        });
      case "account":
        return renderAccountSection({
          accountLoading: props.accountLoading,
          accountError: props.accountError,
          account: props.account,
          locale: props.locale,
          onSaveField: props.onSaveAccountField,
          onSignOut: props.onSignOutAccount,
        });
      case "security":
        return renderSecuritySection();
      case "devices":
        return renderDevicesSection({ account: props.account });
      case "billing":
        return renderBillingSection({ account: props.account });
      case "support":
        return renderSupportSection();
      case "mac":
        return renderMacSection({
          nativeShellLoading: props.nativeShellLoading,
          nativeShellError: props.nativeShellError,
          nativeShellState: props.nativeShellState,
          onRefreshNative: props.onRefreshNative,
          onSetLaunchAtLogin: props.onSetLaunchAtLogin,
          onRequestPermission: props.onRequestPermission,
          onSetVoiceWake: props.onSetVoiceWake,
          onOpenNativeSettings: props.onOpenNativeSettings,
          onRevealLogs: props.onRevealLogs,
        });
      default:
        return nothing;
    }
  })();

  return html`
    <section class="alisio-page">
      <div class="card">
        <div class="card-title">${text.title}</div>
        <div class="card-sub">${text.subtitle}</div>
        <div class="alisio-settings-nav">
          ${PUBLIC_SETTINGS_SECTIONS.map(
            (section) => html`
              <button
                class="chip ${props.section === section ? "chip-active" : ""}"
                @click=${() => props.onSectionChange(section)}
              >
                ${settingsSectionLabel(section)}
              </button>
            `,
          )}
        </div>
      </div>
      ${props.doctorError
        ? html`<div class="callout danger">${props.doctorError}</div>`
        : props.doctorLoading
          ? html`<div class="callout info">Loading system checks…</div>`
          : props.doctor
            ? html`
                <div class="card">
                  <div class="card-title">Doctor-lite</div>
                  <div class="card-sub">
                    ${props.doctor.ok
                      ? "The essential setup path is healthy."
                      : "There are still a few setup issues worth closing."}
                  </div>
                  ${props.doctor.issues.length > 0
                    ? html`
                        <div class="setup-list" style="margin-top: 16px;">
                          ${props.doctor.issues.slice(0, 5).map(
                            (issue) => html`
                              <div>
                                <span>${issue.title}</span>
                                <strong>${issue.step ?? issue.code}</strong>
                              </div>
                            `,
                          )}
                        </div>
                      `
                    : nothing}
                  <div class="row" style="margin-top: 16px;">
                    <button class="btn" @click=${props.onReconnectRuntime}>Restart runtime</button>
                    <button class="btn" @click=${props.onOpenSetup}>Open setup</button>
                  </div>
                </div>
              `
            : nothing}
      ${sectionContent}
    </section>
  `;
}
