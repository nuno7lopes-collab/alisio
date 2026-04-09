export type OpenAiCompatibleEndpointPath = "models" | "chat/completions";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function buildOpenAiCompatibleEndpointUrls(
  baseUrl: string,
  endpoint: OpenAiCompatibleEndpointPath,
): string[] {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return [];
  }
  if (normalized.toLowerCase().endsWith("/v1")) {
    return [`${normalized}/${endpoint}`];
  }
  return [`${normalized}/v1/${endpoint}`, `${normalized}/${endpoint}`];
}

function isRetryableEndpointStatus(status: number) {
  return status === 404 || status === 405 || status === 501;
}

export async function fetchModelRuntimeEndpoint(params: {
  baseUrl: string;
  endpoint: OpenAiCompatibleEndpointPath;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const urls = buildOpenAiCompatibleEndpointUrls(params.baseUrl, params.endpoint);
  if (urls.length === 0) {
    throw new Error("OpenAI-compatible base URL is required");
  }

  let lastResponse: Response | null = null;
  for (const [index, url] of urls.entries()) {
    const response = await fetchImpl(url, params.init);
    lastResponse = response;
    if (response.ok || index === urls.length - 1 || !isRetryableEndpointStatus(response.status)) {
      return response;
    }
    await response.body?.cancel().catch(() => undefined);
  }

  if (!lastResponse) {
    throw new Error("OpenAI-compatible endpoint request did not return a response");
  }
  return lastResponse;
}
