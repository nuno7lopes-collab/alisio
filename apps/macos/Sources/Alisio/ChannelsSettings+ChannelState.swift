import AppKit
import Foundation
import Observation

import AlisioSupport

enum GatewayAppItemStatus: String, Decodable {
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

enum GatewayConnectorAuthorizationState: String, Decodable {
    case notConnected = "not_connected"
    case connected
    case needsReconnect = "needs_reconnect"
}

enum GatewayConnectorAuthorizationHealth: String, Decodable {
    case healthy
    case needsReconnect = "needs_reconnect"
    case configMissing = "config_missing"
    case inReview = "in_review"
    case unavailable
}

private enum GatewayConnectorBeginMode: String, Decodable {
    case oauth
    case setup
}

private enum GatewayConnectorBeginReason: String, Decodable {
    case readyForOAuth = "ready_for_oauth"
    case readyForSetup = "ready_for_setup"
    case missingClientConfig = "missing_client_config"
    case missingTokenEncryption = "missing_token_encryption"
    case reviewRequired = "review_required"
    case unavailable
}

struct GatewayProvidersAppsResponse: Decodable {
    struct ConnectorsPayload: Decodable {
        let catalog: [GatewayConnectorCatalogItem]
        let authorizations: [GatewayConnectorAuthorization]
    }

    let generatedAt: String
    let connectors: ConnectorsPayload
    let apps: [GatewayAppItem]
}

struct GatewayAppItem: Decodable {
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

struct GatewayConnectedAccount: Decodable {
    let label: String
    let email: String?
    let handle: String?
}

struct GatewayConnectorCatalogItem: Decodable {
    let id: String
    let title: String
    let providerLabel: String
    let connectLabel: String
    let summary: String
    let detail: String?
    let setupUrl: String?
}

struct GatewayConnectorAuthorization: Decodable {
    let connectorId: String
    let state: GatewayConnectorAuthorizationState
    let health: GatewayConnectorAuthorizationHealth
    let connectedAt: String?
    let connectedAccount: GatewayConnectedAccount?
}

private struct GatewayConnectorBeginResult: Decodable {
    let connectorId: String
    let mode: GatewayConnectorBeginMode
    let statusReason: GatewayConnectorBeginReason
    let setupUrl: String?
    let setupHint: String?
}

private enum AppIntegrationGrouping {
    static func groupID(for connectorId: String) -> String {
        if connectorId.hasPrefix("gmail-") {
            return "gmail"
        }
        return connectorId
    }

    static func title(for groupID: String, fallback: String) -> String {
        switch groupID {
        case "gmail":
            "Gmail"
        default:
            fallback
        }
    }

    static func capabilityTitle(for connectorId: String, fallback: String) -> String {
        switch connectorId {
        case "gmail-read":
            "Read"
        case "gmail-modify":
            "Organize"
        case "gmail-send":
            "Send"
        default:
            fallback
        }
    }

    static func displayTitle(groupID: String, groupTitle: String, capabilityTitle: String) -> String {
        if groupID == "gmail" {
            return "\(groupTitle) \(capabilityTitle)"
        }
        return capabilityTitle
    }

    static func summary(for groupID: String, fallback: String, capabilityCount: Int) -> String {
        switch groupID {
        case "gmail":
            return capabilityCount == 1
                ? fallback
                : "Read, organize, and send email with the access levels you choose."
        default:
            return fallback
        }
    }

    static func systemImage(for groupID: String) -> String {
        switch groupID {
        case "gmail":
            "envelope.badge"
        case "github":
            "chevron.left.forwardslash.chevron.right"
        case "google-analytics":
            "chart.xyaxis.line"
        case "google-calendar":
            "calendar"
        case "google-docs":
            "doc.text"
        case "google-drive":
            "externaldrive"
        case "google-forms":
            "list.bullet.rectangle"
        case "google-sheets":
            "tablecells"
        case "stripe":
            "creditcard"
        case "youtube":
            "play.rectangle"
        default:
            "link"
        }
    }

    static func capabilitySortOrder(for connectorId: String) -> Int {
        switch connectorId {
        case "gmail-read":
            0
        case "gmail-modify":
            1
        case "gmail-send":
            2
        default:
            10
        }
    }
}

struct AppIntegrationCapability: Identifiable, Hashable {
    enum Status: Equatable, Hashable {
        case connected
        case needsReconnect
        case setupRequired
        case ready

        var label: String {
            switch self {
            case .connected:
                "Connected"
            case .needsReconnect:
                "Reconnect"
            case .setupRequired:
                "Setup required"
            case .ready:
                "Not connected"
            }
        }

        var actionTitle: String {
            switch self {
            case .connected:
                "Disconnect"
            case .needsReconnect:
                "Reconnect"
            case .setupRequired, .ready:
                "Connect"
            }
        }
    }

    let id: String
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

struct AppIntegrationGroup: Identifiable, Hashable {
    enum Status: Int, CaseIterable, Equatable, Hashable {
        case connected
        case attention
        case ready

        var label: String {
            switch self {
            case .connected:
                "Connected"
            case .attention:
                "Needs attention"
            case .ready:
                "Not connected"
            }
        }

        var sectionTitle: String {
            switch self {
            case .connected:
                "Connected"
            case .attention:
                "Needs Attention"
            case .ready:
                "Available"
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

struct AppsSurfaceModel: Equatable {
    let apps: [AppIntegrationGroup]

    func capability(withID id: String) -> AppIntegrationCapability? {
        self.apps.lazy.compactMap { app in
            app.capabilities.first(where: { $0.id == id })
        }.first
    }

    static func build(from response: GatewayProvidersAppsResponse) -> AppsSurfaceModel {
        let catalogByID = Dictionary(
            uniqueKeysWithValues: response.connectors.catalog.map { item in
                (item.id, item)
            })
        let authorizationsByID = Dictionary(
            uniqueKeysWithValues: response.connectors.authorizations.map { item in
                (item.connectorId, item)
            })

        let capabilities = response.apps.compactMap { appItem -> AppIntegrationCapability? in
            guard let connectorId = appItem.connectorId?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !connectorId.isEmpty,
                  appItem.status.isVisibleInNativeAppsSurface
            else {
                return nil
            }

            let groupID = AppIntegrationGrouping.groupID(for: connectorId)
            let groupTitle = AppIntegrationGrouping.title(for: groupID, fallback: appItem.title)
            let capabilityTitle = AppIntegrationGrouping.capabilityTitle(
                for: connectorId,
                fallback: appItem.title)
            let authorization = authorizationsByID[connectorId]
            let catalog = catalogByID[connectorId]

            return AppIntegrationCapability(
                id: connectorId,
                title: capabilityTitle,
                displayTitle: AppIntegrationGrouping.displayTitle(
                    groupID: groupID,
                    groupTitle: groupTitle,
                    capabilityTitle: capabilityTitle),
                subtitle: appItem.subtitle,
                detail: appItem.detail ?? catalog?.detail,
                providerLabel: appItem.providerLabel ?? catalog?.providerLabel ?? "Alisio",
                status: Self.resolveCapabilityStatus(
                    itemStatus: appItem.status,
                    authorization: authorization),
                accountLabel: authorization?.connectedAccount?.label ?? appItem.accountLabel,
                accountEmail: authorization?.connectedAccount?.email ?? appItem.accountEmail,
                connectedAt: Self.parseISO8601Date(authorization?.connectedAt),
                docsURL: Self.buildURL(catalog?.setupUrl ?? appItem.docsPath),
                setupHint: nil,
                connectLabel: appItem.connectLabel ?? catalog?.connectLabel ?? "Connect")
        }

        let grouped = Dictionary(grouping: capabilities) { capability in
            AppIntegrationGrouping.groupID(for: capability.id)
        }

        let apps = grouped.compactMap { groupID, groupCapabilities -> AppIntegrationGroup? in
            let sortedCapabilities = groupCapabilities.sorted { lhs, rhs in
                let lhsOrder = AppIntegrationGrouping.capabilitySortOrder(for: lhs.id)
                let rhsOrder = AppIntegrationGrouping.capabilitySortOrder(for: rhs.id)
                if lhsOrder != rhsOrder {
                    return lhsOrder < rhsOrder
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

            return AppIntegrationGroup(
                id: groupID,
                title: AppIntegrationGrouping.title(for: groupID, fallback: first.displayTitle),
                summary: AppIntegrationGrouping.summary(
                    for: groupID,
                    fallback: first.subtitle,
                    capabilityCount: sortedCapabilities.count),
                detail: detail,
                systemImage: AppIntegrationGrouping.systemImage(for: groupID),
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
        if authorization?.state == .connected {
            return .connected
        }
        if authorization?.health == .configMissing {
            return .setupRequired
        }
        switch itemStatus {
        case .connected:
            return .connected
        case .attention:
            return .setupRequired
        case .ready:
            return .ready
        case .comingSoon, .unavailable:
            return .ready
        }
    }

    private static func resolveGroupStatus(capabilities: [AppIntegrationCapability]) -> AppIntegrationGroup.Status {
        if capabilities.contains(where: { capability in
            capability.status == .needsReconnect || capability.status == .setupRequired
        }) {
            return .attention
        }
        let connectedCount = capabilities.filter { $0.status == .connected }.count
        if connectedCount == capabilities.count {
            return .connected
        }
        if connectedCount > 0 {
            return .attention
        }
        return .ready
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
        case .attention:
            if connectedCount > 0 {
                return "\(connectedCount) of \(capabilityCount) access levels are connected."
            }
            return "This app needs setup or reconnecting before it can be used."
        case .ready:
            if capabilityCount == 1 {
                return "Not connected yet."
            }
            return "Choose which access levels to connect."
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

@MainActor
@Observable
final class AppsSettingsStore {
    static let shared = AppsSettingsStore()

    private struct PendingBrowserAction {
        let connectorID: String
        let title: String
    }

    let isPreview: Bool
    var apps: [AppIntegrationGroup] = []
    var lastUpdated: Date?
    var lastError: String?
    var statusMessage: String?
    var isRefreshing = false
    var activeConnectorID: String?

    private let refreshInterval: TimeInterval = 15
    private var refreshTask: Task<Void, Never>?
    private var startCount = 0
    private var pendingBrowserAction: PendingBrowserAction?

    init(isPreview: Bool = ProcessInfo.processInfo.isPreview || ProcessInfo.processInfo.isRunningTests) {
        self.isPreview = isPreview
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
            let data = try await ControlChannel.shared.request(
                method: "alisio.providers.get",
                params: nil,
                timeoutMs: 8000)
            let decoded = try JSONDecoder().decode(GatewayProvidersAppsResponse.self, from: data)
            let surface = AppsSurfaceModel.build(from: decoded)
            self.apps = surface.apps
            self.lastUpdated = AppsSurfaceModel.parseISO8601Date(decoded.generatedAt) ?? Date()
            self.lastError = nil

            if let pending = self.pendingBrowserAction,
               let capability = surface.capability(withID: pending.connectorID),
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
        guard self.activeConnectorID == nil else { return }
        self.activeConnectorID = capability.id
        self.lastError = nil
        defer { self.activeConnectorID = nil }

        switch capability.status {
        case .connected:
            await self.revokeConnection(for: capability)
        case .needsReconnect, .setupRequired, .ready:
            await self.beginConnection(for: capability)
        }
    }

    func connectorIsBusy(_ connectorID: String) -> Bool {
        self.activeConnectorID == connectorID
    }

    private func beginConnection(for capability: AppIntegrationCapability) async {
        do {
            let data = try await ControlChannel.shared.request(
                method: "connectors.begin",
                params: ["connectorId": capability.id],
                timeoutMs: 8000)
            let result = try JSONDecoder().decode(GatewayConnectorBeginResult.self, from: data)

            guard let setupURL = result.setupUrl.flatMap(URL.init(string:)) else {
                self.lastError = result.setupHint ?? self.beginFailureMessage(result, title: capability.displayTitle)
                return
            }

            NSWorkspace.shared.open(setupURL)

            switch result.mode {
            case .oauth:
                self.pendingBrowserAction = PendingBrowserAction(
                    connectorID: capability.id,
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
            _ = try await ControlChannel.shared.request(
                method: "connectors.revoke",
                params: ["connectorId": capability.id],
                timeoutMs: 5000)
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

extension ChannelsSettings {
    var selectedApp: AppIntegrationGroup? {
        guard let selectedAppID else { return nil }
        return self.store.apps.first(where: { $0.id == selectedAppID })
    }

    var connectedApps: [AppIntegrationGroup] {
        self.store.apps.filter { $0.status == .connected }
    }

    var attentionApps: [AppIntegrationGroup] {
        self.store.apps.filter { $0.status == .attention }
    }

    var availableApps: [AppIntegrationGroup] {
        self.store.apps.filter { $0.status == .ready }
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
