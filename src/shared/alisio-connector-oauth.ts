export const ALISIO_CONNECTOR_OAUTH_STORAGE_KEY = "alisio:alisio-connector-oauth:v1";
export const ALISIO_CONNECTOR_OAUTH_CHANNEL = "alisio:alisio-connector-oauth:v1";
export const LEGACY_ALISIO_CONNECTOR_OAUTH_STORAGE_KEY = "openclaw:alisio-connector-oauth:v1";
export const LEGACY_ALISIO_CONNECTOR_OAUTH_CHANNEL = "openclaw:alisio-connector-oauth:v1";
export const ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY =
  "alisio:alisio-connector-oauth:return-to:v1";
export const LEGACY_ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY =
  "openclaw:alisio-connector-oauth:return-to:v1";
export const ALISIO_CONNECTOR_OAUTH_SIGNAL_TYPE = "connector-oauth-complete";

export type AlisioConnectorOAuthProvider = "google" | "github";

export type AlisioConnectorOAuthSignal = {
  type: typeof ALISIO_CONNECTOR_OAUTH_SIGNAL_TYPE;
  connectorId: string;
  provider: AlisioConnectorOAuthProvider;
  signalId: string;
  createdAtMs: number;
};

function buildFallbackSignalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildAlisioConnectorOAuthSignal(
  input: {
    connectorId: string;
    provider: AlisioConnectorOAuthProvider;
  },
  now = Date.now(),
): AlisioConnectorOAuthSignal {
  const signalId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : buildFallbackSignalId();
  return {
    type: ALISIO_CONNECTOR_OAUTH_SIGNAL_TYPE,
    connectorId: input.connectorId,
    provider: input.provider,
    signalId,
    createdAtMs: now,
  };
}

export function isAlisioConnectorOAuthSignal(value: unknown): value is AlisioConnectorOAuthSignal {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === ALISIO_CONNECTOR_OAUTH_SIGNAL_TYPE &&
    typeof (value as { connectorId?: unknown }).connectorId === "string" &&
    typeof (value as { provider?: unknown }).provider === "string" &&
    ((value as { provider?: unknown }).provider === "google" ||
      (value as { provider?: unknown }).provider === "github") &&
    typeof (value as { signalId?: unknown }).signalId === "string" &&
    typeof (value as { createdAtMs?: unknown }).createdAtMs === "number"
  );
}

export function buildAlisioConnectorOAuthCompletionScript(
  signal: AlisioConnectorOAuthSignal,
): string {
  const payload = JSON.stringify(signal).replaceAll("<", "\\u003c");
  const storageKey = JSON.stringify(ALISIO_CONNECTOR_OAUTH_STORAGE_KEY);
  const channelName = JSON.stringify(ALISIO_CONNECTOR_OAUTH_CHANNEL);
  const legacyStorageKey = JSON.stringify(LEGACY_ALISIO_CONNECTOR_OAUTH_STORAGE_KEY);
  const legacyChannelName = JSON.stringify(LEGACY_ALISIO_CONNECTOR_OAUTH_CHANNEL);
  const returnToStorageKey = JSON.stringify(ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY);
  const legacyReturnToStorageKey = JSON.stringify(
    LEGACY_ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY,
  );
  return [
    "(function(){",
    `var payload=${payload};`,
    `var storageKey=${storageKey};`,
    `var channelName=${channelName};`,
    `var legacyStorageKey=${legacyStorageKey};`,
    `var legacyChannelName=${legacyChannelName};`,
    `var returnToStorageKey=${returnToStorageKey};`,
    `var legacyReturnToStorageKey=${legacyReturnToStorageKey};`,
    "try{var serialized=JSON.stringify(payload);localStorage.setItem(storageKey, serialized);localStorage.setItem(legacyStorageKey, serialized);}catch(_error){}",
    "try{if(typeof BroadcastChannel==='function'){var channel=new BroadcastChannel(channelName);channel.postMessage(payload);channel.close();var legacyChannel=new BroadcastChannel(legacyChannelName);legacyChannel.postMessage(payload);legacyChannel.close();}}catch(_error){}",
    "var returnToUrl=null;",
    "try{var returnToKeys=[returnToStorageKey,legacyReturnToStorageKey];for(var i=0;i<returnToKeys.length;i++){var candidate=localStorage.getItem(returnToKeys[i]);if(!candidate){continue;}try{var parsed=new URL(candidate, window.location.href);var protocol=parsed.protocol.toLowerCase();if((protocol==='http:'||protocol==='https:')&&parsed.origin===window.location.origin){returnToUrl=parsed.toString();break;}}catch(_error){}}for(var j=0;j<returnToKeys.length;j++){localStorage.removeItem(returnToKeys[j]);}}catch(_error){}",
    "try{setTimeout(function(){try{window.close();}catch(_error){}setTimeout(function(){if(returnToUrl&&window.closed!==true){try{window.location.replace(returnToUrl);return;}catch(_error2){try{window.location.href=returnToUrl;return;}catch(_error3){}}}},80);},120);}catch(_error){try{window.close();}catch(_error2){}}",
    "})();",
  ].join("");
}
