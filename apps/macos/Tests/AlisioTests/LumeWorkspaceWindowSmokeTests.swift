import AppKit
import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct LumeWorkspaceWindowSmokeTests {
    @Test func `window controller show and close`() {
        let controller = LumeWorkspaceWindowController(presentation: .window)
        let shellState = LumeShellState()
        shellState.show(route: .chat)
        controller.show(shellState: shellState, state: AppState(preview: true))
        controller.close()
    }

    @Test func `panel controller present and close`() {
        let anchor = { NSRect(x: 200, y: 400, width: 40, height: 40) }
        let controller = LumeWorkspaceWindowController(presentation: .panel(anchorProvider: anchor))
        let shellState = LumeShellState()
        shellState.showChat(sessionKey: "main")
        controller.show(shellState: shellState, state: AppState(preview: true))
        controller.close()
    }
}
