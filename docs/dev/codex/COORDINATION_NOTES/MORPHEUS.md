# MORPHEUS Coordination Notes

## UI hook point

Não houve alterações na UI nesta task. O contrato esperado para a UI é:

- Poll: `memory.jobs.status`
  - params:
    - `{ agentId }`
  - resposta:
    - `flags`
      - `enabled`
      - `autoSleepEnabled`
      - `maxSliceMs`
    - `gatewayActivity`
      - `lastRequestAtMs`
      - `lastRequestSeq`
    - `runtime`
      - `state`
      - `running`
      - `cancelRequested`
      - `activeSession`
      - `recentGatewayRequest`
      - `idle`
      - `lastStatus`
      - `lastPreemptedJob`
      - `lastError`
      - `sliceCount`
      - `totalSliceMs`
    - `telemetry.counts`
    - `jobs[]`
      - `jobId`
      - `kind`
      - `status`
      - `updatedAtMs`
      - `cursorJson`
      - `lastError`

- Manual slice: `memory.jobs.runOnce`
  - params:
    - `{ agentId }`
  - resposta:
    - `ok`
    - `run`
      - `status`
      - `startedAtMs`
      - `endedAtMs`
      - `preemptedJob`
      - `workDoneCounts`
    - `status`
      - mesmo shape de `memory.jobs.status`

- Cancel: `memory.jobs.cancel`
  - params:
    - `{ agentId }`
  - resposta:
    - `ok`
    - `cancelled`
    - `status`
      - mesmo shape de `memory.jobs.status`

## UI behaviour

- Tratar `state === "disabled"` como feature desligada e esconder acções destrutivas.
- Tratar `recentGatewayRequest === true` ou `activeSession === true` como razão explícita para auto-sleep estar parado.
- O botão "Run once" deve usar `memory.jobs.runOnce`.
- O botão "Cancel" deve usar `memory.jobs.cancel`.
- Se o gateway não suportar `memory.jobs.*`, mostrar `unsupported` em vez de falhar a vista.
