import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct LumeShellStateTests {
    @Test func `chat route encodes session key in workspace path`() {
        let state = LumeShellState()
        state.showChat(sessionKey: "team/main")

        #expect(state.route == .chat)
        #expect(state.workspacePath() == "/chat?session=team/main")
    }

    @Test func `shell starts on chat route`() {
        let state = LumeShellState()

        #expect(state.route == .chat)
        #expect(state.workspacePath() == "/chat")
        #expect(state.requiresOnboarding == false)
    }

    @Test func `onboarding route resolves to setup workspace path`() {
        let state = LumeShellState()
        state.show(route: .onboarding)

        #expect(state.workspacePath() == "/setup")
    }

    @Test func `settings tabs map to canonical workspace routes`() {
        let state = LumeShellState()

        state.showSettings(tab: .skills)
        #expect(state.route == .settings)
        #expect(state.settingsSection == .aiAgents)
        #expect(state.workspacePath() == "/settings?section=aiAgents")

        state.showSettings(tab: .cron)
        #expect(state.route == .automations)
        #expect(state.workspacePath() == "/automations")
    }
}
