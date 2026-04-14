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
import {
  getConnectorActionBranding,
  getConnectorBranding,
  type ConnectorBranding,
} from "./connector-branding.ts";
import { buildConnectorRows, type ConnectorRow } from "./connector-state.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonPill,
  renderSkeletonStatCards,
} from "./loading-skeleton.ts";

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

function matchesConnectorSearch(
  row: ConnectorRow,
  item: AlisioProviderOverviewItem | undefined,
  search: string,
) {
  const normalizedSearch = normalizeSearchText(search);
  if (!normalizedSearch) {
    return true;
  }
  const haystack = [
    row.definition.title,
    item?.subtitle ?? row.definition.summary,
    item?.detail ?? row.definition.detail ?? "",
    row.definition.providerLabel,
    row.definition.category,
    row.authorization.connectedAccount?.label ?? "",
    row.authorization.connectedAccount?.email ?? "",
    row.authorization.connectedAccount?.handle ?? "",
    ...row.definition.scopes,
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

function renderConnectorIcon(definition: AlisioConnectorDefinition) {
  const branding = getConnectorBranding(definition.id, definition.providerLabel);

  return html`
    <span class="alisio-auth-card__icon">
      <img src=${branding.logoUrl} alt="" loading="lazy" decoding="async" />
    </span>
  `;
}

function renderConnectorStatusBadge(status: AlisioProviderOverviewItem["status"]) {
  if (status === "connected" || status === "ready") {
    return nothing;
  }
  return html`<span class="pill ${statusClass(status)} alisio-auth-card__status"
    >${statusLabel(status)}</span
  >`;
}

function renderConnectorActionContent(label: string, branding: ConnectorBranding | null) {
  return html`
    ${branding
      ? html`<img src=${branding.logoUrl} alt="" loading="lazy" decoding="async" />`
      : nothing}
    <span>${label}</span>
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
  const actionBranding =
    status === "connected"
      ? null
      : getConnectorActionBranding(row.definition.id, row.definition.providerLabel);
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
        class="btn btn--sm alisio-auth-card__connect-btn"
        ?disabled=${disabled}
        title=${disabled ? (props.planLimitMessage ?? "") : ""}
        @click=${() => {
          if (disabled) {
            return;
          }
          props.onBeginConnector(row.definition.id);
        }}
      >
        ${renderConnectorActionContent(connectLabel ?? row.definition.connectLabel, actionBranding)}
      </button>
    `;
  }
  if (status === "needs_reconnect") {
    return html`
      <button
        class="btn btn--sm alisio-auth-card__connect-btn"
        @click=${() => props.onBeginConnector(row.definition.id)}
      >
        ${renderConnectorActionContent(text.reconnect, actionBranding)}
      </button>
    `;
  }
  if (status === "setup_required") {
    return html`
      <button
        class="btn btn--sm alisio-auth-card__connect-btn"
        @click=${() => props.onBeginConnector(row.definition.id)}
      >
        ${renderConnectorActionContent(text.reviewSetup, actionBranding)}
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
          ${renderConnectorStatusBadge(status)}
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

function resolveConnectorCardState(
  row: ConnectorRow,
  item: AlisioProviderOverviewItem | undefined,
): {
  status: AlisioProviderOverviewItem["status"];
  connected: boolean;
} {
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
  const status = item?.status ?? fallbackStatus;
  return {
    status,
    connected: status === "connected",
  };
}

function connectorStatusOrder(status: AlisioProviderOverviewItem["status"]) {
  switch (status) {
    case "connected":
      return 0;
    case "attention":
      return 1;
    case "ready":
      return 2;
    case "coming_soon":
      return 3;
    case "unavailable":
    default:
      return 4;
  }
}

function renderConnectorSection(params: {
  id: "connected" | "available";
  title: string;
  subtitle?: string;
  entries: Array<{
    row: ConnectorRow;
    item?: AlisioProviderOverviewItem;
    state: ReturnType<typeof resolveConnectorCardState>;
  }>;
  props: {
    onBeginConnector: (connectorId: string) => void;
    onRevokeConnector: (connectorId: string) => void;
    planBlocksNewConnections?: boolean;
    planLimitMessage?: string | null;
  };
  text: {
    revoke: string;
    reconnect: string;
    reviewSetup: string;
  };
}) {
  if (params.entries.length === 0) {
    return nothing;
  }
  return html`
    <section class="card alisio-auth-page__section" data-section=${params.id}>
      <div class="card-title">${params.title}</div>
      ${params.subtitle ? html`<div class="card-sub">${params.subtitle}</div>` : nothing}
      <div class="stack">
        ${params.entries.map(({ row, item, state }) =>
          renderConnectorCard(
            row,
            {
              onBeginConnector: params.props.onBeginConnector,
              onRevokeConnector: params.props.onRevokeConnector,
              planBlocksNewConnections: params.props.planBlocksNewConnections,
              planLimitMessage: params.props.planLimitMessage,
              overviewStatus: state.status,
              subtitle: item?.subtitle,
              connectLabel: item?.connectLabel,
            },
            {
              revoke: params.text.revoke,
              reconnect: params.text.reconnect,
              reviewSetup: params.text.reviewSetup,
            },
          ),
        )}
      </div>
    </section>
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
  onSearchChange: (value: string) => void;
  onBeginConnector: (connectorId: string) => void;
  onRevokeConnector: (connectorId: string) => void;
  onOpenConnections: () => void;
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
    authorizedTitle: t("alisio.authentications.authorizedTitle"),
    authorizedSubtitle: t("alisio.authentications.authorizedSubtitle"),
    availableTitle: t("alisio.authentications.availableTitle"),
    openConnections: t("alisio.authentications.actions.openConnections"),
    revoke: t("alisio.authentications.actions.revoke"),
    reconnect: t("alisio.authentications.actions.reconnect"),
    reviewSetup: t("alisio.authentications.actions.reviewSetup"),
  };
  const overviewConnectorCatalog = props.overview?.connectors.catalog ?? [];
  const connectorCatalog =
    overviewConnectorCatalog.length > 0 ? overviewConnectorCatalog : props.connectorCatalog;
  const overviewConnectorAuthorizations = props.overview?.connectors.authorizations ?? [];
  const connectorAuthorizations =
    overviewConnectorAuthorizations.length > 0
      ? overviewConnectorAuthorizations
      : props.connectorAuthorizations;
  const connectorRows = buildConnectorRows(connectorCatalog, connectorAuthorizations);
  const overview = props.overview;
  const appOverviewByConnectorId = new Map(
    (overview?.apps ?? [])
      .filter(
        (
          item,
        ): item is AlisioProviderOverviewItem & {
          connectorId: string;
        } => typeof item.connectorId === "string" && item.connectorId.trim().length > 0,
      )
      .map((item) => [item.connectorId, item]),
  );
  const appOrderByConnectorId = new Map(
    (overview?.apps ?? [])
      .filter(
        (item): item is AlisioProviderOverviewItem & { connectorId: string } =>
          typeof item.connectorId === "string" && item.connectorId.trim().length > 0,
      )
      .map((item, index) => [item.connectorId, index]),
  );
  const visibleConnectorRows = connectorRows.filter((row) =>
    matchesConnectorSearch(row, appOverviewByConnectorId.get(row.definition.id), props.search),
  );
  const connectorEntries = visibleConnectorRows
    .map((row) => {
      const item = appOverviewByConnectorId.get(row.definition.id);
      return {
        row,
        item,
        state: resolveConnectorCardState(row, item),
      };
    })
    .toSorted((left, right) => {
      const leftOrder = appOrderByConnectorId.get(left.row.definition.id);
      const rightOrder = appOrderByConnectorId.get(right.row.definition.id);
      if (leftOrder != null || rightOrder != null) {
        return (
          (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER) ||
          left.row.definition.title.localeCompare(right.row.definition.title) ||
          left.row.definition.id.localeCompare(right.row.definition.id)
        );
      }
      return (
        connectorStatusOrder(left.state.status) - connectorStatusOrder(right.state.status) ||
        left.row.definition.title.localeCompare(right.row.definition.title) ||
        left.row.definition.id.localeCompare(right.row.definition.id)
      );
    });
  const connectedConnectorEntries = connectorEntries.filter((entry) => entry.state.connected);
  const availableConnectorEntries = connectorEntries.filter((entry) => !entry.state.connected);

  const summary = {
    connected: connectorRows.filter((row) => row.status === "connected").length,
    ready: connectorRows.filter((row) => row.status === "ready").length,
    attention: connectorRows.filter(
      (row) => row.status === "needs_reconnect" || row.status === "setup_required",
    ).length,
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
          <button class="btn btn--sm" @click=${props.onOpenConnections}>
            ${text.openConnections}
          </button>
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
          <div class="card-title">${t("alisio.authentications.sections.apps")}</div>
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
        : visibleConnectorRows.length === 0
          ? html`<div class="card-sub">
              ${props.search ? text.emptyFiltered : t("alisio.authentications.emptyAuthorized")}
            </div>`
          : html`
              ${renderConnectorSection({
                id: "connected",
                title: text.authorizedTitle,
                subtitle: text.authorizedSubtitle,
                entries: connectedConnectorEntries,
                props: {
                  onBeginConnector: props.onBeginConnector,
                  onRevokeConnector: props.onRevokeConnector,
                  planBlocksNewConnections: connectorLimitReached,
                  planLimitMessage: connectorLimitMessage,
                },
                text: {
                  revoke: text.revoke,
                  reconnect: text.reconnect,
                  reviewSetup: text.reviewSetup,
                },
              })}
              ${renderConnectorSection({
                id: "available",
                title: connectedConnectorEntries.length > 0 ? text.availableTitle : text.title,
                entries: availableConnectorEntries,
                props: {
                  onBeginConnector: props.onBeginConnector,
                  onRevokeConnector: props.onRevokeConnector,
                  planBlocksNewConnections: connectorLimitReached,
                  planLimitMessage: connectorLimitMessage,
                },
                text: {
                  revoke: text.revoke,
                  reconnect: text.reconnect,
                  reviewSetup: text.reviewSetup,
                },
              })}
            `}
    </section>
  `;
}
