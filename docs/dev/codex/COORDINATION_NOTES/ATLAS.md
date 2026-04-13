# ATLAS Coordination Notes

## Retrieval hardening

- `memory_search`, `memory_get`, and `memory_graph` are canonical-store only.
- Legacy search-manager and path-based emergency fallbacks are hard-disabled.
- `memory.retrieval.emergencyLegacyFallback.enabled` is intentionally ignored by the current tooling.
- Cross-agent retrieval is deny-by-default for memory payloads unless an explicit grant exists.
- Synthetic `L0` identity and policy blocks may still describe scope and isolation policy without exposing user memory.

## Tracing contract

- `memory.retrieval.tracing.enabled` defaults to `true`.
- When tracing is enabled, every retrieval attempt must emit `RETRIEVAL_TRACE_RECORDED`.
- This applies to successful retrievals and explicit unavailable/error returns.
- Telemetry stays content-free and count-based:
  - `retrieval_trace_events_total`
  - `retrieval_selected_count`
  - `retrieval_budget_tokens`
  - `isolation_denies_count`

## Explainability contract

ATLAS should treat these fields as the canonical "why this memory surfaced" payload:

- `reasonCodes[]`: primary explanation labels for why the item matched or was retained.
- `scoreBreakdown`: drill-down scoring for `recency`, `confidence`, `lexical`, `vector`, and `userFeedback`.
- `provenance.sourceLocator`: stable source locator for trace inspection and deep links.
- `provenance.evidenceIds[]`: stable evidence references for follow-up inspection.
- `pageId` / `projectionId`: stable navigation keys when the result points to a canonical page or projection.

## UI rendering guidance

- `memory_search.results[]`, `memory_get`, and `memory_graph.matches[]` expose explainability fields for UI rendering.
- Render `reasonCodes` first as the primary "Why this surfaced" summary.
- Keep `scoreBreakdown` available for drill-down, debugging, or operator review.
- Show `provenance` as source and evidence metadata rather than inferring from raw file paths.
- Do not add new UI fallbacks that read non-canonical paths just because explainability metadata is missing.
