import Foundation
import Observation

import AlisioSupport

@MainActor
@Observable
final class WorkspaceNavigationState {
    enum Route: String, CaseIterable, Identifiable {
        case chat
        case apps
        case schedules
        case capabilities
        case connections
        case settings

        var id: String { self.rawValue }
    }

    var route: Route
    var activeSessionKey: String?

    init() {
        self.route = .chat
    }

    func showChat(sessionKey: String?) {
        self.route = .chat
        let trimmed = sessionKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty {
            self.activeSessionKey = trimmed
        }
    }

    func showSettings() {
        self.route = .settings
    }

    func show(route: Route) {
        self.route = route
    }
}
