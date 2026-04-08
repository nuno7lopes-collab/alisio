import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GatewayClient } from "../gateway/client.js";
import {
  chatWithInstalledAlisioLocalModel,
  inspectManagedLocalModelRuntime,
  installAlisioLocalModel,
  uninstallAlisioLocalModel,
} from "../infra/alisio-local-llama-runtime.js";
import {
  inspectLocalModelRuntime,
  resolveLocalModelRuntimeConfig,
} from "../infra/alisio-local-model-runtime.js";
import {
  ensureExecApprovals,
  mergeExecApprovalsSocketDefaults,
  normalizeExecApprovals,
  readExecApprovalsSnapshot,
  saveExecApprovals,
  type ExecAsk,
  type ExecApprovalsFile,
  type ExecApprovalsResolved,
  type ExecSecurity,
} from "../infra/exec-approvals.js";
import {
  requestExecHostViaSocket,
  type ExecHostRequest,
  type ExecHostResponse,
} from "../infra/exec-host.js";
import { sanitizeHostExecEnv } from "../infra/host-env-security.js";
import { runBrowserProxyCommand } from "../plugin-sdk/browser-runtime.js";
import { fetchOpenAiCompatibleEndpoint } from "../shared/openai-compatible-endpoints.js";
import { buildSystemRunApprovalPlan, handleSystemRunInvoke } from "./invoke-system-run.js";
import type {
  ExecEventPayload,
  ExecFinishedEventParams,
  RunResult,
  SkillBinsProvider,
  SystemRunParams,
} from "./invoke-types.js";

const OUTPUT_CAP = 200_000;
const OUTPUT_EVENT_TAIL = 20_000;
const DEFAULT_NODE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const WINDOWS_CODEPAGE_ENCODING_MAP: Record<number, string> = {
  65001: "utf-8",
  54936: "gb18030",
  936: "gbk",
  950: "big5",
  932: "shift_jis",
  949: "euc-kr",
  1252: "windows-1252",
};
let cachedWindowsConsoleEncoding: string | null | undefined;

const execHostEnforced = process.env.OPENCLAW_NODE_EXEC_HOST?.trim().toLowerCase() === "app";
const execHostFallbackAllowed =
  process.env.OPENCLAW_NODE_EXEC_FALLBACK?.trim().toLowerCase() !== "0";
const preferMacAppExecHost = process.platform === "darwin" && execHostEnforced;

type SystemWhichParams = {
  bins: string[];
};

type SystemExecApprovalsSetParams = {
  file: ExecApprovalsFile;
  baseHash?: string | null;
};

type ExecApprovalsSnapshot = {
  path: string;
  exists: boolean;
  hash: string;
  file: ExecApprovalsFile;
};

export type NodeInvokeRequestPayload = {
  id: string;
  nodeId: string;
  command: string;
  paramsJSON?: string | null;
  timeoutMs?: number | null;
  idempotencyKey?: string | null;
};

export type NodeTaskRequestPayload = {
  taskId: string;
  nodeId: string;
  capabilityId: string;
  inputJSON?: string | null;
  timeoutMs?: number | null;
  idempotencyKey?: string | null;
};

type LocalModelTaskInput = {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
};

type LocalLlamaManageTaskInput = {
  action?: string;
  modelId?: string;
};

export type { SkillBinsProvider } from "./invoke-types.js";

function resolveExecSecurity(value?: string): ExecSecurity {
  return value === "deny" || value === "allowlist" || value === "full" ? value : "allowlist";
}

function isCmdExeInvocation(argv: string[]): boolean {
  const token = argv[0]?.trim();
  if (!token) {
    return false;
  }
  const base = path.win32.basename(token).toLowerCase();
  return base === "cmd.exe" || base === "cmd";
}

function resolveExecAsk(value?: string): ExecAsk {
  return value === "off" || value === "on-miss" || value === "always" ? value : "on-miss";
}

export function sanitizeEnv(overrides?: Record<string, string> | null): Record<string, string> {
  return sanitizeHostExecEnv({ overrides, blockPathOverrides: true });
}

function truncateOutput(raw: string, maxChars: number): { text: string; truncated: boolean } {
  if (raw.length <= maxChars) {
    return { text: raw, truncated: false };
  }
  return { text: `... (truncated) ${raw.slice(raw.length - maxChars)}`, truncated: true };
}

export function parseWindowsCodePage(raw: string): number | null {
  if (!raw) {
    return null;
  }
  const match = raw.match(/\b(\d{3,5})\b/);
  if (!match?.[1]) {
    return null;
  }
  const codePage = Number.parseInt(match[1], 10);
  if (!Number.isFinite(codePage) || codePage <= 0) {
    return null;
  }
  return codePage;
}

function resolveWindowsConsoleEncoding(): string | null {
  if (process.platform !== "win32") {
    return null;
  }
  if (cachedWindowsConsoleEncoding !== undefined) {
    return cachedWindowsConsoleEncoding;
  }
  try {
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "chcp"], {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const raw = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const codePage = parseWindowsCodePage(raw);
    cachedWindowsConsoleEncoding =
      codePage !== null ? (WINDOWS_CODEPAGE_ENCODING_MAP[codePage] ?? null) : null;
  } catch {
    cachedWindowsConsoleEncoding = null;
  }
  return cachedWindowsConsoleEncoding;
}

export function decodeCapturedOutputBuffer(params: {
  buffer: Buffer;
  platform?: NodeJS.Platform;
  windowsEncoding?: string | null;
}): string {
  const utf8 = params.buffer.toString("utf8");
  const platform = params.platform ?? process.platform;
  if (platform !== "win32") {
    return utf8;
  }
  const encoding = params.windowsEncoding ?? resolveWindowsConsoleEncoding();
  if (!encoding || encoding.toLowerCase() === "utf-8") {
    return utf8;
  }
  try {
    return new TextDecoder(encoding).decode(params.buffer);
  } catch {
    return utf8;
  }
}

function redactExecApprovals(file: ExecApprovalsFile): ExecApprovalsFile {
  const socketPath = file.socket?.path?.trim();
  return {
    ...file,
    socket: socketPath ? { path: socketPath } : undefined,
  };
}

function requireExecApprovalsBaseHash(
  params: SystemExecApprovalsSetParams,
  snapshot: ExecApprovalsSnapshot,
) {
  if (!snapshot.exists) {
    return;
  }
  if (!snapshot.hash) {
    throw new Error("INVALID_REQUEST: exec approvals base hash unavailable; reload and retry");
  }
  const baseHash = typeof params.baseHash === "string" ? params.baseHash.trim() : "";
  if (!baseHash) {
    throw new Error("INVALID_REQUEST: exec approvals base hash required; reload and retry");
  }
  if (baseHash !== snapshot.hash) {
    throw new Error("INVALID_REQUEST: exec approvals changed; reload and retry");
  }
}

async function runCommand(
  argv: string[],
  cwd: string | undefined,
  env: Record<string, string> | undefined,
  timeoutMs: number | undefined,
): Promise<RunResult> {
  return await new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputLen = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const windowsEncoding = resolveWindowsConsoleEncoding();

    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const onChunk = (chunk: Buffer, target: "stdout" | "stderr") => {
      if (outputLen >= OUTPUT_CAP) {
        truncated = true;
        return;
      }
      const remaining = OUTPUT_CAP - outputLen;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      outputLen += slice.length;
      if (target === "stdout") {
        stdoutChunks.push(slice);
      } else {
        stderrChunks.push(slice);
      }
      if (chunk.length > remaining) {
        truncated = true;
      }
    };

    child.stdout?.on("data", (chunk) => onChunk(chunk as Buffer, "stdout"));
    child.stderr?.on("data", (chunk) => onChunk(chunk as Buffer, "stderr"));

    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, timeoutMs);
    }

    const finalize = (exitCode?: number, error?: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      const stdout = decodeCapturedOutputBuffer({
        buffer: Buffer.concat(stdoutChunks),
        windowsEncoding,
      });
      const stderr = decodeCapturedOutputBuffer({
        buffer: Buffer.concat(stderrChunks),
        windowsEncoding,
      });
      resolve({
        exitCode,
        timedOut,
        success: exitCode === 0 && !timedOut && !error,
        stdout,
        stderr,
        error: error ?? null,
        truncated,
      });
    };

    child.on("error", (err) => {
      finalize(undefined, err.message);
    });
    child.on("exit", (code) => {
      finalize(code === null ? undefined : code, null);
    });
  });
}

function resolveEnvPath(env?: Record<string, string>): string[] {
  const raw =
    env?.PATH ??
    (env as Record<string, string>)?.Path ??
    process.env.PATH ??
    process.env.Path ??
    DEFAULT_NODE_PATH;
  return raw.split(path.delimiter).filter(Boolean);
}

function resolveExecutable(bin: string, env?: Record<string, string>) {
  if (bin.includes("/") || bin.includes("\\")) {
    return null;
  }
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? process.env.PathExt ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((ext) => ext.toLowerCase())
      : [""];
  for (const dir of resolveEnvPath(env)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, bin + ext);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

async function handleSystemWhich(params: SystemWhichParams, env?: Record<string, string>) {
  const bins = params.bins.map((bin) => bin.trim()).filter(Boolean);
  const found: Record<string, string> = {};
  for (const bin of bins) {
    const path = resolveExecutable(bin, env);
    if (path) {
      found[bin] = path;
    }
  }
  return { bins: found };
}

function buildExecEventPayload(payload: ExecEventPayload): ExecEventPayload {
  if (!payload.output) {
    return payload;
  }
  const trimmed = payload.output.trim();
  if (!trimmed) {
    return payload;
  }
  const { text } = truncateOutput(trimmed, OUTPUT_EVENT_TAIL);
  return { ...payload, output: text };
}

async function sendExecFinishedEvent(
  params: ExecFinishedEventParams & {
    client: GatewayClient;
  },
) {
  const combined = [params.result.stdout, params.result.stderr, params.result.error]
    .filter(Boolean)
    .join("\n");
  await sendNodeEvent(
    params.client,
    "exec.finished",
    buildExecEventPayload({
      sessionKey: params.sessionKey,
      runId: params.runId,
      host: "node",
      command: params.commandText,
      exitCode: params.result.exitCode ?? undefined,
      timedOut: params.result.timedOut,
      success: params.result.success,
      output: combined,
      suppressNotifyOnExit: params.suppressNotifyOnExit,
    }),
  );
}

async function runViaMacAppExecHost(params: {
  approvals: ExecApprovalsResolved;
  request: ExecHostRequest;
}): Promise<ExecHostResponse | null> {
  const { approvals, request } = params;
  return await requestExecHostViaSocket({
    socketPath: approvals.socketPath,
    token: approvals.token,
    request,
  });
}

async function sendJsonPayloadResult(
  client: GatewayClient,
  frame: NodeInvokeRequestPayload,
  payload: unknown,
) {
  await sendInvokeResult(client, frame, {
    ok: true,
    payloadJSON: JSON.stringify(payload),
  });
}

async function sendRawPayloadResult(
  client: GatewayClient,
  frame: NodeInvokeRequestPayload,
  payloadJSON: string,
) {
  await sendInvokeResult(client, frame, {
    ok: true,
    payloadJSON,
  });
}

async function sendErrorResult(
  client: GatewayClient,
  frame: NodeInvokeRequestPayload,
  code: string,
  message: string,
) {
  await sendInvokeResult(client, frame, {
    ok: false,
    error: { code, message },
  });
}

async function sendInvalidRequestResult(
  client: GatewayClient,
  frame: NodeInvokeRequestPayload,
  err: unknown,
) {
  await sendErrorResult(client, frame, "INVALID_REQUEST", String(err));
}

async function sendTaskEvent(
  client: GatewayClient,
  frame: NodeTaskRequestPayload,
  event: {
    kind: string;
    seq?: number;
    payload?: unknown;
    payloadJSON?: string | null;
  },
) {
  try {
    await client.request("node.task.event", {
      taskId: frame.taskId,
      nodeId: frame.nodeId,
      kind: event.kind,
      seq: event.seq,
      payloadJSON:
        typeof event.payloadJSON === "string"
          ? event.payloadJSON
          : event.payload !== undefined
            ? JSON.stringify(event.payload)
            : null,
    });
  } catch {
    // ignore: task events are best-effort
  }
}

async function sendTaskResult(
  client: GatewayClient,
  frame: NodeTaskRequestPayload,
  result: {
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  },
) {
  try {
    await client.request("node.task.result", buildNodeTaskResultParams(frame, result));
  } catch {
    // ignore: task results are best-effort
  }
}

async function sendJsonTaskResult(
  client: GatewayClient,
  frame: NodeTaskRequestPayload,
  payload: unknown,
) {
  await sendTaskResult(client, frame, {
    ok: true,
    payloadJSON: JSON.stringify(payload),
  });
}

async function sendTaskErrorResult(
  client: GatewayClient,
  frame: NodeTaskRequestPayload,
  code: string,
  message: string,
) {
  await sendTaskResult(client, frame, {
    ok: false,
    error: { code, message },
  });
}

async function sendInvalidTaskRequestResult(
  client: GatewayClient,
  frame: NodeTaskRequestPayload,
  err: unknown,
) {
  await sendTaskErrorResult(client, frame, "INVALID_REQUEST", String(err));
}

async function handleLocalModelTask(client: GatewayClient, frame: NodeTaskRequestPayload) {
  const { baseUrl, authHeader } = resolveLocalModelRuntimeConfig(process.env);
  if (!baseUrl) {
    await sendTaskErrorResult(
      client,
      frame,
      "UNAVAILABLE",
      "local model host not configured on this computer",
    );
    return;
  }
  let input: LocalModelTaskInput;
  try {
    input = decodeParams<LocalModelTaskInput>(frame.inputJSON);
  } catch (err) {
    await sendInvalidTaskRequestResult(client, frame, err);
    return;
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    await sendTaskErrorResult(client, frame, "INVALID_REQUEST", "messages required");
    return;
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authHeader) {
    headers.authorization = authHeader;
  }

  const timeoutMs =
    typeof frame.timeoutMs === "number" && frame.timeoutMs > 0 ? frame.timeoutMs : 120_000;
  const signal = AbortSignal.timeout(timeoutMs);
  const requestBody = {
    ...input,
    stream: true,
  };

  let response: Response;
  try {
    response = await fetchOpenAiCompatibleEndpoint({
      baseUrl,
      endpoint: "chat/completions",
      init: {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal,
      },
    });
  } catch (err) {
    await sendTaskErrorResult(client, frame, "UNAVAILABLE", String(err));
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    await sendTaskErrorResult(
      client,
      frame,
      "UNAVAILABLE",
      `local model host request failed (${response.status}): ${errorText || response.statusText}`,
    );
    return;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream")) {
    try {
      const payload = (await response.json()) as unknown;
      await sendTaskEvent(client, frame, { kind: "completed", seq: 1, payload });
      await sendJsonTaskResult(client, frame, payload);
    } catch (err) {
      await sendTaskErrorResult(client, frame, "UNAVAILABLE", String(err));
    }
    return;
  }

  const body = response.body;
  if (!body) {
    await sendTaskErrorResult(client, frame, "UNAVAILABLE", "local model host returned no body");
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let seq = 0;
  let text = "";
  let finalChunk: unknown = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const normalized = buffer.replace(/\r\n/g, "\n");
      const events = normalized.split("\n\n");
      buffer = events.pop() ?? "";
      for (const rawEvent of events) {
        const data = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) {
          continue;
        }
        if (data === "[DONE]") {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data) as unknown;
        } catch {
          parsed = { raw: data };
        }
        const deltaText =
          typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray((parsed as { choices?: unknown[] }).choices)
            ? ((parsed as { choices?: Array<{ delta?: { content?: unknown } }> }).choices ?? [])
                .map((choice) =>
                  typeof choice?.delta?.content === "string" ? choice.delta.content : "",
                )
                .join("")
            : "";
        if (deltaText) {
          text += deltaText;
        }
        finalChunk = parsed;
        seq += 1;
        await sendTaskEvent(client, frame, {
          kind: "delta",
          seq,
          payload: parsed,
        });
      }
      if (done) {
        break;
      }
    }
  } catch (err) {
    await sendTaskErrorResult(client, frame, "UNAVAILABLE", String(err));
    return;
  }

  const payload = {
    text,
    response: finalChunk,
  };
  await sendTaskEvent(client, frame, {
    kind: "completed",
    seq: seq + 1,
    payload,
  });
  await sendJsonTaskResult(client, frame, payload);
}

async function handleLocalModelCatalogTask(client: GatewayClient, frame: NodeTaskRequestPayload) {
  const inspection = await inspectLocalModelRuntime({ env: process.env });
  await sendTaskEvent(client, frame, {
    kind: "completed",
    seq: 1,
    payload: inspection,
  });
  await sendJsonTaskResult(client, frame, inspection);
}

async function handleLlamaCppCatalogTask(client: GatewayClient, frame: NodeTaskRequestPayload) {
  const inspection = await inspectManagedLocalModelRuntime(process.env);
  await sendTaskEvent(client, frame, {
    kind: "completed",
    seq: 1,
    payload: inspection,
  });
  await sendJsonTaskResult(client, frame, inspection);
}

async function handleLlamaCppManageTask(client: GatewayClient, frame: NodeTaskRequestPayload) {
  let input: LocalLlamaManageTaskInput;
  try {
    input = decodeParams<LocalLlamaManageTaskInput>(frame.inputJSON);
  } catch (err) {
    await sendInvalidTaskRequestResult(client, frame, err);
    return;
  }
  if (input.action !== "install" && input.action !== "uninstall") {
    await sendTaskErrorResult(client, frame, "INVALID_REQUEST", "unsupported local model action");
    return;
  }
  const modelId = String(input.modelId ?? "").trim();
  if (!modelId) {
    await sendTaskErrorResult(client, frame, "INVALID_REQUEST", "modelId required");
    return;
  }

  try {
    if (input.action === "install") {
      await sendTaskEvent(client, frame, {
        kind: "status",
        seq: 1,
        payload: {
          action: "install",
          modelId,
          phase: "started",
        },
      });
    } else {
      await sendTaskEvent(client, frame, {
        kind: "status",
        seq: 1,
        payload: {
          action: "uninstall",
          modelId,
          phase: "started",
        },
      });
    }

    const model =
      input.action === "install"
        ? await installAlisioLocalModel({
            modelId,
            env: process.env,
            onProgress: ({ downloadedSize, totalSize }) => {
              const percent =
                totalSize > 0
                  ? Math.max(0, Math.min(100, Math.round((downloadedSize / totalSize) * 100)))
                  : undefined;
              void sendTaskEvent(client, frame, {
                kind: "progress",
                payload: {
                  action: "install",
                  modelId,
                  phase: "running",
                  downloadedSize,
                  totalSize,
                  percent,
                },
              });
            },
          })
        : await uninstallAlisioLocalModel({
            modelId,
            env: process.env,
          });

    await sendTaskEvent(client, frame, {
      kind: "completed",
      seq: 2,
      payload: {
        ok: true,
        action: input.action,
        model,
      },
    });
    await sendJsonTaskResult(client, frame, {
      ok: true,
      action: input.action,
      model,
    });
  } catch (error) {
    await sendTaskEvent(client, frame, {
      kind: "failed",
      payload: {
        action: input.action,
        modelId,
        phase: "failed",
        message: String(error),
      },
    });
    await sendTaskErrorResult(client, frame, "UNAVAILABLE", String(error));
  }
}

async function handleLlamaCppChatTask(client: GatewayClient, frame: NodeTaskRequestPayload) {
  let input: LocalModelTaskInput;
  try {
    input = decodeParams<LocalModelTaskInput>(frame.inputJSON);
  } catch (err) {
    await sendInvalidTaskRequestResult(client, frame, err);
    return;
  }
  const modelId = String(input.model ?? "").trim();
  if (!modelId) {
    await sendTaskErrorResult(client, frame, "INVALID_REQUEST", "model required");
    return;
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    await sendTaskErrorResult(client, frame, "INVALID_REQUEST", "messages required");
    return;
  }

  let seq = 1;
  try {
    const result = await chatWithInstalledAlisioLocalModel({
      modelId,
      messages: input.messages,
      signal:
        typeof frame.timeoutMs === "number" && frame.timeoutMs > 0
          ? AbortSignal.timeout(frame.timeoutMs)
          : undefined,
      maxTokens:
        typeof input.max_tokens === "number"
          ? input.max_tokens
          : typeof input.maxTokens === "number"
            ? input.maxTokens
            : undefined,
      temperature: typeof input.temperature === "number" ? input.temperature : undefined,
      onTextChunk: async (chunk) => {
        await sendTaskEvent(client, frame, {
          kind: "delta",
          seq,
          payload: { text: chunk },
        });
        seq += 1;
      },
    });
    await sendTaskEvent(client, frame, {
      kind: "completed",
      seq,
      payload: result,
    });
    await sendJsonTaskResult(client, frame, result);
  } catch (error) {
    await sendTaskErrorResult(client, frame, "UNAVAILABLE", String(error));
  }
}

export async function handleInvoke(
  frame: NodeInvokeRequestPayload,
  client: GatewayClient,
  skillBins: SkillBinsProvider,
) {
  const command = String(frame.command ?? "");
  if (command === "system.execApprovals.get") {
    try {
      ensureExecApprovals();
      const snapshot = readExecApprovalsSnapshot();
      const payload: ExecApprovalsSnapshot = {
        path: snapshot.path,
        exists: snapshot.exists,
        hash: snapshot.hash,
        file: redactExecApprovals(snapshot.file),
      };
      await sendJsonPayloadResult(client, frame, payload);
    } catch (err) {
      const message = String(err);
      const code = message.toLowerCase().includes("timed out") ? "TIMEOUT" : "INVALID_REQUEST";
      await sendErrorResult(client, frame, code, message);
    }
    return;
  }

  if (command === "system.execApprovals.set") {
    try {
      const params = decodeParams<SystemExecApprovalsSetParams>(frame.paramsJSON);
      if (!params.file || typeof params.file !== "object") {
        throw new Error("INVALID_REQUEST: exec approvals file required");
      }
      ensureExecApprovals();
      const snapshot = readExecApprovalsSnapshot();
      requireExecApprovalsBaseHash(params, snapshot);
      const normalized = normalizeExecApprovals(params.file);
      const next = mergeExecApprovalsSocketDefaults({ normalized, current: snapshot.file });
      saveExecApprovals(next);
      const nextSnapshot = readExecApprovalsSnapshot();
      const payload: ExecApprovalsSnapshot = {
        path: nextSnapshot.path,
        exists: nextSnapshot.exists,
        hash: nextSnapshot.hash,
        file: redactExecApprovals(nextSnapshot.file),
      };
      await sendJsonPayloadResult(client, frame, payload);
    } catch (err) {
      await sendInvalidRequestResult(client, frame, err);
    }
    return;
  }

  if (command === "system.which") {
    try {
      const params = decodeParams<SystemWhichParams>(frame.paramsJSON);
      if (!Array.isArray(params.bins)) {
        throw new Error("INVALID_REQUEST: bins required");
      }
      const env = sanitizeEnv(undefined);
      const payload = await handleSystemWhich(params, env);
      await sendJsonPayloadResult(client, frame, payload);
    } catch (err) {
      await sendInvalidRequestResult(client, frame, err);
    }
    return;
  }

  if (command === "browser.proxy") {
    try {
      const payload = await runBrowserProxyCommand(frame.paramsJSON);
      await sendRawPayloadResult(client, frame, payload);
    } catch (err) {
      await sendInvalidRequestResult(client, frame, err);
    }
    return;
  }

  if (command === "system.run.prepare") {
    try {
      const params = decodeParams<{
        command?: unknown;
        rawCommand?: unknown;
        cwd?: unknown;
        agentId?: unknown;
        sessionKey?: unknown;
      }>(frame.paramsJSON);
      const prepared = buildSystemRunApprovalPlan(params);
      if (!prepared.ok) {
        await sendErrorResult(client, frame, "INVALID_REQUEST", prepared.message);
        return;
      }
      await sendJsonPayloadResult(client, frame, {
        plan: prepared.plan,
      });
    } catch (err) {
      await sendInvalidRequestResult(client, frame, err);
    }
    return;
  }

  if (command !== "system.run") {
    await sendErrorResult(client, frame, "UNAVAILABLE", "command not supported");
    return;
  }

  let params: SystemRunParams;
  try {
    params = decodeParams<SystemRunParams>(frame.paramsJSON);
  } catch (err) {
    await sendInvalidRequestResult(client, frame, err);
    return;
  }

  if (!Array.isArray(params.command) || params.command.length === 0) {
    await sendErrorResult(client, frame, "INVALID_REQUEST", "command required");
    return;
  }

  await handleSystemRunInvoke({
    client,
    params,
    skillBins,
    execHostEnforced,
    execHostFallbackAllowed,
    resolveExecSecurity,
    resolveExecAsk,
    isCmdExeInvocation,
    sanitizeEnv,
    runCommand,
    runViaMacAppExecHost,
    sendNodeEvent,
    buildExecEventPayload,
    sendInvokeResult: async (result) => {
      await sendInvokeResult(client, frame, result);
    },
    sendExecFinishedEvent: async ({ sessionKey, runId, commandText, result }) => {
      await sendExecFinishedEvent({ client, sessionKey, runId, commandText, result });
    },
    preferMacAppExecHost,
  });
}

export async function handleTask(
  frame: NodeTaskRequestPayload,
  client: GatewayClient,
  skillBins: SkillBinsProvider,
) {
  if (frame.capabilityId === "model.catalog.llamacpp.v1") {
    await sendTaskEvent(client, frame, { kind: "started", seq: 0 });
    await handleLlamaCppCatalogTask(client, frame);
    return;
  }

  if (frame.capabilityId === "model.manage.llamacpp.v1") {
    await sendTaskEvent(client, frame, { kind: "started", seq: 0 });
    await handleLlamaCppManageTask(client, frame);
    return;
  }

  if (frame.capabilityId === "model.chat.llamacpp.v1") {
    await sendTaskEvent(client, frame, { kind: "started", seq: 0 });
    await handleLlamaCppChatTask(client, frame);
    return;
  }

  if (frame.capabilityId === "model.catalog.openai.v1") {
    await sendTaskEvent(client, frame, { kind: "started", seq: 0 });
    await handleLocalModelCatalogTask(client, frame);
    return;
  }

  if (frame.capabilityId === "model.chat.openai.v1") {
    await sendTaskEvent(client, frame, { kind: "started", seq: 0 });
    await handleLocalModelTask(client, frame);
    return;
  }

  if (frame.capabilityId !== "exec.shell.v1") {
    await sendTaskErrorResult(client, frame, "UNAVAILABLE", "capability not supported");
    return;
  }

  let params: SystemRunParams;
  try {
    params = decodeParams<SystemRunParams>(frame.inputJSON);
  } catch (err) {
    await sendInvalidTaskRequestResult(client, frame, err);
    return;
  }

  if (!Array.isArray(params.command) || params.command.length === 0) {
    await sendTaskErrorResult(client, frame, "INVALID_REQUEST", "command required");
    return;
  }

  await sendTaskEvent(client, frame, { kind: "started", seq: 1 });
  await handleSystemRunInvoke({
    client,
    params,
    skillBins,
    execHostEnforced,
    execHostFallbackAllowed,
    resolveExecSecurity,
    resolveExecAsk,
    isCmdExeInvocation,
    sanitizeEnv,
    runCommand,
    runViaMacAppExecHost,
    sendNodeEvent,
    buildExecEventPayload,
    sendInvokeResult: async (result) => {
      await sendTaskResult(client, frame, result);
    },
    sendExecFinishedEvent: async ({ sessionKey, runId, commandText, result }) => {
      await sendExecFinishedEvent({ client, sessionKey, runId, commandText, result });
      await sendTaskEvent(client, frame, {
        kind: "completed",
        seq: 2,
        payload: {
          runId,
          sessionKey,
          commandText,
          result,
        },
      });
    },
    preferMacAppExecHost,
  });
}

function decodeParams<T>(raw?: string | null): T {
  if (!raw) {
    throw new Error("INVALID_REQUEST: paramsJSON required");
  }
  return JSON.parse(raw) as T;
}

export function coerceNodeInvokePayload(payload: unknown): NodeInvokeRequestPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const obj = payload as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const nodeId = typeof obj.nodeId === "string" ? obj.nodeId.trim() : "";
  const command = typeof obj.command === "string" ? obj.command.trim() : "";
  if (!id || !nodeId || !command) {
    return null;
  }
  const paramsJSON =
    typeof obj.paramsJSON === "string"
      ? obj.paramsJSON
      : obj.params !== undefined
        ? JSON.stringify(obj.params)
        : null;
  const timeoutMs = typeof obj.timeoutMs === "number" ? obj.timeoutMs : null;
  const idempotencyKey = typeof obj.idempotencyKey === "string" ? obj.idempotencyKey : null;
  return {
    id,
    nodeId,
    command,
    paramsJSON,
    timeoutMs,
    idempotencyKey,
  };
}

export function coerceNodeTaskPayload(payload: unknown): NodeTaskRequestPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const obj = payload as Record<string, unknown>;
  const taskId = typeof obj.taskId === "string" ? obj.taskId.trim() : "";
  const nodeId = typeof obj.nodeId === "string" ? obj.nodeId.trim() : "";
  const capabilityId = typeof obj.capabilityId === "string" ? obj.capabilityId.trim() : "";
  if (!taskId || !nodeId || !capabilityId) {
    return null;
  }
  const inputJSON =
    typeof obj.inputJSON === "string"
      ? obj.inputJSON
      : obj.input !== undefined
        ? JSON.stringify(obj.input)
        : null;
  const timeoutMs = typeof obj.timeoutMs === "number" ? obj.timeoutMs : null;
  const idempotencyKey = typeof obj.idempotencyKey === "string" ? obj.idempotencyKey : null;
  return {
    taskId,
    nodeId,
    capabilityId,
    inputJSON,
    timeoutMs,
    idempotencyKey,
  };
}

async function sendInvokeResult(
  client: GatewayClient,
  frame: NodeInvokeRequestPayload,
  result: {
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  },
) {
  try {
    await client.request("node.invoke.result", buildNodeInvokeResultParams(frame, result));
  } catch {
    // ignore: node invoke responses are best-effort
  }
}

export function buildNodeInvokeResultParams(
  frame: NodeInvokeRequestPayload,
  result: {
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  },
): {
  id: string;
  nodeId: string;
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string;
  error?: { code?: string; message?: string };
} {
  const params: {
    id: string;
    nodeId: string;
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string;
    error?: { code?: string; message?: string };
  } = {
    id: frame.id,
    nodeId: frame.nodeId,
    ok: result.ok,
  };
  if (result.payload !== undefined) {
    params.payload = result.payload;
  }
  if (typeof result.payloadJSON === "string") {
    params.payloadJSON = result.payloadJSON;
  }
  if (result.error) {
    params.error = result.error;
  }
  return params;
}

export function buildNodeTaskResultParams(
  frame: NodeTaskRequestPayload,
  result: {
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  },
): {
  taskId: string;
  nodeId: string;
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string;
  error?: { code?: string; message?: string };
} {
  const params: {
    taskId: string;
    nodeId: string;
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string;
    error?: { code?: string; message?: string };
  } = {
    taskId: frame.taskId,
    nodeId: frame.nodeId,
    ok: result.ok,
  };
  if (result.payload !== undefined) {
    params.payload = result.payload;
  }
  if (typeof result.payloadJSON === "string") {
    params.payloadJSON = result.payloadJSON;
  }
  if (result.error) {
    params.error = result.error;
  }
  return params;
}

async function sendNodeEvent(client: GatewayClient, event: string, payload: unknown) {
  try {
    await client.request("node.event", {
      event,
      payloadJSON: payload ? JSON.stringify(payload) : null,
    });
  } catch {
    // ignore: node events are best-effort
  }
}
