import { html, nothing } from "lit";
import {
  alisioConnectorLimit,
  alisioConnectorUpgradeMessage,
  countAlisioConnectorPlanSlots,
  normalizeAlisioPlan,
} from "../../../../src/shared/alisio-billing.js";
import { t } from "../../i18n/index.ts";
import type {
  AlisioAccountState,
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  AlisioProviderOverviewItem,
  AlisioProvidersState,
} from "../types.ts";
import { connectorBrandStyle, getConnectorBranding } from "./connector-branding.ts";
import { buildConnectorRows, type ConnectorRow } from "./connector-state.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonPill,
  renderSkeletonStatCards,
} from "./loading-skeleton.ts";

const SECTION_ORDER = ["assistant", "providers", "runtimes", "apps"] as const;

type SectionId = (typeof SECTION_ORDER)[number];

function sectionLabels() {
  return {
    all: t("alisio.authentications.filters.all"),
    assistant: t("alisio.authentications.filters.assistant"),
    providers: t("alisio.authentications.filters.providers"),
    runtimes: t("alisio.authentications.filters.runtimes"),
    apps: t("alisio.authentications.filters.apps"),
  } as const;
}

function sectionTitles() {
  return {
    assistant: t("alisio.authentications.sections.assistant"),
    providers: t("alisio.authentications.sections.providers"),
    runtimes: t("alisio.authentications.sections.runtimes"),
    apps: t("alisio.authentications.sections.apps"),
  } as const;
}

function categoryLabel(category: string) {
  switch (category) {
    case "google":
      return t("alisio.authentications.categories.google");
    case "productivity":
      return t("alisio.authentications.categories.productivity");
    case "development":
      return t("alisio.authentications.categories.development");
    case "social":
    default:
      return t("alisio.authentications.categories.social");
  }
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

function matchesSearch(item: AlisioProviderOverviewItem, search: string) {
  const normalizedSearch = normalizeSearchText(search);
  if (!normalizedSearch) {
    return true;
  }
  const haystack = [
    item.title,
    item.subtitle,
    item.detail ?? "",
    item.providerLabel ?? "",
    item.accountLabel ?? "",
    item.accountEmail ?? "",
    ...item.chips,
    ...item.usageWindows.map((window) => window.label),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedSearch);
}

function statusClass(status: AlisioProviderOverviewItem["status"]) {
  switch (status) {
    case "connected":
      return "pill--connected";
    case "attention":
      return "pill--needs-reconnect";
    case "coming_soon":
      return "pill--in-review";
    case "unavailable":
      return "pill--unavailable";
    case "ready":
    default:
      return "pill--ready";
  }
}

function statusLabel(status: AlisioProviderOverviewItem["status"]) {
  switch (status) {
    case "connected":
      return t("alisio.authentications.overviewStatuses.connected");
    case "attention":
      return t("alisio.authentications.overviewStatuses.attention");
    case "coming_soon":
      return t("alisio.authentications.overviewStatuses.comingSoon");
    case "unavailable":
      return t("alisio.authentications.overviewStatuses.unavailable");
    case "ready":
    default:
      return t("alisio.authentications.overviewStatuses.ready");
  }
}

function buildInitials(label: string) {
  const parts = label
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function overviewIconStyle(section: SectionId) {
  switch (section) {
    case "assistant":
      return "--connector-accent: var(--ok); --connector-surface: color-mix(in srgb, var(--ok-subtle) 84%, transparent); --connector-border: color-mix(in srgb, var(--ok) 26%, transparent);";
    case "runtimes":
      return "--connector-accent: var(--warn); --connector-surface: color-mix(in srgb, var(--warn-subtle) 74%, transparent); --connector-border: color-mix(in srgb, var(--warn) 24%, transparent);";
    case "providers":
    default:
      return "--connector-accent: var(--accent); --connector-surface: color-mix(in srgb, var(--accent-subtle) 82%, transparent); --connector-border: color-mix(in srgb, var(--accent) 24%, transparent);";
  }
}

function renderOverviewIcon(item: AlisioProviderOverviewItem, section: SectionId) {
  return html`
    <span class="alisio-auth-card__icon" style=${overviewIconStyle(section)}>
      ${buildInitials(item.title)}
    </span>
  `;
}

function renderUsageChips(item: AlisioProviderOverviewItem) {
  if (item.usageWindows.length === 0) {
    return nothing;
  }
  return item.usageWindows.map(
    (window) => html`<span class="chip">${window.label} ${window.usedPercent}%</span>`,
  );
}

function renderOverviewCard(item: AlisioProviderOverviewItem, section: SectionId) {
  return html`
    <article
      class="alisio-auth-card ${item.status === "connected" ? "alisio-auth-card--connected" : ""}"
    >
      <div class="alisio-auth-card__main">
        <div class="alisio-auth-card__head">
          <div class="alisio-auth-card__brand">
            ${renderOverviewIcon(item, section)}
            <div class="alisio-auth-card__brand-copy">
              <div class="list-title">${item.title}</div>
              <div class="list-sub">${item.subtitle}</div>
            </div>
          </div>
          <span class="pill ${statusClass(item.status)}">${statusLabel(item.status)}</span>
        </div>
        <div class="chip-row" style="margin-top: 12px;">
          ${item.chips.map((chip) => html`<span class="chip">${chip}</span>`)}
          ${item.accountLabel
            ? html`<span class="chip"
                >${t("alisio.authentications.connectedAs")}: ${item.accountLabel}</span
              >`
            : nothing}
          ${!item.accountLabel && item.accountEmail
            ? html`<span class="chip">${item.accountEmail}</span>`
            : nothing}
          ${renderUsageChips(item)}
        </div>
        ${item.detail
          ? html`
              <div class="muted" style="margin-top: 10px; font-size: 13px;">${item.detail}</div>
            `
          : nothing}
      </div>
    </article>
  `;
}

function renderConnectorIcon(definition: AlisioConnectorDefinition) {
  const branding = getConnectorBranding(definition.id, definition.providerLabel);

  return html`
    <span class="alisio-auth-card__icon" style=${connectorBrandStyle(branding)}>
      <img src=${branding.logoUrl} alt="" loading="lazy" decoding="async" />
    </span>
  `;
}

function renderConnectorAction(
  row: ConnectorRow,
  props: {
    onBeginConnector: (connectorId: string) => void;
    onRevokeConnector: (connectorId: string) => void;
    planBlocksNewConnections?: boolean;
    planLimitMessage?: string | null;
  },
  text: {
    revoke: string;
    reconnect: string;
    reviewSetup: string;
  },
  status: ConnectorRow["status"],
  connectLabel?: string,
) {
  if (status === "connected") {
    return html`
      <button class="btn btn--sm danger" @click=${() => props.onRevokeConnector(row.definition.id)}>
        ${text.revoke}
      </button>
    `;
  }
  if (status === "ready") {
    const disabled = props.planBlocksNewConnections === true;
    return html`
      <button
        class="btn btn--sm primary"
        ?disabled=${disabled}
        title=${disabled ? (props.planLimitMessage ?? "") : ""}
        @click=${() => {
          if (disabled) {
            return;
          }
          props.onBeginConnector(row.definition.id);
        }}
      >
        ${connectLabel ?? row.definition.connectLabel}
      </button>
    `;
  }
  if (status === "needs_reconnect") {
    return html`
      <button class="btn btn--sm primary" @click=${() => props.onBeginConnector(row.definition.id)}>
        ${text.reconnect}
      </button>
    `;
  }
  if (status === "setup_required") {
    return html`
      <button class="btn btn--sm primary" @click=${() => props.onBeginConnector(row.definition.id)}>
        ${text.reviewSetup}
      </button>
    `;
  }
  return nothing;
}

function renderConnectorCard(
  row: ConnectorRow,
  props: {
    onBeginConnector: (connectorId: string) => void;
    onRevokeConnector: (connectorId: string) => void;
    planBlocksNewConnections?: boolean;
    planLimitMessage?: string | null;
    overviewStatus?: AlisioProviderOverviewItem["status"];
    subtitle?: string;
    connectLabel?: string;
  },
  text: {
    revoke: string;
    reconnect: string;
    reviewSetup: string;
  },
) {
  const connectedAs =
    row.authorization.connectedAccount?.label?.trim() ||
    row.authorization.connectedAccount?.email?.trim() ||
    row.authorization.connectedAccount?.handle?.trim() ||
    null;
  const summary = props.subtitle?.trim() || row.definition.detail?.trim() || row.definition.summary;
  const fallbackStatus =
    row.status === "connected"
      ? "connected"
      : row.status === "needs_reconnect"
        ? "attention"
        : row.status === "in_review"
          ? "coming_soon"
          : row.status === "unavailable"
            ? "unavailable"
            : "ready";
  const status = props.overviewStatus ?? fallbackStatus;
  const actionStatus =
    props.overviewStatus === "attention"
      ? "needs_reconnect"
      : props.overviewStatus === "coming_soon"
        ? "in_review"
        : props.overviewStatus === "connected" ||
            props.overviewStatus === "ready" ||
            props.overviewStatus === "unavailable"
          ? props.overviewStatus
          : row.status;

  return html`
    <article
      class="alisio-auth-card ${row.status === "connected" ? "alisio-auth-card--connected" : ""}"
    >
      <div class="alisio-auth-card__main">
        <div class="alisio-auth-card__head">
          <div class="alisio-auth-card__brand">
            ${renderConnectorIcon(row.definition)}
            <div class="alisio-auth-card__brand-copy">
              <div class="list-title">${row.definition.title}</div>
              <div class="list-sub">${summary}</div>
            </div>
          </div>
          <span class="pill ${statusClass(status)}">${statusLabel(status)}</span>
        </div>
        <div class="chip-row" style="margin-top: 12px;">
          <span class="chip">${row.definition.providerLabel}</span>
          <span class="chip">${categoryLabel(row.definition.category)}</span>
          ${connectedAs
            ? html`<span class="chip"
                >${t("alisio.authentications.connectedAs")}: ${connectedAs}</span
              >`
            : nothing}
        </div>
      </div>
      <div class="alisio-auth-card__aside">
        ${renderConnectorAction(row, props, text, actionStatus, props.connectLabel)}
      </div>
    </article>
  `;
}

export function renderAuthentications(props: {
  loading: boolean;
  error: string | null;
  account: AlisioAccountState | null;
  overview: AlisioProvidersState | null;
  connectorCatalog: AlisioConnectorDefinition[];
  connectorAuthorizations: AlisioConnectorAuthorization[];
  search: string;
  categoryFilter: string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onBeginConnector: (connectorId: string) => void;
  onRevokeConnector: (connectorId: string) => void;
  onOpenModels: () => void;
}) {
  const text = {
    eyebrow: t("alisio.authentications.eyebrow"),
    title: t("alisio.authentications.title"),
    subtitle: t("alisio.authentications.subtitle"),
    summaryConnected: t("alisio.authentications.summary.connected"),
    summaryReady: t("alisio.authentications.summary.ready"),
    summaryAttention: t("alisio.authentications.summary.attention"),
    searchPlaceholder: t("alisio.authentications.searchPlaceholder"),
    emptyFiltered: t("alisio.authentications.emptyFiltered"),
    openModels: t("alisio.authentications.actions.openModels"),
    revoke: t("alisio.authentications.actions.revoke"),
    reconnect: t("alisio.authentications.actions.reconnect"),
    reviewSetup: t("alisio.authentications.actions.reviewSetup"),
  };
  const filters = sectionLabels();
  const titles = sectionTitles();
  const overviewConnectorCatalog = props.overview?.connectors.catalog ?? [];
  const connectorCatalog =
    overviewConnectorCatalog.length > 0 ? overviewConnectorCatalog : props.connectorCatalog;
  const overviewConnectorAuthorizations = props.overview?.connectors.authorizations ?? [];
  const connectorAuthorizations =
    overviewConnectorAuthorizations.length > 0
      ? overviewConnectorAuthorizations
      : props.connectorAuthorizations;
  const connectorRows = buildConnectorRows(connectorCatalog, connectorAuthorizations);
  const connectorRowsById = new Map(connectorRows.map((row) => [row.definition.id, row]));

  const overview = props.overview;
  const sections = [
    { id: "assistant", title: titles.assistant, items: overview?.assistant ?? [] },
    { id: "providers", title: titles.providers, items: overview?.providers ?? [] },
    { id: "runtimes", title: titles.runtimes, items: overview?.runtimes ?? [] },
    { id: "apps", title: titles.apps, items: overview?.apps ?? [] },
  ] satisfies Array<{
    id: SectionId;
    title: string;
    items: AlisioProviderOverviewItem[];
  }>;

  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          (props.categoryFilter === "all" || props.categoryFilter === section.id) &&
          matchesSearch(item, props.search),
      ),
    }))
    .filter((section) => section.items.length > 0);

  const summary = overview?.summary ?? {
    connected: 0,
    ready: 0,
    attention: 0,
    total: 0,
  };
  const showInitialLoading = props.loading && !overview;
  const currentPlan = normalizeAlisioPlan(props.account?.profile.plan);
  const connectorLimit = alisioConnectorLimit(currentPlan);
  const occupiedConnectorSlots = countAlisioConnectorPlanSlots(
    connectorRows.map((row) => row.authorization),
  );
  const connectorLimitReached = connectorLimit != null && occupiedConnectorSlots >= connectorLimit;
  const connectorLimitMessage = connectorLimitReached
    ? alisioConnectorUpgradeMessage(currentPlan)
    : null;
  const activeSectionTitle =
    props.categoryFilter === "all"
      ? text.title
      : (titles[props.categoryFilter as keyof typeof titles] ?? text.title);

  return html`
    <section class="alisio-page alisio-auth-page">
      <section class="card">
        <div class="alisio-page__eyebrow">${text.eyebrow}</div>
        <div
          class="row"
          style="justify-content: space-between; align-items: flex-start; gap: 16px;"
        >
          <div class="alisio-auth-page__copy">
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
          <button class="btn btn--sm" @click=${props.onOpenModels}>${text.openModels}</button>
        </div>
        <div class="alisio-summary-grid alisio-summary-grid--spacious">
          ${showInitialLoading
            ? renderSkeletonStatCards(3)
            : html`
                <article class="list-item">
                  <div class="list-title">${summary.connected}</div>
                  <div class="list-sub">${text.summaryConnected}</div>
                </article>
                <article class="list-item">
                  <div class="list-title">${summary.ready}</div>
                  <div class="list-sub">${text.summaryReady}</div>
                </article>
                <article class="list-item">
                  <div class="list-title">${summary.attention}</div>
                  <div class="list-sub">${text.summaryAttention}</div>
                </article>
              `}
        </div>
      </section>

      <header class="alisio-auth-page__header">
        <div class="alisio-auth-page__copy">
          <div class="card-title">${activeSectionTitle}</div>
        </div>
        <div class="alisio-auth-page__filters">
          <label class="field alisio-filter alisio-filter--search">
            <input
              type="search"
              placeholder=${text.searchPlaceholder}
              .value=${props.search}
              @input=${(event: Event) =>
                props.onSearchChange((event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field alisio-filter">
            <select
              .value=${props.categoryFilter}
              @change=${(event: Event) =>
                props.onCategoryChange((event.target as HTMLSelectElement).value)}
            >
              ${Object.entries(filters).map(
                ([value, label]) => html`<option value=${value}>${label}</option>`,
              )}
            </select>
          </label>
        </div>
      </header>

      ${props.error
        ? html`<div class="callout danger alisio-auth-page__error">${props.error}</div>`
        : nothing}
      ${connectorLimitMessage
        ? html`<div class="callout info alisio-auth-page__error">${connectorLimitMessage}</div>`
        : nothing}
      ${showInitialLoading
        ? html`
            <section class="card">
              <div class="stack">
                ${Array.from({ length: 3 }).map(
                  () => html`
                    <article class="alisio-auth-card">
                      <div class="alisio-auth-card__main">
                        <div class="alisio-auth-card__head">
                          <div class="alisio-auth-card__brand">
                            ${renderSkeletonPill()}
                            <div class="alisio-auth-card__brand-copy">
                              ${renderSkeletonLines(["medium", "long"])}
                            </div>
                          </div>
                          ${renderSkeletonPill({ small: true })}
                        </div>
                        <div class="chip-row" style="margin-top: 12px;">
                          ${renderSkeletonPill({ small: true })}
                          ${renderSkeletonPill({ small: true })}
                        </div>
                        <div class="muted" style="margin-top: 10px;">
                          ${renderSkeletonLines(["full"])}
                        </div>
                      </div>
                      <div class="alisio-auth-card__aside">
                        ${renderSkeletonButton({ small: true })}
                      </div>
                    </article>
                  `,
                )}
              </div>
            </section>
          `
        : visibleSections.length === 0
          ? html`<div class="card-sub">${text.emptyFiltered}</div>`
          : visibleSections.map(
              (section) => html`
                <section class="card">
                  <div class="card-title">${section.title}</div>
                  <div class="stack">
                    ${section.items.map((item) => {
                      if (section.id === "apps" && item.connectorId) {
                        const row = connectorRowsById.get(item.connectorId);
                        if (row) {
                          return renderConnectorCard(
                            row,
                            {
                              onBeginConnector: props.onBeginConnector,
                              onRevokeConnector: props.onRevokeConnector,
                              planBlocksNewConnections: connectorLimitReached,
                              planLimitMessage: connectorLimitMessage,
                              overviewStatus: item.status,
                              subtitle: item.subtitle,
                              connectLabel: item.connectLabel,
                            },
                            {
                              revoke: text.revoke,
                              reconnect: text.reconnect,
                              reviewSetup: text.reviewSetup,
                            },
                          );
                        }
                      }
                      return renderOverviewCard(item, section.id);
                    })}
                  </div>
                </section>
              `,
            )}
    </section>
  `;
}
