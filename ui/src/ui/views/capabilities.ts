import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { SkillMessageMap } from "../controllers/skills.ts";
import { clampText } from "../format.ts";
import type {
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  ChannelsStatusSnapshot,
  SkillStatusEntry,
  SkillStatusReport,
} from "../types.ts";
import { summarizeChannelsSnapshot } from "./channel-display.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonPill,
  renderSkeletonStatCards,
  renderSkeletonListItem,
} from "./loading-skeleton.ts";
import {
  buildSkillStatusCounts,
  renderSkillDetailDialog,
  skillMatchesStatus,
  skillStatusClass,
  skillStatusLabel,
  type SkillsStatusFilter,
} from "./skills-shared.ts";
type CapabilityStatus = "ready" | "partial" | "needs-setup" | "not-exposed";

type CapabilityCard = {
  id: string;
  title: string;
  body: string;
  status: CapabilityStatus;
  actionLabel?: string;
  action?: () => void;
};

export type CapabilitiesProps = {
  connected: boolean;
  loading: boolean;
  report: SkillStatusReport | null;
  error: string | null;
  filter: string;
  statusFilter: SkillsStatusFilter;
  edits: Record<string, string>;
  busyKey: string | null;
  messages: SkillMessageMap;
  detailKey: string | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  connectorCatalog: AlisioConnectorDefinition[];
  connectorAuthorizations: AlisioConnectorAuthorization[];
  onFilterChange: (next: string) => void;
  onStatusFilterChange: (next: SkillsStatusFilter) => void;
  onRefresh: () => void;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onDetailOpen: (skillKey: string) => void;
  onDetailClose: () => void;
  onOpenChannels: () => void;
  onOpenAuthentications: () => void;
};

const FAMILY_DEFINITIONS = [
  {
    id: "research",
    titleKey: "alisio.capabilities.cards.researchTitle",
    bodyKey: "alisio.capabilities.cards.researchBody",
    patterns: ["web", "search", "browser", "research", "docs"],
  },
  {
    id: "documents",
    titleKey: "alisio.capabilities.cards.documentsTitle",
    bodyKey: "alisio.capabilities.cards.documentsBody",
    patterns: ["pdf", "document", "file", "canvas", "notes"],
  },
  {
    id: "images",
    titleKey: "alisio.capabilities.cards.imagesTitle",
    bodyKey: "alisio.capabilities.cards.imagesBody",
    patterns: ["image", "photo", "vision", "sora", "art"],
  },
  {
    id: "automation",
    titleKey: "alisio.capabilities.cards.automationTitle",
    bodyKey: "alisio.capabilities.cards.automationBody",
    patterns: ["cron", "automation", "schedule", "routine", "workflow"],
  },
] as const;

function channelSignals(snapshot: ChannelsStatusSnapshot | null) {
  const summary = summarizeChannelsSnapshot(snapshot);
  return {
    total: summary.totalChannels,
    connected: summary.connectedChannels,
    active: summary.activeChannels,
  };
}

function connectedAppsCount(authorizations: AlisioConnectorAuthorization[]) {
  return authorizations.filter((entry) => entry.state === "connected").length;
}

function statusFilterLabel(status: SkillsStatusFilter) {
  switch (status) {
    case "ready":
      return t("alisio.capabilities.filters.ready");
    case "needs-setup":
      return t("alisio.capabilities.filters.needsSetup");
    case "disabled":
      return t("alisio.capabilities.filters.disabled");
    case "all":
    default:
      return t("alisio.capabilities.filters.all");
  }
}

function capabilityStatusLabel(status: CapabilityStatus) {
  switch (status) {
    case "ready":
      return t("alisio.capabilities.status.ready");
    case "partial":
      return t("alisio.capabilities.status.partial");
    case "needs-setup":
      return t("alisio.capabilities.status.needsSetup");
    case "not-exposed":
    default:
      return t("alisio.capabilities.status.notExposed");
  }
}

function capabilityStatusClass(status: CapabilityStatus) {
  switch (status) {
    case "ready":
      return "chip chip-ok";
    case "partial":
      return "chip chip-active";
    case "needs-setup":
      return "chip chip-warn";
    case "not-exposed":
    default:
      return "chip";
  }
}

function matchFamilySkills(skills: SkillStatusEntry[], patterns: readonly string[]) {
  return skills.filter((skill) => {
    const haystack = [skill.skillKey, skill.name, skill.description, skill.source]
      .join(" ")
      .toLowerCase();
    return patterns.some((pattern) => haystack.includes(pattern));
  });
}

function resolveSkillFamilyStatus(skills: SkillStatusEntry[]): CapabilityStatus {
  if (skills.length === 0) {
    return "not-exposed";
  }
  const readyCount = skills.filter((skill) => !skill.disabled && skill.eligible).length;
  if (readyCount === 0) {
    return "needs-setup";
  }
  if (readyCount === skills.length) {
    return "ready";
  }
  return "partial";
}

function buildCapabilityCards(props: CapabilitiesProps): CapabilityCard[] {
  const skills = props.report?.skills ?? [];
  const channels = channelSignals(props.channelsSnapshot);
  const connectedApps = connectedAppsCount(props.connectorAuthorizations);

  const cards: CapabilityCard[] = [
    {
      id: "channels",
      title: t("alisio.capabilities.cards.channelsTitle"),
      body: t("alisio.capabilities.cards.channelsBody"),
      status:
        channels.connected > 0
          ? "ready"
          : channels.active > 0
            ? "partial"
            : channels.total > 0
              ? "needs-setup"
              : "not-exposed",
      actionLabel: t("alisio.capabilities.cards.openChannels"),
      action: props.onOpenChannels,
    },
    {
      id: "apps",
      title: t("alisio.capabilities.cards.appsTitle"),
      body: t("alisio.capabilities.cards.appsBody"),
      status:
        connectedApps > 0
          ? "ready"
          : props.connectorCatalog.length > 0
            ? "needs-setup"
            : "not-exposed",
      actionLabel: t("alisio.capabilities.cards.openApps"),
      action: props.onOpenAuthentications,
    },
  ];

  for (const family of FAMILY_DEFINITIONS) {
    const familySkills = matchFamilySkills(skills, family.patterns);
    cards.push({
      id: family.id,
      title: t(family.titleKey),
      body: t(family.bodyKey),
      status: resolveSkillFamilyStatus(familySkills),
    });
  }
  return cards;
}

function renderCapabilityCard(card: CapabilityCard) {
  return html`
    <article class="card capability-card">
      <div class="row capability-card__header">
        <div class="card-title">${card.title}</div>
        <span class=${capabilityStatusClass(card.status)}
          >${capabilityStatusLabel(card.status)}</span
        >
      </div>
      <div class="card-sub capability-card__body">${card.body}</div>
      ${card.action && card.actionLabel
        ? html`
            <div class="capability-card__action">
              <button class="btn btn--sm" @click=${card.action}>${card.actionLabel}</button>
            </div>
          `
        : nothing}
    </article>
  `;
}

function renderCapabilitySkeletonCard() {
  return html`
    <article class="card capability-card capability-card--loading" aria-hidden="true">
      <div class="row capability-card__header">
        ${renderSkeletonLines(["medium"], { compact: true })} ${renderSkeletonPill({ small: true })}
      </div>
      <div class="capability-card__body">
        ${renderSkeletonLines(["full", "long"], { compact: true })}
      </div>
      <div class="capability-card__action">${renderSkeletonButton({ small: true })}</div>
    </article>
  `;
}

function renderSkillCard(skill: SkillStatusEntry, props: CapabilitiesProps) {
  return html`
    <div
      class="list-item list-item-clickable capability-skill-row"
      @click=${() => props.onDetailOpen(skill.skillKey)}
    >
      <div class="list-main">
        <div class="list-title capability-skill-row__title">
          <span class="statusDot ${skillStatusClass(skill)}"></span>
          ${skill.emoji ? html`<span>${skill.emoji}</span>` : nothing}
          <span>${skill.name}</span>
        </div>
        <div class="list-sub capability-skill-row__description">
          ${clampText(skill.description, 140)}
        </div>
      </div>
      <div class="list-meta capability-skill-row__meta">
        <span
          class=${capabilityStatusClass(
            skill.disabled || skill.blockedByAllowlist || !skill.eligible ? "needs-setup" : "ready",
          )}
        >
          ${skillStatusLabel(skill)}
        </span>
      </div>
    </div>
  `;
}

function renderSkillDetail(skill: SkillStatusEntry, props: CapabilitiesProps) {
  return renderSkillDetailDialog(skill, props);
}

export function renderCapabilities(props: CapabilitiesProps) {
  const showInitialLoading = props.loading && props.connected && !props.report;
  const skills = props.report?.skills ?? [];
  const statusCounts = buildSkillStatusCounts(skills);

  const filteredByStatus =
    props.statusFilter === "all"
      ? skills
      : skills.filter((skill) => skillMatchesStatus(skill, props.statusFilter));
  const search = props.filter.trim().toLowerCase();
  const filteredSkills = search
    ? filteredByStatus.filter((skill) =>
        [skill.name, skill.description, skill.source, skill.skillKey]
          .join(" ")
          .toLowerCase()
          .includes(search),
      )
    : filteredByStatus;
  const detailSkill =
    props.detailKey != null
      ? (skills.find((skill) => skill.skillKey === props.detailKey) ?? null)
      : null;
  const capabilityCards = buildCapabilityCards(props);
  const channels = channelSignals(props.channelsSnapshot);
  const connectedApps = connectedAppsCount(props.connectorAuthorizations);

  return html`
    <section class="alisio-page" style="display: grid; gap: 16px;">
      <div class="card">
        <div class="alisio-page__eyebrow">${t("alisio.capabilities.eyebrow")}</div>
        <div class="row capabilities-hero">
          <div>
            <div class="card-title">${t("alisio.capabilities.title")}</div>
            <div class="card-sub">${t("alisio.capabilities.subtitle")}</div>
          </div>
          <button
            class="btn"
            ?disabled=${props.loading || !props.connected}
            @click=${props.onRefresh}
          >
            ${props.loading
              ? t("alisio.capabilities.refreshing")
              : t("alisio.capabilities.refresh")}
          </button>
        </div>

        <div class="alisio-summary-grid alisio-summary-grid--spacious">
          ${showInitialLoading
            ? renderSkeletonStatCards(4)
            : html`
                <article class="list-item">
                  <div class="list-title">${statusCounts.ready}</div>
                  <div class="list-sub">${t("alisio.capabilities.summary.readyNow")}</div>
                </article>
                <article class="list-item">
                  <div class="list-title">
                    ${statusCounts["needs-setup"] + statusCounts.disabled}
                  </div>
                  <div class="list-sub">${t("alisio.capabilities.summary.needsSetup")}</div>
                </article>
                <article class="list-item">
                  <div class="list-title">${connectedApps}</div>
                  <div class="list-sub">${t("alisio.capabilities.summary.connectedApps")}</div>
                </article>
                <article class="list-item">
                  <div class="list-title">${channels.connected}</div>
                  <div class="list-sub">${t("alisio.capabilities.summary.liveChannels")}</div>
                </article>
              `}
        </div>

        ${props.error
          ? html`<div class="callout danger" style="margin-top: 16px;">${props.error}</div>`
          : nothing}
      </div>

      <div class="capabilities-card-grid">
        ${showInitialLoading
          ? Array.from({ length: 6 }, () => renderCapabilitySkeletonCard())
          : capabilityCards.map((card) => renderCapabilityCard(card))}
      </div>

      <section class="card">
        <div class="row capabilities-advanced-header">
          <div>
            <div class="card-title">${t("alisio.capabilities.advancedTitle")}</div>
            <div class="card-sub">${t("alisio.capabilities.advancedSubtitle")}</div>
          </div>
          <a class="btn btn--sm" href="https://clawhub.com" target="_blank" rel="noreferrer">
            ${t("alisio.capabilities.browseStore")}
          </a>
        </div>

        <div class="agent-tabs" style="margin-top: 14px;">
          ${(["all", "ready", "needs-setup", "disabled"] as SkillsStatusFilter[]).map(
            (status) => html`
              <button
                class="agent-tab ${props.statusFilter === status ? "active" : ""}"
                @click=${() => props.onStatusFilterChange(status)}
              >
                ${statusFilterLabel(status)}
                <span class="agent-tab-count">${statusCounts[status]}</span>
              </button>
            `,
          )}
        </div>

        <div class="filters capabilities-filters">
          <label class="field" style="flex: 1; min-width: 220px;">
            <input
              .value=${props.filter}
              @input=${(event: Event) =>
                props.onFilterChange((event.target as HTMLInputElement).value)}
              placeholder=${t("alisio.capabilities.searchPlaceholder")}
              autocomplete="off"
            />
          </label>
          <div class="muted">
            ${t("alisio.capabilities.shown", { count: String(filteredSkills.length) })}
          </div>
        </div>

        ${showInitialLoading
          ? html`
              <div
                class="capabilities-skeleton-list"
                role="status"
                aria-label="Loading capabilities"
              >
                ${renderSkeletonListItem({ lines: ["medium", "long"], aside: "pill" })}
                ${renderSkeletonListItem({ lines: ["long", "medium"], aside: "pill" })}
                ${renderSkeletonListItem({ lines: ["short", "medium"], aside: "pill" })}
              </div>
            `
          : filteredSkills.length === 0
            ? html`
                <div class="muted" style="margin-top: 16px;">
                  ${!props.connected && !props.report
                    ? t("alisio.capabilities.notConnected")
                    : t("alisio.capabilities.empty")}
                </div>
              `
            : html`
                <div class="list capabilities-skill-list">
                  ${filteredSkills.map((skill) => renderSkillCard(skill, props))}
                </div>
              `}
      </section>

      ${detailSkill ? renderSkillDetail(detailSkill, props) : nothing}
    </section>
  `;
}
