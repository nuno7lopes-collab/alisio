import type { AlisioConfig } from "alisio/plugin-sdk/memory-core-host-runtime-core";
import type { MemoryJobsFeatureFlags } from "./types.js";

const DEFAULT_MAX_SLICE_MS = 75;
const DEFAULT_IDLE_WINDOW_MS = 1_500;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MIN_SLICE_MS = 25;
const MAX_SLICE_MS = 250;
const MIN_IDLE_WINDOW_MS = 250;
const MIN_POLL_INTERVAL_MS = 100;

type MemoryJobsConfigShape = {
  memory?: {
    jobs?: {
      enabled?: boolean;
      maxSliceMs?: number;
      autoSleep?: {
        enabled?: boolean;
      };
    };
  };
};

function coerceInteger(value: unknown, fallback: number, min: number, max?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < min) {
    return fallback;
  }
  if (typeof max === "number" && normalized > max) {
    return max;
  }
  return normalized;
}

export function resolveMemoryJobsFeatureFlags(cfg: AlisioConfig): MemoryJobsFeatureFlags {
  const memory = (cfg as AlisioConfig & MemoryJobsConfigShape).memory;
  const jobs = memory?.jobs;
  const maxSliceMs = coerceInteger(
    jobs?.maxSliceMs,
    DEFAULT_MAX_SLICE_MS,
    MIN_SLICE_MS,
    MAX_SLICE_MS,
  );
  return {
    enabled: jobs?.enabled !== false,
    autoSleepEnabled: jobs?.autoSleep?.enabled !== false,
    maxSliceMs,
    idleWindowMs: Math.max(DEFAULT_IDLE_WINDOW_MS, MIN_IDLE_WINDOW_MS),
    pollIntervalMs: Math.max(
      MIN_POLL_INTERVAL_MS,
      Math.min(DEFAULT_POLL_INTERVAL_MS, maxSliceMs * 4),
    ),
  };
}
