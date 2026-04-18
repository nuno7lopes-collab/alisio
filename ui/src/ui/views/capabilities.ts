import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  SkillActionOutput,
  SkillConsentRequest,
  SkillMessageMap,
} from "../controllers/skills.ts";
import { clampText } from "../format.ts";
import { mergeSkillStatusEntries } from "../skills-report.ts";
import type {
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  ChannelsStatusSnapshot,
  SkillStatusEntry,
  SkillStatusReport,
} from "../types.ts";
import {
  renderSkeletonPill,
  renderSkeletonListItem,
  renderSurfaceEmptyState,
} from "./loading-skeleton.ts";
import {
  buildSkillStatusCounts,
  isSkillNotInstalled,
  renderSkillDetailDialog,
  skillMatchesStatus,
  skillStatusClass,
  skillStatusLabel,
  type SkillsStatusFilter,
} from "./skills-shared.ts";

type CapabilityStatus = "ready" | "partial" | "not-installed" | "needs-setup" | "not-exposed";

type CapabilitySkillSection = {
  id: "local" | "catalog";
  title: string;
  subtitle: string;
  skills: SkillStatusEntry[];
};

const capabilityStatusCountsCache = new WeakMap<
  SkillStatusEntry[],
  ReturnType<typeof buildSkillStatusCounts>
>();
const capabilitySectionsCache = new WeakMap<SkillStatusEntry[], CapabilitySkillSection[]>();
const capabilityFilteredSkillsCache = new WeakMap<
  SkillStatusEntry[],
  Map<string, SkillStatusEntry[]>
>();

export type CapabilitiesProps = {
  connected: boolean;
  connectionError?: string | null;
  loading: boolean;
  report: SkillStatusReport | null;
  error: string | null;
  filter: string;
  statusFilter: SkillsStatusFilter;
  edits: Record<string, string>;
  busyKey: string | null;
  messages: SkillMessageMap;
  actionOutputs: Record<string, SkillActionOutput>;
  consentRequest: SkillConsentRequest | null;
  detailKey: string | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  connectorCatalog: AlisioConnectorDefinition[];
  connectorAuthorizations: AlisioConnectorAuthorization[];
  onFilterChange: (next: string) => void;
  onStatusFilterChange: (next: SkillsStatusFilter) => void;
  onRefresh: () => void;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onEnvEdit: (skillKey: string, envName: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onSaveEnv: (skillKey: string, envName: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onMarketplaceInstall: (skillKey: string) => void;
  onMarketplaceRemove: (skillKey: string) => void;
  onMarketplaceExecute: (skillKey: string) => void;
  onConsentResolve: (decision: "allow-once" | "allow-always" | "deny") => void;
  onConsentDismiss: () => void;
  onEnableConfig: (skillKey: string, configPath: string) => void;
  onAllowBundled: (skillKey: string) => void;
  onDetailOpen: (skillKey: string) => void;
  onDetailClose: () => void;
  onOpenChannels: () => void;
  onOpenAuthentications: () => void;
  onOpenSettings: () => void;
};

function statusFilterLabel(status: SkillsStatusFilter) {
  switch (status) {
    case "ready":
      return t("alisio.capabilities.filters.ready");
    case "not-installed":
      return t("alisio.capabilities.filters.notInstalled");
    case "needs-setup":
      return t("alisio.capabilities.filters.needsSetup");
    case "disabled":
      return t("alisio.capabilities.filters.disabled");
    case "all":
    default:
      return t("alisio.capabilities.filters.all");
  }
}

function capabilityStatusClass(status: CapabilityStatus) {
  switch (status) {
    case "ready":
      return "chip chip-ok";
    case "partial":
      return "chip chip-active";
    case "not-installed":
      return "chip";
    case "needs-setup":
      return "chip chip-warn";
    case "not-exposed":
    default:
      return "chip";
  }
}

function buildSkillSections(skills: SkillStatusEntry[]): CapabilitySkillSection[] {
  const localSkills = skills.filter((skill) => !isSkillNotInstalled(skill));
  const catalogSkills = skills.filter((skill) => isSkillNotInstalled(skill));
  const sections: CapabilitySkillSection[] = [];

  if (localSkills.length > 0) {
    sections.push({
      id: "local",
      title: t("alisio.capabilities.list.localTitle"),
      subtitle: t("alisio.capabilities.list.localSubtitle", {
        count: String(localSkills.length),
      }),
      skills: localSkills,
    });
  }

  if (catalogSkills.length > 0) {
    sections.push({
      id: "catalog",
      title: t("alisio.capabilities.list.catalogTitle"),
      subtitle: t("alisio.capabilities.list.catalogSubtitle", {
        count: String(catalogSkills.length),
      }),
      skills: catalogSkills,
    });
  }

  return sections;
}

function getCapabilityStatusCounts(skills: SkillStatusEntry[]) {
  const cached = capabilityStatusCountsCache.get(skills);
  if (cached) {
    return cached;
  }
  const counts = buildSkillStatusCounts(skills);
  capabilityStatusCountsCache.set(skills, counts);
  return counts;
}

function getFilteredSkills(
  skills: SkillStatusEntry[],
  statusFilter: SkillsStatusFilter,
  filter: string,
) {
  let byFilter = capabilityFilteredSkillsCache.get(skills);
  if (!byFilter) {
    byFilter = new Map();
    capabilityFilteredSkillsCache.set(skills, byFilter);
  }
  const search = filter.trim().toLowerCase();
  const cacheKey = `${statusFilter}::${search}`;
  const cached = byFilter.get(cacheKey);
  if (cached) {
    return cached;
  }
  const filteredByStatus =
    statusFilter === "all"
      ? skills
      : skills.filter((skill) => skillMatchesStatus(skill, statusFilter));
  const filteredSkills = search
    ? filteredByStatus.filter((skill) =>
        [skill.name, skill.description, skill.source, skill.skillKey]
          .join(" ")
          .toLowerCase()
          .includes(search),
      )
    : filteredByStatus;
  byFilter.set(cacheKey, filteredSkills);
  return filteredSkills;
}

function getCapabilitySkillSections(skills: SkillStatusEntry[]) {
  const cached = capabilitySectionsCache.get(skills);
  if (cached) {
    return cached;
  }
  const sections = buildSkillSections(skills);
  capabilitySectionsCache.set(skills, sections);
  return sections;
}

function renderCapabilitiesFiltersSkeleton() {
  return html`
    <div class="capabilities-filter-skeleton" aria-hidden="true">
      <div class="capabilities-filter-skeleton__tabs">
        ${Array.from({ length: 5 }, () => renderSkeletonPill({ small: true }))}
      </div>
      <div class="capabilities-filter-skeleton__row">
        <div class="skeleton capabilities-filter-skeleton__search"></div>
        <div class="skeleton capabilities-filter-skeleton__count"></div>
      </div>
    </div>
  `;
}

function renderSkillCard(skill: SkillStatusEntry, props: CapabilitiesProps) {
  const status: CapabilityStatus =
    skill.disabled || skill.blockedByAllowlist
      ? "needs-setup"
      : isSkillNotInstalled(skill)
        ? "not-installed"
        : skill.eligible
          ? "ready"
          : "needs-setup";
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
        <span class=${capabilityStatusClass(status)}>${skillStatusLabel(skill)}</span>
      </div>
    </div>
  `;
}

function renderSkillSection(section: CapabilitySkillSection, props: CapabilitiesProps) {
  return html`
    <section class="capabilities-skill-section capabilities-skill-section--${section.id}">
      <div class="capabilities-skill-section__header">
        <div class="capabilities-skill-section__title">${section.title}</div>
        <div class="capabilities-skill-section__subtitle">${section.subtitle}</div>
      </div>
      <div class="list capabilities-skill-list">
        ${section.skills.map((skill) => renderSkillCard(skill, props))}
      </div>
    </section>
  `;
}

function renderSkillDetail(skill: SkillStatusEntry, props: CapabilitiesProps) {
  return renderSkillDetailDialog(skill, props);
}

export function renderCapabilities(props: CapabilitiesProps) {
  const showInitialLoading = props.loading && props.connected && !props.report;
  const errorMessages = [...new Set([props.connectionError, props.error].filter(Boolean))];
  const showNotConnectedHint = !props.connected && !props.report && errorMessages.length === 0;
  const suppressEmptyState = !props.report && errorMessages.length > 0;
  const skills = mergeSkillStatusEntries(props.report);
  const statusCounts = getCapabilityStatusCounts(skills);
  const filteredSkills = getFilteredSkills(skills, props.statusFilter, props.filter);
  const detailSkill =
    props.detailKey != null
      ? (skills.find((skill) => skill.skillKey === props.detailKey) ?? null)
      : null;
  const skillSections = getCapabilitySkillSections(filteredSkills);

  return html`
    <section class="alisio-page" style="display: grid; gap: 16px;">
      <section class="card" aria-busy=${showInitialLoading ? "true" : "false"}>
        ${errorMessages.map(
          (message) =>
            html`<div class="callout danger" style="margin-bottom: 16px;">${message}</div>`,
        )}
        ${showInitialLoading
          ? renderCapabilitiesFiltersSkeleton()
          : html`
              <div class="agent-tabs">
                ${(
                  [
                    "all",
                    "ready",
                    "not-installed",
                    "needs-setup",
                    "disabled",
                  ] as SkillsStatusFilter[]
                ).map(
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
            `}
        ${showInitialLoading
          ? html`
              <div
                class="capabilities-skeleton-list"
                role="status"
                aria-label=${t("alisio.capabilities.loading")}
              >
                ${renderSkeletonListItem({ lines: ["medium", "long"], aside: "pill" })}
                ${renderSkeletonListItem({ lines: ["long", "medium"], aside: "pill" })}
                ${renderSkeletonListItem({ lines: ["short", "medium"], aside: "pill" })}
              </div>
            `
          : filteredSkills.length === 0 && !suppressEmptyState
            ? html`
                <div style="margin-top: 16px;">
                  ${renderSurfaceEmptyState({
                    body: showNotConnectedHint
                      ? t("alisio.capabilities.notConnected")
                      : t("alisio.capabilities.empty"),
                    compact: true,
                  })}
                </div>
              `
            : html`${skillSections.map((section) => renderSkillSection(section, props))}`}
      </section>

      ${detailSkill ? renderSkillDetail(detailSkill, props) : nothing}
    </section>
  `;
}
