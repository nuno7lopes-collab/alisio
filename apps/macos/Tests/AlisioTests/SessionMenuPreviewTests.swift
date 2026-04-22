import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
struct SessionMenuPreviewTests {
    @Test @MainActor func `loader reports sign in required when signed out`() async {
        await TestIsolation.withSignedOutAccount {
            await SessionPreviewCache.shared._testReset()

            let loaded = await SessionMenuPreviewLoader.load(sessionKey: "main", maxItems: 10)

            #expect(loaded.items.isEmpty)
            #expect(loaded.status == .error("Sign in required"))
        }
    }

    @Test @MainActor func `loader returns cached items`() async {
        await TestIsolation.withSignedInAccount {
            await SessionPreviewCache.shared._testReset()
            let items = [SessionPreviewItem(id: "1", role: .user, text: "Hi")]
            let snapshot = SessionMenuPreviewSnapshot(items: items, status: .ready)
            await SessionPreviewCache.shared._testSet(snapshot: snapshot, for: "main")

            let loaded = await SessionMenuPreviewLoader.load(sessionKey: "main", maxItems: 10)
            #expect(loaded.status == .ready)
            #expect(loaded.items.count == 1)
            #expect(loaded.items.first?.text == "Hi")
        }
    }

    @Test @MainActor func `loader returns empty when cached empty`() async {
        await TestIsolation.withSignedInAccount {
            await SessionPreviewCache.shared._testReset()
            let snapshot = SessionMenuPreviewSnapshot(items: [], status: .empty)
            await SessionPreviewCache.shared._testSet(snapshot: snapshot, for: "main")

            let loaded = await SessionMenuPreviewLoader.load(sessionKey: "main", maxItems: 10)
            #expect(loaded.status == .empty)
            #expect(loaded.items.isEmpty)
        }
    }
}
