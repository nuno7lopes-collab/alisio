import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAlisioGoogleCalendarEventMock, listAlisioGoogleCalendarEventsMock } = vi.hoisted(
  () => ({
    createAlisioGoogleCalendarEventMock: vi.fn(),
    listAlisioGoogleCalendarEventsMock: vi.fn(),
  }),
);

vi.mock("../../infra/alisio-google-calendar.js", () => ({
  createAlisioGoogleCalendarEvent: createAlisioGoogleCalendarEventMock,
  listAlisioGoogleCalendarEvents: listAlisioGoogleCalendarEventsMock,
}));

describe("createGoogleCalendarTool", () => {
  beforeEach(() => {
    vi.resetModules();
    createAlisioGoogleCalendarEventMock.mockReset();
    listAlisioGoogleCalendarEventsMock.mockReset();
  });

  it("lists calendar events", async () => {
    const { createGoogleCalendarTool } = await import("./google-calendar-tool.js");
    listAlisioGoogleCalendarEventsMock.mockResolvedValue({
      ok: true,
      status: "listed",
      connectorId: "google-calendar",
      calendarId: "primary",
      events: [{ eventId: "event-1", summary: "Porto", start: "2026-04-15T10:00:00Z" }],
    });

    const result = await createGoogleCalendarTool().execute?.("tool-1", {
      action: "list",
      calendarId: "primary",
      query: "porto",
      timeMin: "2026-04-15T00:00:00Z",
      timeMax: "2026-04-16T00:00:00Z",
      maxResults: 3,
    });

    expect(listAlisioGoogleCalendarEventsMock).toHaveBeenCalledWith({
      calendarId: "primary",
      query: "porto",
      timeMin: "2026-04-15T00:00:00Z",
      timeMax: "2026-04-16T00:00:00Z",
      maxResults: 3,
    });
    expect(result?.details).toMatchObject({
      status: "listed",
      connectorId: "google-calendar",
    });
  });

  it("creates calendar events", async () => {
    const { createGoogleCalendarTool } = await import("./google-calendar-tool.js");
    createAlisioGoogleCalendarEventMock.mockResolvedValue({
      ok: true,
      status: "created",
      connectorId: "google-calendar",
      calendarId: "primary",
      event: {
        eventId: "event-1",
        summary: "Porto",
        start: "2026-04-15T10:00:00Z",
        end: "2026-04-15T11:00:00Z",
        allDay: false,
        attendees: ["nuno@example.com"],
      },
    });

    const result = await createGoogleCalendarTool().execute?.("tool-1", {
      action: "create",
      summary: "Porto",
      start: "2026-04-15T10:00:00Z",
      end: "2026-04-15T11:00:00Z",
      description: "Reuniao",
      location: "Porto",
      timeZone: "Europe/Lisbon",
      attendees: ["nuno@example.com"],
    });

    expect(createAlisioGoogleCalendarEventMock).toHaveBeenCalledWith({
      summary: "Porto",
      start: "2026-04-15T10:00:00Z",
      end: "2026-04-15T11:00:00Z",
      description: "Reuniao",
      location: "Porto",
      timeZone: "Europe/Lisbon",
      attendees: ["nuno@example.com"],
    });
    expect(result?.details).toMatchObject({
      status: "created",
      connectorId: "google-calendar",
    });
  });
});
