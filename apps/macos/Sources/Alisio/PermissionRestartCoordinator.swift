import AlisioIPC
import Observation

import AlisioSupport

@MainActor
@Observable
final class PermissionRestartCoordinator {
    static let shared = PermissionRestartCoordinator()

    private(set) var capabilities: Set<Capability> = []

    func markRequested(
        _ requested: [Capability],
        currentStatus: [Capability: Bool],
        restartRequired: [Capability: Bool]? = nil)
    {
        for capability in requested where capability.requiresHostRestartAfterGrant {
            if self.shouldClearTrackedRestart(
                capability: capability,
                status: currentStatus,
                restartRequired: restartRequired)
            {
                self.capabilities.remove(capability)
            } else {
                self.capabilities.insert(capability)
            }
        }
    }

    func reconcile(
        status: [Capability: Bool],
        restartRequired: [Capability: Bool]? = nil)
    {
        for capability in Array(self.capabilities) where self.shouldClearTrackedRestart(
            capability: capability,
            status: status,
            restartRequired: restartRequired)
        {
            self.capabilities.remove(capability)
        }
    }

    func requiresRestart(for capability: Capability) -> Bool {
        self.capabilities.contains(capability)
    }

    private func shouldClearTrackedRestart(
        capability: Capability,
        status: [Capability: Bool],
        restartRequired: [Capability: Bool]?) -> Bool
    {
        guard status[capability] == true else {
            return false
        }
        guard let explicitRestartRequired = restartRequired?[capability] else {
            // Preserve the tracked restart requirement until a higher-fidelity source
            // explicitly proves the permission no longer needs a host restart.
            return false
        }
        return explicitRestartRequired == false
    }
}

private extension Capability {
    var requiresHostRestartAfterGrant: Bool {
        switch self {
        case .accessibility, .screenRecording:
            return true
        default:
            return false
        }
    }
}
