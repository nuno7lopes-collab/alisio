import AppKit
import SwiftUI

@MainActor
final class LumeWindowManager: NSObject, NSWindowDelegate {
    static let shared = LumeWindowManager()

    let shellState = LumeShellState()

    var onWindowVisibilityChanged: ((Bool) -> Void)?

    private var updater: (any UpdaterProviding)?
    private var onboardingWindow: NSWindow?
    private var onboardingController: NSHostingController<OnboardingView>?
    private var workspaceController: LumeWorkspaceWindowController?

    func configure(state: AppState = AppStateStore.shared, updater: (any UpdaterProviding)?) {
        self.updater = updater
        self.refreshVisibleSurface(state: state)
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
        if self.shellState.requiresOnboarding {
            self.show(route: .onboarding)
            return
        }
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
        self.onboardingWindow?.orderOut(nil)
        self.workspaceController?.window?.orderOut(nil)
        self.onWindowVisibilityChanged?(false)
    }

    func close() {
        self.onWindowVisibilityChanged?(false)

        self.onboardingWindow?.delegate = nil
        self.onboardingWindow?.close()
        self.onboardingWindow = nil
        self.onboardingController = nil

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
        if self.onboardingWindow?.isVisible == true {
            self.onWindowVisibilityChanged?(true)
        }
    }

    private func showWindow() {
        self.refreshVisibleSurface(state: AppStateStore.shared)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func refreshVisibleSurface(state: AppState) {
        if self.shellState.route == .onboarding {
            self.showOnboardingWindow(state: state)
            return
        }
        self.onboardingWindow?.orderOut(nil)
        let controller = self.ensureWorkspaceController()
        controller.show(shellState: self.shellState, state: state)
    }

    private func showOnboardingWindow(state: AppState) {
        self.workspaceController?.window?.orderOut(nil)

        let controller = self.ensureOnboardingController(state: state)
        let window: NSWindow
        if let existing = self.onboardingWindow {
            window = existing
            existing.contentViewController = controller
        } else {
            window = NSWindow(contentViewController: controller)
            window.delegate = self
            window.title = "Lume"
            window.identifier = NSUserInterfaceItemIdentifier("ai.openclaw.lume-onboarding-window")
            window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.isReleasedWhenClosed = false
            window.isMovableByWindowBackground = true
            window.minSize = NSSize(width: OnboardingView.windowWidth, height: OnboardingView.windowHeight)
            window.setContentSize(NSSize(width: OnboardingView.windowWidth, height: OnboardingView.windowHeight))
            window.center()
            window.toolbarStyle = .unifiedCompact
            self.onboardingWindow = window
        }

        window.makeKeyAndOrderFront(nil)
        self.onWindowVisibilityChanged?(true)
    }

    private func ensureOnboardingController(state: AppState) -> NSHostingController<OnboardingView> {
        if let onboardingController {
            onboardingController.rootView = self.makeOnboardingView(state: state)
            return onboardingController
        }

        let controller = NSHostingController(rootView: self.makeOnboardingView(state: state))
        self.onboardingController = controller
        return controller
    }

    private func ensureWorkspaceController() -> LumeWorkspaceWindowController {
        if let workspaceController {
            return workspaceController
        }

        let controller = LumeWorkspaceWindowController(presentation: .window)
        controller.onVisibilityChanged = { [weak self] visible in
            self?.onWindowVisibilityChanged?(visible)
        }
        self.workspaceController = controller
        return controller
    }

    private func makeOnboardingView(state: AppState) -> OnboardingView {
        OnboardingView(state: state, shellOnboarding: self.shellState.onboardingState)
    }
}
