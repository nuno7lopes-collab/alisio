import Foundation
import Observation

import AlisioSupport

@MainActor
@Observable
final class WorkspaceNavigationState {
    enum Route: String, CaseIterable, Identifiable {
        case chat
        case memory
        case apps
        case schedules
        case capabilities
        case connections
        case settings

        var id: String { self.rawValue }

        var systemImage: String {
            switch self {
            case .chat:
                "bubble.left.and.bubble.right"
            case .memory:
                "brain.head.profile"
            case .apps:
                "link"
            case .schedules:
                "calendar"
            case .capabilities:
                "sparkles"
            case .connections:
                "network"
            case .settings:
                "gearshape"
            }
        }

        var workspaceTitle: String {
            switch self {
            case .chat:
                "Chat"
            case .memory:
                "Memory"
            case .apps:
                "Apps"
            case .schedules:
                "Schedules"
            case .capabilities:
                "Capabilities"
            case .connections:
                "Connections"
            case .settings:
                "Settings"
            }
        }

        var workspaceSubtitle: String {
            switch self {
            case .chat:
                "Pick up the main conversation or start a clean new chat."
            case .memory:
                "Daily notes, topic notes, main memory, identity, soul, and agent files."
            case .apps:
                "Connect and manage the apps that are available on this Mac."
            case .schedules:
                "Create, review, and run scheduled work."
            case .capabilities:
                "See what this Mac can do and what still needs setup."
            case .connections:
                "See how this Mac connects, whether health checks pass, and which nodes are online."
            case .settings:
                "Open the native Settings window for app setup and preferences."
            }
        }

        var showsStageHeader: Bool {
            self != .chat
        }

        var stageMarkerIdentifier: String {
            "workspace-route-\(self.rawValue)"
        }

        var stageHeaderMarkerIdentifier: String {
            "workspace-header-\(self.rawValue)"
        }

        @MainActor
        func apply(to navigationState: WorkspaceNavigationState) {
            switch self {
            case .chat:
                navigationState.showChat(sessionKey: navigationState.activeSessionKey)
            case .settings:
                navigationState.showSettings()
            case .memory, .apps, .schedules, .capabilities, .connections:
                navigationState.show(route: self)
            }
        }
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
