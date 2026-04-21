import Foundation
import AlisioDiscovery
import SwiftUI
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct OnboardingViewSmokeTests {
    @Test func `page order omits workspace and identity steps`() {
        let order = OnboardingView.pageOrder(for: .local)
        #expect(!order.contains(7))
        #expect(order.contains(3))
    }

    @Test func `page order omits onboarding chat when identity known`() {
        let order = OnboardingView.pageOrder(for: .local)
        #expect(!order.contains(8))
    }

    @Test func `select remote gateway clears stale ssh target when endpoint unresolved`() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("alisio-config-\(UUID().uuidString)")
            .appendingPathComponent("alisio.json")
            .path

        await TestIsolation.withEnvValues(["ALISIO_CONFIG_PATH": override]) {
            let state = AppState(preview: true)
            state.remoteTransport = .ssh
            state.remoteTarget = "user@old-host:2222"
            let view = OnboardingView(
                state: state,
                permissionMonitor: PermissionMonitor.shared,
                discoveryModel: GatewayDiscoveryModel(localDisplayName: InstanceIdentity.displayName))
            let gateway = GatewayDiscoveryModel.DiscoveredGateway(
                displayName: "Unresolved",
                serviceHost: nil,
                servicePort: nil,
                lanHost: "txt-host.local",
                tailnetDns: "txt-host.ts.net",
                sshPort: 22,
                gatewayPort: 40705,
                cliPath: "/tmp/alisio",
                stableID: UUID().uuidString,
                debugID: UUID().uuidString,
                isLocal: false)

            view.selectRemoteGateway(gateway)
            #expect(state.remoteTarget.isEmpty)
        }
    }
}
