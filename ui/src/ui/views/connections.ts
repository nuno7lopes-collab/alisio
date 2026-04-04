import { html } from "lit";
import { t } from "../../i18n/index.ts";
import { renderNodes, type NodesProps } from "./nodes.ts";

function countConnectedNodes(nodes: Array<Record<string, unknown>>) {
  return nodes.filter((node) => Boolean(node.connected) || Boolean(node.online)).length;
}

function countPendingDevices(props: NodesProps) {
  return props.devicesList?.pending?.length ?? 0;
}

function countPairedDevices(props: NodesProps) {
  return props.devicesList?.paired?.length ?? 0;
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
  const syncLabel = props.configDirty
    ? t("alisio.connections.unsaved")
    : t("alisio.connections.synced");
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
    bindingState: t("alisio.connections.bindingState"),
  };

  return html`
    <section class="alisio-page alisio-connections-page">
      <div class="card alisio-connections-hero">
        <div class="alisio-page__eyebrow">${text.eyebrow}</div>
        <div class="alisio-connections-hero__head">
          <div>
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? text.refreshing : text.refreshAll}
          </button>
        </div>
        <div class="alisio-connections-overview">
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
            detail: `${syncLabel} · ${text.bindingState}`,
          })}
        </div>
      </div>
      <div class="alisio-connections-stack">
        ${renderNodes(props, { includeExecApprovals: false })}
      </div>
    </section>
  `;
}
