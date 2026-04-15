import {
  __resetBrowserSessionRuntimeRegistryForTests,
  listRegisteredBrowserSessionSupervisors,
  resolveBrowserSessionSupervisorForBaseUrl,
} from "./browser-session-runtime-registry.js";
import { createBrowserSessionSupervisor } from "./browser-session-supervisor.js";
import { browserCloseTab } from "./client.js";
export type { BrowserTrackedSessionBrowserTab as TrackedSessionBrowserTab } from "./browser-session.types.js";

let detachedTestSupervisor = createBrowserSessionSupervisor();

function isIgnorableCloseError(err: unknown): boolean {
  const message = String(err).toLowerCase();
  return (
    message.includes("tab not found") ||
    message.includes("target closed") ||
    message.includes("target not found") ||
    message.includes("no such target")
  );
}

function resolveSessionTabSupervisor(baseUrl?: string) {
  return resolveBrowserSessionSupervisorForBaseUrl(baseUrl) ?? detachedTestSupervisor;
}

function listSessionTabSupervisors() {
  const seen = new Set<typeof detachedTestSupervisor>();
  const result = listRegisteredBrowserSessionSupervisors().filter((supervisor) => {
    if (seen.has(supervisor)) {
      return false;
    }
    seen.add(supervisor);
    return true;
  });
  if (!seen.has(detachedTestSupervisor)) {
    result.push(detachedTestSupervisor);
  }
  return result;
}

export function trackSessionBrowserTab(params: {
  sessionKey?: string;
  targetId?: string;
  baseUrl?: string;
  profile?: string;
}): void {
  resolveSessionTabSupervisor(params.baseUrl).trackSessionTab(params);
}

export function untrackSessionBrowserTab(params: {
  sessionKey?: string;
  targetId?: string;
  baseUrl?: string;
  profile?: string;
}): void {
  resolveSessionTabSupervisor(params.baseUrl).untrackSessionTab(params);
}

export async function closeTrackedBrowserTabsForSessions(params: {
  sessionKeys: Array<string | undefined>;
  closeTab?: (tab: { targetId: string; baseUrl?: string; profile?: string }) => Promise<void>;
  onWarn?: (message: string) => void;
}): Promise<number> {
  const seenTrackedIds = new Set<string>();
  const tabs: Array<{ targetId: string; baseUrl?: string; profile?: string }> = [];
  for (const supervisor of listSessionTabSupervisors()) {
    for (const tracked of supervisor.takeTrackedTabsForSessions(params.sessionKeys)) {
      const trackedId = `${tracked.targetId}\u0000${tracked.baseUrl ?? ""}\u0000${tracked.profile ?? ""}`;
      if (seenTrackedIds.has(trackedId)) {
        continue;
      }
      seenTrackedIds.add(trackedId);
      tabs.push(tracked);
    }
  }
  if (tabs.length === 0) {
    return 0;
  }

  const closeTab =
    params.closeTab ??
    (async (tab: { targetId: string; baseUrl?: string; profile?: string }) => {
      await browserCloseTab(tab.baseUrl, tab.targetId, {
        profile: tab.profile,
      });
    });
  let closed = 0;
  for (const tab of tabs) {
    try {
      await closeTab({
        targetId: tab.targetId,
        baseUrl: tab.baseUrl,
        profile: tab.profile,
      });
      closed += 1;
    } catch (err) {
      if (!isIgnorableCloseError(err)) {
        params.onWarn?.(`failed to close tracked browser tab ${tab.targetId}: ${String(err)}`);
      }
    }
  }
  return closed;
}

export function __resetTrackedSessionBrowserTabsForTests(): void {
  detachedTestSupervisor.resetForTests();
  detachedTestSupervisor = createBrowserSessionSupervisor();
  __resetBrowserSessionRuntimeRegistryForTests();
}

export function __countTrackedSessionBrowserTabsForTests(sessionKey?: string): number {
  const supervisors = listSessionTabSupervisors();
  if (typeof sessionKey === "string" && sessionKey.trim()) {
    let count = 0;
    for (const supervisor of supervisors) {
      count += supervisor.getTrackedSession(sessionKey)?.trackedTabs.length ?? 0;
    }
    return count;
  }
  let count = 0;
  for (const supervisor of supervisors) {
    for (const session of supervisor.listTrackedSessions()) {
      count += session.trackedTabs.length;
    }
  }
  return count;
}
