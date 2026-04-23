import Testing
@testable import Alisio

@Suite(.serialized)
struct SessionMenuPreviewViewTests {
    @Test func `preview cache normalizes canonical main aliases`() async {
        await SessionPreviewCache.shared._testReset()

        let snapshot = SessionMenuPreviewSnapshot(
            items: [SessionPreviewItem(id: "1", role: .assistant, text: "hello")],
            status: .ready)

        await SessionPreviewCache.shared._testSet(
            snapshot: snapshot,
            for: "agent:main:main",
            mainSessionKey: "agent:main:main")

        let cached = await SessionPreviewCache.shared.cachedSnapshot(
            for: "main",
            mainSessionKey: "agent:main:main",
            maxAge: 60)

        #expect(cached?.items.first?.text == "hello")
        #expect(cached?.status == .ready)
    }
}
