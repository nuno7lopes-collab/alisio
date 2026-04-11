import AppKit
import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct AlisioWorkspaceWindowSmokeTests {
    @Test func `window controller show and close`() {
        let controller = AlisioWorkspaceWindowController(presentation: .window)
        let shellState = AlisioShellState()
        shellState.show(route: .chat)
        controller.show(shellState: shellState, state: AppState(preview: true))
        controller.close()
    }

    @Test func `panel controller present and close`() {
        let anchor = { NSRect(x: 200, y: 400, width: 40, height: 40) }
        let controller = AlisioWorkspaceWindowController(presentation: .panel(anchorProvider: anchor))
        let shellState = AlisioShellState()
        shellState.showChat(sessionKey: "main")
        controller.show(shellState: shellState, state: AppState(preview: true))
        controller.close()
    }
}
