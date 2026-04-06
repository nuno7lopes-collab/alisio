import {
  ALISIO_ACCOUNT_AUTH_CHANNEL,
  ALISIO_ACCOUNT_AUTH_STORAGE_KEY,
  LEGACY_ALISIO_ACCOUNT_AUTH_CHANNEL,
  LEGACY_ALISIO_ACCOUNT_AUTH_STORAGE_KEY,
  buildAlisioAccountAuthSignal,
  isAlisioAccountAuthSignal,
  type AlisioAccountAuthSignal,
} from "../../../src/shared/alisio-account-auth.js";
import { connectGateway } from "./app-gateway.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";

type AccountAuthReconnectHost = Parameters<typeof loadControlUiBootstrapConfig>[0] &
  Parameters<typeof connectGateway>[0];

type AccountAuthSignalHandler = (signal: AlisioAccountAuthSignal) => void;

function parseAccountAuthSignal(raw: unknown): AlisioAccountAuthSignal | null {
  if (isAlisioAccountAuthSignal(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isAlisioAccountAuthSignal(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function emitAlisioAccountAuthSignal(
  signal = buildAlisioAccountAuthSignal("email"),
): AlisioAccountAuthSignal {
  if (typeof window === "undefined") {
    return signal;
  }

  const serialized = JSON.stringify(signal);
  try {
    window.localStorage.setItem(ALISIO_ACCOUNT_AUTH_STORAGE_KEY, serialized);
    window.localStorage.removeItem(ALISIO_ACCOUNT_AUTH_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_ALISIO_ACCOUNT_AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage failures; BroadcastChannel still covers modern clients.
  }

  try {
    if (typeof window.BroadcastChannel === "function") {
      const channel = new BroadcastChannel(ALISIO_ACCOUNT_AUTH_CHANNEL);
      channel.postMessage(signal);
      channel.close();
      const legacyChannel = new BroadcastChannel(LEGACY_ALISIO_ACCOUNT_AUTH_CHANNEL);
      legacyChannel.postMessage(signal);
      legacyChannel.close();
    }
  } catch {
    // Ignore broadcast failures; storage events cover same-origin tabs.
  }

  return signal;
}

export function subscribeAlisioAccountAuthSignals(onSignal: AccountAuthSignalHandler): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  let lastSignalId: string | null = null;
  const handleSignal = (raw: unknown) => {
    const signal = parseAccountAuthSignal(raw);
    if (!signal || signal.signalId === lastSignalId) {
      return;
    }
    lastSignalId = signal.signalId;
    onSignal(signal);
  };

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== ALISIO_ACCOUNT_AUTH_STORAGE_KEY &&
      event.key !== LEGACY_ALISIO_ACCOUNT_AUTH_STORAGE_KEY
    ) {
      return;
    }
    if (!event.newValue) {
      return;
    }
    handleSignal(event.newValue);
  };

  const channel =
    typeof window.BroadcastChannel === "function"
      ? new BroadcastChannel(ALISIO_ACCOUNT_AUTH_CHANNEL)
      : null;
  const legacyChannel =
    typeof window.BroadcastChannel === "function"
      ? new BroadcastChannel(LEGACY_ALISIO_ACCOUNT_AUTH_CHANNEL)
      : null;
  const handleMessage = (event: MessageEvent<unknown>) => {
    handleSignal(event.data);
  };

  window.addEventListener("storage", handleStorage);
  channel?.addEventListener("message", handleMessage as EventListener);
  legacyChannel?.addEventListener("message", handleMessage as EventListener);
  try {
    handleSignal(window.localStorage.getItem(ALISIO_ACCOUNT_AUTH_STORAGE_KEY));
    handleSignal(window.localStorage.getItem(LEGACY_ALISIO_ACCOUNT_AUTH_STORAGE_KEY));
  } catch {
    // Ignore storage access failures.
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.removeEventListener("message", handleMessage as EventListener);
    legacyChannel?.removeEventListener("message", handleMessage as EventListener);
    channel?.close();
    legacyChannel?.close();
  };
}

export async function refreshAfterAlisioAccountAuth(host: AccountAuthReconnectHost): Promise<void> {
  await loadControlUiBootstrapConfig(host);
  connectGateway(host);
}
