import AppKit
import Foundation
import Testing
import WebKit
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct AlisioWorkspaceWindowSmokeTests {
    @Test func `window controller show and close`() async {
        await TestIsolation.withAccountStore(snapshot: Self.authenticatedSnapshot()) {
            let controller = AlisioWorkspaceWindowController(presentation: .window)
            let rootState = AlisioAppRootState()
            let navigationState = WorkspaceNavigationState()
            navigationState.show(route: .chat)
            let appState = Self.readyLocalAppState()
            controller.show(rootState: rootState, navigationState: navigationState, state: appState)
            let contentView = try? #require(controller.window?.contentViewController?.view)
            #expect(contentView != nil)
            if let contentView {
                #expect(Self.containsWKWebView(in: contentView) == false)
            }
            controller.close()
            #expect(controller.window?.isVisible == false)
        }
    }

    @Test func `window close button hides the workspace instead of destroying it`() async throws {
        try await TestIsolation.withAccountStore(snapshot: Self.authenticatedSnapshot()) {
            let controller = AlisioWorkspaceWindowController(presentation: .window)
            let rootState = AlisioAppRootState()
            let navigationState = WorkspaceNavigationState()
            let appState = Self.readyLocalAppState()

            controller.show(rootState: rootState, navigationState: navigationState, state: appState)

            let window = try #require(controller.window)
            #expect(controller.windowShouldClose(window) == false)
            #expect(window.isVisible == false)
            #expect(window.contentViewController != nil)
        }
    }

    @Test func `panel controller present and close`() async {
        await TestIsolation.withAccountStore(snapshot: Self.authenticatedSnapshot()) {
            let anchor = { NSRect(x: 200, y: 400, width: 40, height: 40) }
            let controller = AlisioWorkspaceWindowController(presentation: .panel(anchorProvider: anchor))
            let rootState = AlisioAppRootState()
            let navigationState = WorkspaceNavigationState()
            navigationState.showChat(sessionKey: "main")
            let appState = Self.readyLocalAppState()
            controller.show(rootState: rootState, navigationState: navigationState, state: appState)
            let contentView = try? #require(controller.window?.contentViewController?.view)
            #expect(contentView != nil)
            if let contentView {
                #expect(Self.containsWKWebView(in: contentView) == false)
            }
            controller.close()
            #expect(controller.window?.isVisible == false)
        }
    }

    private static func containsWKWebView(in view: NSView) -> Bool {
        if view is WKWebView {
            return true
        }
        return view.subviews.contains { containsWKWebView(in: $0) }
    }

    private static func readyLocalAppState() -> AppState {
        let state = AppState(preview: true)
        state.connectionMode = .local
        state.runtimeReadinessOverride = AppRuntimeReadinessSnapshot(
            gatewayStatus: GatewayEnvironmentStatus(
                kind: .ok,
                nodeVersion: "22.16.0",
                gatewayVersion: "2026.4.22",
                requiredGateway: "2026.4.22",
                message: "Node 22.16.0; gateway 2026.4.22 (global CLI)"),
            remoteProbeResult: nil)
        return state
    }

    private static func authenticatedSnapshot() -> AlisioAccountSnapshot {
        AlisioAccountSnapshot(
            accountId: "acct-test",
            canonical: .init(authenticated: true, accountId: "acct-test", source: .accountId),
            profile: .init(userId: "user-test", username: "nuno", displayName: "Nuno", email: "nuno@example.com"),
            session: .init(state: .signedIn, authenticated: true, accountId: "acct-test", authMethod: nil),
            devices: [],
            deviceBinding: nil)
    }
}
