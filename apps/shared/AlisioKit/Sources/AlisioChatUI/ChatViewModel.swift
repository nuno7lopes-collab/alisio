import AlisioKit
import Foundation
import Observation
import OSLog
import UniformTypeIdentifiers

#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

private let chatUILogger = Logger(subsystem: "ai.alisio", category: "AlisioChatUI")

public enum AlisioChatConnectionPhase: String, Equatable, Sendable {
    case bootstrapping
    case loading
    case reconnecting
    case firstMessage
    case ready
}

@MainActor
@Observable
public final class AlisioChatViewModel {
    private struct CachedSessionState {
        let messages: [AlisioChatMessage]
        let sessionId: String?
        let hasLoadedHistory: Bool
        let thinkingLevel: String
        let lastBootstrapAt: Date?
        let lastHistoryRefreshAt: Date?
    }

    public static let defaultModelSelectionID = "__default__"

    public private(set) var messages: [AlisioChatMessage] = []
    public var input: String = ""
    public private(set) var thinkingLevel: String
    public private(set) var modelSelectionID: String = "__default__"
    public private(set) var modelChoices: [AlisioChatModelChoice] = []
    public private(set) var isLoading = false
    public private(set) var isSending = false
    public private(set) var isAborting = false
    public var errorText: String?
    public var attachments: [AlisioPendingAttachment] = []
    public private(set) var healthOK: Bool = false
    public private(set) var pendingRunCount: Int = 0
    public private(set) var hasLoadedHistory = false
    public private(set) var isRecoveringConnection = false
    public private(set) var lastBootstrapAt: Date?
    public private(set) var lastHistoryRefreshAt: Date?
    public private(set) var lastTransportEventAt: Date?
    public private(set) var lastRecoveryAt: Date?

    public private(set) var sessionKey: String
    public private(set) var sessionId: String?
    public private(set) var streamingAssistantText: String?
    public private(set) var pendingToolCalls: [AlisioChatPendingToolCall] = []
    public private(set) var sessions: [AlisioChatSessionEntry] = []
    public private(set) var isRefreshingSessions = false
    public private(set) var isCreatingSession = false
    public private(set) var sessionListErrorText: String?
    public private(set) var sessionActionErrorText: String?
    private let transport: any AlisioChatTransport
    private var sessionDefaults: AlisioChatSessionsDefaults?
    private let prefersExplicitThinkingLevel: Bool
    private let onThinkingLevelChanged: (@MainActor @Sendable (String) -> Void)?
    private let onSessionKeyChanged: (@MainActor @Sendable (String) -> Void)?

    @ObservationIgnored
    private nonisolated(unsafe) var eventTask: Task<Void, Never>?
    private var pendingRuns = Set<String>() {
        didSet { self.refreshPendingRunCount() }
    }
    private var dispatchingRunIDs = Set<String>() {
        didSet { self.refreshPendingRunCount() }
    }
    private var abortRequestedRunIDs = Set<String>() {
        didSet { self.isAborting = !self.abortRequestedRunIDs.isEmpty }
    }
    private var streamingAssistantRunID: String?
    private var pendingToolCallRunIDsById: [String: String] = [:]

    @ObservationIgnored
    private nonisolated(unsafe) var pendingRunTimeoutTasks: [String: Task<Void, Never>] = [:]
    private let pendingRunTimeoutMs: UInt64 = 120_000
    // Session switches can overlap in-flight picker patches, so stale completions
    // must compare against the latest request and latest desired value for that session.
    private var nextModelSelectionRequestID: UInt64 = 0
    private var latestModelSelectionRequestIDsBySession: [String: UInt64] = [:]
    private var latestModelSelectionIDsBySession: [String: String] = [:]
    private var lastSuccessfulModelSelectionIDsBySession: [String: String] = [:]
    private var inFlightModelPatchCountsBySession: [String: Int] = [:]
    private var modelPatchWaitersBySession: [String: [CheckedContinuation<Void, Never>]] = [:]
    private var nextThinkingSelectionRequestID: UInt64 = 0
    private var latestThinkingSelectionRequestIDsBySession: [String: UInt64] = [:]
    private var latestThinkingLevelsBySession: [String: String] = [:]
    private var cachedStatesBySession: [String: CachedSessionState] = [:]
    private var draftInputsBySession: [String: String] = [:]
    private var draftAttachmentsBySession: [String: [AlisioPendingAttachment]] = [:]
    private var nextBootstrapRequestID: UInt64 = 0
    private var activeBootstrapRequestID: UInt64 = 0
    private var nextSessionsRequestID: UInt64 = 0
    private var activeSessionsRequestID: UInt64 = 0
    public private(set) var isCompacting = false
    private var lastCompactAtsBySession: [String: Date] = [:]
    private var lastManualSessionsQuery: AlisioChatSessionsQuery?
    private var mutatingSessionIdentityKeys = Set<String>()
    private var deletedSessionIdentityKeys = Set<String>()
    private var lastOptimisticMessageTimestampMs: Double = 0
    private let compactCooldown: TimeInterval = 60

    private var pendingToolCallsById: [String: AlisioChatPendingToolCall] = [:] {
        didSet {
            self.pendingToolCalls = self.pendingToolCallsById.values
                .sorted { ($0.startedAt ?? 0) < ($1.startedAt ?? 0) }
        }
    }

    private var lastHealthPollAt: Date?

    public init(
        sessionKey: String,
        transport: any AlisioChatTransport,
        initialThinkingLevel: String? = nil,
        onThinkingLevelChanged: (@MainActor @Sendable (String) -> Void)? = nil,
        onSessionKeyChanged: (@MainActor @Sendable (String) -> Void)? = nil)
    {
        self.sessionKey = sessionKey
        self.transport = transport
        let normalizedThinkingLevel = Self.normalizedThinkingLevel(initialThinkingLevel)
        self.thinkingLevel = normalizedThinkingLevel ?? "off"
        self.prefersExplicitThinkingLevel = normalizedThinkingLevel != nil
        self.onThinkingLevelChanged = onThinkingLevelChanged
        self.onSessionKeyChanged = onSessionKeyChanged

        self.eventTask = Task { [weak self] in
            guard let self else { return }
            let stream = self.transport.events()
            for await evt in stream {
                if Task.isCancelled { return }
                await MainActor.run { [weak self] in
                    self?.handleTransportEvent(evt)
                }
            }
        }
    }

    deinit {
        self.eventTask?.cancel()
        for (_, task) in self.pendingRunTimeoutTasks {
            task.cancel()
        }
    }

    public func load() {
        Task { await self.bootstrap() }
    }

    public func refresh() {
        Task { await self.bootstrap() }
    }

    public func send() {
        Task { await self.performSend() }
    }

    public func abort() {
        Task { await self.performAbort() }
    }

    public func resetSession() {
        Task { await self.performReset() }
    }

    public func resetSession(sessionKey: String) {
        Task { await self.performReset(sessionKey: sessionKey) }
    }

    public func compactSession() {
        Task { await self.performCompact() }
    }

    public func compactSession(sessionKey: String) {
        Task { await self.performCompact(sessionKey: sessionKey) }
    }

    public func deleteSession(sessionKey: String) {
        Task { await self.performDeleteSession(sessionKey: sessionKey) }
    }

    public func refreshSessions(search: String? = nil, limit: Int? = nil) {
        let trimmedSearch = search?.trimmingCharacters(in: .whitespacesAndNewlines)
        let query = AlisioChatSessionsQuery(
            limit: limit,
            search: trimmedSearch?.isEmpty == false ? trimmedSearch : nil,
            includeGlobal: true,
            includeUnknown: false,
            includeDerivedTitles: true,
            includeLastMessage: true)
        self.lastManualSessionsQuery = query
        Task { await self.fetchSessions(query: query) }
    }

    public func switchSession(to sessionKey: String) {
        Task { await self.performSwitchSession(to: sessionKey) }
    }

    public func newChat() {
        Task { await self.performNewChat() }
    }

    public func selectThinkingLevel(_ level: String) {
        self.nextThinkingSelectionRequestID &+= 1
        let requestID = self.nextThinkingSelectionRequestID
        Task { await self.performSelectThinkingLevel(level, requestID: requestID) }
    }

    public func selectModel(_ selectionID: String) {
        Task { await self.performSelectModel(selectionID) }
    }

    public var currentSessionEntry: AlisioChatSessionEntry? {
        self.matchingSession(forKey: self.sessionKey)
    }

    public var currentSessionContextUsage: AlisioChatSessionContextUsage? {
        self.currentSessionEntry.flatMap(AlisioChatSessionContextUsage.init(session:))
    }

    public var activeErrorText: String? {
        let trimmed = self.errorText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    public var connectionPhase: AlisioChatConnectionPhase {
        if !self.hasLoadedHistory && self.isLoading {
            return .bootstrapping
        }
        if self.isLoading {
            return .loading
        }
        if self.isRecoveringConnection || (!self.healthOK && self.hasLoadedHistory) {
            return .reconnecting
        }
        if (self.isSending || self.pendingRunCount > 0),
           !self.hasVisibleNonUserTranscriptContent,
           !self.hasVisibleStreamingAssistantContent,
           self.pendingToolCalls.isEmpty
        {
            return .firstMessage
        }
        return .ready
    }

    public var canResetSession: Bool {
        self.canResetSession(key: self.sessionKey)
    }

    public var canCompactSession: Bool {
        self.canCompactSession(key: self.sessionKey)
    }

    public var canSwitchSessions: Bool {
        !self.isLoading && !self.isSending && self.pendingRuns.isEmpty && !self.isAborting && !self.isCreatingSession
    }

    public var canCreateSession: Bool {
        self.canSwitchSessions && !self.isCompacting
    }

    public var currentSessionTitle: String {
        self.sessionTitle(forKey: self.sessionKey)
    }

    public var currentSessionSummary: String {
        self.sessionSummary(forKey: self.sessionKey)
    }

    public var currentSessionSubtitle: String {
        var parts: [String] = []
        let summary = self.currentSessionSummary.trimmingCharacters(in: .whitespacesAndNewlines)
        if !summary.isEmpty {
            parts.append(summary)
        }
        switch self.connectionPhase {
        case .firstMessage:
            parts.append("First reply is warming up.")
        case .reconnecting:
            parts.append("Reconnecting.")
        case .bootstrapping, .loading, .ready:
            break
        }
        return parts.joined(separator: " · ")
    }

    public func canResetSession(_ session: AlisioChatSessionEntry) -> Bool {
        self.canResetSession(key: session.key)
    }

    public func canCompactSession(_ session: AlisioChatSessionEntry) -> Bool {
        self.canCompactSession(key: session.key)
    }

    public func canDeleteSession(_ session: AlisioChatSessionEntry) -> Bool {
        !self.isMainSession(session) &&
            !self.isMutatingSession(session) &&
            !self.isCreatingSession &&
            !self.isSending &&
            self.pendingRuns.isEmpty &&
            !self.isAborting &&
            !self.hasPendingModelPatches(key: session.key)
    }

    public func isMutatingSession(_ session: AlisioChatSessionEntry) -> Bool {
        self.isMutatingSession(key: session.key)
    }

    public func sessionKeysMatch(_ lhs: String, _ rhs: String) -> Bool {
        AlisioChatSessionIdentity.matches(lhs, rhs, mainSessionKey: self.resolvedMainSessionKey)
    }

    private func canResetSession(key: String) -> Bool {
        !self.isLoading &&
            !self.isSending &&
            self.pendingRuns.isEmpty &&
            !self.isAborting &&
            !self.isCreatingSession &&
            !self.hasPendingModelPatches(key: key) &&
            !self.isMutatingSession(key: key)
    }

    private func canCompactSession(key: String) -> Bool {
        !self.isCompacting &&
            !self.isLoading &&
            !self.isSending &&
            self.pendingRuns.isEmpty &&
            !self.isAborting &&
            !self.isCreatingSession &&
            !self.hasPendingModelPatches(key: key) &&
            !self.isMutatingSession(key: key)
    }

    private func isMutatingSession(key: String) -> Bool {
        let identity = AlisioChatSessionIdentity.identityKey(
            for: key,
            mainSessionKey: self.resolvedMainSessionKey)
        guard !identity.isEmpty else { return false }
        return self.mutatingSessionIdentityKeys.contains(identity)
    }

    private func hasPendingModelPatches(key: String) -> Bool {
        (self.inFlightModelPatchCountsBySession[key] ?? 0) > 0
    }

    public var sessionChoices: [AlisioChatSessionEntry] {
        let sorted = self.sessions.sorted { ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0) }
        let mainSessionKey = self.resolvedMainSessionKey

        var result: [AlisioChatSessionEntry] = []
        var included = Set<String>()

        func identity(for key: String) -> String {
            AlisioChatSessionIdentity.identityKey(for: key, mainSessionKey: mainSessionKey)
        }

        func append(_ entry: AlisioChatSessionEntry) {
            let id = identity(for: entry.key)
            guard !included.contains(id) else { return }
            guard entry.key == self.sessionKey || !Self.isHiddenInternalSession(entry.key) else { return }
            result.append(entry)
            included.insert(id)
        }

        if let main = sorted.first(where: { self.sessionKeysMatch($0.key, mainSessionKey) }) {
            append(main)
        } else {
            append(self.placeholderSession(key: mainSessionKey))
        }

        if let current = sorted.first(where: { self.sessionKeysMatch($0.key, self.sessionKey) }) {
            append(current)
        } else {
            append(self.placeholderSession(key: self.sessionKey))
        }

        for entry in sorted {
            append(entry)
        }

        return result
    }

    private var resolvedMainSessionKey: String {
        AlisioChatSessionIdentity.resolvedMainSessionKey(from: self.sessionDefaults)
    }

    private static func isHiddenInternalSession(_ key: String) -> Bool {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return trimmed == "onboarding" || trimmed.hasSuffix(":onboarding")
    }

    private func matchingSession(forKey sessionKey: String) -> AlisioChatSessionEntry? {
        let matching = self.sessions.filter { self.sessionKeysMatch($0.key, sessionKey) }
        guard !matching.isEmpty else { return nil }

        let normalizedTarget = AlisioChatSessionIdentity.normalizedKey(sessionKey)
        if self.sessionKeysMatch(sessionKey, self.resolvedMainSessionKey) {
            return matching.max(by: { self.mainSessionMatchScore($0) < self.mainSessionMatchScore($1) })
        }
        if let exact = matching.first(where: {
            AlisioChatSessionIdentity.normalizedKey($0.key) == normalizedTarget
        }) {
            return exact
        }
        return matching.first
    }

    private func mainSessionMatchScore(_ session: AlisioChatSessionEntry) -> Int {
        let normalizedKey = AlisioChatSessionIdentity.normalizedKey(session.key)
        var score = 0
        if normalizedKey != "main" && normalizedKey != "agent:main:main" {
            score += 100
        }
        if let displayName = session.displayName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !displayName.isEmpty
        {
            score += 10
        }
        if let derivedTitle = session.derivedTitle?.trimmingCharacters(in: .whitespacesAndNewlines),
           !derivedTitle.isEmpty
        {
            score += 8
        }
        if let label = session.label?.trimmingCharacters(in: .whitespacesAndNewlines),
           !label.isEmpty
        {
            score += 6
        }
        return score
    }

    public var showsModelPicker: Bool {
        !self.modelChoices.isEmpty
    }

    public var defaultModelLabel: String {
        guard let defaultModelID = self.normalizedModelSelectionID(self.sessionDefaults?.model) else {
            return "Default"
        }
        return "Default: \(self.modelLabel(for: defaultModelID))"
    }

    public var activeModelLabel: String {
        let selectedModelID = self.normalizedSelectionID(self.modelSelectionID)
        if selectedModelID != Self.defaultModelSelectionID {
            return self.modelLabel(for: selectedModelID)
        }
        guard let defaultModelID = self.normalizedModelSelectionID(self.sessionDefaults?.model) else {
            return "Default"
        }
        return self.modelLabel(for: defaultModelID)
    }

    public func sessionTitle(forKey sessionKey: String) -> String {
        if let session = self.matchingSession(forKey: sessionKey) {
            return self.sessionTitle(for: session)
        }
        if self.sessionKeysMatch(sessionKey, self.resolvedMainSessionKey) {
            return "Main chat"
        }
        return "New chat"
    }

    public func sessionTitle(for session: AlisioChatSessionEntry) -> String {
        AlisioChatSessionPresentation.title(
            for: session,
            currentSessionKey: self.sessionKey,
            mainSessionKey: self.resolvedMainSessionKey)
    }

    public func sessionSummary(forKey sessionKey: String) -> String {
        if let session = self.matchingSession(forKey: sessionKey) {
            return self.sessionSummary(for: session)
        }
        if self.sessionKeysMatch(sessionKey, self.resolvedMainSessionKey) {
            return "Your ongoing workspace conversation."
        }
        return "Start a fresh chat without losing your place."
    }

    public func sessionPreviewText(for session: AlisioChatSessionEntry) -> String? {
        AlisioChatSessionPresentation.previewText(for: session)
    }

    public func sessionSummary(for session: AlisioChatSessionEntry) -> String {
        AlisioChatSessionPresentation.summary(
            for: session,
            currentSessionKey: self.sessionKey,
            mainSessionKey: self.resolvedMainSessionKey)
    }

    public func sessionSearchText(for session: AlisioChatSessionEntry) -> String {
        AlisioChatSessionPresentation.searchText(
            for: session,
            currentSessionKey: self.sessionKey,
            mainSessionKey: self.resolvedMainSessionKey)
    }

    public func isCurrentSession(_ session: AlisioChatSessionEntry) -> Bool {
        AlisioChatSessionPresentation.isCurrent(
            session,
            currentSessionKey: self.sessionKey,
            mainSessionKey: self.resolvedMainSessionKey)
    }

    public func isMainSessionKey(_ sessionKey: String) -> Bool {
        self.sessionKeysMatch(sessionKey, self.resolvedMainSessionKey)
    }

    public func isMainSession(_ session: AlisioChatSessionEntry) -> Bool {
        AlisioChatSessionPresentation.isMain(session, mainSessionKey: self.resolvedMainSessionKey)
    }

    public var activeThinkingLevelLabel: String {
        self.thinkingLevel.capitalized
    }

    public func dismissError() {
        self.errorText = nil
    }

    public func addAttachments(urls: [URL]) {
        Task { await self.loadAttachments(urls: urls) }
    }

    public func addAttachment(data: Data, fileName: String, mimeType: String) {
        Task { await self.addAttachment(url: nil, data: data, fileName: fileName, mimeType: mimeType) }
    }

    public func removeAttachment(_ id: AlisioPendingAttachment.ID) {
        self.attachments.removeAll { $0.id == id }
    }

    public var canSend: Bool {
        let trimmed = self.input.trimmingCharacters(in: .whitespacesAndNewlines)
        return self.healthOK &&
            !self.isLoading &&
            !self.isSending &&
            self.pendingRunCount == 0 &&
            (!trimmed.isEmpty || !self.attachments.isEmpty)
    }

    // MARK: - Internals

    private var defaultSessionsQuery: AlisioChatSessionsQuery {
        AlisioChatSessionsQuery(
            limit: 200,
            includeGlobal: true,
            includeUnknown: false,
            includeDerivedTitles: true,
            includeLastMessage: true)
    }

    private func bootstrap(sessionKey targetSessionKey: String? = nil) async {
        let targetSessionKey = targetSessionKey ?? self.sessionKey
        let previousMessages = self.cachedStatesBySession[targetSessionKey]?.messages ?? self.messages
        self.nextBootstrapRequestID &+= 1
        let requestID = self.nextBootstrapRequestID
        self.activeBootstrapRequestID = requestID
        let sessionsRequestID = self.beginSessionsRequest()
        self.isLoading = true
        self.errorText = nil
        self.clearPendingRuns(reason: nil)
        self.clearTransientReplyState(for: nil)
        self.healthOK = false
        defer {
            if self.shouldApplyBootstrapResponse(requestID: requestID, sessionKey: targetSessionKey) {
                self.isLoading = false
            }
        }
        do {
            async let sessionsResult = try? self.transport.listSessions(query: self.defaultSessionsQuery)
            async let modelsResult = try? self.transport.listModels()
            async let healthResult = try? self.transport.requestHealth(timeoutMs: 5000)

            let payload = try await self.transport.requestHistory(sessionKey: targetSessionKey)
            guard self.shouldApplyBootstrapResponse(requestID: requestID, sessionKey: targetSessionKey) else {
                return
            }
            self.messages = Self.reconcileMessageIDs(
                previous: previousMessages,
                incoming: Self.decodeMessages(payload.messages ?? []))
            self.sessionId = payload.sessionId
            self.hasLoadedHistory = true
            self.lastBootstrapAt = Date()
            self.lastHistoryRefreshAt = self.lastBootstrapAt
            if !self.prefersExplicitThinkingLevel,
               let level = Self.normalizedThinkingLevel(payload.thinkingLevel)
            {
                self.thinkingLevel = level
            }
            self.cacheLoadedState(for: targetSessionKey)

            if let sessions = await sessionsResult,
               self.shouldApplySessionsRequestResponse(requestID: sessionsRequestID),
               self.shouldApplyBootstrapResponse(requestID: requestID, sessionKey: targetSessionKey)
            {
                self.applySessionsResponse(sessions)
            }
            if let models = await modelsResult,
               self.shouldApplyBootstrapResponse(requestID: requestID, sessionKey: targetSessionKey)
            {
                self.modelChoices = models
                self.syncSelectedModel()
            }
            if let ok = await healthResult,
               self.shouldApplyBootstrapResponse(requestID: requestID, sessionKey: targetSessionKey)
            {
                self.healthOK = ok
            } else if self.shouldApplyBootstrapResponse(requestID: requestID, sessionKey: targetSessionKey) {
                self.healthOK = false
            }
            self.errorText = nil
            self.isRecoveringConnection = false
        } catch {
            guard self.shouldApplyBootstrapResponse(requestID: requestID, sessionKey: targetSessionKey) else {
                return
            }
            self.errorText = self.presentableErrorMessage(
                for: error,
                fallback: "This chat could not be loaded.")
            if self.hasLoadedHistory {
                self.markConnectionRecovering()
            }
            chatUILogger.error("bootstrap failed \(error.localizedDescription, privacy: .public)")
        }
    }

    private static func decodeMessages(_ raw: [AnyCodable]) -> [AlisioChatMessage] {
        let decoded = raw.compactMap { item in
            (try? ChatPayloadDecoding.decode(item, as: AlisioChatMessage.self))
                .map { Self.stripInboundMetadata(from: $0) }
        }
        return Self.dedupeMessages(decoded)
    }

    private static func stripInboundMetadata(from message: AlisioChatMessage) -> AlisioChatMessage {
        guard message.role.lowercased() == "user" else {
            return message
        }

        let sanitizedContent = message.content.map { content -> AlisioChatMessageContent in
            guard let text = content.text else { return content }
            let cleaned = ChatMarkdownPreprocessor.preprocess(markdown: text).cleaned
            return AlisioChatMessageContent(
                type: content.type,
                text: cleaned,
                thinking: content.thinking,
                thinkingSignature: content.thinkingSignature,
                mimeType: content.mimeType,
                fileName: content.fileName,
                content: content.content,
                id: content.id,
                name: content.name,
                arguments: content.arguments)
        }

        return AlisioChatMessage(
            id: message.id,
            role: message.role,
            content: sanitizedContent,
            timestamp: message.timestamp,
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            usage: message.usage,
            stopReason: message.stopReason)
    }

    private static func messageContentFingerprint(for message: AlisioChatMessage) -> String {
        message.content.map { item in
            let type = (item.type ?? "text").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let text = (item.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let id = (item.id ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (item.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let fileName = (item.fileName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return [type, text, id, name, fileName].joined(separator: "\\u{001F}")
        }.joined(separator: "\\u{001E}")
    }

    private static func messageIdentityKey(for message: AlisioChatMessage) -> String? {
        let role = message.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !role.isEmpty else { return nil }

        let timestamp: String = {
            guard let value = message.timestamp, value.isFinite else { return "" }
            return String(format: "%.3f", value)
        }()

        let contentFingerprint = Self.messageContentFingerprint(for: message)
        let toolCallId = (message.toolCallId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let toolName = (message.toolName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if timestamp.isEmpty, contentFingerprint.isEmpty, toolCallId.isEmpty, toolName.isEmpty {
            return nil
        }
        return [role, timestamp, toolCallId, toolName, contentFingerprint].joined(separator: "|")
    }

    private static func userRefreshIdentityKey(for message: AlisioChatMessage) -> String? {
        let role = message.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard role == "user" else { return nil }

        let contentFingerprint = Self.messageContentFingerprint(for: message)
        let toolCallId = (message.toolCallId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let toolName = (message.toolName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if contentFingerprint.isEmpty, toolCallId.isEmpty, toolName.isEmpty {
            return nil
        }
        return [role, toolCallId, toolName, contentFingerprint].joined(separator: "|")
    }

    private static func reconcileMessageIDs(
        previous: [AlisioChatMessage],
        incoming: [AlisioChatMessage]) -> [AlisioChatMessage]
    {
        guard !previous.isEmpty, !incoming.isEmpty else { return incoming }

        var idsByKey: [String: [UUID]] = [:]
        for message in previous {
            guard let key = Self.messageIdentityKey(for: message) else { continue }
            idsByKey[key, default: []].append(message.id)
        }

        return incoming.map { message in
            guard let key = Self.messageIdentityKey(for: message),
                  var ids = idsByKey[key],
                  let reusedId = ids.first
            else {
                return message
            }
            ids.removeFirst()
            if ids.isEmpty {
                idsByKey.removeValue(forKey: key)
            } else {
                idsByKey[key] = ids
            }
            guard reusedId != message.id else { return message }
            return AlisioChatMessage(
                id: reusedId,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                toolCallId: message.toolCallId,
                toolName: message.toolName,
                usage: message.usage,
                stopReason: message.stopReason)
        }
    }

    private static func reconcileRunRefreshMessages(
        previous: [AlisioChatMessage],
        incoming: [AlisioChatMessage]) -> [AlisioChatMessage]
    {
        guard !previous.isEmpty else { return incoming }
        guard !incoming.isEmpty else { return previous }

        func countKeys(_ keys: [String]) -> [String: Int] {
            keys.reduce(into: [:]) { counts, key in
                counts[key, default: 0] += 1
            }
        }

        var reconciled = Self.reconcileMessageIDs(previous: previous, incoming: incoming)
        let incomingIdentityKeys = Set(reconciled.compactMap(Self.messageIdentityKey(for:)))
        var remainingIncomingUserRefreshCounts = countKeys(
            reconciled.compactMap(Self.userRefreshIdentityKey(for:)))

        var lastMatchedPreviousIndex: Int?
        for (index, message) in previous.enumerated() {
            if let key = Self.messageIdentityKey(for: message),
               incomingIdentityKeys.contains(key)
            {
                if let userKey = Self.userRefreshIdentityKey(for: message),
                   let remaining = remainingIncomingUserRefreshCounts[userKey],
                   remaining > 0
                {
                    remainingIncomingUserRefreshCounts[userKey] = remaining - 1
                }
                lastMatchedPreviousIndex = index
                continue
            }
            if let userKey = Self.userRefreshIdentityKey(for: message),
               let remaining = remainingIncomingUserRefreshCounts[userKey],
               remaining > 0
            {
                remainingIncomingUserRefreshCounts[userKey] = remaining - 1
                lastMatchedPreviousIndex = index
            }
        }

        let trailingUserMessages = (lastMatchedPreviousIndex != nil
            ? previous.suffix(from: previous.index(after: lastMatchedPreviousIndex!))
            : ArraySlice(previous))
            .filter { message in
                guard message.role.lowercased() == "user" else { return false }
                guard let key = Self.userRefreshIdentityKey(for: message) else { return false }
                let remaining = remainingIncomingUserRefreshCounts[key] ?? 0
                if remaining > 0 {
                    remainingIncomingUserRefreshCounts[key] = remaining - 1
                    return false
                }
                return true
            }

        guard !trailingUserMessages.isEmpty else {
            return reconciled
        }

        for message in trailingUserMessages {
            guard let messageTimestamp = message.timestamp else {
                reconciled.append(message)
                continue
            }

            let insertIndex = reconciled.firstIndex { existing in
                guard let existingTimestamp = existing.timestamp else { return false }
                return existingTimestamp > messageTimestamp
            } ?? reconciled.endIndex
            reconciled.insert(message, at: insertIndex)
        }

        return Self.dedupeMessages(reconciled)
    }

    private static func dedupeMessages(_ messages: [AlisioChatMessage]) -> [AlisioChatMessage] {
        var result: [AlisioChatMessage] = []
        result.reserveCapacity(messages.count)
        var seen = Set<String>()

        for message in messages {
            guard let key = Self.dedupeKey(for: message) else {
                result.append(message)
                continue
            }
            if seen.contains(key) { continue }
            seen.insert(key)
            result.append(message)
        }

        return result
    }

    private static func dedupeKey(for message: AlisioChatMessage) -> String? {
        guard let timestamp = message.timestamp else { return nil }
        let text = message.content.compactMap(\.text).joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return "\(message.role)|\(timestamp)|\(text)"
    }

    private func performSend() async {
        guard !self.isSending else { return }
        let trimmed = self.input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !self.attachments.isEmpty else { return }

        let sessionKey = self.sessionKey

        guard self.healthOK else {
            self.errorText = "The chat is still connecting. Try again in a moment."
            return
        }

        self.isSending = true
        self.errorText = nil
        let runId = UUID().uuidString
        let messageText = trimmed.isEmpty && !self.attachments.isEmpty ? "See attached." : trimmed
        let thinkingLevel = self.thinkingLevel
        self.clearTransientReplyState(for: nil)

        // Optimistically append user message to UI.
        var userContent: [AlisioChatMessageContent] = [
            AlisioChatMessageContent(
                type: "text",
                text: messageText,
                thinking: nil,
                thinkingSignature: nil,
                mimeType: nil,
                fileName: nil,
                content: nil,
                id: nil,
                name: nil,
                arguments: nil),
        ]
        let encodedAttachments = self.attachments.map { att -> AlisioChatAttachmentPayload in
            AlisioChatAttachmentPayload(
                type: att.type,
                mimeType: att.mimeType,
                fileName: att.fileName,
                content: att.data.base64EncodedString())
        }
        for att in encodedAttachments {
            userContent.append(
                AlisioChatMessageContent(
                    type: att.type,
                    text: nil,
                    thinking: nil,
                    thinkingSignature: nil,
                    mimeType: att.mimeType,
                    fileName: att.fileName,
                    content: AnyCodable(att.content),
                    id: nil,
                    name: nil,
                    arguments: nil))
        }
        self.messages.append(
            AlisioChatMessage(
                id: UUID(),
                role: "user",
                content: userContent,
                timestamp: self.nextOptimisticMessageTimestampMs()))

        // Clear input immediately for responsive UX (before network await)
        self.input = ""
        self.attachments = []

        do {
            await self.waitForPendingModelPatches(in: sessionKey)
            let sendTask = Task {
                try await self.transport.sendMessage(
                    sessionKey: sessionKey,
                    message: messageText,
                    thinking: thinkingLevel,
                    idempotencyKey: runId,
                    attachments: encodedAttachments)
            }
            // Give the transport a chance to register the outbound run before observers
            // react to the optimistic pending state.
            await Task.yield()
            self.dispatchingRunIDs.insert(runId)
            let response = try await sendTask.value
            let runWasClearedBeforeAccept = !self.dispatchingRunIDs.contains(runId) && !self.pendingRuns.contains(runId)
            self.dispatchingRunIDs.remove(runId)
            guard !runWasClearedBeforeAccept else { return }
            self.pendingRuns.insert(runId)
            self.armPendingRunTimeout(runId: runId)
            if response.runId != runId {
                self.moveAbortRequest(from: runId, to: response.runId)
                self.clearPendingRun(runId)
                self.pendingRuns.insert(response.runId)
                self.armPendingRunTimeout(runId: response.runId)
            }
            await self.issueDeferredAbortIfNeeded(for: response.runId)
        } catch {
            self.dispatchingRunIDs.remove(runId)
            self.clearPendingRun(runId)
            self.abortRequestedRunIDs.remove(runId)
            self.errorText = self.presentableErrorMessage(
                for: error,
                fallback: "Your message could not be sent. Try again.")
            chatUILogger.error("chat.send failed \(error.localizedDescription, privacy: .public)")
        }

        self.isSending = false
    }

    private func performAbort() async {
        let activeRunIDs = Array(self.pendingRuns.union(self.dispatchingRunIDs)).sorted()
        guard !activeRunIDs.isEmpty else {
            self.errorText = "There is no active reply to stop."
            return
        }
        let requestedRunIDs = activeRunIDs.filter { !self.abortRequestedRunIDs.contains($0) }
        guard !requestedRunIDs.isEmpty else { return }

        self.errorText = nil
        for runId in requestedRunIDs {
            self.abortRequestedRunIDs.insert(runId)
        }

        let abortableRunIDs = requestedRunIDs.filter { self.pendingRuns.contains($0) }
        guard !abortableRunIDs.isEmpty else { return }

        var stoppedAnyRun = false
        for runId in abortableRunIDs {
            if await self.requestAbort(for: runId, reportFailure: true) {
                stoppedAnyRun = true
            }
        }
        if !stoppedAnyRun, abortableRunIDs.count == requestedRunIDs.count {
            self.errorText = "The reply could not be stopped. Try again."
        }
    }

    private func performNewChat() async {
        guard self.canCreateSession else {
            self.errorText = self.pendingRuns.isEmpty
                ? "Wait for the current work to finish before starting a new chat."
                : "Stop the current reply before starting a new chat."
            return
        }

        self.cacheCurrentSessionState()
        self.isCreatingSession = true
        self.errorText = nil
        self.sessionActionErrorText = nil
        defer { self.isCreatingSession = false }

        let request = AlisioChatSessionCreateRequest(
            parentSessionKey: self.parentSessionKeyForNewChat,
            agentId: self.agentIDForNewChat,
            model: self.modelRef(forSelectionID: self.modelSelectionID),
            initialMessage: nil)

        do {
            let created = try await self.transport.createSession(request: request)
            let newKey = created.key.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !newKey.isEmpty else {
                self.errorText = "A new chat could not be created."
                return
            }
            if let entry = created.entry {
                self.upsertSessionEntry(entry)
            } else {
                self.upsertSessionEntry(self.placeholderSession(key: newKey))
            }
            self.cachedStatesBySession[newKey] = CachedSessionState(
                messages: [],
                sessionId: created.sessionId,
                hasLoadedHistory: true,
                thinkingLevel: self.thinkingLevel,
                lastBootstrapAt: nil,
                lastHistoryRefreshAt: nil)
            self.draftInputsBySession[newKey] = ""
            self.draftAttachmentsBySession[newKey] = []
            await self.activateSession(newKey)
        } catch {
            self.errorText = self.presentableErrorMessage(
                for: error,
                fallback: "A new chat could not be created.")
        }
    }

    private func fetchSessions(query: AlisioChatSessionsQuery) async {
        let requestID = self.beginSessionsRequest()
        self.isRefreshingSessions = true
        self.sessionListErrorText = nil
        self.sessionActionErrorText = nil
        defer {
            if self.shouldApplySessionsRequestResponse(requestID: requestID) {
                self.isRefreshingSessions = false
            }
        }
        do {
            let res = try await self.transport.listSessions(query: query)
            guard self.shouldApplySessionsRequestResponse(requestID: requestID) else { return }
            self.applySessionsResponse(res)
        } catch {
            guard self.shouldApplySessionsRequestResponse(requestID: requestID) else { return }
            self.sessionListErrorText = self.presentableErrorMessage(
                for: error,
                fallback: "Chats are unavailable right now.")
        }
    }

    private func performSwitchSession(to sessionKey: String) async {
        let next = sessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.isEmpty else { return }
        guard !self.sessionKeysMatch(next, self.sessionKey) else { return }
        guard self.canSwitchSessions else {
            self.errorText = self.pendingRuns.isEmpty
                ? "Wait for the current work to finish before switching chats."
                : "Stop the current reply before switching chats."
            return
        }
        await self.activateSession(next)
    }

    private func activateSession(_ nextSessionKey: String) async {
        let next = nextSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.isEmpty else { return }
        let previous = self.sessionKey
        if previous != next {
            self.cacheCurrentSessionState()
        }
        self.sessionKey = next
        self.onSessionKeyChanged?(next)
        self.errorText = nil
        self.sessionActionErrorText = nil
        self.streamingAssistantText = nil
        self.pendingToolCallsById = [:]
        self.clearPendingRuns(reason: nil)
        self.restoreCachedState(for: next)
        self.syncSelectedModel()
        await self.bootstrap(sessionKey: next)
    }

    private func cacheCurrentSessionState() {
        self.cacheDraft(for: self.sessionKey)
        self.cacheLoadedState(for: self.sessionKey)
    }

    private func cacheDraft(for sessionKey: String) {
        self.draftInputsBySession[sessionKey] = self.input
        self.draftAttachmentsBySession[sessionKey] = self.attachments
    }

    private func restoreCachedState(for sessionKey: String) {
        self.input = self.draftInputsBySession[sessionKey] ?? ""
        self.attachments = self.draftAttachmentsBySession[sessionKey] ?? []

        guard let cached = self.cachedStatesBySession[sessionKey] else {
            self.messages = []
            self.sessionId = nil
            self.hasLoadedHistory = false
            self.lastBootstrapAt = nil
            self.lastHistoryRefreshAt = nil
            if !self.prefersExplicitThinkingLevel {
                self.thinkingLevel = self.lastKnownThinkingLevel(for: sessionKey) ?? "off"
            }
            return
        }

        self.messages = cached.messages
        self.sessionId = cached.sessionId
        self.hasLoadedHistory = cached.hasLoadedHistory
        self.lastBootstrapAt = cached.lastBootstrapAt
        self.lastHistoryRefreshAt = cached.lastHistoryRefreshAt
        if !self.prefersExplicitThinkingLevel {
            self.thinkingLevel = cached.thinkingLevel
        }
    }

    private func cacheLoadedState(for sessionKey: String) {
        self.cachedStatesBySession[sessionKey] = CachedSessionState(
            messages: self.messages,
            sessionId: self.sessionId,
            hasLoadedHistory: self.hasLoadedHistory,
            thinkingLevel: self.thinkingLevel,
            lastBootstrapAt: self.lastBootstrapAt,
            lastHistoryRefreshAt: self.lastHistoryRefreshAt)
    }

    private func clearCachedSessionState(for sessionKey: String) {
        self.cachedStatesBySession.removeValue(forKey: sessionKey)
        if self.sessionKeysMatch(sessionKey, self.sessionKey) {
            self.messages = []
            self.sessionId = nil
            self.hasLoadedHistory = false
            self.lastBootstrapAt = nil
            self.lastHistoryRefreshAt = nil
        }
    }

    private func removeSessionState(for sessionKey: String) {
        self.clearCachedSessionState(for: sessionKey)
        self.draftInputsBySession.removeValue(forKey: sessionKey)
        self.draftAttachmentsBySession.removeValue(forKey: sessionKey)
        self.lastCompactAtsBySession.removeValue(forKey: self.sessionMutationIdentity(for: sessionKey))
        self.latestThinkingLevelsBySession.removeValue(forKey: sessionKey)
        self.latestThinkingSelectionRequestIDsBySession.removeValue(forKey: sessionKey)
        self.latestModelSelectionIDsBySession.removeValue(forKey: sessionKey)
        self.latestModelSelectionRequestIDsBySession.removeValue(forKey: sessionKey)
        self.lastSuccessfulModelSelectionIDsBySession.removeValue(forKey: sessionKey)
        self.inFlightModelPatchCountsBySession.removeValue(forKey: sessionKey)
        let waiters = self.modelPatchWaitersBySession.removeValue(forKey: sessionKey) ?? []
        for waiter in waiters {
            waiter.resume()
        }
        self.sessions.removeAll { self.sessionKeysMatch($0.key, sessionKey) }
    }

    private func refreshSessionsPreservingQuery() async {
        let query = self.lastManualSessionsQuery ?? self.defaultSessionsQuery
        await self.fetchSessions(query: query)
    }

    private func shouldApplyBootstrapResponse(requestID: UInt64, sessionKey: String) -> Bool {
        requestID == self.activeBootstrapRequestID &&
            self.sessionKeysMatch(sessionKey, self.sessionKey)
    }

    private func beginSessionsRequest() -> UInt64 {
        self.nextSessionsRequestID &+= 1
        self.activeSessionsRequestID = self.nextSessionsRequestID
        return self.activeSessionsRequestID
    }

    private func shouldApplySessionsRequestResponse(requestID: UInt64) -> Bool {
        requestID == self.activeSessionsRequestID
    }

    private func applySessionsResponse(_ response: AlisioChatSessionsListResponse) {
        let previousDefaults = self.sessionDefaults
        var merged: [AlisioChatSessionEntry] = []
        let effectiveDefaults = response.defaults != nil ? response.defaults : previousDefaults
        self.sessionDefaults = effectiveDefaults
        let mainSessionKey = AlisioChatSessionIdentity.resolvedMainSessionKey(from: effectiveDefaults)

        for entry in response.sessions {
            let identity = AlisioChatSessionIdentity.identityKey(for: entry.key, mainSessionKey: mainSessionKey)
            guard !self.deletedSessionIdentityKeys.contains(identity) else { continue }
            let existing = self.sessions.first(where: {
                AlisioChatSessionIdentity.matches($0.key, entry.key, mainSessionKey: mainSessionKey)
            })
            merged.append(self.mergedSessionEntry(existing: existing, incoming: entry))
        }

        for preservedKey in [mainSessionKey, self.sessionKey] {
            guard !preservedKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            let identity = AlisioChatSessionIdentity.identityKey(for: preservedKey, mainSessionKey: mainSessionKey)
            guard !self.deletedSessionIdentityKeys.contains(identity) else { continue }
            guard !merged.contains(where: {
                AlisioChatSessionIdentity.matches($0.key, preservedKey, mainSessionKey: mainSessionKey)
            }) else { continue }
            if let existing = self.sessions.first(where: {
                AlisioChatSessionIdentity.matches($0.key, preservedKey, mainSessionKey: mainSessionKey)
            }) {
                merged.append(existing)
            } else if self.sessionKeysMatch(preservedKey, self.sessionKey) {
                merged.append(self.placeholderSession(key: preservedKey))
            }
        }

        self.sessions = merged
        self.syncSelectedModel()
    }

    private func mergedSessionEntry(
        existing: AlisioChatSessionEntry?,
        incoming: AlisioChatSessionEntry) -> AlisioChatSessionEntry
    {
        guard let existing else { return incoming }
        let resolvedModel: String? = {
            if incoming.model != nil || incoming.modelProvider != nil {
                return incoming.model
            }
            return existing.model
        }()
        let resolvedModelProvider: String? = {
            if incoming.model != nil || incoming.modelProvider != nil {
                return incoming.modelProvider
            }
            return existing.modelProvider
        }()
        return AlisioChatSessionEntry(
            key: incoming.key,
            kind: incoming.kind ?? existing.kind,
            label: incoming.label ?? existing.label,
            displayName: incoming.displayName ?? existing.displayName,
            derivedTitle: incoming.derivedTitle ?? existing.derivedTitle,
            lastMessagePreview: incoming.lastMessagePreview ?? existing.lastMessagePreview,
            surface: incoming.surface ?? existing.surface,
            subject: incoming.subject ?? existing.subject,
            room: incoming.room ?? existing.room,
            space: incoming.space ?? existing.space,
            updatedAt: incoming.updatedAt ?? existing.updatedAt,
            sessionId: incoming.sessionId ?? existing.sessionId,
            systemSent: incoming.systemSent ?? existing.systemSent,
            abortedLastRun: incoming.abortedLastRun ?? existing.abortedLastRun,
            thinkingLevel: incoming.thinkingLevel ?? existing.thinkingLevel,
            verboseLevel: incoming.verboseLevel ?? existing.verboseLevel,
            inputTokens: incoming.inputTokens ?? existing.inputTokens,
            outputTokens: incoming.outputTokens ?? existing.outputTokens,
            totalTokens: incoming.totalTokens ?? existing.totalTokens,
            modelProvider: resolvedModelProvider,
            model: resolvedModel,
            contextTokens: incoming.contextTokens ?? existing.contextTokens)
    }

    private func upsertSessionEntry(_ entry: AlisioChatSessionEntry) {
        if let index = self.sessions.firstIndex(where: {
            self.sessionKeysMatch($0.key, entry.key)
        }) {
            self.sessions[index] = entry
            return
        }
        self.sessions.append(entry)
    }

    private func sessionMutationIdentity(for sessionKey: String) -> String {
        AlisioChatSessionIdentity.identityKey(for: sessionKey, mainSessionKey: self.resolvedMainSessionKey)
    }

    private func beginSessionMutation(for sessionKey: String) -> String? {
        let identity = self.sessionMutationIdentity(for: sessionKey)
        guard !identity.isEmpty else { return nil }
        guard !self.mutatingSessionIdentityKeys.contains(identity) else { return nil }
        self.mutatingSessionIdentityKeys.insert(identity)
        return identity
    }

    private func endSessionMutation(identity: String) {
        self.mutatingSessionIdentityKeys.remove(identity)
    }

    private func lastKnownThinkingLevel(for sessionKey: String) -> String? {
        if let cached = self.cachedStatesBySession[sessionKey]?.thinkingLevel {
            return cached
        }
        if let latest = self.latestThinkingLevelsBySession[sessionKey] {
            return latest
        }
        if let level = self.sessions.first(where: {
            self.sessionKeysMatch($0.key, sessionKey)
        })?.thinkingLevel {
            return Self.normalizedThinkingLevel(level)
        }
        return nil
    }

    private var parentSessionKeyForNewChat: String? {
        let trimmed = self.sessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private var agentIDForNewChat: String? {
        let candidates = [
            self.currentSessionEntry?.key,
            self.sessionKey,
            self.resolvedMainSessionKey,
        ]
        for candidate in candidates {
            if let agentID = Self.agentID(fromSessionKey: candidate) {
                return agentID
            }
        }
        return nil
    }

    private static func agentID(fromSessionKey raw: String?) -> String? {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard trimmed.hasPrefix("agent:") else { return nil }
        let parts = trimmed.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count >= 3 else { return nil }
        let agentID = String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines)
        return agentID.isEmpty ? nil : agentID
    }

    private func performReset() async {
        await self.performReset(sessionKey: self.sessionKey)
    }

    private func performReset(sessionKey rawSessionKey: String) async {
        let sessionKey = rawSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sessionKey.isEmpty else { return }
        guard self.canResetSession(key: sessionKey) else {
            let message = "Wait for the current work to finish before resetting a chat."
            self.errorText = self.sessionKeysMatch(sessionKey, self.sessionKey) ? message : self.errorText
            self.sessionActionErrorText = message
            return
        }

        guard let mutationIdentity = self.beginSessionMutation(for: sessionKey) else { return }
        let isCurrentSession = self.sessionKeysMatch(sessionKey, self.sessionKey)
        if isCurrentSession {
            self.isLoading = true
        }
        self.errorText = nil
        self.sessionActionErrorText = nil
        defer {
            if isCurrentSession {
                self.isLoading = false
            }
            self.endSessionMutation(identity: mutationIdentity)
        }

        do {
            try await self.transport.resetSession(sessionKey: sessionKey)
        } catch {
            let message = self.presentableErrorMessage(
                for: error,
                fallback: "This chat could not be reset.")
            if isCurrentSession {
                self.errorText = message
            }
            self.sessionActionErrorText = message
            chatUILogger.error("session reset failed \(error.localizedDescription, privacy: .public)")
            return
        }

        self.clearCachedSessionState(for: sessionKey)
        if isCurrentSession {
            await self.bootstrap(sessionKey: sessionKey)
        } else {
            await self.refreshSessionsPreservingQuery()
        }
    }

    private func performCompact() async {
        await self.performCompact(sessionKey: self.sessionKey)
    }

    private func performCompact(sessionKey rawSessionKey: String) async {
        let sessionKey = rawSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sessionKey.isEmpty else { return }
        guard !self.isCompacting else { return }
        guard !self.isMutatingSession(key: sessionKey) else { return }
        guard self.canCompactSession(key: sessionKey) else {
            let message = "Wait for the current response before compacting the session."
            self.errorText = self.sessionKeysMatch(sessionKey, self.sessionKey) ? message : self.errorText
            self.sessionActionErrorText = message
            return
        }

        let identity = self.sessionMutationIdentity(for: sessionKey)
        if let lastCompactAt = self.lastCompactAtsBySession[identity],
           Date().timeIntervalSince(lastCompactAt) < self.compactCooldown
        {
            let message = "Please wait before compacting this session again."
            self.errorText = self.sessionKeysMatch(sessionKey, self.sessionKey) ? message : self.errorText
            self.sessionActionErrorText = message
            return
        }

        guard let mutationIdentity = self.beginSessionMutation(for: sessionKey) else { return }
        let isCurrentSession = self.sessionKeysMatch(sessionKey, self.sessionKey)
        self.isCompacting = true
        if isCurrentSession {
            self.isLoading = true
        }
        self.errorText = nil
        self.sessionActionErrorText = nil
        defer {
            if isCurrentSession {
                self.isLoading = false
            }
            self.isCompacting = false
            self.endSessionMutation(identity: mutationIdentity)
        }

        do {
            try await self.transport.compactSession(sessionKey: sessionKey)
        } catch {
            let message = "Unable to compact the session. Please try again."
            if isCurrentSession {
                self.errorText = message
            }
            self.sessionActionErrorText = message
            let nsError = error as NSError
            chatUILogger.error(
                "session compact failed domain=\(nsError.domain, privacy: .public) code=\(nsError.code, privacy: .public) details=\(String(describing: error), privacy: .private)"
            )
            return
        }

        self.lastCompactAtsBySession[identity] = Date()
        if isCurrentSession {
            await self.bootstrap(sessionKey: sessionKey)
        } else {
            await self.refreshSessionsPreservingQuery()
        }
    }

    private func performDeleteSession(sessionKey rawSessionKey: String) async {
        let sessionKey = rawSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sessionKey.isEmpty else { return }
        let session = self.matchingSession(forKey: sessionKey) ?? self.placeholderSession(key: sessionKey)
        guard self.canDeleteSession(session) else {
            self.sessionActionErrorText = self.isMainSession(session)
                ? "Main chat can't be deleted."
                : "Wait for the current work to finish before deleting a chat."
            return
        }

        guard let mutationIdentity = self.beginSessionMutation(for: sessionKey) else { return }
        let isCurrentSession = self.sessionKeysMatch(sessionKey, self.sessionKey)
        self.sessionActionErrorText = nil
        if isCurrentSession {
            self.errorText = nil
        }
        defer { self.endSessionMutation(identity: mutationIdentity) }

        do {
            try await self.transport.deleteSession(sessionKey: sessionKey)
        } catch {
            let message = self.presentableErrorMessage(
                for: error,
                fallback: "This chat could not be deleted.")
            if isCurrentSession {
                self.errorText = message
            }
            self.sessionActionErrorText = message
            chatUILogger.error("session delete failed \(error.localizedDescription, privacy: .public)")
            return
        }

        self.deletedSessionIdentityKeys.insert(mutationIdentity)
        self.removeSessionState(for: sessionKey)
        if isCurrentSession {
            await self.activateSession(self.resolvedMainSessionKey)
        } else {
            await self.refreshSessionsPreservingQuery()
        }
    }

    private func performSelectThinkingLevel(_ level: String, requestID: UInt64) async {
        let next = Self.normalizedThinkingLevel(level) ?? "off"
        guard next != self.thinkingLevel else { return }

        let sessionKey = self.sessionKey
        self.thinkingLevel = next
        self.onThinkingLevelChanged?(next)
        self.latestThinkingSelectionRequestIDsBySession[sessionKey] = requestID
        self.latestThinkingLevelsBySession[sessionKey] = next

        do {
            try await self.transport.setSessionThinking(sessionKey: sessionKey, thinkingLevel: next)
            guard requestID == self.latestThinkingSelectionRequestIDsBySession[sessionKey] else {
                let latest = self.latestThinkingLevelsBySession[sessionKey] ?? next
                guard latest != next else { return }
                try? await self.transport.setSessionThinking(sessionKey: sessionKey, thinkingLevel: latest)
                return
            }
        } catch {
            guard sessionKey == self.sessionKey,
                  requestID == self.latestThinkingSelectionRequestIDsBySession[sessionKey]
            else { return }
            // Best-effort. Persisting the user's local preference matters more than a patch error here.
        }
    }

    private func performSelectModel(_ selectionID: String) async {
        let next = self.normalizedSelectionID(selectionID)
        guard next != self.modelSelectionID else { return }

        let sessionKey = self.sessionKey
        let previous = self.modelSelectionID
        let previousRequestID = self.latestModelSelectionRequestIDsBySession[sessionKey]
        self.nextModelSelectionRequestID &+= 1
        let requestID = self.nextModelSelectionRequestID
        let nextModelRef = self.modelRef(forSelectionID: next)
        self.latestModelSelectionRequestIDsBySession[sessionKey] = requestID
        self.latestModelSelectionIDsBySession[sessionKey] = next
        self.beginModelPatch(for: sessionKey)
        self.modelSelectionID = next
        self.errorText = nil
        defer { self.endModelPatch(for: sessionKey) }

        do {
            try await self.transport.setSessionModel(
                sessionKey: sessionKey,
                model: nextModelRef)
            guard requestID == self.latestModelSelectionRequestIDsBySession[sessionKey] else {
                // Keep older successful patches as rollback state, but do not replay
                // stale UI/session state over a newer in-flight or completed selection.
                self.lastSuccessfulModelSelectionIDsBySession[sessionKey] = next
                return
            }
            self.applySuccessfulModelSelection(next, sessionKey: sessionKey, syncSelection: true)
        } catch {
            guard requestID == self.latestModelSelectionRequestIDsBySession[sessionKey] else { return }
            self.latestModelSelectionIDsBySession[sessionKey] = previous
            if let previousRequestID {
                self.latestModelSelectionRequestIDsBySession[sessionKey] = previousRequestID
            } else {
                self.latestModelSelectionRequestIDsBySession.removeValue(forKey: sessionKey)
            }
            if self.lastSuccessfulModelSelectionIDsBySession[sessionKey] == previous {
                self.applySuccessfulModelSelection(previous, sessionKey: sessionKey, syncSelection: sessionKey == self.sessionKey)
            }
            guard sessionKey == self.sessionKey else { return }
            self.modelSelectionID = previous
            self.errorText = self.presentableErrorMessage(
                for: error,
                fallback: "That model could not be selected.")
            chatUILogger.error("sessions.patch(model) failed \(error.localizedDescription, privacy: .public)")
        }
    }

    private func beginModelPatch(for sessionKey: String) {
        self.inFlightModelPatchCountsBySession[sessionKey, default: 0] += 1
    }

    private func endModelPatch(for sessionKey: String) {
        let remaining = max(0, (self.inFlightModelPatchCountsBySession[sessionKey] ?? 0) - 1)
        if remaining == 0 {
            self.inFlightModelPatchCountsBySession.removeValue(forKey: sessionKey)
            let waiters = self.modelPatchWaitersBySession.removeValue(forKey: sessionKey) ?? []
            for waiter in waiters {
                waiter.resume()
            }
            return
        }
        self.inFlightModelPatchCountsBySession[sessionKey] = remaining
    }

    private func waitForPendingModelPatches(in sessionKey: String) async {
        guard (self.inFlightModelPatchCountsBySession[sessionKey] ?? 0) > 0 else { return }
        await withCheckedContinuation { continuation in
            self.modelPatchWaitersBySession[sessionKey, default: []].append(continuation)
        }
    }

    private func placeholderSession(key: String) -> AlisioChatSessionEntry {
        AlisioChatSessionEntry(
            key: key,
            kind: nil,
            label: nil,
            displayName: nil,
            derivedTitle: nil,
            lastMessagePreview: nil,
            surface: nil,
            subject: nil,
            room: nil,
            space: nil,
            updatedAt: nil,
            sessionId: nil,
            systemSent: nil,
            abortedLastRun: nil,
            thinkingLevel: nil,
            verboseLevel: nil,
            inputTokens: nil,
            outputTokens: nil,
            totalTokens: nil,
            modelProvider: nil,
            model: nil,
            contextTokens: nil)
    }

    private func syncSelectedModel() {
        let currentSession = self.sessions.first(where: {
            self.sessionKeysMatch($0.key, self.sessionKey)
        })
        let explicitModelID = self.normalizedModelSelectionID(
            currentSession?.model,
            provider: currentSession?.modelProvider)
        if let explicitModelID {
            self.lastSuccessfulModelSelectionIDsBySession[self.sessionKey] = explicitModelID
            self.modelSelectionID = explicitModelID
            return
        }
        self.lastSuccessfulModelSelectionIDsBySession[self.sessionKey] = Self.defaultModelSelectionID
        self.modelSelectionID = Self.defaultModelSelectionID
    }

    private func normalizedSelectionID(_ selectionID: String) -> String {
        let trimmed = selectionID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return Self.defaultModelSelectionID }
        return trimmed
    }

    private func normalizedModelSelectionID(_ modelID: String?, provider: String? = nil) -> String? {
        guard let modelID else { return nil }
        let trimmed = modelID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let provider = Self.normalizedProvider(provider) {
            let providerQualified = Self.providerQualifiedModelSelectionID(modelID: trimmed, provider: provider)
            if let match = self.modelChoices.first(where: {
                $0.selectionID == providerQualified ||
                    ($0.modelID == trimmed && Self.normalizedProvider($0.provider) == provider)
            }) {
                return match.selectionID
            }
            return providerQualified
        }
        if self.modelChoices.contains(where: { $0.selectionID == trimmed }) {
            return trimmed
        }
        let matches = self.modelChoices.filter { $0.modelID == trimmed || $0.selectionID == trimmed }
        if matches.count == 1 {
            return matches[0].selectionID
        }
        return trimmed
    }

    private func modelRef(forSelectionID selectionID: String) -> String? {
        let normalized = self.normalizedSelectionID(selectionID)
        if normalized == Self.defaultModelSelectionID {
            return nil
        }
        return normalized
    }

    private func modelLabel(for modelID: String) -> String {
        self.modelChoices.first(where: { $0.selectionID == modelID || $0.modelID == modelID })?.displayLabel ??
            modelID
    }

    private func applySuccessfulModelSelection(_ selectionID: String, sessionKey: String, syncSelection: Bool) {
        self.lastSuccessfulModelSelectionIDsBySession[sessionKey] = selectionID
        let resolved = self.resolvedSessionModelIdentity(forSelectionID: selectionID)
        self.updateCurrentSessionModel(
            modelID: resolved.modelID,
            modelProvider: resolved.modelProvider,
            sessionKey: sessionKey,
            syncSelection: syncSelection)
    }

    private func resolvedSessionModelIdentity(forSelectionID selectionID: String) -> (modelID: String?, modelProvider: String?) {
        guard let modelRef = self.modelRef(forSelectionID: selectionID) else {
            return (nil, nil)
        }
        if let choice = self.modelChoices.first(where: { $0.selectionID == modelRef }) {
            return (choice.modelID, Self.normalizedProvider(choice.provider))
        }
        return (modelRef, nil)
    }

    private static func normalizedProvider(_ provider: String?) -> String? {
        let trimmed = provider?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let trimmed, !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private static func providerQualifiedModelSelectionID(modelID: String, provider: String) -> String {
        let providerPrefix = "\(provider)/"
        if modelID.hasPrefix(providerPrefix) {
            return modelID
        }
        return "\(provider)/\(modelID)"
    }

    private func updateCurrentSessionModel(
        modelID: String?,
        modelProvider: String?,
        sessionKey: String,
        syncSelection: Bool)
    {
        if let index = self.sessions.firstIndex(where: {
            self.sessionKeysMatch($0.key, sessionKey)
        }) {
            let current = self.sessions[index]
            self.sessions[index] = AlisioChatSessionEntry(
                key: current.key,
                kind: current.kind,
                label: current.label,
                displayName: current.displayName,
                derivedTitle: current.derivedTitle,
                lastMessagePreview: current.lastMessagePreview,
                surface: current.surface,
                subject: current.subject,
                room: current.room,
                space: current.space,
                updatedAt: current.updatedAt,
                sessionId: current.sessionId,
                systemSent: current.systemSent,
                abortedLastRun: current.abortedLastRun,
                thinkingLevel: current.thinkingLevel,
                verboseLevel: current.verboseLevel,
                inputTokens: current.inputTokens,
                outputTokens: current.outputTokens,
                totalTokens: current.totalTokens,
                modelProvider: modelProvider,
                model: modelID,
                contextTokens: current.contextTokens)
        } else {
            let placeholder = self.placeholderSession(key: sessionKey)
            self.sessions.append(
                AlisioChatSessionEntry(
                    key: placeholder.key,
                    kind: placeholder.kind,
                    label: placeholder.label,
                    displayName: placeholder.displayName,
                    derivedTitle: placeholder.derivedTitle,
                    lastMessagePreview: placeholder.lastMessagePreview,
                    surface: placeholder.surface,
                    subject: placeholder.subject,
                    room: placeholder.room,
                    space: placeholder.space,
                    updatedAt: placeholder.updatedAt,
                    sessionId: placeholder.sessionId,
                    systemSent: placeholder.systemSent,
                    abortedLastRun: placeholder.abortedLastRun,
                    thinkingLevel: placeholder.thinkingLevel,
                    verboseLevel: placeholder.verboseLevel,
                    inputTokens: placeholder.inputTokens,
                    outputTokens: placeholder.outputTokens,
                    totalTokens: placeholder.totalTokens,
                    modelProvider: modelProvider,
                    model: modelID,
                    contextTokens: placeholder.contextTokens))
        }
        if syncSelection {
            self.syncSelectedModel()
        }
    }

    private func handleTransportEvent(_ evt: AlisioChatTransportEvent) {
        switch evt {
        case let .health(ok):
            self.healthOK = ok
            self.lastTransportEventAt = Date()
            if ok {
                self.isRecoveringConnection = false
            } else if self.hasLoadedHistory {
                self.markConnectionRecovering()
            }
        case .tick:
            Task { await self.pollHealthIfNeeded(force: false) }
        case let .chat(chat):
            self.lastTransportEventAt = Date()
            self.handleChatEvent(chat)
        case let .agent(agent):
            self.lastTransportEventAt = Date()
            self.handleAgentEvent(agent)
        case .seqGap:
            self.lastTransportEventAt = Date()
            self.errorText = nil
            self.clearPendingRuns(reason: nil)
            self.clearTransientReplyState(for: nil)
            self.markConnectionRecovering()
            let sessionKey = self.sessionKey
            Task {
                await self.refreshHistoryAfterRun(sessionKey: sessionKey)
                await self.pollHealthIfNeeded(force: true)
            }
        }
    }

    private func handleChatEvent(_ chat: AlisioChatEventPayload) {
        let isOurRun = chat.runId.map { self.pendingRuns.contains($0) || self.dispatchingRunIDs.contains($0) } ?? false

        // Gateway may publish canonical session keys (for example "agent:main:main")
        // even when this view currently uses an alias key (for example "main").
        // Never drop events for our own pending run on key mismatch, or the UI can stay
        // stuck at "thinking" until the user reopens and forces a history reload.
        if let sessionKey = chat.sessionKey,
           !self.sessionKeysMatch(sessionKey, self.sessionKey),
           !isOurRun
        {
            return
        }
        if !isOurRun {
            // Keep multiple clients in sync: if another client finishes a run for our session, refresh history.
            switch chat.state {
            case "final", "aborted", "error":
                self.clearTerminalTransientReplyState(for: chat.runId)
                let refreshSessionKey = chat.sessionKey ?? self.sessionKey
                Task { await self.refreshHistoryAfterRun(sessionKey: refreshSessionKey) }
            default:
                break
            }
            return
        }

        switch chat.state {
        case "final", "aborted", "error":
            if chat.state == "error" {
                self.errorText = chat.errorMessage ?? "Chat failed"
            }
            if let runId = chat.runId {
                self.clearPendingRun(runId)
                self.clearTerminalTransientReplyState(for: runId)
            } else if self.pendingRuns.count <= 1 {
                self.clearPendingRuns(reason: nil)
                self.clearTerminalTransientReplyState(for: nil)
            }
            let refreshSessionKey = chat.sessionKey ?? self.sessionKey
            Task { await self.refreshHistoryAfterRun(sessionKey: refreshSessionKey) }
        default:
            break
        }
    }

    private func handleAgentEvent(_ evt: AlisioAgentEventPayload) {
        guard self.acceptsAgentEvent(evt) else {
            return
        }

        switch evt.stream {
        case "assistant":
            if let text = evt.data["text"]?.value as? String {
                self.streamingAssistantRunID = evt.runId
                self.streamingAssistantText = text
            }
        case "tool":
            guard let phase = evt.data["phase"]?.value as? String else { return }
            guard let name = evt.data["name"]?.value as? String else { return }
            guard let toolCallId = evt.data["toolCallId"]?.value as? String else { return }
            if phase == "start" {
                let args = evt.data["args"]
                self.pendingToolCallRunIDsById[toolCallId] = evt.runId
                self.pendingToolCallsById[toolCallId] = AlisioChatPendingToolCall(
                    toolCallId: toolCallId,
                    name: name,
                    args: args,
                    startedAt: evt.ts.map(Double.init) ?? Date().timeIntervalSince1970 * 1000,
                    isError: nil)
            } else if phase == "result" {
                self.removePendingToolCall(toolCallId)
            }
        default:
            break
        }
    }

    private func clearTransientReplyState(for runId: String?) {
        if let runId {
            if self.streamingAssistantRunID == runId {
                self.streamingAssistantRunID = nil
                self.streamingAssistantText = nil
            }
            let matchingToolCallIDs = self.pendingToolCallRunIDsById.compactMap { toolCallId, toolRunId in
                toolRunId == runId ? toolCallId : nil
            }
            for toolCallId in matchingToolCallIDs {
                self.removePendingToolCall(toolCallId)
            }
            return
        }

        self.streamingAssistantRunID = nil
        self.streamingAssistantText = nil
        self.pendingToolCallRunIDsById.removeAll()
        self.pendingToolCallsById = [:]
    }

    private func hasTransientReplyState(for runId: String) -> Bool {
        self.streamingAssistantRunID == runId || self.pendingToolCallRunIDsById.values.contains(runId)
    }

    private func clearTerminalTransientReplyState(for runId: String?) {
        if let runId, self.hasTransientReplyState(for: runId) {
            self.clearTransientReplyState(for: runId)
            return
        }
        if self.pendingRunCount == 0 {
            self.clearTransientReplyState(for: nil)
        }
    }

    private func removePendingToolCall(_ toolCallId: String) {
        self.pendingToolCallRunIDsById.removeValue(forKey: toolCallId)
        self.pendingToolCallsById[toolCallId] = nil
    }

    private func moveAbortRequest(from previousRunId: String, to nextRunId: String) {
        guard previousRunId != nextRunId else { return }
        guard self.abortRequestedRunIDs.remove(previousRunId) != nil else { return }
        self.abortRequestedRunIDs.insert(nextRunId)
    }

    @discardableResult
    private func requestAbort(for runId: String, reportFailure: Bool) async -> Bool {
        guard self.pendingRuns.contains(runId) else { return false }
        do {
            try await self.transport.abortRun(sessionKey: self.sessionKey, runId: runId)
            self.errorText = nil
            return true
        } catch {
            self.abortRequestedRunIDs.remove(runId)
            if reportFailure {
                self.errorText = "The reply could not be stopped. Try again."
            }
            chatUILogger.error("chat.abort failed \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    private func issueDeferredAbortIfNeeded(for runId: String) async {
        guard self.abortRequestedRunIDs.contains(runId) else { return }
        _ = await self.requestAbort(for: runId, reportFailure: true)
    }

    private func acceptsAgentEvent(_ evt: AlisioAgentEventPayload) -> Bool {
        let isKnownRun = self.pendingRuns.contains(evt.runId) ||
            self.dispatchingRunIDs.contains(evt.runId) ||
            evt.runId == self.sessionId

        if let eventSessionKey = evt.sessionKey?.trimmingCharacters(in: .whitespacesAndNewlines),
           !eventSessionKey.isEmpty
        {
            return self.sessionKeysMatch(eventSessionKey, self.sessionKey) || isKnownRun
        }

        return isKnownRun
    }

    private func refreshHistoryAfterRun(sessionKey rawSessionKey: String) async {
        let sessionKey = rawSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sessionKey.isEmpty else { return }
        let previousMessages = if self.sessionKeysMatch(sessionKey, self.sessionKey) {
            self.messages
        } else {
            self.cachedStatesBySession[sessionKey]?.messages ?? []
        }
        do {
            let payload = try await self.transport.requestHistory(sessionKey: sessionKey)
            let refreshedMessages = Self.reconcileRunRefreshMessages(
                previous: previousMessages,
                incoming: Self.decodeMessages(payload.messages ?? []))

            if self.sessionKeysMatch(sessionKey, self.sessionKey) {
                self.messages = refreshedMessages
                self.sessionId = payload.sessionId
                self.hasLoadedHistory = true
                self.lastHistoryRefreshAt = Date()
                if !self.prefersExplicitThinkingLevel,
                   let level = Self.normalizedThinkingLevel(payload.thinkingLevel)
                {
                    self.thinkingLevel = level
                }
                self.cacheLoadedState(for: self.sessionKey)
                self.isRecoveringConnection = false
            } else {
                let cachedThinkingLevel = self.cachedStatesBySession[sessionKey]?.thinkingLevel ??
                    self.lastKnownThinkingLevel(for: sessionKey) ?? "off"
                self.cachedStatesBySession[sessionKey] = CachedSessionState(
                    messages: refreshedMessages,
                    sessionId: payload.sessionId,
                    hasLoadedHistory: true,
                    thinkingLevel: cachedThinkingLevel,
                    lastBootstrapAt: self.cachedStatesBySession[sessionKey]?.lastBootstrapAt,
                    lastHistoryRefreshAt: Date())
            }
        } catch {
            self.markConnectionRecovering()
            chatUILogger.error("refresh history failed \(error.localizedDescription, privacy: .public)")
        }
    }

    private func armPendingRunTimeout(runId: String) {
        self.pendingRunTimeoutTasks[runId]?.cancel()
        self.pendingRunTimeoutTasks[runId] = Task { [weak self] in
            let timeoutMs = await MainActor.run { self?.pendingRunTimeoutMs ?? 0 }
            try? await Task.sleep(nanoseconds: timeoutMs * 1_000_000)
            await MainActor.run { [weak self] in
                guard let self else { return }
                guard self.pendingRuns.contains(runId) else { return }
                self.clearPendingRun(runId)
                self.clearTerminalTransientReplyState(for: runId)
                self.errorText = "Timed out waiting for a reply; try again or refresh."
            }
        }
    }

    private func clearPendingRun(_ runId: String) {
        self.pendingRuns.remove(runId)
        self.dispatchingRunIDs.remove(runId)
        self.abortRequestedRunIDs.remove(runId)
        self.pendingRunTimeoutTasks[runId]?.cancel()
        self.pendingRunTimeoutTasks[runId] = nil
    }

    private func clearPendingRuns(reason: String?) {
        self.dispatchingRunIDs.removeAll()
        self.abortRequestedRunIDs.removeAll()
        for runId in self.pendingRuns {
            self.pendingRunTimeoutTasks[runId]?.cancel()
        }
        self.pendingRunTimeoutTasks.removeAll()
        self.pendingRuns.removeAll()
        if let reason, !reason.isEmpty {
            self.errorText = reason
        }
    }

    private var hasVisibleStreamingAssistantContent: Bool {
        guard let text = self.streamingAssistantText else { return false }
        return AssistantTextParser.hasVisibleContent(in: text, includeThinking: true)
    }

    private var hasVisibleNonUserTranscriptContent: Bool {
        self.messages.contains { message in
            let role = message.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return role != "user" && Self.hasVisibleTranscriptContent(message)
        }
    }

    private static func hasVisibleTranscriptContent(_ message: AlisioChatMessage) -> Bool {
        message.content.contains { content in
            let kind = (content.type ?? "text").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            switch kind {
            case "", "text":
                guard let text = content.text else { return false }
                return AssistantTextParser.hasVisibleContent(in: text, includeThinking: true)
            case "file", "attachment", "toolcall", "tool_call", "tooluse", "tool_use":
                return true
            case "toolresult", "tool_result":
                return !(content.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            default:
                return content.name != nil || content.arguments != nil
            }
        }
    }

    private func markConnectionRecovering() {
        self.isRecoveringConnection = true
        self.lastRecoveryAt = Date()
    }

    private func presentableErrorMessage(for error: Error, fallback: String) -> String {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return fallback }

        let lower = message.lowercased()
        if lower.contains("sign in required") || lower.contains("sign-in required") {
            return "Sign in to use chat."
        }
        if lower.contains("socket") ||
            lower.contains("not connected") ||
            lower.contains("cannot connect") ||
            lower.contains("network")
        {
            return "The chat could not reach the runtime. Try again."
        }
        if lower.contains("timed out") || lower.contains("timeout") {
            return "The request timed out. Try again."
        }
        if lower.contains("message empty") {
            return "Type a message before sending."
        }
        return fallback
    }

    private func pollHealthIfNeeded(force: Bool) async {
        if !force, let last = self.lastHealthPollAt, Date().timeIntervalSince(last) < 10 {
            return
        }
        self.lastHealthPollAt = Date()
        do {
            let ok = try await self.transport.requestHealth(timeoutMs: 5000)
            self.healthOK = ok
            if ok {
                self.isRecoveringConnection = false
            } else if self.hasLoadedHistory {
                self.markConnectionRecovering()
            }
        } catch {
            self.healthOK = false
            if self.hasLoadedHistory {
                self.markConnectionRecovering()
            }
        }
    }

    private func loadAttachments(urls: [URL]) async {
        for url in urls {
            do {
                let data = try await Task.detached { try Data(contentsOf: url) }.value
                await self.addAttachment(
                    url: url,
                    data: data,
                    fileName: url.lastPathComponent,
                    mimeType: Self.mimeType(for: url) ?? "application/octet-stream")
            } catch {
                await MainActor.run {
                    self.errorText = self.presentableErrorMessage(
                        for: error,
                        fallback: "That attachment could not be loaded.")
                }
            }
        }
    }

    private static func mimeType(for url: URL) -> String? {
        let ext = url.pathExtension
        guard !ext.isEmpty else { return nil }
        return (UTType(filenameExtension: ext) ?? .data).preferredMIMEType
    }

    private func addAttachment(url: URL?, data: Data, fileName: String, mimeType: String) async {
        if data.count > 5_000_000 {
            self.errorText = "Attachment \(fileName) exceeds 5 MB limit"
            return
        }

        let uti: UTType = {
            if let url {
                return UTType(filenameExtension: url.pathExtension) ?? .data
            }
            return UTType(mimeType: mimeType) ?? .data
        }()
        let isImageAttachment = uti.conforms(to: .image)
        let preview = isImageAttachment ? Self.previewImage(data: data) : nil
        self.attachments.append(
            AlisioPendingAttachment(
                url: url,
                data: data,
                fileName: fileName,
                mimeType: mimeType,
                type: isImageAttachment ? "image" : "file",
                preview: preview))
    }

    private static func previewImage(data: Data) -> AlisioPlatformImage? {
        #if canImport(AppKit)
        NSImage(data: data)
        #elseif canImport(UIKit)
        UIImage(data: data)
        #else
        nil
        #endif
    }

    private static func normalizedThinkingLevel(_ level: String?) -> String? {
        guard let level else { return nil }
        let trimmed = level.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard ["off", "minimal", "low", "medium", "high", "xhigh", "adaptive"].contains(trimmed) else {
            return nil
        }
        return trimmed
    }

    private func nextOptimisticMessageTimestampMs() -> Double {
        let now = Date().timeIntervalSince1970 * 1000
        let latestMessageTimestamp = self.messages.compactMap(\.timestamp).max() ?? 0
        let floor = max(self.lastOptimisticMessageTimestampMs, latestMessageTimestamp)
        let next = now > floor ? now : floor + 1
        self.lastOptimisticMessageTimestampMs = next
        return next
    }

    private func refreshPendingRunCount() {
        self.pendingRunCount = self.pendingRuns.count + self.dispatchingRunIDs.count
    }
}

#if DEBUG
private struct PreviewChatTransport: AlisioChatTransport {
    func requestHistory(sessionKey: String) async throws -> AlisioChatHistoryPayload {
        AlisioChatHistoryPayload(sessionKey: sessionKey, sessionId: "preview-\(sessionKey)", messages: [], thinkingLevel: "low")
    }

    func listModels() async throws -> [AlisioChatModelChoice] { [] }

    func sendMessage(
        sessionKey _: String,
        message _: String,
        thinking _: String,
        idempotencyKey: String,
        attachments _: [AlisioChatAttachmentPayload]) async throws -> AlisioChatSendResponse
    {
        AlisioChatSendResponse(runId: idempotencyKey, status: "accepted")
    }

    func abortRun(sessionKey _: String, runId _: String) async throws {}
    func listSessions(query _: AlisioChatSessionsQuery) async throws -> AlisioChatSessionsListResponse {
        AlisioChatSessionsListResponse(ts: nil, path: nil, count: 0, defaults: nil, sessions: [])
    }

    func createSession(request _: AlisioChatSessionCreateRequest) async throws -> AlisioChatSessionCreateResponse {
        AlisioChatSessionCreateResponse(
            ok: true,
            key: "agent:main:dashboard:preview",
            sessionId: "preview-session",
            entry: nil)
    }

    func setSessionModel(sessionKey _: String, model _: String?) async throws {}
    func setSessionThinking(sessionKey _: String, thinkingLevel _: String) async throws {}
    func requestHealth(timeoutMs _: Int) async throws -> Bool { true }
    func events() -> AsyncStream<AlisioChatTransportEvent> { AsyncStream { _ in } }
    func deleteSession(sessionKey _: String) async throws {}
}

extension AlisioChatViewModel {
    public static func preview(
        sessionKey: String = "main",
        sessionId: String? = "sess-preview",
        messages: [AlisioChatMessage] = [],
        sessions: [AlisioChatSessionEntry] = [],
        modelChoices: [AlisioChatModelChoice] = [],
        thinkingLevel: String = "low",
        modelSelectionID: String = AlisioChatViewModel.defaultModelSelectionID,
        healthOK: Bool = true,
        isLoading: Bool = false,
        isRecoveringConnection: Bool = false,
        pendingRunCount: Int = 0,
        streamingAssistantText: String? = nil,
        pendingToolCalls: [AlisioChatPendingToolCall] = [],
        errorText: String? = nil,
        hasLoadedHistory: Bool = true,
        lastBootstrapAt: Date? = Date(),
        lastHistoryRefreshAt: Date? = Date(),
        lastTransportEventAt: Date? = Date(),
        lastRecoveryAt: Date? = nil) -> AlisioChatViewModel
    {
        let viewModel = AlisioChatViewModel(
            sessionKey: sessionKey,
            transport: PreviewChatTransport(),
            initialThinkingLevel: thinkingLevel)
        viewModel.messages = messages
        viewModel.sessionId = sessionId
        viewModel.sessions = sessions
        viewModel.modelChoices = modelChoices
        viewModel.thinkingLevel = thinkingLevel
        viewModel.modelSelectionID = modelSelectionID
        viewModel.healthOK = healthOK
        viewModel.isLoading = isLoading
        viewModel.isRecoveringConnection = isRecoveringConnection
        viewModel.streamingAssistantText = streamingAssistantText
        viewModel.errorText = errorText
        viewModel.hasLoadedHistory = hasLoadedHistory
        viewModel.lastBootstrapAt = lastBootstrapAt
        viewModel.lastHistoryRefreshAt = lastHistoryRefreshAt
        viewModel.lastTransportEventAt = lastTransportEventAt
        viewModel.lastRecoveryAt = lastRecoveryAt
        viewModel.sessionDefaults = AlisioChatSessionsDefaults(model: nil, contextTokens: nil, mainSessionKey: "main")
        viewModel.pendingRuns = Set((0..<pendingRunCount).map { "preview-run-\($0)" })
        viewModel.pendingToolCallsById = Dictionary(
            uniqueKeysWithValues: pendingToolCalls.map { ($0.toolCallId, $0) })
        return viewModel
    }
}
#endif
