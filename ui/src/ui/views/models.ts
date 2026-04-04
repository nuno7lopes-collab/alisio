import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { ModelsServerDraft } from "../models-view-types.ts";
import type { AlisioAiState, AlisioBootstrapState, AlisioModelsState } from "../types.ts";

type AiProfile = NonNullable<AlisioAiState["profiles"]>[number];
type LocalModelTarget = NonNullable<AlisioModelsState["targets"]>[number];
type RemoteModelServer = NonNullable<AlisioModelsState["servers"]>[number];
type ModelProviderId = "openai" | "server" | "local";
type ChatModelOption = {
  value: string;
  label: string;
};

function aiText() {
  return {
    noAccount: t("alisio.settings.ai.noAccount"),
    connectedOn: t("alisio.settings.ai.connectedOn"),
    resetsIn: t("alisio.settings.ai.resetsIn"),
    connectAnother: t("alisio.settings.ai.connectAnother"),
    connectOpenAi: t("alisio.settings.ai.connect"),
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
    ready: t("alisio.settings.ai.profileStatus.ready"),
    connected: t("alisio.settings.ai.profileStatus.connected"),
    connecting: t("alisio.settings.ai.profileStatus.connecting"),
    expired: t("alisio.settings.ai.profileStatus.expired"),
    disconnected: t("alisio.settings.ai.profileStatus.disconnected"),
    active: t("alisio.settings.ai.active"),
    activeProfileButton: t("alisio.settings.ai.activeProfileButton"),
    activate: t("alisio.settings.ai.activate"),
    refresh: t("alisio.settings.ai.refresh"),
    remove: t("alisio.settings.ai.remove"),
    refreshAll: t("alisio.settings.ai.refreshAll"),
  };
}

function modelsText() {
  return {
    title: t("alisio.settings.models.title"),
    subtitle: t("alisio.settings.models.subtitle"),
    chatgptTitle: t("alisio.settings.models.chatgptTitle"),
    chatgptSubtitle: t("alisio.settings.models.chatgptSubtitle"),
    localTitle: t("alisio.settings.models.localTitle"),
    localSubtitle: t("alisio.settings.models.localSubtitle"),
    serversTitle: t("alisio.settings.models.serversTitle"),
    serversSubtitle: t("alisio.settings.models.serversSubtitle"),
    currentComputer: t("alisio.settings.models.currentComputer"),
    linkedComputer: t("alisio.settings.models.linkedComputer"),
    activeComputer: t("alisio.settings.models.activeComputer"),
    connected: t("alisio.settings.models.connected"),
    modelSourceReady: t("alisio.settings.models.modelSourceReady"),
    modelSourcePending: t("alisio.settings.models.modelSourcePending"),
    noTargets: t("alisio.settings.models.noTargets"),
    noLocalModels: t("alisio.settings.models.noLocalModels"),
    emptyServers: t("alisio.settings.models.emptyServers"),
    install: t("alisio.settings.models.install"),
    installed: t("alisio.settings.models.installed"),
    backend: t("alisio.settings.models.backend"),
    installedModels: t("alisio.settings.models.installedModels"),
    noInstalledModels: t("alisio.settings.models.noInstalledModels"),
    runtimeNotConfigured: t("alisio.settings.models.runtimeNotConfigured"),
    runtimeError: t("alisio.settings.models.runtimeError"),
    hardware: t("alisio.settings.models.hardware"),
    recommendedUpTo: t("alisio.settings.models.recommendedUpTo"),
    memory: t("alisio.settings.models.memory"),
    disk: t("alisio.settings.models.disk"),
    addServer: t("alisio.settings.models.addServer"),
    editServer: t("alisio.settings.models.editServer"),
    activateServer: t("alisio.settings.models.activateServer"),
    removeServer: t("alisio.settings.models.removeServer"),
    serverDraftAddTitle: t("alisio.settings.models.serverDraftAddTitle"),
    serverDraftEditTitle: t("alisio.settings.models.serverDraftEditTitle"),
    serverNameLabel: t("alisio.settings.models.serverNameLabel"),
    serverTypeLabel: t("alisio.settings.models.serverTypeLabel"),
    serverUrlLabel: t("alisio.settings.models.serverUrlLabel"),
    serverApiKeyLabel: t("alisio.settings.models.serverApiKeyLabel"),
    saveServer: t("alisio.settings.models.saveServer"),
    cancelServerEdit: t("alisio.settings.models.cancelServerEdit"),
    serverNamePrompt: t("alisio.settings.models.serverNamePrompt"),
    serverKindPrompt: t("alisio.settings.models.serverKindPrompt"),
    serverUrlPrompt: t("alisio.settings.models.serverUrlPrompt"),
    serverKeyPrompt: t("alisio.settings.models.serverKeyPrompt"),
    serverActive: t("alisio.settings.models.serverActive"),
    serverApiKeySaved: t("alisio.settings.models.serverApiKeySaved"),
    serverReady: t("alisio.settings.models.serverReady"),
    serverError: t("alisio.settings.models.serverError"),
    openAiCompatible: t("alisio.settings.models.openAiCompatible"),
    ollama: t("alisio.settings.models.ollama"),
    noServerModels: t("alisio.settings.models.noServerModels"),
    activeModel: t("alisio.settings.models.activeModel"),
    chooseModel: t("alisio.settings.models.chooseModel"),
    autoModel: t("alisio.settings.models.autoModel"),
    noModelChoices: t("alisio.settings.models.noModelChoices"),
    modelsAvailable: t("alisio.settings.models.modelsAvailable"),
    server: t("alisio.settings.models.server"),
    servers: t("alisio.settings.models.servers"),
  };
}

const technicalLabelPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveProfileEmail(profile: AiProfile | null | undefined) {
  return profile?.email ?? profile?.identity.email;
}

function resolveProfileKindKey(profile: AiProfile | null | undefined) {
  const plan = (profile?.planLabel ?? profile?.aggregatedTelemetry?.planType ?? "").toLowerCase();
  return /(team|business|enterprise|edu|organization|org|workspace)/.test(plan)
    ? "team"
    : "personal";
}

function resolveProfileKind(profile: AiProfile | null | undefined) {
  const text = aiText();
  return resolveProfileKindKey(profile) === "team" ? text.team : text.personal;
}

function resolveProfileCustomName(profile: AiProfile | null | undefined) {
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
}

function resolveProfileDisplayName(profile: AiProfile | null | undefined) {
  return resolveProfileCustomName(profile) ?? resolveProfileKind(profile);
}

function resolveProfileTitle(profile: AiProfile | null | undefined) {
  return resolveProfileEmail(profile) ?? profile?.label ?? aiText().noAccount;
}

function resolveProfilePlanLabel(profile: AiProfile | null | undefined) {
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
}

function resolveProfileUsageWindows(
  profile: AiProfile | null | undefined,
  ai: AlisioAiState | null | undefined,
) {
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
}

function formatReset(resetAt?: number) {
  const text = aiText();
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
}

function formatConnectedAt(locale: string | undefined, value?: string) {
  const text = aiText();
  if (!value) {
    return text.recentlyConnected;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return text.recentlyConnected;
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(timestamp);
}

function usageTone(remainingPercent: number) {
  if (remainingPercent <= 15) {
    return "is-critical";
  }
  if (remainingPercent <= 40) {
    return "is-warm";
  }
  return "is-healthy";
}

function usageBarStyle(remainingPercent: number) {
  const clamped = Math.max(0, Math.min(100, remainingPercent));
  const hue = Math.round((clamped / 100) * 120);
  return `width:${clamped}%; background:hsl(${hue} 76% 52%);`;
}

function formatHardwareSummary(target: LocalModelTarget) {
  const text = modelsText();
  if (!target.hardware) {
    return null;
  }
  return `${text.hardware} · ${target.hardware.totalMemoryGb} GB RAM · ${target.hardware.cpuCores} CPU`;
}

function resolveTargetRecommendationLabel(target: LocalModelTarget) {
  const text = modelsText();
  if (!target.bestModelName) {
    return null;
  }
  return `${text.recommendedUpTo} ${target.bestModelName}`;
}

function resolveModelRecommendation(
  target: LocalModelTarget,
  modelId: string,
): LocalModelTarget["recommendations"][number] | null {
  return target.recommendations.find((entry) => entry.modelId === modelId) ?? null;
}

function resolveServerKindLabel(kind: RemoteModelServer["kind"]) {
  const text = modelsText();
  return kind === "ollama" ? text.ollama : text.openAiCompatible;
}

function renderServerDraftForm(props: {
  draft: ModelsServerDraft;
  busy: boolean;
  onChange: (field: "label" | "kind" | "baseUrl" | "apiKey", value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const text = modelsText();
  const saveDisabled = props.busy || !props.draft.label.trim() || !props.draft.baseUrl.trim();

  return html`
    <form
      class="alisio-models__server-form"
      @submit=${(event: Event) => {
        event.preventDefault();
        if (!saveDisabled) {
          props.onSubmit();
        }
      }}
    >
      <div class="alisio-models__server-form-head">
        <div class="list-title">
          ${props.draft.mode === "edit" ? text.serverDraftEditTitle : text.serverDraftAddTitle}
        </div>
        <div class="list-sub">${text.serverKeyPrompt}</div>
      </div>
      <div class="alisio-models__server-form-grid">
        <label class="field">
          <span>${text.serverNameLabel}</span>
          <input
            .value=${props.draft.label}
            placeholder=${text.serverNamePrompt}
            @input=${(event: InputEvent) =>
              props.onChange("label", (event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>${text.serverTypeLabel}</span>
          <select
            .value=${props.draft.kind}
            @change=${(event: Event) =>
              props.onChange(
                "kind",
                (event.target as HTMLSelectElement).value as ModelsServerDraft["kind"],
              )}
          >
            <option value="openai-compatible">${text.openAiCompatible}</option>
            <option value="ollama">${text.ollama}</option>
          </select>
        </label>
        <label class="field full">
          <span>${text.serverUrlLabel}</span>
          <input
            .value=${props.draft.baseUrl}
            type="url"
            placeholder=${text.serverUrlPrompt}
            @input=${(event: InputEvent) =>
              props.onChange("baseUrl", (event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field full">
          <span>${text.serverApiKeyLabel}</span>
          <input
            .value=${props.draft.apiKey}
            type="password"
            placeholder=${text.serverKeyPrompt}
            autocomplete="off"
            @input=${(event: InputEvent) =>
              props.onChange("apiKey", (event.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="alisio-models__server-form-actions">
        <button class="btn primary" ?disabled=${saveDisabled} type="submit">
          ${text.saveServer}
        </button>
        <button class="btn" ?disabled=${props.busy} type="button" @click=${props.onCancel}>
          ${text.cancelServerEdit}
        </button>
      </div>
    </form>
  `;
}

function isOpenAiModelValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("openai-codex/") || normalized.startsWith("openai/");
}

function resolveOpenAiModelOptions(options: readonly ChatModelOption[]) {
  return options.filter((entry) => isOpenAiModelValue(entry.value));
}

function countUniqueInstalledModels(targets: readonly LocalModelTarget[]) {
  return new Set(
    targets.flatMap((target) =>
      target.installedModels.map((model) => model.id.trim().toLowerCase()),
    ),
  ).size;
}

function resolvePrimaryLocalSummary(
  targets: readonly LocalModelTarget[],
  catalog: readonly AlisioModelsState["catalog"][number][],
) {
  const installed = targets.flatMap((target) => target.installedModels);
  if (installed.length > 0) {
    return installed[0]?.name ?? "";
  }
  const recommended = targets.find((target) => target.bestModelName)?.bestModelName;
  if (recommended) {
    return recommended;
  }
  return catalog[0]?.name ?? "";
}

function renderOpenAiModelChooser(props: {
  chatModelOptions: readonly ChatModelOption[];
  currentChatModelOverrideValue: string;
  defaultChatModelValue: string;
  defaultChatModelLabel: string;
  effectiveChatModelValue: string;
  effectiveChatModelLabel: string;
  busy: boolean;
  onSelectModel: (value: string) => void;
}) {
  const text = modelsText();
  const openAiOptions = resolveOpenAiModelOptions(props.chatModelOptions);
  const activeModelLabel = isOpenAiModelValue(props.effectiveChatModelValue)
    ? props.effectiveChatModelLabel
    : text.chooseModel;

  return html`
    <section class="alisio-models__chooser">
      <div class="alisio-models__chooser-head">
        <div class="alisio-models__chooser-title">${text.activeModel}</div>
        <div class="list-sub">${activeModelLabel}</div>
      </div>
      <div class="alisio-models__chooser-label">${text.chooseModel}</div>
      ${openAiOptions.length === 0
        ? html`<div class="list-sub">${text.noModelChoices}</div>`
        : html`
            <div class="alisio-models__model-chips">
              ${props.defaultChatModelValue && isOpenAiModelValue(props.defaultChatModelValue)
                ? html`
                    <button
                      class="alisio-models__model-chip ${props.currentChatModelOverrideValue
                        ? ""
                        : "is-active"}"
                      ?disabled=${props.busy}
                      @click=${() => props.onSelectModel("")}
                    >
                      ${text.autoModel}
                    </button>
                  `
                : nothing}
              ${openAiOptions.map(
                (option) => html`
                  <button
                    class="alisio-models__model-chip ${option.value ===
                    props.effectiveChatModelValue
                      ? "is-active"
                      : ""}"
                    ?disabled=${props.busy}
                    @click=${() => props.onSelectModel(option.value)}
                  >
                    ${option.label}
                  </button>
                `,
              )}
            </div>
          `}
      ${props.defaultChatModelLabel
        ? html`<div class="list-sub">${props.defaultChatModelLabel}</div>`
        : nothing}
    </section>
  `;
}

function renderProviderPicker(props: {
  selectedProviderId: ModelProviderId;
  openAiTitle: string;
  openAiPrimary: string;
  openAiSecondary: string;
  serverTitle: string;
  serverPrimary: string;
  serverSecondary: string;
  localTitle: string;
  localPrimary: string;
  localSecondary: string;
  onSelectProvider: (providerId: ModelProviderId) => void;
}) {
  const cards: Array<{
    id: ModelProviderId;
    badge: string;
    title: string;
    primary: string;
    secondary: string;
  }> = [
    {
      id: "openai",
      badge: "OC",
      title: props.openAiTitle,
      primary: props.openAiPrimary,
      secondary: props.openAiSecondary,
    },
    {
      id: "server",
      badge: "OA",
      title: props.serverTitle,
      primary: props.serverPrimary,
      secondary: props.serverSecondary,
    },
    {
      id: "local",
      badge: "L",
      title: props.localTitle,
      primary: props.localPrimary,
      secondary: props.localSecondary,
    },
  ];

  return html`
    <div class="alisio-models__provider-grid">
      ${cards.map(
        (card) => html`
          <button
            type="button"
            class="alisio-models__provider-card ${props.selectedProviderId === card.id
              ? "is-selected"
              : ""}"
            @click=${() => props.onSelectProvider(card.id)}
            aria-pressed=${String(props.selectedProviderId === card.id)}
          >
            <span class="alisio-models__provider-badge">${card.badge}</span>
            <span class="alisio-models__provider-copy">
              <span class="alisio-models__provider-title">${card.title}</span>
              <span class="alisio-models__provider-primary">${card.primary}</span>
              <span class="alisio-models__provider-secondary">${card.secondary}</span>
            </span>
          </button>
        `,
      )}
    </div>
  `;
}

function profileSupportsRename(profile: AiProfile) {
  return resolveProfileKindKey(profile) === "team";
}

function requestRename(
  profile: AiProfile,
  onRenameProfile: (profileId: string, label: string) => void,
) {
  if (typeof window === "undefined") {
    return;
  }
  const nextLabel = window.prompt(aiText().renamePrompt, resolveProfileDisplayName(profile));
  if (nextLabel === null) {
    return;
  }
  onRenameProfile(profile.profileId, nextLabel);
}

function resolveProfiles(ai: AlisioAiState | null | undefined) {
  const activeProfileId = ai?.binding ? ai.activeProfileId : undefined;
  return [...(ai?.profiles ?? [])].toSorted((left, right) => {
    if (left.profileId === activeProfileId) {
      return -1;
    }
    if (right.profileId === activeProfileId) {
      return 1;
    }
    return resolveProfileTitle(left).localeCompare(resolveProfileTitle(right));
  });
}

function renderUsagePreview(profile: AiProfile, ai: AlisioAiState | null | undefined) {
  const windows = resolveProfileUsageWindows(profile, ai).slice(0, 2);
  const text = aiText();
  if (windows.length === 0) {
    return nothing;
  }
  return windows.map(
    (window) => html`
      <span class="alisio-models__usage-pill ${usageTone(window.remainingPercent)}">
        ${window.label} · ${Math.round(window.remainingPercent)}% ${text.available}
      </span>
    `,
  );
}

function renderAiProfileCard(
  profile: AiProfile,
  props: {
    ai: AlisioAiState | null | undefined;
    locale: string | undefined;
    active: boolean;
    expanded: boolean;
    loading: boolean;
    onToggleExpanded: () => void;
    onSelect: () => void;
    onRefresh: () => void;
    onDisconnect: () => void;
    onRename: () => void;
  },
) {
  const text = aiText();
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
  const usageWindows = resolveProfileUsageWindows(profile, props.ai);
  const planLabel = resolveProfilePlanLabel(profile);
  const canRename = profileSupportsRename(profile);

  return html`
    <article
      class="alisio-settings-ai__profile alisio-models__profile ${props.active
        ? "is-active"
        : ""} ${props.expanded ? "is-expanded" : ""}"
    >
      <button
        type="button"
        class="alisio-models__profile-toggle"
        aria-expanded=${String(props.expanded)}
        @click=${props.onToggleExpanded}
      >
        <div class="alisio-settings-ai__profile-head">
          <div>
            <div class="alisio-settings-ai__profile-title">${resolveProfileTitle(profile)}</div>
            <div class="alisio-settings-ai__profile-subtitle">
              ${resolveProfileDisplayName(profile)}
            </div>
          </div>
          <div class="alisio-settings-ai__profile-badges">
            ${planLabel ? html`<span class="pill">${planLabel}</span>` : nothing}
            ${props.active ? html`<span class="pill">${text.active}</span>` : nothing}
            <span class="pill ${profile.status === "expired" ? "danger" : ""}">${statusLabel}</span>
            <span class="alisio-models__profile-chevron" aria-hidden="true"
              >${icons.chevronDown}</span
            >
          </div>
        </div>
        <div class="alisio-models__profile-summary">
          <span class="alisio-models__meta">
            ${text.connectedOn} ${formatConnectedAt(props.locale, profile.connectedAt)}
          </span>
          ${props.expanded ? nothing : renderUsagePreview(profile, props.ai)}
        </div>
      </button>

      ${props.expanded
        ? html`
            <div class="alisio-models__profile-body">
              ${usageWindows.length > 0
                ? html`
                    <div class="alisio-settings-ai__windows">
                      ${usageWindows.map(
                        (window) => html`
                          <div
                            class="alisio-settings-ai__window ${usageTone(window.remainingPercent)}"
                          >
                            <div class="alisio-settings-ai__window-top">
                              <span>${window.label}</span>
                              <strong>${Math.round(window.remainingPercent)}%</strong>
                            </div>
                            <div class="alisio-settings-ai__window-bar">
                              <span style=${usageBarStyle(window.remainingPercent)}></span>
                            </div>
                            <div class="alisio-settings-ai__window-meta">
                              ${text.available} · ${text.resetsIn} ${formatReset(window.resetAt)}
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
                ${canRename
                  ? html`
                      <button class="btn" ?disabled=${props.loading} @click=${props.onRename}>
                        ${text.rename}
                      </button>
                    `
                  : nothing}
                <button class="btn danger" ?disabled=${props.loading} @click=${props.onDisconnect}>
                  ${text.remove}
                </button>
              </div>
            </div>
          `
        : nothing}
    </article>
  `;
}

function renderChatGptSection(props: {
  bootstrap: AlisioBootstrapState | null;
  aiLoading: boolean;
  aiError: string | null;
  expandedProfileId: string | null | undefined;
  chatModelOptions: readonly ChatModelOption[];
  currentChatModelOverrideValue: string;
  defaultChatModelValue: string;
  defaultChatModelLabel: string;
  effectiveChatModelValue: string;
  effectiveChatModelLabel: string;
  modelPickerBusy: boolean;
  onToggleProfile: (profileId: string) => void;
  onConnect: () => void;
  onRefreshAll: () => void;
  onSelectModel: (value: string) => void;
  onSelectProfile: (profileId: string) => void;
  onDisconnectProfile: (profileId: string) => void;
  onRefreshProfile: (profileId: string) => void;
  onRenameProfile: (profileId: string, label: string) => void;
}) {
  const sectionText = modelsText();
  const text = aiText();
  const ai = props.bootstrap?.ai;
  const profiles = resolveProfiles(ai);
  const activeProfileId = ai?.binding ? ai.activeProfileId : undefined;
  const expandedProfileId =
    typeof props.expandedProfileId === "undefined"
      ? (activeProfileId ?? profiles[0]?.profileId ?? null)
      : props.expandedProfileId &&
          profiles.some((profile) => profile.profileId === props.expandedProfileId)
        ? props.expandedProfileId
        : null;

  return html`
    <article class="card alisio-settings-card alisio-models-section">
      <div class="alisio-models-section__header">
        <div>
          <div class="card-title">${sectionText.chatgptTitle}</div>
          <div class="card-sub">${sectionText.chatgptSubtitle}</div>
        </div>
        <div class="alisio-settings-ai__actions">
          <span class="pill"
            >${profiles.length} ${profiles.length === 1 ? text.profile : text.profiles}</span
          >
          ${profiles.length > 0
            ? html`
                <button class="btn" ?disabled=${props.aiLoading} @click=${props.onRefreshAll}>
                  ${text.refreshAll}
                </button>
              `
            : nothing}
          <button
            class="btn ${profiles.length === 0 ? "primary" : ""}"
            ?disabled=${props.aiLoading}
            @click=${props.onConnect}
          >
            ${profiles.length === 0 ? text.connectOpenAi : text.connectAnother}
          </button>
        </div>
      </div>

      ${props.aiError ? html`<div class="callout danger">${props.aiError}</div>` : nothing}
      ${renderOpenAiModelChooser({
        chatModelOptions: props.chatModelOptions,
        currentChatModelOverrideValue: props.currentChatModelOverrideValue,
        defaultChatModelValue: props.defaultChatModelValue,
        defaultChatModelLabel: props.defaultChatModelLabel,
        effectiveChatModelValue: props.effectiveChatModelValue,
        effectiveChatModelLabel: props.effectiveChatModelLabel,
        busy: props.modelPickerBusy,
        onSelectModel: props.onSelectModel,
      })}
      ${profiles.length === 0
        ? html`<div class="alisio-settings-ai__empty">${text.noProfiles}</div>`
        : html`
            <div class="alisio-settings-ai__profile-list">
              ${profiles.map((profile) =>
                renderAiProfileCard(profile, {
                  ai,
                  locale: props.bootstrap?.account?.preferences?.language,
                  active: profile.profileId === activeProfileId,
                  expanded: profile.profileId === expandedProfileId,
                  loading: props.aiLoading,
                  onToggleExpanded: () => props.onToggleProfile(profile.profileId),
                  onSelect: () => props.onSelectProfile(profile.profileId),
                  onRefresh: () => props.onRefreshProfile(profile.profileId),
                  onDisconnect: () => props.onDisconnectProfile(profile.profileId),
                  onRename: () => requestRename(profile, props.onRenameProfile),
                }),
              )}
            </div>
          `}
    </article>
  `;
}

function renderLocalModelsSection(props: {
  models: AlisioModelsState | null;
  modelsLoading: boolean;
  modelsError: string | null;
  onInstallModel: (targetId: string, modelId: string) => void;
}) {
  const text = modelsText();
  const targets = props.models?.targets ?? [];
  const publishedModels = props.models?.catalog ?? [];

  return html`
    <article class="card alisio-settings-card alisio-models-section">
      <div class="alisio-models-section__header">
        <div>
          <div class="card-title">${text.localTitle}</div>
          <div class="card-sub">${text.localSubtitle}</div>
        </div>
        <span class="pill">${text.backend} · ${props.models?.backend ?? "llama.cpp"}</span>
      </div>

      ${props.modelsError ? html`<div class="callout danger">${props.modelsError}</div>` : nothing}
      ${props.modelsLoading && !props.models
        ? html`<div class="alisio-settings-ai__empty">${t("chat.loading")}</div>`
        : nothing}

      <div class="alisio-models__targets">
        ${targets.map(
          (target) => html`
            <div class="alisio-models__target">
              <div class="alisio-models__target-head">
                <div>
                  <div class="list-title">${target.label}</div>
                  <div class="list-sub">
                    ${[target.current ? text.currentComputer : text.linkedComputer, target.platform]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div class="alisio-settings-ai__profile-badges">
                  ${target.current
                    ? html`<span class="pill">${text.activeComputer}</span>`
                    : nothing}
                  ${target.connected ? html`<span class="pill">${text.connected}</span>` : nothing}
                </div>
              </div>
              <div class="alisio-models__target-meta">
                <span
                  class=${target.runtimeStatus === "ready"
                    ? "alisio-models__status is-ready"
                    : "alisio-models__status"}
                >
                  ${target.runtimeStatus === "ready"
                    ? text.modelSourceReady
                    : target.runtimeStatus === "not_configured"
                      ? text.runtimeNotConfigured
                      : text.runtimeError}
                </span>
                ${formatHardwareSummary(target)
                  ? html`<span class="alisio-models__status"
                      >${formatHardwareSummary(target)}</span
                    >`
                  : nothing}
              </div>
              ${target.runtimeMessage
                ? html`<div class="list-sub">${target.runtimeMessage}</div>`
                : nothing}
              ${resolveTargetRecommendationLabel(target)
                ? html`<div class="list-sub">${resolveTargetRecommendationLabel(target)}</div>`
                : nothing}
              <div class="alisio-models__installed">
                <div class="alisio-models__installed-title">${text.installedModels}</div>
                ${target.installedModels.length > 0
                  ? html`
                      <div class="alisio-models__installed-list">
                        ${target.installedModels.map(
                          (model) => html`<span class="pill">${model.name}</span>`,
                        )}
                      </div>
                    `
                  : html`<div class="list-sub">${text.noInstalledModels}</div>`}
              </div>
            </div>
          `,
        )}
      </div>

      ${targets.length === 0
        ? html`<div class="alisio-settings-ai__empty">${text.noTargets}</div>`
        : nothing}
      ${publishedModels.length === 0
        ? html`<div class="alisio-settings-ai__empty">${text.noLocalModels}</div>`
        : html`
            <div class="alisio-models__catalog">
              ${publishedModels.map(
                (model) => html`
                  <div class="alisio-models__catalog-item">
                    <div>
                      <div class="list-title">${model.name}</div>
                      <div class="list-sub">
                        ${model.parametersBillions}B · ${model.quantization} · ${model.summary} ·
                        ${text.memory} ${model.memoryGb} GB · ${text.disk} ${model.diskGb} GB
                      </div>
                    </div>
                    <div class="alisio-models__catalog-actions">
                      ${targets.map((target) => {
                        const installed = target.installedModels.some(
                          (installedModel) => installedModel.id === model.id,
                        );
                        const recommendation = resolveModelRecommendation(target, model.id);
                        const unsupported = recommendation?.grade === "unsupported";
                        return html`
                          <button
                            class="btn"
                            ?disabled=${props.modelsLoading ||
                            installed ||
                            !target.connected ||
                            unsupported}
                            @click=${() => props.onInstallModel(target.targetId, model.id)}
                            title=${recommendation?.reason ?? ""}
                          >
                            ${installed
                              ? text.installed
                              : `${text.install} · ${target.label}${recommendation ? ` · ${recommendation.label}` : ""}`}
                          </button>
                        `;
                      })}
                    </div>
                  </div>
                `,
              )}
            </div>
          `}
    </article>
  `;
}

function renderServersSection(props: {
  models: AlisioModelsState | null;
  modelsLoading: boolean;
  serverDraft: ModelsServerDraft | null | undefined;
  onStartCreateServer: () => void;
  onStartEditServer: (server: RemoteModelServer) => void;
  onChangeServerDraft: (field: "label" | "kind" | "baseUrl" | "apiKey", value: string) => void;
  onCancelServerDraft: () => void;
  onSubmitServerDraft: () => void;
  onRemoveServer: (serverId: string) => void;
  onSelectServer: (serverId: string) => void;
}) {
  const text = modelsText();
  const servers = props.models?.servers ?? [];
  return html`
    <article class="card alisio-settings-card alisio-models-section">
      <div class="alisio-models-section__header">
        <div>
          <div class="card-title">${text.serversTitle}</div>
          <div class="card-sub">${text.serversSubtitle}</div>
        </div>
        <button class="btn" ?disabled=${props.modelsLoading} @click=${props.onStartCreateServer}>
          ${text.addServer}
        </button>
      </div>
      ${props.serverDraft
        ? renderServerDraftForm({
            draft: props.serverDraft,
            busy: props.modelsLoading,
            onChange: props.onChangeServerDraft,
            onCancel: props.onCancelServerDraft,
            onSubmit: props.onSubmitServerDraft,
          })
        : nothing}
      ${servers.length === 0
        ? html`<div class="alisio-settings-ai__empty">${text.emptyServers}</div>`
        : html`
            <div class="alisio-models__targets">
              ${servers.map(
                (server) => html`
                  <div class="alisio-models__target">
                    <div class="alisio-models__target-head">
                      <div>
                        <div class="list-title">${server.label}</div>
                        <div class="list-sub">${server.baseUrl}</div>
                      </div>
                      <div class="alisio-settings-ai__profile-badges">
                        <span class="pill">${resolveServerKindLabel(server.kind)}</span>
                        ${server.active
                          ? html`<span class="pill">${text.serverActive}</span>`
                          : nothing}
                        <span class="pill ${server.status === "error" ? "danger" : ""}">
                          ${server.status === "ready"
                            ? text.serverReady
                            : server.status === "not_configured"
                              ? text.runtimeNotConfigured
                              : text.serverError}
                        </span>
                      </div>
                    </div>
                    <div class="alisio-models__target-meta">
                      ${server.hasApiKey
                        ? html`<span class="alisio-models__status">${text.serverApiKeySaved}</span>`
                        : nothing}
                    </div>
                    ${server.message
                      ? html`<div class="list-sub">${server.message}</div>`
                      : nothing}
                    <div class="alisio-models__installed">
                      <div class="alisio-models__installed-title">${text.installedModels}</div>
                      ${server.models.length > 0
                        ? html`
                            <div class="alisio-models__installed-list">
                              ${server.models.map(
                                (model) => html`<span class="pill">${model.name}</span>`,
                              )}
                            </div>
                          `
                        : html`<div class="list-sub">${text.noServerModels}</div>`}
                    </div>
                    <div class="alisio-settings-ai__profile-actions">
                      ${!server.active
                        ? html`
                            <button
                              class="btn"
                              ?disabled=${props.modelsLoading}
                              @click=${() => props.onSelectServer(server.serverId)}
                            >
                              ${text.activateServer}
                            </button>
                          `
                        : nothing}
                      <button
                        class="btn"
                        ?disabled=${props.modelsLoading}
                        @click=${() => props.onStartEditServer(server)}
                      >
                        ${text.editServer}
                      </button>
                      <button
                        class="btn danger"
                        ?disabled=${props.modelsLoading}
                        @click=${() => props.onRemoveServer(server.serverId)}
                      >
                        ${text.removeServer}
                      </button>
                    </div>
                  </div>
                `,
              )}
            </div>
          `}
    </article>
  `;
}

export function renderModelsHub(props: {
  bootstrap: AlisioBootstrapState | null;
  models: AlisioModelsState | null;
  modelsLoading: boolean;
  modelsError: string | null;
  aiLoading: boolean;
  aiError: string | null;
  expandedProfileId: string | null | undefined;
  selectedProviderId: ModelProviderId | null | undefined;
  chatModelOptions: readonly ChatModelOption[];
  currentChatModelOverrideValue: string;
  defaultChatModelValue: string;
  defaultChatModelLabel: string;
  effectiveChatModelValue: string;
  effectiveChatModelLabel: string;
  modelPickerBusy: boolean;
  serverDraft: ModelsServerDraft | null | undefined;
  onToggleProfile: (profileId: string) => void;
  onSelectProvider: (providerId: ModelProviderId) => void;
  onConnectAi: () => void;
  onRefreshAllAiProfiles: () => void;
  onSelectChatModel: (value: string) => void;
  onSelectAiProfile: (profileId: string) => void;
  onDisconnectAiProfile: (profileId: string) => void;
  onRefreshAiProfile: (profileId: string) => void;
  onRenameAiProfile: (profileId: string, label: string) => void;
  onInstallModel: (targetId: string, modelId: string) => void;
  onStartCreateServer: () => void;
  onStartEditServer: (server: RemoteModelServer) => void;
  onChangeServerDraft: (field: "label" | "kind" | "baseUrl" | "apiKey", value: string) => void;
  onCancelServerDraft: () => void;
  onSubmitServerDraft: () => void;
  onSaveServer: (params: {
    serverId?: string;
    label: string;
    kind: "openai-compatible" | "ollama";
    baseUrl: string;
    apiKey?: string;
  }) => void;
  onRemoveServer: (serverId: string) => void;
  onSelectServer: (serverId: string) => void;
}) {
  const text = modelsText();
  const aiTextValues = aiText();
  const profiles = resolveProfiles(props.bootstrap?.ai);
  const servers = props.models?.servers ?? [];
  const activeServer = servers.find((server) => server.active) ?? servers[0] ?? null;
  const localTargets = props.models?.targets ?? [];
  const localCatalog = props.models?.catalog ?? [];
  const uniqueInstalledModels = countUniqueInstalledModels(localTargets);
  const selectedProviderId =
    props.selectedProviderId ??
    (profiles.length > 0 ? "openai" : localCatalog.length > 0 ? "local" : "server");
  const localPrimary = resolvePrimaryLocalSummary(localTargets, localCatalog) || text.localTitle;
  const localSecondary =
    uniqueInstalledModels > 0
      ? `${uniqueInstalledModels} ${text.installedModels.toLowerCase()}`
      : `${localCatalog.length} ${text.modelsAvailable}`;
  const serverPrimary = activeServer?.label ?? text.addServer;
  const serverSecondary = activeServer
    ? `${activeServer.models.length} ${text.modelsAvailable}`
    : `${servers.length} ${servers.length === 1 ? text.server : text.servers}`;
  const openAiPrimary = isOpenAiModelValue(props.effectiveChatModelValue)
    ? props.effectiveChatModelLabel
    : profiles[0]
      ? resolveProfileTitle(profiles[0])
      : aiTextValues.noProfiles;
  const openAiSecondary = `${profiles.length} ${profiles.length === 1 ? aiTextValues.profile : aiTextValues.profiles}`;

  return html`
    <section class="alisio-page alisio-models-page">
      <div class="alisio-models-layout">
        ${renderProviderPicker({
          selectedProviderId,
          openAiTitle: text.chatgptTitle,
          openAiPrimary,
          openAiSecondary,
          serverTitle: text.serversTitle,
          serverPrimary,
          serverSecondary,
          localTitle: text.localTitle,
          localPrimary,
          localSecondary,
          onSelectProvider: props.onSelectProvider,
        })}
        ${selectedProviderId === "openai"
          ? renderChatGptSection({
              bootstrap: props.bootstrap,
              aiLoading: props.aiLoading,
              aiError: props.aiError,
              expandedProfileId: props.expandedProfileId,
              chatModelOptions: props.chatModelOptions,
              currentChatModelOverrideValue: props.currentChatModelOverrideValue,
              defaultChatModelValue: props.defaultChatModelValue,
              defaultChatModelLabel: props.defaultChatModelLabel,
              effectiveChatModelValue: props.effectiveChatModelValue,
              effectiveChatModelLabel: props.effectiveChatModelLabel,
              modelPickerBusy: props.modelPickerBusy,
              onToggleProfile: props.onToggleProfile,
              onConnect: props.onConnectAi,
              onRefreshAll: props.onRefreshAllAiProfiles,
              onSelectModel: props.onSelectChatModel,
              onSelectProfile: props.onSelectAiProfile,
              onDisconnectProfile: props.onDisconnectAiProfile,
              onRefreshProfile: props.onRefreshAiProfile,
              onRenameProfile: props.onRenameAiProfile,
            })
          : nothing}
        ${selectedProviderId === "local"
          ? renderLocalModelsSection({
              models: props.models,
              modelsLoading: props.modelsLoading,
              modelsError: props.modelsError,
              onInstallModel: props.onInstallModel,
            })
          : nothing}
        ${selectedProviderId === "server"
          ? renderServersSection({
              models: props.models,
              modelsLoading: props.modelsLoading,
              serverDraft: props.serverDraft,
              onStartCreateServer: props.onStartCreateServer,
              onStartEditServer: props.onStartEditServer,
              onChangeServerDraft: props.onChangeServerDraft,
              onCancelServerDraft: props.onCancelServerDraft,
              onSubmitServerDraft: props.onSubmitServerDraft,
              onRemoveServer: props.onRemoveServer,
              onSelectServer: props.onSelectServer,
            })
          : nothing}
      </div>
    </section>
  `;
}
