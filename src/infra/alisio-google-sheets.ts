import {
  extractGoogleApiProviderErrorMessage,
  extractGoogleApiProviderReason,
  isGoogleApiReconnectRequired,
  resolveAlisioConnectorRuntimeAccess,
} from "./alisio-connector-runtime.js";

const GOOGLE_SHEETS_CONNECTOR_ID = "google-sheets";
const GOOGLE_SHEETS_API_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";

export type AlisioGoogleSheetValueMatrix = string[][];

export type AlisioGoogleSheetsResult =
  | {
      ok: true;
      status: "created";
      connectorId: "google-sheets";
      spreadsheetId: string;
      title: string;
      spreadsheetUrl: string;
      sheetTitle: string;
      rowCount: number;
    }
  | {
      ok: true;
      status: "read";
      connectorId: "google-sheets";
      spreadsheetId: string;
      title: string;
      spreadsheetUrl: string;
      range: string;
      values: AlisioGoogleSheetValueMatrix;
      rowCount: number;
      truncatedRows: boolean;
    }
  | {
      ok: true;
      status: "appended";
      connectorId: "google-sheets";
      spreadsheetId: string;
      title: string;
      spreadsheetUrl: string;
      range: string;
      updatedRange?: string;
      updatedRows: number;
      updatedColumns?: number;
      updatedCells?: number;
      tableRange?: string;
    }
  | {
      ok: false;
      status: "auth_required" | "create_failed" | "read_failed" | "append_failed";
      connectorId: "google-sheets";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

type GoogleSpreadsheetMetadata = {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  firstSheetTitle: string;
};

function buildGoogleSheetsUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
}

function normalizeGoogleSpreadsheetId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Treat plain ids as-is.
  }
  return trimmed;
}

function normalizeSheetTitle(value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Sheet1";
}

function normalizeSheetRange(value: string | undefined, fallbackSheetTitle: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return `${fallbackSheetTitle}!A:Z`;
  }
  return trimmed.includes("!") ? trimmed : `${fallbackSheetTitle}!${trimmed}`;
}

function encodeGoogleSheetsRange(range: string): string {
  return encodeURIComponent(range).replace(/%20/g, "+");
}

function normalizeValueCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function normalizeValueMatrix(value: unknown): AlisioGoogleSheetValueMatrix {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    if (!Array.isArray(row)) {
      return [];
    }
    return [row.map((cell) => normalizeValueCell(cell))];
  });
}

function buildSheetsAuthError(params: { reconnectRequired: boolean }): AlisioGoogleSheetsResult {
  return {
    ok: false,
    status: "auth_required",
    connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
    message: params.reconnectRequired
      ? "Google Sheets authorization is no longer valid. Reconnect Google Sheets in Apps."
      : "Google Sheets is not connected in Alisio. Connect Google Sheets in Apps first.",
    reconnectRequired: params.reconnectRequired,
  };
}

async function fetchGoogleSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<
  | { ok: true; metadata: GoogleSpreadsheetMetadata }
  | {
      ok: false;
      status: "auth_required" | "read_failed";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    }
> {
  try {
    const response = await fetchImpl(
      `${GOOGLE_SHEETS_API_ROOT}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
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
          ? "Google Sheets needs to be reconnected with Sheets access."
          : reconnectRequired
            ? "Google Sheets authorization is no longer valid. Reconnect Google Sheets in Apps."
            : extractGoogleApiProviderErrorMessage(
                body,
                "Google Sheets rejected the metadata request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }
    const title =
      typeof body.properties === "object" &&
      body.properties &&
      typeof (body.properties as { title?: unknown }).title === "string" &&
      (body.properties as { title: string }).title.trim()
        ? (body.properties as { title: string }).title.trim()
        : "Untitled spreadsheet";
    const spreadsheetUrl =
      typeof body.spreadsheetUrl === "string" && body.spreadsheetUrl.trim()
        ? body.spreadsheetUrl.trim()
        : buildGoogleSheetsUrl(spreadsheetId);
    const firstSheetTitle = Array.isArray(body.sheets)
      ? (body.sheets.find((sheet): sheet is { properties: { title: string } } =>
          Boolean(
            sheet &&
            typeof sheet === "object" &&
            typeof (sheet as { properties?: unknown }).properties === "object" &&
            typeof (sheet as { properties: { title?: unknown } }).properties.title === "string" &&
            (sheet as { properties: { title: string } }).properties.title.trim(),
          ),
        )?.properties.title ?? "Sheet1")
      : "Sheet1";
    return {
      ok: true,
      metadata: {
        spreadsheetId,
        title,
        spreadsheetUrl,
        firstSheetTitle,
      },
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      message: "Google Sheets could not be reached right now. Try again in a moment.",
    };
  }
}

export async function createAlisioGoogleSpreadsheet(
  input: {
    title: string;
    sheetTitle?: string;
    headers?: string[];
    rows?: AlisioGoogleSheetValueMatrix;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleSheetsResult> {
  const title = input.title.trim();
  if (!title) {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      message: "Google Sheets spreadsheet title is required.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_SHEETS_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildSheetsAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const sheetTitle = normalizeSheetTitle(input.sheetTitle);
  const initialRows = [
    ...((input.headers ?? []).filter((value) => value.trim()).length > 0
      ? [(input.headers ?? []).map((value) => value.trim())]
      : []),
    ...normalizeValueMatrix(input.rows),
  ];

  try {
    const createResponse = await fetchImpl(GOOGLE_SHEETS_API_ROOT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authorization.accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          title,
        },
        sheets: [
          {
            properties: {
              title: sheetTitle,
            },
          },
        ],
      }),
    });
    const createBody = (await createResponse.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const providerReason = extractGoogleApiProviderReason(createBody);
    if (
      !createResponse.ok ||
      !createBody ||
      typeof createBody.spreadsheetId !== "string" ||
      !createBody.spreadsheetId.trim()
    ) {
      const reconnectRequired = isGoogleApiReconnectRequired(createResponse.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Sheets needs to be reconnected with Sheets access."
          : reconnectRequired
            ? "Google Sheets authorization is no longer valid. Reconnect Google Sheets in Apps."
            : extractGoogleApiProviderErrorMessage(
                createBody,
                "Google Sheets rejected the create request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "create_failed",
        connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const spreadsheetId = createBody.spreadsheetId.trim();
    if (initialRows.length > 0) {
      const seedResponse = await fetchImpl(
        `${GOOGLE_SHEETS_API_ROOT}/${encodeURIComponent(spreadsheetId)}/values/${encodeGoogleSheetsRange(`${sheetTitle}!A1`)}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${authorization.accessToken}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            majorDimension: "ROWS",
            values: initialRows,
          }),
        },
      );
      const seedBody = (await seedResponse.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const seedReason = extractGoogleApiProviderReason(seedBody);
      if (!seedResponse.ok) {
        const reconnectRequired = isGoogleApiReconnectRequired(seedResponse.status, seedReason);
        const message =
          seedReason === "insufficientPermissions"
            ? "Google Sheets needs to be reconnected with Sheets access."
            : reconnectRequired
              ? "Google Sheets authorization is no longer valid. Reconnect Google Sheets in Apps."
              : extractGoogleApiProviderErrorMessage(
                  seedBody,
                  "Google Sheets created the spreadsheet but could not write the initial data.",
                );
        return {
          ok: false,
          status: reconnectRequired ? "auth_required" : "create_failed",
          connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
          message,
          ...(reconnectRequired ? { reconnectRequired: true } : {}),
          ...(seedReason ? { providerReason: seedReason } : {}),
        };
      }
    }

    return {
      ok: true,
      status: "created",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      spreadsheetId,
      title,
      spreadsheetUrl:
        typeof createBody.spreadsheetUrl === "string" && createBody.spreadsheetUrl.trim()
          ? createBody.spreadsheetUrl.trim()
          : buildGoogleSheetsUrl(spreadsheetId),
      sheetTitle,
      rowCount: initialRows.length,
    };
  } catch {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      message: "Google Sheets could not be reached right now. Try again in a moment.",
    };
  }
}

export async function readAlisioGoogleSpreadsheetRange(
  input: {
    spreadsheetId: string;
    range?: string;
    maxRows?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleSheetsResult> {
  const spreadsheetId = normalizeGoogleSpreadsheetId(input.spreadsheetId);
  if (!spreadsheetId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      message: "Google Sheets spreadsheet id is required.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_SHEETS_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildSheetsAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const metadata = await fetchGoogleSpreadsheetMetadata(
    spreadsheetId,
    authorization.accessToken,
    fetchImpl,
  );
  if (!metadata.ok) {
    return {
      ok: false,
      status: metadata.status,
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      message: metadata.message,
      ...(metadata.reconnectRequired ? { reconnectRequired: true } : {}),
      ...(metadata.providerReason ? { providerReason: metadata.providerReason } : {}),
    };
  }

  const range = normalizeSheetRange(input.range, metadata.metadata.firstSheetTitle);
  const maxRows =
    typeof input.maxRows === "number" && Number.isFinite(input.maxRows)
      ? Math.max(1, Math.trunc(input.maxRows))
      : 200;

  try {
    const response = await fetchImpl(
      `${GOOGLE_SHEETS_API_ROOT}/${encodeURIComponent(spreadsheetId)}/values/${encodeGoogleSheetsRange(range)}?majorDimension=ROWS`,
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
          ? "Google Sheets needs to be reconnected with Sheets access."
          : reconnectRequired
            ? "Google Sheets authorization is no longer valid. Reconnect Google Sheets in Apps."
            : extractGoogleApiProviderErrorMessage(
                body,
                "Google Sheets rejected the read request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const values = normalizeValueMatrix(body.values);
    const truncatedRows = values.length > maxRows;
    return {
      ok: true,
      status: "read",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      spreadsheetId,
      title: metadata.metadata.title,
      spreadsheetUrl: metadata.metadata.spreadsheetUrl,
      range: typeof body.range === "string" && body.range.trim() ? body.range.trim() : range,
      values: truncatedRows ? values.slice(0, maxRows) : values,
      rowCount: values.length,
      truncatedRows,
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      message: "Google Sheets could not be reached right now. Try again in a moment.",
    };
  }
}

export async function appendAlisioGoogleSpreadsheetRows(
  input: {
    spreadsheetId: string;
    range?: string;
    rows: AlisioGoogleSheetValueMatrix;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleSheetsResult> {
  const spreadsheetId = normalizeGoogleSpreadsheetId(input.spreadsheetId);
  if (!spreadsheetId) {
    return {
      ok: false,
      status: "append_failed",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      message: "Google Sheets spreadsheet id is required.",
    };
  }

  const rows = normalizeValueMatrix(input.rows);
  if (rows.length === 0) {
    return {
      ok: false,
      status: "append_failed",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      message: "Google Sheets append needs at least one row.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_SHEETS_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildSheetsAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const metadata = await fetchGoogleSpreadsheetMetadata(
    spreadsheetId,
    authorization.accessToken,
    fetchImpl,
  );
  if (!metadata.ok) {
    return {
      ok: false,
      status: metadata.status === "read_failed" ? "append_failed" : metadata.status,
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      message: metadata.message,
      ...(metadata.reconnectRequired ? { reconnectRequired: true } : {}),
      ...(metadata.providerReason ? { providerReason: metadata.providerReason } : {}),
    };
  }

  const range = normalizeSheetRange(input.range, metadata.metadata.firstSheetTitle);

  try {
    const response = await fetchImpl(
      `${GOOGLE_SHEETS_API_ROOT}/${encodeURIComponent(spreadsheetId)}/values/${encodeGoogleSheetsRange(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          majorDimension: "ROWS",
          values: rows,
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Sheets needs to be reconnected with Sheets access."
          : reconnectRequired
            ? "Google Sheets authorization is no longer valid. Reconnect Google Sheets in Apps."
            : extractGoogleApiProviderErrorMessage(
                body,
                "Google Sheets rejected the append request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "append_failed",
        connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const updates =
      typeof body.updates === "object" && body.updates
        ? (body.updates as Record<string, unknown>)
        : null;
    return {
      ok: true,
      status: "appended",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      spreadsheetId,
      title: metadata.metadata.title,
      spreadsheetUrl: metadata.metadata.spreadsheetUrl,
      range,
      ...(updates && typeof updates.updatedRange === "string" && updates.updatedRange.trim()
        ? { updatedRange: updates.updatedRange.trim() }
        : {}),
      updatedRows:
        typeof updates?.updatedRows === "number" ? Math.trunc(updates.updatedRows) : rows.length,
      ...(typeof updates?.updatedColumns === "number"
        ? { updatedColumns: Math.trunc(updates.updatedColumns) }
        : {}),
      ...(typeof updates?.updatedCells === "number"
        ? { updatedCells: Math.trunc(updates.updatedCells) }
        : {}),
      ...(typeof body.tableRange === "string" && body.tableRange.trim()
        ? { tableRange: body.tableRange.trim() }
        : {}),
    };
  } catch {
    return {
      ok: false,
      status: "append_failed",
      connectorId: GOOGLE_SHEETS_CONNECTOR_ID,
      message: "Google Sheets could not be reached right now. Try again in a moment.",
    };
  }
}
