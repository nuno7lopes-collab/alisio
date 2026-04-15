import { html, nothing } from "lit";
import type { NodeListNode } from "../../../../src/shared/node-list-types.js";
import { t } from "../../i18n/index.ts";
import { groupPairedDevicesByComputer, type PairedComputer } from "../controllers/devices.ts";
import { resolveRemoteComputerRecords } from "../controllers/remote-computers.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { renderSkeletonListItem, renderSkeletonPill } from "./loading-skeleton.ts";
import type { NodesProps } from "./nodes.ts";
import { renderPendingDevice, renderPairedComputer } from "./nodes.ts";
import { renderRemoteComputerCard } from "./remote-computers.ts";

function resolveRemoteGroups(props: NodesProps) {
  const all = resolveRemoteComputerRecords({
    sharing: props.sharing ?? null,
    nodes: props.nodes as NodeListNode[],
    devicesList: props.devicesList,
  });
  return {
    all,
    sameAccount: all.filter((computer) => computer.sameAccount),
    external: all.filter((computer) => !computer.sameAccount),
  };
}

function resolveLocalComputerIds(props: NodesProps, localComputers: readonly PairedComputer[]) {
  const ids = new Set(localComputers.map((computer) => computer.computerId));
  const fallbackCurrent = resolveCurrentFallbackComputer(props, localComputers);
  if (fallbackCurrent?.id?.trim()) {
    ids.add(fallbackCurrent.id.trim());
  }
  return ids;
}

function resolveCurrentLocalComputerIds(
  props: NodesProps,
  localComputers: readonly PairedComputer[],
) {
  const ids = new Set(
    localComputers
      .filter((computer) => computer.isCurrentComputer)
      .map((computer) => computer.computerId),
  );
  const fallbackCurrent = resolveCurrentFallbackComputer(props, localComputers);
  if (fallbackCurrent?.id?.trim()) {
    ids.add(fallbackCurrent.id.trim());
  }
  return ids;
}

function resolveVisibleRemoteGroups(props: NodesProps, localComputers?: readonly PairedComputer[]) {
  const groupedLocalComputers =
    localComputers ??
    groupPairedDevicesByComputer(props.devicesList?.paired ?? [], props.currentDeviceId ?? null);
  const localComputerIds = resolveLocalComputerIds(props, groupedLocalComputers);
  const remoteGroups = resolveRemoteGroups(props);
  const sameAccount = remoteGroups.sameAccount.filter(
    (computer) => !localComputerIds.has(computer.computerId),
  );
  const external = remoteGroups.external;
  return {
    all: [...sameAccount, ...external],
    sameAccount,
    external,
  };
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveCurrentFallbackComputer(
  props: NodesProps,
  localComputers: readonly PairedComputer[],
) {
  if (localComputers.some((computer) => computer.isCurrentComputer)) {
    return null;
  }
  const current =
    props.account?.devices.find((device) => device.current) ?? props.account?.devices[0];
  if (!current) {
    return null;
  }
  return current;
}

export function countAccountComputers(props: NodesProps) {
  const localComputers = groupPairedDevicesByComputer(
    props.devicesList?.paired ?? [],
    props.currentDeviceId ?? null,
  );
  const remoteGroups = resolveVisibleRemoteGroups(props, localComputers);
  const computerIds = resolveLocalComputerIds(props, localComputers);
  for (const computer of remoteGroups.sameAccount) {
    computerIds.add(computer.computerId);
  }
  return computerIds.size;
}

export function countExternalComputers(props: NodesProps) {
  return new Set(resolveVisibleRemoteGroups(props).external.map((computer) => computer.computerId))
    .size;
}

export function countPendingComputerAccess(props: NodesProps) {
  const sharingRequests = resolveVisiblePendingSharingRequests(props);
  return (
    (props.devicesList?.pending?.length ?? 0) +
    sharingRequests.incoming.length +
    sharingRequests.outgoing.length
  );
}

export function countOnlineComputers(props: NodesProps) {
  const localComputers = groupPairedDevicesByComputer(
    props.devicesList?.paired ?? [],
    props.currentDeviceId ?? null,
  );
  const remoteGroups = resolveVisibleRemoteGroups(props, localComputers);
  const hasCurrentComputer =
    localComputers.some((computer) => computer.isCurrentComputer) ||
    resolveCurrentFallbackComputer(props, localComputers) !== null;
  const onlineComputerIds = new Set(
    remoteGroups.all
      .filter((computer) => computer.connected)
      .map((computer) => computer.computerId),
  );
  if (hasCurrentComputer) {
    for (const computerId of resolveCurrentLocalComputerIds(props, localComputers)) {
      onlineComputerIds.add(computerId);
    }
  }
  return onlineComputerIds.size;
}

function resolveAccountPrimaryLabel(props: NodesProps) {
  const profile = props.account?.profile;
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
  const profile = props.account?.profile;
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

function resolveVisiblePendingSharingRequests(props: NodesProps): {
  incoming: NonNullable<NodesProps["sharing"]>["incomingRequests"];
  outgoing: NonNullable<NodesProps["sharing"]>["outgoingRequests"];
} {
  const incoming = (props.sharing?.incomingRequests ?? []).filter(
    (request) => request.status === "pending",
  );
  const incomingIds = new Set(incoming.map((request) => request.requestId));
  const outgoing = (props.sharing?.outgoingRequests ?? []).filter(
    (request) => request.status === "pending" && !incomingIds.has(request.requestId),
  );
  return { incoming, outgoing };
}

function renderIncomingRequest(
  request: NonNullable<NodesProps["sharing"]>["incomingRequests"][number],
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
  request: NonNullable<NodesProps["sharing"]>["outgoingRequests"][number],
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
  current: NonNullable<NonNullable<NodesProps["account"]>["devices"]>[number],
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

export function renderComputersPanel(props: NodesProps) {
  const localComputers = groupPairedDevicesByComputer(
    props.devicesList?.paired ?? [],
    props.currentDeviceId ?? null,
  );
  const remoteGroups = resolveVisibleRemoteGroups(props, localComputers);
  const fallbackCurrent = resolveCurrentFallbackComputer(props, localComputers);
  const initialLoading =
    !props.devicesList &&
    !props.devicesError &&
    !props.sharing &&
    !props.sharingError &&
    props.devicesLoading;
  const visibleSharingRequests = resolveVisiblePendingSharingRequests(props);
  const pendingItems = [
    ...(props.devicesList?.pending ?? []).map((request) => renderPendingDevice(request, props)),
    ...visibleSharingRequests.incoming.map((request) => renderIncomingRequest(request, props)),
    ...visibleSharingRequests.outgoing.map((request) => renderOutgoingRequest(request)),
  ];
  const currentComputer = localComputers.find((computer) => computer.isCurrentComputer) ?? null;
  const currentItems = fallbackCurrent
    ? [renderCurrentFallbackComputer(fallbackCurrent)]
    : currentComputer
      ? [renderPairedComputer(currentComputer, props, { compact: true })]
      : [];
  const accountItems = [
    ...localComputers
      .filter((computer) => !computer.isCurrentComputer)
      .map((computer) => renderPairedComputer(computer, props, { compact: true })),
    ...remoteGroups.sameAccount.map((computer) =>
      renderRemoteComputerCard(computer, props, { compact: true }),
    ),
  ];
  const otherItems = remoteGroups.external.map((computer) =>
    renderRemoteComputerCard(computer, props, { compact: true }),
  );
  const pendingCount = countPendingComputerAccess(props);
  const refreshing = props.devicesLoading || Boolean(props.sharingLoading);

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
      ${props.devicesError
        ? html`<div class="callout danger">${props.devicesError}</div>`
        : nothing}
      ${props.sharingError
        ? html`<div class="callout danger">${props.sharingError}</div>`
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
