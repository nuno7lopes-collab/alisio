import Testing
@testable import OpenClaw

@Suite(.serialized)
@MainActor
struct LumeWorkspaceManagerTests {
    @Test func `preferred session key is non empty`() async {
        let key = await LumeWorkspaceManager.shared.preferredSessionKey()
        #expect(!key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
}
