export type MemoryRetrievalLayer = "L0" | "L1" | "L2" | "L3" | "L4";

export type MemoryContextItemKind =
  | "policy"
  | "identity"
  | "event"
  | "claim"
  | "procedure"
  | "entity"
  | "page"
  | "file";

export type MemoryContextItemVisibility = "public" | "private" | "shared";

export type RetrievalScoreBreakdown = {
  recency: number;
  confidence: number;
  lexical: number;
  vector: number;
  userFeedback: number;
};

export type MemoryContextItemLocator = {
  pageId?: string;
  projectionId?: string;
};

export type MemoryContextItem = {
  id: string;
  layer: Exclude<MemoryRetrievalLayer, "L4">;
  kind: MemoryContextItemKind;
  title: string;
  text: string;
  reasonCodes: string[];
  scoreBreakdown: RetrievalScoreBreakdown;
  provenance: {
    sourceLocator: string;
    evidenceIds: string[];
  };
  locator?: MemoryContextItemLocator;
  visibility?: MemoryContextItemVisibility;
  tokenCount?: number;
  displayPath?: string;
  metadata?: Record<string, unknown>;
};

export type MemoryRetrievalBudgets = {
  maxTokens: number;
  maxItems: number;
};

export type MemoryRetrievalModes = {
  includeWorkingSet: boolean;
  includeClaims: boolean;
  includePages: boolean;
  includeFiles: boolean;
};

export type RetrieveContextInput = {
  profileId: string;
  agentId: string;
  sessionKey?: string;
  queryText: string;
  minScore?: number;
  budgets: MemoryRetrievalBudgets;
  modes: MemoryRetrievalModes;
};

export type MemoryRetrievalTraceTopFactor = {
  factor: string;
  count: number;
};

export type MemoryRetrievalTrace = {
  eventName: "RETRIEVAL_TRACE_RECORDED";
  profileId: string;
  agentId: string;
  sessionKey?: string;
  candidateCounts: Record<MemoryRetrievalLayer, number>;
  selectedCount: number;
  timeMs: number;
  budgets: MemoryRetrievalBudgets;
  budgetUsed: {
    tokens: number;
    items: number;
  };
  topFactors: MemoryRetrievalTraceTopFactor[];
  isolation: {
    privateAllowed: boolean;
    deniedCount: number;
  };
};

export type GaiaRetrievalTraceRecord = {
  trace: MemoryRetrievalTrace;
  metrics: {
    retrieval_latency_ms: number;
    retrieval_selected_count: number;
    retrieval_budget_tokens: number;
    isolation_denies_count: number;
    retrieval_trace_events_total: number;
  };
};

export interface GaiaMemoryFacade {
  recordRetrievalTrace(record: GaiaRetrievalTraceRecord): Promise<void> | void;
}

export interface MemoryShareGrantStore {
  hasGrant(params: {
    profileId: string;
    agentId: string;
    sessionKey?: string;
    item: MemoryContextItem;
  }): Promise<boolean> | boolean;
}

export type MemoryServiceLayerSupplier = (
  params: RetrieveContextInput,
) => Promise<MemoryContextItem[]>;

export type MemoryServiceOptions = {
  gaia?: GaiaMemoryFacade;
  grants?: MemoryShareGrantStore;
  flags?: {
    tracingEnabled?: boolean;
    privateOnlyEnabled?: boolean;
    enableMmr?: boolean;
    mmrLambda?: number;
  };
  layers?: {
    alwaysVisible?: MemoryServiceLayerSupplier;
    workingSet?: MemoryServiceLayerSupplier;
    structured?: MemoryServiceLayerSupplier;
    textSearch?: MemoryServiceLayerSupplier;
  };
};

export type RetrieveContextResult = {
  items: MemoryContextItem[];
  trace: MemoryRetrievalTrace;
  budgetUsed: {
    tokens: number;
    items: number;
  };
};

export interface MemoryService {
  retrieveContext(input: RetrieveContextInput): Promise<RetrieveContextResult>;
}

const DEFAULT_SCORE_BREAKDOWN: RetrievalScoreBreakdown = {
  recency: 0,
  confidence: 0,
  lexical: 0,
  vector: 0,
  userFeedback: 0,
};

const DEFAULT_REASON_CODES_BY_LAYER: Record<Exclude<MemoryRetrievalLayer, "L4">, string[]> = {
  L0: ["always_visible_policy"],
  L1: ["recent"],
  L2: ["linked"],
  L3: ["exact_match"],
};

const DEFAULT_ENABLE_MMR = true;
const DEFAULT_MMR_LAMBDA = 0.72;

export function createNoopGaiaMemoryFacade(): GaiaMemoryFacade {
  return {
    recordRetrievalTrace() {},
  };
}

export function createDisabledShareGrantStore(): MemoryShareGrantStore {
  return {
    hasGrant() {
      return false;
    },
  };
}

export function estimateTokenCount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function computeMemoryItemScore(
  item: Pick<MemoryContextItem, "scoreBreakdown" | "reasonCodes">,
): number {
  let total =
    item.scoreBreakdown.recency * 0.22 +
    item.scoreBreakdown.confidence * 0.24 +
    item.scoreBreakdown.lexical * 0.24 +
    item.scoreBreakdown.vector * 0.2 +
    item.scoreBreakdown.userFeedback * 0.1;

  if (item.reasonCodes.includes("pinned")) {
    total += 0.2;
  }
  if (item.reasonCodes.includes("exact_match")) {
    total += 0.14;
  }
  if (item.reasonCodes.includes("high_confidence_claim")) {
    total += 0.1;
  }
  if (item.reasonCodes.includes("linked")) {
    total += 0.08;
  }
  if (item.reasonCodes.includes("frequent_recall")) {
    total += 0.04;
  }

  return clamp01(total);
}

export function isPrivateMemoryAllowed(params: {
  sessionKey?: string;
  agentId: string;
  profileId: string;
  privateOnlyEnabled?: boolean;
}): boolean {
  if (params.privateOnlyEnabled === false) {
    return true;
  }
  const agentId = params.agentId.trim().toLowerCase();
  const profileId = params.profileId.trim().toLowerCase();
  if (!agentId || !profileId) {
    return false;
  }
  const scope = parseSessionScope(params.sessionKey);
  if (scope.agentId && scope.agentId !== agentId) {
    return false;
  }
  return scope.chatType === "direct";
}

export function createMemoryService(options: MemoryServiceOptions = {}): MemoryService {
  const gaia = options.gaia ?? createNoopGaiaMemoryFacade();
  const grants = options.grants ?? createDisabledShareGrantStore();
  const tracingEnabled = options.flags?.tracingEnabled ?? true;
  const privateOnlyEnabled = options.flags?.privateOnlyEnabled ?? true;
  const enableMmr = options.flags?.enableMmr ?? DEFAULT_ENABLE_MMR;
  const mmrLambda = clamp01(options.flags?.mmrLambda ?? DEFAULT_MMR_LAMBDA);

  return {
    async retrieveContext(input) {
      const startedAt = Date.now();
      const crossAgentAccessDenied = isCrossAgentAccessDenied({
        sessionKey: input.sessionKey,
        agentId: input.agentId,
      });
      const privateAllowed = isPrivateMemoryAllowed({
        sessionKey: input.sessionKey,
        agentId: input.agentId,
        profileId: input.profileId,
        privateOnlyEnabled,
      });

      const candidateCounts: Record<MemoryRetrievalLayer, number> = {
        L0: 0,
        L1: 0,
        L2: 0,
        L3: 0,
        L4: 0,
      };
      let isolationDenies = 0;

      const normalizedByLayer = {
        L0: await normalizeLayer(
          "L0",
          options.layers?.alwaysVisible,
          input,
          privateAllowed,
          crossAgentAccessDenied,
          grants,
        ),
        L1: input.modes.includeWorkingSet
          ? await normalizeLayer(
              "L1",
              options.layers?.workingSet,
              input,
              privateAllowed,
              crossAgentAccessDenied,
              grants,
            )
          : { items: [], deniedCount: 0 },
        L2:
          input.modes.includeClaims || input.modes.includePages
            ? await normalizeLayer(
                "L2",
                options.layers?.structured,
                input,
                privateAllowed,
                crossAgentAccessDenied,
                grants,
              )
            : { items: [], deniedCount: 0 },
        L3:
          input.modes.includePages || input.modes.includeFiles
            ? await normalizeLayer(
                "L3",
                options.layers?.textSearch,
                input,
                privateAllowed,
                crossAgentAccessDenied,
                grants,
              )
            : { items: [], deniedCount: 0 },
      };

      for (const [layer, entries] of Object.entries(normalizedByLayer) as Array<
        [Exclude<MemoryRetrievalLayer, "L4">, NormalizedLayer]
      >) {
        candidateCounts[layer] = entries.items.length;
        isolationDenies += entries.deniedCount;
      }

      const preselected = selectWithinBudget(normalizedByLayer.L0, input.budgets);
      const remainingBudget = {
        maxTokens: Math.max(0, input.budgets.maxTokens - preselected.tokens),
        maxItems: Math.max(0, input.budgets.maxItems - preselected.items.length),
      };

      const deduped = dedupeItems([
        ...normalizedByLayer.L1.items,
        ...normalizedByLayer.L2.items,
        ...normalizedByLayer.L3.items,
      ]);
      const ranked = rankItems(deduped).filter(
        (item) =>
          input.minScore === undefined ||
          !Number.isFinite(input.minScore) ||
          computeMemoryItemScore(item) >= clamp01(input.minScore),
      );
      candidateCounts.L4 = ranked.length;

      const selectedRanked = selectRankedWithinBudget(ranked, remainingBudget, {
        enableMmr,
        mmrLambda,
      });
      const items = [...preselected.items, ...selectedRanked.items];
      const budgetUsed = {
        tokens: preselected.tokens + selectedRanked.tokens,
        items: items.length,
      };

      const trace: MemoryRetrievalTrace = {
        eventName: "RETRIEVAL_TRACE_RECORDED",
        profileId: input.profileId,
        agentId: input.agentId,
        ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
        candidateCounts,
        selectedCount: items.length,
        timeMs: Math.max(0, Date.now() - startedAt),
        budgets: {
          maxTokens: input.budgets.maxTokens,
          maxItems: input.budgets.maxItems,
        },
        budgetUsed,
        topFactors: summarizeTopFactors(items),
        isolation: {
          privateAllowed,
          deniedCount: isolationDenies,
        },
      };

      if (tracingEnabled) {
        await gaia.recordRetrievalTrace({
          trace,
          metrics: {
            retrieval_latency_ms: trace.timeMs,
            retrieval_selected_count: trace.selectedCount,
            retrieval_budget_tokens: trace.budgetUsed.tokens,
            isolation_denies_count: trace.isolation.deniedCount,
            retrieval_trace_events_total: 1,
          },
        });
      }

      return { items, trace, budgetUsed };
    },
  };
}

type NormalizedLayer = {
  items: MemoryContextItem[];
  deniedCount: number;
};

async function normalizeLayer(
  layer: Exclude<MemoryRetrievalLayer, "L4">,
  supplier: MemoryServiceLayerSupplier | undefined,
  input: RetrieveContextInput,
  privateAllowed: boolean,
  crossAgentAccessDenied: boolean,
  grants: MemoryShareGrantStore,
): Promise<NormalizedLayer> {
  if (!supplier) {
    return { items: [], deniedCount: 0 };
  }
  const rawItems = await supplier(input);
  const accepted: MemoryContextItem[] = [];
  let deniedCount = 0;

  for (const item of rawItems) {
    const normalized = normalizeItem(layer, item);
    if (!isKindAllowed(normalized, input.modes)) {
      continue;
    }
    if (await isItemVisible(normalized, input, privateAllowed, crossAgentAccessDenied, grants)) {
      accepted.push(normalized);
      continue;
    }
    deniedCount += 1;
  }

  return { items: accepted, deniedCount };
}

function normalizeItem(
  layer: Exclude<MemoryRetrievalLayer, "L4">,
  item: MemoryContextItem,
): MemoryContextItem {
  const text = item.text ?? "";
  const title = item.title?.trim() || item.provenance?.sourceLocator || item.id;
  const sourceLocator =
    item.provenance?.sourceLocator?.trim() || item.displayPath?.trim() || item.id;
  const evidenceIds = uniqueStrings(item.provenance?.evidenceIds ?? []);
  const reasonCodes = uniqueStrings(
    item.reasonCodes?.length ? item.reasonCodes : DEFAULT_REASON_CODES_BY_LAYER[layer],
  );
  const scoreBreakdown = {
    ...DEFAULT_SCORE_BREAKDOWN,
    ...item.scoreBreakdown,
  };
  const id =
    item.id?.trim() ||
    [layer, item.kind, item.locator?.projectionId, item.locator?.pageId, sourceLocator, title]
      .filter(Boolean)
      .join(":");
  return {
    ...item,
    id,
    layer,
    title,
    text,
    reasonCodes,
    scoreBreakdown,
    provenance: {
      sourceLocator,
      evidenceIds,
    },
    visibility: item.visibility ?? "public",
    tokenCount: item.tokenCount ?? estimateTokenCount(`${title}\n${text}`),
  };
}

async function isItemVisible(
  item: MemoryContextItem,
  input: RetrieveContextInput,
  privateAllowed: boolean,
  crossAgentAccessDenied: boolean,
  grants: MemoryShareGrantStore,
): Promise<boolean> {
  const hasGrant = await grants.hasGrant({
    profileId: input.profileId,
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    item,
  });
  if (hasGrant) {
    return true;
  }
  if (crossAgentAccessDenied) {
    return item.layer === "L0";
  }
  if (item.visibility === "public") {
    return true;
  }
  if (item.visibility === "shared") {
    return false;
  }
  return privateAllowed;
}

function isCrossAgentAccessDenied(params: { sessionKey?: string; agentId: string }): boolean {
  const scope = parseSessionScope(params.sessionKey);
  const scopedAgentId = scope.agentId?.trim().toLowerCase();
  const targetAgentId = params.agentId.trim().toLowerCase();
  if (!scopedAgentId || !targetAgentId) {
    return false;
  }
  return scopedAgentId !== targetAgentId;
}

function isKindAllowed(item: MemoryContextItem, modes: MemoryRetrievalModes): boolean {
  if (item.layer === "L0" || item.layer === "L1") {
    return true;
  }
  if (item.kind === "claim" || item.kind === "procedure" || item.kind === "entity") {
    return modes.includeClaims;
  }
  if (item.kind === "page") {
    return modes.includePages;
  }
  if (item.kind === "file") {
    return modes.includeFiles;
  }
  return true;
}

function selectWithinBudget(layer: NormalizedLayer, budgets: MemoryRetrievalBudgets) {
  const selected: MemoryContextItem[] = [];
  let tokens = 0;
  for (const item of layer.items) {
    const tokenCount = item.tokenCount ?? 0;
    if (selected.length >= budgets.maxItems) {
      break;
    }
    if (tokens + tokenCount > budgets.maxTokens) {
      break;
    }
    selected.push(item);
    tokens += tokenCount;
  }
  return { items: selected, tokens };
}

function dedupeItems(items: MemoryContextItem[]): MemoryContextItem[] {
  const deduped = new Map<string, MemoryContextItem>();
  for (const item of items) {
    const key =
      item.locator?.projectionId ||
      item.locator?.pageId ||
      item.provenance.sourceLocator ||
      `${item.kind}:${item.title}`;
    const existing = deduped.get(key);
    if (!existing || computeMemoryItemScore(item) > computeMemoryItemScore(existing)) {
      deduped.set(key, item);
    }
  }
  return Array.from(deduped.values());
}

function rankItems(items: MemoryContextItem[]): MemoryContextItem[] {
  return items.toSorted((left, right) => {
    const rightScore = computeMemoryItemScore(right);
    const leftScore = computeMemoryItemScore(left);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return left.title.localeCompare(right.title);
  });
}

function selectRankedWithinBudget(
  rankedItems: MemoryContextItem[],
  budgets: MemoryRetrievalBudgets,
  params: { enableMmr: boolean; mmrLambda: number },
) {
  if (!params.enableMmr) {
    return selectRankedItems(rankedItems, budgets);
  }
  return selectMmrItems(rankedItems, budgets, params.mmrLambda);
}

function selectRankedItems(items: MemoryContextItem[], budgets: MemoryRetrievalBudgets) {
  const selected: MemoryContextItem[] = [];
  let tokens = 0;
  for (const item of items) {
    const tokenCount = item.tokenCount ?? 0;
    if (selected.length >= budgets.maxItems) {
      break;
    }
    if (tokens + tokenCount > budgets.maxTokens) {
      continue;
    }
    selected.push(item);
    tokens += tokenCount;
  }
  return { items: selected, tokens };
}

function selectMmrItems(
  rankedItems: MemoryContextItem[],
  budgets: MemoryRetrievalBudgets,
  lambda: number,
) {
  const pool = [...rankedItems];
  const selected: MemoryContextItem[] = [];
  let tokens = 0;

  while (pool.length > 0 && selected.length < budgets.maxItems) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      if (!candidate) {
        continue;
      }
      const tokenCount = candidate.tokenCount ?? 0;
      if (tokens + tokenCount > budgets.maxTokens) {
        continue;
      }
      const relevance = computeMemoryItemScore(candidate);
      const noveltyPenalty = selected.length
        ? Math.max(...selected.map((entry) => similarityScore(entry, candidate)))
        : 0;
      const score = lambda * relevance - (1 - lambda) * noveltyPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) {
      break;
    }

    const [next] = pool.splice(bestIndex, 1);
    if (!next) {
      continue;
    }
    selected.push(next);
    tokens += next.tokenCount ?? 0;
  }

  return { items: selected, tokens };
}

function similarityScore(left: MemoryContextItem, right: MemoryContextItem): number {
  const leftTokens = tokenize(`${left.title} ${left.text}`);
  const rightTokens = tokenize(`${right.title} ${right.text}`);
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function summarizeTopFactors(items: MemoryContextItem[]): MemoryRetrievalTraceTopFactor[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const reasonCode of item.reasonCodes) {
      counts.set(`reason:${reasonCode}`, (counts.get(`reason:${reasonCode}`) ?? 0) + 1);
    }
    const bestScoreKey = bestScoreDimension(item.scoreBreakdown);
    counts.set(`score:${bestScoreKey}`, (counts.get(`score:${bestScoreKey}`) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([factor, count]) => ({ factor, count }));
}

function bestScoreDimension(score: RetrievalScoreBreakdown): keyof RetrievalScoreBreakdown {
  let bestKey: keyof RetrievalScoreBreakdown = "lexical";
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const key of Object.keys(score) as Array<keyof RetrievalScoreBreakdown>) {
    if (score[key] > bestValue) {
      bestKey = key;
      bestValue = score[key];
    }
  }
  return bestKey;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function parseSessionScope(sessionKey?: string) {
  const raw = sessionKey?.trim().toLowerCase() ?? "";
  if (!raw) {
    return { chatType: "unknown" as const };
  }
  const parts = raw.split(":").filter(Boolean);
  if (parts[0] === "subagent") {
    return { chatType: "unknown" as const };
  }
  let agentId: string | undefined;
  let scope = raw;
  if (parts[0] === "agent" && parts.length >= 3) {
    agentId = parts[1];
    scope = parts.slice(2).join(":");
  }
  if (scope.includes(":group:")) {
    return { agentId, chatType: "group" as const };
  }
  if (scope.includes(":channel:")) {
    return { agentId, chatType: "channel" as const };
  }
  // The canonical per-agent "main" session behaves like a private direct thread.
  if (scope === "main") {
    return { agentId, chatType: "direct" as const };
  }
  if (scope.includes(":direct:") || scope.includes(":dm:") || scope.includes("peer-direct")) {
    return { agentId, chatType: "direct" as const };
  }
  return { agentId, chatType: "unknown" as const };
}
