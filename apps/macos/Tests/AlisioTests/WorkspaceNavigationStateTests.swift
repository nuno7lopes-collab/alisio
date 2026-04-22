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
        #expect(state.settingsSection == .workspace)
    }

    @Test func `workspace routes no longer expose onboarding`() {
        #expect(WorkspaceNavigationState.Route.allCases.map(\.rawValue).contains("onboarding") == false)
    }

    @Test func `settings tabs map to native workspace sections`() {
        let state = WorkspaceNavigationState()

        state.showSettings(tab: .skills)
        #expect(state.route == .agents)

        state.showSettings(tab: .cron)
        #expect(state.route == .automations)

        state.showSettings(tab: .channels)
        #expect(state.route == .authentications)

        state.showSettings(tab: .instances)
        #expect(state.route == .organization)

        state.showSettings(tab: .permissions)
        #expect(state.route == .settings)
        #expect(state.settingsSection == .mac)

        state.showSettings(tab: .sessions)
        #expect(state.route == .chat)

        state.showSettings(tab: .debug)
        #expect(state.route == .settings)
        #expect(state.settingsSection == .debug)
    }
}
