# Agent Sleep (MORPHEUS)

`packages/memory-jobs` implementa um sistema de "Agent Sleep" cooperativo para introspecção de memória quando a sessão está parada.

## Quando corre

- Só corre quando `activityMonitor.isSessionActive()` devolve `false`.
- Se a sessão voltar a ficar activa, o scheduler preempta o job no próximo checkpoint cooperativo e guarda `cursor_json`.
- O master flag é `memory.jobs.sleep.enabled` e faz short-circuit limpo quando está desligado.

## O que faz

- `consolidate`
  - Usa heurísticas locais e baratas para promover `candidate` em `claim` ou `procedure`.
  - Não usa LLM; respeita `memory.jobs.sleep.maxTokensPerRun` porque o custo actual é zero tokens.
- `dedup`
  - Detecta near-duplicates de claims e páginas.
  - Emite propostas de merge por omissão.
  - Só faz auto-merge quando `autoMergeConfirmed === true`.
- `health`
  - Gera dashboards para:
    - stale claims
    - contradictions
    - orphan pages
    - broken attachments
    - low-confidence items

## Onde vivem os checkpoints

Os cursores e checkpoints vivem no mesmo `canonical.sqlite`:

- `memory_jobs`
  - `job_id`, `profile_id`, `kind`, `status`, `cursor_json`, `updated_at_ms`, `last_error`
- `memory_job_events`
  - auditoria para promoções, merges, deletions e `CHECKPOINT_CREATED`
- `memory_job_reports`
  - último dashboard materializado
- `memory_job_telemetry`
  - `sleep_runs`, `sleep_preemptions`, `sleep_work_done_counts.*`, `health_findings_counts.*`

## Retoma exacta

- Cada item processado actualiza `cursor_json`.
- As mutações e a persistência do cursor acontecem na mesma transacção SQLite.
- O resume continua exactamente do último cursor persistido, sem repetir promoções ou merges já gravados.

## Debug rápido

1. Correr os testes direccionados:
   - `pnpm test -- packages/memory-jobs/src/scheduler.test.ts`
   - `pnpm test -- packages/memory-jobs/src/dedup.test.ts`
   - `pnpm test -- packages/memory-jobs/src/health.test.ts`
2. Inspeccionar o SQLite:
   - `sqlite3 ~/.alisio/memory/profiles/<profile>/canonical.sqlite 'select * from memory_jobs;'`
   - `sqlite3 ~/.alisio/memory/profiles/<profile>/canonical.sqlite 'select event_type, entity_id, target_entity_id from memory_job_events order by created_at_ms desc limit 50;'`
3. Se houver regressões:
   - desactivar `memory.jobs.sleep.enabled`
   - a memória canónica continua utilizável, só pára o trabalho de background
