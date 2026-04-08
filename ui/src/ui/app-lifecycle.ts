import { connectGateway } from "./app-gateway.ts";
import {
  startLogsPolling,
  startNodesPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
} from "./app-polling.ts";
import { observeTopbar, scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.ts";
import {
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncAccountPreferences,
  syncTabWithLocation,
  syncThemeWithSettings,
} from "./app-settings.ts";
import { loadAssistantIdentity } from "./controllers/assistant-identity.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";
import type { Tab } from "./navigation.ts";

type LifecycleHost = {
  basePath: string;
  client?: { stop: () => void } | null;
  connectGeneration: number;
  connected?: boolean;
  settings?: { token: string };
  password?: string;
  tab: Tab;
  settingsSection?: import("./navigation.ts").SettingsSection;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  alisioAuthMode?: "sign-in" | "sign-up";
  alisioAuthEmail?: string;
  alisioAuthPendingEmail?: string;
  alisioStartupLoading: boolean;
  alisioStartupError: string | null;
  alisioStartupBootstrap: import("./types.ts").AlisioHttpBootstrap | null;
  gatewayBootstrapUrl: string | null;
  gatewayBootstrapToken: string | null;
  chatHasAutoScrolled: boolean;
  chatManualRefreshInFlight: boolean;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string | null;
  logsAutoFollow: boolean;
  logsAtBottom: boolean;
  logsEntries: unknown[];
  popStateHandler: () => void;
  topbarObserver: ResizeObserver | null;
  setTab?: (tab: Tab) => void;
};

export function handleConnected(host: LifecycleHost) {
  const connectGeneration = ++host.connectGeneration;
  host.basePath = inferBasePath();
  applySettingsFromUrl(host as unknown as Parameters<typeof applySettingsFromUrl>[0]);
  const bootstrapReady = loadControlUiBootstrapConfig(host);
  syncTabWithLocation(host as unknown as Parameters<typeof syncTabWithLocation>[0], true);
  syncThemeWithSettings(host as unknown as Parameters<typeof syncThemeWithSettings>[0]);
  attachThemeListener(host as unknown as Parameters<typeof attachThemeListener>[0]);
  window.addEventListener("popstate", host.popStateHandler);
  void bootstrapReady.finally(() => {
    if (host.connectGeneration !== connectGeneration) {
      return;
    }
    const restoredEmail = host.alisioStartupBootstrap?.account?.email?.trim();
    if (restoredEmail) {
      if (!host.alisioAuthEmail?.trim()) {
        host.alisioAuthEmail = restoredEmail;
      }
      if (!host.alisioAuthPendingEmail?.trim()) {
        host.alisioAuthPendingEmail = restoredEmail;
      }
      host.alisioAuthMode = "sign-in";
    }
    const startupState = host.alisioStartupBootstrap?.startupState ?? null;
    if (startupState && startupState !== "ready" && host.tab !== "setup") {
      host.setTab?.("setup");
    }
    connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
  });
  startNodesPolling(host as unknown as Parameters<typeof startNodesPolling>[0]);
  if (host.tab === "settings" && host.settingsSection === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  }
  if (host.tab === "settings" && host.settingsSection === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  }
}

export function handleFirstUpdated(host: LifecycleHost) {
  observeTopbar(host as unknown as Parameters<typeof observeTopbar>[0]);
}

export function handleDisconnected(host: LifecycleHost) {
  host.connectGeneration += 1;
  window.removeEventListener("popstate", host.popStateHandler);
  stopNodesPolling(host as unknown as Parameters<typeof stopNodesPolling>[0]);
  stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  host.client?.stop();
  host.client = null;
  host.connected = false;
  detachThemeListener(host as unknown as Parameters<typeof detachThemeListener>[0]);
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
}

export function handleUpdated(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  if (changed.has("alisioAccount") || changed.has("alisioBootstrap")) {
    void syncAccountPreferences(host as unknown as Parameters<typeof syncAccountPreferences>[0]);
  }
  if (changed.has("alisioAccount")) {
    void loadAssistantIdentity(host as unknown as Parameters<typeof loadAssistantIdentity>[0]);
  }
  if (host.tab === "chat" && host.chatManualRefreshInFlight) {
    return;
  }
  if (
    host.tab === "chat" &&
    (changed.has("chatMessages") ||
      changed.has("chatToolMessages") ||
      changed.has("chatStream") ||
      changed.has("chatLoading") ||
      changed.has("tab"))
  ) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    // Detect streaming start: chatStream changed from null/undefined to a string value
    const previousStream = changed.get("chatStream") as string | null | undefined;
    const streamJustStarted =
      changed.has("chatStream") &&
      (previousStream === null || previousStream === undefined) &&
      typeof host.chatStream === "string";
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      forcedByTab || forcedByLoad || streamJustStarted || !host.chatHasAutoScrolled,
    );
  }
  if (
    host.tab === "settings" &&
    host.settingsSection === "logs" &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("tab"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      scheduleLogsScroll(
        host as unknown as Parameters<typeof scheduleLogsScroll>[0],
        changed.has("tab") || changed.has("logsAutoFollow"),
      );
    }
  }
}
