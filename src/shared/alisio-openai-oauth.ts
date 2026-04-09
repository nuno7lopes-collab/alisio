import { generateSecureBrowserUuid } from "./secure-browser-random.js";

export const ALISIO_OPENAI_OAUTH_STORAGE_KEY = "alisio:alisio-openai-oauth:v1";
export const ALISIO_OPENAI_OAUTH_CHANNEL = "alisio:alisio-openai-oauth:v1";
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
  return [
    "(function(){",
    `var payload=${payload};`,
    `var storageKey=${storageKey};`,
    `var channelName=${channelName};`,
    "try{var serialized=JSON.stringify(payload);localStorage.setItem(storageKey, serialized);}catch(_error){}",
    "try{if(typeof BroadcastChannel==='function'){var channel=new BroadcastChannel(channelName);channel.postMessage(payload);channel.close();}}catch(_error){}",
    "try{setTimeout(function(){window.close();},120);}catch(_error){try{window.close();}catch(_error2){}}",
    "})();",
  ].join("");
}
