import AppKit

import AlisioSupport
@MainActor
final class AlisioWindowManager: NSObject, NSWindowDelegate {
    static let shared = AlisioWindowManager()

    let navigationState = WorkspaceNavigationState()

    var onWindowVisibilityChanged: ((Bool) -> Void)?

    private var updater: (any UpdaterProviding)?
    private var workspaceController: AlisioWorkspaceWindowController?

    func configure(state: AppState = AppStateStore.shared, updater: (any UpdaterProviding)?) {
        self.updater = updater
        self.workspaceController?.update(navigationState: self.navigationState, state: state)
    }

    var activeSessionKey: String? {
        self.navigationState.activeSessionKey
    }

    var hasVisibleWindow: Bool {
        self.workspaceController?.isVisible == true
    }

    func show(route: WorkspaceNavigationState.Route) {
        self.navigationState.show(route: route)
        self.showWindow()
    }

    func showChat(sessionKey: String) {
        self.navigationState.showChat(sessionKey: sessionKey)
        self.showWindow()
    }

    func showPreferredChat() {
        Task { @MainActor in
            let fallbackSessionKey = self.activeSessionKey ?? "main"
            self.showChat(sessionKey: fallbackSessionKey)
            let sessionKey = await AlisioWorkspaceManager.shared.preferredSessionKey()
            guard sessionKey != fallbackSessionKey else { return }
            self.showChat(sessionKey: sessionKey)
        }
    }

    func showSettings(tab: SettingsTab = .general) {
        self.navigationState.showSettings(tab: tab)
        self.showWindow()
    }

    func hide() {
        self.workspaceController?.window?.orderOut(nil)
        self.onWindowVisibilityChanged?(false)
    }

    func close() {
        self.onWindowVisibilityChanged?(false)

        self.workspaceController?.window?.delegate = nil
        self.workspaceController?.window?.close()
        self.workspaceController = nil
    }

    func windowShouldClose(_: NSWindow) -> Bool {
        self.hide()
        return false
    }

    func windowDidMiniaturize(_: Notification) {
        self.onWindowVisibilityChanged?(false)
    }

    func windowDidDeminiaturize(_: Notification) {
        self.onWindowVisibilityChanged?(true)
    }

    func windowDidBecomeKey(_: Notification) {
        self.onWindowVisibilityChanged?(true)
    }

    func windowDidResignKey(_: Notification) {
        self.onWindowVisibilityChanged?(false)
    }

    private func showWindow() {
        let controller = self.ensureWorkspaceController()
        controller.show(navigationState: self.navigationState, state: AppStateStore.shared)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func ensureWorkspaceController() -> AlisioWorkspaceWindowController {
        if let workspaceController {
            return workspaceController
        }

        let controller = AlisioWorkspaceWindowController(presentation: .window, updater: self.updater)
        controller.onVisibilityChanged = { [weak self] visible in
            self?.onWindowVisibilityChanged?(visible)
        }
        self.workspaceController = controller
        return controller
    }
}
