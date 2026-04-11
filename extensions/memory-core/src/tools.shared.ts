import { Type } from "@sinclair/typebox";
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

export const MemoryGraphSchema = Type.Object({
  query: Type.String(),
  direction: Type.Optional(
    Type.Union([Type.Literal("incoming"), Type.Literal("outgoing"), Type.Literal("both")]),
  ),
  matchLimit: Type.Optional(Type.Number()),
  relationLimit: Type.Optional(Type.Number()),
});

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
  query: string;
  error: string | undefined;
}) {
  const reason = (params.error ?? "canonical memory graph unavailable").trim();
  return {
    query: params.query,
    matches: [],
    disabled: true,
    unavailable: true,
    error: reason || "canonical memory graph unavailable",
  };
}
