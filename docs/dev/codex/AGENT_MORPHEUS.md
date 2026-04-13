# Agent Sleep (MORPHEUS)

`packages/memory-jobs` implementa um sistema de "Agent Sleep" cooperativo para introspecção de memória quando a sessão está parada.

Nesta revisão, as mutações deixaram de escrever directamente em `entities`, `projections`, `relations` ou `ledger_events`. O package passou a usar a seam pública da GAIA exposta por `alisio/plugin-sdk/memory-core-engine-runtime`:

- `buildCanonicalMemoryStoreStatus(...)` para derivar `profileId`, `workspaceScope` e caminho do store
- `memoryWriteEvent(...)` para toda a escrita auditável
- `forceCheckpoint` para alinhar pedidos operacionais de checkpoint com o fluxo oficial de `CHECKPOINT_CREATED`

`packages/memory-jobs/src/gaia.ts` ficou reduzido a adaptador fino. `memory_jobs` continua a guardar apenas cursores e estado operacional do scheduler, nunca o estado autoritativo da memória.

## Quando corre

- O runtime fica residente no processo do plugin `memory-core` e usa um timer interno.
- Só corre quando não há sessão activa (`status === "running"` no session store do agent) e quando não houve pedidos recentes ao gateway do `memory-core`.
- Se a sessão voltar a ficar activa ou se entrar tráfego novo no gateway do `memory-core`, o scheduler preempta o job no próximo checkpoint cooperativo e guarda `cursor_json`.
- Os flags estáveis são:
  - `memory.jobs.enabled`
  - `memory.jobs.autoSleep.enabled`
  - `memory.jobs.maxSliceMs`

## O que faz

- `consolidate`
  - Usa heurísticas locais e baratas para promover páginas em `claim` ou `procedure`.
  - Não usa LLM; respeita `memory.jobs.sleep.maxTokensPerRun` porque o custo actual é zero tokens.
  - Emite `PAGE_METADATA_UPDATED` e, quando aplicável, `CLAIM_UPSERTED`.
- `dedup`
  - Detecta near-duplicates de claims e páginas.
  - Emite propostas de merge por omissão.
  - Só faz auto-merge quando `autoMergeConfirmed === true`.
  - Quando faz merge, emite `PAGE_METADATA_UPDATED`, `PROJECTION_SET`, `CLAIM_UPSERTED` e `PAGE_TOMBSTONED`.
- `health`
  - Gera dashboards para:
    - stale claims
    - contradictions
    - orphan pages
    - broken attachments
    - low-confidence items
  - Materializa o dashboard com `DASHBOARD_SET`.

## Onde vivem os checkpoints

Os cursores e checkpoints vivem no mesmo `canonical.sqlite`, mas em camadas diferentes:

- `memory_jobs`
  - `job_id`, `profile_id`, `kind`, `status`, `cursor_json`, `updated_at_ms`, `last_error`
- `ledger_events`
  - origem auditável das mutações e dos checkpoints
  - inclui `PAGE_METADATA_UPDATED`, `CLAIM_UPSERTED`, `PAGE_TOMBSTONED`, `PROJECTION_SET`, `DASHBOARD_SET`, `JOB_CHECKPOINT_UPDATED` e `CHECKPOINT_CREATED`
- `checkpoints`
  - snapshots do estado derivado com `state_hash`
- `memory_job_events`
  - auditoria operacional local do scheduler
- `memory_job_telemetry`
  - `sleep_runs`, `sleep_preemptions`, `sleep_work_done_counts.*`, `health_findings_counts.*`

## Retoma exacta

- Cada item processado actualiza `cursor_json`.
- Cada checkpoint operacional emite `JOB_CHECKPOINT_UPDATED` para o ledger.
- Quando há limiar de eventos/tamanho ou fecho de ciclo, é criado também `CHECKPOINT_CREATED`.
- O resume continua exactamente do último cursor persistido; as mutações evitam repetição porque o estado derivado já reflecte os eventos emitidos.

## Gateway

O runtime expõe três métodos gateway:

- `memory.jobs.status`
  - leitura do estado runtime + job records + telemetria do perfil
- `memory.jobs.runOnce`
  - força uma slice única mesmo com auto-sleep desligado
  - ignora apenas o próprio request gateway que o invocou; qualquer actividade nova continua a poder preemptar
- `memory.jobs.cancel`
  - pede preempção imediata e espera pelo checkpoint cooperativo da slice actual

Todos os métodos gateway já existentes do `memory-core` marcam actividade recente, para evitar que os jobs de fundo concorram com navegação interactiva na memória.

## Debug rápido

1. Correr os testes direccionados:
   - `pnpm test -- packages/memory-jobs/src/scheduler.test.ts`
   - `pnpm test -- packages/memory-jobs/src/dedup.test.ts`
   - `pnpm test -- packages/memory-jobs/src/health.test.ts`
2. Inspeccionar o SQLite:
   - `sqlite3 ~/.alisio/memory/profiles/<profile>/canonical.sqlite 'select * from memory_jobs;'`
   - `sqlite3 ~/.alisio/memory/profiles/<profile>/canonical.sqlite 'select lamport, event_type, page_id from ledger_events order by lamport desc limit 50;'`
   - `sqlite3 ~/.alisio/memory/profiles/<profile>/canonical.sqlite 'select checkpoint_id, lamport, state_hash from checkpoints order by lamport desc limit 20;'`
   - `sqlite3 ~/.alisio/memory/profiles/<profile>/canonical.sqlite 'select kind from dashboards order by kind;'`
3. Se houver regressões:
   - desactivar `memory.jobs.enabled`
   - a memória canónica continua utilizável, só pára o trabalho de background
