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

export function renderConnections(props: NodesProps) {
  const pendingDevices = countPendingDevices(props);
  const pairedDevices = countPairedDevices(props);
  const connectedNodes = countConnectedNodes(props.nodes);
  const text = {
    eyebrow: t("alisio.connections.eyebrow"),
    title: t("alisio.connections.title"),
    subtitle: t("alisio.connections.subtitle"),
    refreshing: t("alisio.connections.refreshing"),
    refreshAll: t("alisio.connections.refreshAll"),
    pendingDevices: t("alisio.connections.pendingDevices"),
    pairedDevices: t("alisio.connections.pairedDevices"),
    liveNodes: t("alisio.connections.liveNodes"),
    unsaved: t("alisio.connections.unsaved"),
    synced: t("alisio.connections.synced"),
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
        <div class="alisio-connections-hero__stats">
          <article class="alisio-connections-stat">
            <strong>${pendingDevices}</strong>
            <span>${text.pendingDevices}</span>
          </article>
          <article class="alisio-connections-stat">
            <strong>${pairedDevices}</strong>
            <span>${text.pairedDevices}</span>
          </article>
          <article class="alisio-connections-stat">
            <strong>${connectedNodes}</strong>
            <span>${text.liveNodes}</span>
          </article>
          <article class="alisio-connections-stat">
            <strong>${props.configDirty ? text.unsaved : text.synced}</strong>
            <span>${text.bindingState}</span>
          </article>
        </div>
      </div>
      <div class="alisio-connections-stack">
        ${renderNodes(props, { includeExecApprovals: false })}
      </div>
    </section>
  `;
}
