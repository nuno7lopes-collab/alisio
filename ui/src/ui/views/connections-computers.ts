import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../../i18n/index.ts";
import {
  resolveConnectionsModel,
  type ConnectionsModel,
  type ConnectionComputerModel,
} from "../controllers/connections-model.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import {
  renderPairedComputer,
  renderPendingDevice,
  renderRemoteComputerCard,
  renderRemoteComputerDetails,
  renderRuntimeNodeCard,
} from "./computer-cards.ts";
import type { NodesProps } from "./connections-types.ts";
import { renderSkeletonListItem, renderSkeletonPill } from "./loading-skeleton.ts";

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveConnectionsViewModel(props: NodesProps) {
  return resolveConnectionsModel(props.computers);
}

export function countAccountComputers(props: NodesProps) {
  return resolveConnectionsViewModel(props).accountComputersCount;
}

export function countPendingComputerAccess(props: NodesProps) {
  const model = resolveConnectionsViewModel(props);
  return (
    model.pendingDeviceRequests.length +
    model.pendingSharing.incoming.length +
    model.pendingSharing.outgoing.length
  );
}

export function countOnlineComputers(props: NodesProps) {
  return resolveConnectionsViewModel(props).onlineComputersCount;
}

function resolveAccountPrimaryLabel(props: NodesProps) {
  const profile = props.computers.account?.profile;
  if (!profile) {
    return t("alisio.connections.computers.accountUnknown");
  }
  return (
    profile.displayName?.trim() ||
    profile.username?.trim() ||
    profile.email?.trim() ||
    t("alisio.connections.computers.accountUnknown")
  );
}

function resolveAccountSecondaryLabel(props: NodesProps) {
  const profile = props.computers.account?.profile;
  if (!profile) {
    return null;
  }
  const parts = [profile.email?.trim() || null, profile.plan?.trim() || null].filter(
    (value): value is string => Boolean(value),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function renderPanelCount(value: number | string) {
  return html`<span class="alisio-connections-subsection__count">${value}</span>`;
}

function resolveAccountMetaLine(props: NodesProps) {
  const primary = resolveAccountPrimaryLabel(props);
  const secondary = resolveAccountSecondaryLabel(props);
  return secondary ? `${primary} · ${secondary}` : primary;
}

function resolveSharingRequestLabel(scopes: readonly string[]) {
  if (scopes.includes("model-use") && scopes.includes("exec")) {
    return t("alisio.connections.sharing.requestModelsAndExec");
  }
  if (scopes.includes("exec")) {
    return t("alisio.connections.sharing.requestExec");
  }
  if (scopes.includes("model-use")) {
    return t("alisio.connections.sharing.requestModels");
  }
  return t("alisio.connections.sharing.requestReadOnly");
}

function renderIncomingRequest(
  request: NonNullable<NodesProps["computers"]["sharing"]>["incomingRequests"][number],
  props: NodesProps,
) {
  const title = request.requester.label;
  const subtitle = [request.targetLabel, resolveSharingRequestLabel(request.scopes)].join(" · ");
  const createdAtMs = parseTimestamp(request.createdAt);
  return html`
    <div
      class="list-item alisio-connections-entry alisio-connections-entry--pending alisio-connections-entry--split"
    >
      <div class="list-main">
        <div class="alisio-connections-entry__head">
          <div class="list-title">${title}</div>
          <div class="alisio-connections-entry__pills">
            <span class="pill pill--in-review"
              >${t("alisio.connections.computers.pendingBadge")}</span
            >
          </div>
        </div>
        <div class="list-sub">${subtitle}</div>
        <div class="alisio-connections-entry__note">
          ${t("alisio.connections.computers.requestReceived", {
            value: formatRelativeTimestamp(createdAtMs),
          })}
        </div>
      </div>
      <div class="list-meta alisio-connections-entry__actions">
        <div class="row alisio-connections-action-row">
          ${props.onSharingApprove
            ? html`
                <button
                  class="btn btn--sm primary"
                  @click=${() => props.onSharingApprove?.(request.requestId, request.scopes)}
                >
                  ${t("alisio.connections.sharing.approve")}
                </button>
              `
            : nothing}
          ${props.onSharingReject
            ? html`
                <button
                  class="btn btn--sm"
                  @click=${() => props.onSharingReject?.(request.requestId)}
                >
                  ${t("alisio.connections.sharing.reject")}
                </button>
              `
            : nothing}
        </div>
      </div>
    </div>
  `;
}

function renderOutgoingRequest(
  request: NonNullable<NodesProps["computers"]["sharing"]>["outgoingRequests"][number],
) {
  const title = request.owner.label;
  const subtitle = [request.targetLabel, resolveSharingRequestLabel(request.scopes)].join(" · ");
  const createdAtMs = parseTimestamp(request.createdAt);
  return html`
    <div
      class="list-item alisio-connections-entry alisio-connections-entry--pending alisio-connections-entry--single"
    >
      <div class="list-main">
        <div class="alisio-connections-entry__head">
          <div class="list-title">${title}</div>
          <div class="alisio-connections-entry__pills">
            <span class="pill pill--in-review"
              >${t("alisio.connections.sharing.requestStatus.pending")}</span
            >
          </div>
        </div>
        <div class="list-sub">${subtitle}</div>
        <div class="alisio-connections-entry__note">
          ${t("alisio.connections.computers.requestSent", {
            value: formatRelativeTimestamp(createdAtMs),
          })}
        </div>
      </div>
    </div>
  `;
}

function renderCurrentFallbackComputer(
  current: NonNullable<NonNullable<NodesProps["computers"]["account"]>["devices"]>[number],
) {
  return html`
    <div class="list-item alisio-connections-entry alisio-connections-entry--single">
      <div class="list-main">
        <div class="alisio-connections-entry__head">
          <div class="list-title">${current.label}</div>
          <div class="alisio-connections-entry__pills">
            <span class="pill pill--connected">${t("alisio.connections.devices.current")}</span>
          </div>
        </div>
        <div class="list-sub">${current.platform}</div>
        <div class="alisio-connections-entry__note">
          ${t("alisio.connections.computers.currentSeen", {
            value: formatRelativeTimestamp(parseTimestamp(current.lastSeenAt)),
          })}
        </div>
      </div>
    </div>
  `;
}

function renderComputerRuntimeContent(
  computer: ConnectionComputerModel,
  pairedRuntimeNodes: Map<
    string,
    NonNullable<NodesProps["computers"]["nodePairingsList"]>["paired"][number]
  >,
) {
  if (!computer.local || computer.runtimeNodes.length === 0) {
    return nothing;
  }
  return html`
    <div class="alisio-connections-entry__runtime">
      <div class="muted alisio-connections-entry__section-label">
        ${t("alisio.connections.nodes.title")}
      </div>
      <div class="alisio-node-list">
        ${repeat(
          computer.runtimeNodes,
          (node) => (typeof node.nodeId === "string" ? node.nodeId : JSON.stringify(node)),
          (node) => renderRuntimeNodeCard(node, pairedRuntimeNodes),
        )}
      </div>
    </div>
  `;
}

function renderComputerRemoteContent(computer: ConnectionComputerModel, props: NodesProps) {
  if (!computer.local || !computer.remote) {
    return nothing;
  }
  return html`
    <div class="alisio-connections-entry__runtime">
      <div class="muted alisio-connections-entry__section-label">
        ${t("alisio.connections.remote.title")}
      </div>
      ${renderRemoteComputerDetails(computer.remote, props)}
    </div>
  `;
}

function renderComputerEntry(
  computer: ConnectionComputerModel,
  props: NodesProps,
  pairedRuntimeNodes: Map<
    string,
    NonNullable<NodesProps["computers"]["nodePairingsList"]>["paired"][number]
  >,
) {
  if (computer.local) {
    return renderPairedComputer(computer.local, props, {
      compact: true,
      runtimeContent: html`
        ${renderComputerRuntimeContent(computer, pairedRuntimeNodes)}
        ${renderComputerRemoteContent(computer, props)}
      `,
    });
  }
  if (computer.fallback) {
    return renderCurrentFallbackComputer(computer.fallback);
  }
  if (computer.remote) {
    return renderRemoteComputerCard(computer.remote, props, { compact: true });
  }
  return nothing;
}

function renderComputersSection(params: { title: string; count?: number; items: unknown[] }) {
  return html`
    <section class="alisio-connections-subsection">
      <div class="alisio-connections-subsection__head">
        <span class="alisio-connections-subsection__title">${params.title}</span>
        ${typeof params.count === "number" ? renderPanelCount(params.count) : nothing}
      </div>
      <div class="list">${params.items}</div>
    </section>
  `;
}

function renderCollapsibleComputersSection(params: {
  title: string;
  count: number;
  items: unknown[];
  open?: boolean;
}) {
  return html`
    <details
      class="alisio-connections-subsection alisio-connections-subsection--collapsible"
      ?open=${params.open === true}
    >
      <summary class="alisio-connections-subsection__summary">
        <span class="alisio-connections-subsection__title">${params.title}</span>
        <span class="alisio-connections-subsection__summary-meta">
          ${renderPanelCount(params.count)}
          <span class="alisio-connections-disclosure-icon" aria-hidden="true"
            >${icons.chevronDown}</span
          >
        </span>
      </summary>
      <div class="alisio-connections-subsection__body">
        <div class="list">${params.items}</div>
      </div>
    </details>
  `;
}

export function renderComputersPanel(
  props: NodesProps,
  model: ConnectionsModel = resolveConnectionsViewModel(props),
) {
  const initialLoading =
    !props.computers.devicesList &&
    !props.computers.devicesError &&
    !props.computers.sharing &&
    !props.computers.sharingError &&
    props.computers.devicesLoading;
  const pairedRuntimeNodes = new Map(
    (props.computers.nodePairingsList?.paired ?? []).map((node) => [node.nodeId, node] as const),
  );
  const pendingCount =
    model.pendingDeviceRequests.length +
    model.pendingSharing.incoming.length +
    model.pendingSharing.outgoing.length;
  const pendingItems = [
    ...model.pendingDeviceRequests.map((request) => renderPendingDevice(request, props)),
    ...model.pendingSharing.incoming.map((request) => renderIncomingRequest(request, props)),
    ...model.pendingSharing.outgoing.map((request) => renderOutgoingRequest(request)),
  ];
  const currentItems = model.currentComputer
    ? [renderComputerEntry(model.currentComputer, props, pairedRuntimeNodes)]
    : [];
  const accountItems = model.sameAccountComputers.map((computer) =>
    renderComputerEntry(computer, props, pairedRuntimeNodes),
  );
  const otherItems = model.externalComputers.map((computer) =>
    renderComputerEntry(computer, props, pairedRuntimeNodes),
  );
  const refreshing = props.computers.devicesLoading || Boolean(props.computers.sharingLoading);

  return html`
    <section
      class="card alisio-connections-panel alisio-connections-panel--computers"
      aria-busy=${refreshing ? "true" : "false"}
    >
      <div class="alisio-connections-panel__head">
        <div class="alisio-connections-panel__identity">
          <span class="alisio-connections-panel__icon" aria-hidden="true">${icons.smartphone}</span>
          <div>
            <div class="card-title">${t("alisio.connections.computers.title")}</div>
            <div class="card-sub">${resolveAccountMetaLine(props)}</div>
          </div>
        </div>
        <button class="btn btn--ghost btn--sm" ?disabled=${refreshing} @click=${props.onRefresh}>
          ${refreshing ? t("alisio.connections.loading") : t("common.refresh")}
        </button>
      </div>
      ${props.computers.devicesError
        ? html`<div class="callout danger">${props.computers.devicesError}</div>`
        : nothing}
      ${props.computers.sharingError
        ? html`<div class="callout danger">${props.computers.sharingError}</div>`
        : nothing}
      ${initialLoading
        ? html`
            <div
              class="alisio-connections-sections"
              role="status"
              aria-label=${t("alisio.connections.loading")}
            >
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title"
                    >${t("alisio.connections.computers.pendingTitle")}</span
                  >
                  ${renderSkeletonPill({ small: true })}
                </div>
                <div class="loading-state__list">
                  ${renderSkeletonListItem({ lines: ["medium", "long", "short"], aside: "button" })}
                  ${renderSkeletonListItem({ lines: ["short", "medium"], aside: "button" })}
                </div>
              </section>
            </div>
          `
        : html`
            <div class="alisio-connections-sections">
              ${pendingCount > 0
                ? renderComputersSection({
                    title: t("alisio.connections.computers.pendingTitle"),
                    count: pendingCount,
                    items: pendingItems,
                  })
                : nothing}
              ${currentItems.length > 0
                ? renderComputersSection({
                    title: t("alisio.connections.computers.currentTitle"),
                    items: currentItems,
                  })
                : nothing}
              ${accountItems.length > 0
                ? renderCollapsibleComputersSection({
                    title: t("alisio.connections.computers.accountTitle"),
                    count: accountItems.length,
                    items: accountItems,
                    open: accountItems.length <= 2,
                  })
                : nothing}
              ${otherItems.length > 0
                ? renderCollapsibleComputersSection({
                    title: t("alisio.connections.computers.externalTitle"),
                    count: otherItems.length,
                    items: otherItems,
                    open: false,
                  })
                : nothing}
              ${pendingCount === 0 &&
              currentItems.length === 0 &&
              accountItems.length === 0 &&
              otherItems.length === 0
                ? html`
                    <div class="alisio-connections-empty">
                      ${t("alisio.connections.computers.accountEmpty")}
                    </div>
                  `
                : nothing}
            </div>
          `}
    </section>
  `;
}
