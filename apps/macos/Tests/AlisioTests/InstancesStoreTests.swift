import Testing
import AlisioSupport
@testable import Alisio

struct InstancesStoreTests {
    private func payload(presence: [AlisioProtocol.AnyCodable]) -> AlisioProtocol.AnyCodable {
        AlisioProtocol.AnyCodable([
            "presence": AlisioProtocol.AnyCodable(presence),
        ])
    }

    private func presenceEntry(
        host: String = "gw",
        ip: String = "10.0.0.1",
        mode: String = "gateway",
        reason: String = "test",
        text: String = "Gateway node",
        ts: Int = 1_730_000_000) -> AlisioProtocol.AnyCodable
    {
        let entry: [String: AlisioProtocol.AnyCodable] = [
            "host": .init(host),
            "ip": .init(ip),
            "version": .init("2.0.0"),
            "mode": .init(mode),
            "lastInputSeconds": .init(5),
            "reason": .init(reason),
            "text": .init(text),
            "ts": .init(ts),
        ]
        return AlisioProtocol.AnyCodable(entry)
    }

    @Test
    @MainActor
    func `presence event payload decodes via JSON encoder`() {
        let store = InstancesStore(isPreview: true)
        store.handlePresenceEventPayload(self.payload(presence: [self.presenceEntry()]))

        #expect(store.instances.count == 1)
        let instance = store.instances.first
        #expect(instance?.host == "gw")
        #expect(instance?.ip == "10.0.0.1")
        #expect(instance?.mode == "gateway")
        #expect(instance?.reason == "test")
        #expect(store.hasLoadedOnce == true)
    }

    @Test
    @MainActor
    func `empty presence update clears stale nodes without fabricating fallback rows`() {
        let store = InstancesStore(isPreview: true)
        store.handlePresenceEventPayload(self.payload(presence: [self.presenceEntry()]))

        store.handlePresenceEventPayload(self.payload(presence: []))

        #expect(store.instances.isEmpty)
        #expect(store.lastError == nil)
        #expect(store.statusMessage == "No nodes have reported in yet.")
    }

    @Test
    @MainActor
    func `invalid presence update keeps last known nodes and surfaces an honest error`() {
        let store = InstancesStore(isPreview: true)
        store.handlePresenceEventPayload(self.payload(presence: [self.presenceEntry()]))

        let invalidPayload = AlisioProtocol.AnyCodable([
            "presence": AlisioProtocol.AnyCodable("broken"),
        ])
        store.handlePresenceEventPayload(invalidPayload)

        #expect(store.instances.count == 1)
        #expect(store.lastError == "Received an invalid nodes update. Showing the last known list.")
    }
}
