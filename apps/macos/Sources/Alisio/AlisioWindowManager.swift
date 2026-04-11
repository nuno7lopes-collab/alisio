import AppKit

import AlisioSupport
@MainActor
final class AlisioWindowManager: NSObject, NSWindowDelegate {
    static let shared = AlisioWindowManager()

    let shellState = AlisioShellState()

    var onWindowVisibilityChanged: ((Bool) -> Void)?

    private var updater: (any UpdaterProviding)?
    private var workspaceController: AlisioWorkspaceWindowController?

    func configure(state: AppState = AppStateStore.shared, updater: (any UpdaterProviding)?) {
        self.updater = updater
        self.refreshVisibleSurface(state: state)
    }

    var activeSessionKey: String? {
        self.shellState.activeSessionKey
    }

    func show(route: AlisioShellState.Route) {
        self.shellState.show(route: route)
        self.showWindow()
    }

    func showChat(sessionKey: String) {
        self.shellState.showChat(sessionKey: sessionKey)
        self.showWindow()
    }

    func showPreferredChat() {
        Task { @MainActor in
            let sessionKey = await AlisioWorkspaceManager.shared.preferredSessionKey()
            self.showChat(sessionKey: sessionKey)
        }
    }

    func showSettings(tab: SettingsTab = .general) {
        self.shellState.showSettings(tab: tab)
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
        self.refreshVisibleSurface(state: AppStateStore.shared)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func refreshVisibleSurface(state: AppState) {
        let controller = self.ensureWorkspaceController()
        controller.show(shellState: self.shellState, state: state)
    }

    private func ensureWorkspaceController() -> AlisioWorkspaceWindowController {
        if let workspaceController {
            return workspaceController
        }

        let controller = AlisioWorkspaceWindowController(presentation: .window)
        controller.onVisibilityChanged = { [weak self] visible in
            self?.onWindowVisibilityChanged?(visible)
        }
        self.workspaceController = controller
        return controller
    }
}
