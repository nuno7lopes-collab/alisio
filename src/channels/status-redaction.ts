import { redactSensitiveText } from "../logging/redact.js";

export function redactChannelStatusText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return redactSensitiveText(trimmed);
}

export function redactChannelStatusRecord<T extends Record<string, unknown>>(record: T): T {
  const lastError = redactChannelStatusText(record.lastError);
  if (lastError === null) {
    if (typeof record.lastError !== "string") {
      return record;
    }
    const { lastError: _lastError, ...rest } = record;
    return rest as T;
  }
  if (lastError === record.lastError) {
    return record;
  }
  return {
    ...record,
    lastError,
  };
}
