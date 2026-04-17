import { Cron } from "croner";
import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { CronJob, CronRunStatus, CronStatus } from "../types.ts";
import { renderSkeletonButton, renderSurfaceEmptyState } from "./loading-skeleton.ts";

export type CronCalendarMode = "week" | "month";

export type CronProps = {
  loading: boolean;
  status: CronStatus | null;
  jobs: CronJob[];
  error: string | null;
  calendarMode: CronCalendarMode;
  calendarCursorMs: number;
  calendarSelectedDayMs: number | null;
  onCalendarChange: (patch: {
    mode?: CronCalendarMode;
    cursorMs?: number;
    selectedDayMs?: number | null;
  }) => void;
  onRefresh: () => void;
  onToggle: (job: CronJob, enabled: boolean) => void;
  onRun: (job: CronJob, mode?: "force" | "due") => void;
};

type CalendarAgendaItem = {
  job: CronJob;
  firstAtMs: number;
  count: number;
  sampleAtMs: number[];
  truncated: boolean;
  isDue: boolean;
  isRunning: boolean;
  lastStatus?: CronRunStatus;
};

type WeekEventSeed = {
  id: string;
  job: CronJob;
  startAtMs: number;
  endAtMs: number;
  startMinutes: number;
  durationMinutes: number;
  condensed: boolean;
  count: number;
  truncated: boolean;
  summary: string;
  isDue: boolean;
  isRunning: boolean;
  lastStatus?: CronRunStatus;
};

type WeekEventBlock = WeekEventSeed & {
  lane: number;
  laneCount: number;
};

type CalendarDay = {
  dayMs: number;
  dayEndMs: number;
  isCurrentPeriod: boolean;
  isToday: boolean;
  isSelected: boolean;
  dayNumber: string;
  weekdayShort: string;
  label: string;
  items: CalendarAgendaItem[];
  weekBlocks: WeekEventBlock[];
};

type DayOccurrenceSummary = {
  firstAtMs: number;
  count: number;
  sampleAtMs: number[];
  truncated: boolean;
};

type CalendarPeriod = {
  startMs: number;
  endMs: number;
  label: string;
  days: Array<Pick<CalendarDay, "dayMs" | "dayEndMs" | "isCurrentPeriod">>;
};

type JobOccurrenceResolver = {
  job: CronJob;
  collect: (dayStartMs: number, dayEndMs: number) => DayOccurrenceSummary | null;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const MONTH_GRID_DAYS = 42;
const SUMMARY_SAMPLE_LIMIT = 3;
const EVENT_SAMPLE_LIMIT = 6;
const MAX_DAILY_CRON_OCCURRENCES = 256;
const HOUR_COUNT = 24;
const DEFAULT_EVENT_DURATION_MINUTES = 48;
const CONDENSED_EVENT_DURATION_MINUTES = 72;
const MAX_EXPANDED_OCCURRENCES_PER_DAY = 4;
const MIN_EXPANDED_EVENT_GAP_MS = 45 * 60 * 1_000;

function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(ms: number) {
  return startOfDay(ms) + DAY_MS - 1;
}

function addDays(ms: number, days: number) {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return startOfDay(date.getTime());
}

function addMonths(ms: number, months: number) {
  const date = new Date(ms);
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return startOfDay(date.getTime());
}

function startOfWeek(ms: number) {
  const date = new Date(startOfDay(ms));
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

function startOfMonth(ms: number) {
  const date = new Date(startOfDay(ms));
  date.setDate(1);
  return date.getTime();
}

function isSameDay(a: number, b: number) {
  return startOfDay(a) === startOfDay(b);
}

function formatDayLabel(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatDayNumber(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
  });
}

function formatWeekdayShort(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
  });
}

function formatMonthLabel(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function formatWeekLabel(startMs: number, endMs: number) {
  const sameMonth = new Date(startMs).getMonth() === new Date(endMs).getMonth();
  const startLabel = new Date(startMs).toLocaleDateString(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
  });
  const endLabel = new Date(endMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${startLabel} - ${endLabel}`;
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHourLabel(hour: number) {
  const labelDate = new Date(0);
  labelDate.setHours(hour, 0, 0, 0);
  return labelDate.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseCronFields(expr: string) {
  return expr.trim().split(/\s+/).filter(Boolean);
}

function normalizeCronStaggerMs(raw: unknown) {
  const numeric =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.max(0, Math.floor(numeric));
}

function resolveDefaultCronStaggerMs(expr: string) {
  const fields = parseCronFields(expr);
  if (fields.length === 5) {
    const [minuteField, hourField] = fields;
    return minuteField === "0" && hourField.includes("*") ? 5 * 60 * 1_000 : undefined;
  }
  if (fields.length === 6) {
    const [secondField, minuteField, hourField] = fields;
    return secondField === "0" && minuteField === "0" && hourField.includes("*")
      ? 5 * 60 * 1_000
      : undefined;
  }
  return undefined;
}

function resolveCronStaggerWindowMs(job: CronJob) {
  if (job.schedule.kind !== "cron") {
    return 0;
  }
  const explicit = normalizeCronStaggerMs(job.schedule.staggerMs);
  if (explicit !== undefined) {
    return explicit;
  }
  return resolveDefaultCronStaggerMs(job.schedule.expr) ?? 0;
}

function resolveCronTimezone(tz?: string) {
  const trimmed = typeof tz === "string" ? tz.trim() : "";
  return trimmed || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function computeCronNextBaseRunAtMs(cron: Cron, cursorMs: number) {
  const next = cron.nextRun(new Date(cursorMs));
  if (!(next instanceof Date)) {
    return undefined;
  }
  const nextMs = next.getTime();
  if (!Number.isFinite(nextMs)) {
    return undefined;
  }
  if (nextMs > cursorMs) {
    return nextMs;
  }
  const nextSecondMs = Math.floor(cursorMs / 1_000) * 1_000 + 1_000;
  const retry = cron.nextRun(new Date(nextSecondMs));
  if (retry instanceof Date) {
    const retryMs = retry.getTime();
    if (Number.isFinite(retryMs) && retryMs > cursorMs) {
      return retryMs;
    }
  }
  const tomorrowMs = new Date(cursorMs).setUTCHours(24, 0, 0, 0);
  const retryTomorrow = cron.nextRun(new Date(tomorrowMs));
  if (retryTomorrow instanceof Date) {
    const retryTomorrowMs = retryTomorrow.getTime();
    if (Number.isFinite(retryTomorrowMs) && retryTomorrowMs > cursorMs) {
      return retryTomorrowMs;
    }
  }
  return undefined;
}

function computeCronPreviousBaseRunAtMs(cron: Cron, cursorMs: number) {
  const previousRuns = cron.previousRuns(1, new Date(cursorMs));
  const previous = previousRuns[0];
  if (!(previous instanceof Date)) {
    return undefined;
  }
  const previousMs = previous.getTime();
  if (!Number.isFinite(previousMs) || previousMs >= cursorMs) {
    return undefined;
  }
  return previousMs;
}

function resolveCronOffsetMs(job: CronJob, cron: Cron) {
  if (job.schedule.kind !== "cron") {
    return 0;
  }
  const staggerWindowMs = resolveCronStaggerWindowMs(job);
  if (staggerWindowMs <= 0) {
    return 0;
  }

  const nextRunAtMs = job.state?.nextRunAtMs;
  if (typeof nextRunAtMs === "number" && Number.isFinite(nextRunAtMs) && nextRunAtMs > 0) {
    const baseNextMs = computeCronNextBaseRunAtMs(cron, Date.now());
    if (baseNextMs !== undefined) {
      const offsetMs = nextRunAtMs - baseNextMs;
      if (Number.isFinite(offsetMs) && offsetMs >= 0 && offsetMs <= staggerWindowMs) {
        return offsetMs;
      }
    }
  }

  const lastObservedRunAtMs = job.state?.runningAtMs ?? job.state?.lastRunAtMs;
  if (
    typeof lastObservedRunAtMs === "number" &&
    Number.isFinite(lastObservedRunAtMs) &&
    lastObservedRunAtMs > 0
  ) {
    const basePreviousMs = computeCronPreviousBaseRunAtMs(cron, lastObservedRunAtMs + 1_000);
    if (basePreviousMs !== undefined) {
      const offsetMs = lastObservedRunAtMs - basePreviousMs;
      if (Number.isFinite(offsetMs) && offsetMs >= 0 && offsetMs <= staggerWindowMs) {
        return offsetMs;
      }
    }
  }

  return 0;
}

function buildCalendarPeriod(cursorMs: number, mode: CronCalendarMode): CalendarPeriod {
  const anchorMs = startOfDay(cursorMs);
  if (mode === "week") {
    const startMs = startOfWeek(anchorMs);
    const days = Array.from({ length: 7 }, (_, index) => {
      const dayMs = addDays(startMs, index);
      return {
        dayMs,
        dayEndMs: endOfDay(dayMs),
        isCurrentPeriod: true,
      };
    });
    const endMs = days[days.length - 1]?.dayEndMs ?? endOfDay(startMs);
    return {
      startMs,
      endMs,
      label: formatWeekLabel(startMs, endMs),
      days,
    };
  }

  const monthStartMs = startOfMonth(anchorMs);
  const startMs = startOfWeek(monthStartMs);
  const days = Array.from({ length: MONTH_GRID_DAYS }, (_, index) => {
    const dayMs = addDays(startMs, index);
    return {
      dayMs,
      dayEndMs: endOfDay(dayMs),
      isCurrentPeriod: new Date(dayMs).getMonth() === new Date(monthStartMs).getMonth(),
    };
  });
  return {
    startMs,
    endMs: days[days.length - 1]?.dayEndMs ?? endOfDay(startMs),
    label: formatMonthLabel(anchorMs),
    days,
  };
}

function buildOccurrenceResolvers(jobs: CronJob[]): JobOccurrenceResolver[] {
  return jobs.map((job) => {
    const schedule = job.schedule;
    if (schedule.kind === "at") {
      const atMs = Date.parse(schedule.at);
      return {
        job,
        collect(dayStartMs, dayEndMs) {
          if (!Number.isFinite(atMs) || atMs < dayStartMs || atMs > dayEndMs) {
            return null;
          }
          return {
            firstAtMs: atMs,
            count: 1,
            sampleAtMs: [atMs],
            truncated: false,
          };
        },
      };
    }

    if (schedule.kind === "every") {
      return {
        job,
        collect(dayStartMs, dayEndMs) {
          const everyMs = Math.max(1, Math.floor(schedule.everyMs));
          const anchorMs = Math.max(
            0,
            Math.floor(schedule.anchorMs ?? job.createdAtMs ?? dayStartMs),
          );
          if (!Number.isFinite(everyMs) || everyMs <= 0) {
            return null;
          }
          const offset = Math.max(0, Math.ceil((dayStartMs - anchorMs) / everyMs));
          const firstAtMs = anchorMs + offset * everyMs;
          if (firstAtMs > dayEndMs) {
            return null;
          }
          const count = Math.floor((dayEndMs - firstAtMs) / everyMs) + 1;
          const sampleAtMs = Array.from(
            { length: Math.min(count, EVENT_SAMPLE_LIMIT) },
            (_, index) => firstAtMs + index * everyMs,
          );
          return {
            firstAtMs,
            count,
            sampleAtMs,
            truncated: false,
          };
        },
      };
    }

    const cronSchedule = schedule;
    let cron: Cron | null = null;
    let cronOffsetMs = 0;
    try {
      cron = new Cron(cronSchedule.expr, {
        paused: true,
        catch: false,
        timezone: resolveCronTimezone(cronSchedule.tz),
      });
      cronOffsetMs = resolveCronOffsetMs(job, cron);
    } catch {
      cron = null;
    }

    return {
      job,
      collect(dayStartMs, dayEndMs) {
        if (!cron) {
          const fallbackMs = job.state?.nextRunAtMs;
          if (typeof fallbackMs !== "number" || fallbackMs < dayStartMs || fallbackMs > dayEndMs) {
            return null;
          }
          return {
            firstAtMs: fallbackMs,
            count: 1,
            sampleAtMs: [fallbackMs],
            truncated: false,
          };
        }

        const sampleAtMs: number[] = [];
        let count = 0;
        let truncated = false;
        let cursorMs = dayStartMs - cronOffsetMs - 1_000;

        while (count < MAX_DAILY_CRON_OCCURRENCES) {
          const baseNextMs = computeCronNextBaseRunAtMs(cron, cursorMs);
          if (baseNextMs === undefined) {
            break;
          }
          const nextMs = baseNextMs + cronOffsetMs;
          if (!Number.isFinite(nextMs) || nextMs > dayEndMs) {
            break;
          }
          count += 1;
          if (sampleAtMs.length < EVENT_SAMPLE_LIMIT) {
            sampleAtMs.push(nextMs);
          }
          cursorMs = baseNextMs + 1_000;
        }

        if (count === 0) {
          return null;
        }

        const nextBaseMs = computeCronNextBaseRunAtMs(cron, cursorMs);
        if (nextBaseMs !== undefined && nextBaseMs + cronOffsetMs <= dayEndMs) {
          truncated = true;
        }

        return {
          firstAtMs: sampleAtMs[0] ?? dayStartMs,
          count,
          sampleAtMs,
          truncated,
        };
      },
    };
  });
}

function formatItemSummary(item: CalendarAgendaItem, compact = false) {
  const visibleSamples = item.sampleAtMs.slice(0, SUMMARY_SAMPLE_LIMIT);
  const samples = visibleSamples.map((time) => formatTime(time));
  if (item.count <= 1) {
    return samples[0] ?? formatTime(item.firstAtMs);
  }
  if (compact) {
    return `${samples[0] ?? formatTime(item.firstAtMs)} · ×${item.count}${item.truncated ? "+" : ""}`;
  }
  const extra = item.count - visibleSamples.length;
  const suffix = extra > 0 ? ` +${extra}${item.truncated ? "+" : ""}` : "";
  return `${samples.join(", ")}${suffix}`;
}

function formatRunStatusLabel(status?: CronRunStatus) {
  if (status === "ok") {
    return t("cron.runs.runStatusOk");
  }
  if (status === "error") {
    return t("cron.runs.runStatusError");
  }
  if (status === "skipped") {
    return t("cron.runs.runStatusSkipped");
  }
  return status ?? "";
}

function shouldCondenseWeekItem(item: CalendarAgendaItem) {
  if (item.truncated || item.count > item.sampleAtMs.length) {
    return true;
  }
  if (item.count > MAX_EXPANDED_OCCURRENCES_PER_DAY) {
    return true;
  }
  if (item.sampleAtMs.length < 2) {
    return false;
  }
  for (let index = 1; index < item.sampleAtMs.length; index += 1) {
    const gapMs = item.sampleAtMs[index] - item.sampleAtMs[index - 1];
    if (gapMs < MIN_EXPANDED_EVENT_GAP_MS) {
      return true;
    }
  }
  return false;
}

function getMinutesIntoDay(ms: number) {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function resolveVisualDurationMinutes(startAtMs: number, dayEndMs: number, condensed: boolean) {
  const remainingMinutes = Math.max(1, Math.ceil((dayEndMs - startAtMs + 1) / 60_000));
  const preferredMinutes = condensed
    ? CONDENSED_EVENT_DURATION_MINUTES
    : DEFAULT_EVENT_DURATION_MINUTES;
  return Math.min(preferredMinutes, remainingMinutes);
}

function buildWeekEventSeeds(day: Pick<CalendarDay, "dayEndMs" | "items">) {
  const seeds: WeekEventSeed[] = [];
  for (const item of day.items) {
    const condensed = shouldCondenseWeekItem(item);
    if (condensed) {
      const durationMinutes = resolveVisualDurationMinutes(item.firstAtMs, day.dayEndMs, true);
      seeds.push({
        id: `${item.job.id}:${item.firstAtMs}:summary`,
        job: item.job,
        startAtMs: item.firstAtMs,
        endAtMs: item.firstAtMs + durationMinutes * 60_000,
        startMinutes: getMinutesIntoDay(item.firstAtMs),
        durationMinutes,
        condensed: true,
        count: item.count,
        truncated: item.truncated,
        summary: formatItemSummary(item, true),
        isDue: item.isDue,
        isRunning: item.isRunning,
        lastStatus: item.lastStatus,
      });
      continue;
    }

    item.sampleAtMs.forEach((atMs, index) => {
      const durationMinutes = resolveVisualDurationMinutes(atMs, day.dayEndMs, false);
      seeds.push({
        id: `${item.job.id}:${atMs}:${index}`,
        job: item.job,
        startAtMs: atMs,
        endAtMs: atMs + durationMinutes * 60_000,
        startMinutes: getMinutesIntoDay(atMs),
        durationMinutes,
        condensed: false,
        count: 1,
        truncated: false,
        summary: formatTime(atMs),
        isDue: item.isDue && index === 0,
        isRunning: item.isRunning,
        lastStatus: item.lastStatus,
      });
    });
  }
  return seeds;
}

function assignWeekEventLanes(blocks: WeekEventSeed[]): WeekEventBlock[] {
  const sorted = blocks.toSorted((left, right) => {
    if (left.startAtMs !== right.startAtMs) {
      return left.startAtMs - right.startAtMs;
    }
    if (left.endAtMs !== right.endAtMs) {
      return left.endAtMs - right.endAtMs;
    }
    return left.job.name.localeCompare(right.job.name);
  });

  const laneEndAtMs: number[] = [];
  const placed = sorted.map((block) => {
    let lane = laneEndAtMs.findIndex((endAtMs) => endAtMs <= block.startAtMs);
    if (lane === -1) {
      lane = laneEndAtMs.length;
      laneEndAtMs.push(block.endAtMs);
    } else {
      laneEndAtMs[lane] = block.endAtMs;
    }
    return {
      ...block,
      lane,
      laneCount: 1,
    };
  });

  return placed.map((block) => {
    const laneCount = placed.filter((candidate) => {
      return candidate.startAtMs < block.endAtMs && candidate.endAtMs > block.startAtMs;
    }).length;
    return {
      ...block,
      laneCount: Math.max(1, laneCount),
    };
  });
}

function buildCalendarDays(props: CronProps, period: CalendarPeriod): CalendarDay[] {
  const todayMs = startOfDay(Date.now());
  const selectedDayMs =
    typeof props.calendarSelectedDayMs === "number"
      ? startOfDay(props.calendarSelectedDayMs)
      : null;
  const resolvers = buildOccurrenceResolvers(props.jobs);

  return period.days.map((day) => {
    const items: CalendarAgendaItem[] = [];
    for (const resolver of resolvers) {
      const summary = resolver.collect(day.dayMs, day.dayEndMs);
      if (!summary) {
        continue;
      }
      const nextRunAtMs = resolver.job.state?.nextRunAtMs;
      items.push({
        job: resolver.job,
        firstAtMs: summary.firstAtMs,
        count: summary.count,
        sampleAtMs: summary.sampleAtMs,
        truncated: summary.truncated,
        isDue:
          resolver.job.enabled &&
          typeof nextRunAtMs === "number" &&
          nextRunAtMs <= Date.now() &&
          isSameDay(nextRunAtMs, day.dayMs),
        isRunning: typeof resolver.job.state?.runningAtMs === "number",
        lastStatus: resolver.job.state?.lastStatus,
      });
    }
    items.sort((left, right) => {
      if (left.firstAtMs !== right.firstAtMs) {
        return left.firstAtMs - right.firstAtMs;
      }
      return left.job.name.localeCompare(right.job.name);
    });

    return {
      ...day,
      isToday: isSameDay(day.dayMs, todayMs),
      isSelected: selectedDayMs !== null && isSameDay(day.dayMs, selectedDayMs),
      dayNumber: formatDayNumber(day.dayMs),
      weekdayShort: formatWeekdayShort(day.dayMs),
      label: formatDayLabel(day.dayMs),
      items,
      weekBlocks: assignWeekEventLanes(buildWeekEventSeeds({ dayEndMs: day.dayEndMs, items })),
    };
  });
}

function navigateCalendar(props: CronProps, direction: -1 | 1) {
  const baseMs =
    props.calendarMode === "week"
      ? startOfWeek(props.calendarCursorMs)
      : startOfMonth(props.calendarCursorMs);
  const cursorMs =
    props.calendarMode === "week" ? addDays(baseMs, direction * 7) : addMonths(baseMs, direction);
  props.onCalendarChange({
    cursorMs,
  });
}

function selectCalendarDay(props: CronProps, dayMs: number) {
  props.onCalendarChange({
    cursorMs: props.calendarMode === "week" ? startOfWeek(dayMs) : startOfMonth(dayMs),
    selectedDayMs: dayMs,
  });
}

function renderMonthWeekdayRow(days: CalendarDay[]) {
  return html`
    <div class="cron-month__weekdays" aria-hidden="true">
      ${days
        .slice(0, 7)
        .map((day) => html`<span class="cron-month__weekday">${day.weekdayShort}</span>`)}
    </div>
  `;
}

function renderMonthCell(day: CalendarDay, props: CronProps) {
  const visibleItems = day.items.slice(0, 2);
  const remaining = Math.max(0, day.items.length - visibleItems.length);
  return html`
    <button
      type="button"
      class=${`cron-calendar-day cron-calendar-day--month ${day.isSelected ? "is-selected" : ""} ${day.isToday ? "is-today" : ""} ${day.isCurrentPeriod ? "" : "is-muted"}`}
      title=${day.label}
      aria-current=${day.isToday ? "date" : nothing}
      @click=${() => selectCalendarDay(props, day.dayMs)}
    >
      <span class="cron-calendar-day__header">
        <span class="cron-calendar-day__number">${day.dayNumber}</span>
      </span>
      <span class="cron-calendar-day__body">
        ${visibleItems.map(
          (item) => html`
            <span class="cron-calendar-pill ${item.job.enabled ? "" : "is-disabled"}">
              <span class="cron-calendar-pill__time">${formatItemSummary(item, true)}</span>
              <span class="cron-calendar-pill__name">${item.job.name}</span>
            </span>
          `,
        )}
        ${remaining > 0
          ? html`<span class="cron-calendar-day__more">+${remaining}</span>`
          : nothing}
      </span>
    </button>
  `;
}

function renderWeekHeaderDay(day: CalendarDay, props: CronProps) {
  return html`
    <button
      type="button"
      class=${`cron-week__day-tab ${day.isSelected ? "is-selected" : ""} ${day.isToday ? "is-today" : ""}`}
      title=${day.label}
      @click=${() => selectCalendarDay(props, day.dayMs)}
    >
      <span class="cron-week__day-tab-weekday">${day.weekdayShort}</span>
      <span class="cron-week__day-tab-number">${day.dayNumber}</span>
    </button>
  `;
}

function renderWeekBlock(block: WeekEventBlock, day: CalendarDay, props: CronProps) {
  const secondaryLabel = block.condensed
    ? `×${block.count}${block.truncated ? "+" : ""}`
    : formatRunStatusLabel(block.lastStatus);
  const style = [
    `--cron-start:${block.startMinutes};`,
    `--cron-duration:${block.durationMinutes};`,
    `--cron-lane:${block.lane};`,
    `--cron-lanes:${block.laneCount};`,
  ].join("");

  return html`
    <button
      type="button"
      class=${`cron-week__event ${block.job.enabled ? "" : "is-disabled"} ${block.isRunning ? "is-running" : ""} ${block.isDue ? "is-due" : ""} ${block.condensed ? "is-condensed" : ""}`}
      style=${style}
      title=${`${block.job.name} · ${block.summary}`}
      @click=${() => selectCalendarDay(props, day.dayMs)}
    >
      <span class="cron-week__event-time">${formatTime(block.startAtMs)}</span>
      <span class="cron-week__event-title">${block.job.name}</span>
      ${secondaryLabel
        ? html`<span class="cron-week__event-summary">${secondaryLabel}</span>`
        : nothing}
    </button>
  `;
}

function renderWeekView(days: CalendarDay[], props: CronProps) {
  return html`
    <section class="cron-week" aria-label=${t("cron.calendar.week")}>
      <div class="cron-week__header">
        <div class="cron-week__corner" aria-hidden="true"></div>
        <div class="cron-week__day-tabs">${days.map((day) => renderWeekHeaderDay(day, props))}</div>
      </div>

      <div class="cron-week__body">
        <div class="cron-week__time-rail" aria-hidden="true">
          ${Array.from({ length: HOUR_COUNT }, (_, hour) => {
            return html`
              <div class="cron-week__time-slot">
                <span class="cron-week__time-label">${formatHourLabel(hour)}</span>
              </div>
            `;
          })}
        </div>

        <div class="cron-week__days">
          ${days.map(
            (day) => html`
              <div
                class=${`cron-week__day ${day.isSelected ? "is-selected" : ""} ${day.isToday ? "is-today" : ""}`}
                title=${day.label}
                @click=${() => selectCalendarDay(props, day.dayMs)}
              >
                ${day.weekBlocks.map((block) => renderWeekBlock(block, day, props))}
              </div>
            `,
          )}
        </div>
      </div>
    </section>
  `;
}

function renderCronToolbarSkeleton() {
  return html`
    <header class="cron-calendar-toolbar" aria-hidden="true">
      <div class="cron-calendar-toolbar__group cron-calendar-toolbar__group--nav">
        ${renderSkeletonButton({ small: true })} ${renderSkeletonButton({ small: true })}
        ${renderSkeletonButton({ small: true })}
      </div>
      <div class="skeleton cron-calendar-period cron-calendar-period--skeleton"></div>
      <div class="cron-calendar-toolbar__group">
        ${renderSkeletonButton({ small: true })} ${renderSkeletonButton({ small: true })}
      </div>
      ${renderSkeletonButton({ small: true })}
    </header>
  `;
}

function renderWeekSkeleton() {
  return html`
    <section class="cron-calendar-skeleton cron-calendar-skeleton--week" aria-hidden="true">
      <div class="cron-calendar-skeleton__weekdays">
        <div class="skeleton cron-calendar-skeleton__rail"></div>
        ${Array.from(
          { length: 7 },
          () => html`<div class="skeleton cron-calendar-skeleton__day"></div>`,
        )}
      </div>
      <div class="cron-calendar-skeleton__grid">
        ${Array.from(
          { length: 6 },
          () => html`
            <div class="skeleton cron-calendar-skeleton__rail"></div>
            ${Array.from(
              { length: 7 },
              () => html`<div class="skeleton cron-calendar-skeleton__cell"></div>`,
            )}
          `,
        )}
      </div>
    </section>
  `;
}

function renderMonthSkeleton() {
  return html`
    <section class="cron-calendar-skeleton cron-calendar-skeleton--month" aria-hidden="true">
      <div class="cron-calendar-skeleton__month-weekdays">
        ${Array.from(
          { length: 7 },
          () => html`<div class="skeleton cron-calendar-skeleton__day"></div>`,
        )}
      </div>
      <div class="cron-calendar-skeleton__month-grid">
        ${Array.from(
          { length: 42 },
          () => html`<div class="skeleton cron-calendar-skeleton__cell"></div>`,
        )}
      </div>
    </section>
  `;
}

function renderCronLoadingSkeleton(mode: CronCalendarMode) {
  return html`
    <section class="card cron-calendar-board" role="status" aria-label=${t("common.loading")}>
      ${renderCronToolbarSkeleton()}
      ${mode === "month" ? renderMonthSkeleton() : renderWeekSkeleton()}
    </section>
  `;
}

function renderCalendarEmptyHint() {
  return renderSurfaceEmptyState({
    title: t("cron.calendar.empty"),
    body: t("cron.calendar.emptyHint"),
    className: "cron-calendar-board__empty",
  });
}

export function renderCron(props: CronProps) {
  const showInitialLoading = props.loading && props.jobs.length === 0 && !props.error;
  const period = buildCalendarPeriod(props.calendarCursorMs, props.calendarMode);
  const days = buildCalendarDays(props, period);

  return html`
    <section class="cron-calendar-shell">
      ${props.error
        ? html`<section class="card cron-calendar-error">${props.error}</section>`
        : nothing}
      ${showInitialLoading
        ? renderCronLoadingSkeleton(props.calendarMode)
        : html`
            <section class="card cron-calendar-board">
              <header class="cron-calendar-toolbar">
                <div class="cron-calendar-toolbar__group cron-calendar-toolbar__group--nav">
                  <button class="btn" type="button" @click=${() => navigateCalendar(props, -1)}>
                    ${t("cron.calendar.previous")}
                  </button>
                  <button
                    class="btn"
                    type="button"
                    @click=${() =>
                      props.onCalendarChange({
                        cursorMs:
                          props.calendarMode === "week"
                            ? startOfWeek(Date.now())
                            : startOfMonth(Date.now()),
                        selectedDayMs: null,
                      })}
                  >
                    ${t("cron.calendar.today")}
                  </button>
                  <button class="btn" type="button" @click=${() => navigateCalendar(props, 1)}>
                    ${t("cron.calendar.next")}
                  </button>
                </div>

                <div class="cron-calendar-period">${period.label}</div>

                <div
                  class="cron-calendar-toolbar__group"
                  role="tablist"
                  aria-label=${t("tabs.cron")}
                >
                  <button
                    type="button"
                    class=${`btn ${props.calendarMode === "week" ? "is-primary" : ""}`}
                    aria-pressed=${props.calendarMode === "week"}
                    @click=${() =>
                      props.onCalendarChange({
                        mode: "week",
                        cursorMs: startOfWeek(props.calendarCursorMs),
                      })}
                  >
                    ${t("cron.calendar.week")}
                  </button>
                  <button
                    type="button"
                    class=${`btn ${props.calendarMode === "month" ? "is-primary" : ""}`}
                    aria-pressed=${props.calendarMode === "month"}
                    @click=${() =>
                      props.onCalendarChange({
                        mode: "month",
                        cursorMs: startOfMonth(props.calendarCursorMs),
                      })}
                  >
                    ${t("cron.calendar.month")}
                  </button>
                </div>

                <button
                  class="btn btn--sm"
                  type="button"
                  ?disabled=${props.loading}
                  @click=${props.onRefresh}
                >
                  ${props.loading ? t("common.loading") : t("common.refresh")}
                </button>
              </header>

              ${props.jobs.length === 0 ? renderCalendarEmptyHint() : nothing}
              ${props.calendarMode === "month"
                ? html`
                    <section class="cron-month" aria-label=${t("cron.calendar.month")}>
                      ${renderMonthWeekdayRow(days)}
                      <div class="cron-calendar-grid is-month">
                        ${days.map((day) => renderMonthCell(day, props))}
                      </div>
                    </section>
                  `
                : renderWeekView(days, props)}
            </section>
          `}
    </section>
  `;
}
