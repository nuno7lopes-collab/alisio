import { Type } from "@sinclair/typebox";
import { optionalStringEnum } from "alisio/plugin-sdk/core";
import {
  resolveMemorySearchConfig,
  resolveSessionAgentId,
  type AnyAgentTool,
  type AlisioConfig,
} from "alisio/plugin-sdk/memory-core-host-runtime-core";

type MemoryToolRuntime = typeof import("./tools.runtime.js");
type MemorySearchManagerResult = Awaited<
  ReturnType<(typeof import("./memory/index.js"))["getMemorySearchManager"]>
>;

let memoryToolRuntimePromise: Promise<MemoryToolRuntime> | null = null;

export async function loadMemoryToolRuntime(): Promise<MemoryToolRuntime> {
  memoryToolRuntimePromise ??= import("./tools.runtime.js");
  return await memoryToolRuntimePromise;
}

export const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
});

export const MemoryGetSchema = Type.Object({
  projectionId: Type.Optional(Type.String()),
  pageId: Type.Optional(Type.String()),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

export const MemoryGraphScopeInputValues = [
  "overview",
  "focus",
  "global",
  "local",
] as const;

export type MemoryGraphScopeInput = (typeof MemoryGraphScopeInputValues)[number];
export type MemoryGraphCanonicalScope = "global" | "local";
export type MemoryGraphMode = "overview" | "focus";

export const MemoryGraphSchema = Type.Object({
  query: Type.Optional(Type.String()),
  pageId: Type.Optional(Type.String()),
  entityId: Type.Optional(Type.String()),
  scope: optionalStringEnum(MemoryGraphScopeInputValues),
  direction: optionalStringEnum(["incoming", "outgoing", "both"] as const),
  depth: Type.Optional(Type.Integer({ minimum: 1 })),
  matchLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  relationLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  nodeLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  edgeLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  includeAttachments: Type.Optional(Type.Boolean()),
});

export function normalizeMemoryGraphScope(
  value: unknown,
): MemoryGraphCanonicalScope | undefined {
  if (value === "overview" || value === "global") {
    return "global";
  }
  if (value === "focus" || value === "local") {
    return "local";
  }
  return undefined;
}

export function resolveMemoryGraphMode(scope: MemoryGraphCanonicalScope): MemoryGraphMode {
  return scope === "global" ? "overview" : "focus";
}

export function hasMemoryGraphFocusHint(params: {
  query?: string;
  pageId?: string;
  entityId?: string;
}): boolean {
  return Boolean(params.query || params.pageId || params.entityId);
}

export function requiresMemoryGraphFocusHint(params: {
  scope?: MemoryGraphCanonicalScope;
  query?: string;
  pageId?: string;
  entityId?: string;
}): boolean {
  return params.scope === "local" && !hasMemoryGraphFocusHint(params);
}

export function getMemoryGraphFocusScopeError(): string {
  return "memory.graph focus scope requires pageId, entityId, or query";
}

export function getMemoryGraphScopeValueError(): string {
  return "memory.graph scope must be overview, focus, global, or local";
}

export function resolveMemoryToolContext(options: {
  config?: AlisioConfig;
  agentSessionKey?: string;
}) {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return { cfg, agentId };
}

export async function getMemoryManagerContext(params: {
  cfg: AlisioConfig;
  agentId: string;
}): Promise<
  | {
      manager: NonNullable<MemorySearchManagerResult["manager"]>;
    }
  | {
      error: string | undefined;
    }
> {
  return await getMemoryManagerContextWithPurpose({ ...params, purpose: undefined });
}

export async function getMemoryManagerContextWithPurpose(params: {
  cfg: AlisioConfig;
  agentId: string;
  purpose?: "default" | "status";
}): Promise<
  | {
      manager: NonNullable<MemorySearchManagerResult["manager"]>;
    }
  | {
      error: string | undefined;
    }
> {
  const { getMemorySearchManager } = await loadMemoryToolRuntime();
  const { manager, error } = await getMemorySearchManager({
    cfg: params.cfg,
    agentId: params.agentId,
    purpose: params.purpose,
  });
  return manager ? { manager } : { error };
}

export function createMemoryTool(params: {
  options: {
    config?: AlisioConfig;
    agentSessionKey?: string;
  };
  label: string;
  name: string;
  description: string;
  parameters: typeof MemorySearchSchema | typeof MemoryGetSchema | typeof MemoryGraphSchema;
  execute: (ctx: { cfg: AlisioConfig; agentId: string }) => AnyAgentTool["execute"];
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(params.options);
  if (!ctx) {
    return null;
  }
  return {
    label: params.label,
    name: params.name,
    description: params.description,
    parameters: params.parameters,
    execute: params.execute(ctx),
  };
}

export function buildMemorySearchUnavailableResult(error: string | undefined) {
  const reason = (error ?? "memory search unavailable").trim() || "memory search unavailable";
  const lowered = reason.toLowerCase();
  const isQuotaError = /insufficient_quota|quota|429/.test(lowered);
  const isNativeStoreError =
    /native canonical memory store unavailable|canonical memory store unavailable/.test(lowered);
  const warning = isQuotaError
    ? "Memory search is unavailable because the embedding provider quota is exhausted."
    : isNativeStoreError
      ? "Memory retrieval is unavailable because the native canonical store is unavailable."
      : "Memory retrieval is unavailable due to a native retrieval error.";
  const action = isQuotaError
    ? "Top up or switch embedding provider, then retry memory_search."
    : isNativeStoreError
      ? "Repair or resync the canonical memory store, then retry memory_search."
      : "Check native memory retrieval configuration and retry memory_search.";
  return {
    results: [],
    disabled: true,
    unavailable: true,
    error: reason,
    warning,
    action,
  };
}

export function buildMemoryGraphUnavailableResult(params: {
  query?: string;
  error: string | undefined;
}) {
  const reason = (params.error ?? "canonical memory graph unavailable").trim();
  return {
    query: params.query ?? "",
    matches: [],
    disabled: true,
    unavailable: true,
    error: reason || "canonical memory graph unavailable",
  };
}
