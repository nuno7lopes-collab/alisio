import Foundation
import Testing
import AlisioSupport
@testable import Alisio

struct HealthStoreStateTests {
    private func makeSnapshot(
        channels: [String: HealthSnapshot.ChannelSummary],
        channelOrder: [String],
        channelLabels: [String: String]) -> HealthSnapshot
    {
        HealthSnapshot(
            ok: true,
            ts: 0,
            durationMs: 1,
            channels: channels,
            channelOrder: channelOrder,
            channelLabels: channelLabels,
            heartbeatSeconds: 60,
            sessions: .init(path: "/tmp/sessions.json", count: 0, recent: []))
    }

    @Test @MainActor func `linked channel probe failure degrades state`() {
        let snap = self.makeSnapshot(
            channels: [
                "whatsapp": .init(
                    configured: true,
                    linked: true,
                    authAgeMs: 1,
                    probe: .init(
                        ok: false,
                        status: 503,
                        error: "gateway connect failed",
                        elapsedMs: 12,
                        bot: nil,
                        webhook: nil),
                    lastProbeAt: 0),
            ],
            channelOrder: ["whatsapp"],
            channelLabels: ["whatsapp": "WhatsApp"])

        let store = HealthStore(autoStart: false)
        store.__setSnapshotForTest(snap, lastError: nil)

        switch store.state {
        case let .degraded(message):
            #expect(!message.isEmpty)
        default:
            Issue.record("Expected degraded state when probe fails for linked channel")
        }

        #expect(store.summaryLine == "WhatsApp needs attention")
        #expect(store.detailLine == "The linked service is unavailable right now.")
    }

    @Test @MainActor func `health copy stays product level for transport failures`() {
        let store = HealthStore(autoStart: false)
        store.__setSnapshotForTest(nil, lastError: "Connection refused")

        #expect(store.summaryLine == "Runtime unavailable")
        #expect(store.detailLine == "Alisio could not reach the runtime. Open Alisio again or wait for it to finish starting.")
    }

    @Test @MainActor func `healthy fallback does not pretend linking is complete`() {
        let snap = self.makeSnapshot(
            channels: [
                "whatsapp": .init(
                    configured: true,
                    linked: false,
                    authAgeMs: nil,
                    probe: nil,
                    lastProbeAt: 0),
                "telegram": .init(
                    configured: true,
                    linked: nil,
                    authAgeMs: nil,
                    probe: .init(
                        ok: true,
                        status: 200,
                        error: nil,
                        elapsedMs: 8,
                        bot: nil,
                        webhook: nil),
                    lastProbeAt: 0),
            ],
            channelOrder: ["whatsapp", "telegram"],
            channelLabels: ["whatsapp": "WhatsApp", "telegram": "Telegram"])

        let store = HealthStore(autoStart: false)
        store.__setSnapshotForTest(snap, lastError: nil)

        #expect(store.summaryLine == "This Mac still needs sign-in")
        #expect(store.detailLine == "Telegram is available, but this Mac is not linked yet.")
    }

    @Test @MainActor func `health stays in loading copy while the first refresh is running`() {
        let store = HealthStore(autoStart: false)
        store.__setSnapshotForTest(nil, lastError: nil)
        store.__setRefreshingForTest(true)

        #expect(store.summaryLine == "Checking health…")
        #expect(store.detailLine == "Running a fresh health check.")
    }

    @Test @MainActor func `health preserves last known result while disconnected`() {
        let snap = self.makeSnapshot(
            channels: [
                "whatsapp": .init(
                    configured: true,
                    linked: true,
                    authAgeMs: 1,
                    probe: .init(
                        ok: true,
                        status: 200,
                        error: nil,
                        elapsedMs: 12,
                        bot: nil,
                        webhook: nil),
                    lastProbeAt: 0),
            ],
            channelOrder: ["whatsapp"],
            channelLabels: ["whatsapp": "WhatsApp"])

        let store = HealthStore(autoStart: false)
        store.__setSnapshotForTest(snap, lastError: nil)

        let presentation = store.surfacePresentation(controlState: .disconnected)
        #expect(presentation.status == .disconnected)
        #expect(presentation.summary == "Health unavailable")
        #expect(presentation.detail == "This Mac is disconnected from the runtime.")
        #expect(presentation.lastKnownSummary == "Healthy")
    }
}
