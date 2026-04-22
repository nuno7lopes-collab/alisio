import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct AlisioWorkspaceManagerTests {
    @Test func `preferred session key is non empty`() async {
        let key = await AlisioWorkspaceManager.shared.preferredSessionKey()
        #expect(!key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    @Test func `root state can switch between entry flow and workspace`() {
        let state = AlisioAppRootState()
        #expect(state.prefersEntryFlow == false)

        state.showEntryFlow()
        #expect(state.prefersEntryFlow)

        state.showWorkspace()
        #expect(state.prefersEntryFlow == false)
    }
}
