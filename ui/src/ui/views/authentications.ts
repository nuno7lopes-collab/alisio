import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  AlisioAccountState,
  AlisioConnectorAuthorization,
  AlisioConnectorsBeginResult,
  AlisioConnectorDefinition,
} from "../types.ts";
import { connectorBrandStyle, getConnectorBranding } from "./connector-branding.ts";

type ConnectorStatus =
  | "connected"
  | "needs_reconnect"
  | "setup_required"
  | "ready"
  | "in_review"
  | "unavailable";

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
  if (
    row.authorization?.state === "needs_reconnect" ||
    (row.authorization?.health === "needs_reconnect" &&
      row.authorization?.state !== "not_connected")
  ) {
    return "needs_reconnect";
  }
  if (row.authorization?.state === "connected") {
    return "connected";
  }
  if (row.authorization?.health === "config_missing") {
    return "setup_required";
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

function statusHint(status: ConnectorStatus) {
  switch (status) {
    case "connected":
      return t("alisio.authentications.hints.connected");
    case "ready":
      return t("alisio.authentications.hints.ready");
    case "needs_reconnect":
      return t("alisio.authentications.hints.needsReconnect");
    case "setup_required":
      return t("alisio.authentications.hints.setupRequired");
    case "in_review":
      return t("alisio.authentications.hints.inReview");
    case "unavailable":
    default:
      return t("alisio.authentications.hints.unavailable");
  }
}

function connectedAccountLabel(authorization: AlisioConnectorAuthorization) {
  return (
    authorization.connectedAccount?.label?.trim() ||
    authorization.connectedAccount?.email?.trim() ||
    authorization.connectedAccount?.handle?.trim() ||
    null
  );
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
  },
  text: {
    revoke: string;
    reconnect: string;
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
    `;
  }
  return nothing;
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
  },
) {
  const compact = props.compact ?? false;
  const connectedAs = connectedAccountLabel(row.authorization);
  const summary = row.definition.detail?.trim() || row.definition.summary;

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
              <div class="list-sub">${summary}</div>
            </div>
          </div>
          <span class="pill ${`pill--${row.status.replace("_", "-")}`}"
            >${statusLabel(row.status)}</span
          >
        </div>
        <div class="chip-row" style="margin-top: ${compact ? "10px" : "12px"};">
          <span class="chip">${row.definition.providerLabel}</span>
          ${connectedAs
            ? html`
                <span class="chip">
                  ${t("alisio.authentications.connectedAs")}: ${connectedAs}
                </span>
              `
            : nothing}
        </div>
        <div class="muted" style="margin-top: 10px; font-size: 13px;">
          ${statusHint(row.status)}
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
  setupGuide: AlisioConnectorsBeginResult | null;
  search: string;
  categoryFilter: string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onBeginConnector: (connectorId: string) => void;
  onRevokeConnector: (connectorId: string) => void;
  onOpenChannels: () => void;
  onDismissSetupGuide: () => void;
  onOpenSupportUrl: (url: string) => void;
}) {
  const text = {
    eyebrow: t("alisio.authentications.eyebrow"),
    title: t("alisio.authentications.title"),
    subtitle: t("alisio.authentications.subtitle"),
    loading: t("alisio.authentications.loading"),
    summaryConnected: t("alisio.authentications.summary.connected"),
    summaryReady: t("alisio.authentications.summary.ready"),
    summaryAttention: t("alisio.authentications.summary.attention"),
    openChannels: t("alisio.authentications.openChannels"),
    authorizedTitle: t("alisio.authentications.authorizedTitle"),
    authorizedSubtitle: t("alisio.authentications.authorizedSubtitle"),
    searchPlaceholder: t("alisio.authentications.searchPlaceholder"),
    availableTitle: t("alisio.authentications.availableTitle"),
    emptyFiltered: t("alisio.authentications.emptyFiltered"),
    revoke: t("alisio.authentications.actions.revoke"),
    reconnect: t("alisio.authentications.actions.reconnect"),
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
        health: definition.availability === "ready" ? "config_missing" : definition.availability,
        scopes: definition.scopes,
      },
      status: resolveConnectorStatus({ definition, authorization }),
    } satisfies ConnectorRow;
  });

  const visibleRows = filterRows(rows, props.search, props.categoryFilter);
  const connectedRows = visibleRows.filter((row) => row.status === "connected");
  const availableRows = visibleRows.filter((row) => row.status !== "connected");
  const sections = CATEGORY_ORDER.map((category) => ({
    id: category,
    label: categories[category],
    rows: availableRows.filter((row) => row.definition.category === category),
  })).filter((section) => section.rows.length > 0);
  const summary = {
    connected: rows.filter((row) => row.status === "connected").length,
    ready: rows.filter((row) => row.status === "ready").length,
    attention: rows.filter((row) => row.status === "needs_reconnect").length,
  };
  const hasVisibleRows = connectedRows.length > 0 || sections.length > 0;

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
          <button class="btn btn--sm" @click=${props.onOpenChannels}>${text.openChannels}</button>
        </div>
        <div
          style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-top: 18px;"
        >
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
        </div>
      </section>

      <header class="alisio-auth-page__header">
        <div class="alisio-auth-page__copy">
          <div class="card-title">${text.availableTitle}</div>
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
              ${Object.entries(categories).map(
                ([value, label]) => html`<option value=${value}>${label}</option>`,
              )}
            </select>
          </label>
        </div>
      </header>

      ${props.error
        ? html`<div class="callout danger alisio-auth-page__error">${props.error}</div>`
        : nothing}
      ${connectedRows.length > 0
        ? html`
            <section class="card alisio-auth-section">
              <div class="alisio-auth-section__header">
                <div class="alisio-auth-section__title">
                  <div class="card-title">${text.authorizedTitle}</div>
                  <div class="card-sub">${text.authorizedSubtitle}</div>
                </div>
              </div>
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
            </section>
          `
        : nothing}
      ${props.loading
        ? html`<div class="card alisio-auth-section">
            <div class="empty-state">${text.loading}</div>
          </div>`
        : !hasVisibleRows
          ? html`<div class="card alisio-auth-section">
              <div class="empty-state">${text.emptyFiltered}</div>
            </div>`
          : sections.map(
              (section) => html`
                <section class="card alisio-auth-section">
                  <div class="alisio-auth-section__header">
                    <div class="alisio-auth-section__title">
                      <div class="card-title">${section.label}</div>
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
