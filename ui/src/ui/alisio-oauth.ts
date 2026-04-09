import {
  ALISIO_OPENAI_OAUTH_CHANNEL,
  ALISIO_OPENAI_OAUTH_STORAGE_KEY,
  buildAlisioOpenAiOAuthSignal,
  isAlisioOpenAiOAuthSignal,
  type AlisioOpenAiOAuthSignal,
} from "../../../src/shared/alisio-openai-oauth.js";
import { connectGateway } from "./app-gateway.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";

type OpenAiOAuthReconnectHost = Parameters<typeof loadControlUiBootstrapConfig>[0] &
  Parameters<typeof connectGateway>[0];

type OpenAiOAuthSignalHandler = (signal: AlisioOpenAiOAuthSignal) => void;

function parseOpenAiOAuthSignal(raw: unknown): AlisioOpenAiOAuthSignal | null {
  if (isAlisioOpenAiOAuthSignal(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isAlisioOpenAiOAuthSignal(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function emitAlisioOpenAiOAuthSignal(
  signal = buildAlisioOpenAiOAuthSignal(),
): AlisioOpenAiOAuthSignal {
  if (typeof window === "undefined") {
    return signal;
  }

  const serialized = JSON.stringify(signal);
  try {
    window.localStorage.setItem(ALISIO_OPENAI_OAUTH_STORAGE_KEY, serialized);
    window.localStorage.removeItem(ALISIO_OPENAI_OAUTH_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the BroadcastChannel fallback still covers modern browsers.
  }

  try {
    if (typeof window.BroadcastChannel === "function") {
      const channel = new BroadcastChannel(ALISIO_OPENAI_OAUTH_CHANNEL);
      channel.postMessage(signal);
      channel.close();
    }
  } catch {
    // Ignore broadcast failures; the storage event fallback still covers the same-origin tabs.
  }

  return signal;
}

export function subscribeAlisioOpenAiOAuthSignals(onSignal: OpenAiOAuthSignalHandler): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  let lastSignalId: string | null = null;
  const handleSignal = (raw: unknown) => {
    const signal = parseOpenAiOAuthSignal(raw);
    if (!signal || signal.signalId === lastSignalId) {
      return;
    }
    lastSignalId = signal.signalId;
    onSignal(signal);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== ALISIO_OPENAI_OAUTH_STORAGE_KEY) {
      return;
    }
    if (!event.newValue) {
      return;
    }
    handleSignal(event.newValue);
  };

  const channel =
    typeof window.BroadcastChannel === "function"
      ? new BroadcastChannel(ALISIO_OPENAI_OAUTH_CHANNEL)
      : null;
  const handleMessage = (event: MessageEvent<unknown>) => {
    handleSignal(event.data);
  };

  window.addEventListener("storage", handleStorage);
  channel?.addEventListener("message", handleMessage as EventListener);
  try {
    handleSignal(window.localStorage.getItem(ALISIO_OPENAI_OAUTH_STORAGE_KEY));
  } catch {
    // Ignore storage access failures.
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.removeEventListener("message", handleMessage as EventListener);
    channel?.close();
  };
}

export async function refreshAfterAlisioOpenAiOAuth(host: OpenAiOAuthReconnectHost): Promise<void> {
  await loadControlUiBootstrapConfig(host);
  connectGateway(host);
}
