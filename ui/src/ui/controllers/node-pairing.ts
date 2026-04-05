import type {
  PairingList,
  PendingRequest,
  PairedNode,
} from "../../../../src/shared/node-list-types.js";
import { t } from "../../i18n/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

export type PendingNodePairing = PendingRequest;
export type PairedRuntimeNode = PairedNode;
export type RuntimeNodePairingList = PairingList;

export type NodePairingsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  nodePairingsLoading: boolean;
  nodePairingsError: string | null;
  nodePairingsList: RuntimeNodePairingList | null;
};

export async function loadNodePairings(state: NodePairingsState, opts?: { quiet?: boolean }) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.nodePairingsLoading) {
    return;
  }
  state.nodePairingsLoading = true;
  if (!opts?.quiet) {
    state.nodePairingsError = null;
  }
  try {
    const res = await state.client.request<{
      pending?: PendingNodePairing[];
      paired?: PairedRuntimeNode[];
    }>("node.pair.list", {});
    state.nodePairingsList = {
      pending: Array.isArray(res?.pending) ? res.pending : [],
      paired: Array.isArray(res?.paired) ? res.paired : [],
    };
  } catch (err) {
    if (!opts?.quiet) {
      state.nodePairingsError = String(err);
    }
  } finally {
    state.nodePairingsLoading = false;
  }
}

export async function approveNodePairing(state: NodePairingsState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("node.pair.approve", { requestId });
    await loadNodePairings(state);
  } catch (err) {
    state.nodePairingsError = String(err);
  }
}

export async function rejectNodePairing(state: NodePairingsState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const confirmed = window.confirm(t("alisio.connections.nodes.rejectConfirm"));
  if (!confirmed) {
    return;
  }
  try {
    await state.client.request("node.pair.reject", { requestId });
    await loadNodePairings(state);
  } catch (err) {
    state.nodePairingsError = String(err);
  }
}
