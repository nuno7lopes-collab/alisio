import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  createAlisioGoogleCalendarEvent,
  listAlisioGoogleCalendarEvents,
} from "./alisio-google-calendar.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function readFetchCallUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input instanceof Request) {
    return input.url;
  }
  return JSON.stringify(input);
}

function readFetchBodyText(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  return JSON.stringify(body ?? "");
}

async function createReadyAlisioAccountEnv(root: string) {
  const env = {
    ALISIO_STATE_DIR: root,
    ALISIO_SUPABASE_URL: "https://example.supabase.co",
    ALISIO_SUPABASE_ANON_KEY: "anon-key",
    ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
    ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
    ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
    ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
  } as NodeJS.ProcessEnv;
  const statePath = path.join(root, "alisio", "state.json");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        version: 1,
        account: {
          profile: {
            userId: "user-1",
            username: "nuno",
            displayName: "Nuno Lopes",
            email: "nuno@example.com",
            avatarLabel: "N",
            joinedAt: "2026-04-04T15:00:00.000Z",
            plan: "free",
            backend: "supabase",
          },
          preferences: {
            language: "pt-PT",
            themeFamily: DEFAULT_THEME_FAMILY,
            themeMode: "dark",
            themeAccents: DEFAULT_THEME_ACCENTS,
          },
          session: {
            state: "signed_in",
            profileCompleted: true,
            signedInAt: "2026-04-04T15:00:00.000Z",
            backend: "supabase",
          },
        },
        organization: {
          mode: "none",
        },
        ai: {},
        authorizations: {},
        oauthCredentials: {},
        pendingAuthorizations: {},
      },
      null,
      2,
    ),
  );
  return env;
}

async function connectGoogleCalendar(env: NodeJS.ProcessEnv) {
  const begin = await beginAlisioConnectorSetup("google-calendar", env);
  const launchUrl = new URL(begin?.setupUrl ?? "");
  const authFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "calendar-access",
          refresh_token: "calendar-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/calendar openid email",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sub: "google-user-1",
          name: "Nuno Lopes",
          email: "nuno@example.com",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

  await completeAlisioConnectorAuthorizationFromCallback(
    {
      provider: "google",
      stateToken: launchUrl.searchParams.get("state"),
      code: "google-code",
    },
    env,
    authFetch,
  );
}

describe("alisio google calendar runtime", () => {
  it("lists Google Calendar events through the connected connector", async () => {
    await withTempDir({ prefix: "alisio-google-calendar-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleCalendar(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            timeZone: "Europe/Lisbon",
            nextPageToken: "next-1",
            items: [
              {
                id: "event-1",
                summary: "Porto",
                description: "Reuniao",
                location: "Porto",
                status: "confirmed",
                htmlLink: "https://calendar.google.com/calendar/event?eid=event-1",
                start: {
                  dateTime: "2026-04-15T10:00:00Z",
                },
                end: {
                  dateTime: "2026-04-15T11:00:00Z",
                },
                attendees: [{ email: "nuno@example.com" }, { email: "nuno@example.com" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await listAlisioGoogleCalendarEvents(
        {
          query: "porto",
          timeMin: "2026-04-15T00:00:00Z",
          timeMax: "2026-04-16T00:00:00Z",
          maxResults: 3,
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "listed",
        connectorId: "google-calendar",
        calendarId: "primary",
        timeZone: "Europe/Lisbon",
        nextPageToken: "next-1",
      });
      if (result.ok && result.status === "listed") {
        expect(result.events[0]).toMatchObject({
          eventId: "event-1",
          summary: "Porto",
          description: "Reuniao",
          location: "Porto",
          status: "confirmed",
          allDay: false,
          attendees: ["nuno@example.com"],
        });
      }

      const requestUrl = new URL(readFetchCallUrl(fetchMock.mock.calls[0]?.[0]));
      expect(requestUrl.pathname).toBe("/calendar/v3/calendars/primary/events");
      expect(requestUrl.searchParams.get("q")).toBe("porto");
      expect(requestUrl.searchParams.get("timeMin")).toBe("2026-04-15T00:00:00Z");
      expect(requestUrl.searchParams.get("timeMax")).toBe("2026-04-16T00:00:00Z");
      expect(requestUrl.searchParams.get("maxResults")).toBe("3");
    });
  });

  it("creates Google Calendar events through the connected connector", async () => {
    await withTempDir({ prefix: "alisio-google-calendar-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleCalendar(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "event-1",
            summary: "Porto",
            description: "Reuniao",
            location: "Porto",
            htmlLink: "https://calendar.google.com/calendar/event?eid=event-1",
            start: {
              dateTime: "2026-04-15T10:00:00Z",
              timeZone: "Europe/Lisbon",
            },
            end: {
              dateTime: "2026-04-15T11:00:00Z",
              timeZone: "Europe/Lisbon",
            },
            attendees: [{ email: "nuno@example.com" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await createAlisioGoogleCalendarEvent(
        {
          summary: "Porto",
          start: "2026-04-15T10:00:00Z",
          end: "2026-04-15T11:00:00Z",
          description: "Reuniao",
          location: "Porto",
          timeZone: "Europe/Lisbon",
          attendees: ["nuno@example.com", "nuno@example.com"],
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "created",
        connectorId: "google-calendar",
        calendarId: "primary",
      });
      if (result.ok && result.status === "created") {
        expect(result.event).toMatchObject({
          eventId: "event-1",
          summary: "Porto",
          attendees: ["nuno@example.com"],
        });
      }

      const requestUrl = new URL(readFetchCallUrl(fetchMock.mock.calls[0]?.[0]));
      expect(requestUrl.pathname).toBe("/calendar/v3/calendars/primary/events");
      const requestInit = fetchMock.mock.calls[0]?.[1];
      expect(requestInit?.method).toBe("POST");
      expect(JSON.parse(readFetchBodyText(requestInit?.body))).toMatchObject({
        summary: "Porto",
        description: "Reuniao",
        location: "Porto",
        start: {
          dateTime: "2026-04-15T10:00:00Z",
          timeZone: "Europe/Lisbon",
        },
        end: {
          dateTime: "2026-04-15T11:00:00Z",
          timeZone: "Europe/Lisbon",
        },
        attendees: [{ email: "nuno@example.com" }],
      });
    });
  });
});
