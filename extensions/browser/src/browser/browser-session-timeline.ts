import type { BrowserSessionTimelineEvent } from "./browser-session.types.js";

const DEFAULT_TIMELINE_LIMIT = 128;

export type BrowserSessionTimeline = {
  append: (event: BrowserSessionTimelineEvent) => void;
  list: () => BrowserSessionTimelineEvent[];
  clear: () => void;
};

export function createBrowserSessionTimeline(params?: { limit?: number }): BrowserSessionTimeline {
  const limit =
    typeof params?.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : DEFAULT_TIMELINE_LIMIT;
  let events: BrowserSessionTimelineEvent[] = [];

  return {
    append(event) {
      events.push({ ...event });
      if (events.length > limit) {
        events = events.slice(events.length - limit);
      }
    },
    list() {
      return events.map((event) => ({ ...event }));
    },
    clear() {
      events = [];
    },
  };
}
