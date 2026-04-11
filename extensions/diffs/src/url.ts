import { resolveGatewayPort, type AlisioConfig } from "../api.js";

export function buildViewerUrl(params: {
  config: AlisioConfig;
  viewerPath: string;
  baseUrl?: string;
}): string {
  const baseUrl = params.baseUrl?.trim() || resolveGatewayBaseUrl(params.config);
  const normalizedBase = normalizeViewerBaseUrl(baseUrl);
  const viewerPath = params.viewerPath.startsWith("/")
    ? params.viewerPath
    : `/${params.viewerPath}`;
  const parsedBase = new URL(normalizedBase);
  const basePath = parsedBase.pathname === "/" ? "" : parsedBase.pathname.replace(/\/+$/, "");
  parsedBase.pathname = `${basePath}${viewerPath}`;
  parsedBase.search = "";
  parsedBase.hash = "";
  return parsedBase.toString();
}

export function normalizeViewerBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid baseUrl: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`baseUrl must use http or https: ${raw}`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`baseUrl must not include query/hash: ${raw}`);
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  const withoutTrailingSlash = parsed.toString().replace(/\/+$/, "");
  return withoutTrailingSlash;
}

function resolveGatewayBaseUrl(config: AlisioConfig): string {
  const scheme = config.gateway?.tls?.enabled ? "https" : "http";
  const port = resolveGatewayPort(config, process.env);
  const customHost = config.gateway?.customBindHost?.trim();

  if (config.gateway?.bind === "custom" && customHost) {
    return `${scheme}://${customHost}:${port}`;
  }

  // Viewer links are used by local canvas/clients; default to loopback to avoid
  // container/bridge interfaces that are often unreachable from the caller.
  return `${scheme}://127.0.0.1:${port}`;
}
