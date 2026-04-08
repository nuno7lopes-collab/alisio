import {
  alisioConnectorLimit,
  countAlisioConnectorPlanSlots,
  alisioConnectorUpgradeMessage,
  alisioOrganizationsUpgradeMessage,
  alisioRemoteModelServersUpgradeMessage,
  alisioSharingUpgradeMessage,
  alisioSupportsOrganizations,
  alisioSupportsRemoteModelServers,
  alisioSupportsSharing,
  type AlisioPlan,
} from "../shared/alisio-billing.js";

export type AlisioPlanGateResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code:
        | "connector_limit_reached"
        | "organizations_plus_required"
        | "remote_model_servers_plus_required"
        | "sharing_plus_required";
      message: string;
    };

export function countAlisioLimitedConnectorSlots(
  authorizations: Iterable<{
    state?: string | null | undefined;
  }>,
): number {
  return countAlisioConnectorPlanSlots(authorizations);
}

export function gateAlisioConnectorConnection(params: {
  plan: AlisioPlan;
  connectedCount: number;
  connectorAlreadyConnected?: boolean;
}): AlisioPlanGateResult {
  const limit = alisioConnectorLimit(params.plan);
  if (limit == null || params.connectorAlreadyConnected === true || params.connectedCount < limit) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "connector_limit_reached",
    message: alisioConnectorUpgradeMessage(params.plan),
  };
}

export function gateAlisioOrganizationMembership(params: {
  plan: AlisioPlan;
  mode: "none" | "owner" | "member";
}): AlisioPlanGateResult {
  if (params.mode === "none" || alisioSupportsOrganizations(params.plan)) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "organizations_plus_required",
    message: alisioOrganizationsUpgradeMessage(),
  };
}

export function gateAlisioRemoteModelServers(params: { plan: AlisioPlan }): AlisioPlanGateResult {
  if (alisioSupportsRemoteModelServers(params.plan)) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "remote_model_servers_plus_required",
    message: alisioRemoteModelServersUpgradeMessage(),
  };
}

export function gateAlisioSharing(params: { plan: AlisioPlan }): AlisioPlanGateResult {
  if (alisioSupportsSharing(params.plan)) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "sharing_plus_required",
    message: alisioSharingUpgradeMessage(),
  };
}
