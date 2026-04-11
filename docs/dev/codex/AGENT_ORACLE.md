# ORACLE

ORACLE owns the native memory retrieval path for Codex agents.

## Scope

- Build context in layers instead of dumping raw chat history.
- Keep retrieval explainable, budgeted, and isolated by default.
- Emit `RETRIEVAL_TRACE_RECORDED` for every retrieval when tracing is enabled.

## Retrieval Contract

`packages/memory-service` exposes `retrieveContext()` with:

- identity inputs: `profileId`, `agentId`, `sessionKey`
- query input: `queryText`
- budget input: `budgets.maxTokens`, `budgets.maxItems`
- mode gates: `includeWorkingSet`, `includeClaims`, `includePages`, `includeFiles`

The service assembles context in these layers:

- `L0`: always-visible identity and policy blocks
- `L1`: working set, including recent events and pinned memory
- `L2`: structured claims, procedures, and entities from derived state
- `L3`: searchable projections/pages/files
- `L4`: reranked candidate pool after dedup and optional MMR

## Explainability

Every selected item should carry:

- `reasonCodes[]`
- `scoreBreakdown`
- `provenance.sourceLocator`
- `provenance.evidenceIds[]`

ATLAS should render `reasonCodes` as the primary "why surfaced" explanation and keep the score breakdown available for drill-down or debugging.

## Isolation

- Private memory is deny-by-default.
- Only private user sessions may read private memory unless an explicit grant exists.
- Shared grants are placeholder-only and default to off.
- Cross-agent or cross-protocol access must never happen implicitly.

## GAIA Wiring

GAIA should provide the retrieval-trace sink that appends `RETRIEVAL_TRACE_RECORDED` ledger events and forwards these telemetry fields:

- `retrieval_latency_ms`
- `retrieval_selected_count`
- `retrieval_budget_tokens`
- `isolation_denies_count`

## Compatibility

- The native layered retrieval path is authoritative.
- Stable locators (`pageId`, `projectionId`, `memory://...`) are the normal contract.
- Legacy path-based fallback is emergency-only behind `memory.retrieval.emergencyLegacyFallback.enabled`.
- That emergency flag must stay disabled by default.
- Even in emergency mode, private memory isolation must still hold.
