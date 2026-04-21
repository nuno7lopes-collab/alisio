import Foundation
import OSLog

import AlisioSupport

private let localGatewayPreflightLogger = Logger(
    subsystem: AlisioBrand.logSubsystem,
    category: "gateway.preflight")

enum LocalGatewayPreflight {
    static func ensureReadyIfNeeded(reason: String, timeout: TimeInterval = 15) async throws {
        let mode = await MainActor.run { AppStateStore.shared.connectionMode }
        guard mode == .local else { return }
        try await GatewayProcessManager.shared.ensureLocalGatewayReady(reason: reason, timeout: timeout)
        localGatewayPreflightLogger.debug("local gateway ready for \(reason, privacy: .public)")
    }
}
