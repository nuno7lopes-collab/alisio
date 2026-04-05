import type { NodeListNode } from "../../../../src/shared/node-list-types.js";
import type { GatewayBrowserClient } from "../gateway.ts";

export type NodesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  nodesLoading: boolean;
  nodes: NodeListNode[];
  nodesError?: string | null;
  lastError?: string | null;
};

function setNodesError(state: NodesState, value: string | null) {
  if ("nodesError" in state) {
    state.nodesError = value;
    return;
  }
  if ("lastError" in state) {
    state.lastError = value;
  }
}

export async function loadNodes(state: NodesState, opts?: { quiet?: boolean }) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.nodesLoading) {
    return;
  }
  state.nodesLoading = true;
  if (!opts?.quiet) {
    setNodesError(state, null);
  }
  try {
    const res = await state.client.request<{ nodes?: NodeListNode[] }>("node.list", {});
    state.nodes = Array.isArray(res.nodes) ? res.nodes : [];
  } catch (err) {
    if (!opts?.quiet) {
      setNodesError(state, String(err));
    }
  } finally {
    state.nodesLoading = false;
  }
}
