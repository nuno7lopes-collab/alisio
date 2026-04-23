import Foundation
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
            prefersEntryFlow: false,
            accountGateStatus: .ready,
            prefersSetup: false,
            runtimeGateStatus: .blocked)

        #expect(surface == .setup)
    }

    @Test func `app root opens workspace directly when runtime is ready`() {
        let surface = AlisioAppRootView.resolveVisibleSurface(
            prefersEntryFlow: false,
            accountGateStatus: .ready,
            prefersSetup: false,
            runtimeGateStatus: .ready)

        #expect(surface == .workspace)
    }

    @Test func `app root waits for runtime check before opening workspace`() {
        let surface = AlisioAppRootView.resolveVisibleSurface(
            prefersEntryFlow: false,
            accountGateStatus: .ready,
            prefersSetup: false,
            runtimeGateStatus: .checking)

        #expect(surface == .loading)
    }

    @Test func `signed out app root stays in entry flow even if runtime is ready`() {
        let surface = AlisioAppRootView.resolveVisibleSurface(
            prefersEntryFlow: false,
            accountGateStatus: .signInRequired,
            prefersSetup: false,
            runtimeGateStatus: .ready)

        #expect(surface == .entryFlow)
    }

    @Test func `transient account failure keeps app root in loading instead of false sign out`() {
        let status = AlisioAppRootView.resolveAccountGateStatus(
            snapshot: nil,
            isLoading: false,
            lastError: "Gateway request timed out",
            lastErrorIsTransient: true,
            lastRefreshAt: Date())

        #expect(status == .checking)
    }

    @Test func `stable account failure opens entry flow without forcing a false sign out state`() {
        let status = AlisioAppRootView.resolveAccountGateStatus(
            snapshot: nil,
            isLoading: false,
            lastError: "Alisio could not confirm the account on this Mac right now. Try again in a moment.",
            lastErrorIsTransient: false,
            lastRefreshAt: Date())

        #expect(status == .unavailable)

        let surface = AlisioAppRootView.resolveVisibleSurface(
            prefersEntryFlow: false,
            accountGateStatus: status,
            prefersSetup: false,
            runtimeGateStatus: .ready)

        #expect(surface == .entryFlow)
    }

    @Test func `authenticated account without completed profile stays in entry flow`() {
        let status = AlisioAppRootView.resolveAccountGateStatus(
            snapshot: AlisioAccountSnapshot(
                accountId: "acct-test",
                canonical: .init(authenticated: true, accountId: "acct-test", source: .accountId),
                profile: nil,
                session: .init(
                    state: .signedIn,
                    authenticated: true,
                    accountId: "acct-test",
                    profileCompleted: false,
                    authMethod: nil),
                devices: [],
                deviceBinding: nil),
            isLoading: false,
            lastError: nil,
            lastErrorIsTransient: false,
            lastRefreshAt: Date())

        #expect(status == .profileCompletionRequired)

        let surface = AlisioAppRootView.resolveVisibleSurface(
            prefersEntryFlow: false,
            accountGateStatus: status,
            prefersSetup: false,
            runtimeGateStatus: .ready)

        #expect(surface == .entryFlow)
    }
}
