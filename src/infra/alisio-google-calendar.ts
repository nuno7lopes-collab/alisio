import {
  extractGoogleApiProviderErrorMessage,
  extractGoogleApiProviderReason,
  isGoogleApiReconnectRequired,
  resolveAlisioConnectorRuntimeAccess,
} from "./alisio-connector-runtime.js";

const GOOGLE_CALENDAR_CONNECTOR_ID = "google-calendar";
const GOOGLE_CALENDAR_API_ROOT = "https://www.googleapis.com/calendar/v3/calendars";

export type AlisioGoogleCalendarEvent = {
  eventId: string;
  summary: string;
  description?: string;
  location?: string;
  status?: string;
  start: string;
  end: string;
  allDay: boolean;
  eventUrl?: string;
  attendees: string[];
};

export type AlisioGoogleCalendarResult =
  | {
      ok: true;
      status: "listed";
      connectorId: "google-calendar";
      calendarId: string;
      timeZone?: string;
      events: AlisioGoogleCalendarEvent[];
      nextPageToken?: string;
    }
  | {
      ok: true;
      status: "created";
      connectorId: "google-calendar";
      calendarId: string;
      event: AlisioGoogleCalendarEvent;
    }
  | {
      ok: false;
      status: "auth_required" | "list_failed" | "create_failed";
      connectorId: "google-calendar";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

type GoogleCalendarMoment = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

function normalizeCalendarId(value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "primary";
}

function normalizeCalendarAttendees(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }
          const email = (entry as { email?: unknown }).email;
          return typeof email === "string" && email.trim() ? [email.trim()] : [];
        })
        .filter(Boolean),
    ),
  );
}

function normalizeCalendarDateValue(value: unknown): { value: string; allDay: boolean } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { date?: unknown; dateTime?: unknown };
  if (typeof record.date === "string" && record.date.trim()) {
    return { value: record.date.trim(), allDay: true };
  }
  if (typeof record.dateTime === "string" && record.dateTime.trim()) {
    return { value: record.dateTime.trim(), allDay: false };
  }
  return null;
}

function normalizeCalendarEvent(body: Record<string, unknown>): AlisioGoogleCalendarEvent | null {
  const eventId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : null;
  const start = normalizeCalendarDateValue(body.start);
  const end = normalizeCalendarDateValue(body.end);
  if (!eventId || !start || !end) {
    return null;
  }
  const summary =
    typeof body.summary === "string" && body.summary.trim()
      ? body.summary.trim()
      : "Untitled event";
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : undefined;
  const location =
    typeof body.location === "string" && body.location.trim() ? body.location.trim() : undefined;
  const status =
    typeof body.status === "string" && body.status.trim() ? body.status.trim() : undefined;
  const eventUrl =
    typeof body.htmlLink === "string" && body.htmlLink.trim() ? body.htmlLink.trim() : undefined;
  return {
    eventId,
    summary,
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(status ? { status } : {}),
    start: start.value,
    end: end.value,
    allDay: start.allDay && end.allDay,
    ...(eventUrl ? { eventUrl } : {}),
    attendees: normalizeCalendarAttendees(body.attendees),
  };
}

function buildCalendarAuthError(params: {
  reconnectRequired: boolean;
}): AlisioGoogleCalendarResult {
  return {
    ok: false,
    status: "auth_required",
    connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
    message: params.reconnectRequired
      ? "Google Calendar authorization is no longer valid. Reconnect Google Calendar in Apps."
      : "Google Calendar is not connected in Alisio. Connect Google Calendar in Apps first.",
    reconnectRequired: params.reconnectRequired,
  };
}

function isDateOnlyString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function buildCalendarMoment(value: string, timeZone?: string): GoogleCalendarMoment | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (isDateOnlyString(trimmed)) {
    return { date: trimmed };
  }
  if (Number.isNaN(Date.parse(trimmed))) {
    return null;
  }
  const normalizedTimeZone = timeZone?.trim();
  return normalizedTimeZone
    ? { dateTime: trimmed, timeZone: normalizedTimeZone }
    : { dateTime: trimmed };
}

export async function listAlisioGoogleCalendarEvents(
  input: {
    calendarId?: string;
    query?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleCalendarResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_CALENDAR_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildCalendarAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const calendarId = normalizeCalendarId(input.calendarId);
  const maxResults =
    typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
      ? Math.max(1, Math.trunc(input.maxResults))
      : 10;
  const url = new URL(`${GOOGLE_CALENDAR_API_ROOT}/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));
  if (input.query?.trim()) {
    url.searchParams.set("q", input.query.trim());
  }
  if (input.timeMin?.trim()) {
    url.searchParams.set("timeMin", input.timeMin.trim());
  }
  if (input.timeMax?.trim()) {
    url.searchParams.set("timeMax", input.timeMax.trim());
  }

  try {
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${authorization.accessToken}`,
        accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body || !Array.isArray(body.items)) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Calendar needs to be reconnected with Calendar access."
          : reconnectRequired
            ? "Google Calendar authorization is no longer valid. Reconnect Google Calendar in Apps."
            : extractGoogleApiProviderErrorMessage(
                body,
                "Google Calendar rejected the list request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "list_failed",
        connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const events = body.items.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const normalized = normalizeCalendarEvent(entry as Record<string, unknown>);
      return normalized ? [normalized] : [];
    });
    const timeZone =
      typeof body.timeZone === "string" && body.timeZone.trim() ? body.timeZone.trim() : undefined;
    const nextPageToken =
      typeof body.nextPageToken === "string" && body.nextPageToken.trim()
        ? body.nextPageToken.trim()
        : undefined;
    return {
      ok: true,
      status: "listed",
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      calendarId,
      ...(timeZone ? { timeZone } : {}),
      events,
      ...(nextPageToken ? { nextPageToken } : {}),
    };
  } catch {
    return {
      ok: false,
      status: "list_failed",
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      message: "Google Calendar could not be reached right now. Try again in a moment.",
    };
  }
}

export async function createAlisioGoogleCalendarEvent(
  input: {
    summary: string;
    start: string;
    end: string;
    calendarId?: string;
    description?: string;
    location?: string;
    timeZone?: string;
    attendees?: string[];
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleCalendarResult> {
  const normalizedSummary = input.summary.trim();
  if (!normalizedSummary) {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      message: "Google Calendar event summary is required.",
    };
  }

  const start = buildCalendarMoment(input.start, input.timeZone);
  const end = buildCalendarMoment(input.end, input.timeZone);
  if (!start || !end) {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      message:
        "Google Calendar event start and end must be valid ISO timestamps or YYYY-MM-DD dates.",
    };
  }
  if (Boolean(start.date) !== Boolean(end.date)) {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      message:
        "Google Calendar event start and end must both be date-only or both be date-time values.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_CALENDAR_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildCalendarAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const calendarId = normalizeCalendarId(input.calendarId);
  const attendees = Array.from(
    new Set((input.attendees ?? []).map((value) => value.trim()).filter(Boolean)),
  );

  try {
    const response = await fetchImpl(
      `${GOOGLE_CALENDAR_API_ROOT}/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          summary: normalizedSummary,
          ...(input.description?.trim() ? { description: input.description.trim() } : {}),
          ...(input.location?.trim() ? { location: input.location.trim() } : {}),
          start,
          end,
          ...(attendees.length > 0 ? { attendees: attendees.map((email) => ({ email })) } : {}),
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Calendar needs to be reconnected with Calendar access."
          : reconnectRequired
            ? "Google Calendar authorization is no longer valid. Reconnect Google Calendar in Apps."
            : extractGoogleApiProviderErrorMessage(
                body,
                "Google Calendar rejected the create request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "create_failed",
        connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }

    const event = normalizeCalendarEvent(body);
    if (!event) {
      return {
        ok: false,
        status: "create_failed",
        connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
        message: "Google Calendar created the event but returned an unexpected payload.",
      };
    }

    return {
      ok: true,
      status: "created",
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      calendarId,
      event,
    };
  } catch {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      message: "Google Calendar could not be reached right now. Try again in a moment.",
    };
  }
}
