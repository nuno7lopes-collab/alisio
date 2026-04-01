import AppKit
import Foundation

/// A borderless panel that can still accept key focus (needed for typing).
final class WebChatPanel: NSPanel {
    override var canBecomeKey: Bool {
        true
    }

    override var canBecomeMain: Bool {
        true
    }
}

enum WebChatPresentation {
    case window
    case panel(anchorProvider: () -> NSRect?)

    var isPanel: Bool {
        if case .panel = self { return true }
        return false
    }
}

@MainActor
final class WebChatManager {
    static let shared = WebChatManager()

    private var panelController: LumeWorkspaceWindowController?
    private var panelSessionKey: String?
    private var cachedPreferredSessionKey: String?

    var onPanelVisibilityChanged: ((Bool) -> Void)?

    var activeSessionKey: String? {
        self.panelSessionKey ?? LumeWindowManager.shared.activeSessionKey
    }

    func show(sessionKey: String) {
        self.cachedPreferredSessionKey = sessionKey
        self.closePanel()
        LumeWindowManager.shared.showChat(sessionKey: sessionKey)
    }

    func togglePanel(sessionKey: String, anchorProvider: @escaping () -> NSRect?) {
        if let controller = self.panelController {
            if self.panelSessionKey != sessionKey {
                controller.close()
                self.panelController = nil
                self.panelSessionKey = nil
            } else {
                if controller.isVisible {
                    controller.close()
                } else {
                    controller.show(shellState: self.panelShellState(sessionKey: sessionKey))
                }
                return
            }
        }

        let controller = LumeWorkspaceWindowController(presentation: .panel(anchorProvider: anchorProvider))
        controller.onClosed = { [weak self] in
            self?.panelHidden()
        }
        controller.onVisibilityChanged = { [weak self] visible in
            self?.onPanelVisibilityChanged?(visible)
        }
        self.panelController = controller
        self.panelSessionKey = sessionKey
        controller.show(shellState: self.panelShellState(sessionKey: sessionKey))
    }

    func closePanel() {
        self.panelController?.close()
    }

    func preferredSessionKey() async -> String {
        if let cachedPreferredSessionKey { return cachedPreferredSessionKey }
        let key = await GatewayConnection.shared.mainSessionKey()
        self.cachedPreferredSessionKey = key
        return key
    }

    func resetTunnels() {
        self.panelController?.close()
        self.panelController = nil
        self.panelSessionKey = nil
        self.cachedPreferredSessionKey = nil
    }

    func close() {
        self.resetTunnels()
    }

    private func panelHidden() {
        self.onPanelVisibilityChanged?(false)
        // Keep panel controller cached so reopening doesn't re-bootstrap.
    }

    private func panelShellState(sessionKey: String) -> LumeShellState {
        let shellState = LumeShellState()
        shellState.completeOnboarding(preferredSessionKey: sessionKey)
        shellState.showChat(sessionKey: sessionKey)
        return shellState
    }
}
