import AppKit
import Foundation
import Observation

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
        case authError
        case disconnected

        var label: String {
            switch self {
            case .connected:
                "Connected"
            case .needsReconnect:
                "Needs attention"
            case .authError:
                "Auth error"
            case .disconnected:
                "Disconnected"
            }
        }

        var actionTitle: String {
            switch self {
            case .connected:
                "Disconnect"
            case .needsReconnect:
                "Reconnect"
            case .authError:
                "Review setup"
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
    enum Status: Int, CaseIterable, Equatable, Hashable, Sendable {
        case connected
        case needsAttention
        case authError
        case disconnected

        var label: String {
            switch self {
            case .connected:
                "Connected"
            case .needsAttention:
                "Needs attention"
            case .authError:
                "Auth error"
            case .disconnected:
                "Disconnected"
            }
        }

        var sectionTitle: String {
            switch self {
            case .connected:
                "Connected"
            case .needsAttention:
                "Needs Attention"
            case .authError:
                "Auth Errors"
            case .disconnected:
                "Disconnected"
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
                  appItem.status.isVisibleInNativeAppsSurface,
                  let catalog = catalogByID[connectorId],
                  let surface = catalog.surface
            else {
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
            let authorization = authorizationsByID[connectorId]

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
                if lhs.status != rhs.status {
                    return lhs.status.rawValue < rhs.status.rawValue
                }
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }

        return AppsSurfaceModel(apps: apps)
    }

    private static func resolveCapabilityStatus(
        itemStatus: GatewayAppItemStatus,
        authorization: GatewayConnectorAuthorization?) -> AppIntegrationCapability.Status
    {
        if authorization?.state == .needsReconnect || authorization?.health == .needsReconnect {
            return .needsReconnect
        }
        if authorization?.health == .configMissing ||
            authorization?.health == .inReview ||
            authorization?.health == .unavailable
        {
            return .authError
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
        if capabilities.contains(where: { $0.status == .authError }) {
            return .authError
        }
        if capabilities.contains(where: { capability in
            capability.status == .needsReconnect
        }) {
            return .needsAttention
        }
        let connectedCount = capabilities.filter { $0.status == .connected }.count
        if connectedCount == capabilities.count {
            return .connected
        }
        if connectedCount > 0 {
            return .needsAttention
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
                return "Connected and ready."
            }
            return "All \(capabilityCount) access levels are connected."
        case .needsAttention:
            if connectedCount > 0 {
                return "\(connectedCount) of \(capabilityCount) access levels are connected."
            }
            return "Reconnect this app before it can be used."
        case .authError:
            return "Gateway OAuth setup is incomplete for this app."
        case .disconnected:
            if capabilityCount == 1 {
                return "Disconnected."
            }
            return "Choose which access levels to connect."
        }
    }

    private static func setupHint(for authorization: GatewayConnectorAuthorization?) -> String? {
        switch authorization?.health {
        case .configMissing:
            return "Gateway OAuth setup is incomplete for this app."
        case .inReview:
            return "This app is still in provider review on this runtime."
        case .unavailable:
            return "This app is unavailable on this runtime."
        case .needsReconnect:
            return "Authorization expired or needs reconnecting."
        case .healthy, .none:
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
                self.statusMessage = "\(pending.title) connected."
                self.pendingBrowserAction = nil
            }
        } catch {
            self.lastError = self.userFacingError(error)
        }
    }

    func performAction(for capability: AppIntegrationCapability) async {
        guard self.activeAppConnectionID == nil else { return }
        self.activeAppConnectionID = capability.id
        self.lastError = nil
        defer { self.activeAppConnectionID = nil }

        switch capability.status {
        case .connected:
            await self.revokeConnection(for: capability)
        case .needsReconnect, .authError, .disconnected:
            await self.beginConnection(for: capability)
        }
    }

    func appConnectionIsBusy(_ appID: String) -> Bool {
        self.activeAppConnectionID == appID
    }

    private func beginConnection(for capability: AppIntegrationCapability) async {
        do {
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
                self.statusMessage = "Continue in your browser to connect \(capability.displayTitle)."
            case .setup:
                self.statusMessage =
                    result.setupHint ??
                    "Open the setup guide for \(capability.displayTitle), then return to Apps."
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
            await self.refresh()
        } catch {
            self.lastError = self.userFacingError(error)
        }
    }

    private func userFacingError(_ error: Error) -> String {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return "Unable to load app connections right now." }
        if message.contains("Alisio account sign-in required") {
            return "Sign in to your Alisio account before managing app connections."
        }
        return message
    }

    private func beginFailureMessage(_ result: GatewayConnectorBeginResult, title: String) -> String {
        switch result.statusReason {
        case .missingClientConfig:
            return "\(title) needs gateway OAuth setup before it can be connected."
        case .missingTokenEncryption:
            return "This gateway cannot store \(title) tokens securely yet."
        case .reviewRequired, .unavailable:
            return "\(title) is not available on this runtime."
        case .readyForSetup:
            return "Open the setup guide for \(title)."
        case .readyForOAuth:
            return "Unable to start the connection flow for \(title)."
        }
    }
}

extension AppsSettings {
    var selectedApp: AppIntegrationGroup? {
        guard let selectedAppID else { return nil }
        return self.store.apps.first(where: { $0.id == selectedAppID })
    }

    var connectedApps: [AppIntegrationGroup] {
        self.store.apps.filter { $0.status == .connected }
    }

    var attentionApps: [AppIntegrationGroup] {
        self.store.apps.filter { $0.status == .needsAttention }
    }

    var authErrorApps: [AppIntegrationGroup] {
        self.store.apps.filter { $0.status == .authError }
    }

    var disconnectedApps: [AppIntegrationGroup] {
        self.store.apps.filter { $0.status == .disconnected }
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
