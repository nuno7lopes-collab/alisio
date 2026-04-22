import fs from "node:fs/promises";
import path from "node:path";
import { listAgentIds, resolveAgentDir } from "../../agents/agent-scope.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
  isWorkspaceSetupCompleted,
} from "../../agents/workspace.js";
import {
  applyAgentConfig,
  findAgentEntryIndex,
  listAgentEntries,
  pruneAgentConfig,
} from "../../commands/agents.config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../../config/sessions/paths.js";
import { sameFileIdentity } from "../../infra/file-identity.js";
import {
  appendFileWithinRoot,
  SafeOpenError,
  readLocalFileSafely,
  writeFileWithinRoot,
} from "../../infra/fs-safe.js";
import { assertNoPathAliasEscape } from "../../infra/path-alias-guards.js";
import { isNotFoundPathError } from "../../infra/path-guards.js";
import { readPersonalContextSummary } from "../../memory/personal-context.js";
import { movePathToTrash } from "../../plugin-sdk/browser-runtime.js";
import { listMemoryFiles } from "../../plugin-sdk/memory-core-host-runtime-files.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../../routing/session-key.js";
import {
  getLongTermMemoryFilePriority,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  normalizeMemoryFileName,
} from "../../shared/memory-file-paths.js";
import { resolveUserPath } from "../../utils.js";
import {
  buildGatewayPersonalContextScope,
  resolveAccountScopedWorkspaceForAgent,
} from "../alisio-account-context.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAgentsCreateParams,
  validateAgentsDeleteParams,
  validateAgentsFilesDeleteParams,
  validateAgentsFilesGetParams,
  validateAgentsFilesListParams,
  validateAgentsFilesSetParams,
  validateAgentsListParams,
  validateAgentsUpdateParams,
} from "../protocol/index.js";
import { listAgentsForGateway } from "../session-utils.js";
import { requireAuthenticatedAppAccount } from "./account-required.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const BOOTSTRAP_FILE_NAMES = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
] as const;
const BOOTSTRAP_FILE_NAMES_POST_ONBOARDING = BOOTSTRAP_FILE_NAMES.filter(
  (name) => name !== DEFAULT_BOOTSTRAP_FILENAME,
);

const agentsHandlerDeps = {
  isWorkspaceSetupCompleted,
  readLocalFileSafely,
  resolveAgentWorkspaceFilePath,
  appendFileWithinRoot,
  writeFileWithinRoot,
};

export const __testing = {
  setDepsForTests(
    overrides: Partial<{
      isWorkspaceSetupCompleted: typeof isWorkspaceSetupCompleted;
      readLocalFileSafely: typeof readLocalFileSafely;
      resolveAgentWorkspaceFilePath: typeof resolveAgentWorkspaceFilePath;
      appendFileWithinRoot: typeof appendFileWithinRoot;
      writeFileWithinRoot: typeof writeFileWithinRoot;
    }>,
  ) {
    Object.assign(agentsHandlerDeps, overrides);
  },
  resetDepsForTests() {
    agentsHandlerDeps.isWorkspaceSetupCompleted = isWorkspaceSetupCompleted;
    agentsHandlerDeps.readLocalFileSafely = readLocalFileSafely;
    agentsHandlerDeps.resolveAgentWorkspaceFilePath = resolveAgentWorkspaceFilePath;
    agentsHandlerDeps.appendFileWithinRoot = appendFileWithinRoot;
    agentsHandlerDeps.writeFileWithinRoot = writeFileWithinRoot;
  },
};

const MEMORY_FILE_NAMES = [DEFAULT_MEMORY_FILENAME] as const;

const ALLOWED_FILE_NAMES = new Set<string>([...BOOTSTRAP_FILE_NAMES, ...MEMORY_FILE_NAMES]);

type AgentFilesScope = "core" | "memory";

function normalizeWorkspaceFileName(rawName: unknown): string {
  const name = (
    typeof rawName === "string" || typeof rawName === "number" ? String(rawName) : ""
  ).trim();
  return name.replace(/\\/g, "/").replace(/^\.?\//, "");
}
function isAllowedMemoryNoteFileName(name: string): boolean {
  const normalized = normalizeMemoryFileName(name);
  return isMemoryNoteFileName(normalized);
}

function isSupportedAgentWorkspaceFileName(
  name: string,
  options?: {
    allowMemoryNotes?: boolean;
  },
): boolean {
  if (ALLOWED_FILE_NAMES.has(name)) {
    return true;
  }
  if (!options?.allowMemoryNotes) {
    return false;
  }
  return isAllowedMemoryNoteFileName(name);
}

function resolveAgentWorkspaceFileOrRespondError(
  params: Record<string, unknown>,
  respond: RespondFn,
  options?: {
    allowMemoryNotes?: boolean;
    accountId?: string;
  },
): {
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
  workspaceDir: string;
  name: string;
} | null {
  const cfg = loadConfig();
  const rawAgentId = params.agentId;
  const agentId = resolveAgentIdOrError(
    typeof rawAgentId === "string" || typeof rawAgentId === "number" ? String(rawAgentId) : "",
    cfg,
  );
  if (!agentId) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
    return null;
  }
  const name = normalizeWorkspaceFileName(params.name);
  const workspaceDir = resolveAccountScopedWorkspaceForAgent({
    cfg,
    agentId,
    accountId: options?.accountId,
  });
  if (!isSupportedAgentWorkspaceFileName(name, { allowMemoryNotes: options?.allowMemoryNotes })) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unsupported file "${name}"`));
    return null;
  }
  return { cfg, agentId, workspaceDir, name };
}

type FileMeta = {
  size: number;
  updatedAtMs: number;
};

type ResolvedAgentWorkspaceFilePath =
  | {
      kind: "ready";
      requestPath: string;
      ioPath: string;
      rootReal: string;
    }
  | {
      kind: "missing";
      requestPath: string;
      ioPath: string;
      rootReal: string;
    }
  | {
      kind: "invalid";
      requestPath: string;
      reason: string;
    };

type ResolvedWorkspaceFilePath = Exclude<ResolvedAgentWorkspaceFilePath, { kind: "invalid" }>;

function resolveNotFoundWorkspaceFilePathResult(params: {
  error: unknown;
  allowMissing: boolean;
  requestPath: string;
  ioPath: string;
  rootReal: string;
}): Extract<ResolvedAgentWorkspaceFilePath, { kind: "missing" | "invalid" }> | undefined {
  if (!isNotFoundPathError(params.error)) {
    return undefined;
  }
  if (params.allowMissing) {
    return {
      kind: "missing",
      requestPath: params.requestPath,
      ioPath: params.ioPath,
      rootReal: params.rootReal,
    };
  }
  return { kind: "invalid", requestPath: params.requestPath, reason: "file not found" };
}

function resolveWorkspaceFilePathResultOrThrow(params: {
  error: unknown;
  allowMissing: boolean;
  requestPath: string;
  ioPath: string;
  rootReal: string;
}): Extract<ResolvedAgentWorkspaceFilePath, { kind: "missing" | "invalid" }> {
  const notFoundResult = resolveNotFoundWorkspaceFilePathResult(params);
  if (notFoundResult) {
    return notFoundResult;
  }
  throw params.error;
}

async function resolveWorkspaceRealPath(workspaceDir: string): Promise<string> {
  try {
    return await fs.realpath(workspaceDir);
  } catch {
    return path.resolve(workspaceDir);
  }
}

async function resolveRootScopedFilePath(params: {
  rootDir: string;
  requestPath: string;
  allowMissing: boolean;
  boundaryLabel: string;
  resolveCandidatePath: (rootReal: string) => string;
}): Promise<ResolvedAgentWorkspaceFilePath> {
  const rootReal = await resolveWorkspaceRealPath(params.rootDir);
  const candidatePath = path.resolve(params.resolveCandidatePath(rootReal));

  try {
    await assertNoPathAliasEscape({
      absolutePath: candidatePath,
      rootPath: rootReal,
      boundaryLabel: params.boundaryLabel,
    });
  } catch (error) {
    return {
      kind: "invalid",
      requestPath: params.requestPath,
      reason: error instanceof Error ? error.message : "path escapes workspace root",
    };
  }

  const notFoundContext = {
    allowMissing: params.allowMissing,
    requestPath: params.requestPath,
    rootReal,
  } as const;

  let candidateLstat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    candidateLstat = await fs.lstat(candidatePath);
  } catch (err) {
    return resolveWorkspaceFilePathResultOrThrow({
      error: err,
      ...notFoundContext,
      ioPath: candidatePath,
    });
  }

  if (candidateLstat.isSymbolicLink()) {
    let targetReal: string;
    try {
      targetReal = await fs.realpath(candidatePath);
    } catch (err) {
      return resolveWorkspaceFilePathResultOrThrow({
        error: err,
        ...notFoundContext,
        ioPath: candidatePath,
      });
    }
    let targetStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      targetStat = await fs.stat(targetReal);
    } catch (err) {
      return resolveWorkspaceFilePathResultOrThrow({
        error: err,
        ...notFoundContext,
        ioPath: targetReal,
      });
    }
    if (!targetStat.isFile()) {
      return {
        kind: "invalid",
        requestPath: params.requestPath,
        reason: "path is not a regular file",
      };
    }
    if (targetStat.nlink > 1) {
      return {
        kind: "invalid",
        requestPath: params.requestPath,
        reason: "hardlinked file path not allowed",
      };
    }
    return { kind: "ready", requestPath: params.requestPath, ioPath: targetReal, rootReal };
  }

  if (!candidateLstat.isFile()) {
    return {
      kind: "invalid",
      requestPath: params.requestPath,
      reason: "path is not a regular file",
    };
  }
  if (candidateLstat.nlink > 1) {
    return {
      kind: "invalid",
      requestPath: params.requestPath,
      reason: "hardlinked file path not allowed",
    };
  }

  const targetReal = await fs.realpath(candidatePath).catch(() => candidatePath);
  return { kind: "ready", requestPath: params.requestPath, ioPath: targetReal, rootReal };
}

async function resolveAgentWorkspaceFilePath(params: {
  workspaceDir: string;
  name: string;
  allowMissing: boolean;
}): Promise<ResolvedAgentWorkspaceFilePath> {
  return await resolveRootScopedFilePath({
    rootDir: params.workspaceDir,
    requestPath: path.join(params.workspaceDir, params.name),
    allowMissing: params.allowMissing,
    boundaryLabel: "workspace root",
    resolveCandidatePath: (rootReal) => path.resolve(rootReal, params.name),
  });
}

async function statFileSafely(filePath: string): Promise<FileMeta | null> {
  try {
    const [stat, lstat] = await Promise.all([fs.stat(filePath), fs.lstat(filePath)]);
    if (lstat.isSymbolicLink() || !stat.isFile()) {
      return null;
    }
    if (stat.nlink > 1) {
      return null;
    }
    if (!sameFileIdentity(stat, lstat)) {
      return null;
    }
    return {
      size: stat.size,
      updatedAtMs: Math.floor(stat.mtimeMs),
    };
  } catch {
    return null;
  }
}

async function listAgentMemoryFiles(workspaceDir: string) {
  const files: Array<{
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  }> = [];

  const discovered = await listMemoryFiles(workspaceDir);
  let hasPreferredLongTerm = false;
  for (const absPath of discovered) {
    const meta = await statFileSafely(absPath);
    if (!meta) {
      continue;
    }
    const name = path.relative(workspaceDir, absPath).replace(/\\/g, "/");
    if (name === DEFAULT_MEMORY_FILENAME) {
      hasPreferredLongTerm = true;
    }
    files.push({
      name,
      path: absPath,
      missing: false,
      size: meta.size,
      updatedAtMs: meta.updatedAtMs,
    });
  }

  if (!hasPreferredLongTerm) {
    files.push({
      name: DEFAULT_MEMORY_FILENAME,
      path: path.join(workspaceDir, DEFAULT_MEMORY_FILENAME),
      missing: true,
    });
  }

  files.sort((left, right) => {
    const leftLongTerm = isLongTermMemoryFileName(left.name);
    const rightLongTerm = isLongTermMemoryFileName(right.name);
    if (leftLongTerm || rightLongTerm) {
      if (leftLongTerm && rightLongTerm) {
        const priorityDiff =
          getLongTermMemoryFilePriority(left.name) - getLongTermMemoryFilePriority(right.name);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        return left.name.localeCompare(right.name);
      }
      return leftLongTerm ? -1 : 1;
    }
    const leftUpdatedAt = left.updatedAtMs ?? 0;
    const rightUpdatedAt = right.updatedAtMs ?? 0;
    if (leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }
    return left.name.localeCompare(right.name);
  });

  return files;
}

async function listAgentFiles(
  workspaceDir: string,
  options?: { hideBootstrap?: boolean; scope?: AgentFilesScope },
) {
  if (options?.scope === "memory") {
    return await listAgentMemoryFiles(workspaceDir);
  }

  const files: Array<{
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  }> = [];

  const bootstrapFileNames = options?.hideBootstrap
    ? BOOTSTRAP_FILE_NAMES_POST_ONBOARDING
    : BOOTSTRAP_FILE_NAMES;
  for (const name of bootstrapFileNames) {
    const resolved = await resolveAgentWorkspaceFilePath({
      workspaceDir,
      name,
      allowMissing: true,
    });
    const filePath = resolved.requestPath;
    const meta =
      resolved.kind === "ready"
        ? await statFileSafely(resolved.ioPath)
        : resolved.kind === "missing"
          ? null
          : null;
    if (meta) {
      files.push({
        name,
        path: filePath,
        missing: false,
        size: meta.size,
        updatedAtMs: meta.updatedAtMs,
      });
    } else {
      files.push({ name, path: filePath, missing: true });
    }
  }

  const primaryResolved = await resolveAgentWorkspaceFilePath({
    workspaceDir,
    name: DEFAULT_MEMORY_FILENAME,
    allowMissing: true,
  });
  const primaryMeta =
    primaryResolved.kind === "ready" ? await statFileSafely(primaryResolved.ioPath) : null;
  if (primaryMeta) {
    files.push({
      name: DEFAULT_MEMORY_FILENAME,
      path: primaryResolved.requestPath,
      missing: false,
      size: primaryMeta.size,
      updatedAtMs: primaryMeta.updatedAtMs,
    });
  } else {
    files.push({
      name: DEFAULT_MEMORY_FILENAME,
      path: primaryResolved.requestPath,
      missing: true,
    });
  }

  return files;
}

function resolveAgentIdOrError(agentIdRaw: string, cfg: ReturnType<typeof loadConfig>) {
  const agentId = normalizeAgentId(agentIdRaw);
  const allowed = new Set(listAgentIds(cfg));
  if (!allowed.has(agentId)) {
    return null;
  }
  return agentId;
}

function sanitizeIdentityLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveOptionalStringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function respondInvalidMethodParams(
  respond: RespondFn,
  method: string,
  errors: Parameters<typeof formatValidationErrors>[0],
): void {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(errors)}`,
    ),
  );
}

function isConfiguredAgent(cfg: ReturnType<typeof loadConfig>, agentId: string): boolean {
  return findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0;
}

function respondAgentNotFound(respond: RespondFn, agentId: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `agent "${agentId}" not found`));
}

async function moveToTrashBestEffort(pathname: string): Promise<void> {
  if (!pathname) {
    return;
  }
  try {
    await fs.access(pathname);
  } catch {
    return;
  }
  try {
    await movePathToTrash(pathname);
  } catch {
    // Best-effort: path may already be gone or trash unavailable.
  }
}

function respondWorkspaceFileInvalid(respond: RespondFn, name: string, reason: string): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `unsafe workspace file "${name}" (${reason})`),
  );
}

async function resolveWorkspaceFilePathOrRespond(params: {
  respond: RespondFn;
  workspaceDir: string;
  name: string;
}): Promise<ResolvedWorkspaceFilePath | undefined> {
  const resolvedPath = await agentsHandlerDeps.resolveAgentWorkspaceFilePath({
    workspaceDir: params.workspaceDir,
    name: params.name,
    allowMissing: true,
  });
  if (resolvedPath.kind === "invalid") {
    respondWorkspaceFileInvalid(params.respond, params.name, resolvedPath.reason);
    return undefined;
  }
  return resolvedPath;
}

function respondWorkspaceFileUnsafe(respond: RespondFn, name: string): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `unsafe workspace file "${name}"`),
  );
}

function respondWorkspaceFileMissing(params: {
  respond: RespondFn;
  agentId: string;
  workspaceDir: string;
  name: string;
  filePath: string;
}): void {
  params.respond(
    true,
    {
      agentId: params.agentId,
      workspace: params.workspaceDir,
      file: { name: params.name, path: params.filePath, missing: true },
    },
    undefined,
  );
}

async function ensureWorkspaceFileReadyOrRespond(params: {
  respond: RespondFn;
  workspaceDir: string;
  name: string;
}): Promise<boolean> {
  await fs.mkdir(params.workspaceDir, { recursive: true });
  const resolvedPath = await resolveWorkspaceFilePathOrRespond(params);
  return resolvedPath !== undefined;
}

async function appendWorkspaceFileOrRespond(params: {
  respond: RespondFn;
  workspaceDir: string;
  name: string;
  content: string;
}): Promise<boolean> {
  try {
    await agentsHandlerDeps.appendFileWithinRoot({
      rootDir: params.workspaceDir,
      relativePath: params.name,
      data: params.content,
      encoding: "utf8",
    });
  } catch (err) {
    if (err instanceof SafeOpenError) {
      respondWorkspaceFileUnsafe(params.respond, params.name);
      return false;
    }
    throw err;
  }
  return true;
}

export const agentsHandlers: GatewayRequestHandlers = {
  "agents.list": async ({ params, respond }) => {
    if (!validateAgentsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.list params: ${formatValidationErrors(validateAgentsListParams.errors)}`,
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const result = listAgentsForGateway(cfg);
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const agents = await Promise.all(
      result.agents.map(async (agent) => {
        const workspaceDir = resolveAccountScopedWorkspaceForAgent({
          cfg,
          agentId: agent.id,
          accountId: accountContext.canonical.accountId,
        });
        return {
          ...agent,
          workspace: workspaceDir,
          personalContext: await readPersonalContextSummary({
            cfg,
            agentId: agent.id,
            workspaceDir,
            mainKey: result.mainKey,
            ...buildGatewayPersonalContextScope(accountContext),
          }),
        };
      }),
    );
    respond(
      true,
      {
        ...result,
        agents,
      },
      undefined,
    );
  },
  "agents.create": async ({ params, respond }) => {
    if (!validateAgentsCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.create params: ${formatValidationErrors(
            validateAgentsCreateParams.errors,
          )}`,
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const rawName = String(params.name ?? "").trim();
    const agentId = normalizeAgentId(rawName);
    if (agentId === DEFAULT_AGENT_ID) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `"${DEFAULT_AGENT_ID}" is reserved`),
      );
      return;
    }

    if (findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent "${agentId}" already exists`),
      );
      return;
    }

    const workspaceRootDir = resolveUserPath(String(params.workspace ?? "").trim());
    const workspaceDir = resolveAccountScopedWorkspaceForAgent({
      cfg: {
        ...cfg,
        agents: {
          ...cfg.agents,
          list: [...(cfg.agents?.list ?? []), { id: agentId, workspace: workspaceRootDir }],
        },
      },
      agentId,
      accountId: accountContext.canonical.accountId,
    });

    // Resolve agentDir against the config we're about to persist (vs the pre-write config),
    // so subsequent resolutions can't disagree about the agent's directory.
    let nextConfig = applyAgentConfig(cfg, {
      agentId,
      name: rawName,
      workspace: workspaceRootDir,
    });
    const agentDir = resolveAgentDir(nextConfig, agentId);
    nextConfig = applyAgentConfig(nextConfig, { agentId, agentDir });

    // Ensure workspace & transcripts exist BEFORE writing config so a failure
    // here does not leave a broken config entry behind.
    const skipBootstrap = Boolean(nextConfig.agents?.defaults?.skipBootstrap);
    await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: !skipBootstrap });
    await fs.mkdir(resolveSessionTranscriptsDirForAgent(agentId), { recursive: true });

    // Always write Name to IDENTITY.md; optionally include emoji/avatar.
    const safeName = sanitizeIdentityLine(rawName);
    const emoji = resolveOptionalStringParam(params.emoji);
    const avatar = resolveOptionalStringParam(params.avatar);
    const lines = [
      "",
      `- Name: ${safeName}`,
      ...(emoji ? [`- Emoji: ${sanitizeIdentityLine(emoji)}`] : []),
      ...(avatar ? [`- Avatar: ${sanitizeIdentityLine(avatar)}`] : []),
      "",
    ];
    if (
      !(await ensureWorkspaceFileReadyOrRespond({
        respond,
        workspaceDir,
        name: DEFAULT_IDENTITY_FILENAME,
      }))
    ) {
      return;
    }

    if (
      !(await appendWorkspaceFileOrRespond({
        respond,
        workspaceDir,
        name: DEFAULT_IDENTITY_FILENAME,
        content: lines.join("\n"),
      }))
    ) {
      return;
    }

    await writeConfigFile(nextConfig);

    respond(true, { ok: true, agentId, name: rawName, workspace: workspaceDir }, undefined);
  },
  "agents.update": async ({ params, respond }) => {
    if (!validateAgentsUpdateParams(params)) {
      respondInvalidMethodParams(respond, "agents.update", validateAgentsUpdateParams.errors);
      return;
    }

    const cfg = loadConfig();
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const agentId = normalizeAgentId(String(params.agentId ?? ""));
    if (!isConfiguredAgent(cfg, agentId)) {
      respondAgentNotFound(respond, agentId);
      return;
    }

    const workspaceRootDir =
      typeof params.workspace === "string" && params.workspace.trim()
        ? resolveUserPath(params.workspace.trim())
        : undefined;

    const model = resolveOptionalStringParam(params.model);
    const avatar = resolveOptionalStringParam(params.avatar);

    const nextConfig = applyAgentConfig(cfg, {
      agentId,
      ...(typeof params.name === "string" && params.name.trim()
        ? { name: params.name.trim() }
        : {}),
      ...(workspaceRootDir ? { workspace: workspaceRootDir } : {}),
      ...(model ? { model } : {}),
    });

    if (workspaceRootDir) {
      const skipBootstrap = Boolean(nextConfig.agents?.defaults?.skipBootstrap);
      await ensureAgentWorkspace({
        dir: resolveAccountScopedWorkspaceForAgent({
          cfg: nextConfig,
          agentId,
          accountId: accountContext.canonical.accountId,
        }),
        ensureBootstrapFiles: !skipBootstrap,
      });
    }

    const identityWorkspaceDir = avatar
      ? resolveAccountScopedWorkspaceForAgent({
          cfg: nextConfig,
          agentId,
          accountId: accountContext.canonical.accountId,
        })
      : undefined;
    if (
      identityWorkspaceDir &&
      !(await ensureWorkspaceFileReadyOrRespond({
        respond,
        workspaceDir: identityWorkspaceDir,
        name: DEFAULT_IDENTITY_FILENAME,
      }))
    ) {
      return;
    }

    if (avatar) {
      if (!identityWorkspaceDir) {
        respondWorkspaceFileUnsafe(respond, DEFAULT_IDENTITY_FILENAME);
        return;
      }
      if (
        !(await appendWorkspaceFileOrRespond({
          respond,
          workspaceDir: identityWorkspaceDir,
          name: DEFAULT_IDENTITY_FILENAME,
          content: `\n- Avatar: ${sanitizeIdentityLine(avatar)}\n`,
        }))
      ) {
        return;
      }
    }

    await writeConfigFile(nextConfig);

    respond(true, { ok: true, agentId }, undefined);
  },
  "agents.delete": async ({ params, respond }) => {
    if (!validateAgentsDeleteParams(params)) {
      respondInvalidMethodParams(respond, "agents.delete", validateAgentsDeleteParams.errors);
      return;
    }

    const cfg = loadConfig();
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const agentId = normalizeAgentId(String(params.agentId ?? ""));
    if (agentId === DEFAULT_AGENT_ID) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `"${DEFAULT_AGENT_ID}" cannot be deleted`),
      );
      return;
    }
    if (!isConfiguredAgent(cfg, agentId)) {
      respondAgentNotFound(respond, agentId);
      return;
    }

    const deleteFiles = typeof params.deleteFiles === "boolean" ? params.deleteFiles : true;
    const workspaceDir = resolveAccountScopedWorkspaceForAgent({
      cfg,
      agentId,
      accountId: accountContext.canonical.accountId,
    });
    const agentDir = resolveAgentDir(cfg, agentId);
    const sessionsDir = resolveSessionTranscriptsDirForAgent(agentId);

    const result = pruneAgentConfig(cfg, agentId);
    await writeConfigFile(result.config);

    if (deleteFiles) {
      await Promise.all([
        moveToTrashBestEffort(workspaceDir),
        moveToTrashBestEffort(agentDir),
        moveToTrashBestEffort(sessionsDir),
      ]);
    }

    respond(true, { ok: true, agentId, removedBindings: result.removedBindings }, undefined);
  },
  "agents.files.list": async ({ params, respond }) => {
    if (!validateAgentsFilesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.list params: ${formatValidationErrors(
            validateAgentsFilesListParams.errors,
          )}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const agentId = resolveAgentIdOrError(String(params.agentId ?? ""), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    const workspaceDir = resolveAccountScopedWorkspaceForAgent({
      cfg,
      agentId,
      accountId: accountContext.canonical.accountId,
    });
    let hideBootstrap = false;
    try {
      hideBootstrap = await agentsHandlerDeps.isWorkspaceSetupCompleted(workspaceDir);
    } catch {
      // Fall back to showing BOOTSTRAP if workspace state cannot be read.
    }
    const scope = params.scope === "memory" ? "memory" : "core";
    const files = await listAgentFiles(workspaceDir, { hideBootstrap, scope });
    respond(true, { agentId, workspace: workspaceDir, files }, undefined);
  },
  "agents.files.get": async ({ params, respond }) => {
    if (!validateAgentsFilesGetParams(params)) {
      respondInvalidMethodParams(respond, "agents.files.get", validateAgentsFilesGetParams.errors);
      return;
    }
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const resolved = resolveAgentWorkspaceFileOrRespondError(params, respond, {
      allowMemoryNotes: true,
      accountId: accountContext.canonical.accountId,
    });
    if (!resolved) {
      return;
    }
    const { agentId, workspaceDir, name } = resolved;
    const resolvedPath = await resolveWorkspaceFilePathOrRespond({
      respond,
      workspaceDir,
      name,
    });
    if (!resolvedPath) {
      return;
    }
    const filePath = resolvedPath.requestPath;
    if (resolvedPath.kind === "missing") {
      respondWorkspaceFileMissing({ respond, agentId, workspaceDir, name, filePath });
      return;
    }
    let safeRead: Awaited<ReturnType<typeof readLocalFileSafely>>;
    try {
      safeRead = await agentsHandlerDeps.readLocalFileSafely({ filePath: resolvedPath.ioPath });
    } catch (err) {
      if (err instanceof SafeOpenError && err.code === "not-found") {
        respondWorkspaceFileMissing({ respond, agentId, workspaceDir, name, filePath });
        return;
      }
      respondWorkspaceFileUnsafe(respond, name);
      return;
    }
    respond(
      true,
      {
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: filePath,
          missing: false,
          size: safeRead.stat.size,
          updatedAtMs: Math.floor(safeRead.stat.mtimeMs),
          content: safeRead.buffer.toString("utf-8"),
        },
      },
      undefined,
    );
  },
  "agents.files.set": async ({ params, respond }) => {
    if (!validateAgentsFilesSetParams(params)) {
      respondInvalidMethodParams(respond, "agents.files.set", validateAgentsFilesSetParams.errors);
      return;
    }
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const resolved = resolveAgentWorkspaceFileOrRespondError(params, respond, {
      allowMemoryNotes: true,
      accountId: accountContext.canonical.accountId,
    });
    if (!resolved) {
      return;
    }
    const { agentId, workspaceDir, name } = resolved;
    await fs.mkdir(workspaceDir, { recursive: true });
    const resolvedPath = await resolveWorkspaceFilePathOrRespond({
      respond,
      workspaceDir,
      name,
    });
    if (!resolvedPath) {
      return;
    }
    const filePath = resolvedPath.requestPath;
    const content = String(params.content ?? "");
    const writeRootDir = resolvedPath.rootReal;
    const relativeWritePath = path.relative(writeRootDir, resolvedPath.ioPath);
    if (
      !relativeWritePath ||
      relativeWritePath.startsWith("..") ||
      path.isAbsolute(relativeWritePath)
    ) {
      respondWorkspaceFileUnsafe(respond, name);
      return;
    }
    try {
      await agentsHandlerDeps.writeFileWithinRoot({
        rootDir: writeRootDir,
        relativePath: relativeWritePath,
        data: content,
        encoding: "utf8",
      });
    } catch {
      respondWorkspaceFileUnsafe(respond, name);
      return;
    }
    const meta = await statFileSafely(resolvedPath.ioPath);
    respond(
      true,
      {
        ok: true,
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: filePath,
          missing: false,
          size: meta?.size,
          updatedAtMs: meta?.updatedAtMs,
          content,
        },
      },
      undefined,
    );
  },
  "agents.files.delete": async ({ params, respond }) => {
    if (!validateAgentsFilesDeleteParams(params)) {
      respondInvalidMethodParams(
        respond,
        "agents.files.delete",
        validateAgentsFilesDeleteParams.errors,
      );
      return;
    }
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const resolved = resolveAgentWorkspaceFileOrRespondError(params, respond, {
      allowMemoryNotes: true,
      accountId: accountContext.canonical.accountId,
    });
    if (!resolved) {
      return;
    }
    const { agentId, workspaceDir, name } = resolved;
    if (!isAllowedMemoryNoteFileName(name)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `cannot delete durable memory file "${name}"; clear its contents instead`,
        ),
      );
      return;
    }

    const resolvedPath = await resolveWorkspaceFilePathOrRespond({
      respond,
      workspaceDir,
      name,
    });
    if (!resolvedPath) {
      return;
    }
    if (resolvedPath.kind === "missing") {
      respond(
        true,
        { ok: true, agentId, workspace: workspaceDir, name, deleted: false },
        undefined,
      );
      return;
    }

    try {
      await fs.unlink(resolvedPath.ioPath);
    } catch (err) {
      if (isNotFoundPathError(err)) {
        respond(
          true,
          { ok: true, agentId, workspace: workspaceDir, name, deleted: false },
          undefined,
        );
        return;
      }
      respondWorkspaceFileUnsafe(respond, name);
      return;
    }

    respond(true, { ok: true, agentId, workspace: workspaceDir, name, deleted: true }, undefined);
  },
};
