import type { MemorySyncCounter, MemorySyncTelemetry, MemorySyncTimingMetric } from "./types.js";

export function incrementSyncCounter(
  telemetry: MemorySyncTelemetry | undefined,
  name: MemorySyncCounter,
  value = 1,
) {
  telemetry?.incrementCounter(name, value);
}

export function recordSyncTiming(
  telemetry: MemorySyncTelemetry | undefined,
  name: MemorySyncTimingMetric,
  durationMs: number,
) {
  telemetry?.recordTiming(name, durationMs);
}

export function createMemorySyncTelemetryCollector() {
  const counters = new Map<MemorySyncCounter, number>();
  const timings = new Map<MemorySyncTimingMetric, number[]>();
  const telemetry: MemorySyncTelemetry = {
    incrementCounter(name, value = 1) {
      counters.set(name, (counters.get(name) ?? 0) + value);
    },
    recordTiming(name, durationMs) {
      const existing = timings.get(name) ?? [];
      existing.push(durationMs);
      timings.set(name, existing);
    },
  };

  return {
    telemetry,
    getCounter(name: MemorySyncCounter) {
      return counters.get(name) ?? 0;
    },
    getTimings(name: MemorySyncTimingMetric) {
      return timings.get(name) ?? [];
    },
  };
}
