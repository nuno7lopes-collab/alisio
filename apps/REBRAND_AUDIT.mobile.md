# Mobile Rebrand Audit

Data: 2026-04-08
Agente: ALFA
Âmbito principal: `apps/android/**`, `apps/ios/**`
Âmbito extra justificado: `apps/shared/AlisioKit/**`

## Resumo

- Auditoria inicial encontrou `139` ficheiros com branding legado em `apps/android/**`.
- Auditoria inicial encontrou `104` ficheiros com branding legado em `apps/ios/**`.
- Estado final: `rg -n --hidden -S "openclaw|OpenClaw|ai\\.openclaw|clawdbot" apps/android apps/ios` devolve zero hits.
- Foi adicionada uma camada de compatibilidade mínima em `apps/shared/AlisioKit/**` para manter os paths mobile rebranded sem reintroduzir o package legado dentro de `apps/android/**`.

## Android

- Build/config: `settings.gradle.kts`, `app/build.gradle.kts`, `benchmark/build.gradle.kts`
- Source Kotlin/Java: package `ai.openclaw.app`, classes `OpenClaw*`, strings visíveis, tags de log, discovery `_openclaw-gw._tcp`, canvas paths `__openclaw__`, ids de cliente `openclaw-android`
- Resources/manifests: nome da app, theme `Theme.OpenClawNode`, host `openclaw.local`
- Tests: imports, fixture payloads e prefs names legados
- Misc/scripts/docs locais: `README.md`, `style.md`, `scripts/*`

## iOS

- XcodeGen/config: `project.yml`, `Signing.xcconfig`, `Config/Signing.xcconfig`, `LocalSigning.xcconfig.example`
- Targets/schemes/files: `OpenClaw`, `OpenClawShareExtension`, `OpenClawActivityWidget`, `OpenClawWatchApp`, `OpenClawWatchExtension`, `OpenClawTests`, `OpenClawLogicTests`
- Source Swift: `OpenClawApp`, `OpenClawActivityAttributes`, `OpenClawLiveActivity`, `OpenClawWatchApp`, imports `OpenClawKit` / `OpenClawProtocol` / `OpenClawChatUI`
- Runtime identifiers: bundle ids `ai.openclaw.*`, scheme `openclaw://`, bg task id `ai.openclaw.ios.bgrefresh`, keychain services `ai.openclaw.*`, push relay service `ai.openclaw.pushrelay`
- Fastlane/App Store metadata: app identifier, archive names, service names, marketing/support/privacy URLs, copy de store e review info
- Tests: imports, deep-link fixtures, keychain services, trigger words, stable IDs

## Shared Dependency Handling

- `apps/android/app/build.gradle.kts` já aponta para `../../shared/AlisioKit/...`.
- `apps/ios/project.yml` já usa o package `AlisioKit`.
- O wrapper `apps/shared/AlisioKit/**` reexporta o package legacy e carrega os resources que o Android espera, evitando tocar no package legado fora do necessário.
- Revisão profunda: `apps/ios/SwiftSources.input.xcfilelist` foi alinhado com os ficheiros reais do wrapper `AlisioKit` para remover 31 referências a paths inexistentes que poderiam partir o lint/prebuild do iOS.

## Migração de Dados a Preservar

- Android SharedPreferences/EncryptedSharedPreferences: `openclaw.node`, `openclaw.node.secure`, `openclaw.secure`
- iOS Keychain services: `ai.openclaw.gateway`, `ai.openclaw.node`, `ai.openclaw.talk`, `ai.openclaw.pushrelay`
- Implementado:
  - Android: migração compatível de `SharedPreferences` / `EncryptedSharedPreferences` e fallback para recent packages antigos; wake words antigos são promovidos para `alisio`
  - iOS: leitura com fallback e promoção para os novos services de Keychain; wake words antigos são promovidos para `alisio`

## Validação

- `rg -n --hidden -S "openclaw|OpenClaw|ai\\.openclaw|clawdbot" apps/android apps/ios`: zero hits
- `apps/ios/SwiftSources.input.xcfilelist`: zero paths inexistentes
- `swift package describe --package-path apps/shared/AlisioKit`: OK
- `swift build --package-path apps/shared/AlisioKit --target AlisioKit`: OK
- `cd apps/ios && xcodegen generate`: OK
- `swiftformat --lint --filelist apps/ios/SwiftSources.input.xcfilelist`: OK
- `swiftlint lint --use-script-input-file-lists`: só warnings pré-existentes fora da área ALFA; sem warnings nos ficheiros tocados nesta ronda
- `cd apps/android && JAVA_HOME=... ./gradlew :app:assembleDebug`: bloqueado pelo ambiente local, Android SDK ausente (`ANDROID_HOME`/`sdk.dir`)
- `cd apps/ios && xcodebuild -project Alisio.xcodeproj -scheme Alisio ... build`: bloqueado pelo ambiente local, a platform iOS 26.2 não está instalada no Xcode deste host

## Cobertura de Regressão

- Android:
  - `apps/android/app/src/test/java/ai/alisio/app/SecurePrefsTest.kt` cobre promoção de wake words vindas do prefs file legado
  - `apps/android/app/src/test/java/ai/alisio/app/node/DeviceNotificationListenerServiceTest.kt` cobre migração do ficheiro legacy `*.secure`
- iOS:
  - `apps/ios/Tests/GatewaySettingsStoreTests.swift` cobre promoção de serviços legacy no Keychain
  - `apps/ios/Tests/VoiceWakePreferencesTests.swift` cobre promoção/deduplicação de wake words legacy
