import type { BrowserSessionAuthMethod } from "./browser-action.types.js";

export type BrowserSessionAuthCacheEntry = {
  sessionKey: string;
  origin: string;
  status: "primed" | "reused";
  method: BrowserSessionAuthMethod;
  updatedAt: number;
  fields?: number;
};

export type BrowserSessionAuthCache = {
  read: (sessionKey: string, origin: string) => BrowserSessionAuthCacheEntry | null;
  write: (entry: BrowserSessionAuthCacheEntry) => BrowserSessionAuthCacheEntry;
  clearSession: (sessionKey: string) => void;
  clear: () => void;
};

function normalizeSessionKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeOrigin(raw: string): string {
  return raw.trim().toLowerCase();
}

function buildCacheKey(sessionKey: string, origin: string): string {
  return `${normalizeSessionKey(sessionKey)}\u0000${normalizeOrigin(origin)}`;
}

export function createBrowserSessionAuthCache(): BrowserSessionAuthCache {
  const entries = new Map<string, BrowserSessionAuthCacheEntry>();

  return {
    read(sessionKey, origin) {
      const current = entries.get(buildCacheKey(sessionKey, origin));
      return current ? { ...current } : null;
    },
    write(entry) {
      const normalized: BrowserSessionAuthCacheEntry = {
        sessionKey: normalizeSessionKey(entry.sessionKey),
        origin: normalizeOrigin(entry.origin),
        status: entry.status,
        method: entry.method,
        updatedAt: entry.updatedAt,
        fields:
          typeof entry.fields === "number" && Number.isFinite(entry.fields)
            ? Math.max(0, Math.floor(entry.fields))
            : undefined,
      };
      entries.set(buildCacheKey(normalized.sessionKey, normalized.origin), normalized);
      return { ...normalized };
    },
    clearSession(sessionKey) {
      const prefix = `${normalizeSessionKey(sessionKey)}\u0000`;
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) {
          entries.delete(key);
        }
      }
    },
    clear() {
      entries.clear();
    },
  };
}
