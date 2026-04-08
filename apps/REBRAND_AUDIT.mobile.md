# Mobile Rebrand Audit

Data: 2026-04-08
Agente: AGENTE-C
Âmbito principal: `apps/android/**`, `apps/ios/**`, `apps/shared/**`
Âmbito extra justificado: `apps/shared/OpenClawKit/**`, `apps/shared/AlisioKit/**`, `src/canvas-host/**`, `src/gateway/canvas-capability.ts`, `src/gateway/protocol/client-info.ts`, `scripts/ios-beta-prepare.sh`

## Resumo

- Estado final móvel: `rg -n --hidden -S "openclaw|OpenClaw|ai\\.openclaw|OpenClawKit" apps/android apps/ios` devolve zero hits.
- iOS ficou alinhado com bundle identifiers `ai.alisio.ios*` em signing defaults, fastlane e documentação local.
- Android já estava alinhado em `applicationId`, `namespace`, manifests, deep links e migração temporária de prefs; nesta ronda não foi preciso mexer no código Android de produto.
- `apps/shared/AlisioKit/**` mantém-se como superfície canónica.
- `apps/shared/OpenClawKit/**` mantém-se como shim temporário, mas passou a expor identifiers/runtime canónicos Alisio com fallback explícito para paths, suites, keychain services, deep links e markers legados.
- O contrato operacional gateway <-> mobile ficou alinhado em `alisio-*` / `__alisio__/*`, mantendo aceitação explícita de aliases legados no gateway/canvas host para suportar a janela de transição.
- Foram limpos artefactos SPM locais (`.build`, `.swiftpm`, `Package.resolved`) nos shared kits no fim da validação.

## Android

- Verificação manual confirmou `namespace = "ai.alisio.app"` e `applicationId = "ai.alisio.app"`.
- O manifest principal já usa `Theme.AlisioNode` e não mantém deep links nem identifiers `openclaw`.
- A migração de dados já estava implementada em `SecurePrefs`: `alisio.node` / `alisio.node.secure` promovem dados vindos de `openclaw.node` / `openclaw.node.secure` durante uma release de transição.
- Não foram necessários edits nesta ronda em `apps/android/**`.

## iOS

- Bundle identifiers re-alinhados para `ai.alisio.ios`, `ai.alisio.ios.share`, `ai.alisio.ios.activitywidget`, `ai.alisio.ios.watchkitapp` e `ai.alisio.ios.watchkitapp.extension`.
- Fastlane/App Store targeting re-alinhado para `ai.alisio.ios` em `Appfile`, `Fastfile` e `SETUP.md`.
- O esquema profundo já estava em `alisio://` e não restavam classes/widgets `OpenClaw*` em `apps/ios/**`.
- `scripts/ios-beta-prepare.sh` foi corrigido para gerar `ai.alisio.ios*` em vez do prefixo intermédio `ai.alisio.client*`.
- Fastlane metadata já estava com URLs Alisio:
  - marketing/support/privacy ficaram consistentes com `alisio.ai`.

## Shared Kits

- Estratégia consolidada:
  - `AlisioKit` é a superfície canónica.
  - `OpenClawKit` fica como shim de compatibilidade temporário.
  - O shim deixa de emitir naming legado em runtime onde isso afetava mobile.
- Ajustes feitos no shim:
  - `ShareToAgentDeepLink` passa a gerar `alisio://`.
  - `DeepLinkParser` aceita `alisio://` e mantém leitura de `openclaw://` por compatibilidade.
  - `GatewayTLSStore` escreve em `ai.alisio.tls-pinning` e migra/leu `ai.openclaw.tls-pinning` + suites antigas quando presentes.
  - `DeviceIdentity` e `OpenClawNodeStorage` passam a preferir `Alisio` / `alisio`, com fallback para dirs legadas.
  - defaults/suites partilhadas passam a preferir `ai.alisio.shared` e `group.ai.alisio.shared`, com promoção best-effort de valores legacy e fallback a `.standard` quando não há app group disponível.
  - o marker de canvas fica canónico em `__alisio__/cap/`, aceitando leitura legacy `__openclaw__/cap/`.
  - o scaffold HTML e a fonte do A2UI bundle ficaram alinhados com `alisio*`, mantendo aliases internos legacy no bundle para rollout sem quebra.
  - `apps/shared/AlisioKit/Tools/CanvasA2UI/**` passou a existir como caminho canónico de bundling; o pipeline deixa de depender de um artefacto gerado antigo.

## Gateway / Operabilidade

- O gateway agora aceita `alisio-macos`, `alisio-ios` e `alisio-android` como `client.id` canónicos.
- O handshake mantém aceitação de `openclaw-macos`, `openclaw-ios` e `openclaw-android` como aliases temporários de compatibilidade.
- O canvas host passou a servir rotas canónicas `__alisio__/a2ui`, `__alisio__/canvas` e `__alisio__/ws`.
- O gateway/canvas host mantém aceitação das rotas legacy `__openclaw__/*` para clientes antigos.
- O prefixo de capability passa a ser emitido como `__alisio__/cap`, mantendo leitura de `__openclaw__/cap`.

## Migrações a Preservar

- Android prefs:
  - `openclaw.node` -> `alisio.node`
  - `openclaw.node.secure` -> `alisio.node.secure`
- Shared/iOS runtime compat:
  - `OPENCLAW_STATE_DIR` continua aceite, mas `ALISIO_STATE_DIR` passa a ser o nome canónico.
  - `openclaw://` continua aceite pelo parser, mas `alisio://` é o esquema emitido.
  - `ai.openclaw.shared` / `group.ai.openclaw.shared` continuam legíveis, com promoção para `ai.alisio.shared` / `group.ai.alisio.shared` quando possível.
  - `ai.openclaw.tls-pinning` continua legível, com promoção para `ai.alisio.tls-pinning`.

## Validação

- `rg -n --hidden -S "openclaw|OpenClaw|ai\\.openclaw|OpenClawKit" apps/android apps/ios`: OK, zero hits.
- `rg -n --hidden -S "openclaw|OpenClaw|ai\\.openclaw|OpenClawKit" apps/android apps/ios`: continua OK depois do fecho operacional.
- `cd apps/ios && xcodegen generate`: OK.
- `pnpm canvas:a2ui:bundle`: OK (`up to date`), já a apontar para o caminho canónico `apps/shared/AlisioKit/Tools/CanvasA2UI/**`.
- `pnpm build`: OK.
- `swift test --package-path apps/shared/AlisioKit`: OK.
- `swift build --package-path apps/shared/OpenClawKit`: OK.
- `swift test --package-path apps/shared/OpenClawKit`: OK (na repetição limpa, depois de corrigido o bloqueio inicial de `ActorIsolatedCall` em `TalkSystemSpeechSynthesizerTests.swift`).
- `pnpm test -- src/canvas-host/server.test.ts`: OK.
- `pnpm test -- src/gateway/server-methods/nodes.canvas-capability-refresh.test.ts src/gateway/canvas-capability.test.ts src/gateway/server.ios-client-id.test.ts src/gateway/device-auth.test.ts`: OK.
- `pnpm test -- src/gateway/server.canvas-auth.test.ts`: bloqueado; a suite fica pendurada no runner gateway mesmo isolada, sem produzir falha útil nesta máquina.
- `cd apps/android && ./gradlew :app:assembleDebug`: bloqueado pelo ambiente local; falta Java Runtime antes do Gradle arrancar.
- `cd apps/ios && xcodebuild -project Alisio.xcodeproj -scheme Alisio -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`: bloqueado pelo ambiente local; a platform iOS 26.2 não está instalada no Xcode deste host.

## Riscos / Follow-up

- O shim `OpenClawKit` continua a conter símbolos Swift `OpenClaw*` por compatibilidade binária/API; o objetivo desta ronda foi evitar que esses nomes continuassem a aparecer no runtime mobile, UI/resources ou identifiers persistidos.
- A suite `src/gateway/server.canvas-auth.test.ts` precisa de follow-up próprio: nesta máquina o runner gateway fica preso sem output útil mesmo com execução isolada, pelo que a cobertura factual desta ronda ficou assegurada por testes mais pequenos e específicos do contrato alterado.
- O rollout continua dependente de validar em hosts com Java e platform iOS 26.2 instalados para fechar os builds nativos end-to-end.
