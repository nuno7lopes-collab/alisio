import Foundation

public struct AlisioChatModelChoice: Identifiable, Codable, Sendable, Hashable {
    public var id: String { self.selectionID }

    public let modelID: String
    public let name: String
    public let provider: String
    public let contextWindow: Int?

    public init(modelID: String, name: String, provider: String, contextWindow: Int?) {
        self.modelID = modelID
        self.name = name
        self.provider = provider
        self.contextWindow = contextWindow
    }

    /// Provider-qualified model ref used for picker identity and selection tags.
    public var selectionID: String {
        let trimmedProvider = self.provider.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedProvider.isEmpty else { return self.modelID }
        let providerPrefix = "\(trimmedProvider)/"
        if self.modelID.hasPrefix(providerPrefix) {
            return self.modelID
        }
        return "\(trimmedProvider)/\(self.modelID)"
    }

    public var displayLabel: String {
        self.selectionID
    }
}

public struct AlisioChatSessionsDefaults: Codable, Sendable {
    public let model: String?
    public let contextTokens: Int?
    public let mainSessionKey: String?

    public init(model: String?, contextTokens: Int?, mainSessionKey: String? = nil) {
        self.model = model
        self.contextTokens = contextTokens
        self.mainSessionKey = mainSessionKey
    }
}

public struct AlisioChatSessionEntry: Codable, Identifiable, Sendable, Hashable {
    public var id: String { self.key }

    public let key: String
    public let kind: String?
    public let label: String?
    public let displayName: String?
    public let derivedTitle: String?
    public let lastMessagePreview: String?
    public let surface: String?
    public let subject: String?
    public let room: String?
    public let space: String?
    public let updatedAt: Double?
    public let sessionId: String?

    public let systemSent: Bool?
    public let abortedLastRun: Bool?
    public let thinkingLevel: String?
    public let verboseLevel: String?

    public let inputTokens: Int?
    public let outputTokens: Int?
    public let totalTokens: Int?

    public let modelProvider: String?
    public let model: String?
    public let contextTokens: Int?

    public init(
        key: String,
        kind: String?,
        label: String? = nil,
        displayName: String?,
        derivedTitle: String? = nil,
        lastMessagePreview: String? = nil,
        surface: String?,
        subject: String?,
        room: String?,
        space: String?,
        updatedAt: Double?,
        sessionId: String?,
        systemSent: Bool?,
        abortedLastRun: Bool?,
        thinkingLevel: String?,
        verboseLevel: String?,
        inputTokens: Int?,
        outputTokens: Int?,
        totalTokens: Int?,
        modelProvider: String?,
        model: String?,
        contextTokens: Int?)
    {
        self.key = key
        self.kind = kind
        self.label = label
        self.displayName = displayName
        self.derivedTitle = derivedTitle
        self.lastMessagePreview = lastMessagePreview
        self.surface = surface
        self.subject = subject
        self.room = room
        self.space = space
        self.updatedAt = updatedAt
        self.sessionId = sessionId
        self.systemSent = systemSent
        self.abortedLastRun = abortedLastRun
        self.thinkingLevel = thinkingLevel
        self.verboseLevel = verboseLevel
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.totalTokens = totalTokens
        self.modelProvider = modelProvider
        self.model = model
        self.contextTokens = contextTokens
    }
}

public enum AlisioChatSessionIdentity {
    public static func normalizedKey(_ key: String) -> String {
        key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    public static func resolvedMainSessionKey(
        from defaults: AlisioChatSessionsDefaults?,
        fallback: String = "main") -> String
    {
        let trimmed = defaults?.mainSessionKey?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (trimmed?.isEmpty == false ? trimmed : nil) ?? fallback
    }

    public static func identityKey(for key: String, mainSessionKey: String?) -> String {
        let normalized = self.normalizedKey(key)
        guard !normalized.isEmpty else { return normalized }
        if self.mainAliases(mainSessionKey: mainSessionKey).contains(normalized) {
            return "__main__"
        }
        return normalized
    }

    public static func matches(_ lhs: String, _ rhs: String, mainSessionKey: String? = nil) -> Bool {
        let leftIdentity = self.identityKey(for: lhs, mainSessionKey: mainSessionKey)
        let rightIdentity = self.identityKey(for: rhs, mainSessionKey: mainSessionKey)
        guard !leftIdentity.isEmpty, !rightIdentity.isEmpty else { return false }
        return leftIdentity == rightIdentity
    }

    private static func mainAliases(mainSessionKey: String?) -> Set<String> {
        var aliases: Set<String> = [
            self.normalizedKey("main"),
            self.normalizedKey("agent:main:main"),
        ]
        let normalizedMain = self.normalizedKey(mainSessionKey ?? "")
        if !normalizedMain.isEmpty {
            aliases.insert(normalizedMain)
        }
        return aliases
    }
}

public enum AlisioChatSessionPresentation {
    public static func title(
        for session: AlisioChatSessionEntry,
        currentSessionKey: String? = nil,
        mainSessionKey: String? = nil) -> String
    {
        let candidates = [
            session.displayName,
            session.derivedTitle,
            session.label,
            session.subject,
            session.room,
            session.space,
        ]
        for candidate in candidates {
            let trimmed = candidate?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !trimmed.isEmpty {
                return trimmed
            }
        }

        if self.isMain(session, mainSessionKey: mainSessionKey) {
            return "Main"
        }

        let kind = session.kind?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if kind == "group" {
            return "Group chat"
        }
        if kind == "direct" || kind == "dm" {
            return "Direct chat"
        }
        if self.isCurrent(session, currentSessionKey: currentSessionKey, mainSessionKey: mainSessionKey),
           session.updatedAt == nil,
           session.sessionId == nil
        {
            return "New chat"
        }
        if self.isLikelyCanonicalSessionKey(session.key) {
            return "Chat"
        }
        return session.key
    }

    public static func previewText(for session: AlisioChatSessionEntry) -> String? {
        let preview = session.lastMessagePreview?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !preview.isEmpty {
            return preview
        }
        let subject = session.subject?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !subject.isEmpty {
            return subject
        }
        return nil
    }

    public static func summary(
        for session: AlisioChatSessionEntry,
        currentSessionKey: String? = nil,
        mainSessionKey: String? = nil) -> String
    {
        let title = self.title(
            for: session,
            currentSessionKey: currentSessionKey,
            mainSessionKey: mainSessionKey)
        if let preview = self.previewText(for: session),
           preview != title
        {
            return preview
        }
        if self.isMain(session, mainSessionKey: mainSessionKey) {
            return "Workspace conversation."
        }
        if self.isCurrent(session, currentSessionKey: currentSessionKey, mainSessionKey: mainSessionKey),
           session.updatedAt == nil,
           session.sessionId == nil
        {
            return ""
        }
        return ""
    }

    public static func searchText(
        for session: AlisioChatSessionEntry,
        currentSessionKey: String? = nil,
        mainSessionKey: String? = nil) -> String
    {
        [
            self.title(for: session, currentSessionKey: currentSessionKey, mainSessionKey: mainSessionKey),
            session.derivedTitle,
            session.displayName,
            session.label,
            session.subject,
            session.room,
            session.space,
            session.sessionId,
            session.key,
            session.lastMessagePreview,
        ]
        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: " ")
    }

    public static func isCurrent(
        _ session: AlisioChatSessionEntry,
        currentSessionKey: String?,
        mainSessionKey: String? = nil) -> Bool
    {
        guard let currentSessionKey else { return false }
        return AlisioChatSessionIdentity.matches(session.key, currentSessionKey, mainSessionKey: mainSessionKey)
    }

    public static func isMain(_ session: AlisioChatSessionEntry, mainSessionKey: String?) -> Bool {
        guard let mainSessionKey else { return false }
        return AlisioChatSessionIdentity.matches(session.key, mainSessionKey, mainSessionKey: mainSessionKey)
    }

    private static func isLikelyCanonicalSessionKey(_ key: String) -> Bool {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        if trimmed == "main" || trimmed == "onboarding" {
            return true
        }
        return trimmed.contains(":") || trimmed.contains("/") || trimmed.contains("\\")
    }
}

public struct AlisioChatSessionsQuery: Sendable, Equatable {
    public let limit: Int?
    public let search: String?
    public let includeGlobal: Bool
    public let includeUnknown: Bool
    public let includeDerivedTitles: Bool
    public let includeLastMessage: Bool
    public let agentId: String?

    public init(
        limit: Int? = nil,
        search: String? = nil,
        includeGlobal: Bool = true,
        includeUnknown: Bool = false,
        includeDerivedTitles: Bool = false,
        includeLastMessage: Bool = false,
        agentId: String? = nil)
    {
        self.limit = limit
        self.search = search
        self.includeGlobal = includeGlobal
        self.includeUnknown = includeUnknown
        self.includeDerivedTitles = includeDerivedTitles
        self.includeLastMessage = includeLastMessage
        self.agentId = agentId
    }
}

public struct AlisioChatSessionCreateRequest: Sendable, Equatable {
    public let parentSessionKey: String?
    public let agentId: String?
    public let label: String?
    public let model: String?
    public let initialMessage: String?

    public init(
        parentSessionKey: String? = nil,
        agentId: String? = nil,
        label: String? = nil,
        model: String? = nil,
        initialMessage: String? = nil)
    {
        self.parentSessionKey = parentSessionKey
        self.agentId = agentId
        self.label = label
        self.model = model
        self.initialMessage = initialMessage
    }
}

public struct AlisioChatSessionCreateResponse: Codable, Sendable, Equatable {
    public let ok: Bool?
    public let key: String
    public let sessionId: String?
    public let entry: AlisioChatSessionEntry?
    public let runStarted: Bool?
    public let runId: String?
    public let messageSeq: Int?

    public init(
        ok: Bool? = nil,
        key: String,
        sessionId: String?,
        entry: AlisioChatSessionEntry?,
        runStarted: Bool? = nil,
        runId: String? = nil,
        messageSeq: Int? = nil)
    {
        self.ok = ok
        self.key = key
        self.sessionId = sessionId
        self.entry = entry
        self.runStarted = runStarted
        self.runId = runId
        self.messageSeq = messageSeq
    }
}

public struct AlisioChatSessionContextUsage: Equatable, Sendable {
    public let inputTokens: Int
    public let outputTokens: Int
    public let totalTokens: Int
    public let contextWindow: Int

    public init(inputTokens: Int, outputTokens: Int, totalTokens: Int, contextWindow: Int) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.totalTokens = totalTokens
        self.contextWindow = contextWindow
    }

    public init?(session: AlisioChatSessionEntry) {
        let input = max(0, session.inputTokens ?? 0)
        let output = max(0, session.outputTokens ?? 0)
        let total = max(0, session.totalTokens ?? (input + output))
        let contextWindow = max(0, session.contextTokens ?? 0)
        guard input > 0 || output > 0 || total > 0 || contextWindow > 0 else {
            return nil
        }
        self.init(
            inputTokens: input,
            outputTokens: output,
            totalTokens: total,
            contextWindow: contextWindow)
    }

    public var percentUsed: Int? {
        guard self.contextWindow > 0, self.totalTokens > 0 else { return nil }
        return min(100, Int(round((Double(self.totalTokens) / Double(self.contextWindow)) * 100)))
    }

    public var compactUsageLabel: String {
        let used = Self.formatCompactTokenCount(self.totalTokens)
        let total = self.contextWindow > 0 ? Self.formatCompactTokenCount(self.contextWindow) : "?"
        return "\(used)/\(total)"
    }

    public static func formatCompactTokenCount(_ value: Int) -> String {
        guard value >= 1_000 else { return "\(value)" }

        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = value >= 10_000_000 ? 0 : 1

        if value >= 1_000_000 {
            let short = formatter.string(from: NSNumber(value: Double(value) / 1_000_000)) ?? "\(value)"
            return "\(short)M"
        }

        let short = formatter.string(from: NSNumber(value: Double(value) / 1_000)) ?? "\(value)"
        return "\(short)k"
    }
}

public struct AlisioChatSessionsListResponse: Codable, Sendable {
    public let ts: Double?
    public let path: String?
    public let count: Int?
    public let defaults: AlisioChatSessionsDefaults?
    public let sessions: [AlisioChatSessionEntry]

    public init(
        ts: Double?,
        path: String?,
        count: Int?,
        defaults: AlisioChatSessionsDefaults?,
        sessions: [AlisioChatSessionEntry])
    {
        self.ts = ts
        self.path = path
        self.count = count
        self.defaults = defaults
        self.sessions = sessions
    }
}
