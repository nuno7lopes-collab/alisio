import Testing
@testable import Alisio

struct AppsSurfaceModelTests {
    @Test
    func `filters unreleased connectors and groups Gmail access levels`() throws {
        let response = GatewayProvidersAppsResponse(
            generatedAt: "2026-04-22T10:00:00Z",
            connectors: .init(
                catalog: [
                    GatewayConnectorCatalogItem(
                        id: "gmail-read",
                        title: "Gmail Read",
                        providerLabel: "Google",
                        connectLabel: "Connect with Google",
                        summary: "Read inbox state and messages.",
                        detail: nil,
                        setupUrl: "https://example.com/gmail"),
                    GatewayConnectorCatalogItem(
                        id: "gmail-send",
                        title: "Gmail Send",
                        providerLabel: "Google",
                        connectLabel: "Connect with Google",
                        summary: "Send outbound email.",
                        detail: nil,
                        setupUrl: "https://example.com/gmail"),
                    GatewayConnectorCatalogItem(
                        id: "github",
                        title: "GitHub",
                        providerLabel: "GitHub",
                        connectLabel: "Connect with GitHub",
                        summary: "Repository and pull request workflows.",
                        detail: nil,
                        setupUrl: "https://example.com/github"),
                    GatewayConnectorCatalogItem(
                        id: "notion",
                        title: "Notion",
                        providerLabel: "Notion",
                        connectLabel: "Connect with Notion",
                        summary: "In review",
                        detail: nil,
                        setupUrl: "https://example.com/notion"),
                ],
                authorizations: [
                    GatewayConnectorAuthorization(
                        connectorId: "gmail-read",
                        state: .connected,
                        health: .healthy,
                        connectedAt: "2026-04-22T09:58:00Z",
                        connectedAccount: GatewayConnectedAccount(
                            label: "Nuno",
                            email: "nuno@example.com",
                            handle: nil)),
                ]),
            apps: [
                GatewayAppItem(
                    id: "connector:gmail-read",
                    title: "Gmail Read",
                    subtitle: "Read inbox state and messages.",
                    detail: nil,
                    status: .connected,
                    providerLabel: "Google",
                    connectorId: "gmail-read",
                    connectLabel: "Connect with Google",
                    accountLabel: nil,
                    accountEmail: nil,
                    docsPath: nil,
                    chips: [],
                    active: true),
                GatewayAppItem(
                    id: "connector:gmail-send",
                    title: "Gmail Send",
                    subtitle: "Send outbound email.",
                    detail: nil,
                    status: .ready,
                    providerLabel: "Google",
                    connectorId: "gmail-send",
                    connectLabel: "Connect with Google",
                    accountLabel: nil,
                    accountEmail: nil,
                    docsPath: nil,
                    chips: [],
                    active: false),
                GatewayAppItem(
                    id: "connector:github",
                    title: "GitHub",
                    subtitle: "Repository and pull request workflows.",
                    detail: nil,
                    status: .ready,
                    providerLabel: "GitHub",
                    connectorId: "github",
                    connectLabel: "Connect with GitHub",
                    accountLabel: nil,
                    accountEmail: nil,
                    docsPath: nil,
                    chips: [],
                    active: false),
                GatewayAppItem(
                    id: "connector:notion",
                    title: "Notion",
                    subtitle: "In review",
                    detail: nil,
                    status: .comingSoon,
                    providerLabel: "Notion",
                    connectorId: "notion",
                    connectLabel: "Connect with Notion",
                    accountLabel: nil,
                    accountEmail: nil,
                    docsPath: nil,
                    chips: [],
                    active: false),
            ])

        let model = AppsSurfaceModel.build(from: response)

        #expect(model.apps.count == 2)
        #expect(model.apps.map(\.title) == ["Gmail", "GitHub"])

        let gmail = try #require(model.apps.first(where: { $0.id == "gmail" }))
        #expect(gmail.status == .attention)
        #expect(gmail.capabilities.map(\.title) == ["Read", "Send"])
        #expect(gmail.capabilities.map(\.status) == [.connected, .ready])
        #expect(gmail.detail == "1 of 2 access levels are connected.")
    }

    @Test
    func `surfaces setup required state without pretending the app is connected`() throws {
        let response = GatewayProvidersAppsResponse(
            generatedAt: "2026-04-22T10:00:00Z",
            connectors: .init(
                catalog: [
                    GatewayConnectorCatalogItem(
                        id: "github",
                        title: "GitHub",
                        providerLabel: "GitHub",
                        connectLabel: "Connect with GitHub",
                        summary: "Repository and pull request workflows.",
                        detail: nil,
                        setupUrl: "https://example.com/github"),
                ],
                authorizations: [
                    GatewayConnectorAuthorization(
                        connectorId: "github",
                        state: .notConnected,
                        health: .configMissing,
                        connectedAt: nil,
                        connectedAccount: nil),
                ]),
            apps: [
                GatewayAppItem(
                    id: "connector:github",
                    title: "GitHub",
                    subtitle: "Repository and pull request workflows.",
                    detail: nil,
                    status: .attention,
                    providerLabel: "GitHub",
                    connectorId: "github",
                    connectLabel: "Connect with GitHub",
                    accountLabel: nil,
                    accountEmail: nil,
                    docsPath: nil,
                    chips: [],
                    active: false),
            ])

        let model = AppsSurfaceModel.build(from: response)
        let github = try #require(model.apps.first)

        #expect(github.status == .attention)
        #expect(github.capabilities.first?.status == .setupRequired)
        #expect(github.detail == "This app needs setup or reconnecting before it can be used.")
    }
}
