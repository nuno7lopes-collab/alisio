import AppKit
import Foundation
import Observation

import AlisioKit
import AlisioSupport

enum GatewayAppItemStatus: String, Decodable, Sendable {
    case connected
    case ready
    case attention
    case comingSoon = "coming_soon"
    case unavailable

    var isVisibleInNativeAppsSurface: Bool {
        switch self {
        case .connected, .ready, .attention:
            true
        case .comingSoon, .unavailable:
            false
        }
    }
}

enum GatewayConnectorAuthorizationState: String, Decodable, Sendable {
    case notConnected = "not_connected"
    case connected
    case needsReconnect = "needs_reconnect"
}

enum GatewayConnectorAuthorizationHealth: String, Decodable, Sendable {
    case healthy
    case needsReconnect = "needs_reconnect"
    case configMissing = "config_missing"
    case inReview = "in_review"
    case unavailable
}

enum GatewayConnectorBeginMode: String, Decodable, Sendable {
    case oauth
    case setup
}

enum GatewayConnectorBeginReason: String, Decodable, Sendable {
    case readyForOAuth = "ready_for_oauth"
    case readyForSetup = "ready_for_setup"
    case missingClientConfig = "missing_client_config"
    case missingTokenEncryption = "missing_token_encryption"
    case reviewRequired = "review_required"
    case unavailable
}

struct GatewayProvidersAppsResponse: Decodable, Sendable {
    struct ConnectorsPayload: Decodable, Sendable {
        let catalog: [GatewayConnectorCatalogItem]
        let authorizations: [GatewayConnectorAuthorization]
    }

    let generatedAt: String
    let connectors: ConnectorsPayload
    let apps: [GatewayAppItem]
}

struct GatewayAppItem: Decodable, Sendable {
    let id: String
    let title: String
    let subtitle: String
    let detail: String?
    let status: GatewayAppItemStatus
    let providerLabel: String?
    let connectorId: String?
    let connectLabel: String?
    let accountLabel: String?
    let accountEmail: String?
    let docsPath: String?
    let chips: [String]
    let active: Bool
}

struct GatewayConnectedAccount: Decodable, Sendable {
    let label: String
    let email: String?
    let handle: String?
}

struct GatewayConnectorSurface: Decodable, Sendable {
    let groupId: String
    let groupTitle: String
    let capabilityTitle: String
    let sortOrder: Int
    let systemImage: String
    let groupSummary: String?
}

struct GatewayConnectorCatalogItem: Decodable, Sendable {
    let id: String
    let title: String
    let providerLabel: String
    let connectLabel: String
    let summary: String
    let detail: String?
    let setupUrl: String?
    let surface: GatewayConnectorSurface?
}

struct GatewayConnectorAuthorization: Decodable, Sendable {
    let connectorId: String
    let state: GatewayConnectorAuthorizationState
    let health: GatewayConnectorAuthorizationHealth
    let connectedAt: String?
    let connectedAccount: GatewayConnectedAccount?
}

struct GatewayConnectorBeginResult: Decodable, Sendable {
    let connectorId: String
    let mode: GatewayConnectorBeginMode
    let statusReason: GatewayConnectorBeginReason
    let setupUrl: String?
    let setupHint: String?
}

struct AppIntegrationCapability: Identifiable, Hashable, Sendable {
    enum Status: Equatable, Hashable, Sendable {
        case connected
        case needsReconnect
        case setupRequired
        case disconnected

        var label: String {
            switch self {
            case .connected:
                "Connected"
            case .needsReconnect:
                "Reconnect"
            case .setupRequired:
                "Setup"
            case .disconnected:
                "Not connected"
            }
        }

        var actionTitle: String {
            switch self {
            case .connected:
                "Disconnect"
            case .needsReconnect:
                "Reconnect"
            case .setupRequired:
                "Open setup"
            case .disconnected:
                "Connect"
            }
        }
    }

    let id: String
    let groupId: String
    let groupTitle: String
    let groupSummary: String?
    let systemImage: String
    let sortOrder: Int
    let title: String
    let displayTitle: String
    let subtitle: String
    let detail: String?
    let providerLabel: String
    let status: Status
    let accountLabel: String?
    let accountEmail: String?
    let connectedAt: Date?
    let docsURL: URL?
    let setupHint: String?
    let connectLabel: String
}

struct AppIntegrationGroup: Identifiable, Hashable, Sendable {
    enum Status: Equatable, Hashable, Sendable {
        case connected
        case needsReconnect
        case setupRequired
        case partiallyConnected
        case disconnected

        var label: String {
            switch self {
            case .connected:
                "Connected"
            case .needsReconnect:
                "Reconnect"
            case .setupRequired:
                "Setup"
            case .partiallyConnected:
                "Partly connected"
            case .disconnected:
                "Not connected"
            }
        }

        var sortRank: Int {
            switch self {
            case .connected:
                0
            case .needsReconnect:
                1
            case .setupRequired:
                2
            case .partiallyConnected:
                3
            case .disconnected:
                4
            }
        }
    }

    let id: String
    let title: String
    let summary: String
    let detail: String?
    let systemImage: String
    let providerLabel: String
    let accountLabel: String?
    let accountEmail: String?
    let docsURL: URL?
    let capabilities: [AppIntegrationCapability]
    let chips: [String]
    let status: Status

    var primaryCapability: AppIntegrationCapability? {
        guard self.capabilities.count == 1 else { return nil }
        return self.capabilities.first
    }

    var primaryConnectedAt: Date? {
        self.primaryCapability?.connectedAt
    }
}

struct AppsSurfaceModel: Equatable, Sendable {
    let apps: [AppIntegrationGroup]

    func capability(withID id: String) -> AppIntegrationCapability? {
        self.apps.lazy.compactMap { app in
            app.capabilities.first(where: { $0.id == id })
        }.first
    }

    static func build(from response: GatewayProvidersAppsResponse) -> AppsSurfaceModel {
        let catalogByID = response.connectors.catalog.reduce(into: [String: GatewayConnectorCatalogItem]()) {
            result, item in
            result[item.id] = item
        }
        let authorizationsByID = response.connectors.authorizations.reduce(
            into: [String: GatewayConnectorAuthorization]())
        { result, item in
            result[item.connectorId] = item
        }

        let capabilities = response.apps.compactMap { appItem -> AppIntegrationCapability? in
            guard let connectorId = appItem.connectorId?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !connectorId.isEmpty,
                  let catalog = catalogByID[connectorId],
                  let surface = catalog.surface
            else {
                return nil
            }
            let authorization = authorizationsByID[connectorId]
            guard Self.isVisibleInNativeAppsSurface(appItem, authorization: authorization) else {
                return nil
            }

            let groupID = surface.groupId
            let groupTitle = surface.groupTitle
            let capabilityTitle = surface.capabilityTitle
            let displayTitle: String
            if groupID == connectorId {
                displayTitle = groupTitle
            } else {
                displayTitle = "\(groupTitle) \(capabilityTitle)"
            }

            return AppIntegrationCapability(
                id: connectorId,
                groupId: groupID,
                groupTitle: groupTitle,
                groupSummary: surface.groupSummary,
                systemImage: surface.systemImage,
                sortOrder: surface.sortOrder,
                title: capabilityTitle,
                displayTitle: displayTitle,
                subtitle: appItem.subtitle,
                detail: appItem.detail ?? catalog.detail,
                providerLabel: appItem.providerLabel ?? catalog.providerLabel,
                status: Self.resolveCapabilityStatus(
                    itemStatus: appItem.status,
                    authorization: authorization),
                accountLabel: authorization?.connectedAccount?.label ?? appItem.accountLabel,
                accountEmail: authorization?.connectedAccount?.email ?? appItem.accountEmail,
                connectedAt: Self.parseISO8601Date(authorization?.connectedAt),
                docsURL: Self.buildURL(catalog.setupUrl ?? appItem.docsPath),
                setupHint: Self.setupHint(for: authorization),
                connectLabel: appItem.connectLabel ?? catalog.connectLabel)
        }

        let grouped = Dictionary(grouping: capabilities) { capability in
            capability.groupId
        }

        let apps = grouped.compactMap { groupID, groupCapabilities -> AppIntegrationGroup? in
            let sortedCapabilities = groupCapabilities.sorted { lhs, rhs in
                if lhs.sortOrder != rhs.sortOrder {
                    return lhs.sortOrder < rhs.sortOrder
                }
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }

            guard let first = sortedCapabilities.first else { return nil }

            let connectedAccounts = Set(sortedCapabilities.compactMap { capability in
                Self.accountIdentity(label: capability.accountLabel, email: capability.accountEmail)
            })
            let accountLabel: String?
            let accountEmail: String?
            if connectedAccounts.count == 1 {
                let reference = sortedCapabilities.first {
                    Self.accountIdentity(label: $0.accountLabel, email: $0.accountEmail) != nil
                }
                accountLabel = reference?.accountLabel
                accountEmail = reference?.accountEmail
            } else if connectedAccounts.count > 1 {
                accountLabel = "Multiple accounts"
                accountEmail = nil
            } else {
                accountLabel = nil
                accountEmail = nil
            }

            let status = Self.resolveGroupStatus(capabilities: sortedCapabilities)
            let connectedCount = sortedCapabilities.filter { $0.status == .connected }.count
            let detail = Self.buildGroupDetail(
                status: status,
                capabilityCount: sortedCapabilities.count,
                connectedCount: connectedCount)
            let summary = sortedCapabilities.count == 1
                ? first.subtitle
                : (first.groupSummary ?? first.subtitle)

            return AppIntegrationGroup(
                id: groupID,
                title: first.groupTitle,
                summary: summary,
                detail: detail,
                systemImage: first.systemImage,
                providerLabel: first.providerLabel,
                accountLabel: accountLabel,
                accountEmail: accountEmail,
                docsURL: sortedCapabilities.compactMap(\.docsURL).first,
                capabilities: sortedCapabilities,
                chips: Self.buildChips(
                    providerLabel: first.providerLabel,
                    capabilityCount: sortedCapabilities.count),
                status: status)
        }
            .sorted { lhs, rhs in
                if lhs.status.sortRank != rhs.status.sortRank {
                    return lhs.status.sortRank < rhs.status.sortRank
                }
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }

        return AppsSurfaceModel(apps: apps)
    }

    private static func isVisibleInNativeAppsSurface(
        _ item: GatewayAppItem,
        authorization: GatewayConnectorAuthorization?) -> Bool
    {
        guard item.status.isVisibleInNativeAppsSurface else { return false }
        switch authorization?.health {
        case .inReview, .unavailable:
            return false
        case .healthy, .needsReconnect, .configMissing, .none:
            return true
        }
    }

    private static func resolveCapabilityStatus(
        itemStatus: GatewayAppItemStatus,
        authorization: GatewayConnectorAuthorization?) -> AppIntegrationCapability.Status
    {
        if authorization?.health == .configMissing {
            return .setupRequired
        }
        if authorization?.state == .needsReconnect ||
            (authorization?.health == .needsReconnect && authorization?.state != .notConnected)
        {
            return .needsReconnect
        }
        if authorization?.state == .connected {
            return .connected
        }
        switch itemStatus {
        case .connected:
            return .connected
        case .attention:
            return .needsReconnect
        case .ready:
            return .disconnected
        case .comingSoon, .unavailable:
            return .disconnected
        }
    }

    private static func resolveGroupStatus(capabilities: [AppIntegrationCapability]) -> AppIntegrationGroup.Status {
        let connectedCount = capabilities.filter { $0.status == .connected }.count
        if connectedCount == capabilities.count {
            return .connected
        }
        if capabilities.contains(where: { $0.status == .needsReconnect }) {
            return .needsReconnect
        }
        if connectedCount > 0 {
            return .partiallyConnected
        }
        if capabilities.contains(where: { $0.status == .setupRequired }) {
            return .setupRequired
        }
        return .disconnected
    }

    private static func buildGroupDetail(
        status: AppIntegrationGroup.Status,
        capabilityCount: Int,
        connectedCount: Int) -> String?
    {
        switch status {
        case .connected:
            if capabilityCount == 1 {
                return "Connected."
            }
            return "All \(capabilityCount) connected."
        case .needsReconnect:
            if connectedCount > 0 {
                return "\(connectedCount) connected. Reconnect the rest to keep using this app."
            }
            return capabilityCount == 1
                ? "Reconnect to keep using this app."
                : "Reconnect the connections that need it."
        case .setupRequired:
            return "Finish setup on this Mac before connecting."
        case .partiallyConnected:
            if connectedCount > 0 {
                return "\(connectedCount) of \(capabilityCount) connected."
            }
            return "Partly connected."
        case .disconnected:
            if capabilityCount == 1 {
                return "Not connected yet."
            }
            return "Choose what to connect."
        }
    }

    private static func setupHint(for authorization: GatewayConnectorAuthorization?) -> String? {
        switch authorization?.health {
        case .configMissing:
            return "Finish setup on this Mac before connecting."
        case .needsReconnect:
            return "Sign in again to keep using this app."
        case .healthy, .inReview, .unavailable, .none:
            return nil
        }
    }

    private static func buildChips(providerLabel: String, capabilityCount: Int) -> [String] {
        var chips = [providerLabel]
        if capabilityCount > 1 {
            chips.append("\(capabilityCount) access levels")
        }
        return chips
    }

    private static func buildURL(_ raw: String?) -> URL? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(string: trimmed)
    }

    fileprivate static func parseISO8601Date(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = fractionalFormatter.date(from: raw) {
            return parsed
        }
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: raw)
    }

    private static func accountIdentity(label: String?, email: String?) -> String? {
        let trimmedLabel = label?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines)

        if let trimmedLabel, !trimmedLabel.isEmpty, let trimmedEmail, !trimmedEmail.isEmpty,
           trimmedLabel.caseInsensitiveCompare(trimmedEmail) != .orderedSame
        {
            return "\(trimmedLabel) · \(trimmedEmail)"
        }
        if let trimmedLabel, !trimmedLabel.isEmpty {
            return trimmedLabel
        }
        if let trimmedEmail, !trimmedEmail.isEmpty {
            return trimmedEmail
        }
        return nil
    }

}

protocol AppsGatewayClient: Sendable {
    func fetchAppsOverview(timeoutMs: Double) async throws -> GatewayProvidersAppsResponse
    func beginAppConnection(appID: String, timeoutMs: Double) async throws -> GatewayConnectorBeginResult
    func revokeAppConnection(appID: String, timeoutMs: Double) async throws
}

enum AppsStatusMessageTone: Equatable, Sendable {
    case neutral
    case success
    case warning
}

@MainActor
@Observable
final class AppsSettingsStore {
    static let shared = AppsSettingsStore()

    private struct PendingBrowserAction {
        let appID: String
        let title: String
    }

    @ObservationIgnored
    private let gateway: any AppsGatewayClient
    @ObservationIgnored
    private let openURL: (URL) -> Void

    let isPreview: Bool
    var apps: [AppIntegrationGroup] = []
    var lastUpdated: Date?
    var lastError: String?
    var statusMessage: String?
    var statusMessageTone: AppsStatusMessageTone = .neutral
    var isRefreshing = false
    var activeAppConnectionID: String?

    private let refreshInterval: TimeInterval = 15
    @ObservationIgnored
    private var refreshTask: Task<Void, Never>?
    @ObservationIgnored
    private var startCount = 0
    @ObservationIgnored
    private var pendingBrowserAction: PendingBrowserAction?

    init(
        isPreview: Bool = ProcessInfo.processInfo.isPreview || ProcessInfo.processInfo.isRunningTests,
        gateway: any AppsGatewayClient = GatewayConnection.shared,
        openURL: @escaping (URL) -> Void = { _ = NSWorkspace.shared.open($0) })
    {
        self.isPreview = isPreview
        self.gateway = gateway
        self.openURL = openURL
    }

    func start() {
        guard !self.isPreview else { return }
        self.startCount += 1
        guard self.startCount == 1 else { return }

        if self.apps.isEmpty {
            Task { await self.refresh() }
        }

        self.refreshTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(self.refreshInterval * 1_000_000_000))
                if Task.isCancelled { return }
                await self.refresh()
            }
        }
    }

    func stop() {
        guard !self.isPreview else { return }
        guard self.startCount > 0 else { return }
        self.startCount -= 1
        guard self.startCount == 0 else { return }
        self.refreshTask?.cancel()
        self.refreshTask = nil
    }

    func refresh() async {
        guard !self.isRefreshing else { return }
        self.isRefreshing = true
        defer { self.isRefreshing = false }

        do {
            let decoded = try await self.gateway.fetchAppsOverview(timeoutMs: 8000)
            let surface = AppsSurfaceModel.build(from: decoded)
            self.apps = surface.apps
            self.lastUpdated = AppsSurfaceModel.parseISO8601Date(decoded.generatedAt) ?? Date()
            self.lastError = nil

            if let pending = self.pendingBrowserAction,
               let capability = surface.capability(withID: pending.appID),
               capability.status == .connected
            {
                self.statusMessage = "\(pending.title) is connected."
                self.statusMessageTone = .success
                self.pendingBrowserAction = nil
            }
        } catch {
            self.lastError = self.userFacingError(error)
        }
    }

    func performAction(for capability: AppIntegrationCapability) async {
        guard self.activeAppConnectionID == nil else { return }
        self.activeAppConnectionID = capability.id
        self.statusMessage = nil
        self.statusMessageTone = .neutral
        self.lastError = nil
        defer { self.activeAppConnectionID = nil }

        switch capability.status {
        case .connected:
            await self.revokeConnection(for: capability)
        case .needsReconnect, .setupRequired, .disconnected:
            await self.beginConnection(for: capability)
        }
    }

    func appConnectionIsBusy(_ appID: String) -> Bool {
        self.activeAppConnectionID == appID
    }

    private func beginConnection(for capability: AppIntegrationCapability) async {
        do {
            self.pendingBrowserAction = nil
            let result = try await self.gateway.beginAppConnection(
                appID: capability.id,
                timeoutMs: 8000)

            guard let setupURL = result.setupUrl.flatMap(URL.init(string:)) else {
                self.lastError = result.setupHint ?? self.beginFailureMessage(result, title: capability.displayTitle)
                return
            }

            self.openURL(setupURL)

            switch result.mode {
            case .oauth:
                self.pendingBrowserAction = PendingBrowserAction(
                    appID: capability.id,
                    title: capability.displayTitle)
                self.statusMessage = "Finish connecting \(capability.displayTitle) in your browser."
                self.statusMessageTone = .neutral
            case .setup:
                self.statusMessage =
                    result.setupHint ??
                    "Finish setup for \(capability.displayTitle), then come back here."
                self.statusMessageTone = .warning
            }

            await self.refresh()
        } catch {
            self.lastError = self.userFacingError(error)
        }
    }

    private func revokeConnection(for capability: AppIntegrationCapability) async {
        do {
            try await self.gateway.revokeAppConnection(appID: capability.id, timeoutMs: 5000)
            self.pendingBrowserAction = nil
            self.statusMessage = "\(capability.displayTitle) disconnected."
            self.statusMessageTone = .success
            await self.refresh()
        } catch {
            self.lastError = self.userFacingError(error)
        }
    }

    private func userFacingError(_ error: Error) -> String {
        if error is GatewayDecodingError {
            return "Alisio could not read the latest app status right now."
        }
        if error is URLError {
            return "Alisio could not refresh apps right now. Check the connection and try again."
        }
        if let response = error as? GatewayResponseError {
            let normalizedMessage = response.message.trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            if normalizedMessage.contains("alisio account sign-in required") {
                return "Sign in to your Alisio account before managing apps."
            }
            if normalizedMessage.contains("unknown connectorid") {
                return "This app is no longer available on this Mac."
            }
            switch response.method {
            case "alisio.providers.get":
                return "Couldn't load apps right now."
            case "connectors.begin":
                return "Couldn't start this connection right now."
            case "connectors.revoke":
                return "Couldn't disconnect this app right now."
            default:
                break
            }
        }
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return "Unable to load apps right now." }
        if message.contains("Alisio account sign-in required") {
            return "Sign in to your Alisio account before managing apps."
        }
        if message.localizedCaseInsensitiveContains("gateway not configured") {
            return "Alisio could not reach this Mac right now. Try again in a moment."
        }
        return message
    }

    private func beginFailureMessage(_ result: GatewayConnectorBeginResult, title: String) -> String {
        switch result.statusReason {
        case .missingClientConfig, .missingTokenEncryption:
            return "Finish setup on this Mac before connecting \(title)."
        case .reviewRequired, .unavailable:
            return "\(title) isn't available on this Mac right now."
        case .readyForSetup:
            return "Open setup for \(title)."
        case .readyForOAuth:
            return "Couldn't start the connection for \(title)."
        }
    }
}

extension AppsSettings {
    var selectedApp: AppIntegrationGroup? {
        guard let selectedAppID else { return nil }
        return self.store.apps.first(where: { $0.id == selectedAppID })
    }

    func ensureSelection() {
        guard let selectedAppID else {
            self.selectedAppID = self.store.apps.first?.id
            return
        }
        if !self.store.apps.contains(where: { $0.id == selectedAppID }) {
            self.selectedAppID = self.store.apps.first?.id
        }
    }
}
