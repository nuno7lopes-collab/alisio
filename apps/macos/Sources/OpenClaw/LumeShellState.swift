import Foundation
import Observation

@MainActor
@Observable
final class LumeOnboardingState {
    enum Step: String, CaseIterable, Identifiable {
        case welcome
        case gateway
        case setup
        case permissions
        case finish

        var id: String { self.rawValue }
    }

    enum GatewayChoice: String, CaseIterable, Identifiable {
        case local
        case remote
        case unconfigured

        var id: String { self.rawValue }
    }

    var currentStep: Step = .welcome
    var selectedGateway: GatewayChoice = .local
    var permissionStates: [String: Bool] = [:]
    var isWizardComplete = false
    var isComplete = false

    static func requiresCompletion() -> Bool {
        false
    }
}

@MainActor
@Observable
final class LumeShellState {
    enum Route: String, CaseIterable, Identifiable {
        case onboarding
        case home
        case chat
        case authentications
        case automations
        case agents
        case organization
        case sessions
        case settings

        var id: String { self.rawValue }
    }

    enum SettingsSection: String, CaseIterable, Identifiable {
        case workspace
        case communications
        case appearance
        case automation
        case infrastructure
        case aiAgents
        case mac
        case debug
        case logs

        var id: String { self.rawValue }

        var queryValue: String? {
            self == .workspace ? nil : self.rawValue
        }
    }

    let onboardingState = LumeOnboardingState()

    var route: Route
    var activeSessionKey: String?
    var settingsSection: SettingsSection = .workspace

    init() {
        self.onboardingState.isComplete = true
        self.route = .chat
    }

    func showChat(sessionKey: String?) {
        self.route = .chat
        if let sessionKey, !sessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.activeSessionKey = sessionKey
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

    var requiresOnboarding: Bool {
        false
    }

    func completeOnboarding(preferredSessionKey: String? = nil) {
        self.onboardingState.currentStep = .finish
        self.onboardingState.isComplete = true
        if let preferredSessionKey, !preferredSessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.activeSessionKey = preferredSessionKey
        }
        self.route = .chat
    }

    func workspacePath() -> String {
        switch self.route {
        case .onboarding:
            return "/setup"
        case .home:
            return "/chat"
        case .chat:
            if let activeSessionKey, !activeSessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "/chat?session=\(Self.encodeQueryValue(activeSessionKey))"
            }
            return "/chat"
        case .authentications:
            return "/authentications"
        case .automations:
            return "/automations"
        case .agents:
            return "/agents"
        case .organization:
            return "/organization"
        case .sessions:
            return "/sessions"
        case .settings:
            if let section = self.settingsSection.queryValue {
                return "/settings?section=\(Self.encodeQueryValue(section))"
            }
            return "/settings"
        }
    }

    private static func mapSettings(_ tab: SettingsTab) -> (route: Route, section: SettingsSection?) {
        switch tab {
        case .general:
            (.settings, .workspace)
        case .channels:
            (.settings, .communications)
        case .skills:
            (.settings, .aiAgents)
        case .sessions:
            (.sessions, nil)
        case .cron:
            (.automations, nil)
        case .config:
            (.settings, .workspace)
        case .instances:
            (.settings, .infrastructure)
        case .voiceWake, .permissions:
            (.settings, .mac)
        case .debug:
            (.settings, .debug)
        case .about:
            (.settings, .workspace)
        }
    }

    private static func encodeQueryValue(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
    }
}
