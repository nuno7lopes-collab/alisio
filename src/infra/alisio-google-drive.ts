import { randomUUID } from "node:crypto";
import {
  extractGoogleApiProviderErrorMessage,
  extractGoogleApiProviderReason,
  isGoogleApiReconnectRequired,
  resolveAlisioConnectorRuntimeAccess,
} from "./alisio-connector-runtime.js";

const GOOGLE_DRIVE_CONNECTOR_ID = "google-drive";
const GOOGLE_DRIVE_API_ROOT = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_UPLOAD_API_ROOT = "https://www.googleapis.com/upload/drive/v3/files";

export type AlisioGoogleDriveFileSummary = {
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: number;
  webViewLink?: string;
  downloadUrl?: string;
};

export type AlisioGoogleDriveResult =
  | {
      ok: true;
      status: "listed";
      connectorId: "google-drive";
      files: AlisioGoogleDriveFileSummary[];
      nextPageToken?: string;
    }
  | {
      ok: true;
      status: "read";
      connectorId: "google-drive";
      file: AlisioGoogleDriveFileSummary;
      text: string;
      truncated: boolean;
      exportMimeType?: string;
    }
  | {
      ok: true;
      status: "created";
      connectorId: "google-drive";
      file: AlisioGoogleDriveFileSummary;
      contentLength: number;
    }
  | {
      ok: false;
      status: "auth_required" | "list_failed" | "read_failed" | "create_failed";
      connectorId: "google-drive";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

function normalizeGoogleDriveFileId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    const pathMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }
    const queryMatch = parsed.searchParams.get("id");
    if (queryMatch?.trim()) {
      return queryMatch.trim();
    }
  } catch {
    // Treat plain ids as-is.
  }
  return trimmed;
}

function escapeGoogleDriveQueryValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function normalizeGoogleDriveFile(
  body: Record<string, unknown>,
): AlisioGoogleDriveFileSummary | null {
  const fileId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : null;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  const mimeType =
    typeof body.mimeType === "string" && body.mimeType.trim() ? body.mimeType.trim() : null;
  if (!fileId || !name || !mimeType) {
    return null;
  }
  const modifiedTime =
    typeof body.modifiedTime === "string" && body.modifiedTime.trim()
      ? body.modifiedTime.trim()
      : undefined;
  const webViewLink =
    typeof body.webViewLink === "string" && body.webViewLink.trim()
      ? body.webViewLink.trim()
      : undefined;
  const downloadUrl =
    typeof body.webContentLink === "string" && body.webContentLink.trim()
      ? body.webContentLink.trim()
      : undefined;
  const size =
    typeof body.size === "string"
      ? Number.parseInt(body.size, 10)
      : typeof body.size === "number" && Number.isFinite(body.size)
        ? Math.trunc(body.size)
        : undefined;
  return {
    fileId,
    name,
    mimeType,
    ...(modifiedTime ? { modifiedTime } : {}),
    ...(typeof size === "number" && Number.isFinite(size) ? { size } : {}),
    ...(webViewLink ? { webViewLink } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
  };
}

function buildDriveAuthError(params: { reconnectRequired: boolean }): AlisioGoogleDriveResult {
  return {
    ok: false,
    status: "auth_required",
    connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
    message: params.reconnectRequired
      ? "Google Drive authorization is no longer valid. Reconnect Google Drive in Apps."
      : "Google Drive is not connected in Alisio. Connect Google Drive in Apps first.",
    reconnectRequired: params.reconnectRequired,
  };
}

function isReadableDriveMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/x-javascript" ||
    mimeType === "application/x-www-form-urlencoded"
  );
}

function resolveGoogleDriveExportMimeType(mimeType: string): string | null {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return "text/plain";
    case "application/vnd.google-apps.spreadsheet":
      return "text/csv";
    default:
      return null;
  }
}

export async function searchAlisioGoogleDriveFiles(
  input: {
    query?: string;
    folderId?: string;
    maxResults?: number;
  } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleDriveResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_DRIVE_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildDriveAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const maxResults =
    typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
      ? Math.max(1, Math.trunc(input.maxResults))
      : 10;
  const queryParts = ["trashed = false"];
  const normalizedQuery = input.query?.trim();
  if (normalizedQuery) {
    const escaped = escapeGoogleDriveQueryValue(normalizedQuery);
    queryParts.push(`(name contains '${escaped}' or fullText contains '${escaped}')`);
  }
  const normalizedFolderId = input.folderId ? normalizeGoogleDriveFileId(input.folderId) : null;
  if (normalizedFolderId) {
    queryParts.push(`'${escapeGoogleDriveQueryValue(normalizedFolderId)}' in parents`);
  }

  const url = new URL(GOOGLE_DRIVE_API_ROOT);
  url.searchParams.set(
    "fields",
    "nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,webContentLink)",
  );
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("pageSize", String(maxResults));
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("q", queryParts.join(" and "));

  try {
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${authorization.accessToken}`,
        accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body || !Array.isArray(body.files)) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Drive needs to be reconnected with Drive access."
          : reconnectRequired
            ? "Google Drive authorization is no longer valid. Reconnect Google Drive in Apps."
            : extractGoogleApiProviderErrorMessage(
                body,
                "Google Drive rejected the search request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "list_failed",
        connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const files = body.files.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const normalized = normalizeGoogleDriveFile(entry as Record<string, unknown>);
      return normalized ? [normalized] : [];
    });
    const nextPageToken =
      typeof body.nextPageToken === "string" && body.nextPageToken.trim()
        ? body.nextPageToken.trim()
        : undefined;
    return {
      ok: true,
      status: "listed",
      connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
      files,
      ...(nextPageToken ? { nextPageToken } : {}),
    };
  } catch {
    return {
      ok: false,
      status: "list_failed",
      connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
      message: "Google Drive could not be reached right now. Try again in a moment.",
    };
  }
}

export async function readAlisioGoogleDriveFile(
  input: {
    fileId: string;
    maxChars?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleDriveResult> {
  const fileId = normalizeGoogleDriveFileId(input.fileId);
  if (!fileId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
      message: "Google Drive file id is required.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_DRIVE_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildDriveAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  try {
    const metadataResponse = await fetchImpl(
      `${GOOGLE_DRIVE_API_ROOT}/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink,webContentLink`,
      {
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
        },
      },
    );
    const metadataBody = (await metadataResponse.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const metadataReason = extractGoogleApiProviderReason(metadataBody);
    if (!metadataResponse.ok || !metadataBody) {
      const reconnectRequired = isGoogleApiReconnectRequired(
        metadataResponse.status,
        metadataReason,
      );
      const message =
        metadataReason === "insufficientPermissions"
          ? "Google Drive needs to be reconnected with Drive access."
          : reconnectRequired
            ? "Google Drive authorization is no longer valid. Reconnect Google Drive in Apps."
            : extractGoogleApiProviderErrorMessage(
                metadataBody,
                "Google Drive rejected the read request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(metadataReason ? { providerReason: metadataReason } : {}),
      };
    }

    const file = normalizeGoogleDriveFile(metadataBody);
    if (!file) {
      return {
        ok: false,
        status: "read_failed",
        connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
        message: "Google Drive returned unexpected file metadata.",
      };
    }

    const exportMimeType = resolveGoogleDriveExportMimeType(file.mimeType);
    if (!exportMimeType && !isReadableDriveMimeType(file.mimeType)) {
      return {
        ok: false,
        status: "read_failed",
        connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
        message:
          "This Google Drive file type is not readable as text yet. Use Google Docs for document content or download the file directly.",
      };
    }

    const readUrl = exportMimeType
      ? `${GOOGLE_DRIVE_API_ROOT}/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`
      : `${GOOGLE_DRIVE_API_ROOT}/${encodeURIComponent(fileId)}?alt=media`;
    const readResponse = await fetchImpl(readUrl, {
      headers: {
        authorization: `Bearer ${authorization.accessToken}`,
      },
    });
    if (!readResponse.ok) {
      const readBody = (await readResponse.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const providerReason = extractGoogleApiProviderReason(readBody);
      const reconnectRequired = isGoogleApiReconnectRequired(readResponse.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Drive needs to be reconnected with Drive access."
          : reconnectRequired
            ? "Google Drive authorization is no longer valid. Reconnect Google Drive in Apps."
            : extractGoogleApiProviderErrorMessage(
                readBody,
                "Google Drive rejected the file read request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const text = await readResponse.text();
    const maxChars =
      typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
        ? Math.max(1, Math.trunc(input.maxChars))
        : 20_000;
    const truncated = text.length > maxChars;
    return {
      ok: true,
      status: "read",
      connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
      file,
      text: truncated ? text.slice(0, maxChars) : text,
      truncated,
      ...(exportMimeType ? { exportMimeType } : {}),
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
      message: "Google Drive could not be reached right now. Try again in a moment.",
    };
  }
}

export async function createAlisioGoogleDriveTextFile(
  input: {
    name: string;
    content?: string;
    folderId?: string;
    mimeType?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleDriveResult> {
  const name = input.name.trim();
  if (!name) {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
      message: "Google Drive file name is required.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_DRIVE_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildDriveAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const content = input.content ?? "";
  const mimeType =
    typeof input.mimeType === "string" && input.mimeType.trim()
      ? input.mimeType.trim()
      : "text/plain";
  const normalizedFolderId = input.folderId ? normalizeGoogleDriveFileId(input.folderId) : null;
  const boundary = `alisio-google-drive-${randomUUID()}`;
  const metadata = JSON.stringify({
    name,
    mimeType,
    ...(normalizedFolderId ? { parents: [normalizedFolderId] } : {}),
  });
  const multipartBody = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  try {
    const response = await fetchImpl(
      `${GOOGLE_DRIVE_UPLOAD_API_ROOT}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,webViewLink,webContentLink`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
          "content-type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Drive needs to be reconnected with Drive access."
          : reconnectRequired
            ? "Google Drive authorization is no longer valid. Reconnect Google Drive in Apps."
            : extractGoogleApiProviderErrorMessage(
                body,
                "Google Drive rejected the create request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "create_failed",
        connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const file = normalizeGoogleDriveFile(body);
    if (!file) {
      return {
        ok: false,
        status: "create_failed",
        connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
        message: "Google Drive created the file but returned an unexpected payload.",
      };
    }

    return {
      ok: true,
      status: "created",
      connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
      file,
      contentLength: content.length,
    };
  } catch {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_DRIVE_CONNECTOR_ID,
      message: "Google Drive could not be reached right now. Try again in a moment.",
    };
  }
}
