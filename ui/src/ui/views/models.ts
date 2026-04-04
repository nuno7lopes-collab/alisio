import { html, nothing } from "lit";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  listPublishedAlisioLocalModels,
} from "../../../../src/shared/alisio-local-models.js";
import type { NodeListNode } from "../../../../src/shared/node-list-types.js";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { AlisioAccountState, AlisioAiState, AlisioBootstrapState } from "../types.ts";

type AiProfile = NonNullable<AlisioAiState["profiles"]>[number];

type ModelTarget = {
  id: string;
  title: string;
  subtitle: string;
  connected: boolean;
  current: boolean;
  modelRuntimeReady: boolean;
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
    backend: t("alisio.settings.models.backend"),
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

function resolveModelTargets(account: AlisioAccountState | null, nodes: readonly NodeListNode[]) {
  const text = modelsText();
  const currentDevice = account?.devices.find((device) => device.current) ?? account?.devices[0];
  const targets: ModelTarget[] = [
    {
      id: currentDevice?.id ?? "current",
      title: currentDevice?.label ?? text.currentComputer,
      subtitle: [currentDevice?.platform, text.activeComputer].filter(Boolean).join(" · "),
      connected: true,
      current: true,
      modelRuntimeReady: true,
    },
  ];

  const linkedNodes = nodes
    .filter((node) => node.nodeId && node.connected)
    .toSorted((left, right) =>
      (left.displayName ?? left.platform ?? left.nodeId).localeCompare(
        right.displayName ?? right.platform ?? right.nodeId,
      ),
    );

  for (const node of linkedNodes) {
    const modelRuntimeReady = Boolean(
      node.capabilities?.some((capability) => capability.id === "model.chat.openai.v1"),
    );
    targets.push({
      id: node.nodeId,
      title: node.displayName ?? node.platform ?? node.nodeId,
      subtitle: [text.linkedComputer, node.platform].filter(Boolean).join(" · "),
      connected: Boolean(node.connected),
      current: false,
      modelRuntimeReady,
    });
  }

  return targets;
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
          ${renderUsagePreview(profile, props.ai)}
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
                              <span
                                style=${`width:${Math.max(4, window.remainingPercent)}%`}
                              ></span>
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
  onToggleProfile: (profileId: string) => void;
  onConnect: () => void;
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
  account: AlisioAccountState | null;
  nodes: readonly NodeListNode[];
}) {
  const text = modelsText();
  const targets = resolveModelTargets(props.account, props.nodes);
  const linkedTargets = targets.filter((target) => !target.current);
  const publishedModels = listPublishedAlisioLocalModels();

  return html`
    <article class="card alisio-settings-card alisio-models-section">
      <div class="alisio-models-section__header">
        <div>
          <div class="card-title">${text.localTitle}</div>
          <div class="card-sub">${text.localSubtitle}</div>
        </div>
        <span class="pill">${text.backend} · ${ALISIO_LOCAL_MODEL_BACKEND}</span>
      </div>

      <div class="alisio-models__targets">
        ${targets.map(
          (target) => html`
            <div class="alisio-models__target">
              <div class="alisio-models__target-head">
                <div>
                  <div class="list-title">${target.title}</div>
                  <div class="list-sub">${target.subtitle}</div>
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
                  class=${target.modelRuntimeReady
                    ? "alisio-models__status is-ready"
                    : "alisio-models__status"}
                >
                  ${target.modelRuntimeReady ? text.modelSourceReady : text.modelSourcePending}
                </span>
              </div>
            </div>
          `,
        )}
      </div>

      ${linkedTargets.length === 0
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
                        ${model.parametersBillions}B · ${model.quantization} · ${model.summary}
                      </div>
                    </div>
                    <button class="btn" disabled>${text.install}</button>
                  </div>
                `,
              )}
            </div>
          `}
    </article>
  `;
}

function renderServersSection() {
  const text = modelsText();
  return html`
    <article class="card alisio-settings-card alisio-models-section">
      <div class="alisio-models-section__header">
        <div>
          <div class="card-title">${text.serversTitle}</div>
          <div class="card-sub">${text.serversSubtitle}</div>
        </div>
      </div>
      <div class="alisio-settings-ai__empty">${text.emptyServers}</div>
    </article>
  `;
}

export function renderModelsHub(props: {
  bootstrap: AlisioBootstrapState | null;
  account: AlisioAccountState | null;
  nodes: readonly NodeListNode[];
  aiLoading: boolean;
  aiError: string | null;
  expandedProfileId: string | null | undefined;
  onToggleProfile: (profileId: string) => void;
  onConnectAi: () => void;
  onSelectAiProfile: (profileId: string) => void;
  onDisconnectAiProfile: (profileId: string) => void;
  onRefreshAiProfile: (profileId: string) => void;
  onRenameAiProfile: (profileId: string, label: string) => void;
}) {
  return html`
    <section class="alisio-page alisio-models-page">
      <div class="alisio-models-layout">
        ${renderChatGptSection({
          bootstrap: props.bootstrap,
          aiLoading: props.aiLoading,
          aiError: props.aiError,
          expandedProfileId: props.expandedProfileId,
          onToggleProfile: props.onToggleProfile,
          onConnect: props.onConnectAi,
          onSelectProfile: props.onSelectAiProfile,
          onDisconnectProfile: props.onDisconnectAiProfile,
          onRefreshProfile: props.onRefreshAiProfile,
          onRenameProfile: props.onRenameAiProfile,
        })}
        ${renderLocalModelsSection({
          account: props.account ?? props.bootstrap?.account ?? null,
          nodes: props.nodes,
        })}
        ${renderServersSection()}
      </div>
    </section>
  `;
}
