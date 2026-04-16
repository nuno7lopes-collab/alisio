import { isSubagentSessionKey } from "../sessions/session-key-utils.js";
import { isAlisioDynamicProvider } from "./alisio-dynamic-provider.js";

export function isLocalManagedModelProvider(providerId: string | undefined | null): boolean {
  const trimmed = providerId?.trim() ?? "";
  return trimmed.length > 0 && isAlisioDynamicProvider(trimmed);
}

export function sessionAllowsLocalManagedModels(sessionKey: string | undefined | null): boolean {
  return isSubagentSessionKey(sessionKey);
}

export function isLocalManagedModelRestrictedForSession(params: {
  providerId: string | undefined | null;
  sessionKey: string | undefined | null;
}): boolean {
  return (
    isLocalManagedModelProvider(params.providerId) &&
    !sessionAllowsLocalManagedModels(params.sessionKey)
  );
}

export function getLocalManagedModelRestrictionReason(): string {
  return "local models are only available for subagent sessions";
}

export function filterModelCatalogForSessionPolicy<T extends { provider?: string | null }>(
  catalog: readonly T[],
  sessionKey: string | undefined | null,
): T[] {
  if (sessionAllowsLocalManagedModels(sessionKey)) {
    return [...catalog];
  }
  return catalog.filter(
    (entry) =>
      !isLocalManagedModelRestrictedForSession({
        providerId: entry.provider,
        sessionKey,
      }),
  );
}

export function filterModelKeysForSessionPolicy(
  keys: Iterable<string>,
  sessionKey: string | undefined | null,
): Set<string> {
  if (sessionAllowsLocalManagedModels(sessionKey)) {
    return new Set(keys);
  }
  const filtered = new Set<string>();
  for (const key of keys) {
    const slash = key.indexOf("/");
    const providerId = slash > 0 ? key.slice(0, slash) : key;
    if (
      isLocalManagedModelRestrictedForSession({
        providerId,
        sessionKey,
      })
    ) {
      continue;
    }
    filtered.add(key);
  }
  return filtered;
}
