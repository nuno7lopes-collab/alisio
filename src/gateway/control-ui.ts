import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveAgentAvatar } from "../agents/identity-avatar.js";
import type { AlisioConfig } from "../config/config.js";
import { DEFAULT_GATEWAY_PORT } from "../config/paths.js";
import { type AlisioRuntimeSetupState } from "../infra/alisio-runtime.js";
import {
  hasRestorableAlisioAccount,
  loadStoredAlisioBootstrapState,
} from "../infra/alisio-store.js";
import { matchBoundaryFileOpenFailure, openBoundaryFileSync } from "../infra/boundary-file-read.js";
import {
  isPackageProvenControlUiRootSync,
  resolveControlUiRootSync,
} from "../infra/control-ui-assets.js";
import { resolveCurrentDeviceMetadata } from "../infra/current-device-metadata.js";
import { issueDeviceBootstrapToken } from "../infra/device-bootstrap.js";
import {
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "../infra/device-identity.js";
import { isWithinDir } from "../infra/path-safety.js";
import { openVerifiedFileSync } from "../infra/safe-open-sync.js";
import { AVATAR_MAX_BYTES } from "../shared/avatar-policy.js";
import { CONTROL_UI_LOCAL_BOOTSTRAP_PROFILE } from "../shared/device-bootstrap-profile.js";
import { resolveRuntimeServiceVersion } from "../version.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";
import {
  ALISIO_BOOTSTRAP_HTTP_PATH,
  CONTROL_UI_DEVICE_IDENTITY_PATH,
  CONTROL_UI_DEVICE_SIGN_PATH,
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  type AlisioHttpBootstrap,
  type ControlUiLocalDeviceIdentity,
  type ControlUiLocalDeviceSignRequest,
  type ControlUiLocalDeviceSignResponse,
  type ControlUiBootstrapConfig,
} from "./control-ui-contract.js";
import { buildControlUiCspHeader, computeInlineScriptHashes } from "./control-ui-csp.js";
import {
  isReadHttpMethod,
  respondNotFound as respondControlUiNotFound,
  respondPlainText,
} from "./control-ui-http-utils.js";
import { classifyControlUiRequest } from "./control-ui-routing.js";
import {
  buildControlUiAvatarUrl,
  CONTROL_UI_AVATAR_PREFIX,
  normalizeControlUiBasePath,
  resolveAssistantAvatarUrl,
} from "./control-ui-shared.js";
import { isLoopbackAddress, isLoopbackHost, resolveHostName } from "./net.js";

const ROOT_PREFIX = "/";
const MAX_LOCAL_DEVICE_SIGN_BODY_BYTES = 16 * 1024;
const CONTROL_UI_ASSETS_MISSING_MESSAGE =
  "Control UI assets not found. Build them with `pnpm ui:build` (auto-installs UI deps), or run `pnpm ui:dev` during development.";
export type ControlUiRequestOptions = {
  basePath?: string;
  config?: AlisioConfig;
  agentId?: string;
  root?: ControlUiRootState;
};

export type ControlUiRootState =
  | { kind: "bundled"; path: string }
  | { kind: "resolved"; path: string }
  | { kind: "invalid"; path: string }
  | { kind: "missing" };

export type AlisioBootstrapHttpRequestOptions = {
  basePath?: string;
  trustedProxies: string[];
  allowRealIpFallback: boolean;
  loadRuntimeSetup: () => Promise<Pick<AlisioRuntimeSetupState, "providerReady" | "models">>;
};

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function resolveBootstrapAssistantAvatar(params: {
  config?: AlisioConfig;
  identity: {
    agentId: string;
    avatar: string;
  };
  basePath?: string;
}): string {
  const basePath = normalizeControlUiBasePath(params.basePath);
  const config = params.config;
  if (config) {
    const resolved = resolveAgentAvatar(config, params.identity.agentId, {
      includeUiAssistant: params.identity.agentId === resolveDefaultAgentId(config),
    });
    if (resolved.kind === "local") {
      return buildControlUiAvatarUrl(basePath, params.identity.agentId);
    }
    if (resolved.kind === "remote" || resolved.kind === "data") {
      return resolved.url;
    }
  }
  return (
    resolveAssistantAvatarUrl({
      avatar: params.identity.avatar,
      agentId: params.identity.agentId,
      basePath,
    }) ?? params.identity.avatar
  );
}

/**
 * Extensions recognised as static assets.  Missing files with these extensions
 * return 404 instead of the SPA index.html fallback.  `.html` is intentionally
 * excluded — actual HTML files on disk are served earlier, and missing `.html`
 * paths should fall through to the SPA router (client-side routers may use
 * `.html`-suffixed routes).
 */
const STATIC_ASSET_EXTENSIONS = new Set([
  ".js",
  ".css",
  ".json",
  ".map",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".txt",
]);

export type ControlUiAvatarResolution =
  | { kind: "none"; reason: string }
  | { kind: "local"; filePath: string }
  | { kind: "remote"; url: string }
  | { kind: "data"; url: string };

type ControlUiAvatarMeta = {
  avatarUrl: string | null;
};

function applyControlUiSecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", buildControlUiCspHeader());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // The Control UI supports browser-native speech input. Override the global
  // gateway baseline so gateway-served chat pages can request microphone access.
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(JSON.stringify(body));
}

function resolveScopedControlUiPath(basePath: string, routePath: string) {
  return basePath ? `${basePath}${routePath}` : routePath;
}

function isLoopbackControlUiDeviceRequest(req: IncomingMessage) {
  const remoteAddress = req.socket?.remoteAddress?.trim();
  if (!isLoopbackAddress(remoteAddress)) {
    return false;
  }
  const hostName = resolveHostName(req.headers.host);
  if (!hostName) {
    return true;
  }
  return isLoopbackHost(hostName);
}

function readRequestText(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    const cleanup = () => {
      req.off("data", handleData);
      req.off("end", handleEnd);
      req.off("error", handleError);
    };

    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const handleError = (error: Error) => {
      settleReject(error);
    };

    const handleEnd = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };

    const handleData = (chunk: string | Buffer) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        const error = new Error("request body too large");
        error.name = "PayloadTooLargeError";
        settleReject(error);
        return;
      }
      chunks.push(buffer);
    };

    req.on("data", handleData);
    req.on("end", handleEnd);
    req.on("error", handleError);
  });
}

function resolveHttpOrigin(req: IncomingMessage): string {
  const defaultHost = `127.0.0.1:${DEFAULT_GATEWAY_PORT}`;
  const host = String(req.headers.host ?? defaultHost).trim() || defaultHost;
  const socket = req.socket as { encrypted?: boolean } | undefined;
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProto === "https" || forwardedProto === "wss"
      ? "https"
      : socket?.encrypted
        ? "https"
        : "http";
  return `${protocol}://${host}`;
}

function resolveWebSocketUrl(req: IncomingMessage, basePath: string): string {
  const origin = new URL(resolveHttpOrigin(req));
  origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  origin.pathname = basePath || "/";
  origin.search = "";
  origin.hash = "";
  return origin.toString();
}

export async function handleAlisioBootstrapHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AlisioBootstrapHttpRequestOptions,
): Promise<boolean> {
  const urlRaw = req.url;
  if (!urlRaw || !isReadHttpMethod(req.method)) {
    return false;
  }

  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts.basePath);
  const bootstrapPath = basePath
    ? `${basePath}${ALISIO_BOOTSTRAP_HTTP_PATH}`
    : ALISIO_BOOTSTRAP_HTTP_PATH;
  if (url.pathname !== bootstrapPath) {
    return false;
  }

  applyControlUiSecurityHeaders(res);
  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end();
    return true;
  }

  const runtimeSetup = await opts.loadRuntimeSetup();
  const { snapshot, summary } = await loadStoredAlisioBootstrapState({
    wizardRunning: false,
    providerReady: runtimeSetup.providerReady,
    connectionRequired: false,
  });
  const account = snapshot.account;
  const ai = snapshot.ai;
  const body: AlisioHttpBootstrap = {
    basePath,
    controlUrl: resolveWebSocketUrl(req, basePath),
    connectionRequired: summary.connectionRequired,
    startupState: summary.startupState,
    providerReady: summary.providerReady,
    accountReady: summary.accountReady,
    nextStep: summary.nextStep,
    account: hasRestorableAlisioAccount(account.profile, account.session)
      ? {
          username: account.profile.username,
          displayName: account.profile.displayName,
          email: account.profile.email,
          ...(account.profile.agentName ? { agentName: account.profile.agentName } : {}),
          avatarLabel: account.profile.avatarLabel,
          ...(account.profile.avatarUrl ? { avatarUrl: account.profile.avatarUrl } : {}),
          plan: account.profile.plan,
        }
      : null,
    accountCloud: account.cloud,
    ai,
    bootstrapToken: (
      await issueDeviceBootstrapToken({
        profile: CONTROL_UI_LOCAL_BOOTSTRAP_PROFILE,
      })
    ).token,
  };
  sendJson(res, 200, body);
  return true;
}

export async function handleControlUiLocalDeviceRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts?: Pick<ControlUiRequestOptions, "basePath">,
): Promise<boolean> {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts?.basePath);
  const identityPath = resolveScopedControlUiPath(basePath, CONTROL_UI_DEVICE_IDENTITY_PATH);
  const signPath = resolveScopedControlUiPath(basePath, CONTROL_UI_DEVICE_SIGN_PATH);
  const pathname = url.pathname;

  if (pathname !== identityPath && pathname !== signPath) {
    return false;
  }

  applyControlUiSecurityHeaders(res);
  if (!isLoopbackControlUiDeviceRequest(req)) {
    respondControlUiNotFound(res);
    return true;
  }

  const identity = loadOrCreateDeviceIdentity();
  if (pathname === identityPath) {
    if (!isReadHttpMethod(req.method)) {
      respondControlUiNotFound(res);
      return true;
    }
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.end();
      return true;
    }
    const deviceMetadata = resolveCurrentDeviceMetadata();
    sendJson(res, 200, {
      deviceId: identity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
      platform: deviceMetadata.platform,
      deviceFamily: deviceMetadata.deviceFamily,
    } satisfies ControlUiLocalDeviceIdentity);
    return true;
  }

  if (req.method !== "POST") {
    respondControlUiNotFound(res);
    return true;
  }

  let bodyText = "";
  try {
    bodyText = await readRequestText(req, MAX_LOCAL_DEVICE_SIGN_BODY_BYTES);
  } catch (error) {
    respondPlainText(
      res,
      error instanceof Error && error.name === "PayloadTooLargeError" ? 413 : 400,
      "Invalid device signing request.",
    );
    return true;
  }

  let body: ControlUiLocalDeviceSignRequest;
  try {
    body = JSON.parse(bodyText) as ControlUiLocalDeviceSignRequest;
  } catch {
    respondPlainText(res, 400, "Invalid device signing request.");
    return true;
  }

  if (typeof body.payload !== "string") {
    respondPlainText(res, 400, "Invalid device signing request.");
    return true;
  }

  sendJson(res, 200, {
    signature: signDevicePayload(identity.privateKeyPem, body.payload),
  } satisfies ControlUiLocalDeviceSignResponse);
  return true;
}

function respondControlUiAssetsUnavailable(
  res: ServerResponse,
  options?: { configuredRootPath?: string },
) {
  if (options?.configuredRootPath) {
    respondPlainText(
      res,
      503,
      `Control UI assets not found at ${options.configuredRootPath}. Build them with \`pnpm ui:build\` (auto-installs UI deps), or update gateway.controlUi.root.`,
    );
    return;
  }
  respondPlainText(res, 503, CONTROL_UI_ASSETS_MISSING_MESSAGE);
}

function respondHeadForFile(req: IncomingMessage, res: ServerResponse, filePath: string): boolean {
  if (req.method !== "HEAD") {
    return false;
  }
  res.statusCode = 200;
  setStaticFileHeaders(res, filePath);
  res.end();
  return true;
}

function isValidAgentId(agentId: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(agentId);
}

export function handleControlUiAvatarRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { basePath?: string; resolveAvatar: (agentId: string) => ControlUiAvatarResolution },
): boolean {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  if (!isReadHttpMethod(req.method)) {
    return false;
  }

  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts.basePath);
  const pathname = url.pathname;
  const pathWithBase = basePath
    ? `${basePath}${CONTROL_UI_AVATAR_PREFIX}/`
    : `${CONTROL_UI_AVATAR_PREFIX}/`;
  if (!pathname.startsWith(pathWithBase)) {
    return false;
  }

  applyControlUiSecurityHeaders(res);

  const agentIdParts = pathname.slice(pathWithBase.length).split("/").filter(Boolean);
  const agentId = agentIdParts[0] ?? "";
  if (agentIdParts.length !== 1 || !agentId || !isValidAgentId(agentId)) {
    respondControlUiNotFound(res);
    return true;
  }

  if (url.searchParams.get("meta") === "1") {
    const resolved = opts.resolveAvatar(agentId);
    const avatarUrl =
      resolved.kind === "local"
        ? buildControlUiAvatarUrl(basePath, agentId)
        : resolved.kind === "remote" || resolved.kind === "data"
          ? resolved.url
          : null;
    sendJson(res, 200, { avatarUrl } satisfies ControlUiAvatarMeta);
    return true;
  }

  const resolved = opts.resolveAvatar(agentId);
  if (resolved.kind !== "local") {
    respondControlUiNotFound(res);
    return true;
  }

  const safeAvatar = resolveSafeAvatarFile(resolved.filePath);
  if (!safeAvatar) {
    respondControlUiNotFound(res);
    return true;
  }
  try {
    if (respondHeadForFile(req, res, safeAvatar.path)) {
      return true;
    }

    serveResolvedFile(res, safeAvatar.path, fs.readFileSync(safeAvatar.fd));
    return true;
  } finally {
    fs.closeSync(safeAvatar.fd);
  }
}

function setStaticFileHeaders(res: ServerResponse, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", contentTypeForExt(ext));
  // Static UI should never be cached aggressively while iterating; allow the
  // browser to revalidate.
  res.setHeader("Cache-Control", "no-cache");
}

function serveResolvedFile(res: ServerResponse, filePath: string, body: Buffer) {
  setStaticFileHeaders(res, filePath);
  res.end(body);
}

function serveResolvedIndexHtml(res: ServerResponse, body: string) {
  const hashes = computeInlineScriptHashes(body);
  if (hashes.length > 0) {
    res.setHeader(
      "Content-Security-Policy",
      buildControlUiCspHeader({ inlineScriptHashes: hashes }),
    );
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(body);
}

function isExpectedSafePathError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

function resolveSafeAvatarFile(filePath: string): { path: string; fd: number } | null {
  const opened = openVerifiedFileSync({
    filePath,
    rejectPathSymlink: true,
    maxBytes: AVATAR_MAX_BYTES,
  });
  if (!opened.ok) {
    return null;
  }
  return { path: opened.path, fd: opened.fd };
}

function resolveSafeControlUiFile(
  rootReal: string,
  filePath: string,
  rejectHardlinks: boolean,
): { path: string; fd: number } | null {
  const opened = openBoundaryFileSync({
    absolutePath: filePath,
    rootPath: rootReal,
    rootRealPath: rootReal,
    boundaryLabel: "control ui root",
    skipLexicalRootCheck: true,
    rejectHardlinks,
  });
  if (!opened.ok) {
    return matchBoundaryFileOpenFailure(opened, {
      io: (failure) => {
        throw failure.error;
      },
      fallback: () => null,
    });
  }
  return { path: opened.path, fd: opened.fd };
}

function isSafeRelativePath(relPath: string) {
  if (!relPath) {
    return false;
  }
  const normalized = path.posix.normalize(relPath);
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    return false;
  }
  if (normalized.startsWith("../") || normalized === "..") {
    return false;
  }
  if (normalized.includes("\0")) {
    return false;
  }
  return true;
}

export function handleControlUiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts?: ControlUiRequestOptions,
): boolean {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts?.basePath);
  const pathname = url.pathname;
  const route = classifyControlUiRequest({
    basePath,
    pathname,
    search: url.search,
    method: req.method,
  });
  if (route.kind === "not-control-ui") {
    return false;
  }
  if (route.kind === "not-found") {
    applyControlUiSecurityHeaders(res);
    respondControlUiNotFound(res);
    return true;
  }
  if (route.kind === "redirect") {
    applyControlUiSecurityHeaders(res);
    res.statusCode = 302;
    res.setHeader("Location", route.location);
    res.end();
    return true;
  }

  applyControlUiSecurityHeaders(res);

  const bootstrapConfigPath = basePath
    ? `${basePath}${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`
    : CONTROL_UI_BOOTSTRAP_CONFIG_PATH;
  if (pathname === bootstrapConfigPath) {
    const config = opts?.config;
    const identity = config
      ? resolveAssistantIdentity({ cfg: config, agentId: opts?.agentId })
      : DEFAULT_ASSISTANT_IDENTITY;
    const avatarValue = resolveBootstrapAssistantAvatar({
      config,
      identity,
      basePath,
    });
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.end();
      return true;
    }
    sendJson(res, 200, {
      basePath,
      assistantName: identity.name,
      assistantAvatar: avatarValue,
      assistantAgentId: identity.agentId,
      serverVersion: resolveRuntimeServiceVersion(process.env),
    } satisfies ControlUiBootstrapConfig);
    return true;
  }

  const rootState = opts?.root;
  if (rootState?.kind === "invalid") {
    respondControlUiAssetsUnavailable(res, { configuredRootPath: rootState.path });
    return true;
  }
  if (rootState?.kind === "missing") {
    respondControlUiAssetsUnavailable(res);
    return true;
  }

  const root =
    rootState?.kind === "resolved" || rootState?.kind === "bundled"
      ? rootState.path
      : resolveControlUiRootSync({
          moduleUrl: import.meta.url,
          argv1: process.argv[1],
          cwd: process.cwd(),
        });
  if (!root) {
    respondControlUiAssetsUnavailable(res);
    return true;
  }

  const rootReal = (() => {
    try {
      return fs.realpathSync(root);
    } catch (error) {
      if (isExpectedSafePathError(error)) {
        return null;
      }
      throw error;
    }
  })();
  if (!rootReal) {
    respondControlUiAssetsUnavailable(res);
    return true;
  }

  const uiPath =
    basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
  const rel = (() => {
    if (uiPath === ROOT_PREFIX) {
      return "";
    }
    const assetsIndex = uiPath.indexOf("/assets/");
    if (assetsIndex >= 0) {
      return uiPath.slice(assetsIndex + 1);
    }
    return uiPath.slice(1);
  })();
  const requested = rel && !rel.endsWith("/") ? rel : `${rel}index.html`;
  const fileRel = requested || "index.html";
  if (!isSafeRelativePath(fileRel)) {
    respondControlUiNotFound(res);
    return true;
  }

  const filePath = path.resolve(root, fileRel);
  if (!isWithinDir(root, filePath)) {
    respondControlUiNotFound(res);
    return true;
  }

  const isBundledRoot =
    rootState?.kind === "bundled" ||
    (rootState === undefined &&
      isPackageProvenControlUiRootSync(root, {
        moduleUrl: import.meta.url,
        argv1: process.argv[1],
        cwd: process.cwd(),
      }));
  const rejectHardlinks = !isBundledRoot;
  const safeFile = resolveSafeControlUiFile(rootReal, filePath, rejectHardlinks);
  if (safeFile) {
    try {
      if (respondHeadForFile(req, res, safeFile.path)) {
        return true;
      }
      if (path.basename(safeFile.path) === "index.html") {
        serveResolvedIndexHtml(res, fs.readFileSync(safeFile.fd, "utf8"));
        return true;
      }
      serveResolvedFile(res, safeFile.path, fs.readFileSync(safeFile.fd));
      return true;
    } finally {
      fs.closeSync(safeFile.fd);
    }
  }

  // If the requested path looks like a static asset (known extension), return
  // 404 rather than falling through to the SPA index.html fallback.  We check
  // against the same set of extensions that contentTypeForExt() recognises so
  // that dotted SPA routes (e.g. /user/jane.doe, /v2.0) still get the
  // client-side router fallback.
  if (STATIC_ASSET_EXTENSIONS.has(path.extname(fileRel).toLowerCase())) {
    respondControlUiNotFound(res);
    return true;
  }

  // SPA fallback (client-side router): serve index.html for unknown paths.
  const indexPath = path.join(root, "index.html");
  const safeIndex = resolveSafeControlUiFile(rootReal, indexPath, rejectHardlinks);
  if (safeIndex) {
    try {
      if (respondHeadForFile(req, res, safeIndex.path)) {
        return true;
      }
      serveResolvedIndexHtml(res, fs.readFileSync(safeIndex.fd, "utf8"));
      return true;
    } finally {
      fs.closeSync(safeIndex.fd);
    }
  }

  respondControlUiNotFound(res);
  return true;
}
