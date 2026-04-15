import { isAlisioConnectorRuntimeReady } from "./alisio-connector-runtime.js";

export type AlisioConnectorAvailability = "ready" | "in_review" | "unavailable";

export type AlisioConnectorAuthorizationState = "not_connected" | "connected" | "needs_reconnect";

export type AlisioConnectorAuthorizationHealth =
  | "healthy"
  | "needs_reconnect"
  | "config_missing"
  | "in_review"
  | "unavailable";

export type AlisioConnectorUiStatus =
  | "connected"
  | "needs_reconnect"
  | "setup_required"
  | "ready"
  | "in_review"
  | "unavailable";

export type AlisioConnectorStatusSummary = {
  total: number;
  ready: number;
  connected: number;
  needsReconnect: number;
  inReview: number;
  unavailable: number;
  available: number;
};

type AlisioConnectorDefinitionLike = {
  id: string;
  availability: AlisioConnectorAvailability;
};

type AlisioConnectorAuthorizationLike =
  | {
      state: AlisioConnectorAuthorizationState;
      health: AlisioConnectorAuthorizationHealth;
    }
  | undefined;

export function resolveAlisioConnectorUiStatus(params: {
  definition: {
    availability: AlisioConnectorAvailability;
  };
  authorization?:
    | {
        state: AlisioConnectorAuthorizationState;
        health: AlisioConnectorAuthorizationHealth;
      }
    | undefined;
}): AlisioConnectorUiStatus {
  if (
    params.authorization?.state === "needs_reconnect" ||
    (params.authorization?.health === "needs_reconnect" &&
      params.authorization.state !== "not_connected")
  ) {
    return "needs_reconnect";
  }
  if (params.authorization?.state === "connected") {
    return "connected";
  }
  if (params.authorization?.health === "config_missing") {
    return "setup_required";
  }
  if (params.definition.availability === "ready") {
    return "ready";
  }
  if (params.definition.availability === "in_review") {
    return "in_review";
  }
  return "unavailable";
}

export function resolveAlisioConnectorSurfaceUiStatus(params: {
  definition: AlisioConnectorDefinitionLike;
  authorization?: AlisioConnectorAuthorizationLike;
}): AlisioConnectorUiStatus {
  if (params.authorization?.health === "config_missing") {
    return "unavailable";
  }
  const rawStatus = resolveAlisioConnectorUiStatus(params);
  if (params.definition.availability === "unavailable") {
    return "unavailable";
  }
  if (
    params.definition.availability === "in_review" ||
    !isAlisioConnectorRuntimeReady(params.definition.id)
  ) {
    return "in_review";
  }
  return rawStatus;
}

export function summarizeAlisioConnectorUiStatuses(params: {
  definitions: ReadonlyArray<{
    id: string;
    availability: AlisioConnectorAvailability;
  }>;
  authorizations: ReadonlyArray<{
    connectorId: string;
    state: AlisioConnectorAuthorizationState;
    health: AlisioConnectorAuthorizationHealth;
  }>;
}): AlisioConnectorStatusSummary {
  const authorizationsByConnectorId = new Map(
    params.authorizations.map((authorization) => [authorization.connectorId, authorization]),
  );
  const summary: AlisioConnectorStatusSummary = {
    total: params.definitions.length,
    ready: 0,
    connected: 0,
    needsReconnect: 0,
    inReview: 0,
    unavailable: 0,
    available: 0,
  };

  for (const definition of params.definitions) {
    const status = resolveAlisioConnectorUiStatus({
      definition,
      authorization: authorizationsByConnectorId.get(definition.id),
    });
    switch (status) {
      case "connected":
        summary.connected += 1;
        summary.available += 1;
        break;
      case "needs_reconnect":
        summary.needsReconnect += 1;
        summary.available += 1;
        break;
      case "ready":
        summary.ready += 1;
        summary.available += 1;
        break;
      case "setup_required":
        summary.available += 1;
        break;
      case "in_review":
        summary.inReview += 1;
        summary.available += 1;
        break;
      case "unavailable":
      default:
        summary.unavailable += 1;
        break;
    }
  }

  return summary;
}

export function summarizeAlisioConnectorSurfaceUiStatuses(params: {
  definitions: ReadonlyArray<AlisioConnectorDefinitionLike>;
  authorizations: ReadonlyArray<{
    connectorId: string;
    state: AlisioConnectorAuthorizationState;
    health: AlisioConnectorAuthorizationHealth;
  }>;
}): AlisioConnectorStatusSummary {
  const authorizationsByConnectorId = new Map(
    params.authorizations.map((authorization) => [authorization.connectorId, authorization]),
  );
  const summary: AlisioConnectorStatusSummary = {
    total: params.definitions.length,
    ready: 0,
    connected: 0,
    needsReconnect: 0,
    inReview: 0,
    unavailable: 0,
    available: 0,
  };

  for (const definition of params.definitions) {
    const status = resolveAlisioConnectorSurfaceUiStatus({
      definition,
      authorization: authorizationsByConnectorId.get(definition.id),
    });
    switch (status) {
      case "connected":
        summary.connected += 1;
        summary.available += 1;
        break;
      case "needs_reconnect":
        summary.needsReconnect += 1;
        summary.available += 1;
        break;
      case "ready":
        summary.ready += 1;
        summary.available += 1;
        break;
      case "setup_required":
        summary.available += 1;
        break;
      case "in_review":
        summary.inReview += 1;
        summary.available += 1;
        break;
      case "unavailable":
      default:
        summary.unavailable += 1;
        break;
    }
  }

  return summary;
}
