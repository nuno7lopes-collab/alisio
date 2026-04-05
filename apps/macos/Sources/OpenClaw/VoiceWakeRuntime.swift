import AVFoundation
import Foundation
import OSLog
import Speech
import SwabbleKit
#if canImport(AppKit)
import AppKit
#endif

/// Background listener that keeps the voice-wake pipeline alive outside the settings test view.
actor VoiceWakeRuntime {
    static let shared = VoiceWakeRuntime()

    enum ListeningState { case idle, voiceWake, pushToTalk }

    private let logger = Logger(subsystem: "ai.openclaw", category: "voicewake.runtime")

    // Lazily created on start to avoid creating an AVAudioEngine at app launch, which can switch Bluetooth
    // headphones into the low-quality headset profile even if Voice Wake is disabled.
    private var audioEngine: AVAudioEngine?
    private var recognitionContexts: [String: RecognitionContext] = [:]
    private var recognitionGeneration: Int = 0 // drop stale callbacks after restarts
    private var lastHeard: Date?
    private var noiseFloorRMS: Double = 1e-4
    private var captureStartedAt: Date?
    private var captureTask: Task<Void, Never>?
    private var capturedTranscript: String = ""
    private var isCapturing: Bool = false
    private var heardBeyondTrigger: Bool = false
    private var triggerChimePlayed: Bool = false
    private var committedTranscript: String = ""
    private var volatileTranscript: String = ""
    private var cooldownUntil: Date?
    private var currentConfig: RuntimeConfig?
    private var listeningState: ListeningState = .idle
    private var overlayToken: UUID?
    private var activeTriggerEndTime: TimeInterval?
    private var scheduledRestartTask: Task<Void, Never>?
    private var lastLoggedText: String?
    private var lastLoggedAt: Date?
    private var lastTapLogAt: Date?
    private var lastCallbackLogAt: Date?
    private var lastTranscriptByLocale: [String: String] = [:]
    private var lastTranscriptAtByLocale: [String: Date] = [:]
    private var preDetectTasksByLocale: [String: Task<Void, Never>] = [:]
    private var isStarting: Bool = false
    private var triggerOnlyTasksByLocale: [String: Task<Void, Never>] = [:]
    private var captureLocaleID: String?

    /// Tunables
    /// Silence threshold once we've captured user speech (post-trigger).
    private let silenceWindow: TimeInterval = 2.0
    /// Silence threshold when we only heard the trigger but no post-trigger speech yet.
    private let triggerOnlySilenceWindow: TimeInterval = 5.0
    // Maximum capture duration from trigger until we force-send, to avoid runaway sessions.
    private let captureHardStop: TimeInterval = 120.0
    private let debounceAfterSend: TimeInterval = 0.35
    // Voice activity detection parameters (RMS-based).
    private let minSpeechRMS: Double = 1e-3
    private let speechBoostFactor: Double = 6.0 // how far above noise floor we require to mark speech
    private let preDetectSilenceWindow: TimeInterval = 1.0
    private let triggerPauseWindow: TimeInterval = 0.55

    /// Stops the active Speech pipeline without clearing the stored config, so we can restart cleanly.
    private func haltRecognitionPipeline() {
        // Bump generation first so any in-flight callbacks from the cancelled task get dropped.
        self.recognitionGeneration &+= 1
        for context in self.recognitionContexts.values {
            context.task.cancel()
            context.request.endAudio()
        }
        self.recognitionContexts.removeAll()
        self.audioEngine?.inputNode.removeTap(onBus: 0)
        self.audioEngine?.stop()
        // Release the engine so we also release any audio session/resources when Voice Wake is idle.
        self.audioEngine = nil
    }

    struct RuntimeConfig: Equatable {
        let triggers: [String]
        let micID: String?
        let localeIDs: [String]
        let triggerChime: VoiceWakeChime
        let sendChime: VoiceWakeChime

        var primaryLocaleID: String? {
            self.localeIDs.first
        }

        var additionalLocaleIDs: [String] {
            Array(self.localeIDs.dropFirst())
        }
    }

    private struct RecognitionContext {
        let localeID: String
        let recognizer: SFSpeechRecognizer
        let request: SFSpeechAudioBufferRecognitionRequest
        let task: SFSpeechRecognitionTask
    }

    private struct RecognitionUpdate {
        let localeID: String
        let transcript: String?
        let segments: [WakeWordSegment]
        let isFinal: Bool
        let error: Error?
        let generation: Int
    }

    func refresh(state: AppState) async {
        let snapshot = await MainActor.run { () -> (Bool, RuntimeConfig) in
            let enabled = state.swabbleEnabled
            let localeSelection = resolveVoiceWakeLocaleSelection(
                primary: state.voiceWakeLocaleID,
                additional: state.voiceWakeAdditionalLocaleIDs,
                availableLocaleIDs: Array(SFSpeechRecognizer.supportedLocales()).map(\.identifier))
            let config = RuntimeConfig(
                triggers: sanitizeVoiceWakeTriggers(state.swabbleTriggerWords),
                micID: state.voiceWakeMicID.isEmpty ? nil : state.voiceWakeMicID,
                localeIDs: localeSelection.ordered,
                triggerChime: state.voiceWakeTriggerChime,
                sendChime: state.voiceWakeSendChime)
            return (enabled, config)
        }

        guard voiceWakeSupported, snapshot.0 else {
            self.stop()
            return
        }

        guard PermissionManager.voiceWakePermissionsGranted() else {
            self.logger.debug("voicewake runtime not starting: permissions missing")
            self.stop()
            return
        }

        let config = snapshot.1

        if self.isStarting {
            return
        }

        if self.scheduledRestartTask != nil, config == self.currentConfig, self.recognitionContexts.isEmpty {
            return
        }

        if self.scheduledRestartTask != nil {
            self.scheduledRestartTask?.cancel()
            self.scheduledRestartTask = nil
        }

        if config == self.currentConfig, !self.recognitionContexts.isEmpty {
            return
        }

        self.stop()
        await self.start(with: config)
    }

    private func start(with config: RuntimeConfig) async {
        if self.isStarting {
            return
        }
        self.isStarting = true
        defer { self.isStarting = false }
        do {
            self.recognitionGeneration &+= 1
            let generation = self.recognitionGeneration

            // Lazily create the engine here so app launch doesn't grab audio resources / trigger Bluetooth HFP.
            if self.audioEngine == nil {
                self.audioEngine = AVAudioEngine()
            }
            guard let audioEngine = self.audioEngine else { return }

            guard AudioInputDeviceObserver.hasUsableDefaultInputDevice() else {
                self.audioEngine = nil
                throw NSError(
                    domain: "VoiceWakeRuntime",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "No usable audio input device available"])
            }

            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.channelCount > 0, format.sampleRate > 0 else {
                throw NSError(
                    domain: "VoiceWakeRuntime",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "No audio input available"])
            }
            let contexts = self.buildRecognitionContexts(localeIDs: config.localeIDs, generation: generation, config: config)
            guard !contexts.isEmpty else {
                self.logger.error("voicewake runtime: speech recognizer unavailable")
                self.audioEngine?.stop()
                self.audioEngine = nil
                return
            }
            let requests = contexts.values.map(\.request)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self, requests] buffer, _ in
                for request in requests {
                    request.append(buffer)
                }
                guard let rms = Self.rmsLevel(buffer: buffer) else { return }
                Task.detached { [weak self] in
                    await self?.noteAudioLevel(rms: rms)
                    await self?.noteAudioTap(rms: rms)
                }
            }

            audioEngine.prepare()
            try audioEngine.start()

            self.recognitionContexts = contexts
            self.currentConfig = config
            self.lastHeard = Date()
            // Preserve any existing cooldownUntil so the debounce after send isn't wiped by a restart.

            let preferred = config.micID?.isEmpty == false ? config.micID! : "system-default"
            self.logger.info(
                "voicewake runtime input preferred=\(preferred, privacy: .public) " +
                    "\(AudioInputDeviceObserver.defaultInputDeviceSummary(), privacy: .public)")
            self.logger.info("voicewake runtime started")
            DiagnosticsFileLog.shared.log(category: "voicewake.runtime", event: "started", fields: [
                "locale": config.primaryLocaleID ?? "",
                "additionalLocales": config.additionalLocaleIDs.joined(separator: ","),
                "micID": config.micID ?? "",
            ])
        } catch {
            self.logger.error("voicewake runtime failed to start: \(error.localizedDescription, privacy: .public)")
            self.stop()
        }
    }

    private func buildRecognitionContexts(
        localeIDs: [String],
        generation: Int,
        config: RuntimeConfig) -> [String: RecognitionContext]
    {
        var contexts: [String: RecognitionContext] = [:]

        for localeID in localeIDs {
            let locale = Locale(identifier: localeID)
            guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
                self.logger.debug("voicewake runtime locale unavailable: \(localeID, privacy: .public)")
                continue
            }

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.taskHint = .dictation

            let task = recognizer.recognitionTask(with: request) { [weak self, generation, localeID] result, error in
                guard let self else { return }
                let transcript = result?.bestTranscription.formattedString
                let segments = result.flatMap { result in
                    transcript.map { WakeWordSpeechSegments.from(transcription: result.bestTranscription, transcript: $0) }
                } ?? []
                let isFinal = result?.isFinal ?? false
                Task {
                    await self.noteRecognitionCallback(
                        transcript: transcript,
                        isFinal: isFinal,
                        error: error,
                        localeID: localeID)
                }
                let update = RecognitionUpdate(
                    localeID: localeID,
                    transcript: transcript,
                    segments: segments,
                    isFinal: isFinal,
                    error: error,
                    generation: generation)
                Task { await self.handleRecognition(update, config: config) }
            }

            contexts[localeID] = RecognitionContext(
                localeID: localeID,
                recognizer: recognizer,
                request: request,
                task: task)
        }

        return contexts
    }

    private func stop(dismissOverlay: Bool = true, cancelScheduledRestart: Bool = true) {
        if cancelScheduledRestart {
            self.scheduledRestartTask?.cancel()
            self.scheduledRestartTask = nil
        }
        self.captureTask?.cancel()
        self.captureTask = nil
        self.isCapturing = false
        self.capturedTranscript = ""
        self.captureStartedAt = nil
        self.triggerChimePlayed = false
        self.lastTranscriptByLocale.removeAll()
        self.lastTranscriptAtByLocale.removeAll()
        self.cancelAllPreDetectTasks()
        self.cancelAllTriggerOnlyTasks()
        self.haltRecognitionPipeline()
        self.currentConfig = nil
        self.listeningState = .idle
        self.activeTriggerEndTime = nil
        self.captureLocaleID = nil
        self.logger.debug("voicewake runtime stopped")
        DiagnosticsFileLog.shared.log(category: "voicewake.runtime", event: "stopped")

        let token = self.overlayToken
        self.overlayToken = nil
        guard dismissOverlay else { return }
        Task { @MainActor in
            if let token {
                VoiceSessionCoordinator.shared.dismiss(token: token, reason: .explicit, outcome: .empty)
            } else {
                VoiceWakeOverlayController.shared.dismiss()
            }
        }
    }

    private func handleRecognition(_ update: RecognitionUpdate, config: RuntimeConfig) async {
        if update.generation != self.recognitionGeneration {
            return // stale callback from a superseded recognizer session
        }
        if let error = update.error {
            self.logger.debug(
                "voicewake recognition error locale=\(update.localeID, privacy: .public) " +
                    "\(error.localizedDescription, privacy: .public)")
        }

        guard let transcript = update.transcript else { return }

        let now = Date()
        if !transcript.isEmpty {
            self.lastHeard = now
            if !self.isCapturing {
                self.lastTranscriptByLocale[update.localeID] = transcript
                self.lastTranscriptAtByLocale[update.localeID] = now
            }
            if self.isCapturing {
                guard update.localeID == self.captureLocaleID else { return }
                self.maybeLogRecognition(
                    localeID: update.localeID,
                    transcript: transcript,
                    segments: update.segments,
                    triggers: config.triggers,
                    isFinal: update.isFinal,
                    match: nil,
                    usedFallback: false,
                    capturing: true)
                let trimmed = Self.commandAfterTrigger(
                    transcript: transcript,
                    segments: update.segments,
                    triggerEndTime: self.activeTriggerEndTime,
                    triggers: config.triggers)
                self.capturedTranscript = trimmed
                self.updateHeardBeyondTrigger(withTrimmed: trimmed)
                if update.isFinal {
                    self.committedTranscript = trimmed
                    self.volatileTranscript = ""
                } else {
                    self.volatileTranscript = VoiceOverlayTextFormatting.delta(
                        after: self.committedTranscript,
                        current: trimmed)
                }

                let attributed = VoiceOverlayTextFormatting.makeAttributed(
                    committed: self.committedTranscript,
                    volatile: self.volatileTranscript,
                    isFinal: update.isFinal)
                let snapshot = self.committedTranscript + self.volatileTranscript
                if let token = self.overlayToken {
                    await MainActor.run {
                        VoiceSessionCoordinator.shared.updatePartial(
                            token: token,
                            text: snapshot,
                            attributed: attributed)
                    }
                }
            }
        }

        if self.isCapturing { return }

        let gateConfig = WakeWordGateConfig(triggers: config.triggers)
        var usedFallback = false
        var match = WakeWordGate.match(transcript: transcript, segments: update.segments, config: gateConfig)
        if match == nil, update.isFinal {
            match = VoiceWakeRecognitionDebugSupport.textOnlyFallbackMatch(
                transcript: transcript,
                triggers: config.triggers,
                config: gateConfig,
                trimWake: Self.trimmedAfterTrigger)
            usedFallback = match != nil
        }
        self.maybeLogRecognition(
            localeID: update.localeID,
            transcript: transcript,
            segments: update.segments,
            triggers: config.triggers,
            isFinal: update.isFinal,
            match: match,
            usedFallback: usedFallback,
            capturing: false)

        if let match {
            if let cooldown = cooldownUntil, now < cooldown {
                return
            }
            if usedFallback {
                self.logger.info(
                    "voicewake runtime detected (text-only fallback) locale=\(update.localeID, privacy: .public) " +
                        "len=\(match.command.count)")
            } else {
                self.logger.info(
                    "voicewake runtime detected locale=\(update.localeID, privacy: .public) " +
                        "len=\(match.command.count)")
            }
            await self.beginCapture(
                command: match.command,
                triggerEndTime: match.triggerEndTime,
                localeID: update.localeID,
                config: config)
        } else if !transcript.isEmpty, update.error == nil {
            if self.isTriggerOnly(transcript: transcript, triggers: config.triggers) {
                self.cancelPreDetectTask(for: update.localeID)
                self.scheduleTriggerOnlyPauseCheck(
                    localeID: update.localeID,
                    triggers: config.triggers,
                    config: config)
            } else {
                self.cancelTriggerOnlyTask(for: update.localeID)
                self.schedulePreDetectSilenceCheck(
                    localeID: update.localeID,
                    triggers: config.triggers,
                    gateConfig: gateConfig,
                    config: config)
            }
        }
    }

    private func maybeLogRecognition(
        localeID: String,
        transcript: String,
        segments: [WakeWordSegment],
        triggers: [String],
        isFinal: Bool,
        match: WakeWordGateMatch?,
        usedFallback: Bool,
        capturing: Bool)
    {
        guard VoiceWakeRecognitionDebugSupport.shouldLogTranscript(
            transcript: transcript,
            isFinal: isFinal,
            loggerLevel: self.logger.logLevel,
            lastLoggedText: &self.lastLoggedText,
            lastLoggedAt: &self.lastLoggedAt)
        else { return }

        let summary = VoiceWakeRecognitionDebugSupport.transcriptSummary(
            transcript: transcript,
            triggers: triggers,
            segments: segments)
        let matchSummary = VoiceWakeRecognitionDebugSupport.matchSummary(match)
        let segmentSummary = segments.map { seg in
            let start = String(format: "%.2f", seg.start)
            let end = String(format: "%.2f", seg.end)
            return "\(seg.text)@\(start)-\(end)"
        }.joined(separator: ", ")

        self.logger.debug(
            "voicewake runtime locale=\(localeID, privacy: .public) " +
                "transcript='\(transcript, privacy: .private)' textOnly=\(summary.textOnly) " +
                "isFinal=\(isFinal) timing=\(summary.timingCount)/\(segments.count) " +
                "capturing=\(capturing) fallback=\(usedFallback) " +
                "\(matchSummary) segments=[\(segmentSummary, privacy: .private)]")
    }

    private func noteAudioTap(rms: Double) {
        let now = Date()
        if let last = self.lastTapLogAt, now.timeIntervalSince(last) < 1.0 {
            return
        }
        self.lastTapLogAt = now
        let db = 20 * log10(max(rms, 1e-7))
        self.logger.debug(
            "voicewake runtime audio tap rms=\(String(format: "%.6f", rms)) " +
                "db=\(String(format: "%.1f", db)) capturing=\(self.isCapturing)")
    }

    private func noteRecognitionCallback(transcript: String?, isFinal: Bool, error: Error?, localeID: String) {
        guard transcript?.isEmpty ?? true else { return }
        let now = Date()
        if let last = self.lastCallbackLogAt, now.timeIntervalSince(last) < 1.0 {
            return
        }
        self.lastCallbackLogAt = now
        let errorSummary = error?.localizedDescription ?? "none"
        self.logger.debug(
            "voicewake runtime callback locale=\(localeID, privacy: .public) " +
                "empty transcript isFinal=\(isFinal) error=\(errorSummary, privacy: .public)")
    }

    private func cancelPreDetectTask(for localeID: String) {
        self.preDetectTasksByLocale.removeValue(forKey: localeID)?.cancel()
    }

    private func cancelTriggerOnlyTask(for localeID: String) {
        self.triggerOnlyTasksByLocale.removeValue(forKey: localeID)?.cancel()
    }

    private func cancelAllPreDetectTasks() {
        for task in self.preDetectTasksByLocale.values {
            task.cancel()
        }
        self.preDetectTasksByLocale.removeAll()
    }

    private func cancelAllTriggerOnlyTasks() {
        for task in self.triggerOnlyTasksByLocale.values {
            task.cancel()
        }
        self.triggerOnlyTasksByLocale.removeAll()
    }

    private func scheduleTriggerOnlyPauseCheck(localeID: String, triggers: [String], config: RuntimeConfig) {
        self.cancelTriggerOnlyTask(for: localeID)
        let lastSeenAt = self.lastTranscriptAtByLocale[localeID]
        let lastText = self.lastTranscriptByLocale[localeID]
        let windowNanos = UInt64(self.triggerPauseWindow * 1_000_000_000)
        self.triggerOnlyTasksByLocale[localeID] = Task { [weak self, lastSeenAt, lastText] in
            try? await Task.sleep(nanoseconds: windowNanos)
            guard let self else { return }
            await self.triggerOnlyPauseCheck(
                localeID: localeID,
                lastSeenAt: lastSeenAt,
                lastText: lastText,
                triggers: triggers,
                config: config)
        }
    }

    private func schedulePreDetectSilenceCheck(
        localeID: String,
        triggers: [String],
        gateConfig: WakeWordGateConfig,
        config: RuntimeConfig)
    {
        self.cancelPreDetectTask(for: localeID)
        let lastSeenAt = self.lastTranscriptAtByLocale[localeID]
        let lastText = self.lastTranscriptByLocale[localeID]
        let windowNanos = UInt64(self.preDetectSilenceWindow * 1_000_000_000)
        self.preDetectTasksByLocale[localeID] = Task { [weak self, lastSeenAt, lastText] in
            try? await Task.sleep(nanoseconds: windowNanos)
            guard let self else { return }
            await self.preDetectSilenceCheck(
                localeID: localeID,
                lastSeenAt: lastSeenAt,
                lastText: lastText,
                triggers: triggers,
                gateConfig: gateConfig,
                config: config)
        }
    }

    private func triggerOnlyPauseCheck(
        localeID: String,
        lastSeenAt: Date?,
        lastText: String?,
        triggers: [String],
        config: RuntimeConfig) async
    {
        guard !Task.isCancelled else { return }
        guard !self.isCapturing else { return }
        guard let lastSeenAt, let lastText else { return }
        guard self.lastTranscriptAtByLocale[localeID] == lastSeenAt,
              self.lastTranscriptByLocale[localeID] == lastText
        else { return }
        guard self.isTriggerOnly(transcript: lastText, triggers: triggers) else { return }
        if let cooldown = self.cooldownUntil, Date() < cooldown {
            return
        }
        self.logger.info("voicewake runtime detected (trigger-only pause) locale=\(localeID, privacy: .public)")
        await self.beginCapture(command: "", triggerEndTime: nil, localeID: localeID, config: config)
    }

    private func isTriggerOnly(transcript: String, triggers: [String]) -> Bool {
        guard WakeWordGate.matchesTextOnly(text: transcript, triggers: triggers) else { return false }
        guard VoiceWakeTextUtils.startsWithTrigger(transcript: transcript, triggers: triggers) else { return false }
        return Self.trimmedAfterTrigger(transcript, triggers: triggers).isEmpty
    }

    private func preDetectSilenceCheck(
        localeID: String,
        lastSeenAt: Date?,
        lastText: String?,
        triggers: [String],
        gateConfig: WakeWordGateConfig,
        config: RuntimeConfig) async
    {
        guard !Task.isCancelled else { return }
        guard !self.isCapturing else { return }
        guard let lastSeenAt, let lastText else { return }
        guard self.lastTranscriptAtByLocale[localeID] == lastSeenAt,
              self.lastTranscriptByLocale[localeID] == lastText
        else { return }
        guard let match = VoiceWakeRecognitionDebugSupport.textOnlyFallbackMatch(
            transcript: lastText,
            triggers: triggers,
            config: gateConfig,
            trimWake: Self.trimmedAfterTrigger)
        else { return }
        if let cooldown = self.cooldownUntil, Date() < cooldown {
            return
        }
        self.logger.info(
            "voicewake runtime detected (silence fallback) locale=\(localeID, privacy: .public) " +
                "len=\(match.command.count)")
        await self.beginCapture(
            command: match.command,
            triggerEndTime: match.triggerEndTime,
            localeID: localeID,
            config: config)
    }

    private func beginCapture(
        command: String,
        triggerEndTime: TimeInterval?,
        localeID: String,
        config: RuntimeConfig) async
    {
        self.listeningState = .voiceWake
        self.isCapturing = true
        self.captureLocaleID = localeID
        DiagnosticsFileLog.shared.log(category: "voicewake.runtime", event: "beginCapture")
        self.capturedTranscript = command
        self.committedTranscript = ""
        self.volatileTranscript = command
        self.captureStartedAt = Date()
        self.cooldownUntil = nil
        self.heardBeyondTrigger = !command.isEmpty
        self.triggerChimePlayed = false
        self.activeTriggerEndTime = triggerEndTime
        self.cancelAllPreDetectTasks()
        self.cancelAllTriggerOnlyTasks()

        if config.triggerChime != .none, !self.triggerChimePlayed {
            self.triggerChimePlayed = true
            await MainActor.run { VoiceWakeChimePlayer.play(config.triggerChime, reason: "voicewake.trigger") }
        }

        let snapshot = self.committedTranscript + self.volatileTranscript
        let attributed = VoiceOverlayTextFormatting.makeAttributed(
            committed: self.committedTranscript,
            volatile: self.volatileTranscript,
            isFinal: false)
        self.overlayToken = await MainActor.run {
            VoiceSessionCoordinator.shared.startSession(
                source: .wakeWord,
                text: snapshot,
                attributed: attributed,
                forwardEnabled: true)
        }

        // Keep the "ears" boosted for the capture window so the status icon animates while recording.
        await MainActor.run { AppStateStore.shared.triggerVoiceEars(ttl: nil) }

        self.captureTask?.cancel()
        self.captureTask = Task { [weak self] in
            guard let self else { return }
            await self.monitorCapture(config: config)
        }
    }

    private func monitorCapture(config: RuntimeConfig) async {
        let start = self.captureStartedAt ?? Date()
        let hardStop = start.addingTimeInterval(self.captureHardStop)

        while self.isCapturing {
            let now = Date()
            if now >= hardStop {
                // Hard-stop after a maximum duration so we never leave the recognizer pinned open.
                await self.finalizeCapture(config: config)
                return
            }

            let silenceThreshold = self.heardBeyondTrigger ? self.silenceWindow : self.triggerOnlySilenceWindow
            if let last = self.lastHeard, now.timeIntervalSince(last) >= silenceThreshold {
                await self.finalizeCapture(config: config)
                return
            }

            try? await Task.sleep(nanoseconds: 200_000_000)
        }
    }

    private func finalizeCapture(config: RuntimeConfig) async {
        guard self.isCapturing else { return }
        self.isCapturing = false
        // Disarm trigger matching immediately (before halting recognition) to avoid double-trigger
        // races from late callbacks that arrive after isCapturing is cleared.
        self.cooldownUntil = Date().addingTimeInterval(self.debounceAfterSend)
        self.captureTask?.cancel()
        self.captureTask = nil

        let finalTranscript = self.capturedTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        DiagnosticsFileLog.shared.log(category: "voicewake.runtime", event: "finalizeCapture", fields: [
            "finalLen": "\(finalTranscript.count)",
        ])
        // Stop further recognition events so we don't retrigger immediately with buffered audio.
        self.haltRecognitionPipeline()
        self.capturedTranscript = ""
        self.captureStartedAt = nil
        self.lastHeard = nil
        self.heardBeyondTrigger = false
        self.triggerChimePlayed = false
        self.activeTriggerEndTime = nil
        self.captureLocaleID = nil
        self.lastTranscriptByLocale.removeAll()
        self.lastTranscriptAtByLocale.removeAll()
        self.cancelAllPreDetectTasks()
        self.cancelAllTriggerOnlyTasks()

        await MainActor.run { AppStateStore.shared.stopVoiceEars() }
        if let token = self.overlayToken {
            await MainActor.run { VoiceSessionCoordinator.shared.updateLevel(token: token, 0) }
        }

        let delay: TimeInterval = 0.0
        let sendChime = finalTranscript.isEmpty ? .none : config.sendChime
        if let token = self.overlayToken {
            await MainActor.run {
                VoiceSessionCoordinator.shared.finalize(
                    token: token,
                    text: finalTranscript,
                    sendChime: sendChime,
                    autoSendAfter: delay)
            }
        } else if !finalTranscript.isEmpty {
            if sendChime != .none {
                await MainActor.run { VoiceWakeChimePlayer.play(sendChime, reason: "voicewake.send") }
            }
            Task.detached {
                await VoiceWakeForwarder.forward(transcript: finalTranscript)
            }
        }
        self.overlayToken = nil
        self.scheduleRestartRecognizer()
    }

    // MARK: - Audio level handling

    private func noteAudioLevel(rms: Double) {
        guard self.isCapturing else { return }

        // Update adaptive noise floor: faster when lower energy (quiet), slower when loud.
        let alpha: Double = rms < self.noiseFloorRMS ? 0.08 : 0.01
        self.noiseFloorRMS = max(1e-7, self.noiseFloorRMS + (rms - self.noiseFloorRMS) * alpha)

        let threshold = max(self.minSpeechRMS, self.noiseFloorRMS * self.speechBoostFactor)
        if rms >= threshold {
            self.lastHeard = Date()
        }

        // Normalize against the adaptive threshold so the UI meter stays roughly 0...1 across devices.
        let clamped = min(1.0, max(0.0, rms / max(self.minSpeechRMS, threshold)))
        if let token = self.overlayToken {
            Task { @MainActor in
                VoiceSessionCoordinator.shared.updateLevel(token: token, clamped)
            }
        }
    }

    private static func rmsLevel(buffer: AVAudioPCMBuffer) -> Double? {
        guard let channelData = buffer.floatChannelData?.pointee else { return nil }
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return nil }
        var sum: Double = 0
        for i in 0..<frameCount {
            let sample = Double(channelData[i])
            sum += sample * sample
        }
        return sqrt(sum / Double(frameCount))
    }

    private func restartRecognizer() {
        // Restart the recognizer so we listen for the next trigger with a clean buffer.
        let current = self.currentConfig
        self.stop(dismissOverlay: false, cancelScheduledRestart: false)
        if let current {
            Task { await self.start(with: current) }
        }
    }

    private func restartRecognizerIfIdleAndOverlayHidden() async {
        if self.isCapturing { return }
        self.restartRecognizer()
    }

    private func scheduleRestartRecognizer(delay: TimeInterval = 0.7) {
        self.scheduledRestartTask?.cancel()
        self.scheduledRestartTask = Task { [weak self] in
            let nanos = UInt64(max(0, delay) * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanos)
            guard let self else { return }
            await self.consumeScheduledRestart()
            await self.restartRecognizerIfIdleAndOverlayHidden()
        }
    }

    private func consumeScheduledRestart() {
        self.scheduledRestartTask = nil
    }

    func applyPushToTalkCooldown() {
        self.cooldownUntil = Date().addingTimeInterval(self.debounceAfterSend)
    }

    func pauseForPushToTalk() {
        self.listeningState = .pushToTalk
        self.stop(dismissOverlay: false)
    }

    private func updateHeardBeyondTrigger(withTrimmed trimmed: String) {
        if !self.heardBeyondTrigger, !trimmed.isEmpty {
            self.heardBeyondTrigger = true
        }
    }

    private static func trimmedAfterTrigger(_ text: String, triggers: [String]) -> String {
        for trigger in triggers {
            let token = trigger.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !token.isEmpty else { continue }
            guard let range = text.range(
                of: token,
                options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive]) else { continue }
            let trimmed = text[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
            return String(trimmed)
        }
        return text
    }

    private static func commandAfterTrigger(
        transcript: String,
        segments: [WakeWordSegment],
        triggerEndTime: TimeInterval?,
        triggers: [String]) -> String
    {
        guard let triggerEndTime else {
            return self.trimmedAfterTrigger(transcript, triggers: triggers)
        }
        let trimmed = WakeWordGate.commandText(
            transcript: transcript,
            segments: segments,
            triggerEndTime: triggerEndTime)
        return trimmed.isEmpty ? self.trimmedAfterTrigger(transcript, triggers: triggers) : trimmed
    }

    #if DEBUG
    static func _testTrimmedAfterTrigger(_ text: String, triggers: [String]) -> String {
        self.trimmedAfterTrigger(text, triggers: triggers)
    }

    static func _testHasContentAfterTrigger(_ text: String, triggers: [String]) -> Bool {
        !self.trimmedAfterTrigger(text, triggers: triggers).isEmpty
    }

    static func _testAttributedColor(isFinal: Bool) -> NSColor {
        VoiceOverlayTextFormatting.makeAttributed(committed: "sample", volatile: "", isFinal: isFinal)
            .attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor ?? .clear
    }

    #endif
}
