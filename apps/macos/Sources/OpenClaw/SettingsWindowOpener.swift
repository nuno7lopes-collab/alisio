import AppKit

@MainActor
final class SettingsWindowOpener {
    static let shared = SettingsWindowOpener()

    func open(tab: SettingsTab = .general) {
        NSApp.activate(ignoringOtherApps: true)
        LumeWindowManager.shared.showSettings(tab: tab)
    }
}
