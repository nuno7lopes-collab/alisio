import { html } from "lit";
import { t } from "../../i18n/index.ts";
import { renderSkeletonStatCards } from "./loading-skeleton.ts";
import { countConnectedNodes, countReadyExecNodes } from "./nodes-shared.ts";
import { renderNodes, type NodesProps } from "./nodes.ts";

function countPendingDevices(props: NodesProps) {
  return props.devicesList?.pending?.length ?? 0;
}

function countPairedDevices(props: NodesProps) {
  return props.devicesList?.paired?.length ?? 0;
}

function countPendingNodeRequests(props: NodesProps) {
  return props.nodePairingsList?.pending?.length ?? 0;
}

function renderOverviewCard(params: {
  label: string;
  value: number | string;
  headline: string;
  detail: string;
}) {
  return html`
    <article class="alisio-connections-overview-card">
      <span class="alisio-connections-overview-card__label">${params.label}</span>
      <strong>${params.value}</strong>
      <p>${params.headline}</p>
      <div class="alisio-connections-overview-card__detail">${params.detail}</div>
    </article>
  `;
}

export function renderConnections(props: NodesProps) {
  const pendingDevices = countPendingDevices(props);
  const pairedDevices = countPairedDevices(props);
  const connectedNodes = countConnectedNodes(props.nodes);
  const execReadyNodes = countReadyExecNodes(props.nodes);
  const pendingNodes = countPendingNodeRequests(props);
  const refreshing =
    props.loading ||
    props.devicesLoading ||
    props.nodePairingsLoading ||
    props.configLoading ||
    props.execApprovalsLoading;
  const showOverviewLoading =
    refreshing && props.nodes.length === 0 && !props.devicesList && !props.nodePairingsList;
  const text = {
    eyebrow: t("alisio.connections.eyebrow"),
    title: t("alisio.connections.title"),
    subtitle: t("alisio.connections.subtitle"),
    refreshing: t("alisio.connections.refreshing"),
    refreshAll: t("alisio.connections.refreshAll"),
    devicesTitle: t("alisio.connections.devices.title"),
    runtimeTitle: t("alisio.connections.runtimeTitle"),
    pendingDevices: t("alisio.connections.pendingDevices"),
    pairedDevices: t("alisio.connections.pairedDevices"),
    liveNodes: t("alisio.connections.liveNodes"),
    execReady: t("alisio.connections.nodes.execReady"),
    pendingNodes: t("alisio.connections.pendingNodes"),
  };
  const runtimeDetail =
    pendingNodes > 0
      ? `${execReadyNodes} ${text.execReady} · ${pendingNodes} ${text.pendingNodes}`
      : `${execReadyNodes} ${text.execReady}`;

  return html`
    <section class="alisio-page alisio-connections-page">
      <div class="card alisio-connections-hero">
        <div class="alisio-page__eyebrow">${text.eyebrow}</div>
        <div class="alisio-connections-hero__head">
          <div>
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
          <button class="btn" ?disabled=${refreshing} @click=${props.onRefresh}>
            ${refreshing ? text.refreshing : text.refreshAll}
          </button>
        </div>
        <div class="alisio-connections-overview">
          ${showOverviewLoading
            ? renderSkeletonStatCards(2)
            : html`
                ${renderOverviewCard({
                  label: text.devicesTitle,
                  value: pairedDevices,
                  headline: text.pairedDevices,
                  detail: `${pendingDevices} ${text.pendingDevices}`,
                })}
                ${renderOverviewCard({
                  label: text.runtimeTitle,
                  value: connectedNodes,
                  headline: text.liveNodes,
                  detail: runtimeDetail,
                })}
              `}
        </div>
      </div>
      <div class="alisio-connections-stack">
        ${renderNodes(props, { includeExecApprovals: false })}
      </div>
    </section>
  `;
}
