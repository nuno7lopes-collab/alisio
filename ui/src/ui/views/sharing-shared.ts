import type { AlisioSharingState } from "../types.ts";

export type SharingRequestScope = "read-only" | "model-use" | "exec";
export type SharingResourcePolicyMap = NonNullable<
  NonNullable<AlisioSharingState["policy"]["resourcePolicies"]>
>;
export type SharingResourceKey = keyof SharingResourcePolicyMap;
export type SharingResourcePolicyMode = SharingResourcePolicyMap[SharingResourceKey];
export type SharingSuggestion = NonNullable<AlisioSharingState["suggestions"]>[number];

export type SharingTargetState = AlisioSharingState["devices"]["available"][number];

export const SHARING_RESOURCE_ORDER: SharingResourceKey[] = [
  "compute",
  "models",
  "jobs",
  "artifacts",
  "cache",
  "memory",
  "vault",
  "files",
  "context",
];

export const SHARING_POLICY_MODE_ORDER: SharingResourcePolicyMode[] = [
  "paired-device",
  "light-approval",
  "explicit-consent",
];

export function expandSharingScopeSelection(scope: SharingRequestScope): SharingRequestScope[] {
  if (scope === "exec") {
    return ["read-only", "model-use", "exec"];
  }
  if (scope === "model-use") {
    return ["read-only", "model-use"];
  }
  return ["read-only"];
}

export function resolveSharingRequestOptions(
  target: Pick<SharingTargetState, "deviceAccess" | "modelAccess" | "execAccess">,
): SharingRequestScope[] {
  if (target.execAccess === "requestable") {
    if (target.modelAccess === "shared" || target.modelAccess === "owner") {
      return ["exec"];
    }
    if (target.deviceAccess === "shared" || target.deviceAccess === "owner") {
      return ["model-use", "exec"];
    }
    return ["read-only", "model-use", "exec"];
  }
  if (target.modelAccess === "requestable") {
    if (target.deviceAccess === "shared" || target.deviceAccess === "owner") {
      return ["model-use"];
    }
    return ["read-only", "model-use"];
  }
  if (target.deviceAccess === "requestable") {
    return ["read-only"];
  }
  return [];
}

export function resolveSharingRequestScopes(
  target: Pick<SharingTargetState, "deviceAccess" | "modelAccess" | "execAccess">,
): SharingRequestScope[] {
  const highest = resolveSharingRequestOptions(target).at(-1) ?? "read-only";
  return expandSharingScopeSelection(highest);
}

export function resolveSharingApprovalOptions(
  scopes: readonly string[] | null | undefined,
): SharingRequestScope[] {
  // Temporary compatibility for legacy scope aliases still accepted by the protocol.
  // Sunset: remove after 2026-06-30, or earlier once first-party clients emit only canonical scopes.
  const normalized = new Set<SharingRequestScope>();
  for (const scope of scopes ?? []) {
    if (scope === "exec") {
      normalized.add("exec");
    }
    if (scope === "model-use" || scope === "model.use" || scope === "exec") {
      normalized.add("model-use");
    }
    if (
      scope === "read-only" ||
      scope === "device.use" ||
      scope === "model-use" ||
      scope === "model.use" ||
      scope === "exec"
    ) {
      normalized.add("read-only");
    }
  }
  if (normalized.has("exec")) {
    return ["read-only", "model-use", "exec"];
  }
  if (normalized.has("model-use")) {
    return ["read-only", "model-use"];
  }
  return ["read-only"];
}
