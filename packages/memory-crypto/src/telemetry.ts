import type { MemoryCryptoCounter, MemoryCryptoTelemetry } from "./types.js";

export function incrementCryptoCounter(
  telemetry: MemoryCryptoTelemetry | undefined,
  name: MemoryCryptoCounter,
  value = 1,
) {
  telemetry?.incrementCounter(name, value);
}

export function createMemoryCryptoTelemetryCollector() {
  const counters = new Map<MemoryCryptoCounter, number>();
  const telemetry: MemoryCryptoTelemetry = {
    incrementCounter(name, value = 1) {
      counters.set(name, (counters.get(name) ?? 0) + value);
    },
  };

  return {
    telemetry,
    getCounter(name: MemoryCryptoCounter) {
      return counters.get(name) ?? 0;
    },
    snapshot() {
      return Object.fromEntries(counters) as Record<MemoryCryptoCounter, number>;
    },
  };
}
