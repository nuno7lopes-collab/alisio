import {
  getAlisioConnectorAccessToken,
  listAlisioConnectorAuthorizations,
} from "./alisio-store.js";

export type AlisioConnectorRuntimeAccess = {
  connectorId: string;
  accessToken: string | null;
  reconnectRequired: boolean;
  availableConnectorIds: string[];
};

function normalizeConnectorIds(connectorIds: readonly string[]): string[] {
  return Array.from(
    new Set(
      connectorIds
        .map((connectorId) => connectorId.trim())
        .filter((connectorId) => connectorId.length > 0),
    ),
  );
}

export async function resolveAlisioConnectorRuntimeAccess(
  connectorIds: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioConnectorRuntimeAccess> {
  const availableConnectorIds = normalizeConnectorIds(connectorIds);
  const authorizations = await listAlisioConnectorAuthorizations(env, fetchImpl).catch(() => []);

  for (const connectorId of availableConnectorIds) {
    const accessToken = await getAlisioConnectorAccessToken(connectorId, env, fetchImpl);
    if (accessToken) {
      return {
        connectorId,
        accessToken,
        reconnectRequired: false,
        availableConnectorIds,
      };
    }
  }

  const matchingAuthorizations = authorizations.filter((authorization) =>
    availableConnectorIds.includes(authorization.connectorId),
  );
  const preferredConnectorId =
    matchingAuthorizations.find((authorization) => authorization.state !== "not_connected")
      ?.connectorId ??
    availableConnectorIds[0] ??
    "";

  return {
    connectorId: preferredConnectorId,
    accessToken: null,
    reconnectRequired: matchingAuthorizations.some(
      (authorization) => authorization.state === "needs_reconnect",
    ),
    availableConnectorIds,
  };
}

export function extractGoogleApiProviderErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  const message = (body as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  return fallback;
}

export function extractGoogleApiProviderReason(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return undefined;
  }
  return errors.find((entry): entry is { reason: string } =>
    Boolean(
      entry &&
      typeof entry === "object" &&
      typeof (entry as { reason?: unknown }).reason === "string" &&
      (entry as { reason: string }).reason.trim(),
    ),
  )?.reason;
}

export function isGoogleApiReconnectRequired(statusCode: number, providerReason?: string): boolean {
  return (
    statusCode === 401 ||
    providerReason === "authError" ||
    providerReason === "insufficientPermissions"
  );
}
