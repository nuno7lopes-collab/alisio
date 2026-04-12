import { createHash } from "node:crypto";
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
  computeMemoryItemScore,
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
  displayPath?: string;
  pageId?: string;
  projectionId?: string;
};

type CanonicalProjectionRecord = {
  projectionId: string;
  pageId: string;
  projectionKind: string;
  sourceLocator: string;
  displayPath?: string;
  sourceKind: "workspace-memory";
  editable: boolean;
  title: string;
  slug: string;
  markdownBody: string;
  updatedAtMs: number;
  aliases: string[];
  tags: string[];
};

type CanonicalRecentEventRecord = {
  eventId: string;
  pageId?: string;
  projectionId?: string;
  title: string;
  summary: string;
  sourceLocator: string;
  displayPath?: string;
  createdAtMs: number;
  visibility: "public" | "private";
};

type CanonicalClaimRecord = {
  claimId: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  updatedAtMs: number;
  sourceLocator: string;
  evidenceIds: string[];
  evidenceLocators: string[];
};

type CanonicalStoreReader = {
  status: CanonicalMemoryStoreStatus;
  findProjectionByPath(path: string): CanonicalProjectionRecord | null;
  findProjectionByProjectionId(projectionId: string): CanonicalProjectionRecord | null;
  findProjectionByPageId(pageId: string): CanonicalProjectionRecord | null;
  listRecentEvents(limit: number): CanonicalRecentEventRecord[];
  listPinnedAndRecent(query: string, limit: number): CanonicalProjectionRecord[];
  listClaimMatches(query: string, limit: number): CanonicalClaimRecord[];
  searchProjections(query: string, limit: number): CanonicalProjectionRecord[];
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
const LEGACY_PROJECTION_PREFIX = "legacy-markdown:";

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

        if (!canonicalStore || !reader) {
          if (!flags.emergencyLegacyFallbackEnabled) {
            await recordSimpleRetrievalTrace({
              gaia: toolGaia,
              profileId,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "native_store_unavailable",
              selectedCount: 0,
              deniedCount: 0,
              budgetTokens: 0,
              startedAtMs,
            });
            reader?.close();
            return jsonResult(
              buildMemorySearchUnavailableResult("native canonical memory store unavailable"),
            );
          }
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
            reader?.close();
            return jsonResult({
              results,
              trace: fallback.trace,
              budgetUsed: fallback.trace.budgetUsed,
              provider: status.provider,
              model: status.model,
              fallback: status.fallback,
              citations: citationsMode,
              mode: "emergency-fallback",
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await recordSimpleRetrievalTrace({
              gaia: toolGaia,
              profileId,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "emergency_fallback_unavailable",
              selectedCount: 0,
              deniedCount: 0,
              budgetTokens: 0,
              startedAtMs,
            });
            reader?.close();
            return jsonResult(buildMemorySearchUnavailableResult(message));
          }
        }

        try {
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
                  reader,
                }),
              structured: async () =>
                buildStructuredItems({
                  query,
                  reader,
                  canonicalStore,
                  matchLimit: expandCandidateLimit(maxResults),
                }),
              textSearch: async () =>
                await buildTextSearchItems({
                  query,
                  maxResults,
                  reader,
                }),
            },
          });
          const retrieval = await service.retrieveContext({
            profileId,
            agentId,
            sessionKey: options.agentSessionKey,
            queryText: query,
            ...(typeof minScore === "number" ? { minScore } : {}),
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
          if (!flags.emergencyLegacyFallbackEnabled) {
            await recordSimpleRetrievalTrace({
              gaia: toolGaia,
              profileId,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "native_retrieval_failed",
              selectedCount: 0,
              deniedCount: 0,
              budgetTokens: 0,
              startedAtMs,
            });
            return jsonResult(buildMemorySearchUnavailableResult(message));
          }
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
              mode: "emergency-fallback",
            });
          } catch {
            await recordSimpleRetrievalTrace({
              gaia: toolGaia,
              profileId,
              agentId,
              sessionKey: options.agentSessionKey,
              reason: "emergency_fallback_unavailable",
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
      "Read a stable memory locator by projectionId or pageId, with optional from/lines, after memory_search narrowed the relevant page.",
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
        if (!projectionId && !pageId && path && flags.emergencyLegacyFallbackEnabled) {
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
              reason: "emergency_legacy_path",
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
          path: flags.emergencyLegacyFallbackEnabled ? path : undefined,
        });
        const stableLocator = resolvedRecord?.sourceLocator ?? "";

        if (!projectionId && !pageId) {
          const error = "projectionId or pageId is required";
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
          if (!canonicalStore || !reader) {
            throw new Error("native canonical memory store unavailable");
          }
          const privateAllowed = isPrivateMemoryAllowed({
            sessionKey: options.agentSessionKey,
            agentId,
            profileId: canonicalStore.profileId,
            privateOnlyEnabled: flags.privateOnlyEnabled,
          });
          if (!privateAllowed && isSessionLikePath(stableLocator)) {
            await recordSimpleRetrievalTrace({
              gaia,
              profileId: canonicalStore.profileId,
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
              path: stableLocator,
              disabled: true,
              error: "private memory denied",
            });
          }

          if (!resolvedRecord) {
            throw new Error("stable locator not found");
          }
          const text = sliceTextByLines(resolvedRecord.markdownBody, {
            from: from ?? undefined,
            lines: lines ?? undefined,
          });
          const result = {
            text,
            path: resolvedRecord.sourceLocator,
            ...(resolvedRecord.displayPath ? { displayPath: resolvedRecord.displayPath } : {}),
          };

          await recordSimpleRetrievalTrace({
            gaia,
            profileId: canonicalStore.profileId,
            agentId,
            sessionKey: options.agentSessionKey,
            reason: "stable_locator",
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
          return jsonResult({ path: stableLocator, text: "", disabled: true, error: message });
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
    const projections = loadProjectionRecords(db, status);
    const recentEvents = loadRecentEventRecords(db, status);
    const claims = loadClaimRecords(db, status);
    return {
      status,
      findProjectionByPath(path) {
        const normalizedPath = normalizeRelativePath(path);
        if (!normalizedPath) {
          return null;
        }
        return (
          projections.find(
            (projection) => normalizeRelativePath(projection.displayPath ?? "") === normalizedPath,
          ) ?? null
        );
      },
      findProjectionByProjectionId(projectionId) {
        return projections.find((projection) => projection.projectionId === projectionId) ?? null;
      },
      findProjectionByPageId(pageId) {
        return projections.find((projection) => projection.pageId === pageId) ?? null;
      },
      listRecentEvents(limit) {
        return recentEvents.slice(0, Math.max(1, limit));
      },
      listPinnedAndRecent(query, limit) {
        const normalizedQuery = query.trim().toLowerCase();
        const selected: CanonicalProjectionRecord[] = [];
        for (const record of projections.toSorted(
          (left, right) => right.updatedAtMs - left.updatedAtMs,
        )) {
          const pinned = isPinnedProjection(record);
          const lexical = computeLexicalScore(normalizedQuery, [
            record.title,
            record.displayPath ?? "",
            record.slug,
            record.aliases.join(" "),
            record.tags.join(" "),
            summarizeText(record.markdownBody, 240),
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
      listClaimMatches(query, limit) {
        return claims
          .map((claim) => ({ claim, score: scoreClaimRecord(query, claim) }))
          .filter((entry) => entry.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, Math.max(1, limit))
          .map((entry) => entry.claim);
      },
      searchProjections(query, limit) {
        return projections
          .map((projection) => ({
            projection,
            score: scoreProjectionRecord(query, projection),
          }))
          .filter((entry) => entry.score > 0)
          .sort((left, right) => {
            if (right.score !== left.score) {
              return right.score - left.score;
            }
            return right.projection.updatedAtMs - left.projection.updatedAtMs;
          })
          .slice(0, Math.max(1, limit))
          .map((entry) => entry.projection);
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
  reader: CanonicalStoreReader | null;
}): Promise<MemoryContextItem[]> {
  const eventLimit = Math.max(
    1,
    Math.min(3, Math.floor(resolveSearchBudgetItems(params.maxResults) / 2)),
  );
  const eventItems = (params.reader?.listRecentEvents(eventLimit) ?? []).map((event) =>
    recentEventToContextItem(event),
  );
  const pinnedAndRecent =
    params.reader
      ?.listPinnedAndRecent(
        params.query,
        Math.max(1, resolveSearchBudgetItems(params.maxResults) - eventItems.length),
      )
      .map((record) =>
        projectionRecordToContextItem(record, {
          layer: "L1",
          kind: "page",
          query: params.query,
        }),
      ) ?? [];

  return [...eventItems, ...pinnedAndRecent];
}

function buildStructuredItems(params: {
  query: string;
  reader: CanonicalStoreReader | null;
  canonicalStore: CanonicalMemoryStoreStatus | null;
  matchLimit: number;
}): MemoryContextItem[] {
  if (!params.canonicalStore || !params.reader) {
    return [];
  }
  const canonicalStore = params.canonicalStore;
  const claimItems = params.reader
    .listClaimMatches(params.query, Math.max(1, Math.floor(params.matchLimit / 2)))
    .map((claim) => claimRecordToContextItem(claim));
  const graph = queryCanonicalMemoryGraph({
    status: canonicalStore,
    query: params.query,
    matchLimit: Math.max(2, params.matchLimit),
    relationLimit: 4,
  });
  const graphItems: MemoryContextItem[] = graph.matches.map((match): MemoryContextItem => {
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
        sourceLocator: buildProjectionLocator(
          canonicalStore.profileId,
          match.entityId,
          firstProjection?.projectionId,
        ),
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
  return [...claimItems, ...graphItems];
}

async function buildTextSearchItems(params: {
  query: string;
  maxResults?: number;
  reader: CanonicalStoreReader | null;
}): Promise<MemoryContextItem[]> {
  return (
    params.reader?.searchProjections(params.query, expandCandidateLimit(params.maxResults)) ?? []
  ).map((record) =>
    projectionRecordToContextItem(record, {
      layer: "L3",
      kind: "page",
      query: params.query,
    }),
  );
}

function mapContextItemsToToolResults(items: MemoryContextItem[]): ToolSearchResult[] {
  return items.map((item) => ({
    path: item.provenance.sourceLocator,
    startLine: resolveStartLine(item),
    endLine: resolveEndLine(item),
    score: computeMemoryItemScore(item),
    snippet: item.text,
    source: "memory",
    layer: item.layer === "L1" || item.layer === "L2" || item.layer === "L3" ? item.layer : "L3",
    reasonCodes: item.reasonCodes,
    scoreBreakdown: item.scoreBreakdown,
    provenance: item.provenance,
    ...(item.displayPath ? { displayPath: item.displayPath } : {}),
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
  params: { layer: "L1" | "L3"; kind: "page"; query: string },
): MemoryContextItem {
  const pinned = isPinnedProjection(record);
  const lexical = scoreProjectionRecord(params.query, record);
  return {
    id: `projection:${record.projectionId}`,
    layer: params.layer,
    kind: params.kind,
    title: record.title,
    text: summarizeText(record.markdownBody, 320),
    reasonCodes: pinned
      ? ["pinned", "recent"]
      : lexical > 0
        ? params.layer === "L3"
          ? lexical >= 0.95
            ? ["exact_match", "frequent_recall"]
            : ["exact_match"]
          : ["recent", "frequent_recall"]
        : params.layer === "L3"
          ? ["exact_match"]
          : ["recent"],
    scoreBreakdown: {
      recency: computeRecencyScore(record.updatedAtMs),
      confidence: pinned ? 0.8 : params.layer === "L3" ? 0.72 : 0.46,
      lexical,
      vector: params.layer === "L3" ? lexical * 0.8 : 0,
      userFeedback: pinned ? 0.2 : 0,
    },
    provenance: {
      sourceLocator: record.sourceLocator,
      evidenceIds: [record.pageId, record.projectionId],
    },
    locator: {
      pageId: record.pageId,
      projectionId: record.projectionId,
    },
    ...(record.displayPath ? { displayPath: record.displayPath } : {}),
    tokenCount: estimateTokenCount(`${record.title}\n${record.markdownBody}`),
  };
}

function recentEventToContextItem(event: CanonicalRecentEventRecord): MemoryContextItem {
  return {
    id: `event:${event.eventId}`,
    layer: "L1",
    kind: "event",
    title: event.title,
    text: event.summary,
    visibility: event.visibility,
    reasonCodes: ["recent"],
    scoreBreakdown: {
      recency: computeRecencyScore(event.createdAtMs),
      confidence: 0.52,
      lexical: 0.2,
      vector: 0,
      userFeedback: 0,
    },
    provenance: {
      sourceLocator: event.sourceLocator,
      evidenceIds: [event.eventId, ...(event.pageId ? [event.pageId] : [])],
    },
    ...(event.pageId || event.projectionId
      ? {
          locator: {
            ...(event.pageId ? { pageId: event.pageId } : {}),
            ...(event.projectionId ? { projectionId: event.projectionId } : {}),
          },
        }
      : {}),
    ...(event.displayPath ? { displayPath: event.displayPath } : {}),
    tokenCount: estimateTokenCount(`${event.title}\n${event.summary}`),
  };
}

function claimRecordToContextItem(claim: CanonicalClaimRecord): MemoryContextItem {
  const evidencePreview = claim.evidenceLocators.slice(0, 2).join(", ");
  return {
    id: `claim:${claim.claimId}`,
    layer: "L2",
    kind: "claim",
    title: `${claim.subject} ${claim.predicate}`.trim(),
    text: evidencePreview
      ? `${claim.subject} ${claim.predicate} ${claim.object}\nEvidence: ${evidencePreview}`
      : `${claim.subject} ${claim.predicate} ${claim.object}`,
    reasonCodes:
      claim.confidence >= 0.8
        ? ["high_confidence_claim", "linked"]
        : claim.evidenceIds.length > 0
          ? ["linked", "exact_match"]
          : ["exact_match"],
    scoreBreakdown: {
      recency: computeRecencyScore(claim.updatedAtMs),
      confidence: clampScore(claim.confidence),
      lexical: scoreClaimRecord(`${claim.subject} ${claim.predicate} ${claim.object}`, claim),
      vector: 0,
      userFeedback: 0,
    },
    provenance: {
      sourceLocator: claim.sourceLocator,
      evidenceIds: [claim.claimId, ...claim.evidenceIds],
    },
    tokenCount: estimateTokenCount(`${claim.subject} ${claim.predicate} ${claim.object}`),
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
    displayPath: entry.path,
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

function loadProjectionRecords(
  db: InstanceType<ReturnType<typeof requireNodeSqlite>["DatabaseSync"]>,
  status: CanonicalMemoryStoreStatus,
): CanonicalProjectionRecord[] {
  const rows = db
    .prepare(
      `SELECT
         p.page_id AS pageId,
         p.title AS title,
         p.slug AS slug,
         pr.kind AS projectionKind,
         pr.markdown_body AS markdownBody,
         COALESCE(pr.updated_at_ms, p.updated_at_ms) AS updatedAtMs,
         COALESCE((SELECT json_group_array(alias_key) FROM page_aliases a WHERE a.page_id = p.page_id), '[]') AS aliasesJson,
         COALESCE((SELECT json_group_array(tag) FROM page_tags t WHERE t.page_id = p.page_id), '[]') AS tagsJson
       FROM pages p
       INNER JOIN projections pr
         ON pr.page_id = p.page_id
       WHERE p.tombstoned = 0
       ORDER BY COALESCE(pr.updated_at_ms, p.updated_at_ms) DESC, p.title ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows
    .map((row) => normalizeProjectionRow(status, row))
    .filter((row): row is CanonicalProjectionRecord => row !== null);
}

function loadRecentEventRecords(
  db: InstanceType<ReturnType<typeof requireNodeSqlite>["DatabaseSync"]>,
  status: CanonicalMemoryStoreStatus,
): CanonicalRecentEventRecord[] {
  const rows = db
    .prepare(
      `SELECT
         l.event_id AS eventId,
         l.event_type AS eventType,
         l.page_id AS pageId,
         l.source AS source,
         l.created_at_ms AS createdAtMs,
         l.payload_json AS payloadJson,
         p.title AS title,
         p.slug AS slug,
         (
           SELECT pr.kind
           FROM projections pr
           WHERE pr.page_id = l.page_id
           ORDER BY pr.updated_at_ms DESC, pr.kind ASC
           LIMIT 1
         ) AS projectionKind
       FROM ledger_events l
       LEFT JOIN pages p
         ON p.page_id = l.page_id
       WHERE l.event_type NOT IN ('RETRIEVAL_TRACE_RECORDED', 'CHECKPOINT_CREATED')
       ORDER BY l.lamport DESC
       LIMIT 24`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const eventId = typeof row.eventId === "string" ? row.eventId : "";
    const eventType = typeof row.eventType === "string" ? row.eventType : "EVENT";
    const pageId = typeof row.pageId === "string" && row.pageId ? row.pageId : undefined;
    const projectionKind =
      typeof row.projectionKind === "string" && row.projectionKind ? row.projectionKind : undefined;
    const projectionId =
      pageId && projectionKind ? buildProjectionId(pageId, projectionKind) : undefined;
    const title =
      typeof row.title === "string" && row.title.trim()
        ? row.title
        : pageId
          ? `Page ${pageId}`
          : eventType;
    return {
      eventId,
      ...(pageId ? { pageId } : {}),
      ...(projectionId ? { projectionId } : {}),
      title,
      summary: summarizeLedgerPayload(eventType, row.payloadJson),
      sourceLocator: buildEventLocator(status.profileId, eventId),
      ...(projectionKind
        ? {
            displayPath: resolveProjectionDisplayPath(
              projectionKind,
              typeof row.slug === "string" ? row.slug : (pageId ?? eventType.toLowerCase()),
            ),
          }
        : {}),
      createdAtMs: normalizeNumber(row.createdAtMs) ?? 0,
      visibility: isPrivateEventSource(row.source) ? "private" : "public",
    };
  });
}

function loadClaimRecords(
  db: InstanceType<ReturnType<typeof requireNodeSqlite>["DatabaseSync"]>,
  status: CanonicalMemoryStoreStatus,
): CanonicalClaimRecord[] {
  const rows = db
    .prepare(
      `SELECT
         c.claim_id AS claimId,
         c.subject AS subject,
         c.predicate AS predicate,
         c.object AS object,
         c.confidence AS confidence,
         c.updated_at_ms AS updatedAtMs,
         COALESCE((SELECT json_group_array(e.evidence_id) FROM evidence e WHERE e.claim_id = c.claim_id), '[]') AS evidenceIdsJson,
         COALESCE((SELECT json_group_array(e.source_locator) FROM evidence e WHERE e.claim_id = c.claim_id), '[]') AS evidenceLocatorsJson
       FROM claims c
       WHERE c.status IS NULL OR c.status != 'retracted'
       ORDER BY c.updated_at_ms DESC, c.claim_id ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    claimId: typeof row.claimId === "string" ? row.claimId : "",
    subject: typeof row.subject === "string" ? row.subject : "",
    predicate: typeof row.predicate === "string" ? row.predicate : "",
    object: typeof row.object === "string" ? row.object : "",
    confidence: clampScore(normalizeNumber(row.confidence) ?? 0.5),
    updatedAtMs: normalizeNumber(row.updatedAtMs) ?? 0,
    sourceLocator: buildClaimLocator(
      status.profileId,
      typeof row.claimId === "string" ? row.claimId : "",
    ),
    evidenceIds: parseJsonStringArray(row.evidenceIdsJson),
    evidenceLocators: parseJsonStringArray(row.evidenceLocatorsJson),
  }));
}

function normalizeProjectionRow(
  status: CanonicalMemoryStoreStatus,
  row: Record<string, unknown>,
): CanonicalProjectionRecord | null {
  const pageId = typeof row.pageId === "string" ? row.pageId : "";
  const projectionKind = typeof row.projectionKind === "string" ? row.projectionKind : "";
  if (!pageId || !projectionKind) {
    return null;
  }
  const projectionId = buildProjectionId(pageId, projectionKind);
  const slug = typeof row.slug === "string" && row.slug.trim() ? row.slug : pageId.toLowerCase();
  return {
    projectionId,
    pageId,
    projectionKind,
    sourceLocator: buildProjectionLocator(status.profileId, pageId, projectionId),
    displayPath: resolveProjectionDisplayPath(projectionKind, slug),
    sourceKind: "workspace-memory",
    editable: true,
    title: typeof row.title === "string" && row.title.trim() ? row.title : pageId,
    slug,
    markdownBody: typeof row.markdownBody === "string" ? row.markdownBody : "",
    updatedAtMs: normalizeNumber(row.updatedAtMs) ?? 0,
    aliases: parseJsonStringArray(row.aliasesJson),
    tags: parseJsonStringArray(row.tagsJson),
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

function computeRecencyScore(updatedAt?: string | number): number {
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) {
    const ageDays = Math.max(0, (Date.now() - updatedAt) / 86_400_000);
    return clampScore(1 / (1 + ageDays / 7));
  }
  if (typeof updatedAt !== "string" || !updatedAt) {
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
  return record.tags.some((tag) => tag.toLowerCase() === "pinned");
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : [];
  } catch {
    return [];
  }
}

function buildProjectionId(pageId: string, projectionKind: string): string {
  return `projection:${createHash("sha256").update(`${pageId}:${projectionKind}`).digest("hex").slice(0, 24)}`;
}

function buildProjectionLocator(profileId: string, pageId: string, projectionId?: string): string {
  return projectionId
    ? `memory://profiles/${profileId}/pages/${pageId}/projections/${projectionId}`
    : `memory://profiles/${profileId}/pages/${pageId}`;
}

function buildEventLocator(profileId: string, eventId: string): string {
  return `memory://profiles/${profileId}/events/${eventId}`;
}

function buildClaimLocator(profileId: string, claimId: string): string {
  return `memory://profiles/${profileId}/claims/${claimId}`;
}

function resolveProjectionDisplayPath(projectionKind: string, slug: string): string | undefined {
  if (projectionKind.startsWith(LEGACY_PROJECTION_PREFIX)) {
    return normalizeRelativePath(projectionKind.slice(LEGACY_PROJECTION_PREFIX.length));
  }
  return slug.trim() ? `memory/${slug}.md` : undefined;
}

function scoreProjectionRecord(query: string, record: CanonicalProjectionRecord): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  const exactFields = [record.title, record.slug, record.displayPath ?? "", ...record.aliases].map(
    (entry) => entry.toLowerCase(),
  );
  if (exactFields.includes(normalized)) {
    return 1;
  }
  const lexical = computeLexicalScore(query, [
    record.title,
    record.slug,
    record.displayPath ?? "",
    record.aliases.join(" "),
    record.tags.join(" "),
    summarizeText(record.markdownBody, 800),
  ]);
  return clampScore(lexical * 0.85 + computeRecencyScore(record.updatedAtMs) * 0.15);
}

function scoreClaimRecord(query: string, claim: CanonicalClaimRecord): number {
  return computeLexicalScore(query, [
    claim.subject,
    claim.predicate,
    claim.object,
    claim.evidenceLocators.join(" "),
  ]);
}

function summarizeLedgerPayload(eventType: string, payloadJson: unknown): string {
  const payload =
    typeof payloadJson === "string" && payloadJson.trim() ? safeParseJsonRecord(payloadJson) : {};
  const markdown =
    typeof payload.markdownBody === "string" ? summarizeText(payload.markdownBody, 180) : "";
  if (markdown) {
    return markdown;
  }
  if (typeof payload.title === "string" && payload.title.trim()) {
    return `${eventType}: ${payload.title.trim()}`;
  }
  if (Array.isArray(payload.links) && payload.links.length > 0) {
    return `${eventType}: updated ${payload.links.length} links`;
  }
  if (typeof payload.object === "string" && payload.object.trim()) {
    return `${eventType}: ${payload.object.trim()}`;
  }
  return eventType;
}

function isPrivateEventSource(value: unknown): boolean {
  return typeof value === "string" && /session|transcript|dm|direct/i.test(value);
}

function safeParseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function sliceTextByLines(value: string, params: { from?: number; lines?: number }): string {
  if (params.from === undefined && params.lines === undefined) {
    return value;
  }
  const rows = value.split("\n");
  const start = Math.max(1, params.from ?? 1);
  const endExclusive =
    params.lines && params.lines > 0
      ? Math.min(rows.length + 1, start + params.lines)
      : rows.length + 1;
  return rows.slice(start - 1, endExclusive - 1).join("\n");
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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
    emergencyLegacyFallbackEnabled: readBooleanFlag(
      cfg,
      ["memory", "retrieval", "emergencyLegacyFallback", "enabled"],
      false,
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
