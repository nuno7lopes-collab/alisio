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
}
