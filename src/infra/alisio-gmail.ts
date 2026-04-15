import {
  extractGoogleApiProviderErrorMessage,
  extractGoogleApiProviderReason,
  isGoogleApiReconnectRequired,
  resolveAlisioConnectorRuntimeAccess,
} from "./alisio-connector-runtime.js";

const GMAIL_READ_CONNECTOR_ID = "gmail-read";
const GMAIL_MODIFY_CONNECTOR_ID = "gmail-modify";
const GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";

export type AlisioGmailMessageSummary = {
  messageId: string;
  threadId?: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  snippet?: string;
  labelIds?: string[];
};

export type AlisioGmailReadResult =
  | {
      ok: true;
      status: "listed";
      connectorId: "gmail-read" | "gmail-modify";
      query?: string;
      resultSizeEstimate: number;
      messages: AlisioGmailMessageSummary[];
    }
  | {
      ok: true;
      status: "read";
      connectorId: "gmail-read" | "gmail-modify";
      message: AlisioGmailMessageSummary & {
        bodyText: string;
        truncated: boolean;
      };
    }
  | {
      ok: false;
      status: "auth_required" | "read_failed";
      connectorId: "gmail-read" | "gmail-modify";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

export type AlisioGmailModifyResult =
  | {
      ok: true;
      status: "modified";
      connectorId: "gmail-modify";
      action: "archive" | "trash" | "mark_read" | "mark_unread" | "add_labels" | "remove_labels";
      messageId: string;
      addedLabelIds?: string[];
      removedLabelIds?: string[];
    }
  | {
      ok: false;
      status: "auth_required" | "modify_failed";
      connectorId: "gmail-modify";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

function decodeBase64Url(value: string | undefined): string {
  if (!value?.trim()) {
    return "";
  }
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripHtmlTags(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBodyTextFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
  const body = record.body;
  if (body && typeof body === "object") {
    const data = decodeBase64Url((body as { data?: string }).data);
    if (data) {
      if (mimeType === "text/html") {
        return stripHtmlTags(data);
      }
      return data;
    }
  }
  if (Array.isArray(record.parts)) {
    for (const part of record.parts) {
      const text = extractBodyTextFromPayload(part);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function getHeaderValue(
  headers: unknown,
  name: "Subject" | "From" | "To" | "Cc" | "Date",
): string | undefined {
  if (!Array.isArray(headers)) {
    return undefined;
  }
  return headers.find((entry): entry is { name: string; value: string } =>
    Boolean(
      entry &&
      typeof entry === "object" &&
      (entry as { name?: unknown }).name === name &&
      typeof (entry as { value?: unknown }).value === "string",
    ),
  )?.value;
}

function normalizeGmailMessageSummary(body: Record<string, unknown>): AlisioGmailMessageSummary {
  const payload = body.payload as Record<string, unknown> | undefined;
  const headers = payload?.headers;
  return {
    messageId: typeof body.id === "string" ? body.id : "",
    ...(typeof body.threadId === "string" ? { threadId: body.threadId } : {}),
    ...(getHeaderValue(headers, "Subject") ? { subject: getHeaderValue(headers, "Subject") } : {}),
    ...(getHeaderValue(headers, "From") ? { from: getHeaderValue(headers, "From") } : {}),
    ...(getHeaderValue(headers, "To") ? { to: getHeaderValue(headers, "To") } : {}),
    ...(getHeaderValue(headers, "Cc") ? { cc: getHeaderValue(headers, "Cc") } : {}),
    ...(getHeaderValue(headers, "Date") ? { date: getHeaderValue(headers, "Date") } : {}),
    ...(typeof body.snippet === "string" && body.snippet.trim()
      ? { snippet: body.snippet.trim() }
      : {}),
    ...(Array.isArray(body.labelIds)
      ? {
          labelIds: body.labelIds.filter(
            (labelId): labelId is string =>
              typeof labelId === "string" && labelId.trim().length > 0,
          ),
        }
      : {}),
  };
}

async function fetchJson(
  url: string,
  params: {
    accessToken: string;
    method?: "GET" | "POST";
    body?: unknown;
  },
  fetchImpl: typeof fetch,
): Promise<{ response: Response; body: Record<string, unknown> | null }> {
  const response = await fetchImpl(url, {
    method: params.method ?? "GET",
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      accept: "application/json",
      ...(params.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(params.body !== undefined ? { body: JSON.stringify(params.body) } : {}),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { response, body };
}

async function resolveGmailReadAccess(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  return await resolveAlisioConnectorRuntimeAccess(
    [GMAIL_READ_CONNECTOR_ID, GMAIL_MODIFY_CONNECTOR_ID],
    env,
    fetchImpl,
  );
}

function buildGmailReadAuthError(params: {
  reconnectRequired: boolean;
  connectorId: string;
}): AlisioGmailReadResult {
  return {
    ok: false,
    status: "auth_required",
    connectorId:
      params.connectorId === GMAIL_MODIFY_CONNECTOR_ID
        ? GMAIL_MODIFY_CONNECTOR_ID
        : GMAIL_READ_CONNECTOR_ID,
    message: params.reconnectRequired
      ? "Gmail authorization is no longer valid. Reconnect Gmail Read or Gmail Modify in Apps."
      : "Gmail Read or Gmail Modify is not connected in Alisio. Connect one of them in Apps first.",
    reconnectRequired: params.reconnectRequired,
  };
}

export async function searchAlisioGmailMessages(
  input: {
    query?: string;
    maxResults?: number;
    labelIds?: string[];
    includeSpamTrash?: boolean;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGmailReadResult> {
  const authorization = await resolveGmailReadAccess(env, fetchImpl);
  if (!authorization.accessToken) {
    return buildGmailReadAuthError({
      reconnectRequired: authorization.reconnectRequired,
      connectorId: authorization.connectorId || GMAIL_READ_CONNECTOR_ID,
    });
  }

  const maxResults =
    typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
      ? Math.min(Math.max(1, Math.trunc(input.maxResults)), 10)
      : 5;
  const query = input.query?.trim();
  const searchUrl = new URL(`${GMAIL_API_ROOT}/messages`);
  searchUrl.searchParams.set("maxResults", String(maxResults));
  if (query) {
    searchUrl.searchParams.set("q", query);
  }
  for (const labelId of input.labelIds ?? []) {
    if (labelId.trim()) {
      searchUrl.searchParams.append("labelIds", labelId.trim());
    }
  }
  if (input.includeSpamTrash === true) {
    searchUrl.searchParams.set("includeSpamTrash", "true");
  }

  try {
    const search = await fetchJson(
      searchUrl.toString(),
      { accessToken: authorization.accessToken },
      fetchImpl,
    );
    const providerReason = extractGoogleApiProviderReason(search.body);
    if (!search.response.ok) {
      const reconnectRequired = isGoogleApiReconnectRequired(
        search.response.status,
        providerReason,
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId:
          authorization.connectorId === GMAIL_MODIFY_CONNECTOR_ID
            ? GMAIL_MODIFY_CONNECTOR_ID
            : GMAIL_READ_CONNECTOR_ID,
        message: reconnectRequired
          ? "Gmail authorization is no longer valid. Reconnect Gmail Read or Gmail Modify in Apps."
          : extractGoogleApiProviderErrorMessage(search.body, "Gmail rejected the search request."),
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const messages = Array.isArray(search.body?.messages)
      ? search.body.messages.filter((message): message is { id: string } =>
          Boolean(
            message &&
            typeof message === "object" &&
            typeof (message as { id?: unknown }).id === "string",
          ),
        )
      : [];
    const summaries = await Promise.all(
      messages.map(async (message) => {
        const detailUrl = new URL(`${GMAIL_API_ROOT}/messages/${encodeURIComponent(message.id)}`);
        detailUrl.searchParams.set("format", "metadata");
        for (const headerName of ["Subject", "From", "To", "Cc", "Date"]) {
          detailUrl.searchParams.append("metadataHeaders", headerName);
        }
        const detail = await fetchJson(
          detailUrl.toString(),
          { accessToken: authorization.accessToken as string },
          fetchImpl,
        );
        if (!detail.response.ok || !detail.body) {
          return {
            messageId: message.id,
          } satisfies AlisioGmailMessageSummary;
        }
        return normalizeGmailMessageSummary(detail.body);
      }),
    );

    return {
      ok: true,
      status: "listed",
      connectorId:
        authorization.connectorId === GMAIL_MODIFY_CONNECTOR_ID
          ? GMAIL_MODIFY_CONNECTOR_ID
          : GMAIL_READ_CONNECTOR_ID,
      ...(query ? { query } : {}),
      resultSizeEstimate:
        typeof search.body?.resultSizeEstimate === "number"
          ? search.body.resultSizeEstimate
          : summaries.length,
      messages: summaries,
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId:
        authorization.connectorId === GMAIL_MODIFY_CONNECTOR_ID
          ? GMAIL_MODIFY_CONNECTOR_ID
          : GMAIL_READ_CONNECTOR_ID,
      message: "Gmail could not be reached right now. Try again in a moment.",
    };
  }
}

export async function readAlisioGmailMessage(
  input: {
    messageId: string;
    maxChars?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGmailReadResult> {
  const authorization = await resolveGmailReadAccess(env, fetchImpl);
  if (!authorization.accessToken) {
    return buildGmailReadAuthError({
      reconnectRequired: authorization.reconnectRequired,
      connectorId: authorization.connectorId || GMAIL_READ_CONNECTOR_ID,
    });
  }

  try {
    const detail = await fetchJson(
      `${GMAIL_API_ROOT}/messages/${encodeURIComponent(input.messageId.trim())}?format=full`,
      { accessToken: authorization.accessToken },
      fetchImpl,
    );
    const providerReason = extractGoogleApiProviderReason(detail.body);
    if (!detail.response.ok || !detail.body) {
      const reconnectRequired = isGoogleApiReconnectRequired(
        detail.response.status,
        providerReason,
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId:
          authorization.connectorId === GMAIL_MODIFY_CONNECTOR_ID
            ? GMAIL_MODIFY_CONNECTOR_ID
            : GMAIL_READ_CONNECTOR_ID,
        message: reconnectRequired
          ? "Gmail authorization is no longer valid. Reconnect Gmail Read or Gmail Modify in Apps."
          : extractGoogleApiProviderErrorMessage(detail.body, "Gmail rejected the read request."),
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const summary = normalizeGmailMessageSummary(detail.body);
    const bodyText = extractBodyTextFromPayload(detail.body.payload);
    const maxChars =
      typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
        ? Math.max(1, Math.trunc(input.maxChars))
        : 20_000;
    return {
      ok: true,
      status: "read",
      connectorId:
        authorization.connectorId === GMAIL_MODIFY_CONNECTOR_ID
          ? GMAIL_MODIFY_CONNECTOR_ID
          : GMAIL_READ_CONNECTOR_ID,
      message: {
        ...summary,
        bodyText: bodyText.length > maxChars ? bodyText.slice(0, maxChars) : bodyText,
        truncated: bodyText.length > maxChars,
      },
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId:
        authorization.connectorId === GMAIL_MODIFY_CONNECTOR_ID
          ? GMAIL_MODIFY_CONNECTOR_ID
          : GMAIL_READ_CONNECTOR_ID,
      message: "Gmail could not be reached right now. Try again in a moment.",
    };
  }
}

export async function modifyAlisioGmailMessage(
  input: {
    action: "archive" | "trash" | "mark_read" | "mark_unread" | "add_labels" | "remove_labels";
    messageId: string;
    labelIds?: string[];
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGmailModifyResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GMAIL_MODIFY_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: GMAIL_MODIFY_CONNECTOR_ID,
      message: authorization.reconnectRequired
        ? "Gmail Modify authorization is no longer valid. Reconnect Gmail Modify in Apps."
        : "Gmail Modify is not connected in Alisio. Connect Gmail Modify in Apps first.",
      reconnectRequired: authorization.reconnectRequired,
    };
  }

  try {
    let url = `${GMAIL_API_ROOT}/messages/${encodeURIComponent(input.messageId.trim())}/modify`;
    let body: Record<string, unknown> | undefined;
    switch (input.action) {
      case "archive":
        body = { removeLabelIds: ["INBOX"] };
        break;
      case "trash":
        url = `${GMAIL_API_ROOT}/messages/${encodeURIComponent(input.messageId.trim())}/trash`;
        break;
      case "mark_read":
        body = { removeLabelIds: ["UNREAD"] };
        break;
      case "mark_unread":
        body = { addLabelIds: ["UNREAD"] };
        break;
      case "add_labels":
        body = { addLabelIds: input.labelIds ?? [] };
        break;
      case "remove_labels":
        body = { removeLabelIds: input.labelIds ?? [] };
        break;
    }

    const result = await fetchJson(
      url,
      {
        accessToken: authorization.accessToken,
        method: "POST",
        ...(body ? { body } : {}),
      },
      fetchImpl,
    );
    const providerReason = extractGoogleApiProviderReason(result.body);
    if (!result.response.ok) {
      const reconnectRequired = isGoogleApiReconnectRequired(
        result.response.status,
        providerReason,
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "modify_failed",
        connectorId: GMAIL_MODIFY_CONNECTOR_ID,
        message:
          providerReason === "insufficientPermissions"
            ? "Gmail Modify needs to be reconnected with Gmail modify access."
            : reconnectRequired
              ? "Gmail Modify authorization is no longer valid. Reconnect Gmail Modify in Apps."
              : extractGoogleApiProviderErrorMessage(
                  result.body,
                  "Gmail rejected the modify request.",
                ),
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    return {
      ok: true,
      status: "modified",
      connectorId: GMAIL_MODIFY_CONNECTOR_ID,
      action: input.action,
      messageId: input.messageId.trim(),
      ...(body?.addLabelIds ? { addedLabelIds: body.addLabelIds as string[] } : {}),
      ...(body?.removeLabelIds ? { removedLabelIds: body.removeLabelIds as string[] } : {}),
    };
  } catch {
    return {
      ok: false,
      status: "modify_failed",
      connectorId: GMAIL_MODIFY_CONNECTOR_ID,
      message: "Gmail could not be reached right now. Try again in a moment.",
    };
  }
}
