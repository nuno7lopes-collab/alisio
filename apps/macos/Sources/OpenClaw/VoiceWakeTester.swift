import AVFoundation
import Foundation
import Speech
import SwabbleKit

enum VoiceWakeTestState: Equatable {
    case idle
    case requesting
    case listening
    case hearing(String)
    case finalizing
    case detected(String)
    case failed(String)
}

final class VoiceWakeTester {
    private var audioEngine: AVAudioEngine?
    private var recognitionContexts: [String: RecognitionContext] = [:]
    private var isStopping = false
    private var isFinalizing = false
    private var lastHeard: Date?
    private var lastLoggedText: String?
    private var lastLoggedAt: Date?
    private var lastTranscriptByLocale: [String: String] = [:]
    private var lastTranscriptAtByLocale: [String: Date] = [:]
    private var silenceTasksByLocale: [String: Task<Void, Never>] = [:]
    private var currentTriggers: [String] = []
    private var holdingAfterDetect = false
    private var detectedText: String?
    private let logger = Logger(subsystem: "ai.openclaw", category: "voicewake")
    private let silenceWindow: TimeInterval = 1.0

    private struct RecognitionContext {
        let localeID: String
        let recognizer: SFSpeechRecognizer
        let request: SFSpeechAudioBufferRecognitionRequest
        let task: SFSpeechRecognitionTask
    }

    init() {}

    func start(
        triggers: [String],
        micID: String?,
        primaryLocaleID: String?,
        additionalLocaleIDs: [String],
        onUpdate: @escaping @Sendable (VoiceWakeTestState) -> Void) async throws
    {
        guard self.recognitionContexts.isEmpty else { return }
        self.isStopping = false
        self.isFinalizing = false
        self.holdingAfterDetect = false
        self.detectedText = nil
        self.lastHeard = nil
        self.lastLoggedText = nil
        self.lastLoggedAt = nil
        self.lastTranscriptByLocale.removeAll()
        self.lastTranscriptAtByLocale.removeAll()
        self.cancelAllSilenceTasks()
        self.currentTriggers = triggers
        let localeSelection = resolveVoiceWakeLocaleSelection(
            primary: primaryLocaleID ?? Locale.current.identifier,
            additional: additionalLocaleIDs,
            availableLocaleIDs: Array(SFSpeechRecognizer.supportedLocales()).map(\.identifier))

        guard Self.hasPrivacyStrings else {
            throw NSError(
                domain: "VoiceWakeTester",
                code: 3,
                userInfo: [
                    NSLocalizedDescriptionKey: """
                    Missing mic/speech privacy strings. Rebuild the mac app (scripts/restart-mac.sh) \
                    to include usage descriptions.
                    """,
                ])
        }

        let granted = try await Self.ensurePermissions()
        guard granted else {
            throw NSError(
                domain: "VoiceWakeTester",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Microphone or speech permission denied"])
        }

        self.logInputSelection(preferredMicID: micID)

        guard AudioInputDeviceObserver.hasUsableDefaultInputDevice() else {
            self.audioEngine = nil
            throw NSError(
                domain: "VoiceWakeTester",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "No usable audio input device available"])
        }

        let engine = AVAudioEngine()
        self.audioEngine = engine

        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else {
            self.audioEngine = nil
            throw NSError(
                domain: "VoiceWakeTester",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "No audio input available"])
        }
        let contexts = self.buildRecognitionContexts(
            localeIDs: localeSelection.ordered,
            triggers: triggers,
            onUpdate: onUpdate)
        guard !contexts.isEmpty else {
            throw NSError(
                domain: "VoiceWakeTester",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Speech recognition unavailable"])
        }
        let requests = contexts.values.map(\.request)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 2048, format: format) { [requests] buffer, _ in
            for request in requests {
                request.append(buffer)
            }
        }

        engine.prepare()
        try engine.start()
        self.recognitionContexts = contexts
        DispatchQueue.main.async {
            onUpdate(.listening)
        }

        self.lastHeard = Date()
    }

    func stop() {
        self.stop(force: true)
    }

    func finalize(timeout: TimeInterval = 1.5) {
        guard !self.recognitionContexts.isEmpty else {
            self.stop(force: true)
            return
        }
        self.isFinalizing = true
        for context in self.recognitionContexts.values {
            context.request.endAudio()
        }
        if let engine = self.audioEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            if !self.isStopping {
                self.stop(force: true)
            }
        }
    }

    private func stop(force: Bool) {
        if force { self.isStopping = true }
        self.isFinalizing = false
        for context in self.recognitionContexts.values {
            context.request.endAudio()
            context.task.cancel()
        }
        self.recognitionContexts.removeAll()
        if let engine = self.audioEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        self.audioEngine = nil
        self.holdingAfterDetect = false
        self.detectedText = nil
        self.lastHeard = nil
        self.lastLoggedText = nil
        self.lastLoggedAt = nil
        self.lastTranscriptByLocale.removeAll()
        self.lastTranscriptAtByLocale.removeAll()
        self.cancelAllSilenceTasks()
        self.currentTriggers = []
    }

    private func handleResult(
        localeID: String,
        match: WakeWordGateMatch?,
        text: String,
        isFinal: Bool,
        errorMessage: String?,
        onUpdate: @escaping @Sendable (VoiceWakeTestState) -> Void) async
    {
        if !text.isEmpty {
            self.lastHeard = Date()
            self.lastTranscriptByLocale[localeID] = text
            self.lastTranscriptAtByLocale[localeID] = Date()
        }
        if self.holdingAfterDetect {
            return
        }
        if let match, !match.command.isEmpty {
            self.holdingAfterDetect = true
            self.detectedText = match.command
            self.logger.info(
                "voice wake detected (test) locale=\(localeID, privacy: .public) " +
                    "(len=\(match.command.count))")
            await MainActor.run { AppStateStore.shared.triggerVoiceEars(ttl: nil) }
            self.stop()
            await MainActor.run {
                AppStateStore.shared.stopVoiceEars()
                onUpdate(.detected(match.command))
            }
            return
        }
        if !isFinal, !text.isEmpty {
            self.scheduleSilenceCheck(
                localeID: localeID,
                triggers: self.currentTriggers,
                onUpdate: onUpdate)
        }
        if self.isFinalizing {
            Task { @MainActor in onUpdate(.finalizing) }
        }
        if let errorMessage {
            if self.recognitionContexts.count > 1 {
                self.logger.debug(
                    "voice wake test ignored locale error locale=\(localeID, privacy: .public) " +
                        "\(errorMessage, privacy: .public)")
                return
            }
            self.stop(force: true)
            Task { @MainActor in onUpdate(.failed(errorMessage)) }
            return
        }
        if isFinal {
            if self.recognitionContexts.count <= 1 {
                self.stop(force: true)
                let state: VoiceWakeTestState = text.isEmpty
                    ? .failed("No speech detected")
                    : .failed("No trigger heard: “\(text)”")
                Task { @MainActor in onUpdate(state) }
            }
        } else {
            let state: VoiceWakeTestState = text.isEmpty ? .listening : .hearing(text)
            Task { @MainActor in onUpdate(state) }
        }
    }

    private func maybeLogDebug(
        localeID: String,
        transcript: String,
        segments: [WakeWordSegment],
        triggers: [String],
        match: WakeWordGateMatch?,
        isFinal: Bool)
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
        let gaps = Self.debugCandidateGaps(triggers: triggers, segments: segments)
        let segmentSummary = Self.debugSegments(segments)
        let matchSummary = VoiceWakeRecognitionDebugSupport.matchSummary(match)

        self.logger.debug(
            "voicewake test locale=\(localeID, privacy: .public) " +
                "transcript='\(transcript, privacy: .private)' textOnly=\(summary.textOnly) " +
                "isFinal=\(isFinal) timing=\(summary.timingCount)/\(segments.count) " +
                "\(matchSummary) gaps=[\(gaps, privacy: .private)] segments=[\(segmentSummary, privacy: .private)]")
    }

    private static func debugSegments(_ segments: [WakeWordSegment]) -> String {
        segments.map { seg in
            let start = String(format: "%.2f", seg.start)
            let end = String(format: "%.2f", seg.end)
            return "\(seg.text)@\(start)-\(end)"
        }.joined(separator: ", ")
    }

    private static func debugCandidateGaps(triggers: [String], segments: [WakeWordSegment]) -> String {
        let tokens = self.normalizeSegments(segments)
        guard !tokens.isEmpty else { return "" }
        let triggerTokens = self.normalizeTriggers(triggers)
        var gaps: [String] = []

        for trigger in triggerTokens {
            let count = trigger.tokens.count
            guard count > 0, tokens.count > count else { continue }
            for i in 0...(tokens.count - count - 1) {
                let matched = (0..<count).allSatisfy { tokens[i + $0].normalized == trigger.tokens[$0] }
                if !matched { continue }
                let triggerEnd = tokens[i + count - 1].end
                let nextToken = tokens[i + count]
                let gap = nextToken.start - triggerEnd
                let formatted = String(format: "%.2f", gap)
                gaps.append("\(trigger.tokens.joined(separator: " ")):\(formatted)s")
            }
        }
        return gaps.joined(separator: ", ")
    }

    private struct DebugToken {
        let normalized: String
        let start: TimeInterval
        let end: TimeInterval
    }

    private struct DebugTriggerTokens {
        let tokens: [String]
    }

    private static func normalizeTriggers(_ triggers: [String]) -> [DebugTriggerTokens] {
        var output: [DebugTriggerTokens] = []
        for trigger in triggers {
            let tokens = trigger
                .split(whereSeparator: { $0.isWhitespace })
                .map { VoiceWakeTextUtils.normalizeToken(String($0)) }
                .filter { !$0.isEmpty }
            if tokens.isEmpty { continue }
            output.append(DebugTriggerTokens(tokens: tokens))
        }
        return output
    }

    private static func normalizeSegments(_ segments: [WakeWordSegment]) -> [DebugToken] {
        segments.compactMap { segment in
            let normalized = VoiceWakeTextUtils.normalizeToken(segment.text)
            guard !normalized.isEmpty else { return nil }
            return DebugToken(
                normalized: normalized,
                start: segment.start,
                end: segment.end)
        }
    }

    private func scheduleSilenceCheck(
        localeID: String,
        triggers: [String],
        onUpdate: @escaping @Sendable (VoiceWakeTestState) -> Void)
    {
        self.cancelSilenceTask(for: localeID)
        let lastSeenAt = self.lastTranscriptAtByLocale[localeID]
        let lastText = self.lastTranscriptByLocale[localeID]
        self.silenceTasksByLocale[localeID] = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(self.silenceWindow * 1_000_000_000))
            guard !Task.isCancelled else { return }
            guard !self.isStopping, !self.holdingAfterDetect else { return }
            guard let lastSeenAt, let lastText else { return }
            guard self.lastTranscriptAtByLocale[localeID] == lastSeenAt,
                  self.lastTranscriptByLocale[localeID] == lastText
            else { return }
            guard let match = VoiceWakeRecognitionDebugSupport.textOnlyFallbackMatch(
                transcript: lastText,
                triggers: triggers,
                config: WakeWordGateConfig(triggers: triggers),
                trimWake: WakeWordGate.stripWake)
            else { return }
            self.holdingAfterDetect = true
            self.detectedText = match.command
            self.logger.info(
                "voice wake detected (test, silence) locale=\(localeID, privacy: .public) " +
                    "(len=\(match.command.count))")
            await MainActor.run { AppStateStore.shared.triggerVoiceEars(ttl: nil) }
            self.stop()
            await MainActor.run {
                AppStateStore.shared.stopVoiceEars()
                onUpdate(.detected(match.command))
            }
        }
    }

    private func logInputSelection(preferredMicID: String?) {
        let preferred = (preferredMicID?.isEmpty == false) ? preferredMicID! : "system-default"
        self.logger.info(
            "voicewake test input preferred=\(preferred, privacy: .public) " +
                "\(AudioInputDeviceObserver.defaultInputDeviceSummary(), privacy: .public)")
    }

    private func buildRecognitionContexts(
        localeIDs: [String],
        triggers: [String],
        onUpdate: @escaping @Sendable (VoiceWakeTestState) -> Void) -> [String: RecognitionContext]
    {
        var contexts: [String: RecognitionContext] = [:]

        for localeID in localeIDs {
            let locale = Locale(identifier: localeID)
            guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
                self.logger.debug("voice wake test locale unavailable: \(localeID, privacy: .public)")
                continue
            }
            recognizer.defaultTaskHint = .dictation

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.taskHint = .dictation

            let task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self, !self.isStopping else { return }
                let text = result?.bestTranscription.formattedString ?? ""
                let segments = result.map { WakeWordSpeechSegments.from(
                    transcription: $0.bestTranscription,
                    transcript: text) } ?? []
                let isFinal = result?.isFinal ?? false
                let gateConfig = WakeWordGateConfig(triggers: triggers)
                var match = WakeWordGate.match(transcript: text, segments: segments, config: gateConfig)
                if match == nil, isFinal {
                    match = VoiceWakeRecognitionDebugSupport.textOnlyFallbackMatch(
                        transcript: text,
                        triggers: triggers,
                        config: gateConfig,
                        trimWake: WakeWordGate.stripWake)
                }
                self.maybeLogDebug(
                    localeID: localeID,
                    transcript: text,
                    segments: segments,
                    triggers: triggers,
                    match: match,
                    isFinal: isFinal)
                let errorMessage = error?.localizedDescription

                Task { [weak self] in
                    guard let self, !self.isStopping else { return }
                    await self.handleResult(
                        localeID: localeID,
                        match: match,
                        text: text,
                        isFinal: isFinal,
                        errorMessage: errorMessage,
                        onUpdate: onUpdate)
                }
            }

            contexts[localeID] = RecognitionContext(
                localeID: localeID,
                recognizer: recognizer,
                request: request,
                task: task)
        }

        return contexts
    }

    private func cancelSilenceTask(for localeID: String) {
        self.silenceTasksByLocale.removeValue(forKey: localeID)?.cancel()
    }

    private func cancelAllSilenceTasks() {
        for task in self.silenceTasksByLocale.values {
            task.cancel()
        }
        self.silenceTasksByLocale.removeAll()
    }

    private nonisolated static func ensurePermissions() async throws -> Bool {
        let speechStatus = SFSpeechRecognizer.authorizationStatus()
        if speechStatus == .notDetermined {
            let granted = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status == .authorized)
                }
            }
            guard granted else { return false }
        } else if speechStatus != .authorized {
            return false
        }

        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        switch micStatus {
        case .authorized: return true

        case .notDetermined:
            return await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    continuation.resume(returning: granted)
                }
            }

        default:
            return false
        }
    }

    private static var hasPrivacyStrings: Bool {
        let speech = Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") as? String
        let mic = Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") as? String
        return speech?.isEmpty == false && mic?.isEmpty == false
    }
}

extension VoiceWakeTester: @unchecked Sendable {}
