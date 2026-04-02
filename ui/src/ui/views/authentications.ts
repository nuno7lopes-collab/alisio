import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  AlisioAccountState,
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
} from "../types.ts";
import {
  connectorBrandStyle,
  connectorFallbackMonogram,
  getConnectorBranding,
} from "./connector-branding.ts";

type ConnectorStatus = "connected" | "needs_reconnect" | "ready" | "in_review" | "unavailable";

type ConnectorRow = {
  definition: AlisioConnectorDefinition;
  authorization: AlisioConnectorAuthorization;
  status: ConnectorStatus;
};

const CATEGORY_ORDER = ["social", "google", "productivity", "development"] as const;

function resolveConnectorStatus(row: {
  definition: AlisioConnectorDefinition;
  authorization: AlisioConnectorAuthorization | undefined;
}): ConnectorStatus {
  if (row.authorization?.state === "connected") {
    return "connected";
  }
  if (
    row.authorization?.state === "needs_reconnect" ||
    row.authorization?.health === "needs_reconnect"
  ) {
    return "needs_reconnect";
  }
  if (row.definition.availability === "ready") {
    return "ready";
  }
  if (row.definition.availability === "in_review") {
    return "in_review";
  }
  return "unavailable";
}

function filterRows(rows: ConnectorRow[], search: string, category: string) {
  const normalizedSearch = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (category !== "all" && row.definition.category !== category) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    const haystack = [
      row.definition.title,
      row.definition.providerLabel,
      row.definition.summary,
      row.definition.detail ?? "",
      row.authorization.connectedAccount?.label ?? "",
      row.authorization.connectedAccount?.email ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  });
}

function categoryLabels() {
  return {
    all: t("alisio.authentications.categories.all"),
    social: t("alisio.authentications.categories.social"),
    google: t("alisio.authentications.categories.google"),
    productivity: t("alisio.authentications.categories.productivity"),
    development: t("alisio.authentications.categories.development"),
  } as const;
}

function statusLabel(status: ConnectorStatus) {
  return t(`alisio.authentications.statuses.${status}`);
}

function renderConnectorIcon(definition: AlisioConnectorDefinition) {
  const branding = getConnectorBranding(definition.id, definition.providerLabel);
  const monogram = connectorFallbackMonogram(definition.title);

  return html`
    <span class="alisio-auth-card__icon" style=${connectorBrandStyle(branding)}>
      <span class="alisio-auth-card__icon-fallback">${monogram}</span>
      ${branding.logoUrl
        ? html`
            <img
              src=${branding.logoUrl}
              alt=""
              loading="lazy"
              decoding="async"
              @error=${(event: Event) => {
                (event.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          `
        : nothing}
    </span>
  `;
}

function renderConnectorAction(
  row: ConnectorRow,
  props: {
    onBeginConnector: (connectorId: string) => void;
    onRevokeConnector: (connectorId: string) => void;
  },
  text: {
    revoke: string;
    reconnect: string;
    inReviewHint: string;
    unavailableHint: string;
    needsReconnectHint: string;
  },
) {
  if (row.status === "connected") {
    return html`
      <button class="btn btn--sm danger" @click=${() => props.onRevokeConnector(row.definition.id)}>
        ${text.revoke}
      </button>
    `;
  }
  if (row.status === "ready") {
    return html`
      <button class="btn btn--sm primary" @click=${() => props.onBeginConnector(row.definition.id)}>
        ${row.definition.connectLabel}
      </button>
    `;
  }
  if (row.status === "needs_reconnect") {
    return html`
      <button class="btn btn--sm primary" @click=${() => props.onBeginConnector(row.definition.id)}>
        ${text.reconnect}
      </button>
      <span class="alisio-auth-card__hint">${text.needsReconnectHint}</span>
    `;
  }
  return html`
    <span class="alisio-auth-card__hint">
      ${row.status === "in_review" ? text.inReviewHint : text.unavailableHint}
    </span>
  `;
}

function renderConnectorCard(
  row: ConnectorRow,
  props: {
    compact?: boolean;
    onBeginConnector: (connectorId: string) => void;
    onRevokeConnector: (connectorId: string) => void;
  },
  text: {
    revoke: string;
    reconnect: string;
    inReviewHint: string;
    unavailableHint: string;
    needsReconnectHint: string;
  },
) {
  const compact = props.compact ?? false;
  const connectedAccountLabel =
    row.authorization.connectedAccount?.label ?? row.definition.providerLabel;
  const connectedAccountEmail = row.authorization.connectedAccount?.email?.trim();

  return html`
    <article
      class="alisio-auth-card ${row.status === "connected"
        ? "alisio-auth-card--connected"
        : ""} ${compact ? "alisio-auth-card--compact" : ""}"
    >
      <div class="alisio-auth-card__main">
        <div class="alisio-auth-card__head">
          <div class="alisio-auth-card__brand">
            ${renderConnectorIcon(row.definition)}
            <div class="alisio-auth-card__brand-copy">
              <div class="list-title">${row.definition.title}</div>
              <div class="list-sub">
                ${connectedAccountLabel}${connectedAccountEmail
                  ? ` · ${connectedAccountEmail}`
                  : ""}
              </div>
            </div>
          </div>
          <span class="pill ${`pill--${row.status.replace("_", "-")}`}"
            >${statusLabel(row.status)}</span
          >
        </div>
        <div class="alisio-auth-card__summary">${row.definition.summary}</div>
        ${row.definition.detail && !compact
          ? html`<div class="alisio-auth-card__detail">${row.definition.detail}</div>`
          : nothing}
        <div class="alisio-auth-card__scopes">
          ${(compact ? row.definition.scopes.slice(0, 2) : row.definition.scopes.slice(0, 3)).map(
            (scope) => html`<span class="chip">${scope}</span>`,
          )}
        </div>
      </div>
      <div class="alisio-auth-card__aside">${renderConnectorAction(row, props, text)}</div>
    </article>
  `;
}

export function renderAuthentications(props: {
  loading: boolean;
  error: string | null;
  account: AlisioAccountState | null;
  connectorCatalog: AlisioConnectorDefinition[];
  connectorAuthorizations: AlisioConnectorAuthorization[];
  search: string;
  categoryFilter: string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onBeginConnector: (connectorId: string) => void;
  onRevokeConnector: (connectorId: string) => void;
}) {
  const text = {
    title: t("alisio.authentications.title"),
    subtitle: t("alisio.authentications.subtitle"),
    loading: t("alisio.authentications.loading"),
    connected: t("alisio.authentications.connected"),
    connectedHint: t("alisio.authentications.connectedHint"),
    ready: t("alisio.authentications.ready"),
    readyHint: t("alisio.authentications.readyHint"),
    account: t("alisio.authentications.account"),
    localAccount: t("alisio.authentications.localAccount"),
    notConfiguredYet: t("alisio.authentications.notConfiguredYet"),
    authorizedTitle: t("alisio.authentications.authorizedTitle"),
    authorizedSubtitle: t("alisio.authentications.authorizedSubtitle"),
    emptyAuthorized: t("alisio.authentications.emptyAuthorized"),
    catalogTitle: t("alisio.authentications.catalogTitle"),
    catalogSubtitle: t("alisio.authentications.catalogSubtitle"),
    searchPlaceholder: t("alisio.authentications.searchPlaceholder"),
    revoke: t("alisio.authentications.actions.revoke"),
    reconnect: t("alisio.authentications.actions.reconnect"),
    inReviewHint: t("alisio.authentications.hints.inReview"),
    unavailableHint: t("alisio.authentications.hints.unavailable"),
    needsReconnectHint: t("alisio.authentications.hints.needsReconnect"),
  };
  const categories = categoryLabels();

  const rows = props.connectorCatalog.map((definition) => {
    const authorization = props.connectorAuthorizations.find(
      (entry) => entry.connectorId === definition.id,
    );
    return {
      definition,
      authorization: authorization ?? {
        connectorId: definition.id,
        state: "not_connected",
        health: definition.availability === "ready" ? "needs_reconnect" : definition.availability,
        scopes: definition.scopes,
      },
      status: resolveConnectorStatus({ definition, authorization }),
    } satisfies ConnectorRow;
  });

  const visibleRows = filterRows(rows, props.search, props.categoryFilter);
  const connectedRows = rows.filter((row) => row.status === "connected");
  const sections = CATEGORY_ORDER.map((category) => ({
    id: category,
    label: categories[category],
    rows: visibleRows.filter((row) => row.definition.category === category),
  })).filter((section) => section.rows.length > 0);

  return html`
    <section class="alisio-page alisio-auth-page">
      <div class="alisio-page__hero card alisio-auth-hero">
        <div class="alisio-auth-hero__copy">
          <div class="card-title">${text.title}</div>
          <div class="card-sub">${text.subtitle}</div>
        </div>
        <div class="alisio-metrics">
          <div class="agent-kv">
            <div class="label">${text.connected}</div>
            <div>${connectedRows.length}</div>
            <div class="agent-kv-sub">${text.connectedHint}</div>
          </div>
          <div class="agent-kv">
            <div class="label">${text.ready}</div>
            <div>${rows.filter((row) => row.status === "ready").length}</div>
            <div class="agent-kv-sub">${text.readyHint}</div>
          </div>
          <div class="agent-kv">
            <div class="label">${text.account}</div>
            <div>${props.account?.profile.displayName ?? text.localAccount}</div>
            <div class="agent-kv-sub">${props.account?.profile.email ?? text.notConfiguredYet}</div>
          </div>
        </div>
      </div>

      <div class="card alisio-auth-toolbar">
        <div class="alisio-section-head">
          <div>
            <div class="card-title">${text.catalogTitle}</div>
            <div class="card-sub">${text.catalogSubtitle}</div>
          </div>
          <div class="alisio-filters">
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
                ${Object.entries(categories).map(
                  ([value, label]) => html`<option value=${value}>${label}</option>`,
                )}
              </select>
            </label>
          </div>
        </div>
        ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
      </div>

      <section class="card alisio-auth-section">
        <div class="alisio-section-head">
          <div>
            <div class="card-title">${text.authorizedTitle}</div>
            <div class="card-sub">${text.authorizedSubtitle}</div>
          </div>
        </div>
        ${connectedRows.length === 0
          ? html`<div class="empty-state">${text.emptyAuthorized}</div>`
          : html`
              <div class="alisio-authorized-grid">
                ${connectedRows.map((row) =>
                  renderConnectorCard(
                    row,
                    {
                      compact: true,
                      onBeginConnector: props.onBeginConnector,
                      onRevokeConnector: props.onRevokeConnector,
                    },
                    text,
                  ),
                )}
              </div>
            `}
      </section>

      ${props.loading
        ? html`<div class="card"><div class="empty-state">${text.loading}</div></div>`
        : sections.map(
            (section) => html`
              <section class="card alisio-auth-section">
                <div class="alisio-section-head">
                  <div>
                    <div class="card-title">${section.label}</div>
                    <div class="card-sub">
                      ${section.rows.length} connector${section.rows.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                <div class="alisio-auth-grid">
                  ${section.rows.map((row) =>
                    renderConnectorCard(
                      row,
                      {
                        onBeginConnector: props.onBeginConnector,
                        onRevokeConnector: props.onRevokeConnector,
                      },
                      text,
                    ),
                  )}
                </div>
              </section>
            `,
          )}
    </section>
  `;
}
