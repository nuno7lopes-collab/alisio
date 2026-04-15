import { Type } from "@sinclair/typebox";
import {
  createAlisioGoogleCalendarEvent,
  listAlisioGoogleCalendarEvents,
} from "../../infra/alisio-google-calendar.js";
import {
  payloadTextResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GoogleCalendarToolSchema = Type.Object({
  action: Type.String({
    description: 'Action to run: "list" or "create".',
  }),
  calendarId: Type.Optional(
    Type.String({
      description: 'Calendar id for action="list" or action="create". Defaults to "primary".',
    }),
  ),
  query: Type.Optional(
    Type.String({
      description: 'Optional Google Calendar search query for action="list".',
    }),
  ),
  timeMin: Type.Optional(
    Type.String({
      description: 'Optional inclusive ISO timestamp lower bound for action="list".',
    }),
  ),
  timeMax: Type.Optional(
    Type.String({
      description: 'Optional exclusive ISO timestamp upper bound for action="list".',
    }),
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum events to return for action="list". Defaults to 10.',
    }),
  ),
  summary: Type.Optional(
    Type.String({
      description: 'Event summary for action="create".',
    }),
  ),
  start: Type.Optional(
    Type.String({
      description: 'Event start for action="create". Use ISO timestamp or YYYY-MM-DD.',
    }),
  ),
  end: Type.Optional(
    Type.String({
      description: 'Event end for action="create". Use ISO timestamp or YYYY-MM-DD.',
    }),
  ),
  description: Type.Optional(
    Type.String({
      description: 'Optional event description for action="create".',
    }),
  ),
  location: Type.Optional(
    Type.String({
      description: 'Optional event location for action="create".',
    }),
  ),
  timeZone: Type.Optional(
    Type.String({
      description: 'Optional time zone for date-time values in action="create".',
    }),
  ),
  attendees: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Optional attendee email list for action="create".',
    }),
  ),
});

function readCsvStringArrayParam(
  params: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const rawValues = readStringArrayParam(params, key);
  if (!rawValues) {
    return undefined;
  }
  const values = rawValues
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function createGoogleCalendarTool(): AnyAgentTool {
  return {
    label: "Google Calendar",
    name: "google_calendar",
    ownerOnly: true,
    displaySummary:
      "List and create Google Calendar events through the connected Google Calendar app.",
    description:
      "List and create Google Calendar events through the connected Google Calendar app. Prefer this over browser automation for calendar work.",
    parameters: GoogleCalendarToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "list") {
        const calendarId = readStringParam(params, "calendarId");
        const query = readStringParam(params, "query");
        const timeMin = readStringParam(params, "timeMin");
        const timeMax = readStringParam(params, "timeMax");
        const maxResults = readNumberParam(params, "maxResults", {
          integer: true,
          strict: true,
        });
        if (maxResults !== undefined && maxResults <= 0) {
          throw new ToolInputError("maxResults must be greater than 0");
        }
        return payloadTextResult(
          await listAlisioGoogleCalendarEvents({
            ...(calendarId ? { calendarId } : {}),
            ...(query ? { query } : {}),
            ...(timeMin ? { timeMin } : {}),
            ...(timeMax ? { timeMax } : {}),
            ...(maxResults !== undefined ? { maxResults } : {}),
          }),
        );
      }
      if (action === "create") {
        const calendarId = readStringParam(params, "calendarId");
        const description = readStringParam(params, "description");
        const location = readStringParam(params, "location");
        const timeZone = readStringParam(params, "timeZone");
        const attendees = readCsvStringArrayParam(params, "attendees");
        const summary = readStringParam(params, "summary", {
          required: true,
          label: "summary",
        });
        const start = readStringParam(params, "start", {
          required: true,
          label: "start",
        });
        const end = readStringParam(params, "end", {
          required: true,
          label: "end",
        });
        return payloadTextResult(
          await createAlisioGoogleCalendarEvent({
            summary,
            start,
            end,
            ...(calendarId ? { calendarId } : {}),
            ...(description ? { description } : {}),
            ...(location ? { location } : {}),
            ...(timeZone ? { timeZone } : {}),
            ...(attendees ? { attendees } : {}),
          }),
        );
      }
      throw new ToolInputError('action must be "list" or "create"');
    },
  };
}
