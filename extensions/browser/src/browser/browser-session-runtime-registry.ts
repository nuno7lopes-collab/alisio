import type { BrowserSessionSupervisor } from "./browser-session.types.js";

const supervisorsByRuntimeScope = new Map<string, BrowserSessionSupervisor>();

function normalizeRuntimePort(raw: number): number | null {
  if (!Number.isFinite(raw)) {
    return null;
  }
  const port = Math.floor(raw);
  if (port <= 0 || port > 65_535) {
    return null;
  }
  return port;
}

function runtimeScopeForPort(rawPort: number): string | null {
  const port = normalizeRuntimePort(rawPort);
  return port ? `port:${port}` : null;
}

function runtimeScopeForBaseUrl(rawBaseUrl?: string): string | null {
  const trimmed = rawBaseUrl?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    const port =
      parsed.port !== ""
        ? Number(parsed.port)
        : parsed.protocol === "https:"
          ? 443
          : parsed.protocol === "http:"
            ? 80
            : NaN;
    return runtimeScopeForPort(port);
  } catch {
    return null;
  }
}

export function registerBrowserSessionSupervisorForPort(params: {
  port: number;
  supervisor: BrowserSessionSupervisor;
}): void {
  const scope = runtimeScopeForPort(params.port);
  if (!scope) {
    return;
  }
  supervisorsByRuntimeScope.set(scope, params.supervisor);
}

export function unregisterBrowserSessionSupervisorForPort(port: number): void {
  const scope = runtimeScopeForPort(port);
  if (!scope) {
    return;
  }
  supervisorsByRuntimeScope.delete(scope);
}

export function resolveBrowserSessionSupervisorForBaseUrl(
  baseUrl?: string,
): BrowserSessionSupervisor | null {
  const scope = runtimeScopeForBaseUrl(baseUrl);
  if (!scope) {
    return null;
  }
  return supervisorsByRuntimeScope.get(scope) ?? null;
}

export function listRegisteredBrowserSessionSupervisors(): BrowserSessionSupervisor[] {
  const seen = new Set<BrowserSessionSupervisor>();
  const result: BrowserSessionSupervisor[] = [];
  for (const supervisor of supervisorsByRuntimeScope.values()) {
    if (seen.has(supervisor)) {
      continue;
    }
    seen.add(supervisor);
    result.push(supervisor);
  }
  return result;
}

export function __resetBrowserSessionRuntimeRegistryForTests(): void {
  supervisorsByRuntimeScope.clear();
}
