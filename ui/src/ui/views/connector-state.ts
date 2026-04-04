import {
  resolveAlisioConnectorUiStatus,
  type AlisioConnectorUiStatus,
} from "../../../../src/shared/alisio-connector-status.js";
import { t } from "../../i18n/index.ts";
import type { AlisioConnectorAuthorization, AlisioConnectorDefinition } from "../types.ts";

export type ConnectorRow = {
  definition: AlisioConnectorDefinition;
  authorization: AlisioConnectorAuthorization;
  status: AlisioConnectorUiStatus;
};

function createFallbackAuthorization(
  definition: AlisioConnectorDefinition,
): AlisioConnectorAuthorization {
  return {
    connectorId: definition.id,
    state: "not_connected",
    health: definition.availability === "ready" ? "config_missing" : definition.availability,
    scopes: definition.scopes,
  };
}

export function buildConnectorRows(
  catalog: AlisioConnectorDefinition[],
  authorizations: AlisioConnectorAuthorization[],
): ConnectorRow[] {
  return catalog.map((definition) => {
    const authorization =
      authorizations.find((entry) => entry.connectorId === definition.id) ??
      createFallbackAuthorization(definition);
    return {
      definition,
      authorization,
      status: resolveAlisioConnectorUiStatus({ definition, authorization }),
    } satisfies ConnectorRow;
  });
}

export function connectorStatusLabel(status: AlisioConnectorUiStatus) {
  return t(`alisio.authentications.statuses.${status}`);
}

export function connectorStatusHint(status: AlisioConnectorUiStatus) {
  switch (status) {
    case "connected":
      return t("alisio.authentications.hints.connected");
    case "ready":
      return t("alisio.authentications.hints.ready");
    case "needs_reconnect":
      return t("alisio.authentications.hints.needsReconnect");
    case "setup_required":
      return t("alisio.authentications.hints.setupRequired");
    case "in_review":
      return t("alisio.authentications.hints.inReview");
    case "unavailable":
    default:
      return t("alisio.authentications.hints.unavailable");
  }
}
