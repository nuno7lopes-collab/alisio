import Foundation
import Observation

import AlisioSupport

struct MemoryAgentsListResult: Decodable, Sendable {
    let agents: [MemoryAgentSummary]
}

struct MemoryAgentSummary: Decodable, Equatable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String?
    let identity: MemoryAgentIdentity?
    let personalContext: MemoryPersonalContextSummary?

    var displayName: String {
        self.name?.nonEmpty ?? self.identity?.name?.nonEmpty ?? self.id
    }
}

struct MemoryAgentIdentity: Decodable, Equatable, Hashable, Sendable {
    let name: String?
}

struct MemoryPersonalContextSummary: Decodable, Equatable, Hashable, Sendable {
    let documents: [MemoryPersonalContextDocument]
}

struct MemoryPersonalContextDocument: Decodable, Equatable, Hashable, Sendable {
    let path: String
    let kind: String
    let present: Bool
    let size: Int?
    let updatedAtMs: Int?
}

struct MemoryAgentFileGetResult: Decodable, Sendable {
    let file: MemoryAgentFilePayload
}

struct MemoryAgentFilePayload: Decodable, Equatable, Sendable {
    let name: String
    let path: String?
    let missing: Bool
    let size: Int?
    let updatedAtMs: Int?
    let content: String?
}

enum MemorySurfaceSection: String, CaseIterable, Identifiable, Sendable {
    case mainMemory
    case dailyNotes
    case topicNotes
    case backlogNotes
    case identity
    case soul
    case agentFiles

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .mainMemory:
            "Main memory"
        case .dailyNotes:
            "Daily notes"
        case .topicNotes:
            "Topic notes"
        case .backlogNotes:
            "Backlog notes"
        case .identity:
            "Identity"
        case .soul:
            "Soul"
        case .agentFiles:
            "Agent files"
        }
    }

    var systemImage: String {
        switch self {
        case .mainMemory:
            "brain"
        case .dailyNotes:
            "calendar"
        case .topicNotes:
            "note.text"
        case .backlogNotes:
            "tray"
        case .identity:
            "person.text.rectangle"
        case .soul:
            "sparkles"
        case .agentFiles:
            "doc.text"
        }
    }
}

struct MemorySurfaceGroup: Identifiable, Equatable, Sendable {
    let section: MemorySurfaceSection
    let items: [MemorySurfaceItem]

    var id: MemorySurfaceSection { self.section }
}

struct MemorySurfaceItem: Identifiable, Equatable, Hashable, Sendable {
    let id: String
    let path: String
    let title: String
    let subtitle: String
    let section: MemorySurfaceSection
    let size: Int?
    let updatedAtMs: Int?

    init(document: MemoryPersonalContextDocument) {
        self.id = document.path
        self.path = document.path
        self.section = Self.resolveSection(kind: document.kind)
        self.title = Self.resolveTitle(path: document.path, kind: document.kind)
        self.subtitle = document.path
        self.size = document.size
        self.updatedAtMs = document.updatedAtMs
    }

    private static func resolveSection(kind: String) -> MemorySurfaceSection {
        switch kind {
        case "main_memory":
            .mainMemory
        case "daily_note":
            .dailyNotes
        case "topic_note":
            .topicNotes
        case "backlog_note":
            .backlogNotes
        case "identity":
            .identity
        case "soul":
            .soul
        default:
            .agentFiles
        }
    }

    private static func resolveTitle(path: String, kind: String) -> String {
        switch kind {
        case "main_memory":
            return "Main memory"
        case "identity":
            return "Identity"
        case "soul":
            return "Soul"
        case "daily_note":
            return Self.formatDailyTitle(path: path)
        case "topic_note", "backlog_note":
            return Self.humanizePathComponent(Self.fileStem(from: path))
        default:
            return Self.fileName(from: path)
        }
    }

    private static func fileName(from path: String) -> String {
        URL(fileURLWithPath: path).lastPathComponent
    }

    private static func fileStem(from path: String) -> String {
        URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
    }

    private static func humanizePathComponent(_ value: String) -> String {
        let spaced = value
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return spaced.isEmpty ? value : spaced.localizedCapitalized
    }

    private static func formatDailyTitle(path: String) -> String {
        let value = Self.fileStem(from: path)
        let formatter = Self.dailyInputFormatter
        let displayFormatter = Self.dailyOutputFormatter
        guard let date = formatter.date(from: value) else {
            return value
        }
        return displayFormatter.string(from: date)
    }

    private static let dailyInputFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let dailyOutputFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "MMM d, yyyy"
        return formatter
    }()
}

struct MemoryWorkspaceFileDocument: Equatable, Sendable {
    let agentId: String
    let item: MemorySurfaceItem
    let content: String
    let size: Int?
    let updatedAtMs: Int?

    var fileName: String {
        URL(fileURLWithPath: self.item.path).lastPathComponent
    }
}

struct MemorySettingsClient: Sendable {
    let listAgents: @Sendable () async throws -> MemoryAgentsListResult
    let readFile: @Sendable (_ agentId: String, _ path: String) async throws -> MemoryAgentFilePayload

    static let live = Self(
        listAgents: {
            let data = try await GatewayConnection.shared.requestRaw(
                method: "agents.list",
                params: [:],
                timeoutMs: 15_000)
            return try Self.decode(MemoryAgentsListResult.self, from: data, method: "agents.list")
        },
        readFile: { agentId, path in
            let data = try await GatewayConnection.shared.requestRaw(
                method: "agents.files.get",
                params: [
                    "agentId": AnyCodable(agentId),
                    "name": AnyCodable(path),
                ],
                timeoutMs: 15_000)
            let result = try Self.decode(
                MemoryAgentFileGetResult.self,
                from: data,
                method: "agents.files.get")
            return result.file
        })

    private static func decode<T: Decodable>(_ type: T.Type, from data: Data, method: String) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw NSError(
                domain: "GatewayDecoding",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "\(method) returned invalid data: \(error.localizedDescription)"])
        }
    }
}

enum MemorySettingsAccountGate: Equatable, Sendable {
    case authenticated
    case signedOut
    case unavailable(String)
}

@MainActor
@Observable
final class MemorySettingsModel {
    enum ListState: Equatable {
        case loading
        case error(String)
        case empty(String)
        case filteredEmpty
        case list
    }

    private struct CacheKey: Hashable {
        let agentId: String
        let path: String
    }

    var agents: [MemoryAgentSummary] = []
    var selectedAgentID: String?
    var sections: [MemorySurfaceGroup] = []
    var selectedItemID: String?
    var selectedDocument: MemoryWorkspaceFileDocument?

    var isLoading = false
    var isSearching = false
    var isLoadingSelectedDocument = false
    var hasLoadedOnce = false

    var statusMessage: String?
    var loadError: String?
    var searchError: String?
    var detailError: String?
    var searchQuery = ""

    private let client: MemorySettingsClient
    private let accountGateProvider: (String) async -> MemorySettingsAccountGate
    private var itemsByAgentID: [String: [MemorySurfaceItem]] = [:]
    private var documentCache: [CacheKey: MemoryWorkspaceFileDocument] = [:]

    init(
        client: MemorySettingsClient = .live,
        accountGate: @escaping (String) async -> MemorySettingsAccountGate = MemorySettingsModel.liveAccountGate)
    {
        self.client = client
        self.accountGateProvider = accountGate
    }

    var selectedAgent: MemoryAgentSummary? {
        guard let selectedAgentID else { return nil }
        return self.agents.first(where: { $0.id == selectedAgentID })
    }

    var selectedItem: MemorySurfaceItem? {
        guard let selectedItemID else { return nil }
        return self.allItems.first(where: { $0.id == selectedItemID })
    }

    var allItems: [MemorySurfaceItem] {
        guard let selectedAgentID else { return [] }
        return self.itemsByAgentID[selectedAgentID] ?? []
    }

    var currentErrorMessage: String? {
        self.searchError?.nonEmpty ?? self.loadError?.nonEmpty
    }

    var listState: ListState {
        if !self.sections.isEmpty {
            return .list
        }

        if self.isLoading || !self.hasLoadedOnce {
            return .loading
        }

        if let error = self.currentErrorMessage {
            return .error(error)
        }

        if self.searchQuery.nonEmpty != nil, !self.allItems.isEmpty {
            return .filteredEmpty
        }

        return .empty(self.statusMessage ?? "No memory files are available yet.")
    }

    func refresh() async {
        guard !self.isLoading else { return }
        self.isLoading = true
        self.loadError = nil
        self.searchError = nil
        self.detailError = nil
        self.statusMessage = nil
        defer {
            self.isLoading = false
            self.hasLoadedOnce = true
        }

        switch await self.accountGateProvider("agents.list") {
        case .authenticated:
            break
        case .signedOut:
            self.agents = []
            self.itemsByAgentID = [:]
            self.sections = []
            self.selectedAgentID = nil
            self.selectedItemID = nil
            self.selectedDocument = nil
            self.statusMessage = "Sign in to view memory."
            return
        case let .unavailable(message):
            self.agents = []
            self.itemsByAgentID = [:]
            self.sections = []
            self.selectedAgentID = nil
            self.selectedItemID = nil
            self.selectedDocument = nil
            self.loadError = message
            return
        }

        do {
            let result = try await self.client.listAgents()
            let agents = result.agents.sorted {
                $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
            }
            self.agents = agents
            self.itemsByAgentID = Dictionary(uniqueKeysWithValues: agents.map { agent in
                let items = (agent.personalContext?.documents ?? [])
                    .filter(\.present)
                    .map(MemorySurfaceItem.init(document:))
                return (agent.id, items)
            })
            self.documentCache.removeAll()

            if agents.isEmpty {
                self.sections = []
                self.selectedAgentID = nil
                self.selectedItemID = nil
                self.selectedDocument = nil
                self.statusMessage = "No agents are available yet."
                return
            }

            let preferredAgentID = self.resolvePreferredAgentID(from: agents)
            self.selectedAgentID = preferredAgentID
            await self.rebuildSectionsAndSelection()
        } catch {
            self.agents = []
            self.itemsByAgentID = [:]
            self.sections = []
            self.selectedAgentID = nil
            self.selectedItemID = nil
            self.selectedDocument = nil
            self.loadError = error.localizedDescription
        }
    }

    func selectAgent(_ agentID: String) async {
        guard self.selectedAgentID != agentID else { return }
        self.selectedAgentID = agentID
        self.searchError = nil
        self.detailError = nil
        self.selectedDocument = nil
        await self.rebuildSectionsAndSelection()
    }

    func search(query: String) async {
        self.searchQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        self.searchError = nil
        await self.rebuildSectionsAndSelection()
    }

    func selectItem(_ itemID: String?) async {
        guard self.selectedItemID != itemID else { return }
        self.selectedItemID = itemID
        self.selectedDocument = nil
        self.detailError = nil
        await self.loadSelectedDocument()
    }

    func reloadSelectedDocument() async {
        guard let agentID = self.selectedAgentID, let item = self.selectedItem else { return }
        self.documentCache.removeValue(forKey: CacheKey(agentId: agentID, path: item.path))
        self.selectedDocument = nil
        self.detailError = nil
        await self.loadSelectedDocument()
    }

    private func rebuildSectionsAndSelection() async {
        guard let selectedAgent = self.selectedAgent else {
            self.sections = []
            self.selectedItemID = nil
            self.selectedDocument = nil
            return
        }

        guard selectedAgent.personalContext != nil else {
            self.sections = []
            self.selectedItemID = nil
            self.selectedDocument = nil
            self.loadError = "Memory is unavailable for this agent."
            self.statusMessage = nil
            return
        }

        self.loadError = nil
        self.statusMessage = self.allItems.isEmpty ? "No memory files are available yet." : nil

        do {
            let filteredItems = try await self.filteredItems()
            self.sections = Self.groupItems(filteredItems)
            let orderedItems = self.sections.flatMap(\.items)
            let nextSelection = orderedItems.first(where: { $0.id == self.selectedItemID })?.id
                ?? orderedItems.first?.id

            if self.selectedItemID != nextSelection {
                self.selectedItemID = nextSelection
                self.selectedDocument = nil
                self.detailError = nil
            }

            await self.loadSelectedDocument()
        } catch is CancellationError {
            return
        } catch {
            self.sections = []
            self.selectedItemID = nil
            self.selectedDocument = nil
            self.detailError = nil
            self.searchError = error.localizedDescription
        }
    }

    private func filteredItems() async throws -> [MemorySurfaceItem] {
        let query = self.searchQuery.nonEmpty
        let items = self.allItems
        guard let query else { return items }

        self.isSearching = true
        defer { self.isSearching = false }

        var matches: [MemorySurfaceItem] = []
        for item in items {
            try Task.checkCancellation()
            if Self.matchesMetadata(item: item, query: query) {
                matches.append(item)
                continue
            }

            guard let agentID = self.selectedAgentID else { continue }
            let document = try await self.document(agentId: agentID, item: item)
            if document.content.localizedCaseInsensitiveContains(query) {
                matches.append(item)
            }
        }
        return matches
    }

    private func loadSelectedDocument() async {
        guard let agentID = self.selectedAgentID, let item = self.selectedItem else {
            self.selectedDocument = nil
            self.detailError = nil
            self.isLoadingSelectedDocument = false
            return
        }

        self.isLoadingSelectedDocument = true
        defer { self.isLoadingSelectedDocument = false }

        do {
            self.selectedDocument = try await self.document(agentId: agentID, item: item)
            self.detailError = nil
        } catch {
            self.selectedDocument = nil
            self.detailError = error.localizedDescription
        }
    }

    private func document(agentId: String, item: MemorySurfaceItem) async throws -> MemoryWorkspaceFileDocument {
        let key = CacheKey(agentId: agentId, path: item.path)
        if let cached = self.documentCache[key] {
            return cached
        }

        let file = try await self.client.readFile(agentId, item.path)
        if file.missing {
            throw NSError(
                domain: "MemorySettings",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "\(item.path) is no longer available."])
        }

        let document = MemoryWorkspaceFileDocument(
            agentId: agentId,
            item: item,
            content: file.content ?? "",
            size: file.size ?? item.size,
            updatedAtMs: file.updatedAtMs ?? item.updatedAtMs)
        self.documentCache[key] = document
        return document
    }

    private func resolvePreferredAgentID(from agents: [MemoryAgentSummary]) -> String {
        if let selectedAgentID, agents.contains(where: { $0.id == selectedAgentID }) {
            return selectedAgentID
        }
        if let main = agents.first(where: { $0.id == "main" }) {
            return main.id
        }
        return agents[0].id
    }

    private static func liveAccountGate(reason: String) async -> MemorySettingsAccountGate {
        do {
            _ = try await AlisioAccountStore.shared.requireAuthenticated(reason: reason)
            return .authenticated
        } catch let error as AlisioAccountRequiredError {
            switch error {
            case .signedOut:
                return .signedOut
            case let .unavailable(message):
                return .unavailable(message)
            }
        } catch {
            return .unavailable(error.localizedDescription)
        }
    }

    private static func groupItems(_ items: [MemorySurfaceItem]) -> [MemorySurfaceGroup] {
        let grouped = Dictionary(grouping: items, by: \.section)
        return MemorySurfaceSection.allCases.compactMap { section in
            guard let items = grouped[section], !items.isEmpty else { return nil }
            return MemorySurfaceGroup(section: section, items: items)
        }
    }

    private static func matchesMetadata(item: MemorySurfaceItem, query: String) -> Bool {
        item.title.localizedCaseInsensitiveContains(query) || item.path.localizedCaseInsensitiveContains(query)
    }
}
