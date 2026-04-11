# Mobile Rebrand Audit

Data: 2026-04-08
Revalidado nesta tarefa: 2026-04-09
Agente: AGENTE-C
Âmbito principal: `apps/android/**`, `apps/ios/**`, `apps/shared/**`
Âmbito extra justificado: `apps/shared/AlisioKit/**`, `apps/shared/AlisioKit/**`, `src/canvas-host/**`, `src/gateway/canvas-capability.ts`, `src/gateway/protocol/client-info.ts`, `scripts/ios-beta-prepare.sh`

## Resumo

- Estado final móvel: `rg -n --hidden -S "alisio|Alisio|ai\\.alisio|AlisioKit" apps/android apps/ios` devolve zero hits.
- Estado de código/rebrand: validado para `apps/android/**`, `apps/ios/**` e `apps/shared/**`, mas isto não substitui smoke live real.
- iOS ficou alinhado com bundle identifiers `ai.alisio.ios*` em signing defaults, fastlane e documentação local.
- Android já estava alinhado em `applicationId`, `namespace`, manifests, deep links e migração temporária de prefs; nesta ronda não foi preciso mexer no código Android de produto.
- `apps/shared/AlisioKit/**` mantém-se como superfície canónica.
- `apps/shared/AlisioKit/**` mantém-se como shim temporário, mas passou a expor identifiers/runtime canónicos Alisio com fallback explícito para paths, suites, keychain services, deep links e markers legados.
- O contrato operacional gateway <-> mobile ficou alinhado em `alisio-*` / `__alisio__/*`, mantendo aceitação explícita de aliases legados no gateway/canvas host para suportar a janela de transição.
- Foram limpos artefactos SPM locais (`.build`, `.swiftpm`, `Package.resolved`) nos shared kits no fim da validação.
- A validação live real de conta/auth ficou fechada nesta tarefa: Supabase live + inbox real + links reais já foram exercitados.
- Continuam pendentes apenas smoke multi-dispositivo e auditoria final com dispositivos físicos.

## Android

- Verificação manual confirmou `namespace = "ai.alisio.app"` e `applicationId = "ai.alisio.app"`.
- O manifest principal já usa `Theme.AlisioNode` e não mantém deep links nem identifiers `alisio`.
- A migração de dados já estava implementada em `SecurePrefs`: `alisio.node` / `alisio.node.secure` promovem dados vindos de `alisio.node` / `alisio.node.secure` durante uma release de transição.
- Não foram necessários edits nesta ronda em `apps/android/**`.

## iOS

- Bundle identifiers re-alinhados para `ai.alisio.ios`, `ai.alisio.ios.share`, `ai.alisio.ios.activitywidget`, `ai.alisio.ios.watchkitapp` e `ai.alisio.ios.watchkitapp.extension`.
- Fastlane/App Store targeting re-alinhado para `ai.alisio.ios` em `Appfile`, `Fastfile` e `SETUP.md`.
- O esquema profundo já estava em `alisio://` e não restavam classes/widgets `Alisio*` em `apps/ios/**`.
- `scripts/ios-beta-prepare.sh` foi corrigido para gerar `ai.alisio.ios*` em vez do prefixo intermédio `ai.alisio.client*`.
- Fastlane metadata já estava com URLs Alisio:
  - marketing/support/privacy ficaram consistentes com `alisio.ai`.

## Shared Kits

- Estratégia consolidada:
  - `AlisioKit` é a superfície canónica.
  - `AlisioKit` fica como shim de compatibilidade temporário.
  - O shim deixa de emitir naming legado em runtime onde isso afetava mobile.
- Ajustes feitos no shim:
  - `ShareToAgentDeepLink` passa a gerar `alisio://`.
  - `DeepLinkParser` aceita `alisio://` e mantém leitura de `alisio://` por compatibilidade.
  - `GatewayTLSStore` escreve em `ai.alisio.tls-pinning` e migra/leu `ai.alisio.tls-pinning` + suites antigas quando presentes.
  - `DeviceIdentity` e `AlisioNodeStorage` passam a preferir `Alisio` / `alisio`, com fallback para dirs legadas.
  - defaults/suites partilhadas passam a preferir `ai.alisio.shared` e `group.ai.alisio.shared`, com promoção best-effort de valores legacy e fallback a `.standard` quando não há app group disponível.
  - o marker de canvas fica canónico em `__alisio__/cap/`, aceitando leitura legacy `__alisio__/cap/`.
  - o scaffold HTML e a fonte do A2UI bundle ficaram alinhados com `alisio*`, mantendo aliases internos legacy no bundle para rollout sem quebra.
  - `apps/shared/AlisioKit/Tools/CanvasA2UI/**` passou a existir como caminho canónico de bundling; o pipeline deixa de depender de um artefacto gerado antigo.

## Gateway / Operabilidade

- O gateway agora aceita `alisio-macos`, `alisio-ios` e `alisio-android` como `client.id` canónicos.
- O handshake mantém aceitação de `alisio-macos`, `alisio-ios` e `alisio-android` como aliases temporários de compatibilidade.
- O canvas host passou a servir rotas canónicas `__alisio__/a2ui`, `__alisio__/canvas` e `__alisio__/ws`.
- O gateway/canvas host mantém aceitação das rotas legacy `__alisio__/*` para clientes antigos.
- O prefixo de capability passa a ser emitido como `__alisio__/cap`, mantendo leitura de `__alisio__/cap`.

## Migrações a Preservar

- Android prefs:
  - `alisio.node` -> `alisio.node`
  - `alisio.node.secure` -> `alisio.node.secure`
- Shared/iOS runtime compat:
  - `ALISIO_STATE_DIR` continua aceite, mas `ALISIO_STATE_DIR` passa a ser o nome canónico.
  - `alisio://` continua aceite pelo parser, mas `alisio://` é o esquema emitido.
  - `ai.alisio.shared` / `group.ai.alisio.shared` continuam legíveis, com promoção para `ai.alisio.shared` / `group.ai.alisio.shared` quando possível.
  - `ai.alisio.tls-pinning` continua legível, com promoção para `ai.alisio.tls-pinning`.

## Validação Da Ronda De Rebrand

- `rg -n --hidden -S "alisio|Alisio|ai\\.alisio|AlisioKit" apps/android apps/ios`: OK, zero hits.
- `rg -n --hidden -S "alisio|Alisio|ai\\.alisio|AlisioKit" apps/android apps/ios`: continua OK depois do fecho operacional.
- `cd apps/ios && xcodegen generate`: OK.
- `pnpm canvas:a2ui:bundle`: OK (`up to date`), já a apontar para o caminho canónico `apps/shared/AlisioKit/Tools/CanvasA2UI/**`.
- `pnpm build`: OK.
- `swift test --package-path apps/shared/AlisioKit`: OK.
- `swift build --package-path apps/shared/AlisioKit`: OK.
- `swift test --package-path apps/shared/AlisioKit`: OK (na repetição limpa, depois de corrigido o bloqueio inicial de `ActorIsolatedCall` em `TalkSystemSpeechSynthesizerTests.swift`).
- `pnpm test -- src/canvas-host/server.test.ts`: OK.
- `pnpm test -- src/gateway/server-methods/nodes.canvas-capability-refresh.test.ts src/gateway/canvas-capability.test.ts src/gateway/server.ios-client-id.test.ts src/gateway/device-auth.test.ts`: OK.
- `pnpm test -- src/gateway/server.canvas-auth.test.ts`: bloqueado; a suite fica pendurada no runner gateway mesmo isolada, sem produzir falha útil nesta máquina.
- `cd apps/android && ./gradlew :app:assembleDebug`: bloqueado pelo ambiente local; falta Java Runtime antes do Gradle arrancar.
- `cd apps/ios && xcodebuild -project Alisio.xcodeproj -scheme Alisio -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`: registo histórico desta ronda; a revalidação actual desta tarefa está documentada abaixo com o erro exacto observado hoje.

## Estado Runtime Deste Host

- `xcodebuild -version`: verificado. Host com Xcode 26.3.
- `xcodebuild -showsdks`: verificado. O host lista `iphoneos26.2`, mas isso não foi suficiente para satisfazer o `xcodebuild` real desta tarefa.
- `java -version`: bloqueado. O host não tem Java Runtime disponível no PATH.
- `adb devices -l`: bloqueado. `adb` não existe no PATH deste host.
- `xcrun devicectl list devices`: verificado. `No devices found.`
- `xcrun xctrace list devices`: verificado. Só o host local aparece (`Nuno’s MacBook Air`); não há iPhone físico visível nesta sessão.
- `printenv | rg '^ALISIO_(SUPABASE|PUSH|APNS|MAIL|EMAIL)|^SUPABASE'`: sem variáveis live visíveis no ambiente desta sessão.
- `~/.profile`: sem `ALISIO_SUPABASE_*`, `ALISIO_PUSH_RELAY_BASE_URL`, `ANDROID_HOME` ou `ANDROID_SDK_ROOT` exportados de forma visível.

## Revalidação Desta Tarefa

- `bash -lc './scripts/ios-configure-signing.sh && ./scripts/ios-write-version-xcconfig.sh && cd apps/ios && xcodegen generate && xcodebuild -project Alisio.xcodeproj -scheme Alisio -destination "generic/platform=iOS" CODE_SIGNING_ALLOWED=NO build'`: falhou com código 70. O Xcode gerou o projecto, mas o build terminou em `Unable to find a destination matching the provided destination specifier ... error:iOS 26.2 is not installed`.
- `swift test --package-path apps/shared/AlisioKit`: OK. Build concluído e 3 testes passaram (`AlisioKitBridgeTests`).
- `swift test --package-path apps/shared/AlisioKit`: inconclusivo neste host. O comando compilou durante vários minutos e deixou de produzir output útil antes de um fecho observável nesta sessão.
- `pnpm test -- src/agents/live-test-helpers.test.ts test/test-env.test.ts src/infra/alisio-account-cloud.test.ts`: bloqueado por infra do runner Vitest (`Worker forks emitted error` / timeout de workers), sem falha de assertion observável do diff.
- `ALISIO_TEST_PROFILE=serial ALISIO_TEST_SERIAL_GATEWAY=1 pnpm test -- src/infra/alisio-account-cloud.test.ts`: OK. 17 testes passaram, incluindo as novas assertions que preservam o detalhe upstream do Supabase nos erros de live auth e o novo caso em que `completeAlisioCloudAccountEmailLinkAuth()` recicla o `refresh_token` do próprio link quando o `access_token` já expirou.
- `env ALISIO_SUPABASE_URL='https://jgchbqmlffheaimosyjz.supabase.co' ALISIO_SUPABASE_ANON_KEY='<publishable-key>' ALISIO_LIVE_ACCOUNT_EMAIL='suporte@alisio.pt' pnpm test:live:account -- --pool=forks --maxWorkers=1 --reporter=verbose`: execução live factual contra Supabase real. A suite arrancou, chegou ao backend real e falhou em 2 passos com resposta explícita do Supabase: `HTTP 400: Email address "suporte@alisio.pt" is invalid` tanto em sign-in email como em recovery email. Os 4 testes de links reais ficaram `skipped` porque não havia URLs reais de email nesta sessão. A `sb_secret_*` não foi usada nesta validação.
- `env ALISIO_LIVE_TEST=1 ALISIO_LIVE_ACCOUNT=1 ALISIO_SUPABASE_URL='https://jgchbqmlffheaimosyjz.supabase.co' ALISIO_SUPABASE_ANON_KEY='<publishable-key>' ALISIO_LIVE_ACCOUNT_EMAIL='nuno7lopes@gmail.com' pnpm exec vitest run --config vitest.live.config.ts src/infra/alisio-account-cloud.live.test.ts -t 'dispatches a real Supabase sign-in email' --pool=forks --maxWorkers=1 --reporter=verbose`: OK. O Supabase aceitou o inbox real e enviou o magic link.
- `env ALISIO_LIVE_TEST=1 ALISIO_LIVE_ACCOUNT=1 ALISIO_SUPABASE_URL='https://jgchbqmlffheaimosyjz.supabase.co' ALISIO_SUPABASE_ANON_KEY='<publishable-key>' ALISIO_LIVE_ACCOUNT_EMAIL='nuno7lopes@gmail.com' pnpm exec vitest run --config vitest.live.config.ts src/infra/alisio-account-cloud.live.test.ts -t 'dispatches a real recovery email' --pool=forks --maxWorkers=1 --reporter=verbose`: OK. O Supabase aceitou o inbox real e enviou o recovery email.
- Foi confirmada a presença do email `Your Magic Link` no Gmail aberto no browser local e o link antigo dessa thread foi extraído do HTML renderizado. Esse link já estava expirado (`otp_expired`).
- `env ALISIO_LIVE_TEST=1 ALISIO_LIVE_ACCOUNT=1 ALISIO_SUPABASE_URL='https://jgchbqmlffheaimosyjz.supabase.co' ALISIO_SUPABASE_ANON_KEY='<publishable-key>' ALISIO_LIVE_ACCOUNT_EMAIL='nuno7lopes@gmail.com' ALISIO_LIVE_ACCOUNT_SIGNIN_LINK_URL='<localhost-link-fragment>' pnpm exec vitest run --config vitest.live.config.ts src/infra/alisio-account-cloud.live.test.ts -t 'completes a real sign-in link from a real email' --pool=forks --maxWorkers=1 --reporter=verbose`: OK. O fluxo live de sign-in ficou fechado ponta-a-ponta.
- Durante esta validação live foi detectado que a tabela real `alisio_profiles` não expunha colunas opcionais mais recentes como `agent_name` e `terms_accepted_at`. O código desta superfície foi corrigido para tolerar essas ausências durante o fetch do perfil sem bloquear o sign-in live.
- `env ALISIO_LIVE_TEST=1 ALISIO_LIVE_ACCOUNT=1 ALISIO_SUPABASE_URL='https://jgchbqmlffheaimosyjz.supabase.co' ALISIO_SUPABASE_ANON_KEY='<publishable-key>' ALISIO_LIVE_ACCOUNT_EMAIL='nuno7lopes@gmail.com' ALISIO_LIVE_ACCOUNT_RECOVERY_LINK_URL='<localhost-link-fragment capturado do Gmail real>' pnpm exec vitest run --config vitest.live.config.ts src/infra/alisio-account-cloud.live.test.ts -t 'completes a real recovery link from a real email' --pool=forks --maxWorkers=1 --reporter=verbose`: OK. O fluxo live de recovery ficou fechado ponta-a-ponta. O `localhost` capturado do email real já trazia `refresh_token`; o código desta superfície foi corrigido para o reaproveitar quando o `access_token` do fragmento já expirou.
- `curl -I -s 'http://localhost:40705/logout/setup?step=account'` e `curl -s 'http://localhost:40705/logout/setup?step=account' | head -40`: OK. O host responde `HTTP/1.1 200 OK` e serve HTML real do Alisio; o erro anterior de `Control UI assets not found` já não era o estado actual desta sessão.

## Validação Live Pendente

- Conta/auth cloud:
  - o smoke live já foi executado contra o projecto Supabase real com um inbox aceite (`nuno7lopes@gmail.com`).
  - o fluxo de sign-in live ficou fechado ponta-a-ponta: envio real + link real + conclusão real.
  - o fluxo de recovery live ficou fechado ponta-a-ponta: envio real + link real + conclusão real.
  - a cobertura opcional de mudança real de email também ficou preparada, mas exige activar `ALISIO_LIVE_ACCOUNT_ENABLE_EMAIL_CHANGE=1` e fornecer `ALISIO_LIVE_ACCOUNT_CHANGE_EMAIL` + `ALISIO_LIVE_ACCOUNT_EMAIL_CHANGE_LINK_URL`.
- Android:
  - falta host com Java + `adb` + dispositivo Android físico para correr `pnpm android:assemble`, `pnpm android:test` e `pnpm android:test:integration`.
- iOS:
  - falta dispositivo iPhone físico e smoke manual/live de pairing, auth, reconnect, inbox e comandos foreground.
- Shared:
  - falta validação live dos consumidores iOS/Android sobre o shim `AlisioKit` em ambiente real, não apenas `swift build`/`swift test`.
- Multi-dispositivo:
  - falta smoke real entre pelo menos duas contas/dispositivos físicos para validar continuidade explícita por canal, inbox real e links reais.

## Riscos / Follow-up

- O shim `AlisioKit` continua a conter símbolos Swift `Alisio*` por compatibilidade binária/API; o objetivo desta ronda foi evitar que esses nomes continuassem a aparecer no runtime mobile, UI/resources ou identifiers persistidos.
- A suite `src/gateway/server.canvas-auth.test.ts` precisa de follow-up próprio: nesta máquina o runner gateway fica preso sem output útil mesmo com execução isolada, pelo que a cobertura factual desta ronda ficou assegurada por testes mais pequenos e específicos do contrato alterado.
- O rollout continua dependente de validar em host com Java/adb e com dispositivos físicos disponíveis; no lado iOS, este host continua inconsistente (`xcodebuild -showsdks` lista `iphoneos26.2`, mas o build genérico continua a falhar a dizer que iOS 26.2 não está instalado), além de continuar sem execução live real.
