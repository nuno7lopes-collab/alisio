export const ALISIO_OPENAI_OAUTH_STORAGE_KEY = "alisio:alisio-openai-oauth:v1";
export const ALISIO_OPENAI_OAUTH_CHANNEL = "alisio:alisio-openai-oauth:v1";
export const LEGACY_ALISIO_OPENAI_OAUTH_STORAGE_KEY = "openclaw:alisio-openai-oauth:v1";
export const LEGACY_ALISIO_OPENAI_OAUTH_CHANNEL = "openclaw:alisio-openai-oauth:v1";
export const ALISIO_OPENAI_OAUTH_SIGNAL_TYPE = "openai-oauth-complete";

export type AlisioOpenAiOAuthSignal = {
  type: typeof ALISIO_OPENAI_OAUTH_SIGNAL_TYPE;
  signalId: string;
  createdAtMs: number;
};

function buildFallbackSignalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildAlisioOpenAiOAuthSignal(now = Date.now()): AlisioOpenAiOAuthSignal {
  const signalId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : buildFallbackSignalId();
  return {
    type: ALISIO_OPENAI_OAUTH_SIGNAL_TYPE,
    signalId,
    createdAtMs: now,
  };
}

export function isAlisioOpenAiOAuthSignal(value: unknown): value is AlisioOpenAiOAuthSignal {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === ALISIO_OPENAI_OAUTH_SIGNAL_TYPE &&
    typeof (value as { signalId?: unknown }).signalId === "string" &&
    typeof (value as { createdAtMs?: unknown }).createdAtMs === "number"
  );
}

export function buildAlisioOpenAiOAuthCompletionScript(signal: AlisioOpenAiOAuthSignal): string {
  const payload = JSON.stringify(signal).replaceAll("<", "\\u003c");
  const storageKey = JSON.stringify(ALISIO_OPENAI_OAUTH_STORAGE_KEY);
  const channelName = JSON.stringify(ALISIO_OPENAI_OAUTH_CHANNEL);
  const legacyStorageKey = JSON.stringify(LEGACY_ALISIO_OPENAI_OAUTH_STORAGE_KEY);
  const legacyChannelName = JSON.stringify(LEGACY_ALISIO_OPENAI_OAUTH_CHANNEL);
  return [
    "(function(){",
    `var payload=${payload};`,
    `var storageKey=${storageKey};`,
    `var channelName=${channelName};`,
    `var legacyStorageKey=${legacyStorageKey};`,
    `var legacyChannelName=${legacyChannelName};`,
    "try{var serialized=JSON.stringify(payload);localStorage.setItem(storageKey, serialized);localStorage.setItem(legacyStorageKey, serialized);}catch(_error){}",
    "try{if(typeof BroadcastChannel==='function'){var channel=new BroadcastChannel(channelName);channel.postMessage(payload);channel.close();var legacyChannel=new BroadcastChannel(legacyChannelName);legacyChannel.postMessage(payload);legacyChannel.close();}}catch(_error){}",
    "try{setTimeout(function(){window.close();},120);}catch(_error){try{window.close();}catch(_error2){}}",
    "})();",
  ].join("");
}
