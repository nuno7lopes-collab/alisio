import AppKit
import Foundation
import OSLog
import WebKit

private let lumeWorkspaceLogger = Logger(subsystem: "ai.openclaw", category: "LumeWorkspace")

private enum LumeWorkspaceLayout {
    static let windowSize = NSSize(width: 1360, height: 860)
    static let windowMinSize = NSSize(width: 1120, height: 760)
    static let panelSize = NSSize(width: 480, height: 640)
    static let anchorPadding: CGFloat = 8
}

@MainActor
final class LumeWorkspaceWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    private let presentation: LumeWorkspacePresentation
    let webView: WKWebView
    private let hostBridge = LumeHostBridge()
    private var dismissMonitor: Any?
    private var lastResolvedURL: URL?
    private var navigationTask: Task<Void, Never>?

    var onClosed: (() -> Void)?
    var onVisibilityChanged: ((Bool) -> Void)?

    init(presentation: LumeWorkspacePresentation) {
        self.presentation = presentation

        let config = WKWebViewConfiguration()
        let userContentController = WKUserContentController()
        config.userContentController = userContentController
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")
        self.webView = webView
        self.hostBridge.install(on: userContentController, webView: webView)

        let contentController = Self.makeContentController(for: presentation, webView: webView)
        let window = Self.makeWindow(for: presentation, contentViewController: contentController)
        super.init(window: window)

        self.webView.navigationDelegate = self
        self.webView.uiDelegate = self
        self.window?.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    var isVisible: Bool {
        self.window?.isVisible ?? false
    }

    func show(shellState: LumeShellState, state: AppState = AppStateStore.shared) {
        self.navigate(shellState: shellState, state: state)
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

    func navigate(shellState: LumeShellState, state: AppState = AppStateStore.shared) {
        self.navigationTask?.cancel()
        self.navigationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let url = try await LumeWorkspaceURL.resolve(shellState: shellState, appState: state)
                guard !Task.isCancelled else { return }
                if self.lastResolvedURL?.absoluteString == url.absoluteString {
                    return
                }
                self.lastResolvedURL = url
                self.webView.load(URLRequest(url: url))
            } catch {
                self.lastResolvedURL = nil
                self.loadBridgeErrorPage(message: error.localizedDescription)
            }
        }
    }

    private func loadBridgeErrorPage(message: String) {
        let escaped = message
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let html = """
        <!doctype html>
        <html lang="en">
          <meta charset="utf-8">
          <title>Alisio</title>
          <style>
            :root { color-scheme: dark; }
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #0d0d11;
              color: #f2f2f4;
              font: 14px/1.6 -apple-system, BlinkMacSystemFont, sans-serif;
            }
            .card {
              width: min(560px, calc(100vw - 48px));
              padding: 24px;
              border-radius: 20px;
              background: rgba(255, 255, 255, 0.04);
              border: 1px solid rgba(255, 255, 255, 0.08);
            }
            h1 { margin: 0 0 8px; font-size: 22px; }
            p { margin: 0; color: rgba(242, 242, 244, 0.72); }
            code {
              display: block;
              margin-top: 14px;
              white-space: pre-wrap;
              color: #fff;
            }
          </style>
          <body>
            <section class="card">
              <h1>Alisio workspace unavailable</h1>
              <p>The native shell could not resolve the gateway workspace.</p>
              <code>\(escaped)</code>
            </section>
          </body>
        </html>
        """
        self.webView.loadHTMLString(html, baseURL: nil)
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
    private func reposition(using anchorProvider: () -> NSRect?) -> NSRect {
        guard let window else { return .zero }
        guard let anchor = anchorProvider() else {
            let frame = WindowPlacement.topRightFrame(
                size: LumeWorkspaceLayout.panelSize,
                padding: LumeWorkspaceLayout.anchorPadding)
            window.setFrame(frame, display: false)
            return frame
        }
        let screen = NSScreen.screens.first { screen in
            screen.frame.contains(anchor.origin) || screen.frame.contains(NSPoint(x: anchor.midX, y: anchor.midY))
        } ?? NSScreen.main
        let bounds = (screen?.visibleFrame ?? .zero).insetBy(
            dx: LumeWorkspaceLayout.anchorPadding,
            dy: LumeWorkspaceLayout.anchorPadding)
        let frame = WindowPlacement.anchoredBelowFrame(
            size: LumeWorkspaceLayout.panelSize,
            anchor: anchor,
            padding: LumeWorkspaceLayout.anchorPadding,
            in: bounds)
        window.setFrame(frame, display: false)
        return frame
    }

    private static func makeWindow(
        for presentation: LumeWorkspacePresentation,
        contentViewController: NSViewController) -> NSWindow
    {
        switch presentation {
        case .window:
            let window = NSWindow(
                contentRect: NSRect(origin: .zero, size: LumeWorkspaceLayout.windowSize),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered,
                defer: false)
            window.title = "Alisio"
            window.identifier = NSUserInterfaceItemIdentifier("ai.openclaw.lume-workspace-window")
            window.contentViewController = contentViewController
            window.isReleasedWhenClosed = false
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.toolbarStyle = .unifiedCompact
            window.minSize = LumeWorkspaceLayout.windowMinSize
            window.setContentSize(LumeWorkspaceLayout.windowSize)
            window.center()
            return window
        case .panel:
            let panel = LumeWorkspacePanel(
                contentRect: NSRect(origin: .zero, size: LumeWorkspaceLayout.panelSize),
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
            panel.contentViewController = contentViewController
            panel.becomesKeyOnlyIfNeeded = true
            panel.setFrame(
                WindowPlacement.topRightFrame(
                    size: LumeWorkspaceLayout.panelSize,
                    padding: LumeWorkspaceLayout.anchorPadding),
                display: false)
            return panel
        }
    }

    private static func makeContentController(
        for presentation: LumeWorkspacePresentation,
        webView: WKWebView) -> NSViewController
    {
        let controller = NSViewController()
        let effectView = NSVisualEffectView()
        effectView.material = .sidebar
        effectView.blendingMode = presentation.isPanel ? .withinWindow : .behindWindow
        effectView.state = .active
        effectView.wantsLayer = true
        effectView.layer?.cornerCurve = .continuous
        effectView.layer?.cornerRadius = presentation.isPanel ? 18 : 0
        effectView.layer?.masksToBounds = true

        effectView.translatesAutoresizingMaskIntoConstraints = true
        effectView.autoresizingMask = [.width, .height]
        webView.translatesAutoresizingMaskIntoConstraints = false

        controller.view = effectView
        effectView.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: effectView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: effectView.trailingAnchor),
            webView.topAnchor.constraint(equalTo: effectView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: effectView.bottomAnchor),
        ])

        return controller
    }

    private func ensureWindowSize() {
        guard case .window = self.presentation, let window else { return }
        let current = window.frame.size
        let min = LumeWorkspaceLayout.windowMinSize
        if current.width < min.width || current.height < min.height {
            let frame = WindowPlacement.centeredFrame(size: LumeWorkspaceLayout.windowSize)
            window.setFrame(frame, display: false)
        }
    }

    private func shouldKeepNavigationInsideWorkspace(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "about" || scheme == "blob" || scheme == "data" || scheme == "javascript" {
            return true
        }
        guard scheme == "http" || scheme == "https" else { return false }
        guard let current = self.webView.url else { return true }
        let sameOrigin = current.scheme?.lowercased() == scheme
            && current.host?.lowercased() == url.host?.lowercased()
            && current.port == url.port
        return sameOrigin
    }

    private func openExternallyIfPossible(_ url: URL) {
        guard let appURL = NSWorkspace.shared.urlForApplication(toOpen: url) else {
            lumeWorkspaceLogger.debug("No application registered for \(url.absoluteString, privacy: .public)")
            return
        }
        NSWorkspace.shared.open(
            [url],
            withApplicationAt: appURL,
            configuration: NSWorkspace.OpenConfiguration(),
            completionHandler: nil)
    }

    func webView(
        _: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void)
    {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if let scheme = url.scheme?.lowercased(), scheme == "alisio" || scheme == "openclaw" {
            Task { await DeepLinkHandler.shared.handle(url: url) }
            decisionHandler(.cancel)
            return
        }

        if self.shouldKeepNavigationInsideWorkspace(url) {
            decisionHandler(.allow)
            return
        }

        self.openExternallyIfPossible(url)
        decisionHandler(.cancel)
    }

    func webView(
        _: WKWebView,
        createWebViewWith _: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures _: WKWindowFeatures) -> WKWebView?
    {
        if let url = navigationAction.request.url {
            if self.shouldKeepNavigationInsideWorkspace(url) {
                self.webView.load(navigationAction.request)
            } else {
                self.openExternallyIfPossible(url)
            }
        }
        return nil
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
