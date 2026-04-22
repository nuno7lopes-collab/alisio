import AppKit

import AlisioSupport
@MainActor
final class SettingsWindowOpener {
    static let shared = SettingsWindowOpener()

    private let stateProvider: @MainActor () -> AppState
    private let updaterProvider: @MainActor () -> (any UpdaterProviding)?
    private var controller: SettingsWindowController?

    init(
        stateProvider: @escaping @MainActor () -> AppState = { AppStateStore.shared },
        updaterProvider: @escaping @MainActor () -> (any UpdaterProviding)? = {
            (NSApp.delegate as? AppDelegate)?.updaterController
        })
    {
        self.stateProvider = stateProvider
        self.updaterProvider = updaterProvider
    }

    func open(tab: SettingsTab = .general) {
        let controller = self.ensureController()
        controller.show(
            state: self.stateProvider(),
            updater: self.updaterProvider(),
            tab: tab)
    }

    var isVisible: Bool {
        self.controller?.isVisible == true
    }

    var selectedTab: SettingsTab? {
        self.controller?.selectedTab
    }

    func close() {
        self.controller?.closeWindow()
    }

    private func ensureController() -> SettingsWindowController {
        if let controller {
            return controller
        }
        let controller = SettingsWindowController()
        self.controller = controller
        return controller
    }
}
