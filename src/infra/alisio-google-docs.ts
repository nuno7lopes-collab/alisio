import {
  extractGoogleApiProviderErrorMessage,
  extractGoogleApiProviderReason,
  isGoogleApiReconnectRequired,
  resolveAlisioConnectorRuntimeAccess,
} from "./alisio-connector-runtime.js";

const GOOGLE_DOCS_CONNECTOR_ID = "google-docs";
const GOOGLE_DOCS_API_ROOT = "https://docs.googleapis.com/v1/documents";

export type AlisioGoogleDocsResult =
  | {
      ok: true;
      status: "created";
      connectorId: "google-docs";
      documentId: string;
      title: string;
      documentUrl: string;
      contentLength: number;
    }
  | {
      ok: true;
      status: "read";
      connectorId: "google-docs";
      documentId: string;
      title: string;
      documentUrl: string;
      text: string;
      truncated: boolean;
    }
  | {
      ok: false;
      status: "auth_required" | "create_failed" | "read_failed";
      connectorId: "google-docs";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

function buildGoogleDocsDocumentUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`;
}

function normalizeGoogleDocsDocumentId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(/\/document\/d\/([^/]+)/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Treat plain document ids as-is.
  }
  return trimmed;
}

function collectGoogleDocsText(value: unknown, parts: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectGoogleDocsText(entry, parts);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  const textRun = record.textRun;
  if (textRun && typeof textRun === "object") {
    const content = (textRun as { content?: unknown }).content;
    if (typeof content === "string" && content.length > 0) {
      parts.push(content);
    }
  }
  for (const nestedKey of [
    "body",
    "content",
    "paragraph",
    "elements",
    "table",
    "tableRows",
    "tableCells",
    "tableOfContents",
  ]) {
    if (nestedKey in record) {
      collectGoogleDocsText(record[nestedKey], parts);
    }
  }
}

function extractGoogleDocsPlainText(body: unknown): string {
  const parts: string[] = [];
  collectGoogleDocsText(body, parts);
  return parts.join("").split("\u000B").join("\n").trim();
}

export async function createAlisioGoogleDocument(
  input: {
    title: string;
    content?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleDocsResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_DOCS_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: GOOGLE_DOCS_CONNECTOR_ID,
      message: authorization.reconnectRequired
        ? "Google Docs authorization is no longer valid. Reconnect Google Docs in Apps."
        : "Google Docs is not connected in Alisio. Connect Google Docs in Apps first.",
      reconnectRequired: authorization.reconnectRequired,
    };
  }

  try {
    const createResponse = await fetchImpl(GOOGLE_DOCS_API_ROOT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authorization.accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: input.title.trim(),
      }),
    });
    const createdDocument = (await createResponse.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const createReason = extractGoogleApiProviderReason(createdDocument);
    if (
      !createResponse.ok ||
      !createdDocument ||
      typeof createdDocument.documentId !== "string" ||
      typeof createdDocument.title !== "string"
    ) {
      const reconnectRequired = isGoogleApiReconnectRequired(createResponse.status, createReason);
      const message =
        createReason === "insufficientPermissions"
          ? "Google Docs needs to be reconnected with Docs access."
          : reconnectRequired
            ? "Google Docs authorization is no longer valid. Reconnect Google Docs in Apps."
            : extractGoogleApiProviderErrorMessage(
                createdDocument,
                "Google Docs rejected the create request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "create_failed",
        connectorId: GOOGLE_DOCS_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(createReason ? { providerReason: createReason } : {}),
      };
    }

    const documentId = createdDocument.documentId;
    const title = createdDocument.title;
    const content = input.content?.length ? input.content : "";
    if (content) {
      const updateResponse = await fetchImpl(
        `${GOOGLE_DOCS_API_ROOT}/${encodeURIComponent(documentId)}:batchUpdate`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${authorization.accessToken}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: content,
                },
              },
            ],
          }),
        },
      );
      const updateBody = (await updateResponse.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const updateReason = extractGoogleApiProviderReason(updateBody);
      if (!updateResponse.ok) {
        const reconnectRequired = isGoogleApiReconnectRequired(updateResponse.status, updateReason);
        const message =
          updateReason === "insufficientPermissions"
            ? "Google Docs needs to be reconnected with Docs access."
            : reconnectRequired
              ? "Google Docs authorization is no longer valid. Reconnect Google Docs in Apps."
              : extractGoogleApiProviderErrorMessage(
                  updateBody,
                  "Google Docs created the document but could not write the content.",
                );
        return {
          ok: false,
          status: reconnectRequired ? "auth_required" : "create_failed",
          connectorId: GOOGLE_DOCS_CONNECTOR_ID,
          message,
          ...(reconnectRequired ? { reconnectRequired: true } : {}),
          ...(updateReason ? { providerReason: updateReason } : {}),
        };
      }
    }

    return {
      ok: true,
      status: "created",
      connectorId: GOOGLE_DOCS_CONNECTOR_ID,
      documentId,
      title,
      documentUrl: buildGoogleDocsDocumentUrl(documentId),
      contentLength: content.length,
    };
  } catch {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_DOCS_CONNECTOR_ID,
      message: "Google Docs could not be reached right now. Try again in a moment.",
    };
  }
}

export async function readAlisioGoogleDocument(
  input: {
    documentId: string;
    maxChars?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleDocsResult> {
  const resolvedDocumentId = normalizeGoogleDocsDocumentId(input.documentId);
  if (!resolvedDocumentId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GOOGLE_DOCS_CONNECTOR_ID,
      message: "Google Docs document id is required.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_DOCS_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: GOOGLE_DOCS_CONNECTOR_ID,
      message: authorization.reconnectRequired
        ? "Google Docs authorization is no longer valid. Reconnect Google Docs in Apps."
        : "Google Docs is not connected in Alisio. Connect Google Docs in Apps first.",
      reconnectRequired: authorization.reconnectRequired,
    };
  }

  try {
    const response = await fetchImpl(
      `${GOOGLE_DOCS_API_ROOT}/${encodeURIComponent(resolvedDocumentId)}`,
      {
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
        },
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body || typeof body.documentId !== "string") {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Docs needs to be reconnected with Docs access."
          : reconnectRequired
            ? "Google Docs authorization is no longer valid. Reconnect Google Docs in Apps."
            : extractGoogleApiProviderErrorMessage(body, "Google Docs rejected the read request.");
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GOOGLE_DOCS_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const text = extractGoogleDocsPlainText(body);
    const maxChars =
      typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
        ? Math.max(1, Math.trunc(input.maxChars))
        : 20_000;
    const truncated = text.length > maxChars;
    return {
      ok: true,
      status: "read",
      connectorId: GOOGLE_DOCS_CONNECTOR_ID,
      documentId: body.documentId,
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled",
      documentUrl: buildGoogleDocsDocumentUrl(body.documentId),
      text: truncated ? text.slice(0, maxChars) : text,
      truncated,
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GOOGLE_DOCS_CONNECTOR_ID,
      message: "Google Docs could not be reached right now. Try again in a moment.",
    };
  }
}
