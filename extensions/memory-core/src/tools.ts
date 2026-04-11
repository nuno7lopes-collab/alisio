import {
  requireNodeSqlite,
  type MemorySearchManager,
  type MemorySearchResult,
} from "alisio/plugin-sdk/memory-core-host-engine-storage";
import {
  jsonResult,
  loadOrCreateDeviceIdentity,
  readNumberParam,
  readStringParam,
  resolveStateDir,
  type AnyAgentTool,
  type AlisioConfig,
} from "alisio/plugin-sdk/memory-core-host-runtime-core";
import { openLedger } from "../../../packages/memory-ledger/src/index.js";
import {
  MEMORY_SCHEMA_VERSION,
  createCanonicalStableId,
} from "../../../packages/memory-schema/src/index.js";
import {
  createDisabledShareGrantStore,
  createMemoryService,
  estimateTokenCount,
  isPrivateMemoryAllowed,
  type GaiaMemoryFacade,
  type MemoryContextItem,
  type MemoryRetrievalTrace,
  type RetrievalScoreBreakdown,
} from "../../../packages/memory-service/src/index.js";
import {
  queryCanonicalMemoryGraph,
  type CanonicalMemoryGraphResult,
  type CanonicalMemoryStoreStatus,
} from "./memory/canonical-store.js";
import {
  clampResultsByInjectedChars,
  decorateCitations,
  resolveMemoryCitationsMode,
  shouldIncludeCitations,
} from "./tools.citations.js";
import {
  buildMemoryGraphUnavailableResult,
  buildMemorySearchUnavailableResult,
  createMemoryTool,
  getMemoryManagerContext,
  getMemoryManagerContextWithPurpose,
  loadMemoryToolRuntime,
  MemoryGetSchema,
  MemoryGraphSchema,
  MemorySearchSchema,
} from "./tools.shared.js";

type ToolSearchResult = MemorySearchResult & {
  layer?: "L1" | "L2" | "L3";
  reasonCodes?: string[];
  scoreBreakdown?: RetrievalScoreBreakdown;
  provenance?: {
    sourceLocator: string;
    evidenceIds: string[];
  };
  pageId?: string;
  projectionId?: string;
};

type CanonicalProjectionRecord = {
  projectionId: string;
  pageId: string;
  path: string;
  sourceKind: string;
  editable: boolean;
  title?: string;
  markdownBody?: string;
  frontmatterJson?: string;
  updatedAt?: string;
  metadataJson?: string;
};

type CanonicalStoreReader = {
  status: CanonicalMemoryStoreStatus;
  findProjectionByPath(path: string): CanonicalProjectionRecord | null;
  findProjectionByProjectionId(projectionId: string): CanonicalProjectionRecord | null;
  findProjectionByPageId(pageId: string): CanonicalProjectionRecord | null;
  listPinnedAndRecent(query: string, limit: number): CanonicalProjectionRecord[];
  close(): void;
};

type GaiaDerivedGraphRelation =
  CanonicalMemoryGraphResult["matches"][number]["relations"][number] & {
    relatedEntity?: CanonicalMemoryGraphResult["matches"][number]["relations"][number]["relatedEntity"] & {
      pageId: string;
    };
  };

type GaiaDerivedGraphMatch = Omit<
  CanonicalMemoryGraphResult["matches"][number],
  "projections" | "relations"
> & {
  pageId: string;
  projections: Array<
    CanonicalMemoryGraphResult["matches"][number]["projections"][number] & { pageId: string }
  >;
  relations: GaiaDerivedGraphRelation[];
};

const textEncoder = new TextEncoder();
const GAIA_LEDGER_STATE_KEY = "__alisioMemoryRetrievalLedgerState";

export function createMemorySearchTool(options: {
  config?: AlisioConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createMemoryTool({
    options,
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: assemble layered native memory context from always-visible policy blocks, working-set events, derived claims, and searchable projections before answering questions about prior work, decisions, dates, people, preferences, or todos; returns explainable snippets with stable locators. If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.",
    parameters: MemorySearchSchema,
    execute:
      ({ cfg, agentId }) =>
      async (toolCallId, params) => {
        const startedAtMs = Date.now();
        const query = readStringParam(params, "query", { required: true });
        const maxResults = readNumberParam(params, "maxResults");
        const minScore = readNumberParam(params, "minScore");
        const { resolveMemoryBackendConfig } = await loadMemoryToolRuntime();
        const resolved = resolveMemoryBackendConfig({ cfg, agentId });
        const flags = resolveRetrievalFlags(cfg);
        const fallbackProfileId = `agent:${agentId}`;
        const gaia = createGaiaFacade({
          cfg,
          profileId: fallbackProfileId,
          toolCallId,
          sessionKey: options.agentSessionKey,
          enabled: flags.tracingEnabled,
        });
        const memory = await getMemoryManagerContext({ cfg, agentId });
        if ("error" in memory) {
          await recordSimpleRetrievalTrace({
            gaia,
            profileId: fallbackProfileId,
            agentId,
            sessionKey: options.agentSessionKey,
            reason: "manager_unavailable",
            selectedCount: 0,
            deniedCount: 0,
            budgetTokens: 0,
            startedAtMs,
          });
          return jsonResult(buildMemorySearchUnavailableResult(memory.error));
        }

        const status = memory.manager.status();
        const citationsMode = resolveMemoryCitationsMode(cfg);
        const includeCitations = shouldIncludeCitations({
          mode: citationsMode,
          sessionKey: options.agentSessionKey,
        });
        const canonicalStore = await ensureCanonicalStoreReady(
          memory.manager,
          "memory-service-search",
        );
        const reader = openCanonicalStoreReader(canonicalStore);
        const profileId = canonicalStore?.profileId ?? fallbackProfileId;
        const toolGaia =
          profileId === fallbackProfileId
            ? gaia
            : createGaiaFacade({
                cfg,
                profileId,
                toolCallId,
                sessionKey: options.agentSessionKey,
                enabled: flags.tracingEnabled,
              });

        try {
          const searchPromise = memory.manager.search(query, {
            maxResults: expandCandidateLimit(maxResults),
            minScore,
            sessionKey: options.agentSessionKey,
          });
          const service = createMemoryService({
            gaia: toolGaia,
            grants: createDisabledShareGrantStore(),
            flags,
            layers: {
              alwaysVisible: async () =>
                buildAlwaysVisibleBlocks({
                  profileId: canonicalStore?.profileId ?? `agent:${agentId}`,
                  agentId,
                  sessionKey: options.agentSessionKey,
                  privateOnlyEnabled: flags.privateOnlyEnabled,
                }),
              workingSet: async () =>
                await buildWorkingSetItems({
                  query,
                  maxResults,
                  searchPromise,
                  reader,
                }),
              structured: async () =>
                buildStructuredItems({
                  query,
                  canonicalStore,
                  matchLimit: expandCandidateLimit(maxResults),
                }),
              textSearch: async () =>
                await buildTextSearchItems({
                  searchPromise,
                  reader,
                }),
            },
          });
          const retrieval = await service.retrieveContext({
            profileId,
            agentId,
            sessionKey: options.agentSessionKey,
            queryText: query,
            budgets: {
              maxTokens: resolveSearchBudgetTokens(resolved.qmd?.limits.maxInjectedChars),
              maxItems: resolveSearchBudgetItems(maxResults),
            },
            modes: {
              includeWorkingSet: true,
              includeClaims: true,
              includePages: true,
              includeFiles: true,
            },
          });

          const rawResults = mapContextItemsToToolResults(
            retrieval.items.filter((item) => item.layer !== "L0"),
          );
          const decorated = decorateSearchResults(rawResults, includeCitations);
          const results =
            status.backend === "qmd"
              ? clampResultsByInjectedChars(decorated, resolved.qmd?.limits.maxInjectedChars)
              : decorated;
          const searchMode = (status.custom as { searchMode?: string } | undefined)?.searchMode;
          return jsonResult({
            results,
            trace: retrieval.trace,
            budgetUsed: retrieval.budgetUsed,
            provider: status.provider,
            model: status.model,
            fallback: status.fallback,
            citations: citationsMode,
            mode: "layered",
            backendMode: searchMode,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            const fallback = await buildFallbackSearchResult({
              manager: memory.manager,
              query,
              maxResults,
              minScore,
              sessionKey: options.agentSessionKey,
              privateOnlyEnabled: flags.privateOnlyEnabled,
              agentId,
              profileId,
              gaia: toolGaia,
              startedAtMs,
            });
            const decorated = decorateSearchResults(fallback.results, includeCitations);
            const results =
              status.backend === "qmd"
                ? clampResultsByInjectedChars(decorated, resolved.qmd?.limits.maxInjectedChars)
                : decorated;
            return jsonResult({
              results,
              trace: fallback.trace,
              budgetUsed: fallback.trace.budgetUsed,
              provider: status.provider,
              model: status.model,
              fallback: status.fallback,
              citations: citationsMode,
              mode: "fallback",
            });
          } catch {
            await recordSimpleRetrievalTrace({
              gaia: toolGaia,
              profileId,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "fallback_unavailable",
              selectedCount: 0,
              deniedCount: 0,
              budgetTokens: 0,
              startedAtMs,
            });
            return jsonResult(buildMemorySearchUnavailableResult(message));
          }
        } finally {
          reader?.close();
        }
      },
  });
}

export function createMemoryGetTool(options: {
  config?: AlisioConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createMemoryTool({
    options,
    label: "Memory Get",
    name: "memory_get",
    description:
      "Read a stable memory locator by projectionId or pageId, with optional from/lines, after memory_search narrowed the relevant page. Path fallback remains available for rollback and reduced-functionality mode.",
    parameters: MemoryGetSchema,
    execute:
      ({ cfg, agentId }) =>
      async (toolCallId, params) => {
        const startedAtMs = Date.now();
        const projectionId = readOptionalString(params, "projectionId");
        const pageId = readOptionalString(params, "pageId");
        const path = readOptionalString(params, "path");
        const from = readNumberParam(params, "from", { integer: true });
        const lines = readNumberParam(params, "lines", { integer: true });
        const { readAgentMemoryFile, resolveMemoryBackendConfig } = await loadMemoryToolRuntime();
        const resolved = resolveMemoryBackendConfig({ cfg, agentId });
        const flags = resolveRetrievalFlags(cfg);
        const gaia = createGaiaFacade({
          cfg,
          profileId: `agent:${agentId}`,
          toolCallId,
          sessionKey: options.agentSessionKey,
          enabled: flags.tracingEnabled,
        });
        if (!projectionId && !pageId && path && resolved.backend === "builtin") {
          const privateAllowed = isPrivateMemoryAllowed({
            sessionKey: options.agentSessionKey,
            agentId,
            profileId: `agent:${agentId}`,
            privateOnlyEnabled: flags.privateOnlyEnabled,
          });
          if (!privateAllowed && isSessionLikePath(path)) {
            await recordSimpleRetrievalTrace({
              gaia,
              profileId: `agent:${agentId}`,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "private_denied",
              selectedCount: 0,
              deniedCount: 1,
              budgetTokens: 0,
              startedAtMs,
            });
            return jsonResult({ text: "", path, disabled: true, error: "private memory denied" });
          }

          try {
            const result = await readAgentMemoryFile({
              cfg,
              agentId,
              relPath: path,
              from: from ?? undefined,
              lines: lines ?? undefined,
            });
            await recordSimpleRetrievalTrace({
              gaia,
              profileId: `agent:${agentId}`,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "path_fallback",
              selectedCount: result.text.trim() ? 1 : 0,
              deniedCount: 0,
              budgetTokens: estimateTokenCount(result.text),
              startedAtMs,
            });
            return jsonResult(result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await recordSimpleRetrievalTrace({
              gaia,
              profileId: `agent:${agentId}`,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "read_error",
              selectedCount: 0,
              deniedCount: 0,
              budgetTokens: 0,
              startedAtMs,
            });
            return jsonResult({ path, text: "", disabled: true, error: message });
          }
        }
        const memory = await getMemoryManagerContextWithPurpose({
          cfg,
          agentId,
          purpose: "status",
        });
        const canonicalStore =
          "manager" in memory ? await ensureCanonicalStoreReady(memory.manager) : null;
        const reader = openCanonicalStoreReader(canonicalStore);
        const resolvedRecord = resolveLocatorRecord(reader, {
          projectionId,
          pageId,
          path,
        });
        const relPath = resolvedRecord?.path ?? path;

        if (!relPath) {
          const error = "projectionId, pageId, or path is required";
          await recordSimpleRetrievalTrace({
            gaia,
            profileId: canonicalStore?.profileId ?? `agent:${agentId}`,
            agentId,
            sessionKey: options.agentSessionKey,
            reason: "stable_locator_missing",
            selectedCount: 0,
            deniedCount: 0,
            budgetTokens: 0,
            startedAtMs,
          });
          reader?.close();
          return jsonResult({ text: "", path: "", disabled: true, error });
        }

        try {
          const privateAllowed = isPrivateMemoryAllowed({
            sessionKey: options.agentSessionKey,
            agentId,
            profileId: canonicalStore?.profileId ?? `agent:${agentId}`,
            privateOnlyEnabled: flags.privateOnlyEnabled,
          });
          if (!privateAllowed && isSessionLikePath(relPath)) {
            await recordSimpleRetrievalTrace({
              gaia,
              profileId: canonicalStore?.profileId ?? `agent:${agentId}`,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "private_denied",
              selectedCount: 0,
              deniedCount: 1,
              budgetTokens: 0,
              startedAtMs,
            });
            return jsonResult({
              text: "",
              path: relPath,
              disabled: true,
              error: "private memory denied",
            });
          }

          let result: { text: string; path: string };
          if (resolved.backend === "builtin") {
            result = await readAgentMemoryFile({
              cfg,
              agentId,
              relPath,
              from: from ?? undefined,
              lines: lines ?? undefined,
            });
          } else if ("manager" in memory) {
            result = await memory.manager.readFile({
              relPath,
              from: from ?? undefined,
              lines: lines ?? undefined,
            });
          } else {
            throw new Error(memory.error ?? "memory manager unavailable");
          }

          await recordSimpleRetrievalTrace({
            gaia,
            profileId: canonicalStore?.profileId ?? `agent:${agentId}`,
            agentId,
            sessionKey: options.agentSessionKey,
            reason: resolvedRecord ? "stable_locator" : "path_fallback",
            selectedCount: result.text.trim() ? 1 : 0,
            deniedCount: 0,
            budgetTokens: estimateTokenCount(result.text),
            startedAtMs,
          });

          return jsonResult({
            ...result,
            ...(resolvedRecord?.pageId ? { pageId: resolvedRecord.pageId } : {}),
            ...(resolvedRecord?.projectionId ? { projectionId: resolvedRecord.projectionId } : {}),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await recordSimpleRetrievalTrace({
            gaia,
            profileId: canonicalStore?.profileId ?? `agent:${agentId}`,
            agentId,
            sessionKey: options.agentSessionKey,
            reason: "read_error",
            selectedCount: 0,
            deniedCount: 0,
            budgetTokens: 0,
            startedAtMs,
          });
          return jsonResult({ path: relPath, text: "", disabled: true, error: message });
        } finally {
          reader?.close();
        }
      },
  });
}

export function createMemoryGraphTool(options: {
  config?: AlisioConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createMemoryTool({
    options,
    label: "Memory Graph",
    name: "memory_graph",
    description:
      "Inspect the GAIA-derived memory graph and return stable page/projection IDs plus explicit relations for dependency tracing and navigation.",
    parameters: MemoryGraphSchema,
    execute:
      ({ cfg, agentId }) =>
      async (toolCallId, params) => {
        const startedAtMs = Date.now();
        const query = readStringParam(params, "query", { required: true });
        const rawDirection = readStringParam(params, "direction");
        const matchLimit = readNumberParam(params, "matchLimit", { integer: true });
        const relationLimit = readNumberParam(params, "relationLimit", { integer: true });
        const direction =
          rawDirection === "incoming" || rawDirection === "outgoing" || rawDirection === "both"
            ? rawDirection
            : undefined;
        const flags = resolveRetrievalFlags(cfg);
        const fallbackProfileId = `agent:${agentId}`;
        const gaia = createGaiaFacade({
          cfg,
          profileId: fallbackProfileId,
          toolCallId,
          sessionKey: options.agentSessionKey,
          enabled: flags.tracingEnabled,
        });
        const memory = await getMemoryManagerContext({ cfg, agentId });
        if ("error" in memory) {
          await recordSimpleRetrievalTrace({
            gaia,
            profileId: fallbackProfileId,
            agentId,
            sessionKey: options.agentSessionKey,
            reason: "manager_unavailable",
            selectedCount: 0,
            deniedCount: 0,
            budgetTokens: 0,
            startedAtMs,
          });
          return jsonResult(buildMemoryGraphUnavailableResult({ query, error: memory.error }));
        }

        const canonicalStore = await ensureCanonicalStoreReady(
          memory.manager,
          "gaia-derived-graph",
        );
        const profileId = canonicalStore?.profileId ?? fallbackProfileId;
        const toolGaia =
          profileId === fallbackProfileId
            ? gaia
            : createGaiaFacade({
                cfg,
                profileId,
                toolCallId,
                sessionKey: options.agentSessionKey,
                enabled: flags.tracingEnabled,
              });

        try {
          if (!canonicalStore) {
            await recordSimpleRetrievalTrace({
              gaia: toolGaia,
              profileId,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "graph_store_unavailable",
              selectedCount: 0,
              deniedCount: 0,
              budgetTokens: 0,
              startedAtMs,
            });
            return jsonResult(
              buildMemoryGraphUnavailableResult({
                query,
                error: "canonical memory store unavailable",
              }),
            );
          }

          const graph = queryGaiaDerivedGraph({
            status: canonicalStore,
            query,
            ...(direction ? { direction } : {}),
            ...(typeof matchLimit === "number" ? { matchLimit } : {}),
            ...(typeof relationLimit === "number" ? { relationLimit } : {}),
          });

          await recordSimpleRetrievalTrace({
            gaia: toolGaia,
            profileId: canonicalStore.profileId,
            agentId,
            sessionKey: options.agentSessionKey,
            reason: "graph_query",
            selectedCount: graph.matches.length,
            deniedCount: 0,
            budgetTokens: estimateTokenCount(JSON.stringify(graph.matches.slice(0, 3))),
            startedAtMs,
          });

          return jsonResult(graph);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await recordSimpleRetrievalTrace({
            gaia: toolGaia,
            profileId,
            agentId,
            sessionKey: options.agentSessionKey,
            reason: "graph_error",
            selectedCount: 0,
            deniedCount: 0,
            budgetTokens: 0,
            startedAtMs,
          });
          return jsonResult(buildMemoryGraphUnavailableResult({ query, error: message }));
        }
      },
  });
}

function createGaiaFacade(params: {
  cfg: AlisioConfig;
  profileId: string;
  toolCallId: string;
  sessionKey?: string;
  enabled: boolean;
}): GaiaMemoryFacade {
  return {
    recordRetrievalTrace(record) {
      if (!params.enabled) {
        return;
      }
      const profileId = params.profileId.trim() || "unknown-profile";
      const stateDir = resolveStateDir(process.env);
      const deviceId = loadOrCreateDeviceIdentity().deviceId;
      const lamport = nextRetrievalLamport(profileId);
      const ledger = openLedger(profileId, { stateDir });
      try {
        ledger.appendEvent(
          {
            eventId: createCanonicalStableId(),
            profileId,
            deviceId,
            lamport,
            eventType: "RETRIEVAL_TRACE_RECORDED",
            createdAtMs: Date.now(),
            schemaVersion: MEMORY_SCHEMA_VERSION,
          },
          textEncoder.encode(
            JSON.stringify({
              eventName: "RETRIEVAL_TRACE_RECORDED",
              toolCallId: params.toolCallId,
              sessionKey: params.sessionKey,
              trace: record.trace,
              metrics: record.metrics,
            }),
          ),
        );
      } finally {
        ledger.close();
      }
    },
  };
}

async function ensureCanonicalStoreReady(
  manager: MemorySearchManager,
  reason = "memory-service-retrieve",
): Promise<CanonicalMemoryStoreStatus | null> {
  const initialStatus = manager.status();
  const initialCanonical = asCanonicalStoreStatus(initialStatus.custom?.canonicalStore);
  if (manager.sync && (initialStatus.dirty || initialCanonical?.state !== "ready")) {
    await manager.sync({ reason });
  }
  return asCanonicalStoreStatus(manager.status().custom?.canonicalStore);
}

function asCanonicalStoreStatus(value: unknown): CanonicalMemoryStoreStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<CanonicalMemoryStoreStatus>;
  if (
    !record.path ||
    !record.profileId ||
    !record.workspaceScope ||
    !record.backend ||
    !record.projectionInterface ||
    !record.syncMode ||
    !record.cloudSync ||
    !record.state
  ) {
    return null;
  }
  return record as CanonicalMemoryStoreStatus;
}

function openCanonicalStoreReader(
  status: CanonicalMemoryStoreStatus | null,
): CanonicalStoreReader | null {
  if (!status) {
    return null;
  }
  try {
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(status.path, { readOnly: true });
    return {
      status,
      findProjectionByPath(path) {
        const normalizedPath = normalizeRelativePath(path);
        if (!normalizedPath) {
          return null;
        }
        const row = db
          .prepare(
            `SELECT
               p.projection_id AS projectionId,
               p.entity_id AS pageId,
               p.relative_path AS path,
               p.source_kind AS sourceKind,
               p.editable AS editable,
               e.title AS title,
               p.markdown_body AS markdownBody,
               p.frontmatter_json AS frontmatterJson,
               p.updated_at AS updatedAt,
               e.metadata AS metadataJson
             FROM projections p
             INNER JOIN entities e
               ON e.profile_id = p.profile_id
              AND e.workspace_scope = p.workspace_scope
              AND e.entity_id = p.entity_id
             WHERE p.profile_id = ? AND p.workspace_scope = ? AND p.relative_path = ?
             LIMIT 1`,
          )
          .get(status.profileId, status.workspaceScope, normalizedPath) as
          | Record<string, unknown>
          | undefined;
        return normalizeProjectionRow(row);
      },
      findProjectionByProjectionId(projectionId) {
        const row = db
          .prepare(
            `SELECT
               p.projection_id AS projectionId,
               p.entity_id AS pageId,
               p.relative_path AS path,
               p.source_kind AS sourceKind,
               p.editable AS editable,
               e.title AS title,
               p.markdown_body AS markdownBody,
               p.frontmatter_json AS frontmatterJson,
               p.updated_at AS updatedAt,
               e.metadata AS metadataJson
             FROM projections p
             INNER JOIN entities e
               ON e.profile_id = p.profile_id
              AND e.workspace_scope = p.workspace_scope
              AND e.entity_id = p.entity_id
             WHERE p.profile_id = ? AND p.workspace_scope = ? AND p.projection_id = ?
             LIMIT 1`,
          )
          .get(status.profileId, status.workspaceScope, projectionId) as
          | Record<string, unknown>
          | undefined;
        return normalizeProjectionRow(row);
      },
      findProjectionByPageId(pageId) {
        const row = db
          .prepare(
            `SELECT
               p.projection_id AS projectionId,
               p.entity_id AS pageId,
               p.relative_path AS path,
               p.source_kind AS sourceKind,
               p.editable AS editable,
               e.title AS title,
               p.markdown_body AS markdownBody,
               p.frontmatter_json AS frontmatterJson,
               p.updated_at AS updatedAt,
               e.metadata AS metadataJson
             FROM projections p
             INNER JOIN entities e
               ON e.profile_id = p.profile_id
              AND e.workspace_scope = p.workspace_scope
              AND e.entity_id = p.entity_id
             WHERE p.profile_id = ? AND p.workspace_scope = ? AND p.entity_id = ?
             ORDER BY p.editable DESC,
               CASE p.source_kind
                 WHEN 'workspace-memory' THEN 0
                 ELSE 1
               END,
               p.relative_path ASC
             LIMIT 1`,
          )
          .get(status.profileId, status.workspaceScope, pageId) as
          | Record<string, unknown>
          | undefined;
        return normalizeProjectionRow(row);
      },
      listPinnedAndRecent(query, limit) {
        const rows = db
          .prepare(
            `SELECT
               p.projection_id AS projectionId,
               p.entity_id AS pageId,
               p.relative_path AS path,
               p.source_kind AS sourceKind,
               p.editable AS editable,
               e.title AS title,
               p.markdown_body AS markdownBody,
               p.frontmatter_json AS frontmatterJson,
               p.updated_at AS updatedAt,
               e.metadata AS metadataJson
             FROM projections p
             INNER JOIN entities e
               ON e.profile_id = p.profile_id
              AND e.workspace_scope = p.workspace_scope
              AND e.entity_id = p.entity_id
             WHERE p.profile_id = ? AND p.workspace_scope = ?
             ORDER BY p.updated_at DESC, p.relative_path ASC
             LIMIT ?`,
          )
          .all(status.profileId, status.workspaceScope, Math.max(6, limit * 4)) as Array<
          Record<string, unknown>
        >;
        const normalizedQuery = query.trim().toLowerCase();
        const selected: CanonicalProjectionRecord[] = [];
        for (const row of rows) {
          const record = normalizeProjectionRow(row);
          if (!record) {
            continue;
          }
          const pinned = isPinnedProjection(record);
          const lexical = computeLexicalScore(normalizedQuery, [
            record.title ?? "",
            record.path,
            summarizeText(record.markdownBody ?? "", 240),
          ]);
          if (!pinned && lexical <= 0 && selected.length >= Math.min(3, limit)) {
            continue;
          }
          selected.push(record);
          if (selected.length >= limit) {
            break;
          }
        }
        return selected;
      },
      close() {
        db.close();
      },
    };
  } catch {
    return null;
  }
}

function buildAlwaysVisibleBlocks(params: {
  profileId: string;
  agentId: string;
  sessionKey?: string;
  privateOnlyEnabled: boolean;
}): MemoryContextItem[] {
  const privateAllowed = isPrivateMemoryAllowed({
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    profileId: params.profileId,
    privateOnlyEnabled: params.privateOnlyEnabled,
  });
  return [
    {
      id: `identity:${params.profileId}:${params.agentId}`,
      layer: "L0",
      kind: "identity",
      title: "Memory identity scope",
      text: `Profile ${params.profileId}; agent ${params.agentId}; session ${params.sessionKey ?? "none"}.`,
      reasonCodes: ["always_visible_identity"],
      scoreBreakdown: { recency: 1, confidence: 1, lexical: 0, vector: 0, userFeedback: 0 },
      provenance: {
        sourceLocator: `memory-service://identity/${params.profileId}/${params.agentId}`,
        evidenceIds: [params.profileId, params.agentId],
      },
      tokenCount: 12,
    },
    {
      id: `policy:${params.profileId}:${params.agentId}`,
      layer: "L0",
      kind: "policy",
      title: "Memory isolation policy",
      text: privateAllowed
        ? "Private memory is available because this is a private user session or an explicit grant exists."
        : "Private memory is blocked by default outside private user sessions unless an explicit grant exists.",
      reasonCodes: ["always_visible_policy"],
      scoreBreakdown: { recency: 1, confidence: 1, lexical: 0, vector: 0, userFeedback: 0 },
      provenance: {
        sourceLocator: `memory-service://policy/${params.profileId}/${params.agentId}`,
        evidenceIds: [params.profileId, params.agentId],
      },
      tokenCount: 18,
    },
  ];
}

async function buildWorkingSetItems(params: {
  query: string;
  maxResults?: number;
  searchPromise: Promise<MemorySearchResult[]>;
  reader: CanonicalStoreReader | null;
}): Promise<MemoryContextItem[]> {
  const searchResults = await params.searchPromise;
  const sessionItems = searchResults
    .filter((entry) => entry.source === "sessions")
    .slice(0, Math.max(1, Math.min(3, Math.floor(resolveSearchBudgetItems(params.maxResults) / 2))))
    .map((entry, index) =>
      searchResultToContextItem(entry, {
        layer: "L1",
        kind: "event",
        visibility: "private",
        reasonCodes: index === 0 ? ["recent", "frequent_recall"] : ["recent"],
      }),
    );

  const pinnedAndRecent =
    params.reader
      ?.listPinnedAndRecent(
        params.query,
        Math.max(1, resolveSearchBudgetItems(params.maxResults) - sessionItems.length),
      )
      .map((record) =>
        projectionRecordToContextItem(record, {
          layer: "L1",
          kind: "page",
          query: params.query,
        }),
      ) ?? [];

  return [...sessionItems, ...pinnedAndRecent];
}

function buildStructuredItems(params: {
  query: string;
  canonicalStore: CanonicalMemoryStoreStatus | null;
  matchLimit: number;
}): MemoryContextItem[] {
  if (!params.canonicalStore) {
    return [];
  }
  const graph = queryCanonicalMemoryGraph({
    status: params.canonicalStore,
    query: params.query,
    matchLimit: Math.max(2, params.matchLimit),
    relationLimit: 4,
  });
  return graph.matches.map((match) => {
    const firstProjection = match.projections[0];
    const reasonCodes = [
      ...(match.relations.length > 0 ? ["linked"] : []),
      ...(match.tags.some((tag) => /claim|fact|decision/i.test(tag))
        ? ["high_confidence_claim"]
        : []),
      "exact_match",
    ];
    const lexical = clampScore(match.score);
    const confidence = reasonCodes.includes("high_confidence_claim") ? 0.92 : 0.68;
    return {
      id: `entity:${match.entityId}`,
      layer: "L2",
      kind: reasonCodes.includes("high_confidence_claim") ? "claim" : "entity",
      title: match.title,
      text: buildStructuredSummary(match),
      reasonCodes,
      scoreBreakdown: {
        recency: 0.35,
        confidence,
        lexical,
        vector: lexical * 0.7,
        userFeedback: 0,
      },
      provenance: {
        sourceLocator: match.sourcePath,
        evidenceIds: [
          match.entityId,
          ...match.projections.map((projection) => projection.projectionId),
        ],
      },
      locator: firstProjection
        ? { pageId: match.entityId, projectionId: firstProjection.projectionId }
        : { pageId: match.entityId },
      displayPath: firstProjection?.path ?? match.sourcePath,
      tokenCount: estimateTokenCount(match.title + buildStructuredSummary(match)),
    };
  });
}

async function buildTextSearchItems(params: {
  searchPromise: Promise<MemorySearchResult[]>;
  reader: CanonicalStoreReader | null;
}): Promise<MemoryContextItem[]> {
  const searchResults = await params.searchPromise;
  const items: MemoryContextItem[] = [];
  for (const entry of searchResults) {
    if (entry.source === "sessions") {
      continue;
    }
    const lookup = params.reader?.findProjectionByPath(entry.path);
    items.push(
      searchResultToContextItem(entry, {
        layer: "L3",
        kind: lookup ? "page" : "file",
        visibility: "public",
        reasonCodes: entry.score >= 0.85 ? ["exact_match", "frequent_recall"] : ["exact_match"],
        locator: lookup ? { pageId: lookup.pageId, projectionId: lookup.projectionId } : undefined,
        displayPath: lookup?.path ?? entry.path,
      }),
    );
  }
  return items;
}

function mapContextItemsToToolResults(items: MemoryContextItem[]): ToolSearchResult[] {
  return items.map((item) => ({
    path: item.displayPath ?? item.provenance.sourceLocator,
    startLine: resolveStartLine(item),
    endLine: resolveEndLine(item),
    score: combinedItemScore(item.scoreBreakdown),
    snippet: item.text,
    source: item.kind === "event" ? "sessions" : "memory",
    layer: item.layer === "L1" || item.layer === "L2" || item.layer === "L3" ? item.layer : "L3",
    reasonCodes: item.reasonCodes,
    scoreBreakdown: item.scoreBreakdown,
    provenance: item.provenance,
    ...(item.locator?.pageId ? { pageId: item.locator.pageId } : {}),
    ...(item.locator?.projectionId ? { projectionId: item.locator.projectionId } : {}),
  }));
}

async function buildFallbackSearchResult(params: {
  manager: MemorySearchManager;
  query: string;
  maxResults?: number;
  minScore?: number;
  sessionKey?: string;
  privateOnlyEnabled: boolean;
  agentId: string;
  profileId: string;
  gaia: GaiaMemoryFacade;
  startedAtMs?: number;
}): Promise<{ results: ToolSearchResult[]; trace: MemoryRetrievalTrace }> {
  const privateAllowed = isPrivateMemoryAllowed({
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    profileId: params.profileId,
    privateOnlyEnabled: params.privateOnlyEnabled,
  });
  const rawResults = await params.manager.search(params.query, {
    maxResults: params.maxResults,
    minScore: params.minScore,
    sessionKey: params.sessionKey,
  });
  const results = rawResults
    .filter((entry) => privateAllowed || entry.source !== "sessions")
    .map((entry) =>
      searchResultToToolResult(entry, {
        layer: entry.source === "sessions" ? "L1" : "L3",
        reasonCodes: entry.source === "sessions" ? ["recent"] : ["exact_match"],
      }),
    );
  const trace = createTracePayload({
    profileId: params.profileId,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    budgetTokens: results.reduce((sum, result) => sum + estimateTokenCount(result.snippet), 0),
    selectedCount: results.length,
    deniedCount: rawResults.length - results.length,
    timeMs: Math.max(0, Date.now() - (params.startedAtMs ?? Date.now())),
    candidateCounts: {
      L0: 0,
      L1: results.filter((entry) => entry.layer === "L1").length,
      L2: 0,
      L3: results.filter((entry) => entry.layer === "L3").length,
      L4: results.length,
    },
    topFactors: results.flatMap((result) => result.reasonCodes ?? []).slice(0, 4),
  });
  await params.gaia.recordRetrievalTrace({
    trace,
    metrics: {
      retrieval_latency_ms: trace.timeMs,
      retrieval_selected_count: trace.selectedCount,
      retrieval_budget_tokens: trace.budgetUsed.tokens,
      isolation_denies_count: trace.isolation.deniedCount,
    },
  });
  return { results, trace };
}

async function recordSimpleRetrievalTrace(params: {
  gaia: GaiaMemoryFacade;
  profileId: string;
  agentId: string;
  sessionKey?: string;
  reason: string;
  selectedCount: number;
  deniedCount: number;
  budgetTokens: number;
  startedAtMs?: number;
}) {
  const trace = createTracePayload({
    profileId: params.profileId,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    budgetTokens: params.budgetTokens,
    selectedCount: params.selectedCount,
    deniedCount: params.deniedCount,
    timeMs: Math.max(0, Date.now() - (params.startedAtMs ?? Date.now())),
    candidateCounts: {
      L0: 0,
      L1: 0,
      L2: 0,
      L3: params.selectedCount,
      L4: params.selectedCount,
    },
    topFactors: [params.reason],
  });
  await params.gaia.recordRetrievalTrace({
    trace,
    metrics: {
      retrieval_latency_ms: trace.timeMs,
      retrieval_selected_count: trace.selectedCount,
      retrieval_budget_tokens: trace.budgetUsed.tokens,
      isolation_denies_count: trace.isolation.deniedCount,
    },
  });
}

function createTracePayload(params: {
  profileId: string;
  agentId: string;
  sessionKey?: string;
  budgetTokens: number;
  selectedCount: number;
  deniedCount: number;
  timeMs?: number;
  candidateCounts: MemoryRetrievalTrace["candidateCounts"];
  topFactors: string[];
}): MemoryRetrievalTrace {
  return {
    eventName: "RETRIEVAL_TRACE_RECORDED",
    profileId: params.profileId,
    agentId: params.agentId,
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    candidateCounts: params.candidateCounts,
    selectedCount: params.selectedCount,
    timeMs: params.timeMs ?? 0,
    budgets: {
      maxTokens: params.budgetTokens,
      maxItems: Math.max(1, params.selectedCount),
    },
    budgetUsed: {
      tokens: params.budgetTokens,
      items: params.selectedCount,
    },
    topFactors: params.topFactors.map((factor) => ({ factor, count: 1 })),
    isolation: {
      privateAllowed: params.deniedCount === 0,
      deniedCount: params.deniedCount,
    },
  };
}

function queryGaiaDerivedGraph(params: {
  status: CanonicalMemoryStoreStatus;
  query: string;
  direction?: "incoming" | "outgoing" | "both";
  matchLimit?: number;
  relationLimit?: number;
}): CanonicalMemoryGraphResult & {
  matches: GaiaDerivedGraphMatch[];
} {
  const graph = queryCanonicalMemoryGraph(params);
  const matches: GaiaDerivedGraphMatch[] = graph.matches.map((match) => ({
    ...match,
    pageId: match.entityId,
    projections: match.projections.map((projection) => ({
      ...projection,
      pageId: match.entityId,
    })),
    relations: match.relations.map((relation): GaiaDerivedGraphRelation => {
      if (relation.relatedEntity) {
        return {
          direction: relation.direction,
          relationType: relation.relationType,
          ordinal: relation.ordinal,
          metadata: relation.metadata,
          relatedEntity: {
            ...relation.relatedEntity,
            pageId: relation.relatedEntity.entityId,
          },
        };
      }
      return {
        direction: relation.direction,
        relationType: relation.relationType,
        ordinal: relation.ordinal,
        metadata: relation.metadata,
      };
    }),
  }));
  return {
    ...graph,
    matches,
  };
}

function projectionRecordToContextItem(
  record: CanonicalProjectionRecord,
  params: { layer: "L1"; kind: "page"; query: string },
): MemoryContextItem {
  const pinned = isPinnedProjection(record);
  const lexical = computeLexicalScore(params.query.trim().toLowerCase(), [
    record.title ?? "",
    record.path,
    summarizeText(record.markdownBody ?? "", 240),
  ]);
  return {
    id: `projection:${record.projectionId}`,
    layer: params.layer,
    kind: params.kind,
    title: record.title ?? record.path,
    text: summarizeText(record.markdownBody ?? "", 320),
    reasonCodes: pinned
      ? ["pinned", "recent"]
      : lexical > 0
        ? ["recent", "frequent_recall"]
        : ["recent"],
    scoreBreakdown: {
      recency: computeRecencyScore(record.updatedAt),
      confidence: pinned ? 0.8 : 0.46,
      lexical,
      vector: 0,
      userFeedback: pinned ? 0.2 : 0,
    },
    provenance: {
      sourceLocator: record.path,
      evidenceIds: [record.pageId, record.projectionId],
    },
    locator: {
      pageId: record.pageId,
      projectionId: record.projectionId,
    },
    displayPath: record.path,
    tokenCount: estimateTokenCount((record.title ?? record.path) + (record.markdownBody ?? "")),
  };
}

function searchResultToContextItem(
  entry: MemorySearchResult,
  params: {
    layer: "L1" | "L3";
    kind: "event" | "page" | "file";
    visibility?: "public" | "private";
    reasonCodes: string[];
    locator?: { pageId?: string; projectionId?: string };
    displayPath?: string;
  },
): MemoryContextItem {
  return {
    id: `${params.layer}:${entry.path}:${entry.startLine}:${entry.endLine}`,
    layer: params.layer,
    kind: params.kind,
    title: params.displayPath ?? entry.path,
    text: entry.snippet,
    visibility: params.visibility ?? "public",
    reasonCodes: params.reasonCodes,
    scoreBreakdown: {
      recency: params.layer === "L1" ? 0.9 : 0.35,
      confidence: entry.score >= 0.8 ? 0.8 : 0.56,
      lexical: clampScore(entry.score),
      vector: clampScore(entry.score * 0.85),
      userFeedback: 0,
    },
    provenance: {
      sourceLocator: entry.path,
      evidenceIds: [`${entry.path}:${entry.startLine}-${entry.endLine}`],
    },
    ...(params.locator ? { locator: params.locator } : {}),
    ...(params.displayPath ? { displayPath: params.displayPath } : {}),
    tokenCount: estimateTokenCount(entry.snippet),
    metadata: {
      startLine: entry.startLine,
      endLine: entry.endLine,
      source: entry.source,
    },
  };
}

function searchResultToToolResult(
  entry: MemorySearchResult,
  params: { layer: "L1" | "L3"; reasonCodes: string[] },
): ToolSearchResult {
  return {
    ...entry,
    layer: params.layer,
    reasonCodes: params.reasonCodes,
    scoreBreakdown: {
      recency: params.layer === "L1" ? 0.9 : 0.35,
      confidence: entry.score >= 0.8 ? 0.8 : 0.56,
      lexical: clampScore(entry.score),
      vector: clampScore(entry.score * 0.85),
      userFeedback: 0,
    },
    provenance: {
      sourceLocator: entry.path,
      evidenceIds: [`${entry.path}:${entry.startLine}-${entry.endLine}`],
    },
  };
}

function resolveLocatorRecord(
  reader: CanonicalStoreReader | null,
  params: { projectionId?: string; pageId?: string; path?: string },
) {
  if (reader && params.projectionId) {
    const projection = reader.findProjectionByProjectionId(params.projectionId);
    if (projection) {
      return projection;
    }
  }
  if (reader && params.pageId) {
    const projection = reader.findProjectionByPageId(params.pageId);
    if (projection) {
      return projection;
    }
  }
  if (reader && params.path) {
    const projection = reader.findProjectionByPath(params.path);
    if (projection) {
      return projection;
    }
  }
  return null;
}

function normalizeProjectionRow(
  row: Record<string, unknown> | undefined,
): CanonicalProjectionRecord | null {
  const projectionId = typeof row?.projectionId === "string" ? row.projectionId : "";
  const pageId = typeof row?.pageId === "string" ? row.pageId : "";
  const path = typeof row?.path === "string" ? row.path : "";
  if (!projectionId || !pageId || !path) {
    return null;
  }
  return {
    projectionId,
    pageId,
    path,
    sourceKind: typeof row?.sourceKind === "string" ? row.sourceKind : "workspace-memory",
    editable: Boolean(row?.editable),
    ...(typeof row?.title === "string" ? { title: row.title } : {}),
    ...(typeof row?.markdownBody === "string" ? { markdownBody: row.markdownBody } : {}),
    ...(typeof row?.frontmatterJson === "string" ? { frontmatterJson: row.frontmatterJson } : {}),
    ...(typeof row?.updatedAt === "string" ? { updatedAt: row.updatedAt } : {}),
    ...(typeof row?.metadataJson === "string" ? { metadataJson: row.metadataJson } : {}),
  };
}

function buildStructuredSummary(match: CanonicalMemoryGraphResult["matches"][number]): string {
  const aliases = match.aliases.length ? `Aliases: ${match.aliases.join(", ")}` : "";
  const tags = match.tags.length ? `Tags: ${match.tags.join(", ")}` : "";
  const linked = match.relations.length
    ? `Links: ${match.relations
        .slice(0, 3)
        .map((relation) => relation.relatedEntity?.title ?? relation.relationType)
        .join(", ")}`
    : "";
  return [aliases, tags, linked].filter(Boolean).join("\n");
}

function resolveSearchBudgetTokens(qmdCharBudget?: number): number {
  if (typeof qmdCharBudget === "number" && Number.isFinite(qmdCharBudget) && qmdCharBudget > 0) {
    return Math.max(128, Math.floor(qmdCharBudget / 4));
  }
  return 1200;
}

function resolveSearchBudgetItems(maxResults?: number): number {
  if (typeof maxResults === "number" && Number.isFinite(maxResults) && maxResults > 0) {
    return Math.max(1, Math.floor(maxResults));
  }
  return 8;
}

function expandCandidateLimit(maxResults?: number): number {
  return Math.max(6, resolveSearchBudgetItems(maxResults) * 3);
}

function computeRecencyScore(updatedAt?: string): number {
  if (!updatedAt) {
    return 0.2;
  }
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) {
    return 0.2;
  }
  const ageDays = Math.max(0, (Date.now() - ts) / 86_400_000);
  return clampScore(1 / (1 + ageDays / 7));
}

function computeLexicalScore(query: string, fields: string[]): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return 0;
  }
  let hits = 0;
  const haystack = fields.join(" ").toLowerCase();
  for (const term of terms) {
    if (haystack.includes(term)) {
      hits += 1;
    }
  }
  return clampScore(hits / terms.length);
}

function isPinnedProjection(record: CanonicalProjectionRecord): boolean {
  const metadata = parseJsonRecord(record.metadataJson);
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((value): value is string => typeof value === "string")
    : [];
  if (metadata.pinned === true || tags.includes("pinned")) {
    return true;
  }
  const frontmatter = record.frontmatterJson ?? "";
  return /\bpinned\b/i.test(frontmatter) && /\btrue\b/i.test(frontmatter);
}

function parseJsonRecord(value?: string): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function summarizeText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function normalizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();
}

function resolveStartLine(item: MemoryContextItem): number {
  return typeof item.metadata?.startLine === "number" ? item.metadata.startLine : 1;
}

function resolveEndLine(item: MemoryContextItem): number {
  return typeof item.metadata?.endLine === "number"
    ? item.metadata.endLine
    : resolveStartLine(item);
}

function combinedItemScore(score: RetrievalScoreBreakdown): number {
  return clampScore(
    score.lexical * 0.4 +
      score.vector * 0.25 +
      score.confidence * 0.2 +
      score.recency * 0.1 +
      score.userFeedback * 0.05,
  );
}

function decorateSearchResults(
  results: ToolSearchResult[],
  includeCitations: boolean,
): ToolSearchResult[] {
  const citationEligible = results.filter((entry) => Boolean(entry.path));
  const decorated = new Map<string, ToolSearchResult>();
  for (const entry of decorateCitations(citationEligible, includeCitations)) {
    decorated.set(`${entry.path}:${entry.startLine}:${entry.endLine}`, entry as ToolSearchResult);
  }
  return results.map((entry) => {
    const key = `${entry.path}:${entry.startLine}:${entry.endLine}`;
    return decorated.get(key) ?? { ...entry, citation: undefined };
  });
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function resolveRetrievalFlags(cfg: AlisioConfig) {
  return {
    tracingEnabled: readBooleanFlag(cfg, ["memory", "retrieval", "tracing", "enabled"], true),
    privateOnlyEnabled: readBooleanFlag(
      cfg,
      ["memory", "retrieval", "privateOnly", "enabled"],
      true,
    ),
  };
}

function readBooleanFlag(
  cfg: AlisioConfig,
  path: readonly string[],
  defaultValue: boolean,
): boolean {
  let current: unknown = cfg as unknown;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return defaultValue;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "boolean" ? current : defaultValue;
}

function nextRetrievalLamport(profileId: string): number {
  const globalStore = globalThis as typeof globalThis & {
    [GAIA_LEDGER_STATE_KEY]?: Map<string, number>;
  };
  const store = globalStore[GAIA_LEDGER_STATE_KEY] ?? new Map<string, number>();
  globalStore[GAIA_LEDGER_STATE_KEY] = store;
  const next = Math.max(Date.now(), (store.get(profileId) ?? 0) + 1);
  store.set(profileId, next);
  return next;
}

function readOptionalString(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSessionLikePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.includes("session") || normalized.includes("transcript");
}
