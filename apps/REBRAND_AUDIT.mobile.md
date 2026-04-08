# Mobile Rebrand Audit

Data: 2026-04-08
Agente: AGENTE-C
Âmbito principal: `apps/android/**`, `apps/ios/**`, `apps/shared/**`
Âmbito extra justificado: `apps/shared/OpenClawKit/**`, `apps/shared/AlisioKit/**`

## Resumo

- Estado final móvel: `rg -n --hidden -S "openclaw|OpenClaw|ai\\.openclaw|OpenClawKit" apps/android apps/ios` devolve zero hits.
- iOS ficou alinhado com bundle identifiers `ai.alisio.ios*` em signing defaults, fastlane e documentação local.
- Android já estava alinhado em `applicationId`, `namespace`, manifests, deep links e migração temporária de prefs; nesta ronda não foi preciso mexer no código Android.
- `apps/shared/AlisioKit/**` mantém-se como superfície canónica.
- `apps/shared/OpenClawKit/**` mantém-se como shim temporário, mas passou a expor identifiers/runtime canónicos Alisio com fallback explícito para paths, suites, keychain services, deep links e markers legados.
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
  - o scaffold HTML e a fonte do A2UI bundle em `apps/shared/OpenClawKit/Tools/CanvasA2UI/**` ficaram alinhados com `alisio*`.

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
- `cd apps/ios && xcodegen generate`: OK.
- `swift test --package-path apps/shared/AlisioKit`: OK.
- `swift build --package-path apps/shared/OpenClawKit`: OK.
- `swift test --package-path apps/shared/OpenClawKit`: bloqueado por falha pré-existente em `TalkSystemSpeechSynthesizerTests.swift` (`ActorIsolatedCall` numa API `@MainActor`), depois de limpo o `ModuleCache` legado que inicialmente apontava para outro checkout.
- `cd apps/android && ./gradlew :app:assembleDebug`: bloqueado pelo ambiente local; falta Java Runtime antes do Gradle arrancar.
- `cd apps/ios && xcodebuild -project Alisio.xcodeproj -scheme Alisio -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`: bloqueado pelo ambiente local; a platform iOS 26.2 não está instalada no Xcode deste host.

## Riscos / Follow-up

- O shim `OpenClawKit` continua a conter símbolos Swift `OpenClaw*` por compatibilidade binária/API; o objetivo desta ronda foi evitar que esses nomes continuassem a aparecer no runtime mobile, UI/resources ou identifiers persistidos.
- A fonte do bundle A2UI em `apps/shared/OpenClawKit/Tools/CanvasA2UI/**` já ficou alinhada com Alisio, mas o bundle gerado fora deste âmbito terá de ser regenerado na área própria quando essa pipeline for executada.
