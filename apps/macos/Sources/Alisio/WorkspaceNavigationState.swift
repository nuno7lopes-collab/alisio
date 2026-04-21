import Foundation
import Observation

import AlisioSupport

@MainActor
@Observable
final class WorkspaceNavigationState {
    enum Route: String, CaseIterable, Identifiable {
        case onboarding
        case chat
        case authentications
        case automations
        case agents
        case organization
        case settings

        var id: String { self.rawValue }
    }

    enum SettingsSection: String, CaseIterable, Identifiable {
        case workspace
        case mac
        case debug

        var id: String { self.rawValue }
    }

    var route: Route
    var activeSessionKey: String?
    var settingsSection: SettingsSection = .workspace

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

    func showSettings(tab: SettingsTab) {
        let mapped = Self.mapSettings(tab)
        self.route = mapped.route
        if let section = mapped.section {
            self.settingsSection = section
        }
    }

    func show(route: Route) {
        self.route = route
    }

    func completeOnboarding(preferredSessionKey: String? = nil) {
        let trimmed = preferredSessionKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty {
            self.activeSessionKey = trimmed
        }
        self.route = .chat
    }

    private static func mapSettings(_ tab: SettingsTab) -> (route: Route, section: SettingsSection?) {
        switch tab {
        case .general:
            (.settings, .workspace)
        case .channels:
            (.authentications, nil)
        case .skills:
            (.agents, nil)
        case .sessions:
            (.chat, nil)
        case .cron:
            (.automations, nil)
        case .config:
            (.settings, .debug)
        case .instances:
            (.organization, nil)
        case .voiceWake, .permissions:
            (.settings, .mac)
        case .debug:
            (.settings, .debug)
        case .about:
            (.settings, .workspace)
        }
    }
}
