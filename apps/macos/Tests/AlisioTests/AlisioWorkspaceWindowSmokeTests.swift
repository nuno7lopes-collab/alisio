import AppKit
import Foundation
import Testing
import WebKit
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct AlisioWorkspaceWindowSmokeTests {
    @Test func `window controller show and close`() {
        let controller = AlisioWorkspaceWindowController(presentation: .window)
        let navigationState = WorkspaceNavigationState()
        navigationState.show(route: .chat)
        controller.show(navigationState: navigationState, state: AppState(preview: true))
        let contentView = try? #require(controller.window?.contentViewController?.view)
        #expect(contentView != nil)
        if let contentView {
            #expect(Self.containsWKWebView(in: contentView) == false)
        }
        controller.close()
    }

    @Test func `panel controller present and close`() {
        let anchor = { NSRect(x: 200, y: 400, width: 40, height: 40) }
        let controller = AlisioWorkspaceWindowController(presentation: .panel(anchorProvider: anchor))
        let navigationState = WorkspaceNavigationState()
        navigationState.showChat(sessionKey: "main")
        controller.show(navigationState: navigationState, state: AppState(preview: true))
        let contentView = try? #require(controller.window?.contentViewController?.view)
        #expect(contentView != nil)
        if let contentView {
            #expect(Self.containsWKWebView(in: contentView) == false)
        }
        controller.close()
    }

    private static func containsWKWebView(in view: NSView) -> Bool {
        if view is WKWebView {
            return true
        }
        return view.subviews.contains { containsWKWebView(in: $0) }
    }
}
