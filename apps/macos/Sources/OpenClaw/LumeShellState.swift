import Foundation
import Observation
import SwiftUI

private let lumeSidebarCollapsedKey = "openclaw.lume.sidebarCollapsed"
private let lumeAssistantSidebarCollapsedKey = "openclaw.lume.assistantSidebarCollapsed"
private let lumeThemeKey = "openclaw.lume.theme"
private let lumeLanguageKey = "openclaw.lume.language"
private let lumeAuthorizedIntegrationsKey = "openclaw.lume.authorizedIntegrations"
private let lumeIntegrationInputsKey = "openclaw.lume.integrationInputs"

@MainActor
@Observable
final class LumeShellState {
    enum Route: String, CaseIterable, Identifiable {
        case assistant
        case deepResearch
        case authentications
        case organization
        case settings

        var id: String { self.rawValue }

        var title: String {
            switch self {
            case .assistant: "Lume"
            case .deepResearch: "Deep Research"
            case .authentications: "Authentications"
            case .organization: "Organization"
            case .settings: "Settings"
            }
        }

        var symbolName: String {
            switch self {
            case .assistant: "terminal"
            case .deepResearch: "magnifyingglass"
            case .authentications: "key"
            case .organization: "building.2"
            case .settings: "gearshape"
            }
        }
    }

    enum SettingsSection: String, CaseIterable, Identifiable {
        case general
        case account
        case creditUsage
        case support
        case followUs

        var id: String { self.rawValue }

        var title: String {
            switch self {
            case .general: "General"
            case .account: "Account"
            case .creditUsage: "Credit Usage"
            case .support: "Support"
            case .followUs: "Follow Us"
            }
        }

        var symbolName: String {
            switch self {
            case .general: "gearshape"
            case .account: "person.crop.circle"
            case .creditUsage: "chart.bar"
            case .support: "envelope"
            case .followUs: "person.2"
            }
        }
    }

    enum AuthFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case authorized = "Authorized"
        case google = "Google"
        case microsoft = "Microsoft"
        case social = "Social"
        case storage = "Storage"
        case development = "Development"

        var id: String { self.rawValue }
    }

    var route: Route = .assistant
    var activeSessionKey: String?
    var settingsSection: SettingsSection = .general
    var isPrimaryRailCollapsed: Bool
    var isAssistantSidebarCollapsed: Bool
    var isAccountMenuPresented = false
    var authSearchQuery = ""
    var authFilter: AuthFilter = .all
    var preferredTheme: LumeThemeChoice
    var preferredLanguage: LumeLanguageChoice
    var authorizedIntegrationIDs: Set<String>
    var integrationInputValues: [String: String] = [:]

    init() {
        self.isPrimaryRailCollapsed = UserDefaults.standard.bool(forKey: lumeSidebarCollapsedKey)
        self.isAssistantSidebarCollapsed = UserDefaults.standard.bool(forKey: lumeAssistantSidebarCollapsedKey)
        self.preferredTheme = LumeThemeChoice(
            rawValue: UserDefaults.standard.string(forKey: lumeThemeKey) ?? "") ?? .dark
        self.preferredLanguage = LumeLanguageChoice(
            rawValue: UserDefaults.standard.string(forKey: lumeLanguageKey) ?? "") ?? .english
        let storedAuthorized = UserDefaults.standard.stringArray(forKey: lumeAuthorizedIntegrationsKey) ?? [
            "google-calendar",
            "gmail-read",
            "google-drive",
            "github",
        ]
        self.authorizedIntegrationIDs = Set(storedAuthorized)
        self.integrationInputValues =
            UserDefaults.standard.dictionary(forKey: lumeIntegrationInputsKey) as? [String: String] ?? [:]
    }

    func showChat(sessionKey: String?) {
        self.route = .assistant
        if let sessionKey, !sessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.activeSessionKey = sessionKey
        }
    }

    func showSettings(tab: SettingsTab) {
        self.settingsSection = switch tab {
        case .general, .channels, .skills, .sessions, .cron, .config, .instances, .voiceWake, .permissions, .debug:
            .general
        case .about:
            .support
        }
        self.route = .settings
    }

    func show(route: Route) {
        self.route = route
    }

    func toggleSidebar() {
        self.isPrimaryRailCollapsed.toggle()
        UserDefaults.standard.set(self.isPrimaryRailCollapsed, forKey: lumeSidebarCollapsedKey)
    }

    func toggleAssistantSidebar() {
        self.isAssistantSidebarCollapsed.toggle()
        UserDefaults.standard.set(self.isAssistantSidebarCollapsed, forKey: lumeAssistantSidebarCollapsedKey)
    }

    func setTheme(_ theme: LumeThemeChoice) {
        self.preferredTheme = theme
        UserDefaults.standard.set(theme.rawValue, forKey: lumeThemeKey)
    }

    func setLanguage(_ language: LumeLanguageChoice) {
        self.preferredLanguage = language
        UserDefaults.standard.set(language.rawValue, forKey: lumeLanguageKey)
    }

    func isAuthorized(_ integration: LumeIntegration) -> Bool {
        self.authorizedIntegrationIDs.contains(integration.id)
    }

    func connect(_ integration: LumeIntegration) {
        self.authorizedIntegrationIDs.insert(integration.id)
        self.persistAuthorizedIntegrations()
    }

    func disconnect(_ integration: LumeIntegration) {
        self.authorizedIntegrationIDs.remove(integration.id)
        self.persistAuthorizedIntegrations()
    }

    func clearAuthorizedIntegrations() {
        self.authorizedIntegrationIDs.removeAll()
        self.persistAuthorizedIntegrations()
    }

    func setIntegrationInput(_ value: String, for integrationID: String) {
        self.integrationInputValues[integrationID] = value
        UserDefaults.standard.set(self.integrationInputValues, forKey: lumeIntegrationInputsKey)
    }

    func integrationInput(for integrationID: String) -> String {
        self.integrationInputValues[integrationID] ?? ""
    }

    private func persistAuthorizedIntegrations() {
        UserDefaults.standard.set(
            self.authorizedIntegrationIDs.sorted(),
            forKey: lumeAuthorizedIntegrationsKey)
    }
}
