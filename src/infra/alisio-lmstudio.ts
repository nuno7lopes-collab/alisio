import { spawn } from "node:child_process";
import { fetchModelRuntimeEndpoint } from "../shared/openai-compatible-endpoints.js";
import {
  DEFAULT_LM_STUDIO_BASE_URL,
  resolveCurrentRuntimeBaseUrlForKind,
} from "./alisio-local-model-runtime.js";
import { resolveExecutablePath } from "./executable-path.js";

const DEFAULT_READY_TIMEOUT_MS = 15_000;
const READY_POLL_INTERVAL_MS = 500;

function parsePortFromBaseUrl(baseUrl: string): number {
  try {
    const url = new URL(baseUrl);
    const parsed = Number.parseInt(url.port || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1234;
  } catch {
    return 1234;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveLmStudioCliPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromPath = resolveExecutablePath("lms", { env });
  if (fromPath) {
    return fromPath;
  }
  const home =
    env.HOME?.trim() ||
    env.USERPROFILE?.trim() ||
    (typeof process.env.HOME === "string" ? process.env.HOME.trim() : "") ||
    (typeof process.env.USERPROFILE === "string" ? process.env.USERPROFILE.trim() : "");
  if (!home) {
    return null;
  }
  const bundled = resolveExecutablePath(
    `${home}/.lmstudio/bin/${process.platform === "win32" ? "lms.exe" : "lms"}`,
    { env },
  );
  return bundled ?? null;
}

export function resolveLmStudioServerBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (
    resolveCurrentRuntimeBaseUrlForKind({
      runtimeKind: "lmstudio",
      env,
    }) ?? DEFAULT_LM_STUDIO_BASE_URL
  );
}

export async function isLmStudioServerReady(params?: {
  env?: NodeJS.ProcessEnv;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const baseUrl = params?.baseUrl ?? resolveLmStudioServerBaseUrl(params?.env);
  try {
    const response = await fetchModelRuntimeEndpoint({
      baseUrl,
      endpoint: "models",
      fetchImpl: params?.fetchImpl,
      init: {
        method: "GET",
        signal: AbortSignal.timeout(3_000),
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function startLmStudioLocalServer(params?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{
  baseUrl: string;
  port: number;
  alreadyRunning: boolean;
}> {
  const env = params?.env ?? process.env;
  const baseUrl = resolveLmStudioServerBaseUrl(env);
  const port = parsePortFromBaseUrl(baseUrl);
  if (await isLmStudioServerReady({ env, baseUrl, fetchImpl: params?.fetchImpl })) {
    return {
      baseUrl,
      port,
      alreadyRunning: true,
    };
  }

  const cliPath = resolveLmStudioCliPath(env);
  if (!cliPath) {
    throw new Error("LM Studio CLI (`lms`) is not available on this computer");
  }

  const child = spawn(cliPath, ["server", "start", "--port", String(port)], {
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const timeoutMs = params?.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLmStudioServerReady({ env, baseUrl, fetchImpl: params?.fetchImpl })) {
      return {
        baseUrl,
        port,
        alreadyRunning: false,
      };
    }
    await delay(READY_POLL_INTERVAL_MS);
  }

  throw new Error(`LM Studio server did not become ready at ${baseUrl}`);
}
