import Foundation

import AlisioSupport
// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-alisio writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = AlisioBrand.launchdLabel
let gatewayLaunchdLabel = AlisioBrand.gatewayLaunchdLabel
let onboardingVersionKey = AlisioBrand.defaultsPrefix + "onboardingVersion"
let onboardingSeenKey = AlisioBrand.defaultsPrefix + "onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = AlisioBrand.defaultsPrefix + "pauseEnabled"
let iconAnimationsEnabledKey = AlisioBrand.defaultsPrefix + "iconAnimationsEnabled"
let swabbleEnabledKey = AlisioBrand.defaultsPrefix + "swabbleEnabled"
let swabbleTriggersKey = AlisioBrand.defaultsPrefix + "swabbleTriggers"
let voiceWakeTriggerChimeKey = AlisioBrand.defaultsPrefix + "voiceWakeTriggerChime"
let voiceWakeSendChimeKey = AlisioBrand.defaultsPrefix + "voiceWakeSendChime"
let showDockIconKey = AlisioBrand.defaultsPrefix + "showDockIcon"
let defaultVoiceWakeTriggers = [AlisioBrand.commandName]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = AlisioBrand.defaultsPrefix + "voiceWakeMicID"
let voiceWakeMicNameKey = AlisioBrand.defaultsPrefix + "voiceWakeMicName"
let voiceWakeLocaleKey = AlisioBrand.defaultsPrefix + "voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = AlisioBrand.defaultsPrefix + "voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = AlisioBrand.defaultsPrefix + "voicePushToTalkEnabled"
let talkEnabledKey = AlisioBrand.defaultsPrefix + "talkEnabled"
let iconOverrideKey = AlisioBrand.defaultsPrefix + "iconOverride"
let connectionModeKey = AlisioBrand.defaultsPrefix + "connectionMode"
let remoteTargetKey = AlisioBrand.defaultsPrefix + "remoteTarget"
let remoteIdentityKey = AlisioBrand.defaultsPrefix + "remoteIdentity"
let remoteProjectRootKey = AlisioBrand.defaultsPrefix + "remoteProjectRoot"
let remoteCliPathKey = AlisioBrand.defaultsPrefix + "remoteCliPath"
let canvasEnabledKey = AlisioBrand.defaultsPrefix + "canvasEnabled"
let cameraEnabledKey = AlisioBrand.defaultsPrefix + "cameraEnabled"
let systemRunPolicyKey = AlisioBrand.defaultsPrefix + "systemRunPolicy"
let systemRunAllowlistKey = AlisioBrand.defaultsPrefix + "systemRunAllowlist"
let systemRunEnabledKey = AlisioBrand.defaultsPrefix + "systemRunEnabled"
let locationModeKey = AlisioBrand.defaultsPrefix + "locationMode"
let locationPreciseKey = AlisioBrand.defaultsPrefix + "locationPreciseEnabled"
let peekabooBridgeEnabledKey = AlisioBrand.defaultsPrefix + "peekabooBridgeEnabled"
let deepLinkKeyKey = AlisioBrand.defaultsPrefix + "deepLinkKey"
let modelCatalogPathKey = AlisioBrand.defaultsPrefix + "modelCatalogPath"
let modelCatalogReloadKey = AlisioBrand.defaultsPrefix + "modelCatalogReload"
let cliInstallPromptedVersionKey = AlisioBrand.defaultsPrefix + "cliInstallPromptedVersion"
let heartbeatsEnabledKey = AlisioBrand.defaultsPrefix + "heartbeatsEnabled"
let debugPaneEnabledKey = AlisioBrand.defaultsPrefix + "debugPaneEnabled"
let debugFileLogEnabledKey = AlisioBrand.defaultsPrefix + "debug.fileLogEnabled"
let appLogLevelKey = AlisioBrand.defaultsPrefix + "debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
