import Foundation
import OSLog

import AlisioSupport
@MainActor
final class ConnectionModeCoordinator {
    static let shared = ConnectionModeCoordinator()

    private let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "connection")
    private var lastMode: AppState.ConnectionMode?

    /// Apply the requested connection mode by starting/stopping local gateway,
    /// managing the control-channel SSH tunnel, and cleaning up chat windows/panels.
    func apply(mode: AppState.ConnectionMode, paused: Bool) async {
        let previousMode = self.lastMode
        if let previousMode, previousMode != mode {
            GatewayProcessManager.shared.clearLastFailure()
            NodesStore.shared.lastError = nil
            await ControlChannel.shared.disconnect()
        }
        self.lastMode = mode
        switch mode {
        case .unconfigured:
            NodesStore.shared.lastError = nil
            await RemoteTunnelManager.shared.stopAll()
            AlisioWorkspaceManager.shared.resetTunnels()
            GatewayProcessManager.shared.stop()
            Task.detached { await PortGuardian.shared.sweep(mode: .unconfigured) }

        case .local:
            NodesStore.shared.lastError = nil
            await RemoteTunnelManager.shared.stopAll()
            AlisioWorkspaceManager.shared.resetTunnels()
            let shouldStart = GatewayAutostartPolicy.shouldStartGateway(mode: .local, paused: paused)
            if shouldStart {
                GatewayProcessManager.shared.setActive(true)
                if GatewayAutostartPolicy.shouldEnsureLaunchAgent(
                    mode: .local,
                    paused: paused)
                {
                    Task { await GatewayProcessManager.shared.ensureLaunchAgentEnabledIfNeeded() }
                }
                _ = await GatewayProcessManager.shared.waitForGatewayReady()
            } else {
                GatewayProcessManager.shared.stop()
            }
            do {
                try await ControlChannel.shared.configure(mode: .local)
            } catch {
                // Control channel will mark itself degraded; nothing else to do here.
                self.logger.error(
                    "control channel local configure failed: \(error.localizedDescription, privacy: .public)")
            }
            Task.detached { await PortGuardian.shared.sweep(mode: .local) }

        case .remote:
            // Never run a local gateway in remote mode.
            // The native Mac node runtime is managed by `MacNodeModeCoordinator`.
            // The separate headless node service remains a manual CLI workflow.
            GatewayProcessManager.shared.stop()
            AlisioWorkspaceManager.shared.resetTunnels()

            do {
                NodesStore.shared.lastError = nil
                _ = try await GatewayEndpointStore.shared.ensureRemoteControlTunnel()
                let settings = CommandResolver.connectionSettings()
                try await ControlChannel.shared.configure(mode: .remote(
                    target: settings.target,
                    identity: settings.identity))
            } catch {
                self.logger.error("remote tunnel/configure failed: \(error.localizedDescription, privacy: .public)")
            }

            Task.detached { await PortGuardian.shared.sweep(mode: .remote) }
        }
    }
}
