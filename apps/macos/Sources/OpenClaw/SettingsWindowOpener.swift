import AppKit

@MainActor
final class SettingsWindowOpener {
    static let shared = SettingsWindowOpener()

    func open(tab: SettingsTab = .general) {
        SettingsTabRouter.request(tab)
        NSApp.activate(ignoringOtherApps: true)
        if !NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) {
            _ = NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
        NotificationCenter.default.post(name: .openclawSelectSettingsTab, object: tab)
    }
}
