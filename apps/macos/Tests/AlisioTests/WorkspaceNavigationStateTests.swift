import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct WorkspaceNavigationStateTests {
    @Test func `chat route stores a non empty session key`() {
        let state = WorkspaceNavigationState()
        state.showChat(sessionKey: "  team/main  ")

        #expect(state.route == .chat)
        #expect(state.activeSessionKey == "team/main")
    }

    @Test func `chat route ignores blank session keys`() {
        let state = WorkspaceNavigationState()
        state.showChat(sessionKey: "main")
        state.showChat(sessionKey: "   ")

        #expect(state.route == .chat)
        #expect(state.activeSessionKey == "main")
    }

    @Test func `workspace starts on the native chat route`() {
        let state = WorkspaceNavigationState()

        #expect(state.route == .chat)
    }

    @Test func `workspace routes expose the canonical shell tabs`() {
        #expect(WorkspaceNavigationState.Route.allCases.map(\.rawValue) == [
            "chat",
            "apps",
            "schedules",
            "capabilities",
            "connections",
            "settings",
        ])
    }

    @Test func `workspace routes expose final tab labels`() {
        #expect(WorkspaceNavigationState.Route.schedules.workspaceTitle == "Schedules")
        #expect(WorkspaceNavigationState.Route.capabilities.workspaceTitle == "Capabilities")
    }

    @Test func `settings route is a single native launcher surface`() {
        let state = WorkspaceNavigationState()

        state.showSettings()
        #expect(state.route == .settings)
    }
}
