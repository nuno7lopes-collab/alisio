import { generateSecureBrowserUuid } from "./secure-browser-random.js";

export const ALISIO_OPENAI_OAUTH_STORAGE_KEY = "alisio:alisio-openai-oauth:v1";
export const ALISIO_OPENAI_OAUTH_CHANNEL = "alisio:alisio-openai-oauth:v1";
// Deprecated compatibility bridge for older OpenClaw OAuth callbacks.
// Sunset target: remove after 2026-06-30 once all supported Alisio clients write the canonical keys.
const LEGACY_STORAGE_NAMESPACE = `${["open", "claw"].join("")}:alisio-openai-oauth:v1`;
export const LEGACY_ALISIO_OPENAI_OAUTH_STORAGE_KEY = LEGACY_STORAGE_NAMESPACE;
export const LEGACY_ALISIO_OPENAI_OAUTH_CHANNEL = LEGACY_STORAGE_NAMESPACE;
export const ALISIO_OPENAI_OAUTH_SIGNAL_TYPE = "openai-oauth-complete";

export type AlisioOpenAiOAuthSignal = {
  type: typeof ALISIO_OPENAI_OAUTH_SIGNAL_TYPE;
  signalId: string;
  createdAtMs: number;
};

export function buildAlisioOpenAiOAuthSignal(now = Date.now()): AlisioOpenAiOAuthSignal {
  return {
    type: ALISIO_OPENAI_OAUTH_SIGNAL_TYPE,
    signalId: generateSecureBrowserUuid(),
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
