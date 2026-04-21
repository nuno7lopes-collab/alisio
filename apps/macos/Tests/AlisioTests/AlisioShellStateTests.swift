import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct AlisioShellStateTests {
    @Test func `chat route encodes session key in workspace path`() {
        let state = AlisioShellState()
        state.showChat(sessionKey: "team/main")

        #expect(state.route == .chat)
        #expect(state.workspacePath() == "/chat?session=team/main")
    }

    @Test func `shell starts on chat route`() {
        let state = AlisioShellState()

        #expect(state.route == .chat)
        #expect(state.workspacePath() == "/chat")
        #expect(state.requiresOnboarding == false)
    }

    @Test func `onboarding route resolves to setup workspace path`() {
        let state = AlisioShellState()
        state.show(route: .onboarding)

        #expect(state.workspacePath() == "/setup")
    }

    @Test func `settings tabs map to canonical workspace routes`() {
        let state = AlisioShellState()

        state.showSettings(tab: .skills)
        #expect(state.route == .agents)
        #expect(state.workspacePath() == "/capabilities")

        state.showSettings(tab: .cron)
        #expect(state.route == .automations)
        #expect(state.workspacePath() == "/cron")

        state.showSettings(tab: .channels)
        #expect(state.route == .authentications)
        #expect(state.workspacePath() == "/authentications")

        state.showSettings(tab: .instances)
        #expect(state.route == .organization)
        #expect(state.workspacePath() == "/connections")

        state.showSettings(tab: .permissions)
        #expect(state.route == .settings)
        #expect(state.workspacePath() == "/settings?section=mac")

        state.showSettings(tab: .sessions)
        #expect(state.route == .chat)
        #expect(state.workspacePath() == "/chat")
    }
}
