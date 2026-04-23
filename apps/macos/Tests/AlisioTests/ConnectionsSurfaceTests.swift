import Foundation
import Testing
@testable import Alisio

@MainActor
struct ConnectionsSurfaceTests {
    @Test
    func `local connection overview shows direct local runtime facts`() {
        let overview = InstancesSettings.resolveConnectionOverview(
            mode: .local,
            remoteTransport: .ssh,
            remoteTarget: "",
            remoteURL: "",
            endpointState: .ready(
                mode: .local,
                url: URL(string: "http://127.0.0.1:40705")!,
                token: "token-123",
                password: nil),
            controlState: .connected,
            authSourceLabel: "Auth: Device token")

        #expect(overview.title == "Local runtime")
        #expect(overview.status == ConnectionsSurfaceStatus.connected)
        #expect(overview.facts == [
            ConnectionFact(label: "Route", value: "This Mac"),
            ConnectionFact(label: "Gateway", value: "127.0.0.1:40705"),
            ConnectionFact(label: "Auth", value: "Device token"),
        ])
    }

    @Test
    func `remote connection overview keeps tunnel context while connecting`() {
        let overview = InstancesSettings.resolveConnectionOverview(
            mode: .remote,
            remoteTransport: .ssh,
            remoteTarget: "gateway-host",
            remoteURL: "",
            endpointState: .connecting(
                mode: .remote,
                detail: "Connecting to remote gateway…"),
            controlState: .connecting)

        #expect(overview.title == "Connecting to remote runtime")
        #expect(overview.status == ConnectionsSurfaceStatus.connecting)
        #expect(overview.facts == [
            ConnectionFact(label: "Route", value: "SSH tunnel"),
            ConnectionFact(label: "Target", value: "gateway-host"),
        ])
    }

    @Test
    func `ready endpoint does not pretend the runtime is connected when control is down`() {
        let overview = InstancesSettings.resolveConnectionOverview(
            mode: .remote,
            remoteTransport: .direct,
            remoteTarget: "",
            remoteURL: "https://gateway.example.com:443",
            endpointState: .ready(
                mode: .remote,
                url: URL(string: "https://gateway.example.com:443")!,
                token: "token-123",
                password: nil),
            controlState: .disconnected)

        #expect(overview.title == "Remote runtime disconnected")
        #expect(overview.status == ConnectionsSurfaceStatus.attention)
        #expect(overview.facts == [
            ConnectionFact(label: "Route", value: "Direct URL"),
            ConnectionFact(label: "Target", value: "gateway.example.com:443"),
            ConnectionFact(label: "Configured access", value: "Gateway token"),
        ])
    }

    @Test
    func `unconfigured overview does not invent connection details`() {
        let overview = InstancesSettings.resolveConnectionOverview(
            mode: .unconfigured,
            remoteTransport: .direct,
            remoteTarget: "",
            remoteURL: "",
            endpointState: nil,
            controlState: .disconnected)

        #expect(overview.title == "Gateway not configured")
        #expect(overview.status == ConnectionsSurfaceStatus.attention)
        #expect(overview.facts.isEmpty)
    }

    @Test
    func `nodes surface stays loading until the first real round trip completes`() {
        let view = InstancesSettings(
            store: InstancesStore(isPreview: true),
            state: AppState(preview: true))

        #expect(view.nodesListState == .loading)
    }

    @Test
    func `nodes surface exposes empty and error states honestly`() {
        let store = InstancesStore(isPreview: true)
        store.hasLoadedOnce = true
        let view = InstancesSettings(store: store, state: AppState(preview: true))

        store.statusMessage = "No nodes have reported in yet."
        #expect(view.nodesListState == .empty("No nodes have reported in yet."))

        store.lastError = "Alisio is not connected to the runtime right now."
        #expect(view.nodesListState == .error("Alisio is not connected to the runtime right now."))
    }
}
