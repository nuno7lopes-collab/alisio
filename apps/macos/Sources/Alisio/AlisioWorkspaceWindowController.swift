import AppKit
import Foundation
import OSLog
import WebKit

import AlisioSupport
private let alisioWorkspaceLogger = Logger(subsystem: AlisioBrand.logSubsystem, category: "AlisioWorkspace")

private enum AlisioWorkspaceLayout {
    static let windowSize = NSSize(width: 1360, height: 860)
    static let windowMinSize = NSSize(width: 1120, height: 760)
    static let panelSize = NSSize(width: 480, height: 640)
    static let anchorPadding: CGFloat = 8
}

private enum AlisioWorkspaceBootstrap {
    static let readyEventName = "alisio-ui-ready"
    static let messageHandlerName = "alisioWorkspaceBootstrap"
    static let timeoutNanoseconds: UInt64 = 12_000_000_000

    static let script = #"""
    (() => {
      if (globalThis.__alisioWorkspaceBootstrapInstalled) return;
      globalThis.__alisioWorkspaceBootstrapInstalled = true;
      const handler = globalThis.webkit?.messageHandlers?.alisioWorkspaceBootstrap;
      if (!handler?.postMessage) return;

      const post = (payload) => {
        try {
          handler.postMessage(payload);
        } catch {}
      };

      globalThis.addEventListener("error", (event) => {
        post({
          type: "error",
          message: event?.message || "Unknown workspace bootstrap error",
          source: event?.filename || "",
          line: event?.lineno || 0,
          column: event?.colno || 0,
        });
      });

      globalThis.addEventListener("unhandledrejection", (event) => {
        const reason = event?.reason;
        const message =
          typeof reason === "string"
            ? reason
            : typeof reason?.message === "string"
              ? reason.message
              : "Unhandled workspace promise rejection";
        post({ type: "error", message });
      });

      globalThis.addEventListener("alisio-ui-ready", () => {
        post({ type: "ready" });
      }, { once: true });
    })();
    """#
}

@MainActor
final class AlisioWorkspaceWindowController:
    NSWindowController,
    WKNavigationDelegate,
    WKUIDelegate,
    WKScriptMessageHandler,
    NSWindowDelegate
{
    private let presentation: AlisioWorkspacePresentation
    let webView: WKWebView
    private let hostBridge = AlisioHostBridge()
    private var dismissMonitor: Any?
    private var bootstrapTracker = AlisioWorkspaceBootstrapTracker()
    private var navigationTask: Task<Void, Never>?
    private var bootstrapTimeoutTask: Task<Void, Never>?
    private var bootstrapRetryTask: Task<Void, Never>?
    private var lastShellState: AlisioShellState?
    private var lastAppState: AppState?

    var onClosed: (() -> Void)?
    var onVisibilityChanged: ((Bool) -> Void)?

    init(presentation: AlisioWorkspacePresentation) {
        self.presentation = presentation

        let config = WKWebViewConfiguration()
        let userContentController = WKUserContentController()
        config.userContentController = userContentController
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        userContentController.addUserScript(WKUserScript(
            source: AlisioWorkspaceBootstrap.script,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")
        self.webView = webView
        self.hostBridge.install(on: userContentController, webView: webView)

        let contentController = Self.makeContentController(for: presentation, webView: webView)
        let window = Self.makeWindow(for: presentation, contentViewController: contentController)
        super.init(window: window)

        userContentController.add(self, name: AlisioWorkspaceBootstrap.messageHandlerName)
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

    func show(shellState: AlisioShellState, state: AppState = AppStateStore.shared) {
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

    func navigate(shellState: AlisioShellState, state: AppState = AppStateStore.shared) {
        self.lastShellState = shellState
        self.lastAppState = state
        self.navigationTask?.cancel()
        self.navigationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let url = try await AlisioWorkspaceURL.resolve(shellState: shellState, appState: state)
                guard !Task.isCancelled else { return }
                if !self.bootstrapTracker.shouldLoad(resolvedURL: url, currentWebViewURL: self.webView.url) {
                    return
                }
                self.cancelBootstrapTimeout()
                self.cancelBootstrapRetry()
                self.webView.load(URLRequest(url: url))
            } catch {
                self.bootstrapTracker.noteResolveError()
                self.cancelBootstrapTimeout()
                self.cancelBootstrapRetry()
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

    private func scheduleBootstrapTimeout() {
        self.cancelBootstrapTimeout()
        self.bootstrapTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: AlisioWorkspaceBootstrap.timeoutNanoseconds)
            guard let self,
                  !Task.isCancelled,
                  self.bootstrapTracker.awaitingReady
            else { return }
            let currentURL = self.currentWorkspaceURLString()
            alisioWorkspaceLogger.error("Workspace bootstrap timed out for \(currentURL, privacy: .public)")
            self.handleBootstrapFailure(
                message:
                    "The workspace UI did not finish loading. Check the local gateway logs and reload the app.\nURL: \(currentURL)"
            )
        }
    }

    private func cancelBootstrapTimeout() {
        self.bootstrapTimeoutTask?.cancel()
        self.bootstrapTimeoutTask = nil
    }

    private func scheduleBootstrapRetry(url: URL, attempt: Int, delayNanoseconds: UInt64) {
        self.cancelBootstrapRetry()
        let retryBudget = self.bootstrapTracker.retryBudget
        self.bootstrapRetryTask = Task { @MainActor [weak self] in
            guard let self else { return }
            alisioWorkspaceLogger.warning(
                "Retrying workspace bootstrap attempt \(attempt, privacy: .public)/\(retryBudget, privacy: .public) for \(url.absoluteString, privacy: .public)")
            try? await Task.sleep(nanoseconds: delayNanoseconds)
            guard !Task.isCancelled else { return }
            guard let shellState = self.lastShellState,
                  let appState = self.lastAppState
            else { return }
            self.navigate(shellState: shellState, state: appState)
        }
    }

    private func cancelBootstrapRetry() {
        self.bootstrapRetryTask?.cancel()
        self.bootstrapRetryTask = nil
    }

    private func currentWorkspaceURLString() -> String {
        self.webView.url?.absoluteString ?? self.bootstrapTracker.resolvedURL?.absoluteString ?? "unknown"
    }

    private func handleBootstrapFailure(message: String) {
        self.cancelBootstrapTimeout()
        switch self.bootstrapTracker.noteFailure() {
        case let .retry(url, attempt, delayNanoseconds):
            self.scheduleBootstrapRetry(url: url, attempt: attempt, delayNanoseconds: delayNanoseconds)
        case .showFallback:
            self.cancelBootstrapRetry()
            self.loadBridgeErrorPage(message: message)
        }
    }

    private func loadNavigationFailurePage(context: String, error: Error) {
        guard !Self.isCancelledNavigationError(error) else { return }
        self.cancelBootstrapTimeout()
        let currentURL = self.currentWorkspaceURLString()
        alisioWorkspaceLogger.error(
            "\(context, privacy: .public) failed for \(currentURL, privacy: .public): \(error.localizedDescription, privacy: .public)")
        self.handleBootstrapFailure(
            message:
                "\(context) failed while loading the workspace.\nURL: \(currentURL)\n\(error.localizedDescription)"
        )
    }

    private static func isCancelledNavigationError(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return true }
        return false
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

    private static func makeWindow(
        for presentation: AlisioWorkspacePresentation,
        contentViewController: NSViewController) -> NSWindow
    {
        switch presentation {
        case .window:
            let window = NSWindow(
                contentRect: NSRect(origin: .zero, size: AlisioWorkspaceLayout.windowSize),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered,
                defer: false)
            window.title = "Alisio"
            window.identifier = NSUserInterfaceItemIdentifier(AlisioBrand.subsystem("alisio-workspace-window"))
            window.contentViewController = contentViewController
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
            panel.contentViewController = contentViewController
            panel.becomesKeyOnlyIfNeeded = true
            panel.setFrame(
                WindowPlacement.topRightFrame(
                    size: AlisioWorkspaceLayout.panelSize,
                    padding: AlisioWorkspaceLayout.anchorPadding),
                display: false)
            return panel
        }
    }

    private static func makeContentController(
        for presentation: AlisioWorkspacePresentation,
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
        let min = AlisioWorkspaceLayout.windowMinSize
        if current.width < min.width || current.height < min.height {
            let frame = WindowPlacement.centeredFrame(size: AlisioWorkspaceLayout.windowSize)
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
            alisioWorkspaceLogger.debug("No application registered for \(url.absoluteString, privacy: .public)")
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

        if let scheme = url.scheme?.lowercased(), scheme == "alisio" || scheme == "alisio" {
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

    func webView(_: WKWebView, didStartProvisionalNavigation _: WKNavigation?) {
        if self.bootstrapTracker.resolvedURL != nil {
            self.bootstrapTracker.noteNavigationStarted()
            self.scheduleBootstrapTimeout()
        }
    }

    func webView(_: WKWebView, didFinish _: WKNavigation?) {
        let currentURL = self.currentWorkspaceURLString()
        alisioWorkspaceLogger.debug("Workspace navigation finished for \(currentURL, privacy: .public)")
    }

    func webView(_: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
        guard navigation != nil else { return }
        self.loadNavigationFailurePage(context: "Navigation", error: error)
    }

    func webView(_: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        guard navigation != nil else { return }
        self.loadNavigationFailurePage(context: "Provisional navigation", error: error)
    }

    nonisolated func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
        Task { @MainActor [weak self] in
            self?.handleBootstrapMessage(message)
        }
    }

    private func handleBootstrapMessage(_ message: WKScriptMessage) {
        guard message.name == AlisioWorkspaceBootstrap.messageHandlerName,
              let payload = message.body as? [String: Any],
              let type = payload["type"] as? String
        else { return }
        switch type {
        case "ready":
            self.bootstrapTracker.noteReady()
            self.cancelBootstrapTimeout()
            self.cancelBootstrapRetry()
        case "error":
            guard self.bootstrapTracker.awaitingReady else { return }
            let source = (payload["source"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let line = payload["line"] as? Int ?? 0
            let column = payload["column"] as? Int ?? 0
            let rawMessage = (payload["message"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let messageText = rawMessage?.isEmpty == false ? rawMessage! : "Unknown workspace bootstrap error"
            let location = source?.isEmpty == false ? "\nSource: \(source!)\(line > 0 ? ":\(line)" : "")\(column > 0 ? ":\(column)" : "")" : ""
            self.handleBootstrapFailure(message: "The workspace UI crashed while loading.\n\(messageText)\(location)")
        default:
            return
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
