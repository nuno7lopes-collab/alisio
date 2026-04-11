# AGENT_GAIA

## Responsabilidade

GAIA mantém o estado canónico de memória como estado derivado local reconstruído a partir do ledger.

## O que foi removido

- Dependência do layout Markdown legado no `canonical-store`
- Replicação cloud baseada em snapshots em claro
- Mutações silenciosas ao estado canónico

## O que substitui

- `ledger_events` como origem auditável
- `packages/memory-state` para reducers determinísticos e rebuild
- `page_doc_state.yjs_state` para corpos de página em CRDT
- `projections` materializadas para compatibilidade Markdown em `~/.alisio/workspace/`

## APIs

- `memoryWriteEvent(...)`
  - Escreve eventos locais no ledger
  - Aplica reducers ao estado derivado
  - Actualiza projections Markdown
  - Pode receber `encryptCheckpointSnapshot(...)` para anexar payload cifrado ao `CHECKPOINT_CREATED`
- `memoryPullApplySync(...)`
  - Recebe eventos plain ou cifrados
  - Exige `decryptEvent(...)` quando o input vem cifrado
  - Faz append ao ledger local e aplica ao estado derivado
  - Pode receber `encryptCheckpointSnapshot(...)` para checkpoints locais prontos para HERMES

## Migração

- Lê `MEMORY.md` e `memory/*.md` do workspace actual
- Lê o store canónico legado quando existir
- Emite lote génese com `PAGE_CREATED`, `DOC_CRDT_SNAPSHOT` e links derivados
- Mantém projections Markdown materializadas para rollback

## Status

`manager.status().custom.canonicalStore` deve expor:

- `ledgerEventsCount`
- `lastSyncedLamport`
- `checkpointsCount`
- `e2eeRequired`
