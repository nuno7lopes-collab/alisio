import Foundation
import Observation

@MainActor
@Observable
final class LumeShellState {
    enum Route: String, CaseIterable, Identifiable {
        case chat
        case runtime
        case sessions
        case skills
        case settings

        var id: String {
            self.rawValue
        }

        var title: String {
            switch self {
            case .chat: "Chat"
            case .runtime: "Runtime"
            case .sessions: "Sessions"
            case .skills: "Skills"
            case .settings: "Settings"
            }
        }

        var subtitle: String {
            switch self {
            case .chat:
                "Talk to the agent, keep context, and stay in one place."
            case .runtime:
                "Connection health, local gateway state, and quick controls."
            case .sessions:
                "Stored conversation buckets and their recent context usage."
            case .skills:
                "Installed capabilities, missing requirements, and readiness."
            case .settings:
                "Connection, permissions, channels, and local app behavior."
            }
        }

        var symbolName: String {
            switch self {
            case .chat: "bubble.left.and.bubble.right"
            case .runtime: "waveform.path.ecg.rectangle"
            case .sessions: "clock.arrow.trianglehead.counterclockwise.rotate.90"
            case .skills: "sparkles"
            case .settings: "slider.horizontal.3"
            }
        }
    }

    var route: Route = .chat
    var activeSessionKey: String?
    var selectedSettingsTab: SettingsTab = .general

    func showChat(sessionKey: String?) {
        self.route = .chat
        if let sessionKey, !sessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.activeSessionKey = sessionKey
        }
    }

    func showSettings(tab: SettingsTab) {
        self.selectedSettingsTab = tab
        self.route = .settings
    }

    func show(route: Route) {
        self.route = route
    }
}
