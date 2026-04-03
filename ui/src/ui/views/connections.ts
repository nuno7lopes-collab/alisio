import { html } from "lit";
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

  return html`
    <section class="alisio-page alisio-connections-page">
      <div class="card alisio-connections-hero">
        <div class="alisio-page__eyebrow">Runtime</div>
        <div class="alisio-connections-hero__head">
          <div>
            <div class="card-title">Connections</div>
            <div class="card-sub">
              Devices, live nodes, execution bindings, and approval surfaces for your runtime.
            </div>
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Refreshing…" : "Refresh all"}
          </button>
        </div>
        <div class="alisio-connections-hero__stats">
          <article class="alisio-connections-stat">
            <strong>${pendingDevices}</strong>
            <span>pending devices</span>
          </article>
          <article class="alisio-connections-stat">
            <strong>${pairedDevices}</strong>
            <span>paired devices</span>
          </article>
          <article class="alisio-connections-stat">
            <strong>${connectedNodes}</strong>
            <span>live nodes</span>
          </article>
          <article class="alisio-connections-stat">
            <strong>${props.configDirty ? "Unsaved" : "Synced"}</strong>
            <span>binding state</span>
          </article>
        </div>
      </div>
      <div class="alisio-connections-stack">${renderNodes(props)}</div>
    </section>
  `;
}
