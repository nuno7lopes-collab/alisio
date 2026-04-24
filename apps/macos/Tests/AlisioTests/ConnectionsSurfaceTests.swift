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
            authSource: .deviceToken)

        #expect(overview.title == "On this Mac")
        #expect(overview.status == ConnectionsSurfaceStatus.connected)
        #expect(overview.facts == [
            ConnectionFact(label: "Access", value: "Paired device"),
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

        #expect(overview.title == "Remote runtime")
        #expect(overview.status == ConnectionsSurfaceStatus.connecting)
        #expect(overview.summary == "Opening the remote connection.")
        #expect(overview.facts == [
            ConnectionFact(label: "Transport", value: "SSH tunnel"),
            ConnectionFact(label: "Remote", value: "gateway-host"),
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

        #expect(overview.title == "Remote runtime")
        #expect(overview.status == ConnectionsSurfaceStatus.disconnected)
        #expect(overview.facts == [
            ConnectionFact(label: "Transport", value: "Direct URL"),
            ConnectionFact(label: "Remote", value: "gateway.example.com:443"),
            ConnectionFact(label: "Access", value: "Connection token"),
        ])
    }

    @Test
    func `remote auth failures use human setup copy`() {
        let overview = InstancesSettings.resolveConnectionOverview(
            mode: .remote,
            remoteTransport: .ssh,
            remoteTarget: "gateway-host",
            remoteURL: "",
            endpointState: .ready(
                mode: .remote,
                url: URL(string: "http://127.0.0.1:40705")!,
                token: "token-123",
                password: nil),
            controlState: .degraded("Setup code expired or already used. Scan a fresh setup code, then try again."))

        #expect(overview.status == ConnectionsSurfaceStatus.attention)
        #expect(overview.summary == "Setup code expired.")
        #expect(overview.detail == "Use a fresh setup code to reconnect this Mac.")
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

        #expect(overview.title == "Not set up")
        #expect(overview.status == ConnectionsSurfaceStatus.attention)
        #expect(overview.facts.isEmpty)
    }

    @Test
    func `nodes surface stays loading until the first real round trip completes`() {
        #expect(InstancesSettings.resolveNodesListState(
            instanceCount: 0,
            hasLoadedOnce: false,
            isLoading: false,
            lastError: nil,
            emptyMessage: nil,
            controlState: .connected,
            mode: .local) == .loading("Checking for nodes…"))
    }

    @Test
    func `nodes surface exposes empty and error states honestly`() {
        #expect(InstancesSettings.resolveNodesListState(
            instanceCount: 0,
            hasLoadedOnce: true,
            isLoading: false,
            lastError: nil,
            emptyMessage: "No nodes have checked in yet.",
            controlState: .connected,
            mode: .local) == .empty("No nodes have checked in yet."))

        #expect(InstancesSettings.resolveNodesListState(
            instanceCount: 0,
            hasLoadedOnce: true,
            isLoading: false,
            lastError: nil,
            emptyMessage: nil,
            controlState: .disconnected,
            mode: .remote) == .error("Alisio is not connected to the runtime right now."))
    }
}
