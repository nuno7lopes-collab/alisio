export const ALISIO_DYNAMIC_PROVIDER_PREFIX = "alisio-";

function normalizeProviderToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildAlisioCurrentProviderId(): string {
  return `${ALISIO_DYNAMIC_PROVIDER_PREFIX}local-current-llama`;
}

export function buildAlisioTargetProviderId(params: {
  targetId: string;
  runtimeKind?: "llama.cpp" | "ollama" | "lmstudio" | "openai-compatible";
}): string {
  const target = normalizeProviderToken(params.targetId) || "target";
  return `${ALISIO_DYNAMIC_PROVIDER_PREFIX}target-${target}-llama`;
}

export function isAlisioDynamicProvider(providerId: string): boolean {
  return providerId.trim().toLowerCase().startsWith(ALISIO_DYNAMIC_PROVIDER_PREFIX);
}

export function isAlisioManagedProvider(providerId: string): boolean {
  return providerId.trim().toLowerCase().startsWith(ALISIO_DYNAMIC_PROVIDER_PREFIX);
}
