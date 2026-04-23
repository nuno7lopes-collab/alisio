import Foundation
import Testing
import AlisioKit
@testable import Alisio

struct AppsSurfaceModelTests {
    @Test
    func `filters unreleased connectors and groups Gmail access levels`() throws {
        let response = providersResponse(
            catalog: [
                catalogItem(
                    id: "gmail-read",
                    title: "Gmail Read",
                    providerLabel: "Google",
                    connectLabel: "Connect with Google",
                    summary: "Read inbox state and messages.",
                    surface: surface(
                        groupId: "gmail",
                        groupTitle: "Gmail",
                        capabilityTitle: "Read",
                        sortOrder: 0,
                        systemImage: "envelope.badge",
                        groupSummary: "Email access split by real OAuth scopes.")),
                catalogItem(
                    id: "gmail-send",
                    title: "Gmail Send",
                    providerLabel: "Google",
                    connectLabel: "Connect with Google",
                    summary: "Send outbound email.",
                    surface: surface(
                        groupId: "gmail",
                        groupTitle: "Gmail",
                        capabilityTitle: "Send",
                        sortOrder: 2,
                        systemImage: "envelope.badge",
                        groupSummary: "Email access split by real OAuth scopes.")),
                catalogItem(
                    id: "github",
                    title: "GitHub",
                    providerLabel: "GitHub",
                    connectLabel: "Connect with GitHub",
                    summary: "Repository and pull request workflows.",
                    surface: surface(
                        groupId: "github",
                        groupTitle: "GitHub",
                        capabilityTitle: "Repositories",
                        systemImage: "chevron.left.forwardslash.chevron.right")),
                catalogItem(
                    id: "notion",
                    title: "Notion",
                    providerLabel: "Notion",
                    connectLabel: "Connect with Notion",
                    summary: "In review"),
            ],
            authorizations: [
                authorization(
                    connectorId: "gmail-read",
                    state: .connected,
                    health: .healthy,
                    connectedAccount: connectedAccount(
                        label: "Nuno",
                        email: "nuno@example.com")),
            ],
            apps: [
                appItem(
                    id: "connector:gmail-read",
                    title: "Gmail Read",
                    subtitle: "Read inbox state and messages.",
                    status: .connected,
                    providerLabel: "Google",
                    connectorId: "gmail-read",
                    connectLabel: "Connect with Google"),
                appItem(
                    id: "connector:gmail-send",
                    title: "Gmail Send",
                    subtitle: "Send outbound email.",
                    status: .ready,
                    providerLabel: "Google",
                    connectorId: "gmail-send",
                    connectLabel: "Connect with Google"),
                appItem(
                    id: "connector:github",
                    title: "GitHub",
                    subtitle: "Repository and pull request workflows.",
                    status: .ready,
                    providerLabel: "GitHub",
                    connectorId: "github",
                    connectLabel: "Connect with GitHub"),
                appItem(
                    id: "connector:notion",
                    title: "Notion",
                    subtitle: "In review",
                    status: .comingSoon,
                    providerLabel: "Notion",
                    connectorId: "notion",
                    connectLabel: "Connect with Notion"),
            ])

        let model = AppsSurfaceModel.build(from: response)

        #expect(model.apps.count == 2)
        #expect(model.apps.map(\.title) == ["Gmail", "GitHub"])

        let gmail = try #require(model.apps.first(where: { $0.id == "gmail" }))
        #expect(gmail.status == .needsAttention)
        #expect(gmail.capabilities.map(\.title) == ["Read", "Send"])
        #expect(gmail.capabilities.map(\.status) == [.connected, .disconnected])
        #expect(gmail.detail == "1 of 2 access levels are connected.")
        #expect(gmail.summary == "Email access split by real OAuth scopes.")
        #expect(gmail.systemImage == "envelope.badge")
        #expect(gmail.capabilities.map(\.displayTitle) == ["Gmail Read", "Gmail Send"])
    }

    @Test
    func `surfaces auth error state without pretending the app is connected`() throws {
        let response = providersResponse(
            catalog: [
                catalogItem(
                    id: "github",
                    title: "GitHub",
                    providerLabel: "GitHub",
                    connectLabel: "Connect with GitHub",
                    summary: "Repository and pull request workflows.",
                    surface: surface(
                        groupId: "github",
                        groupTitle: "GitHub",
                        capabilityTitle: "Repositories",
                        systemImage: "chevron.left.forwardslash.chevron.right")),
            ],
            authorizations: [
                authorization(
                    connectorId: "github",
                    state: .notConnected,
                    health: .configMissing),
            ],
            apps: [
                appItem(
                    id: "connector:github",
                    title: "GitHub",
                    subtitle: "Repository and pull request workflows.",
                    status: .ready,
                    providerLabel: "GitHub",
                    connectorId: "github",
                    connectLabel: "Connect with GitHub"),
            ])

        let model = AppsSurfaceModel.build(from: response)
        let github = try #require(model.apps.first)

        #expect(github.status == .authError)
        #expect(github.capabilities.first?.status == .authError)
        #expect(github.detail == "This app needs setup on this Mac before it can connect.")
    }

    @Test
    func `models priority apps from canonical catalog surface and drops zombies`() throws {
        let response = providersResponse(
            catalog: [
                catalogItem(
                    id: "gmail-read",
                    title: "Gmail Read",
                    providerLabel: "Google",
                    connectLabel: "Connect with Google",
                    summary: "Read inbox state and messages.",
                    surface: surface(
                        groupId: "gmail",
                        groupTitle: "Gmail",
                        capabilityTitle: "Read",
                        sortOrder: 0,
                        systemImage: "envelope.badge",
                        groupSummary: "Email access split by real OAuth scopes.")),
                catalogItem(
                    id: "gmail-modify",
                    title: "Gmail Modify",
                    providerLabel: "Google",
                    connectLabel: "Connect with Google",
                    summary: "Label, archive, and organize Gmail messages.",
                    surface: surface(
                        groupId: "gmail",
                        groupTitle: "Gmail",
                        capabilityTitle: "Organize",
                        sortOrder: 1,
                        systemImage: "envelope.badge",
                        groupSummary: "Email access split by real OAuth scopes.")),
                catalogItem(
                    id: "gmail-send",
                    title: "Gmail Send",
                    providerLabel: "Google",
                    connectLabel: "Connect with Google",
                    summary: "Send outbound email.",
                    surface: surface(
                        groupId: "gmail",
                        groupTitle: "Gmail",
                        capabilityTitle: "Send",
                        sortOrder: 2,
                        systemImage: "envelope.badge",
                        groupSummary: "Email access split by real OAuth scopes.")),
                catalogItem(
                    id: "google-calendar",
                    title: "Google Calendar",
                    providerLabel: "Google",
                    connectLabel: "Connect with Google",
                    summary: "Read and schedule calendar events.",
                    surface: surface(
                        groupId: "google-calendar",
                        groupTitle: "Google Calendar",
                        capabilityTitle: "Calendar",
                        systemImage: "calendar")),
                catalogItem(
                    id: "github",
                    title: "GitHub",
                    providerLabel: "GitHub",
                    connectLabel: "Connect with GitHub",
                    summary: "Repository and pull request workflows.",
                    surface: surface(
                        groupId: "github",
                        groupTitle: "GitHub",
                        capabilityTitle: "Repositories",
                        systemImage: "chevron.left.forwardslash.chevron.right")),
                catalogItem(
                    id: "youtube",
                    title: "YouTube",
                    providerLabel: "Google",
                    connectLabel: "Connect with Google",
                    summary: "Channel, publishing, and metadata workflows.",
                    surface: surface(
                        groupId: "youtube",
                        groupTitle: "YouTube",
                        capabilityTitle: "Channel",
                        systemImage: "play.rectangle")),
                catalogItem(
                    id: "stripe",
                    title: "Stripe",
                    providerLabel: "Stripe",
                    connectLabel: "Connect with Stripe",
                    summary: "Finance and operations questions.",
                    surface: surface(
                        groupId: "stripe",
                        groupTitle: "Stripe",
                        capabilityTitle: "Finance",
                        systemImage: "creditcard")),
                catalogItem(
                    id: "legacy-without-surface",
                    title: "Legacy Without Surface",
                    providerLabel: "Legacy",
                    connectLabel: "Connect with Legacy",
                    summary: "Canonical connector missing native app surface metadata."),
            ],
            authorizations: [
                authorization(
                    connectorId: "gmail-read",
                    state: .connected,
                    health: .healthy,
                    connectedAccount: connectedAccount(label: "Work", email: "work@example.com")),
                authorization(
                    connectorId: "gmail-modify",
                    state: .needsReconnect,
                    health: .needsReconnect),
                authorization(
                    connectorId: "github",
                    state: .notConnected,
                    health: .configMissing),
                authorization(
                    connectorId: "youtube",
                    state: .connected,
                    health: .healthy,
                    connectedAccount: connectedAccount(label: "Creator", email: "creator@example.com")),
            ],
            apps: [
                appItem(
                    id: "connector:gmail-read",
                    title: "Gmail Read",
                    subtitle: "Read inbox state and messages.",
                    status: .connected,
                    providerLabel: "Google",
                    connectorId: "gmail-read",
                    connectLabel: "Connect with Google"),
                appItem(
                    id: "connector:gmail-modify",
                    title: "Gmail Modify",
                    subtitle: "Label, archive, and organize Gmail messages.",
                    status: .attention,
                    providerLabel: "Google",
                    connectorId: "gmail-modify",
                    connectLabel: "Connect with Google"),
                appItem(
                    id: "connector:gmail-send",
                    title: "Gmail Send",
                    subtitle: "Send outbound email.",
                    status: .ready,
                    providerLabel: "Google",
                    connectorId: "gmail-send",
                    connectLabel: "Connect with Google"),
                appItem(
                    id: "connector:google-calendar",
                    title: "Google Calendar",
                    subtitle: "Read and schedule calendar events.",
                    status: .ready,
                    providerLabel: "Google",
                    connectorId: "google-calendar",
                    connectLabel: "Connect with Google"),
                appItem(
                    id: "connector:github",
                    title: "GitHub",
                    subtitle: "Repository and pull request workflows.",
                    status: .attention,
                    providerLabel: "GitHub",
                    connectorId: "github",
                    connectLabel: "Connect with GitHub"),
                appItem(
                    id: "connector:youtube",
                    title: "YouTube",
                    subtitle: "Channel, publishing, and metadata workflows.",
                    status: .connected,
                    providerLabel: "Google",
                    connectorId: "youtube",
                    connectLabel: "Connect with Google"),
                appItem(
                    id: "connector:stripe",
                    title: "Stripe",
                    subtitle: "Finance and operations questions.",
                    status: .ready,
                    providerLabel: "Stripe",
                    connectorId: "stripe",
                    connectLabel: "Connect with Stripe"),
                appItem(
                    id: "connector:ghost",
                    title: "Ghost",
                    subtitle: "Missing from canonical catalog.",
                    status: .ready,
                    providerLabel: "Ghost",
                    connectorId: "ghost",
                    connectLabel: "Connect with Ghost"),
                appItem(
                    id: "connector:legacy-without-surface",
                    title: "Legacy Without Surface",
                    subtitle: "Canonical connector missing native app surface metadata.",
                    status: .ready,
                    providerLabel: "Legacy",
                    connectorId: "legacy-without-surface",
                    connectLabel: "Connect with Legacy"),
            ])

        let apps = AppsSurfaceModel.build(from: response).apps

        #expect(apps.map(\.id) == ["youtube", "gmail", "github", "google-calendar", "stripe"])
        #expect(apps.contains(where: { $0.id == "ghost" }) == false)
        #expect(apps.contains(where: { $0.id == "legacy-without-surface" }) == false)

        let gmail = try #require(apps.first(where: { $0.id == "gmail" }))
        #expect(gmail.capabilities.map(\.title) == ["Read", "Organize", "Send"])
        #expect(gmail.capabilities.map(\.status) == [.connected, .needsReconnect, .disconnected])
        #expect(gmail.capabilities.map(\.displayTitle) == ["Gmail Read", "Gmail Organize", "Gmail Send"])
        #expect(gmail.capabilities.map(\.status.label) == ["Connected", "Needs reconnect", "Disconnected"])
        #expect(gmail.capabilities.map(\.status.actionTitle) == ["Disconnect", "Reconnect", "Connect"])

        let youtube = try #require(apps.first(where: { $0.id == "youtube" }))
        #expect(youtube.status == .connected)
        #expect(youtube.primaryCapability?.displayTitle == "YouTube")
        #expect(youtube.primaryCapability?.status.label == "Connected")
        #expect(youtube.primaryCapability?.status.actionTitle == "Disconnect")

        let github = try #require(apps.first(where: { $0.id == "github" }))
        #expect(github.status == .authError)
        #expect(github.primaryCapability?.status.label == "Auth error")
        #expect(github.primaryCapability?.status.actionTitle == "Open setup guide")
        #expect(github.detail == "This app needs setup on this Mac before it can connect.")

        let calendar = try #require(apps.first(where: { $0.id == "google-calendar" }))
        #expect(calendar.status == .disconnected)
        #expect(calendar.primaryCapability?.displayTitle == "Google Calendar")
        #expect(calendar.primaryCapability?.status.actionTitle == "Connect")

        let stripe = try #require(apps.first(where: { $0.id == "stripe" }))
        #expect(stripe.status == .disconnected)
        #expect(stripe.systemImage == "creditcard")
        #expect(stripe.primaryCapability?.status.label == "Disconnected")
    }

    @Test
    func `keeps Gmail grouped while reporting multiple connected accounts`() throws {
        let response = providersResponse(
            catalog: [
                catalogItem(
                    id: "gmail-read",
                    title: "Gmail Read",
                    providerLabel: "Google",
                    connectLabel: "Connect with Google",
                    summary: "Read inbox state and messages.",
                    surface: surface(
                        groupId: "gmail",
                        groupTitle: "Gmail",
                        capabilityTitle: "Read",
                        sortOrder: 0,
                        systemImage: "envelope.badge",
                        groupSummary: "Email access split by real OAuth scopes.")),
                catalogItem(
                    id: "gmail-send",
                    title: "Gmail Send",
                    providerLabel: "Google",
                    connectLabel: "Connect with Google",
                    summary: "Send outbound email.",
                    surface: surface(
                        groupId: "gmail",
                        groupTitle: "Gmail",
                        capabilityTitle: "Send",
                        sortOrder: 2,
                        systemImage: "envelope.badge",
                        groupSummary: "Email access split by real OAuth scopes.")),
            ],
            authorizations: [
                authorization(
                    connectorId: "gmail-read",
                    state: .connected,
                    health: .healthy,
                    connectedAccount: connectedAccount(label: "Work", email: "work@example.com")),
                authorization(
                    connectorId: "gmail-send",
                    state: .connected,
                    health: .healthy,
                    connectedAccount: connectedAccount(label: "Personal", email: "me@example.com")),
            ],
            apps: [
                appItem(
                    id: "connector:gmail-read",
                    title: "Gmail Read",
                    subtitle: "Read inbox state and messages.",
                    status: .connected,
                    providerLabel: "Google",
                    connectorId: "gmail-read",
                    connectLabel: "Connect with Google"),
                appItem(
                    id: "connector:gmail-send",
                    title: "Gmail Send",
                    subtitle: "Send outbound email.",
                    status: .connected,
                    providerLabel: "Google",
                    connectorId: "gmail-send",
                    connectLabel: "Connect with Google"),
            ])

        let gmail = try #require(AppsSurfaceModel.build(from: response).apps.first)

        #expect(gmail.id == "gmail")
        #expect(gmail.status == .connected)
        #expect(gmail.accountLabel == "Multiple accounts")
        #expect(gmail.accountEmail == nil)
    }

    @Test
    @MainActor
    func `refresh loads apps through gateway client`() async throws {
        let gateway = RecordingAppsGatewayClient(overviews: [
            githubResponse(state: .notConnected, health: .healthy, itemStatus: .ready),
        ])
        let store = AppsSettingsStore(isPreview: true, gateway: gateway, openURL: { _ in })

        await store.refresh()

        let calls = await gateway.calls()
        #expect(calls.fetches == 1)
        #expect(calls.begun == [])
        #expect(calls.revoked == [])
        #expect(store.apps.map(\.title) == ["GitHub"])
        #expect(store.apps.first?.status == .disconnected)
        #expect(store.lastError == nil)
    }

    @Test
    @MainActor
    func `connect action starts OAuth and refreshes status`() async throws {
        let gateway = RecordingAppsGatewayClient(
            overviews: [
                githubResponse(state: .notConnected, health: .healthy, itemStatus: .ready),
                githubResponse(state: .connected, health: .healthy, itemStatus: .connected),
            ],
            beginResult: GatewayConnectorBeginResult(
                connectorId: "github",
                mode: .oauth,
                statusReason: .readyForOAuth,
                setupUrl: "https://auth.example/github",
                setupHint: nil))
        var opened: [URL] = []
        let store = AppsSettingsStore(
            isPreview: true,
            gateway: gateway,
            openURL: { opened.append($0) })

        await store.refresh()
        let capability = try #require(store.apps.first?.primaryCapability)
        await store.performAction(for: capability)

        let calls = await gateway.calls()
        #expect(calls.fetches == 2)
        #expect(calls.begun == ["github"])
        #expect(calls.revoked == [])
        #expect(opened.map(\.absoluteString) == ["https://auth.example/github"])
        #expect(store.apps.first?.status == .connected)
        #expect(store.statusMessage == "GitHub connected.")
    }

    @Test
    @MainActor
    func `disconnect action revokes authorization and refreshes status`() async throws {
        let gateway = RecordingAppsGatewayClient(overviews: [
            githubResponse(state: .connected, health: .healthy, itemStatus: .connected),
            githubResponse(state: .notConnected, health: .healthy, itemStatus: .ready),
        ])
        let store = AppsSettingsStore(isPreview: true, gateway: gateway, openURL: { _ in })

        await store.refresh()
        let capability = try #require(store.apps.first?.primaryCapability)
        await store.performAction(for: capability)

        let calls = await gateway.calls()
        #expect(calls.fetches == 2)
        #expect(calls.begun == [])
        #expect(calls.revoked == ["github"])
        #expect(store.apps.first?.status == .disconnected)
        #expect(store.statusMessage == "GitHub disconnected.")
    }

    @Test
    @MainActor
    func `auth error action opens setup guide and keeps auth state honest`() async throws {
        let gateway = RecordingAppsGatewayClient(
            overviews: [
                githubResponse(state: .notConnected, health: .configMissing, itemStatus: .ready),
                githubResponse(state: .notConnected, health: .configMissing, itemStatus: .ready),
            ],
            beginResult: GatewayConnectorBeginResult(
                connectorId: "github",
                mode: .setup,
                statusReason: .missingClientConfig,
                setupUrl: "https://docs.example/github-setup",
                setupHint: "Set up GitHub on this Mac before you connect it."))
        var opened: [URL] = []
        let store = AppsSettingsStore(
            isPreview: true,
            gateway: gateway,
            openURL: { opened.append($0) })

        await store.refresh()
        let capability = try #require(store.apps.first?.primaryCapability)
        await store.performAction(for: capability)

        let calls = await gateway.calls()
        #expect(calls.fetches == 2)
        #expect(calls.begun == ["github"])
        #expect(calls.revoked == [])
        #expect(opened.map(\.absoluteString) == ["https://docs.example/github-setup"])
        #expect(store.apps.first?.status == .authError)
        #expect(store.statusMessage == "Set up GitHub on this Mac before you connect it.")
        #expect(store.lastError == nil)
    }

    @Test
    @MainActor
    func `refresh maps account requirement to product copy`() async throws {
        let gateway = RecordingAppsGatewayClient(
            overviews: [],
            fetchError: GatewayResponseError(
                method: "alisio.providers.get",
                code: "INVALID_REQUEST",
                message: "Alisio account sign-in required before using shared backend features.",
                details: nil))
        let store = AppsSettingsStore(isPreview: true, gateway: gateway, openURL: { _ in })

        await store.refresh()

        #expect(store.apps.isEmpty)
        #expect(store.lastError == "Sign in to your Alisio account before managing apps.")
    }
}

private actor RecordingAppsGatewayClient: AppsGatewayClient {
    private enum Failure: Error {
        case missingOverview
    }

    private var overviews: [GatewayProvidersAppsResponse]
    private let beginResult: GatewayConnectorBeginResult
    private let fetchError: Error?
    private var fetches = 0
    private var begun: [String] = []
    private var revoked: [String] = []

    init(
        overviews: [GatewayProvidersAppsResponse],
        fetchError: Error? = nil,
        beginResult: GatewayConnectorBeginResult = GatewayConnectorBeginResult(
            connectorId: "github",
            mode: .oauth,
            statusReason: .readyForOAuth,
            setupUrl: "https://auth.example/github",
            setupHint: nil))
    {
        self.overviews = overviews
        self.fetchError = fetchError
        self.beginResult = beginResult
    }

    func fetchAppsOverview(timeoutMs _: Double) async throws -> GatewayProvidersAppsResponse {
        self.fetches += 1
        if let fetchError {
            throw fetchError
        }
        guard !self.overviews.isEmpty else {
            throw Failure.missingOverview
        }
        return self.overviews.removeFirst()
    }

    func beginAppConnection(appID: String, timeoutMs _: Double) async throws -> GatewayConnectorBeginResult {
        self.begun.append(appID)
        return self.beginResult
    }

    func revokeAppConnection(appID: String, timeoutMs _: Double) async throws {
        self.revoked.append(appID)
    }

    func calls() -> (fetches: Int, begun: [String], revoked: [String]) {
        (self.fetches, self.begun, self.revoked)
    }
}

private func githubResponse(
    state: GatewayConnectorAuthorizationState,
    health: GatewayConnectorAuthorizationHealth,
    itemStatus: GatewayAppItemStatus) -> GatewayProvidersAppsResponse
{
    providersResponse(
        catalog: [
            catalogItem(
                id: "github",
                title: "GitHub",
                providerLabel: "GitHub",
                connectLabel: "Connect with GitHub",
                summary: "Repository and pull request workflows.",
                surface: surface(
                    groupId: "github",
                    groupTitle: "GitHub",
                    capabilityTitle: "Repositories",
                    systemImage: "chevron.left.forwardslash.chevron.right")),
        ],
        authorizations: [
            authorization(
                connectorId: "github",
                state: state,
                health: health,
                connectedAccount: state == .connected
                    ? connectedAccount(label: "Nuno", email: "nuno@example.com")
                    : nil),
        ],
        apps: [
            appItem(
                id: "connector:github",
                title: "GitHub",
                subtitle: "Repository and pull request workflows.",
                status: itemStatus,
                providerLabel: "GitHub",
                connectorId: "github",
                connectLabel: "Connect with GitHub"),
        ])
}

private func providersResponse(
    catalog: [GatewayConnectorCatalogItem],
    authorizations: [GatewayConnectorAuthorization],
    apps: [GatewayAppItem]) -> GatewayProvidersAppsResponse
{
    GatewayProvidersAppsResponse(
        generatedAt: "2026-04-22T10:00:00Z",
        connectors: .init(catalog: catalog, authorizations: authorizations),
        apps: apps)
}

private func catalogItem(
    id: String,
    title: String,
    providerLabel: String,
    connectLabel: String,
    summary: String,
    detail: String? = nil,
    setupUrl: String? = "https://example.com/setup",
    surface: GatewayConnectorSurface? = nil) -> GatewayConnectorCatalogItem
{
    GatewayConnectorCatalogItem(
        id: id,
        title: title,
        providerLabel: providerLabel,
        connectLabel: connectLabel,
        summary: summary,
        detail: detail,
        setupUrl: setupUrl,
        surface: surface)
}

private func surface(
    groupId: String,
    groupTitle: String,
    capabilityTitle: String,
    sortOrder: Int = 0,
    systemImage: String = "link",
    groupSummary: String? = nil) -> GatewayConnectorSurface
{
    GatewayConnectorSurface(
        groupId: groupId,
        groupTitle: groupTitle,
        capabilityTitle: capabilityTitle,
        sortOrder: sortOrder,
        systemImage: systemImage,
        groupSummary: groupSummary)
}

private func authorization(
    connectorId: String,
    state: GatewayConnectorAuthorizationState,
    health: GatewayConnectorAuthorizationHealth,
    connectedAt: String? = "2026-04-22T09:58:00Z",
    connectedAccount: GatewayConnectedAccount? = nil) -> GatewayConnectorAuthorization
{
    GatewayConnectorAuthorization(
        connectorId: connectorId,
        state: state,
        health: health,
        connectedAt: state == .connected ? connectedAt : nil,
        connectedAccount: connectedAccount)
}

private func connectedAccount(label: String, email: String?) -> GatewayConnectedAccount {
    GatewayConnectedAccount(label: label, email: email, handle: nil)
}

private func appItem(
    id: String,
    title: String,
    subtitle: String,
    status: GatewayAppItemStatus,
    providerLabel: String,
    connectorId: String?,
    connectLabel: String?) -> GatewayAppItem
{
    GatewayAppItem(
        id: id,
        title: title,
        subtitle: subtitle,
        detail: nil,
        status: status,
        providerLabel: providerLabel,
        connectorId: connectorId,
        connectLabel: connectLabel,
        accountLabel: nil,
        accountEmail: nil,
        docsPath: nil,
        chips: [],
        active: status == .connected)
}
