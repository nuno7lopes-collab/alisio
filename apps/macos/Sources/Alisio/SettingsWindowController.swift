import AppKit
import Observation
import SwiftUI

import AlisioSupport

@MainActor
@Observable
final class SettingsNavigationModel {
    var selectedTab: SettingsTab

    init(selectedTab: SettingsTab = .general) {
        self.selectedTab = selectedTab
    }

    func select(_ tab: SettingsTab, debugEnabled: Bool) {
        if tab == .debug, !debugEnabled {
            self.selectedTab = .general
        } else {
            self.selectedTab = tab
        }
    }
}

@MainActor
final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    private let navigation = SettingsNavigationModel()
    private var hostedAppStateID: ObjectIdentifier?
    private var hostedUpdaterID: ObjectIdentifier?

    init() {
        let window = Self.makeWindow()
        super.init(window: window)
        self.window?.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    var isVisible: Bool {
        self.window?.isVisible ?? false
    }

    var selectedTab: SettingsTab {
        self.navigation.selectedTab
    }

    func show(
        state: AppState,
        updater: (any UpdaterProviding)?,
        tab: SettingsTab)
    {
        self.navigation.select(tab, debugEnabled: state.debugPaneEnabled)
        self.installRootView(state: state, updater: updater)

        guard let window else { return }
        WindowPlacement.ensureOnScreen(
            window: window,
            defaultSize: NSSize(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight),
            fallback: { _ in
                WindowPlacement.centeredFrame(
                    size: NSSize(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight))
            })
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func closeWindow() {
        self.window?.contentViewController = nil
        self.hostedAppStateID = nil
        self.hostedUpdaterID = nil
        self.window?.orderOut(nil)
    }

    private func installRootView(state: AppState, updater: (any UpdaterProviding)?) {
        let appStateID = ObjectIdentifier(state)
        let updaterID = updater.map(ObjectIdentifier.init)
        guard self.hostedAppStateID != appStateID
            || self.hostedUpdaterID != updaterID
            || self.window?.contentViewController == nil
        else {
            return
        }

        let rootView = SettingsRootView(
            state: state,
            updater: updater,
            navigation: self.navigation)
            .environment(TailscaleService.shared)
        let hostingController = NSHostingController(rootView: rootView)
        self.window?.contentViewController = hostingController
        self.hostedAppStateID = appStateID
        self.hostedUpdaterID = updaterID
    }

    private static func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(
                origin: .zero,
                size: NSSize(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false)
        window.title = "Settings"
        window.identifier = NSUserInterfaceItemIdentifier(AlisioBrand.subsystem("alisio-settings-window"))
        window.isReleasedWhenClosed = false
        window.toolbarStyle = .preference
        window.setContentSize(NSSize(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight))
        window.contentMinSize = NSSize(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
        window.contentMaxSize = NSSize(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
        window.center()
        return window
    }

    func windowShouldClose(_: NSWindow) -> Bool {
        self.closeWindow()
        return false
    }
}
