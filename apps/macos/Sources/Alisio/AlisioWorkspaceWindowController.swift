import AppKit
import Foundation
import SwiftUI

import AlisioSupport

private enum AlisioWorkspaceLayout {
    static let windowSize = NSSize(width: 1360, height: 860)
    static let windowMinSize = NSSize(width: 1120, height: 760)
    static let panelSize = NSSize(width: 480, height: 640)
    static let anchorPadding: CGFloat = 8
}

@MainActor
final class AlisioWorkspaceWindowController: NSWindowController, NSWindowDelegate {
    private let presentation: AlisioWorkspacePresentation
    private let updater: (any UpdaterProviding)?
    private var dismissMonitor: Any?
    private var hostedShellStateID: ObjectIdentifier?
    private var hostedAppStateID: ObjectIdentifier?

    var onClosed: (() -> Void)?
    var onVisibilityChanged: ((Bool) -> Void)?

    init(
        presentation: AlisioWorkspacePresentation,
        updater: (any UpdaterProviding)? = nil)
    {
        self.presentation = presentation
        self.updater = updater
        let window = Self.makeWindow(for: presentation)
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

    func update(shellState: AlisioShellState, state: AppState = AppStateStore.shared) {
        self.installRootView(shellState: shellState, state: state)
    }

    func show(shellState: AlisioShellState, state: AppState = AppStateStore.shared) {
        self.installRootView(shellState: shellState, state: state)
        guard let window else { return }

        switch self.presentation {
        case .window:
            self.ensureWindowSize()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        case let .panel(anchorProvider):
            self.installDismissMonitor()
            let target = self.reposition(using: anchorProvider)
            if !self.isVisible {
                let start = target.offsetBy(dx: 0, dy: 8)
                window.setFrame(start, display: true)
                window.alphaValue = 0
                window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = 0.18
                    window.animator().setFrame(target, display: true)
                    window.animator().alphaValue = 1
                }
            } else {
                window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }
        }

        self.onVisibilityChanged?(true)
    }

    override func close() {
        self.window?.orderOut(nil)
        self.onVisibilityChanged?(false)
        self.onClosed?()
        self.removeDismissMonitor()
    }

    private func installRootView(shellState: AlisioShellState, state: AppState) {
        let shellStateID = ObjectIdentifier(shellState)
        let appStateID = ObjectIdentifier(state)
        guard self.hostedShellStateID != shellStateID
            || self.hostedAppStateID != appStateID
            || self.window?.contentViewController == nil
        else {
            return
        }

        let rootView = AlisioWorkspaceRootView(
            shellState: shellState,
            state: state,
            presentation: self.presentation,
            updater: self.updater,
            chatEnvironment: .live)
        let hostingController = NSHostingController(rootView: rootView)
        hostingController.view.wantsLayer = true
        hostingController.view.layer?.backgroundColor = NSColor.clear.cgColor
        self.window?.contentViewController = hostingController
        self.hostedShellStateID = shellStateID
        self.hostedAppStateID = appStateID
    }

    private func installDismissMonitor() {
        if ProcessInfo.processInfo.isRunningTests { return }
        guard self.dismissMonitor == nil, self.window != nil else { return }
        self.dismissMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown])
        { [weak self] _ in
            guard let self, let window = self.window else { return }
            if !window.frame.contains(NSEvent.mouseLocation) {
                self.close()
            }
        }
    }

    private func removeDismissMonitor() {
        OverlayPanelFactory.clearGlobalEventMonitor(&self.dismissMonitor)
    }

    @discardableResult
    private func reposition(using anchorProvider: @escaping () -> NSRect?) -> NSRect {
        guard let window else { return .zero }
        guard let anchor = anchorProvider() else {
            let frame = WindowPlacement.topRightFrame(
                size: AlisioWorkspaceLayout.panelSize,
                padding: AlisioWorkspaceLayout.anchorPadding)
            window.setFrame(frame, display: false)
            return frame
        }
        let screen = NSScreen.screens.first { screen in
            screen.frame.contains(anchor.origin) || screen.frame.contains(NSPoint(x: anchor.midX, y: anchor.midY))
        } ?? NSScreen.main
        let bounds = (screen?.visibleFrame ?? .zero).insetBy(
            dx: AlisioWorkspaceLayout.anchorPadding,
            dy: AlisioWorkspaceLayout.anchorPadding)
        let frame = WindowPlacement.anchoredBelowFrame(
            size: AlisioWorkspaceLayout.panelSize,
            anchor: anchor,
            padding: AlisioWorkspaceLayout.anchorPadding,
            in: bounds)
        window.setFrame(frame, display: false)
        return frame
    }

    private static func makeWindow(for presentation: AlisioWorkspacePresentation) -> NSWindow {
        switch presentation {
        case .window:
            let window = NSWindow(
                contentRect: NSRect(origin: .zero, size: AlisioWorkspaceLayout.windowSize),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered,
                defer: false)
            window.title = "Alisio"
            window.identifier = NSUserInterfaceItemIdentifier(AlisioBrand.subsystem("alisio-workspace-window"))
            window.isReleasedWhenClosed = false
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.toolbarStyle = .unifiedCompact
            window.minSize = AlisioWorkspaceLayout.windowMinSize
            window.setContentSize(AlisioWorkspaceLayout.windowSize)
            window.center()
            return window
        case .panel:
            let panel = AlisioWorkspacePanel(
                contentRect: NSRect(origin: .zero, size: AlisioWorkspaceLayout.panelSize),
                styleMask: [.borderless],
                backing: .buffered,
                defer: false)
            panel.level = .statusBar
            panel.hidesOnDeactivate = true
            panel.hasShadow = true
            panel.isMovable = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.titleVisibility = .hidden
            panel.titlebarAppearsTransparent = true
            panel.backgroundColor = .clear
            panel.isOpaque = false
            panel.becomesKeyOnlyIfNeeded = true
            panel.setFrame(
                WindowPlacement.topRightFrame(
                    size: AlisioWorkspaceLayout.panelSize,
                    padding: AlisioWorkspaceLayout.anchorPadding),
                display: false)
            return panel
        }
    }

    private func ensureWindowSize() {
        guard case .window = self.presentation, let window else { return }
        let current = window.frame.size
        let min = AlisioWorkspaceLayout.windowMinSize
        if current.width < min.width || current.height < min.height {
            let frame = WindowPlacement.centeredFrame(size: AlisioWorkspaceLayout.windowSize)
            window.setFrame(frame, display: false)
        }
    }

    func windowShouldClose(_: NSWindow) -> Bool {
        self.close()
        return false
    }

    func windowDidMiniaturize(_: Notification) {
        self.onVisibilityChanged?(false)
    }

    func windowDidDeminiaturize(_: Notification) {
        self.onVisibilityChanged?(true)
    }

    func windowDidBecomeKey(_: Notification) {
        self.onVisibilityChanged?(true)
    }

    func windowDidResignKey(_: Notification) {
        if self.window?.isVisible == true {
            self.onVisibilityChanged?(true)
        }
    }
}
