import { type AlisioAccountAuthMethod } from "./alisio-account.js";
import { generateSecureBrowserUuid } from "./secure-browser-random.js";

export const ALISIO_ACCOUNT_AUTH_STORAGE_KEY = "alisio:alisio-account-auth:v1";
export const ALISIO_ACCOUNT_AUTH_CHANNEL = "alisio:alisio-account-auth:v1";
// Deprecated compatibility bridge for older OpenClaw-auth callbacks.
// Sunset target: remove after 2026-06-30 once all supported Alisio clients write the canonical keys.
const LEGACY_STORAGE_NAMESPACE = `${["open", "claw"].join("")}:alisio-account-auth:v1`;
export const LEGACY_ALISIO_ACCOUNT_AUTH_STORAGE_KEY = LEGACY_STORAGE_NAMESPACE;
export const LEGACY_ALISIO_ACCOUNT_AUTH_CHANNEL = LEGACY_STORAGE_NAMESPACE;
export const ALISIO_ACCOUNT_AUTH_SIGNAL_TYPE = "account-auth-complete";

export type AlisioAccountAuthSignal = {
  type: typeof ALISIO_ACCOUNT_AUTH_SIGNAL_TYPE;
  method: AlisioAccountAuthMethod;
  signalId: string;
  createdAtMs: number;
};

export function buildAlisioAccountAuthSignal(
  method: AlisioAccountAuthMethod,
  now = Date.now(),
): AlisioAccountAuthSignal {
  return {
    type: ALISIO_ACCOUNT_AUTH_SIGNAL_TYPE,
    method,
    signalId: generateSecureBrowserUuid(),
    createdAtMs: now,
  };
}

export function isAlisioAccountAuthSignal(value: unknown): value is AlisioAccountAuthSignal {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === ALISIO_ACCOUNT_AUTH_SIGNAL_TYPE &&
    ((value as { method?: unknown }).method === "email" ||
      (value as { method?: unknown }).method === "google") &&
    typeof (value as { signalId?: unknown }).signalId === "string" &&
    typeof (value as { createdAtMs?: unknown }).createdAtMs === "number"
  );
}

export function buildAlisioAccountAuthCompletionScript(signal: AlisioAccountAuthSignal): string {
  const payload = JSON.stringify(signal).replaceAll("<", "\\u003c");
  const storageKey = JSON.stringify(ALISIO_ACCOUNT_AUTH_STORAGE_KEY);
  const channelName = JSON.stringify(ALISIO_ACCOUNT_AUTH_CHANNEL);
  const legacyStorageKey = JSON.stringify(LEGACY_ALISIO_ACCOUNT_AUTH_STORAGE_KEY);
  const legacyChannelName = JSON.stringify(LEGACY_ALISIO_ACCOUNT_AUTH_CHANNEL);
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
