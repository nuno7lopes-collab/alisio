import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import type { SkillMessageMap } from "../controllers/skills.ts";
import { clampText } from "../format.ts";
import { resolveSafeExternalUrl } from "../open-external-url.ts";
import type {
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  ChannelsStatusSnapshot,
  SkillStatusEntry,
  SkillStatusReport,
} from "../types.ts";
import {
  computeSkillMissing,
  computeSkillReasons,
  renderSkillStatusChips,
} from "./skills-shared.ts";

export type SkillsStatusFilter = "all" | "ready" | "needs-setup" | "disabled";
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

function humanizeSkillSource(source: string) {
  switch (source) {
    case "openclaw-bundled":
      return t("alisio.capabilities.sources.builtIn");
    case "openclaw-managed":
      return t("alisio.capabilities.sources.managed");
    case "openclaw-workspace":
      return t("alisio.capabilities.sources.workspace");
    case "openclaw-plugin":
      return t("alisio.capabilities.sources.plugin");
    default:
      return t("alisio.capabilities.sources.external");
  }
}

function safeExternalHref(raw?: string): string | null {
  if (!raw) {
    return null;
  }
  return resolveSafeExternalUrl(raw, window.location.href);
}

function channelSignals(snapshot: ChannelsStatusSnapshot | null) {
  const accounts = Object.values(snapshot?.channelAccounts ?? {}).flat();
  const connected = accounts.filter((account) => account.connected).length;
  const linked = accounts.filter((account) => account.linked || account.configured).length;
  return {
    total: snapshot?.channelOrder.length ?? 0,
    connected,
    linked,
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

function skillMatchesStatus(skill: SkillStatusEntry, status: SkillsStatusFilter): boolean {
  switch (status) {
    case "all":
      return true;
    case "ready":
      return !skill.disabled && skill.eligible;
    case "needs-setup":
      return !skill.disabled && !skill.eligible;
    case "disabled":
      return skill.disabled;
  }
}

function skillStatusClass(skill: SkillStatusEntry): string {
  if (skill.disabled) {
    return "muted";
  }
  return skill.eligible ? "ok" : "warn";
}

function skillStatusLabel(skill: SkillStatusEntry) {
  if (skill.disabled) {
    return t("alisio.capabilities.filters.disabled");
  }
  return skill.eligible
    ? t("alisio.capabilities.filters.ready")
    : t("alisio.capabilities.filters.needsSetup");
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
          : channels.linked > 0
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
    <article class="card">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 12px;">
        <div class="card-title">${card.title}</div>
        <span class=${capabilityStatusClass(card.status)}
          >${capabilityStatusLabel(card.status)}</span
        >
      </div>
      <div class="card-sub" style="margin-top: 10px;">${card.body}</div>
      ${card.action && card.actionLabel
        ? html`
            <div style="margin-top: 16px;">
              <button class="btn btn--sm" @click=${card.action}>${card.actionLabel}</button>
            </div>
          `
        : nothing}
    </article>
  `;
}

function renderSkillCard(skill: SkillStatusEntry, props: CapabilitiesProps) {
  return html`
    <div class="list-item list-item-clickable" @click=${() => props.onDetailOpen(skill.skillKey)}>
      <div class="list-main">
        <div class="list-title" style="display: flex; align-items: center; gap: 8px;">
          <span class="statusDot ${skillStatusClass(skill)}"></span>
          ${skill.emoji ? html`<span>${skill.emoji}</span>` : nothing}
          <span>${skill.name}</span>
        </div>
        <div class="list-sub">${clampText(skill.description, 140)}</div>
      </div>
      <div class="list-meta">
        <span
          class=${capabilityStatusClass(
            skill.disabled ? "needs-setup" : skill.eligible ? "ready" : "partial",
          )}
        >
          ${skillStatusLabel(skill)}
        </span>
      </div>
    </div>
  `;
}

function renderSkillDetail(skill: SkillStatusEntry, props: CapabilitiesProps) {
  const busy = props.busyKey === skill.skillKey;
  const apiKey = props.edits[skill.skillKey] ?? "";
  const message = props.messages[skill.skillKey] ?? null;
  const canInstall = skill.install.length > 0 && skill.missing.bins.length > 0;
  const showBundledBadge = Boolean(skill.bundled && skill.source !== "openclaw-bundled");
  const missing = computeSkillMissing(skill);
  const reasons = computeSkillReasons(skill);
  const sourceLabel = humanizeSkillSource(skill.source);
  const ensureModalOpen = (el?: Element) => {
    if (!(el instanceof HTMLDialogElement) || el.open) {
      return;
    }
    el.showModal();
  };

  return html`
    <dialog
      class="md-preview-dialog"
      ${ref(ensureModalOpen)}
      @click=${(event: Event) => {
        const dialog = event.currentTarget as HTMLDialogElement;
        if (event.target === dialog) {
          dialog.close();
        }
      }}
      @close=${props.onDetailClose}
    >
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div
            class="md-preview-dialog__title"
            style="display: flex; align-items: center; gap: 8px;"
          >
            <span class="statusDot ${skillStatusClass(skill)}"></span>
            ${skill.emoji ? html`<span style="font-size: 18px;">${skill.emoji}</span>` : nothing}
            <span>${skill.name}</span>
          </div>
          <button
            class="btn btn--sm"
            @click=${(event: Event) => {
              (event.currentTarget as HTMLElement).closest("dialog")?.close();
            }}
          >
            ${t("alisio.capabilities.detail.close")}
          </button>
        </div>
        <div class="md-preview-dialog__body" style="display: grid; gap: 16px;">
          <div>
            <div style="font-size: 14px; line-height: 1.5; color: var(--text);">
              ${skill.description}
            </div>
            ${renderSkillStatusChips({ skill, showBundledBadge })}
          </div>

          ${missing.length > 0
            ? html`
                <div
                  class="callout"
                  style="border-color: var(--warn-subtle); background: var(--warn-subtle); color: var(--warn);"
                >
                  <div style="font-weight: 600; margin-bottom: 4px;">
                    ${t("alisio.capabilities.detail.missingTitle")}
                  </div>
                  <div>${missing.join(", ")}</div>
                </div>
              `
            : nothing}
          ${reasons.length > 0
            ? html`
                <div class="muted" style="font-size: 13px;">
                  ${t("alisio.capabilities.detail.reasonsTitle")}: ${reasons.join(", ")}
                </div>
              `
            : nothing}

          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <label class="skill-toggle-wrap">
              <input
                type="checkbox"
                class="skill-toggle"
                .checked=${!skill.disabled}
                ?disabled=${busy}
                @change=${() => props.onToggle(skill.skillKey, skill.disabled)}
              />
            </label>
            <span style="font-size: 13px; font-weight: 500;">
              ${skill.disabled
                ? t("alisio.capabilities.detail.disabled")
                : t("alisio.capabilities.detail.enabled")}
            </span>
            ${canInstall
              ? html`
                  <button
                    class="btn"
                    ?disabled=${busy}
                    @click=${() => props.onInstall(skill.skillKey, skill.name, skill.install[0].id)}
                  >
                    ${busy ? t("alisio.capabilities.detail.installing") : skill.install[0].label}
                  </button>
                `
              : nothing}
          </div>

          ${message
            ? html`<div class="callout ${message.kind === "error" ? "danger" : "success"}">
                ${message.message}
              </div>`
            : nothing}
          ${skill.primaryEnv
            ? html`
                <div style="display: grid; gap: 8px;">
                  <label class="field">
                    <span>
                      ${t("alisio.capabilities.detail.apiKey")}
                      <span class="muted" style="font-weight: normal; font-size: 0.88em;">
                        (${skill.primaryEnv})
                      </span>
                    </span>
                    <input
                      type="password"
                      .value=${apiKey}
                      @input=${(event: Event) =>
                        props.onEdit(skill.skillKey, (event.target as HTMLInputElement).value)}
                    />
                  </label>
                  ${(() => {
                    const href = safeExternalHref(skill.homepage);
                    return href
                      ? html`
                          <div class="muted" style="font-size: 13px;">
                            ${t("alisio.capabilities.detail.getKey")}:
                            <a href=${href} target="_blank" rel="noopener noreferrer"
                              >${skill.homepage}</a
                            >
                          </div>
                        `
                      : nothing;
                  })()}
                  <button
                    class="btn primary"
                    ?disabled=${busy}
                    @click=${() => props.onSaveKey(skill.skillKey)}
                  >
                    ${t("alisio.capabilities.detail.saveKey")}
                  </button>
                </div>
              `
            : nothing}

          <div
            style="border-top: 1px solid var(--border); padding-top: 12px; display: grid; gap: 6px; font-size: 12px; color: var(--muted);"
          >
            <div>
              <span style="font-weight: 600;">${t("alisio.capabilities.detail.source")}:</span>
              ${sourceLabel}
            </div>
            ${(() => {
              const href = safeExternalHref(skill.homepage);
              return href
                ? html`
                    <div>
                      <a href=${href} target="_blank" rel="noopener noreferrer"
                        >${skill.homepage}</a
                      >
                    </div>
                  `
                : nothing;
            })()}
          </div>
        </div>
      </div>
    </dialog>
  `;
}

export function renderCapabilities(props: CapabilitiesProps) {
  const skills = props.report?.skills ?? [];
  const statusCounts: Record<SkillsStatusFilter, number> = {
    all: skills.length,
    ready: 0,
    "needs-setup": 0,
    disabled: 0,
  };
  for (const skill of skills) {
    if (skill.disabled) {
      statusCounts.disabled++;
    } else if (skill.eligible) {
      statusCounts.ready++;
    } else {
      statusCounts["needs-setup"]++;
    }
  }

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
        <div
          class="row"
          style="justify-content: space-between; align-items: flex-start; gap: 16px;"
        >
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

        <div
          style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-top: 18px;"
        >
          <article class="list-item">
            <div class="list-title">${statusCounts.ready}</div>
            <div class="list-sub">${t("alisio.capabilities.summary.readyNow")}</div>
          </article>
          <article class="list-item">
            <div class="list-title">${statusCounts["needs-setup"] + statusCounts.disabled}</div>
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
        </div>

        ${props.error
          ? html`<div class="callout danger" style="margin-top: 16px;">${props.error}</div>`
          : nothing}
      </div>

      <div
        style="display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));"
      >
        ${capabilityCards.map((card) => renderCapabilityCard(card))}
      </div>

      <section class="card">
        <div
          class="row"
          style="justify-content: space-between; gap: 16px; align-items: flex-start;"
        >
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

        <div
          class="filters"
          style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px;"
        >
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

        ${filteredSkills.length === 0
          ? html`
              <div class="muted" style="margin-top: 16px;">
                ${!props.connected && !props.report
                  ? t("alisio.capabilities.notConnected")
                  : t("alisio.capabilities.empty")}
              </div>
            `
          : html`
              <div class="list" style="margin-top: 16px;">
                ${filteredSkills.map((skill) => renderSkillCard(skill, props))}
              </div>
            `}
      </section>

      ${detailSkill ? renderSkillDetail(detailSkill, props) : nothing}
    </section>
  `;
}
