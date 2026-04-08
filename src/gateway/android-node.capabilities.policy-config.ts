import type { AlisioConfig } from "../config/config.js";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function unwrapRemoteConfigSnapshot(raw: unknown): AlisioConfig {
  const rawObj = asRecord(raw);
  const resolved = asRecord(rawObj.resolved);
  if (Object.keys(resolved).length > 0) {
    return resolved as AlisioConfig;
  }

  const wrapped = asRecord(rawObj.config);
  if (Object.keys(wrapped).length > 0) {
    return wrapped as AlisioConfig;
  }

  const legacyPayload = asRecord(rawObj.payload);
  const legacyResolved = asRecord(legacyPayload.resolved);
  if (Object.keys(legacyResolved).length > 0) {
    return legacyResolved as AlisioConfig;
  }

  const legacyConfig = asRecord(legacyPayload.config);
  if (Object.keys(legacyConfig).length > 0) {
    return legacyConfig as AlisioConfig;
  }

  if (Object.keys(rawObj).length > 0 && !Object.prototype.hasOwnProperty.call(rawObj, "payload")) {
    return rawObj as AlisioConfig;
  }

  throw new Error("remote gateway config.get returned empty config payload");
}
