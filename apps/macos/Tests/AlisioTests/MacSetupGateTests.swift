import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct MacSetupGateTests {
    @Test func `unconfigured runtime blocks workspace entry`() {
        let snapshot = MacSetupEvaluator.snapshot(
            connectionMode: .unconfigured,
            gatewayStatus: nil,
            remoteProbe: nil)

        #expect(snapshot.canOpenWorkspace == false)
        #expect(snapshot.surfaceTitle == "Can't open the workspace yet")
        #expect(snapshot.runtime.title == "Choose where this Mac connects to Alisio")
    }

    @Test func `local runtime ready no longer blocks workspace entry`() {
        let snapshot = MacSetupEvaluator.snapshot(
            connectionMode: .local,
            gatewayStatus: GatewayEnvironmentStatus(
                kind: .ok,
                nodeVersion: "22.16.0",
                gatewayVersion: "2026.4.22",
                requiredGateway: "2026.4.22",
                message: "Node 22.16.0; gateway 2026.4.22 (global CLI)"),
            remoteProbe: nil)

        #expect(snapshot.canOpenWorkspace)
        #expect(snapshot.surfaceTitle == "Opening the workspace")
        #expect(snapshot.runtime.title == "Local runtime ready")
    }

    @Test func `remote auth issue blocks workspace entry`() {
        let snapshot = MacSetupEvaluator.snapshot(
            connectionMode: .remote,
            gatewayStatus: nil,
            remoteProbe: .authIssue(.pairingRequired))

        #expect(snapshot.canOpenWorkspace == false)
        #expect(snapshot.runtime.title == RemoteGatewayAuthIssue.pairingRequired.title)
        #expect(snapshot.runtime.detail == RemoteGatewayAuthIssue.pairingRequired.statusMessage)
    }

    @Test func `app root resolves setup surface when runtime is blocked`() {
        let surface = AlisioAppRootView.resolveVisibleSurface(
            needsInitialAccountRefresh: false,
            prefersEntryFlow: false,
            isAuthenticated: true,
            profileCompleted: true,
            prefersSetup: false,
            runtimeGateStatus: .blocked)

        #expect(surface == .setup)
    }

    @Test func `app root opens workspace directly when runtime is ready`() {
        let surface = AlisioAppRootView.resolveVisibleSurface(
            needsInitialAccountRefresh: false,
            prefersEntryFlow: false,
            isAuthenticated: true,
            profileCompleted: true,
            prefersSetup: false,
            runtimeGateStatus: .ready)

        #expect(surface == .workspace)
    }

    @Test func `app root waits for runtime check before opening workspace`() {
        let surface = AlisioAppRootView.resolveVisibleSurface(
            needsInitialAccountRefresh: false,
            prefersEntryFlow: false,
            isAuthenticated: true,
            profileCompleted: true,
            prefersSetup: false,
            runtimeGateStatus: .checking)

        #expect(surface == .loading)
    }

    @Test func `signed out app root stays in entry flow even if runtime is ready`() {
        let surface = AlisioAppRootView.resolveVisibleSurface(
            needsInitialAccountRefresh: false,
            prefersEntryFlow: false,
            isAuthenticated: false,
            profileCompleted: false,
            prefersSetup: false,
            runtimeGateStatus: .ready)

        #expect(surface == .entryFlow)
    }
}
