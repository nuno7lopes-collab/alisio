import {
  jsonResult,
  readNumberParam,
  readStringParam,
  type AnyAgentTool,
  type OpenClawConfig,
} from "alisio/plugin-sdk/memory-core-host-runtime-core";
import {
  queryCanonicalMemoryGraph,
  type CanonicalMemoryStoreStatus,
} from "./memory/canonical-store.js";
import {
  clampResultsByInjectedChars,
  decorateCitations,
  resolveMemoryCitationsMode,
  shouldIncludeCitations,
} from "./tools.citations.js";
import {
  buildMemorySearchUnavailableResult,
  buildMemoryGraphUnavailableResult,
  createMemoryTool,
  getMemoryManagerContext,
  getMemoryManagerContextWithPurpose,
  loadMemoryToolRuntime,
  MemoryGetSchema,
  MemoryGraphSchema,
  MemorySearchSchema,
} from "./tools.shared.js";

export function createMemorySearchTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createMemoryTool({
    options,
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search configured durable memory files (legacy MEMORY.md + memory/*.md, any configured Obsidian memory directory, and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines. If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.",
    parameters: MemorySearchSchema,
    execute:
      ({ cfg, agentId }) =>
      async (_toolCallId, params) => {
        const query = readStringParam(params, "query", { required: true });
        const maxResults = readNumberParam(params, "maxResults");
        const minScore = readNumberParam(params, "minScore");
        const { resolveMemoryBackendConfig } = await loadMemoryToolRuntime();
        const memory = await getMemoryManagerContext({ cfg, agentId });
        if ("error" in memory) {
          return jsonResult(buildMemorySearchUnavailableResult(memory.error));
        }
        try {
          const citationsMode = resolveMemoryCitationsMode(cfg);
          const includeCitations = shouldIncludeCitations({
            mode: citationsMode,
            sessionKey: options.agentSessionKey,
          });
          const rawResults = await memory.manager.search(query, {
            maxResults,
            minScore,
            sessionKey: options.agentSessionKey,
          });
          const status = memory.manager.status();
          const decorated = decorateCitations(rawResults, includeCitations);
          const resolved = resolveMemoryBackendConfig({ cfg, agentId });
          const results =
            status.backend === "qmd"
              ? clampResultsByInjectedChars(decorated, resolved.qmd?.limits.maxInjectedChars)
              : decorated;
          const searchMode = (status.custom as { searchMode?: string } | undefined)?.searchMode;
          return jsonResult({
            results,
            provider: status.provider,
            model: status.model,
            fallback: status.fallback,
            citations: citationsMode,
            mode: searchMode,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult(buildMemorySearchUnavailableResult(message));
        }
      },
  });
}

export function createMemoryGetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createMemoryTool({
    options,
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from configured memory Markdown files with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute:
      ({ cfg, agentId }) =>
      async (_toolCallId, params) => {
        const relPath = readStringParam(params, "path", { required: true });
        const from = readNumberParam(params, "from", { integer: true });
        const lines = readNumberParam(params, "lines", { integer: true });
        const { readAgentMemoryFile, resolveMemoryBackendConfig } = await loadMemoryToolRuntime();
        const resolved = resolveMemoryBackendConfig({ cfg, agentId });
        if (resolved.backend === "builtin") {
          try {
            const result = await readAgentMemoryFile({
              cfg,
              agentId,
              relPath,
              from: from ?? undefined,
              lines: lines ?? undefined,
            });
            return jsonResult(result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return jsonResult({ path: relPath, text: "", disabled: true, error: message });
          }
        }
        const memory = await getMemoryManagerContextWithPurpose({
          cfg,
          agentId,
          purpose: "status",
        });
        if ("error" in memory) {
          return jsonResult({ path: relPath, text: "", disabled: true, error: memory.error });
        }
        try {
          const result = await memory.manager.readFile({
            relPath,
            from: from ?? undefined,
            lines: lines ?? undefined,
          });
          return jsonResult(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult({ path: relPath, text: "", disabled: true, error: message });
        }
      },
  });
}

export function createMemoryGraphTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createMemoryTool({
    options,
    label: "Memory Graph",
    name: "memory_graph",
    description:
      "Inspect the structured canonical memory graph under the Markdown/Obsidian projection; resolves note entities and explicit relations for navigation, dependency tracing, and memory link inspection.",
    parameters: MemoryGraphSchema,
    execute:
      ({ cfg, agentId }) =>
      async (_toolCallId, params) => {
        const query = readStringParam(params, "query", { required: true });
        const rawDirection = readStringParam(params, "direction");
        const matchLimit = readNumberParam(params, "matchLimit", { integer: true });
        const relationLimit = readNumberParam(params, "relationLimit", { integer: true });
        const direction =
          rawDirection === "incoming" || rawDirection === "outgoing" || rawDirection === "both"
            ? rawDirection
            : undefined;
        const memory = await getMemoryManagerContext({ cfg, agentId });
        if ("error" in memory) {
          return jsonResult(buildMemoryGraphUnavailableResult({ query, error: memory.error }));
        }
        try {
          const initialStatus = memory.manager.status();
          const initialCanonical = (initialStatus.custom?.canonicalStore ??
            null) as CanonicalMemoryStoreStatus | null;
          if (memory.manager.sync && (initialStatus.dirty || initialCanonical?.state !== "ready")) {
            await memory.manager.sync({ reason: "canonical-graph" });
          }
          const status = memory.manager.status();
          const canonicalStore = (status.custom?.canonicalStore ??
            null) as CanonicalMemoryStoreStatus | null;
          if (!canonicalStore) {
            return jsonResult(
              buildMemoryGraphUnavailableResult({
                query,
                error: "canonical memory store unavailable",
              }),
            );
          }
          return jsonResult(
            queryCanonicalMemoryGraph({
              status: canonicalStore,
              query,
              ...(direction ? { direction } : {}),
              ...(typeof matchLimit === "number" ? { matchLimit } : {}),
              ...(typeof relationLimit === "number" ? { relationLimit } : {}),
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult(buildMemoryGraphUnavailableResult({ query, error: message }));
        }
      },
  });
}
