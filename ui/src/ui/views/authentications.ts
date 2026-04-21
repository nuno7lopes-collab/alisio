import { html, nothing, type TemplateResult } from "lit";
import {
  alisioConnectorLimit,
  alisioConnectorUpgradeMessage,
  countAlisioConnectorPlanSlots,
  normalizeAlisioPlan,
} from "../../../../src/shared/alisio-billing.js";
import { resolveAlisioConnectorSurfaceUiStatus } from "../../../../src/shared/alisio-connector-status.js";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import { resolveSafeExternalUrl } from "../open-external-url.ts";
import type {
  AlisioAccountState,
  AlisioConnectorAuthorization,
  AlisioConnectorsBeginResult,
  AlisioConnectorDefinition,
  AlisioProviderOverviewItem,
  AlisioProvidersState,
} from "../types.ts";
import {
  connectorBrandStyle,
  getConnectorBranding,
  type ConnectorBranding,
} from "./connector-branding.ts";
import { buildConnectorRows, type ConnectorRow } from "./connector-state.ts";
import {
  renderSkeletonInput,
  renderSkeletonListItem,
  renderSurfaceEmptyState,
} from "./loading-skeleton.ts";

type ConnectorDialogMode = "details" | "install";
type ConnectorDisplayStatus = AlisioProviderOverviewItem["status"] | "setup_required";

type ConnectorEntry = {
  row: ConnectorRow;
  item?: AlisioProviderOverviewItem;
  overviewStatus: AlisioProviderOverviewItem["status"];
  actionStatus: ConnectorRow["status"] | "connected" | "ready" | "unavailable";
  isLinked: boolean;
  summary: string;
  detail: string;
  connectedAccountLines: string[] | null;
  providerLabel: string;
  chips: string[];
  docsUrl: string | null;
  branding: ConnectorBranding;
};

function uniqueTrimmedValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function hasNormalizedValue(values: string[], candidate: string): boolean {
  const normalizedCandidate = candidate.trim().toLowerCase();
  return values.some((value) => value.toLowerCase() === normalizedCandidate);
}

function isOpaqueConnectedAccountHandle(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  if (/^\d{10,}$/.test(normalized)) {
    return true;
  }
  if (/^[0-9a-f]{24,}$/i.test(normalized)) {
    return true;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized,
  );
}

function buildConnectedAccountLines(
  authorization: AlisioConnectorAuthorization,
  item: AlisioProviderOverviewItem | undefined,
): string[] | null {
  const emails = uniqueTrimmedValues([authorization.connectedAccount?.email, item?.accountEmail]);
  const labels = uniqueTrimmedValues([
    authorization.connectedAccount?.label,
    item?.accountLabel,
  ]).filter((label) => !hasNormalizedValue(emails, label));
  const handles = uniqueTrimmedValues([authorization.connectedAccount?.handle]).filter(
    (handle) =>
      !isOpaqueConnectedAccountHandle(handle) &&
      !hasNormalizedValue(emails, handle) &&
      !hasNormalizedValue(labels, handle),
  );
  const values = uniqueTrimmedValues([...emails, ...labels, ...handles]);
  return values.length > 0 ? values : null;
}

function buildConnectorChips(
  row: ConnectorRow,
  item: AlisioProviderOverviewItem | undefined,
  providerLabel: string,
): string[] {
  return uniqueTrimmedValues(
    item?.chips?.length ? item.chips : [providerLabel, row.definition.category].filter(Boolean),
  );
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
    ...(buildConnectedAccountLines(row.authorization, item) ?? []),
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

function connectorDisplayStatus(
  entry: Pick<ConnectorEntry, "isLinked" | "overviewStatus" | "row">,
): ConnectorDisplayStatus {
  if (!entry.isLinked && entry.row.status === "setup_required") {
    return "setup_required";
  }
  return entry.overviewStatus;
}

function connectorDisplayStatusClass(status: ConnectorDisplayStatus) {
  if (status === "setup_required") {
    return "pill--ready";
  }
  return statusClass(status);
}

function connectorDisplayStatusLabel(status: ConnectorDisplayStatus) {
  if (status === "setup_required") {
    return t("alisio.authentications.statuses.setup_required");
  }
  return statusLabel(status);
}

function mapConnectorSurfaceStatusToOverviewStatus(
  status: ReturnType<typeof resolveAlisioConnectorSurfaceUiStatus>,
): AlisioProviderOverviewItem["status"] {
  switch (status) {
    case "connected":
      return "connected";
    case "needs_reconnect":
      return "attention";
    case "in_review":
      return "coming_soon";
    case "unavailable":
      return "unavailable";
    case "ready":
    case "setup_required":
    default:
      return "ready";
  }
}

function resolveConnectorDetail(
  row: ConnectorRow,
  item: AlisioProviderOverviewItem | undefined,
  overviewStatus: AlisioProviderOverviewItem["status"],
): string {
  const overviewDetail = item?.detail?.trim();
  if (overviewDetail) {
    return overviewDetail;
  }
  const definitionDetail = row.definition.detail?.trim();
  if (definitionDetail) {
    return definitionDetail;
  }
  if (row.status === "setup_required") {
    return t("alisio.authentications.hints.setupRequired");
  }
  if (row.status === "needs_reconnect") {
    return t("alisio.authentications.hints.needsReconnect");
  }
  switch (overviewStatus) {
    case "connected":
      return t("alisio.authentications.hints.connected");
    case "coming_soon":
      return t("alisio.authentications.hints.inReview");
    case "unavailable":
      return t("alisio.authentications.hints.unavailable");
    case "ready":
    default:
      return t("alisio.authentications.hints.ready");
  }
}

function resolveConnectorEntryState(
  row: ConnectorRow,
  _item: AlisioProviderOverviewItem | undefined,
): Pick<ConnectorEntry, "overviewStatus" | "actionStatus" | "isLinked"> {
  const surfaceStatus = resolveAlisioConnectorSurfaceUiStatus({
    definition: row.definition,
    authorization: row.authorization,
  });
  const overviewStatus = mapConnectorSurfaceStatusToOverviewStatus(surfaceStatus);
  return {
    overviewStatus,
    actionStatus:
      row.status === "connected"
        ? "connected"
        : row.status === "needs_reconnect"
          ? "needs_reconnect"
          : surfaceStatus === "setup_required"
            ? "ready"
            : overviewStatus === "coming_soon"
              ? "in_review"
              : overviewStatus === "unavailable"
                ? "unavailable"
                : "ready",
    isLinked: row.authorization.state !== "not_connected",
  };
}

function safeDocsUrl(raw?: string): string | null {
  if (!raw?.trim()) {
    return null;
  }
  return resolveSafeExternalUrl(
    raw.trim(),
    typeof window !== "undefined" ? window.location.href : "https://docs.alisio.ai/",
  );
}

function entrySortKey(entry: ConnectorEntry) {
  if (entry.isLinked) {
    switch (entry.row.status) {
      case "connected":
        return 0;
      case "needs_reconnect":
        return 1;
      default:
        return entry.overviewStatus === "coming_soon"
          ? 2
          : entry.overviewStatus === "unavailable"
            ? 3
            : 1;
    }
  }
  if (entry.row.status === "setup_required") {
    return 1;
  }
  switch (entry.overviewStatus) {
    case "ready":
      return 0;
    case "attention":
      return 1;
    case "coming_soon":
      return 2;
    case "unavailable":
      return 3;
    case "connected":
    default:
      return 0;
  }
}

function buildConnectorEntries(params: {
  overview: AlisioProvidersState | null;
  connectorCatalog: AlisioConnectorDefinition[];
  connectorAuthorizations: AlisioConnectorAuthorization[];
  search: string;
}): ConnectorEntry[] {
  const connectorRows = buildConnectorRows(params.connectorCatalog, params.connectorAuthorizations);
  const appOverviewByConnectorId = new Map(
    (params.overview?.apps ?? [])
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
    (params.overview?.apps ?? [])
      .filter(
        (item): item is AlisioProviderOverviewItem & { connectorId: string } =>
          typeof item.connectorId === "string" && item.connectorId.trim().length > 0,
      )
      .map((item, index) => [item.connectorId, index]),
  );

  return connectorRows
    .filter((row) =>
      matchesConnectorSearch(row, appOverviewByConnectorId.get(row.definition.id), params.search),
    )
    .map((row) => {
      const item = appOverviewByConnectorId.get(row.definition.id);
      const state = resolveConnectorEntryState(row, item);
      const providerLabel = item?.providerLabel?.trim() || row.definition.providerLabel;
      const connectedAccountLines = buildConnectedAccountLines(row.authorization, item);
      return {
        row,
        item,
        overviewStatus: state.overviewStatus,
        actionStatus: state.actionStatus,
        isLinked: state.isLinked,
        summary: item?.subtitle?.trim() || row.definition.summary,
        detail: resolveConnectorDetail(row, item, state.overviewStatus),
        connectedAccountLines,
        providerLabel,
        chips: buildConnectorChips(row, item, providerLabel),
        docsUrl: safeDocsUrl(item?.docsPath ?? row.definition.setupUrl),
        branding: getConnectorBranding(row.definition.id, providerLabel),
      } satisfies ConnectorEntry;
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
        entrySortKey(left) - entrySortKey(right) ||
        left.row.definition.title.localeCompare(right.row.definition.title) ||
        left.row.definition.id.localeCompare(right.row.definition.id)
      );
    });
}

function renderHeader(props: {
  loading: boolean;
  search: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
}) {
  if (props.loading) {
    return html`
      <div class="loading-state__toolbar alisio-auth-shell__header" aria-hidden="true">
        <div class="loading-state__toolbar-main">
          <div class="skeleton skeleton-line skeleton-line--short"></div>
        </div>
        <div class="loading-state__toolbar-filter">${renderSkeletonInput()}</div>
      </div>
    `;
  }

  return html`
    <header class="alisio-auth-shell__header">
      <div class="alisio-auth-shell__title-wrap">
        <div class="card-title">${t("alisio.authentications.title")}</div>
      </div>
      <label class="field alisio-filter alisio-filter--search">
        <span class="sr-only">${props.searchPlaceholder}</span>
        <input
          type="search"
          placeholder=${props.searchPlaceholder}
          .value=${props.search}
          @input=${(event: Event) => props.onSearchChange((event.target as HTMLInputElement).value)}
        />
      </label>
    </header>
  `;
}

function renderSectionEmpty(message: string) {
  return html`<div class="alisio-auth-panel__empty">${message}</div>`;
}

function renderRowStatus(entry: ConnectorEntry) {
  const displayStatus = connectorDisplayStatus(entry);
  const showBadge =
    (entry.isLinked && displayStatus !== "connected") ||
    (!entry.isLinked && displayStatus !== "ready");
  return showBadge
    ? html`<span class="pill ${connectorDisplayStatusClass(displayStatus)}"
        >${connectorDisplayStatusLabel(displayStatus)}</span
      >`
    : nothing;
}

function renderRowAction(
  entry: ConnectorEntry,
  props: {
    onOpenConnectorDetails: (connectorId: string) => void;
    onOpenConnectorInstall: (connectorId: string) => void;
    planBlocksNewConnections?: boolean;
    planLimitMessage?: string | null;
  },
) {
  if (entry.isLinked) {
    const displayStatus = connectorDisplayStatus(entry);
    const indicatorClass =
      displayStatus === "connected"
        ? "is-connected"
        : displayStatus === "attention"
          ? "is-warning"
          : "is-muted";
    return html`
      <div class="alisio-app-row__aside">
        ${renderRowStatus(entry)}
        <span
          class="alisio-app-row__indicator ${indicatorClass}"
          aria-hidden="true"
          title=${connectorDisplayStatusLabel(displayStatus)}
          >${icons.check}</span
        >
      </div>
    `;
  }

  if (entry.actionStatus === "ready") {
    const disabled = props.planBlocksNewConnections === true;
    return html`
      <div class="alisio-app-row__aside">
        <button
          class="alisio-app-row__indicator is-action"
          type="button"
          ?disabled=${disabled}
          aria-label=${t("alisio.authentications.actions.install", {
            app: entry.row.definition.title,
          })}
          title=${disabled ? (props.planLimitMessage ?? "") : ""}
          @click=${() => {
            if (disabled) {
              return;
            }
            props.onOpenConnectorInstall(entry.row.definition.id);
          }}
        >
          ${icons.plus}
        </button>
      </div>
    `;
  }

  return html`<div class="alisio-app-row__aside">${renderRowStatus(entry)}</div>`;
}

function renderConnectorRow(
  entry: ConnectorEntry,
  props: {
    dialogConnectorId: string | null;
    dialogMode: ConnectorDialogMode | null;
    onOpenConnectorDetails: (connectorId: string) => void;
    onOpenConnectorInstall: (connectorId: string) => void;
    planBlocksNewConnections?: boolean;
    planLimitMessage?: string | null;
  },
) {
  const isSelected =
    props.dialogMode === "details" && props.dialogConnectorId === entry.row.definition.id;
  return html`
    <article
      class="alisio-app-row ${isSelected ? "is-selected" : ""}"
      style=${connectorBrandStyle(entry.branding)}
    >
      <button
        type="button"
        class="alisio-app-row__surface"
        @click=${() => props.onOpenConnectorDetails(entry.row.definition.id)}
      >
        <span class="alisio-app-row__icon">
          <img src=${entry.branding.logoUrl} alt="" loading="lazy" decoding="async" />
        </span>
        <span class="alisio-app-row__copy">
          <span class="alisio-app-row__title">${entry.row.definition.title}</span>
          <span class="alisio-app-row__subtitle">${entry.summary}</span>
        </span>
      </button>
      ${renderRowAction(entry, props)}
    </article>
  `;
}

function renderSection(params: {
  id: "connected" | "available";
  title: string;
  entries: ConnectorEntry[];
  emptyMessage: string;
  props: {
    dialogConnectorId: string | null;
    dialogMode: ConnectorDialogMode | null;
    onOpenConnectorDetails: (connectorId: string) => void;
    onOpenConnectorInstall: (connectorId: string) => void;
    planBlocksNewConnections?: boolean;
    planLimitMessage?: string | null;
  };
}) {
  return html`
    <section class="alisio-auth-panel" data-section=${params.id}>
      <div class="alisio-auth-panel__header">
        <div class="alisio-auth-panel__title">${params.title}</div>
        <span class="pill">${params.entries.length}</span>
      </div>
      <div class="alisio-auth-list">
        ${params.entries.length === 0
          ? renderSectionEmpty(params.emptyMessage)
          : params.entries.map((entry) => renderConnectorRow(entry, params.props))}
      </div>
    </section>
  `;
}

function renderLoadingPanels() {
  return html`
    <div class="alisio-auth-shell__columns">
      ${["connected", "available"].map(
        (section) => html`
          <section class="alisio-auth-panel" data-section=${section} aria-hidden="true">
            <div class="alisio-auth-panel__header">
              <div class="skeleton skeleton-line skeleton-line--short"></div>
              <div class="skeleton loading-state__pill loading-state__pill--small"></div>
            </div>
            <div class="alisio-auth-list">
              ${Array.from({ length: 4 }, () =>
                renderSkeletonListItem({ lines: ["medium", "long"], compact: true }),
              )}
            </div>
          </section>
        `,
      )}
    </div>
  `;
}

function renderDialogFact(label: string, value: string | TemplateResult, className?: string) {
  return html`
    <div class=${className ? `alisio-auth-dialog__fact ${className}` : "alisio-auth-dialog__fact"}>
      <div class="alisio-auth-dialog__fact-label">${label}</div>
      <div class="alisio-auth-dialog__fact-value">${value}</div>
    </div>
  `;
}

function renderConnectedAccountFact(lines: string[]) {
  return renderDialogFact(
    t("alisio.authentications.labels.account"),
    html`
      <div class="alisio-auth-dialog__account-lines">
        ${lines.map(
          (line, index) => html`
            <span
              class=${index === 0
                ? "alisio-auth-dialog__account-line alisio-auth-dialog__account-line--primary"
                : "alisio-auth-dialog__account-line"}
              >${line}</span
            >
          `,
        )}
      </div>
    `,
    "alisio-auth-dialog__fact--wide",
  );
}

function resolveSetupGuideCopy(
  setupGuide: AlisioConnectorsBeginResult,
): { title: string; body: string } | null {
  switch (setupGuide.statusReason) {
    case "missing_client_config":
      return {
        title: t("alisio.authentications.setupGuide.missingConfigTitle"),
        body: t("alisio.authentications.setupGuide.missingConfigBody"),
      };
    case "missing_token_encryption":
      return {
        title: t("alisio.authentications.setupGuide.missingTokenEncryptionTitle"),
        body: t("alisio.authentications.setupGuide.missingTokenEncryptionBody"),
      };
    case "review_required":
      return {
        title: t("alisio.authentications.setupGuide.reviewTitle"),
        body: t("alisio.authentications.setupGuide.reviewBody"),
      };
    case "unavailable":
      return {
        title: t("alisio.authentications.setupGuide.unavailableTitle"),
        body: t("alisio.authentications.setupGuide.unavailableBody"),
      };
    default:
      return null;
  }
}

function renderConnectorSetupGuide(setupGuide: AlisioConnectorsBeginResult | null) {
  if (!setupGuide || setupGuide.statusReason === "ready_for_setup") {
    return nothing;
  }
  const copy = resolveSetupGuideCopy(setupGuide);
  if (!copy) {
    return nothing;
  }
  const callbackValue = setupGuide.redirectUri?.trim() || setupGuide.callbackPath?.trim() || "";
  return html`
    <div class="callout info">
      <strong>${copy.title}</strong>
      <div>${copy.body}</div>
    </div>
    <div class="alisio-auth-dialog__facts">
      ${setupGuide.requiredEnvVars?.length
        ? renderDialogFact(
            t("alisio.authentications.setupGuide.envVars"),
            setupGuide.requiredEnvVars.join(", "),
          )
        : nothing}
      ${callbackValue
        ? renderDialogFact(t("alisio.authentications.setupGuide.callback"), callbackValue)
        : nothing}
    </div>
    ${callbackValue
      ? html`<div class="alisio-auth-dialog__lead">
          ${t("alisio.authentications.setupGuide.callbackHint")}
        </div>`
      : nothing}
  `;
}

function renderDialogActions(params: {
  entry: ConnectorEntry;
  mode: ConnectorDialogMode;
  manualSetupActive: boolean;
  planBlocksNewConnections?: boolean;
  planLimitMessage?: string | null;
  onBeginConnector: (connectorId: string) => void;
  onRevokeConnector: (connectorId: string) => void;
  onTryConnectorInChat: (connectorId: string) => void;
}) {
  const { entry, mode, manualSetupActive, planBlocksNewConnections, planLimitMessage } = params;
  const installDisabled = planBlocksNewConnections === true;
  const installTitle = installDisabled ? (planLimitMessage ?? "") : "";

  if (mode === "install") {
    if (manualSetupActive) {
      return nothing;
    }
    return html`
      <div class="alisio-auth-dialog__actions">
        <button
          class="btn primary"
          ?disabled=${installDisabled}
          title=${installTitle}
          @click=${() => params.onBeginConnector(entry.row.definition.id)}
        >
          ${t("alisio.authentications.actions.install", {
            app: entry.row.definition.title,
          })}
        </button>
      </div>
    `;
  }

  if (entry.isLinked) {
    const primaryAction =
      entry.row.status === "needs_reconnect"
        ? html`
            <button
              class="btn primary"
              @click=${() => params.onBeginConnector(entry.row.definition.id)}
            >
              ${t("alisio.authentications.actions.reconnect")}
            </button>
          `
        : entry.overviewStatus === "connected"
          ? html`
              <button
                class="btn primary"
                @click=${() => params.onTryConnectorInChat(entry.row.definition.id)}
              >
                ${t("alisio.authentications.actions.tryInChat")}
              </button>
            `
          : nothing;
    return html`
      <div class="alisio-auth-dialog__actions">
        ${primaryAction}
        <button
          class="btn danger"
          @click=${() => params.onRevokeConnector(entry.row.definition.id)}
        >
          ${t("alisio.authentications.actions.remove")}
        </button>
      </div>
    `;
  }

  if (entry.actionStatus === "ready") {
    return html`
      <div class="alisio-auth-dialog__actions">
        <button
          class="btn primary"
          @click=${() => params.onTryConnectorInChat(entry.row.definition.id)}
        >
          ${t("alisio.authentications.actions.tryInChat")}
        </button>
        <button
          class="btn"
          ?disabled=${installDisabled}
          title=${installTitle}
          @click=${() => params.onBeginConnector(entry.row.definition.id)}
        >
          ${t("alisio.authentications.actions.install", {
            app: entry.row.definition.title,
          })}
        </button>
      </div>
    `;
  }

  return nothing;
}

function renderManualSetupForm(params: {
  entry: ConnectorEntry;
  setupGuide: AlisioConnectorsBeginResult;
  connectorSetupSubmitting: boolean;
  connectorSetupError: string | null;
  onCompleteManualConnector: (connectorId: string, apiKey: string) => void;
}) {
  const isManualReady =
    params.setupGuide.connectorId === params.entry.row.definition.id &&
    params.setupGuide.statusReason === "ready_for_setup";
  if (!isManualReady) {
    return nothing;
  }
  return html`
    <form
      class="alisio-auth-dialog__manual-form"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const formData = new FormData(form);
        const apiKeyValue = formData.get("apiKey");
        const apiKey = typeof apiKeyValue === "string" ? apiKeyValue.trim() : "";
        params.onCompleteManualConnector(params.entry.row.definition.id, apiKey);
      }}
    >
      <label class="alisio-auth-dialog__manual-field">
        <span class="alisio-auth-dialog__manual-label">Stripe API key</span>
        <input
          class="alisio-auth-dialog__manual-input"
          type="password"
          name="apiKey"
          placeholder="sk_live_... or rk_live_..."
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          ?disabled=${params.connectorSetupSubmitting}
          required
        />
      </label>
      <div class="alisio-auth-dialog__manual-hint">
        ${params.setupGuide.setupHint ?? params.entry.detail}
      </div>
      ${params.connectorSetupError
        ? html`<div class="callout danger">${params.connectorSetupError}</div>`
        : nothing}
      <div class="alisio-auth-dialog__actions">
        <button class="btn primary" type="submit" ?disabled=${params.connectorSetupSubmitting}>
          ${params.connectorSetupSubmitting ? "Connecting Stripe..." : "Save and connect"}
        </button>
      </div>
    </form>
  `;
}

function renderConnectorDialog(params: {
  entry: ConnectorEntry;
  mode: ConnectorDialogMode;
  setupGuide: AlisioConnectorsBeginResult | null;
  connectorSetupSubmitting: boolean;
  connectorSetupError: string | null;
  planBlocksNewConnections?: boolean;
  planLimitMessage?: string | null;
  onCloseConnectorDialog: () => void;
  onBeginConnector: (connectorId: string) => void;
  onCompleteManualConnector: (connectorId: string, apiKey: string) => void;
  onRevokeConnector: (connectorId: string) => void;
  onTryConnectorInChat: (connectorId: string) => void;
}) {
  const title =
    params.mode === "install"
      ? t("alisio.authentications.actions.install", {
          app: params.entry.row.definition.title,
        })
      : params.entry.row.definition.title;
  const dialogId = `alisio-auth-dialog-${params.entry.row.definition.id}`;
  const manualSetupActive =
    params.mode === "install" &&
    params.setupGuide?.connectorId === params.entry.row.definition.id &&
    params.setupGuide.statusReason === "ready_for_setup";
  const displayStatus = connectorDisplayStatus(params.entry);
  return html`
    <div
      class="exec-approval-overlay alisio-auth-dialog__overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby=${dialogId}
      @click=${(event: Event) => {
        if (event.target === event.currentTarget) {
          params.onCloseConnectorDialog();
        }
      }}
    >
      <div
        class="exec-approval-card alisio-auth-dialog"
        style=${connectorBrandStyle(params.entry.branding)}
      >
        <div class="alisio-auth-dialog__hero">
          <div class="alisio-auth-dialog__hero-main">
            <span class="alisio-auth-dialog__hero-icon">
              <img src=${params.entry.branding.logoUrl} alt="" loading="lazy" decoding="async" />
            </span>
            <div class="alisio-auth-dialog__hero-copy">
              <div class="alisio-auth-dialog__eyebrow">${params.entry.providerLabel}</div>
              <div id=${dialogId} class="alisio-auth-dialog__title">${title}</div>
              <div class="alisio-auth-dialog__subtitle">${params.entry.summary}</div>
            </div>
          </div>
          <button class="btn btn--sm" type="button" @click=${params.onCloseConnectorDialog}>
            ${t("alisio.authentications.actions.close")}
          </button>
        </div>

        <div class="alisio-auth-dialog__body">
          <div class="alisio-auth-dialog__lead">${params.entry.detail}</div>
          ${params.setupGuide?.connectorId === params.entry.row.definition.id &&
          params.setupGuide.setupHint &&
          !manualSetupActive
            ? html`<div class="callout info">${params.setupGuide.setupHint}</div>`
            : nothing}
          ${renderConnectorSetupGuide(
            params.setupGuide?.connectorId === params.entry.row.definition.id
              ? params.setupGuide
              : null,
          )}
          ${renderManualSetupForm({
            entry: params.entry,
            setupGuide: params.setupGuide ?? {
              connectorId: "",
              availability: "unavailable",
              mode: "setup",
              statusReason: "unavailable",
            },
            connectorSetupSubmitting: params.connectorSetupSubmitting,
            connectorSetupError: params.connectorSetupError,
            onCompleteManualConnector: params.onCompleteManualConnector,
          })}

          <div class="alisio-auth-dialog__facts">
            ${renderDialogFact(
              t("alisio.authentications.labels.status"),
              html`<span class="pill ${connectorDisplayStatusClass(displayStatus)}"
                >${connectorDisplayStatusLabel(displayStatus)}</span
              >`,
            )}
            ${renderDialogFact(
              t("alisio.authentications.labels.provider"),
              params.entry.providerLabel,
            )}
            ${params.entry.connectedAccountLines
              ? renderConnectedAccountFact(params.entry.connectedAccountLines)
              : nothing}
          </div>

          ${params.entry.chips.length > 0
            ? html`
                <div class="chip-row alisio-auth-dialog__chips">
                  ${params.entry.chips.map((chip) => html`<span class="chip">${chip}</span>`)}
                </div>
              `
            : nothing}
          ${params.planLimitMessage
            ? html`<div class="callout info">${params.planLimitMessage}</div>`
            : nothing}

          <div class="alisio-auth-dialog__footer">
            ${renderDialogActions({
              entry: params.entry,
              mode: params.mode,
              manualSetupActive,
              planBlocksNewConnections: params.planBlocksNewConnections,
              planLimitMessage: params.planLimitMessage,
              onBeginConnector: params.onBeginConnector,
              onRevokeConnector: params.onRevokeConnector,
              onTryConnectorInChat: params.onTryConnectorInChat,
            })}
            ${params.entry.docsUrl
              ? html`
                  <a
                    class="btn"
                    href=${params.entry.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ${t("alisio.authentications.actions.openDocs")}
                  </a>
                `
              : nothing}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderAuthentications(props: {
  loading: boolean;
  error: string | null;
  account: AlisioAccountState | null;
  overview: AlisioProvidersState | null;
  connectorCatalog: AlisioConnectorDefinition[];
  connectorAuthorizations: AlisioConnectorAuthorization[];
  connectorSetupGuide: AlisioConnectorsBeginResult | null;
  connectorSetupSubmitting: boolean;
  connectorSetupError: string | null;
  search: string;
  dialogConnectorId: string | null;
  dialogMode: ConnectorDialogMode | null;
  onSearchChange: (value: string) => void;
  onOpenConnectorDetails: (connectorId: string) => void;
  onOpenConnectorInstall: (connectorId: string) => void;
  onCloseConnectorDialog: () => void;
  onBeginConnector: (connectorId: string) => void;
  onCompleteManualConnector: (connectorId: string, apiKey: string) => void;
  onRevokeConnector: (connectorId: string) => void;
  onTryConnectorInChat: (connectorId: string) => void;
}) {
  const overviewConnectorCatalog = props.overview?.connectors.catalog ?? [];
  const connectorCatalog =
    props.connectorCatalog.length > 0 ? props.connectorCatalog : overviewConnectorCatalog;
  const overviewConnectorAuthorizations = props.overview?.connectors.authorizations ?? [];
  const connectorAuthorizations =
    props.connectorAuthorizations.length > 0
      ? props.connectorAuthorizations
      : overviewConnectorAuthorizations;
  const connectorEntries = buildConnectorEntries({
    overview: props.overview,
    connectorCatalog,
    connectorAuthorizations,
    search: props.search,
  });
  const linkedEntries = connectorEntries.filter((entry) => entry.isLinked);
  const availableEntries = connectorEntries.filter((entry) => !entry.isLinked);

  const showInitialLoading =
    props.loading &&
    !props.overview &&
    connectorCatalog.length === 0 &&
    connectorAuthorizations.length === 0;
  const currentPlan = normalizeAlisioPlan(props.account?.profile.plan);
  const connectorLimit = alisioConnectorLimit(currentPlan);
  const occupiedConnectorSlots = countAlisioConnectorPlanSlots(
    connectorEntries.map((entry) => entry.row.authorization),
  );
  const connectorLimitReached = connectorLimit != null && occupiedConnectorSlots >= connectorLimit;
  const connectorLimitMessage = connectorLimitReached
    ? alisioConnectorUpgradeMessage(currentPlan)
    : null;
  const dialogEntry =
    props.dialogConnectorId != null
      ? (connectorEntries.find((entry) => entry.row.definition.id === props.dialogConnectorId) ??
        null)
      : null;

  return html`
    <section class="alisio-page alisio-auth-shell">
      ${renderHeader({
        loading: showInitialLoading,
        search: props.search,
        searchPlaceholder: t("alisio.authentications.searchPlaceholder"),
        onSearchChange: props.onSearchChange,
      })}
      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
      ${showInitialLoading
        ? renderLoadingPanels()
        : connectorEntries.length === 0
          ? renderSurfaceEmptyState({
              title: props.search
                ? t("alisio.authentications.emptyFiltered")
                : t("alisio.authentications.emptyAuthorized"),
              body: props.search ? props.search : t("alisio.authentications.availableTitle"),
              compact: true,
              centered: true,
            })
          : html`
              <div class="alisio-auth-shell__columns">
                ${renderSection({
                  id: "connected",
                  title: t("alisio.authentications.authorizedTitle"),
                  entries: linkedEntries,
                  emptyMessage: t("alisio.authentications.emptyAuthorized"),
                  props: {
                    dialogConnectorId: props.dialogConnectorId,
                    dialogMode: props.dialogMode,
                    onOpenConnectorDetails: props.onOpenConnectorDetails,
                    onOpenConnectorInstall: props.onOpenConnectorInstall,
                    planBlocksNewConnections: connectorLimitReached,
                    planLimitMessage: connectorLimitMessage,
                  },
                })}
                ${renderSection({
                  id: "available",
                  title: t("alisio.authentications.availableTitle"),
                  entries: availableEntries,
                  emptyMessage: t("alisio.authentications.emptyAvailable"),
                  props: {
                    dialogConnectorId: props.dialogConnectorId,
                    dialogMode: props.dialogMode,
                    onOpenConnectorDetails: props.onOpenConnectorDetails,
                    onOpenConnectorInstall: props.onOpenConnectorInstall,
                    planBlocksNewConnections: connectorLimitReached,
                    planLimitMessage: connectorLimitMessage,
                  },
                })}
              </div>
            `}
      ${dialogEntry && props.dialogMode
        ? renderConnectorDialog({
            entry: dialogEntry,
            mode: props.dialogMode,
            setupGuide: props.connectorSetupGuide,
            connectorSetupSubmitting: props.connectorSetupSubmitting,
            connectorSetupError: props.connectorSetupError,
            planBlocksNewConnections: connectorLimitReached,
            planLimitMessage: connectorLimitMessage,
            onCloseConnectorDialog: props.onCloseConnectorDialog,
            onBeginConnector: props.onBeginConnector,
            onCompleteManualConnector: props.onCompleteManualConnector,
            onRevokeConnector: props.onRevokeConnector,
            onTryConnectorInChat: props.onTryConnectorInChat,
          })
        : nothing}
    </section>
  `;
}
