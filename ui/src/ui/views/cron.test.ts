import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CronJob } from "../types.ts";
import { renderCron, type CronCalendarMode, type CronProps } from "./cron.ts";

function startOfDay(input: string) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function minutesIntoDay(input: string) {
  const date = new Date(input);
  return date.getHours() * 60 + date.getMinutes();
}

function createJob(id: string, overrides: Partial<CronJob> = {}): CronJob {
  return {
    id,
    name: "Daily digest",
    enabled: true,
    createdAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
    updatedAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
    schedule: { kind: "cron", expr: "0 9 * * *" },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "ping" },
    state: {
      nextRunAtMs: Date.parse("2026-04-15T09:00:00.000Z"),
      lastStatus: "ok",
    },
    ...overrides,
  };
}

function createProps(overrides: Partial<CronProps> = {}): CronProps {
  return {
    loading: false,
    status: {
      enabled: true,
      jobs: 1,
      nextWakeAtMs: Date.parse("2026-04-15T09:00:00.000Z"),
    },
    jobs: [],
    error: null,
    calendarMode: "week",
    calendarCursorMs: startOfDay("2026-04-15T09:30:00.000Z"),
    calendarSelectedDayMs: null,
    onCalendarChange: () => undefined,
    onRefresh: () => undefined,
    onToggle: () => undefined,
    onRun: () => undefined,
    ...overrides,
  };
}

describe("cron view", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T09:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a calendar skeleton during the first load", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          loading: true,
          jobs: [],
        }),
      ),
      container,
    );

    expect(container.querySelector(".cron-calendar-skeleton")).not.toBeNull();
    expect(container.querySelector(".cron-calendar-period--skeleton")).not.toBeNull();
  });

  it("exposes a refresh action alongside the calendar controls", () => {
    const container = document.createElement("div");
    const onRefresh = vi.fn();
    render(
      renderCron(
        createProps({
          jobs: [createJob("job-refresh")],
          onRefresh,
        }),
      ),
      container,
    );

    const refreshButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Refresh",
    );
    expect(refreshButton).toBeTruthy();
    refreshButton?.click();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("renders a weekly hour grid with seven day columns and timed blocks", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [
            createJob("job-1", {
              name: "Morning brief",
              schedule: { kind: "at", at: "2026-04-15T09:00:00.000Z" },
              state: {
                nextRunAtMs: Date.parse("2026-04-15T09:00:00.000Z"),
                lastStatus: "ok",
              },
            }),
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector(".cron-calendar-toolbar")).not.toBeNull();
    expect(container.querySelectorAll(".cron-week__day").length).toBe(7);
    expect(container.querySelectorAll(".cron-week__time-slot").length).toBe(24);

    const event = container.querySelector<HTMLElement>(".cron-week__event");
    expect(event).not.toBeNull();
    expect(event?.textContent).toContain("Morning brief");
    expect(event?.getAttribute("style")).toContain(
      `--cron-start:${minutesIntoDay("2026-04-15T09:00:00.000Z")};`,
    );
    expect(container.querySelector(".cron-calendar-hero")).toBeNull();
  });

  it("renders sparse repeated jobs as separate weekly blocks", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [
            createJob("job-every", {
              name: "Ops heartbeat",
              schedule: {
                kind: "every",
                everyMs: 6 * 60 * 60 * 1_000,
                anchorMs: Date.parse("2026-04-15T00:00:00.000Z"),
              },
              state: {
                nextRunAtMs: Date.parse("2026-04-15T12:00:00.000Z"),
                lastStatus: "ok",
              },
            }),
          ],
        }),
      ),
      container,
    );

    const matchingEvents = Array.from(container.querySelectorAll(".cron-week__event")).filter(
      (event) => event.textContent?.includes("Ops heartbeat"),
    );
    expect(matchingEvents.length).toBe(4);
  });

  it("condenses dense cron jobs and keeps staggered offsets aligned with job state", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [
            createJob("job-staggered", {
              name: "Hourly sync",
              schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC" },
              state: {
                nextRunAtMs: Date.parse("2026-04-15T10:03:00.000Z"),
                lastStatus: "ok",
              },
            }),
          ],
        }),
      ),
      container,
    );

    const event = Array.from(container.querySelectorAll<HTMLElement>(".cron-week__event")).find(
      (node) => node.textContent?.includes("Hourly sync"),
    );
    expect(event).toBeTruthy();
    expect(event?.textContent).toContain("×24");
    expect(event?.getAttribute("style")).toContain(
      `--cron-start:${minutesIntoDay("2026-04-14T23:03:00.000Z")};`,
    );
  });

  it("reuses the last observed run to keep staggered placement stable when nextRunAtMs is missing", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [
            createJob("job-staggered-last-run", {
              name: "Hourly retry",
              enabled: false,
              schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC" },
              state: {
                lastRunAtMs: Date.parse("2026-04-15T08:03:00.000Z"),
                lastStatus: "ok",
              },
            }),
          ],
        }),
      ),
      container,
    );

    const event = Array.from(container.querySelectorAll<HTMLElement>(".cron-week__event")).find(
      (node) => node.textContent?.includes("Hourly retry"),
    );
    expect(event).toBeTruthy();
    expect(event?.getAttribute("style")).toContain(
      `--cron-start:${minutesIntoDay("2026-04-14T23:03:00.000Z")};`,
    );
  });

  it("switches to month mode and lets the user jump back to today", () => {
    const container = document.createElement("div");
    const onCalendarChange = vi.fn();
    render(
      renderCron(
        createProps({
          calendarMode: "week",
          calendarCursorMs: startOfDay("2026-04-20T09:30:00.000Z"),
          calendarSelectedDayMs: startOfDay("2026-04-20T09:30:00.000Z"),
          onCalendarChange,
        }),
      ),
      container,
    );

    const monthButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Month",
    );
    expect(monthButton).toBeTruthy();
    monthButton?.click();

    expect(onCalendarChange).toHaveBeenCalledWith({
      mode: "month",
      cursorMs: expect.any(Number),
    });

    onCalendarChange.mockClear();
    const todayButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Today",
    );
    expect(todayButton).toBeTruthy();
    todayButton?.click();

    expect(onCalendarChange).toHaveBeenCalledWith({
      cursorMs: expect.any(Number),
      selectedDayMs: null,
    });
  });

  it("does not auto-select a day when navigating between periods", () => {
    const container = document.createElement("div");
    const onCalendarChange = vi.fn();

    render(
      renderCron(
        createProps({
          calendarMode: "month",
          calendarCursorMs: startOfDay("2026-04-15T09:30:00.000Z"),
          calendarSelectedDayMs: startOfDay("2026-04-14T09:30:00.000Z"),
          onCalendarChange,
        }),
      ),
      container,
    );

    const previousButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Previous",
    );
    expect(previousButton).toBeTruthy();
    previousButton?.click();

    expect(onCalendarChange).toHaveBeenCalledWith({
      cursorMs: expect.any(Number),
    });
  });

  it("renders the monthly grid with 42 day cells and supports day selection", () => {
    const container = document.createElement("div");
    const onCalendarChange = vi.fn();

    render(
      renderCron(
        createProps({
          calendarMode: "month" satisfies CronCalendarMode,
          jobs: [createJob("job-1")],
          onCalendarChange,
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".cron-month__weekday").length).toBe(7);
    const cells = container.querySelectorAll<HTMLButtonElement>(".cron-calendar-day--month");
    expect(cells.length).toBe(42);

    const target = Array.from(cells).find((cell) => cell.textContent?.includes("16"));
    expect(target).toBeTruthy();
    target?.click();

    expect(onCalendarChange).toHaveBeenCalledWith({
      cursorMs: expect.any(Number),
      selectedDayMs: expect.any(Number),
    });
  });

  it("removes duplicated summary and agenda panels from the calendar layout", () => {
    const container = document.createElement("div");
    const job = createJob("job-actions", { name: "Morning brief" });

    render(
      renderCron(
        createProps({
          jobs: [job],
        }),
      ),
      container,
    );

    expect(container.querySelector(".cron-calendar-hero")).toBeNull();
    expect(container.querySelector(".cron-calendar-stats")).toBeNull();
    expect(container.querySelector(".cron-calendar-agenda")).toBeNull();
  });

  it("keeps today and selected as separate visual states", () => {
    const container = document.createElement("div");

    render(
      renderCron(
        createProps({
          calendarMode: "week",
          calendarSelectedDayMs: startOfDay("2026-04-14T09:30:00.000Z"),
        }),
      ),
      container,
    );

    const selectedTab = container.querySelector<HTMLElement>(".cron-week__day-tab.is-selected");
    const todayTab = container.querySelector<HTMLElement>(".cron-week__day-tab.is-today");

    expect(selectedTab).not.toBeNull();
    expect(todayTab).not.toBeNull();
    expect(selectedTab).not.toBe(todayTab);
    expect(selectedTab?.querySelector(".cron-week__day-tab-number")?.textContent?.trim()).toBe(
      "14",
    );
    expect(todayTab?.querySelector(".cron-week__day-tab-number")?.textContent?.trim()).toBe("15");
  });

  it("keeps the weekly calendar scaffold visible when there are no cron jobs", () => {
    const container = document.createElement("div");
    render(renderCron(createProps()), container);

    expect(container.querySelectorAll(".cron-week__day").length).toBe(7);
    expect(container.querySelectorAll(".cron-week__time-slot").length).toBe(24);
    expect(container.textContent).toContain("No cron jobs yet.");
    expect(container.textContent).toContain(
      "As soon as jobs have a schedule, they appear here on the calendar.",
    );
    expect(container.querySelector(".cron-calendar-board__empty")).not.toBeNull();
  });
});
