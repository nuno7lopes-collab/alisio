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
            controlState: .connected)

        #expect(overview.title == "Local runtime")
        #expect(overview.status == ConnectionsSurfaceStatus.connected)
        #expect(overview.facts == [
            ConnectionFact(label: "Route", value: "This Mac"),
            ConnectionFact(label: "Gateway", value: "127.0.0.1:40705"),
            ConnectionFact(label: "Access", value: "Gateway token"),
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
}
