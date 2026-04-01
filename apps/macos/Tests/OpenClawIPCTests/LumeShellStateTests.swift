import Testing
@testable import OpenClaw

@Suite(.serialized)
@MainActor
struct LumeShellStateTests {
    @Test func `chat route encodes session key in workspace path`() {
        let state = LumeShellState()
        state.completeOnboarding(preferredSessionKey: "team/main")
        state.showChat(sessionKey: "team/main")

        #expect(state.route == .chat)
        #expect(state.workspacePath() == "/chat?session=team/main")
    }

    @Test func `settings tabs map to canonical workspace routes`() {
        let state = LumeShellState()
        state.completeOnboarding()

        state.showSettings(tab: .skills)
        #expect(state.route == .settings)
        #expect(state.settingsSection == .aiAgents)
        #expect(state.workspacePath() == "/settings?section=aiAgents")

        state.showSettings(tab: .cron)
        #expect(state.route == .automations)
        #expect(state.workspacePath() == "/automations")
    }
}
