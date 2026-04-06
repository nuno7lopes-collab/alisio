export const ALISIO_REMOTE_PROVIDER_ID = "alisio-remote";
export const ALISIO_DYNAMIC_PROVIDER_PREFIX = "alisio-";

function normalizeProviderToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildAlisioCurrentProviderId(): string {
  return `${ALISIO_DYNAMIC_PROVIDER_PREFIX}local-current`;
}

export function buildAlisioTargetProviderId(params: {
  targetId: string;
  runtimeKind: "llama.cpp" | "openai-compatible";
}): string {
  const target = normalizeProviderToken(params.targetId) || "target";
  const suffix = params.runtimeKind === "openai-compatible" ? "openai" : "llama";
  return `${ALISIO_DYNAMIC_PROVIDER_PREFIX}target-${target}-${suffix}`;
}

export function buildAlisioServerProviderId(serverId: string): string {
  const normalized = normalizeProviderToken(serverId) || "server";
  return `${ALISIO_DYNAMIC_PROVIDER_PREFIX}server-${normalized}`;
}

export function isAlisioDynamicProvider(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return (
    normalized.startsWith(ALISIO_DYNAMIC_PROVIDER_PREFIX) &&
    normalized !== ALISIO_REMOTE_PROVIDER_ID
  );
}

export function isAlisioManagedProvider(providerId: string): boolean {
  return providerId.trim().toLowerCase().startsWith(ALISIO_DYNAMIC_PROVIDER_PREFIX);
}
