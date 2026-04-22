import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct SettingsWindowOpenerTests {
    @Test func `settings opener shows a reusable window on the requested tab`() {
        let state = AppState(preview: true)
        state.debugPaneEnabled = true
        let opener = SettingsWindowOpener(
            stateProvider: { state },
            updaterProvider: { nil })

        opener.open(tab: .permissions)
        #expect(opener.isVisible)
        #expect(opener.selectedTab == .permissions)

        opener.open(tab: .about)
        #expect(opener.isVisible)
        #expect(opener.selectedTab == .about)

        opener.close()
    }

    @Test func `settings opener falls back to general when debug tools are disabled`() {
        let state = AppState(preview: true)
        state.debugPaneEnabled = false
        let opener = SettingsWindowOpener(
            stateProvider: { state },
            updaterProvider: { nil })

        opener.open(tab: .debug)

        #expect(opener.selectedTab == .general)

        opener.close()
    }
}
