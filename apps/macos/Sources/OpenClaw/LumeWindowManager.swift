import AppKit
import SwiftUI

@MainActor
final class LumeWindowManager: NSObject, NSWindowDelegate {
    static let shared = LumeWindowManager()

    let shellState = LumeShellState()

    var onWindowVisibilityChanged: ((Bool) -> Void)?

    private var updater: (any UpdaterProviding)?
    private var window: NSWindow?
    private var hostingController: NSHostingController<LumeRootView>?

    func configure(state: AppState = AppStateStore.shared, updater: (any UpdaterProviding)?) {
        self.updater = updater
        if let hostingController {
            hostingController.rootView = self.makeRootView(state: state)
        }
    }

    var activeSessionKey: String? {
        self.shellState.activeSessionKey
    }

    func show(route: LumeShellState.Route) {
        self.shellState.show(route: route)
        self.showWindow()
    }

    func showChat(sessionKey: String) {
        self.shellState.showChat(sessionKey: sessionKey)
        self.showWindow()
    }

    func showPreferredChat() {
        Task { @MainActor in
            let sessionKey = await WebChatManager.shared.preferredSessionKey()
            self.showChat(sessionKey: sessionKey)
        }
    }

    func showSettings(tab: SettingsTab = .general) {
        self.shellState.showSettings(tab: tab)
        self.showWindow()
    }

    func hide() {
        self.window?.orderOut(nil)
        self.onWindowVisibilityChanged?(false)
    }

    func close() {
        self.onWindowVisibilityChanged?(false)
        self.window?.delegate = nil
        self.window?.close()
        self.window = nil
        self.hostingController = nil
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
        if self.window?.isVisible == true {
            self.onWindowVisibilityChanged?(true)
        }
    }

    private func showWindow() {
        self.ensureWindow()
        guard let window else { return }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.onWindowVisibilityChanged?(true)
    }

    private func ensureWindow() {
        if self.window != nil {
            self.configure(state: AppStateStore.shared, updater: self.updater)
            return
        }

        let hostingController = NSHostingController(rootView: self.makeRootView(state: AppStateStore.shared))
        let window = NSWindow(contentViewController: hostingController)
        window.delegate = self
        window.title = "Lume"
        window.identifier = NSUserInterfaceItemIdentifier("ai.openclaw.lume-window")
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 1120, height: 760)
        window.setContentSize(NSSize(width: 1360, height: 860))
        window.center()
        window.toolbarStyle = .unifiedCompact

        self.hostingController = hostingController
        self.window = window
    }

    private func makeRootView(state: AppState) -> LumeRootView {
        LumeRootView(state: state, updater: self.updater, shellState: self.shellState)
    }
}
