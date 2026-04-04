import { html, nothing } from "lit";
import {
  alisioPlanTranslationKey,
  normalizeAlisioPlan,
} from "../../../../src/shared/alisio-billing.js";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { SettingsSection } from "../navigation.ts";
import type {
  AlisioAccountState,
  AlisioAiState,
  AlisioBootstrapState,
  AlisioDoctorSummaryState,
  NativeShellPermission,
  NativeShellState,
} from "../types.ts";

const PUBLIC_SETTINGS_SECTIONS = ["general", "account", "mac", "support"] as const;

type PublicSettingsSection = (typeof PUBLIC_SETTINGS_SECTIONS)[number];

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

function resolveVisibleSection(section: SettingsSection): PublicSettingsSection {
  switch (section) {
    case "general":
    case "appearance":
    case "language":
      return "general";
    case "account":
    case "security":
    case "devices":
    case "billing":
    case "advanced":
    case "workspace":
    case "automation":
    case "debug":
    case "logs":
      return "account";
    case "ai":
    case "aiAgents":
      return "account";
    case "mac":
    case "infrastructure":
      return "mac";
    case "support":
    case "communications":
      return "support";
    default:
      return "general";
  }
}

function renderDoctorCard(props: {
  doctorLoading: boolean;
  doctorError: string | null;
  doctor: AlisioDoctorSummaryState | null;
  onReconnectRuntime: () => void;
  onOpenSetup: () => void;
}) {
  const text = {
    loading: t("alisio.settings.doctor.loading"),
    healthy: t("alisio.settings.doctor.healthy"),
    needsAttention: t("alisio.settings.doctor.needsAttention"),
    title: t("alisio.settings.doctor.title"),
    openChecks: t("alisio.settings.doctor.openChecks", {
      count: String(props.doctor?.issues.length ?? 0),
    }),
    restartRuntime: t("alisio.settings.doctor.restartRuntime"),
    openSetup: t("alisio.settings.doctor.openSetup"),
  };
  if (props.doctorError) {
    return html`<div class="callout danger">${props.doctorError}</div>`;
  }
  if (props.doctorLoading) {
    return html`<div class="alisio-settings-doctor"><p>${text.loading}</p></div>`;
  }
  if (!props.doctor) {
    return nothing;
  }

  const statusText = props.doctor.ok ? text.healthy : text.needsAttention;
  const compact = props.doctor.ok && props.doctor.issues.length === 0;
  return html`
    <section
      class="alisio-settings-doctor ${props.doctor.ok ? "is-ok" : "is-attention"} ${compact
        ? "alisio-settings-doctor--compact"
        : ""}"
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
                    <strong>${issue.step ?? issue.code}</strong>
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
            </div>
          `
        : html`
            <div class="alisio-settings-doctor__actions">
              <button class="btn" @click=${props.onReconnectRuntime}>${text.restartRuntime}</button>
              <button class="btn" @click=${props.onOpenSetup}>${text.openSetup}</button>
            </div>
          `}
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
    return html`<div class="card alisio-settings-card">
      <div class="card-sub">${text.loading}</div>
    </div>`;
  }

  if (props.nativeShellError) {
    return html`
      <div class="card alisio-settings-card">
        <div class="card-title">${text.title}</div>
        <div class="callout danger" style="margin-top: 16px;">${props.nativeShellError}</div>
      </div>
    `;
  }

  if (!props.nativeShellState) {
    return html`
      <div class="card alisio-settings-card">
        <div class="card-title">${text.title}</div>
        <div class="card-sub">${text.unavailable}</div>
      </div>
    `;
  }

  const state = props.nativeShellState;
  return html`
    <div class="card alisio-settings-card">
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
    system: t("alisio.settings.appearance.options.system"),
    light: t("alisio.settings.appearance.options.light"),
    dark: t("alisio.settings.appearance.options.dark"),
  };
  return html`
    <div class="card alisio-settings-card alisio-settings-card--setting-row">
      <div class="alisio-settings-setting-row">
        <div class="alisio-settings-setting__lead">
          <span class="alisio-settings-setting__icon" aria-hidden="true">${icons.sun}</span>
          <div class="alisio-settings-setting__content">
            <div class="card-title">${text.title}</div>
          </div>
        </div>
        <div class="alisio-settings-options" role="tablist" aria-label=${text.title}>
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
    </div>
  `;
}

function renderLanguageSection(props: {
  locale: string | undefined;
  onLocaleChange: (value: "en" | "pt-PT" | "es") => void;
}) {
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
    avatarLabel?: string;
  }) => void;
  locale?: string;
  onSignOut: () => void;
  onRequestPasswordReset: () => void;
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
    emailManagedByCloud: t("alisio.settings.account.emailManagedByCloud"),
    resetPassword: t("alisio.settings.account.resetPassword"),
    signOut: t("alisio.settings.account.signOut"),
  };
  const joinedFormatter = new Intl.DateTimeFormat(props.locale ?? undefined);
  const emailManagedByCloud = props.account?.session.backend === "supabase";
  return html`
    <div class="card alisio-settings-card">
      <div class="card-title">${text.title}</div>
      ${props.accountError
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.accountError}</div>`
        : nothing}
      ${props.accountNotice
        ? html`<div class="callout info" style="margin-top: 16px;">${props.accountNotice}</div>`
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
                    ?disabled=${emailManagedByCloud}
                    @change=${(event: Event) =>
                      props.onSaveField({
                        email: (event.target as HTMLInputElement).value,
                      })}
                  />
                  ${emailManagedByCloud
                    ? html`<small class="field-note">${text.emailManagedByCloud}</small>`
                    : nothing}
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
                <button class="btn" @click=${props.onRequestPasswordReset}>
                  ${text.resetPassword}
                </button>
                <button class="btn danger" @click=${props.onSignOut}>${text.signOut}</button>
              </div>
            </div>
          `}
    </div>
  `;
}

export function renderAiSection(props: {
  bootstrap: AlisioBootstrapState | null;
  aiLoading: boolean;
  aiError: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onSelectProfile: (profileId: string) => void;
  onDisconnectProfile: (profileId: string) => void;
  onRefreshProfile: (profileId: string) => void;
  onRenameProfile: (profileId: string, label: string) => void;
}) {
  const ai = props.bootstrap?.ai;
  type Profile = NonNullable<AlisioAiState["profiles"]>[number];
  const text = {
    noAccount: t("alisio.settings.ai.noAccount"),
    connectedOn: t("alisio.settings.ai.connectedOn"),
    resetsIn: t("alisio.settings.ai.resetsIn"),
    connectAnother: t("alisio.settings.ai.connectAnother"),
    connectOpenAi: t("alisio.settings.ai.connect"),
    profilesTitle: t("alisio.settings.ai.profilesTitle"),
    profilesSubtitle: t("alisio.settings.ai.profilesSubtitle"),
    profile: t("alisio.settings.ai.profile"),
    profiles: t("alisio.settings.ai.profiles"),
    noProfiles: t("alisio.settings.ai.noProfiles"),
    rename: t("alisio.settings.ai.rename"),
    renamePrompt: t("alisio.settings.ai.renamePrompt"),
    personal: t("alisio.settings.ai.personal"),
    team: t("alisio.settings.ai.team"),
    available: t("alisio.settings.ai.available"),
    recentlyConnected: t("alisio.settings.ai.recentlyConnected"),
    live: t("alisio.settings.ai.live"),
    now: t("alisio.settings.ai.now"),
    minutesSuffix: t("alisio.settings.ai.minutesSuffix"),
    hoursSuffix: t("alisio.settings.ai.hoursSuffix"),
    daysSuffix: t("alisio.settings.ai.daysSuffix"),
  };
  const activeProfileId = ai?.binding ? ai.activeProfileId : undefined;
  const technicalLabelPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const resolveProfileEmail = (profile: Profile | null | undefined) =>
    profile?.email ?? profile?.identity.email;
  const resolveProfileKindKey = (profile: Profile | null | undefined) => {
    const plan = (profile?.planLabel ?? profile?.aggregatedTelemetry?.planType ?? "").toLowerCase();
    return /(team|business|enterprise|edu|organization|org|workspace)/.test(plan)
      ? "team"
      : "personal";
  };
  const resolveProfileKind = (profile: Profile | null | undefined) =>
    resolveProfileKindKey(profile) === "team" ? text.team : text.personal;
  const resolveProfileCustomName = (profile: Profile | null | undefined) => {
    const label = profile?.label?.trim();
    const email = resolveProfileEmail(profile)?.toLowerCase();
    const technicalCandidates = new Set(
      [
        profile?.accountId,
        profile?.accountUserId,
        profile?.userId,
        profile?.identity.accountId,
        profile?.identity.accountUserId,
        profile?.identity.userId,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase()),
    );
    if (!label) {
      return undefined;
    }
    const normalizedLabel = label.toLowerCase();
    if (
      normalizedLabel === resolveProfileKind(profile).toLowerCase() ||
      (email && normalizedLabel === email) ||
      technicalCandidates.has(normalizedLabel) ||
      normalizedLabel.startsWith("alisio-openai:") ||
      normalizedLabel === "default" ||
      technicalLabelPattern.test(normalizedLabel)
    ) {
      return undefined;
    }
    return label;
  };
  const resolveProfileDisplayName = (profile: Profile | null | undefined) =>
    resolveProfileCustomName(profile) ?? resolveProfileKind(profile);
  const resolveProfileTitle = (profile: Profile | null | undefined) =>
    resolveProfileEmail(profile) ?? profile?.label ?? text.noAccount;
  const resolveProfilePlanLabel = (profile: Profile | null | undefined) => {
    const planLabel = profile?.planLabel?.trim();
    if (!planLabel) {
      return undefined;
    }
    const normalizedPlan = planLabel.toLowerCase();
    if (normalizedPlan === resolveProfileKind(profile).toLowerCase()) {
      return undefined;
    }
    const customName = resolveProfileCustomName(profile)?.toLowerCase();
    if (customName && normalizedPlan === customName) {
      return undefined;
    }
    return planLabel;
  };
  const profiles = [...(ai?.profiles ?? [])].toSorted((left, right) => {
    if (left.profileId === activeProfileId) {
      return -1;
    }
    if (right.profileId === activeProfileId) {
      return 1;
    }
    return resolveProfileTitle(left).localeCompare(resolveProfileTitle(right));
  });

  const formatReset = (resetAt?: number) => {
    if (typeof resetAt !== "number") {
      return text.live;
    }
    const diffMs = resetAt - Date.now();
    if (diffMs <= 0) {
      return text.now;
    }
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffMinutes = Math.floor((diffMs % 3_600_000) / 60_000);
    if (diffHours <= 0) {
      return `${Math.max(diffMinutes, 1)}${text.minutesSuffix}`;
    }
    if (diffHours < 24) {
      return diffMinutes > 0
        ? `${diffHours}${text.hoursSuffix} ${diffMinutes}${text.minutesSuffix}`
        : `${diffHours}${text.hoursSuffix}`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}${text.daysSuffix}`;
  };

  const usageTone = (remainingPercent: number) => {
    if (remainingPercent <= 15) {
      return "is-critical";
    }
    if (remainingPercent <= 40) {
      return "is-warm";
    }
    return "is-healthy";
  };

  const formatConnectedAt = (value?: string) => {
    if (!value) {
      return text.recentlyConnected;
    }
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return text.recentlyConnected;
    }
    return new Intl.DateTimeFormat(props.bootstrap?.account?.preferences?.language ?? undefined, {
      dateStyle: "medium",
    }).format(timestamp);
  };
  const resolveProfileUsageWindows = (profile: Profile | null | undefined) => {
    const telemetryWindows = [
      profile?.aggregatedTelemetry?.primaryWindow,
      profile?.aggregatedTelemetry?.secondaryWindow,
    ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (telemetryWindows.length > 0) {
      return telemetryWindows.map((window) => ({
        label: window.label,
        remainingPercent: window.remainingPercent,
        resetAt: window.resetAt,
      }));
    }
    return (profile?.limits?.windows ?? ai?.limits?.windows ?? []).map((window) => ({
      label: window.label,
      remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
      resetAt: window.resetAt,
    }));
  };
  const requestRename = (profile: Profile) => {
    if (typeof window === "undefined") {
      return;
    }
    const nextLabel = window.prompt(text.renamePrompt, resolveProfileDisplayName(profile));
    if (nextLabel === null) {
      return;
    }
    props.onRenameProfile(profile.profileId, nextLabel);
  };

  return html`
    <section class="alisio-settings-ai">
      ${props.aiError
        ? html`<div class="callout danger" style="margin-top: 16px;">${props.aiError}</div>`
        : nothing}
      <article class="card alisio-settings-card alisio-settings-ai__profiles">
        <div class="alisio-settings-ai__card-head">
          <div>
            <div class="card-title">${text.profilesTitle}</div>
            <div class="card-sub">${text.profilesSubtitle}</div>
          </div>
          <div class="alisio-settings-ai__actions">
            <span class="pill"
              >${profiles.length} ${profiles.length === 1 ? text.profile : text.profiles}</span
            >
            <button
              class="btn ${profiles.length === 0 ? "primary" : ""}"
              ?disabled=${props.aiLoading}
              @click=${props.onConnect}
            >
              ${profiles.length === 0 ? text.connectOpenAi : text.connectAnother}
            </button>
          </div>
        </div>
        ${profiles.length === 0
          ? html` <div class="alisio-settings-ai__empty">${text.noProfiles}</div> `
          : html`
              <div class="alisio-settings-ai__profile-list">
                ${profiles.map((profile) =>
                  renderAiProfileCard(profile, {
                    active: profile.profileId === activeProfileId,
                    loading: props.aiLoading,
                    formatConnectedAt,
                    formatReset,
                    resolveProfileTitle,
                    resolveProfileDisplayName,
                    resolveProfilePlanLabel,
                    resolveProfileUsageWindows,
                    usageTone,
                    onSelect: () => props.onSelectProfile(profile.profileId),
                    onRefresh: () => props.onRefreshProfile(profile.profileId),
                    onDisconnect: () => props.onDisconnectProfile(profile.profileId),
                    onRename: () => requestRename(profile),
                  }),
                )}
              </div>
            `}
      </article>
    </section>
  `;
}

export function renderAiProfileCard(
  profile: NonNullable<AlisioAiState["profiles"]>[number],
  props: {
    active: boolean;
    loading: boolean;
    formatConnectedAt: (value?: string) => string;
    formatReset: (resetAt?: number) => string;
    resolveProfileTitle: (profile: NonNullable<AlisioAiState["profiles"]>[number]) => string;
    resolveProfileDisplayName: (profile: NonNullable<AlisioAiState["profiles"]>[number]) => string;
    resolveProfilePlanLabel: (
      profile: NonNullable<AlisioAiState["profiles"]>[number],
    ) => string | undefined;
    resolveProfileUsageWindows: (
      profile: NonNullable<AlisioAiState["profiles"]>[number],
    ) => Array<{ label: string; remainingPercent: number; resetAt?: number }>;
    usageTone: (remainingPercent: number) => string;
    onSelect: () => void;
    onRefresh: () => void;
    onDisconnect: () => void;
    onRename: () => void;
  },
) {
  const text = {
    ready: t("alisio.settings.ai.profileStatus.ready"),
    connected: t("alisio.settings.ai.profileStatus.connected"),
    connecting: t("alisio.settings.ai.profileStatus.connecting"),
    expired: t("alisio.settings.ai.profileStatus.expired"),
    disconnected: t("alisio.settings.ai.profileStatus.disconnected"),
    oauthProfile: t("alisio.settings.ai.oauthProfile"),
    active: t("alisio.settings.ai.active"),
    connectedOn: t("alisio.settings.ai.connectedOn"),
    activeProfileButton: t("alisio.settings.ai.activeProfileButton"),
    activate: t("alisio.settings.ai.activate"),
    refresh: t("alisio.settings.ai.refresh"),
    rename: t("alisio.settings.ai.rename"),
    remove: t("alisio.settings.ai.remove"),
    available: t("alisio.settings.ai.available"),
    resetsIn: t("alisio.settings.ai.resetsIn"),
  };
  const statusLabel =
    profile.status === "connected"
      ? text.ready
      : profile.status === "limits_unavailable"
        ? text.connected
        : profile.status === "connecting"
          ? text.connecting
          : profile.status === "expired"
            ? text.expired
            : text.disconnected;
  const usageWindows = props.resolveProfileUsageWindows(profile);

  return html`
    <article class="alisio-settings-ai__profile ${props.active ? "is-active" : ""}">
      <div class="alisio-settings-ai__profile-head">
        <div>
          <div class="alisio-settings-ai__profile-title">${props.resolveProfileTitle(profile)}</div>
          <div class="alisio-settings-ai__profile-subtitle">
            ${props.resolveProfileDisplayName(profile)}
          </div>
        </div>
        <div class="alisio-settings-ai__profile-badges">
          ${props.active ? html`<span class="pill">${text.active}</span>` : nothing}
          <span class="pill ${profile.status === "expired" ? "danger" : ""}">${statusLabel}</span>
        </div>
      </div>
      <div class="alisio-settings-ai__profile-meta">
        ${props.resolveProfilePlanLabel(profile)
          ? html`<span>${props.resolveProfilePlanLabel(profile)}</span>`
          : nothing}
        <span>${text.connectedOn} ${props.formatConnectedAt(profile.connectedAt)}</span>
      </div>
      ${usageWindows.length > 0
        ? html`
            <div class="alisio-settings-ai__windows">
              ${usageWindows.map(
                (window) => html`
                  <div
                    class="alisio-settings-ai__window ${props.usageTone(window.remainingPercent)}"
                  >
                    <div class="alisio-settings-ai__window-top">
                      <span>${window.label}</span>
                      <strong>${Math.round(window.remainingPercent)}%</strong>
                    </div>
                    <div class="alisio-settings-ai__window-bar">
                      <span style=${`width:${Math.max(4, window.remainingPercent)}%`}></span>
                    </div>
                    <div class="alisio-settings-ai__window-meta">
                      ${text.available} · ${text.resetsIn} ${props.formatReset(window.resetAt)}
                    </div>
                  </div>
                `,
              )}
            </div>
          `
        : nothing}
      <div class="alisio-settings-ai__profile-actions">
        ${props.active
          ? html`<button class="btn" disabled>${text.activeProfileButton}</button>`
          : html`
              <button class="btn" ?disabled=${props.loading} @click=${props.onSelect}>
                ${text.activate}
              </button>
            `}
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${text.refresh}
        </button>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRename}>
          ${text.rename}
        </button>
        <button class="btn danger" ?disabled=${props.loading} @click=${props.onDisconnect}>
          ${text.remove}
        </button>
      </div>
    </article>
  `;
}

function renderDevicesSection(props: { account: AlisioAccountState | null }) {
  const text = {
    title: t("alisio.settings.devices.title"),
    thisDevice: t("alisio.settings.devices.thisDevice"),
    linkedDevice: t("alisio.settings.devices.linkedDevice"),
    active: t("alisio.settings.devices.active"),
    empty: t("alisio.settings.devices.empty"),
  };
  return html`
    <div class="card alisio-settings-card">
      <div class="card-title">${text.title}</div>
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
    upgrade: t("alisio.settings.billing.upgrade"),
    note: t("alisio.settings.billing.note"),
    freePlan: t("alisio.settings.billing.freePlan"),
  };
  const planLabel = props.account?.profile.plan
    ? t(alisioPlanTranslationKey(normalizeAlisioPlan(props.account.profile.plan)))
    : text.freePlan;
  return html`
    <div class="card alisio-settings-card">
      <div class="card-title">${text.title}</div>
      <div class="alisio-settings-billing" style="margin-top: 16px;">
        <div class="list-item">
          <div class="list-title">${planLabel}</div>
          <div class="list-sub">${text.note}</div>
        </div>
        <button class="btn primary">${text.upgrade}</button>
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
  bootstrap: AlisioBootstrapState | null;
  aiLoading: boolean;
  aiError: string | null;
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
  onRequestPasswordReset: () => void;
  onReconnectRuntime: () => void;
  onConnectAi: () => void;
  onDisconnectAi: () => void;
  onRefreshAi: () => void;
  onSelectAiProfile: (profileId: string) => void;
  onDisconnectAiProfile: (profileId: string) => void;
  onRefreshAiProfile: (profileId: string) => void;
  onRenameAiProfile: (profileId: string, label: string) => void;
}) {
  const activeSection = resolveVisibleSection(props.section);
  const showDoctor =
    props.doctorLoading ||
    props.doctorError != null ||
    (props.doctor != null && (!props.doctor.ok || activeSection === "mac"));
  const sectionContent = (() => {
    switch (activeSection) {
      case "general":
        return renderMainSection(
          settingsSectionLabel("general"),
          html`
            ${renderAppearanceSection({
              themeMode: props.themeMode,
              onThemeModeChange: props.onThemeModeChange,
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
          html`
            ${renderAccountSection({
              accountLoading: props.accountLoading,
              accountError: props.accountError,
              accountNotice: props.accountNotice,
              account: props.account,
              locale: props.locale,
              onSaveField: props.onSaveAccountField,
              onSignOut: props.onSignOutAccount,
              onRequestPasswordReset: props.onRequestPasswordReset,
            })}
            ${renderDevicesSection({ account: props.account })}
            ${renderBillingSection({ account: props.account })}
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
              })
            : nothing}
        </aside>
        <div class="alisio-settings-main">${sectionContent}</div>
      </div>
    </section>
  `;
}
