import AlisioIPC
import Observation

import AlisioSupport

@MainActor
@Observable
final class PermissionRestartCoordinator {
    static let shared = PermissionRestartCoordinator()

    private(set) var capabilities: Set<Capability> = []

    func markRequested(_ requested: [Capability], currentStatus: [Capability: Bool]) {
        for capability in requested where capability.requiresHostRestartAfterGrant {
            if currentStatus[capability] == true {
                self.capabilities.remove(capability)
            } else {
                self.capabilities.insert(capability)
            }
        }
    }

    func reconcile(status: [Capability: Bool]) {
        for capability in Array(self.capabilities) where status[capability] == true {
            self.capabilities.remove(capability)
        }
    }

    func requiresRestart(for capability: Capability) -> Bool {
        self.capabilities.contains(capability)
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
