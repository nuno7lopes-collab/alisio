import type { MemorySyncAvailability, ResolveSyncAvailabilityParams } from "./types.js";

export function resolveMemorySyncAvailability(
  params: ResolveSyncAvailabilityParams,
): MemorySyncAvailability {
  const mode = params.mode ?? "off";
  if (!params.enabled) {
    return { state: "inactive", mode, reason: "disabled" };
  }
  if (mode === "off") {
    return { state: "inactive", mode, reason: "mode_off" };
  }
  if (!params.profileRootKeyAvailable) {
    return { state: "blocked", mode, reason: "missing_profile_key" };
  }
  if (mode === "cloud" && !params.relayBaseUrlConfigured) {
    return { state: "blocked", mode, reason: "missing_relay_base_url" };
  }
  if (mode === "cloud" && !params.accessTokenAvailable) {
    return { state: "blocked", mode, reason: "missing_access_token" };
  }
  if (mode === "direct" && params.directEnabled !== true) {
    return { state: "blocked", mode, reason: "direct_disabled" };
  }
  return { state: "active", mode };
}
