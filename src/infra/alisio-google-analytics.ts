import {
  extractGoogleApiProviderErrorMessage,
  extractGoogleApiProviderReason,
  isGoogleApiReconnectRequired,
  resolveAlisioConnectorRuntimeAccess,
} from "./alisio-connector-runtime.js";

const GOOGLE_ANALYTICS_CONNECTOR_ID = "google-analytics";
const GOOGLE_ANALYTICS_ADMIN_API_ROOT = "https://analyticsadmin.googleapis.com/v1beta";
const GOOGLE_ANALYTICS_DATA_API_ROOT = "https://analyticsdata.googleapis.com/v1beta";

export type AlisioGoogleAnalyticsPropertySummary = {
  propertyId: string;
  displayName: string;
  propertyType?: string;
};

export type AlisioGoogleAnalyticsAccountSummary = {
  accountId: string;
  displayName: string;
  properties: AlisioGoogleAnalyticsPropertySummary[];
};

export type AlisioGoogleAnalyticsReportRow = Record<string, string>;

export type AlisioGoogleAnalyticsResult =
  | {
      ok: true;
      status: "listed";
      connectorId: "google-analytics";
      accounts: AlisioGoogleAnalyticsAccountSummary[];
      nextPageToken?: string;
    }
  | {
      ok: true;
      status: "reported";
      connectorId: "google-analytics";
      propertyId: string;
      startDate: string;
      endDate: string;
      dimensions: string[];
      metrics: string[];
      rowCount: number;
      rows: AlisioGoogleAnalyticsReportRow[];
    }
  | {
      ok: false;
      status: "auth_required" | "read_failed" | "report_failed";
      connectorId: "google-analytics";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

function normalizeAnalyticsPropertyId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("properties/") ? trimmed.slice("properties/".length) : trimmed;
}

function normalizeAnalyticsAccountId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("accounts/") ? trimmed.slice("accounts/".length) : trimmed;
}

function buildAnalyticsAuthError(params: {
  reconnectRequired: boolean;
}): AlisioGoogleAnalyticsResult {
  return {
    ok: false,
    status: "auth_required",
    connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
    message: params.reconnectRequired
      ? "Google Analytics authorization is no longer valid. Reconnect Google Analytics in Apps."
      : "Google Analytics is not connected in Alisio. Connect Google Analytics in Apps first.",
    reconnectRequired: params.reconnectRequired,
  };
}

function normalizeAnalyticsAccounts(value: unknown): AlisioGoogleAnalyticsAccountSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const accountId =
      typeof record.account === "string" && normalizeAnalyticsAccountId(record.account)
        ? normalizeAnalyticsAccountId(record.account)
        : null;
    const displayName =
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim()
        : null;
    if (!accountId || !displayName) {
      return [];
    }
    const properties = Array.isArray(record.propertySummaries)
      ? record.propertySummaries.flatMap((property) => {
          if (!property || typeof property !== "object") {
            return [];
          }
          const propertyRecord = property as Record<string, unknown>;
          const propertyId =
            typeof propertyRecord.property === "string" &&
            normalizeAnalyticsPropertyId(propertyRecord.property)
              ? normalizeAnalyticsPropertyId(propertyRecord.property)
              : null;
          const propertyDisplayName =
            typeof propertyRecord.displayName === "string" && propertyRecord.displayName.trim()
              ? propertyRecord.displayName.trim()
              : null;
          if (!propertyId || !propertyDisplayName) {
            return [];
          }
          return [
            {
              propertyId,
              displayName: propertyDisplayName,
              ...(typeof propertyRecord.propertyType === "string" &&
              propertyRecord.propertyType.trim()
                ? { propertyType: propertyRecord.propertyType.trim() }
                : {}),
            },
          ];
        })
      : [];
    return [
      {
        accountId,
        displayName,
        properties,
      },
    ];
  });
}

export async function listAlisioGoogleAnalyticsAccounts(
  input: {
    pageSize?: number;
  } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleAnalyticsResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_ANALYTICS_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildAnalyticsAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const pageSize =
    typeof input.pageSize === "number" && Number.isFinite(input.pageSize)
      ? Math.min(Math.max(1, Math.trunc(input.pageSize)), 50)
      : 20;

  try {
    const response = await fetchImpl(
      `${GOOGLE_ANALYTICS_ADMIN_API_ROOT}/accountSummaries?pageSize=${pageSize}`,
      {
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
        },
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Analytics needs to be reconnected with Analytics read access."
          : reconnectRequired
            ? "Google Analytics authorization is no longer valid. Reconnect Google Analytics in Apps."
            : extractGoogleApiProviderErrorMessage(
                body,
                "Google Analytics rejected the account summary request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }
    return {
      ok: true,
      status: "listed",
      connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
      accounts: normalizeAnalyticsAccounts(body.accountSummaries),
      ...(typeof body.nextPageToken === "string" && body.nextPageToken.trim()
        ? { nextPageToken: body.nextPageToken.trim() }
        : {}),
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
      message: "Google Analytics could not be reached right now. Try again in a moment.",
    };
  }
}

export async function runAlisioGoogleAnalyticsReport(
  input: {
    propertyId: string;
    dimensions: string[];
    metrics: string[];
    startDate?: string;
    endDate?: string;
    limit?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleAnalyticsResult> {
  const propertyId = normalizeAnalyticsPropertyId(input.propertyId);
  if (!propertyId) {
    return {
      ok: false,
      status: "report_failed",
      connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
      message: "Google Analytics property id is required.",
    };
  }
  const dimensions = input.dimensions.map((value) => value.trim()).filter(Boolean);
  const metrics = input.metrics.map((value) => value.trim()).filter(Boolean);
  if (dimensions.length === 0) {
    return {
      ok: false,
      status: "report_failed",
      connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
      message: "Google Analytics reports need at least one dimension.",
    };
  }
  if (metrics.length === 0) {
    return {
      ok: false,
      status: "report_failed",
      connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
      message: "Google Analytics reports need at least one metric.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_ANALYTICS_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildAnalyticsAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const startDate = input.startDate?.trim() || "28daysAgo";
  const endDate = input.endDate?.trim() || "today";
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(Math.max(1, Math.trunc(input.limit)), 100)
      : 20;

  try {
    const response = await fetchImpl(
      `${GOOGLE_ANALYTICS_DATA_API_ROOT}/properties/${encodeURIComponent(propertyId)}:runReport`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          dimensions: dimensions.map((name) => ({ name })),
          metrics: metrics.map((name) => ({ name })),
          dateRanges: [{ startDate, endDate }],
          limit: String(limit),
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Analytics needs to be reconnected with Analytics read access."
          : reconnectRequired
            ? "Google Analytics authorization is no longer valid. Reconnect Google Analytics in Apps."
            : extractGoogleApiProviderErrorMessage(
                body,
                "Google Analytics rejected the report request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "report_failed",
        connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const dimensionHeaders = Array.isArray(body.dimensionHeaders)
      ? body.dimensionHeaders.flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }
          const name = (entry as { name?: unknown }).name;
          return typeof name === "string" && name.trim() ? [name.trim()] : [];
        })
      : [];
    const metricHeaders = Array.isArray(body.metricHeaders)
      ? body.metricHeaders.flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }
          const name = (entry as { name?: unknown }).name;
          return typeof name === "string" && name.trim() ? [name.trim()] : [];
        })
      : [];

    const rows = Array.isArray(body.rows)
      ? body.rows.flatMap((row) => {
          if (!row || typeof row !== "object") {
            return [];
          }
          const dimensionValues = Array.isArray(
            (row as { dimensionValues?: unknown }).dimensionValues,
          )
            ? (row as { dimensionValues: Array<{ value?: unknown }> }).dimensionValues.map(
                (entry) => (typeof entry?.value === "string" ? entry.value : ""),
              )
            : [];
          const metricValues = Array.isArray((row as { metricValues?: unknown }).metricValues)
            ? (row as { metricValues: Array<{ value?: unknown }> }).metricValues.map((entry) =>
                typeof entry?.value === "string" ? entry.value : "",
              )
            : [];
          const mappedRow: AlisioGoogleAnalyticsReportRow = {};
          dimensionHeaders.forEach((header, index) => {
            mappedRow[header] = dimensionValues[index] ?? "";
          });
          metricHeaders.forEach((header, index) => {
            mappedRow[header] = metricValues[index] ?? "";
          });
          return [mappedRow];
        })
      : [];

    return {
      ok: true,
      status: "reported",
      connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
      propertyId,
      startDate,
      endDate,
      dimensions,
      metrics,
      rowCount:
        typeof body.rowCount === "number" && Number.isFinite(body.rowCount)
          ? Math.trunc(body.rowCount)
          : rows.length,
      rows,
    };
  } catch {
    return {
      ok: false,
      status: "report_failed",
      connectorId: GOOGLE_ANALYTICS_CONNECTOR_ID,
      message: "Google Analytics could not be reached right now. Try again in a moment.",
    };
  }
}
