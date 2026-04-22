import AlisioIPC
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct MacSetupGateTests {
    @Test func `empty permission snapshot stays in checking state`() {
        let summary = MacSetupPermissionSummary(status: [:])

        #expect(summary.hasSnapshot == false)
        #expect(summary.summary == "Checking macOS permissions.")
        #expect(summary.detail == "Permissions refresh after the app checks macOS. Nothing here blocks the workspace.")
    }

    @Test func `unconfigured runtime blocks workspace entry`() {
        let snapshot = MacSetupEvaluator.snapshot(
            connectionMode: .unconfigured,
            gatewayStatus: nil,
            remoteProbe: nil,
            permissionStatus: self.fullPermissionStatus())

        #expect(snapshot.canOpenWorkspace == false)
        #expect(snapshot.statusTitle == "Finish runtime setup to open the workspace")
        #expect(snapshot.runtime.title == "Choose where this Mac connects to Alisio")
    }

    @Test func `local runtime ready keeps permissions optional`() {
        let snapshot = MacSetupEvaluator.snapshot(
            connectionMode: .local,
            gatewayStatus: GatewayEnvironmentStatus(
                kind: .ok,
                nodeVersion: "22.16.0",
                gatewayVersion: "2026.4.22",
                requiredGateway: "2026.4.22",
                message: "Node 22.16.0; gateway 2026.4.22 (global CLI)"),
            remoteProbe: nil,
            permissionStatus: self.fullPermissionStatus(overrides: [
                .accessibility: false,
                .screenRecording: false,
            ]))

        #expect(snapshot.canOpenWorkspace)
        #expect(snapshot.permissions.missingCount == 2)
        #expect(snapshot.statusDetail.contains("optional permissions"))
    }

    @Test func `remote auth issue blocks workspace entry`() {
        let snapshot = MacSetupEvaluator.snapshot(
            connectionMode: .remote,
            gatewayStatus: nil,
            remoteProbe: .authIssue(.pairingRequired),
            permissionStatus: self.fullPermissionStatus())

        #expect(snapshot.canOpenWorkspace == false)
        #expect(snapshot.runtime.title == RemoteGatewayAuthIssue.pairingRequired.title)
        #expect(snapshot.runtime.detail == RemoteGatewayAuthIssue.pairingRequired.statusMessage)
    }

    @Test func `app root resolves setup surface when mac setup is required`() {
        let surface = AlisioAppRootView.resolveVisibleSurface(
            needsInitialAccountRefresh: false,
            prefersEntryFlow: false,
            isAuthenticated: true,
            profileCompleted: true,
            prefersSetup: false,
            requiresMacSetup: true)

        #expect(surface == .setup)
    }

    @Test func `changing runtime mode marks mac setup incomplete`() {
        let state = AppState(preview: true)
        state.connectionMode = .local
        state.macSetupCompleted = true

        state.connectionMode = .remote

        #expect(state.macSetupCompleted == false)
        #expect(state.requiresMacSetup)
    }

    private func fullPermissionStatus(overrides: [Capability: Bool] = [:]) -> [Capability: Bool] {
        Capability.allCases.reduce(into: [:]) { status, capability in
            status[capability] = overrides[capability] ?? true
        }
    }
}
