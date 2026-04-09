import { afterEach, describe, expect, it, vi } from "vitest";
import { __test, loadUsage, type UsageState } from "./usage.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function createState(request: RequestFn, overrides: Partial<UsageState> = {}): UsageState {
  return {
    client: { request } as unknown as UsageState["client"],
    connected: true,
    usageLoading: false,
    usageResult: null,
    usageCostSummary: null,
    usageError: null,
    usageStartDate: "2026-02-16",
    usageEndDate: "2026-02-16",
    usageSelectedSessions: [],
    usageSelectedDays: [],
    usageTimeSeries: null,
    usageTimeSeriesLoading: false,
    usageTimeSeriesCursorStart: null,
    usageTimeSeriesCursorEnd: null,
    usageSessionLogs: null,
    usageSessionLogsLoading: false,
    usageTimeZone: "local",
    ...overrides,
  };
}

function expectSpecificTimezoneCalls(request: ReturnType<typeof vi.fn>, startCall: number): void {
  expect(request).toHaveBeenNthCalledWith(startCall, "sessions.usage", {
    startDate: "2026-02-16",
    endDate: "2026-02-16",
    mode: "specific",
    utcOffset: "UTC+5:30",
    limit: 1000,
    includeContextWeight: true,
  });
  expect(request).toHaveBeenNthCalledWith(startCall + 1, "usage.cost", {
    startDate: "2026-02-16",
    endDate: "2026-02-16",
    mode: "specific",
    utcOffset: "UTC+5:30",
  });
}

describe("usage controller date interpretation params", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats UTC offsets for whole and half-hour timezones", () => {
    expect(__test.formatUtcOffset(240)).toBe("UTC-4");
    expect(__test.formatUtcOffset(-330)).toBe("UTC+5:30");
    expect(__test.formatUtcOffset(0)).toBe("UTC+0");
  });

  it("sends specific mode with browser offset when usage timezone is local", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request, { usageTimeZone: "local" });
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-330);

    await loadUsage(state);

    expectSpecificTimezoneCalls(request, 1);
  });

  it("sends utc mode without offset when usage timezone is utc", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request, { usageTimeZone: "utc" });

    await loadUsage(state);

    expect(request).toHaveBeenNthCalledWith(1, "sessions.usage", {
      startDate: "2026-02-16",
      endDate: "2026-02-16",
      mode: "utc",
      limit: 1000,
      includeContextWeight: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "usage.cost", {
      startDate: "2026-02-16",
      endDate: "2026-02-16",
      mode: "utc",
    });
  });

  it("captures useful error strings in loadUsage", async () => {
    const request = vi.fn(async () => {
      throw new Error("request failed");
    });
    const state = createState(request);

    await loadUsage(state);

    expect(state.usageError).toBe("request failed");
  });

  it("serializes non-Error objects without object-to-string coercion", () => {
    expect(__test.toErrorMessage({ reason: "nope" })).toBe('{"reason":"nope"}');
  });
});
