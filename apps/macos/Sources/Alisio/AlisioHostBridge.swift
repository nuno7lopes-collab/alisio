import AppKit
import Foundation
import AlisioIPC
import WebKit

import AlisioSupport
@MainActor
final class AlisioHostBridge: NSObject {
    static let messageHandlerName = "alisioHost"

    private weak var webView: WKWebView?
    private weak var userContentController: WKUserContentController?

    func install(on userContentController: WKUserContentController, webView: WKWebView) {
        self.userContentController = userContentController
        self.webView = webView
        userContentController.addUserScript(WKUserScript(
            source: Self.bootstrapScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))
        userContentController.add(self, name: Self.messageHandlerName)
    }

    private static let bootstrapScript = #"""
    (() => {
      if (globalThis.alisioHost?.request) return;
      let nextId = 1;
      const pending = new Map();

      globalThis.__alisioHostResolve = (id, payload) => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        entry.resolve(payload);
      };

      globalThis.__alisioHostReject = (id, message) => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        entry.reject(new Error(message || "Native Alisio host request failed"));
      };

      const hostBridge = {
        request(method, params = {}) {
          return new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            const handler = globalThis.webkit?.messageHandlers?.alisioHost;
            if (!handler?.postMessage) {
              pending.delete(id);
              reject(new Error("Native Alisio host bridge unavailable"));
              return;
            }
            handler.postMessage({ id, method, params });
          });
        },
      };
      globalThis.alisioHost = hostBridge;
    })();
    """#
}

extension AlisioHostBridge: WKScriptMessageHandler {
    nonisolated func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
        Task { @MainActor [weak self] in
            await self?.handle(message)
        }
    }

    private func handle(_ message: WKScriptMessage) async {
        guard message.name == Self.messageHandlerName else { return }
        guard let body = message.body as? [String: Any] else { return }
        let id = (body["id"] as? NSNumber)?.intValue ?? -1
        guard id >= 0, let method = body["method"] as? String else { return }
        let params = body["params"] as? [String: Any] ?? [:]

        do {
            let payload = try await self.dispatch(method: method, params: params)
            self.resolve(id: id, payload: payload)
        } catch {
            self.reject(id: id, message: error.localizedDescription)
        }
    }

    private func dispatch(method: String, params: [String: Any]) async throws -> Any {
        switch method {
        case "getShellState":
            return await self.shellStatePayload()
        case "getPermissions":
            return await self.permissionsPayload()
        case "requestPermission":
            return try await self.requestPermission(params)
        case "setLaunchAtLogin":
            return try await self.setLaunchAtLogin(params)
        case "getVoiceWake":
            return self.voiceWakePayload()
        case "setVoiceWake":
            return try await self.setVoiceWake(params)
        case "openNativeSettings":
            self.openNativeSettings(params)
            return ["ok": true]
        case "rebuildAppFromCheckout":
            return try await self.rebuildAppFromCheckout()
        case "openExternal":
            try self.openExternal(params)
            return ["ok": true]
        case "revealLogs":
            DebugActions.openLog()
            return ["ok": true]
        default:
            throw AlisioHostBridgeError.unknownMethod(method)
        }
    }

    private func requestPermission(_ params: [String: Any]) async throws -> Any {
        guard let raw = params["permission"] as? String,
              let capability = Capability(rawValue: raw)
        else {
            throw AlisioHostBridgeError.invalidParams("Missing or invalid permission")
        }
        let result = await PermissionManager.ensure([capability], interactive: true)
        return self.mapPermissions(result)
    }

    private func setLaunchAtLogin(_ params: [String: Any]) async throws -> Any {
        guard let enabled = params["enabled"] as? Bool else {
            throw AlisioHostBridgeError.invalidParams("Missing launch-at-login value")
        }
        await LaunchAgentManager.set(enabled: enabled, bundlePath: Bundle.main.bundlePath)
        return await self.shellStatePayload()
    }

    private func setVoiceWake(_ params: [String: Any]) async throws -> Any {
        if let enabled = params["enabled"] as? Bool {
            await AppStateStore.shared.setVoiceWakeEnabled(enabled)
        }
        if let talkEnabled = params["talkEnabled"] as? Bool {
            await AppStateStore.shared.setTalkEnabled(talkEnabled)
        }
        if let triggers = params["triggers"] as? [String] {
            let sanitized = sanitizeVoiceWakeTriggers(triggers)
            AppStateStore.shared.applyGlobalVoiceWakeTriggers(sanitized)
            await GatewayConnection.shared.voiceWakeSetTriggers(sanitized)
        }
        return self.voiceWakePayload()
    }

    private func openNativeSettings(_ params: [String: Any]) {
        let section = (params["section"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let tab = Self.settingsTab(for: section)
        SettingsWindowOpener.shared.open(tab: tab)
    }

    private func rebuildAppFromCheckout() async throws -> [String: Any] {
        let result = await DebugActions.rebuildAppFromCheckout()
        switch result {
        case .success:
            return ["ok": true]
        case let .failure(error):
            throw AlisioHostBridgeError.actionFailed(error.localizedDescription)
        }
    }

    private func openExternal(_ params: [String: Any]) throws {
        guard let raw = params["url"] as? String,
              let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines))
        else {
            throw AlisioHostBridgeError.invalidParams("Missing URL")
        }
        NSWorkspace.shared.open(url)
    }

    private func shellStatePayload() async -> [String: Any] {
        [
            "platform": "macos",
            "launchAtLogin": await LaunchAgentManager.status(),
            "permissions": await self.permissionsPayload(),
            "voiceWake": self.voiceWakePayload(),
            "logsPath": DebugActions.pinoLogPath(),
            "developerCheckoutAvailable": CommandResolver.developerCheckoutRoot() != nil,
        ]
    }

    private func voiceWakePayload() -> [String: Any] {
        [
            "supported": voiceWakeSupported,
            "enabled": AppStateStore.shared.swabbleEnabled,
            "talkEnabled": AppStateStore.shared.talkEnabled,
            "triggers": AppStateStore.shared.swabbleTriggerWords,
        ]
    }

    private func permissionsPayload() async -> [String: Bool] {
        self.mapPermissions(await PermissionManager.status())
    }

    private func mapPermissions(_ source: [Capability: Bool]) -> [String: Bool] {
        var payload: [String: Bool] = [:]
        for capability in Capability.allCases {
            payload[capability.rawValue] = source[capability] ?? false
        }
        return payload
    }

    private func resolve(id: Int, payload: Any) {
        guard let script = self.responseScript(function: "__alisioHostResolve", id: id, payload: payload) else {
            self.reject(id: id, message: "Failed to encode native host response")
            return
        }
        self.webView?.evaluateJavaScript(script, completionHandler: nil)
    }

    private func reject(id: Int, message: String) {
        guard let json = self.jsonString(["message": message]) else { return }
        let script = "window.__alisioHostReject(\(id), \(json).message);"
        self.webView?.evaluateJavaScript(script, completionHandler: nil)
    }

    private func responseScript(function: String, id: Int, payload: Any) -> String? {
        guard let json = self.jsonString(payload) else { return nil }
        return "window.\(function)(\(id), \(json));"
    }

    private func jsonString(_ payload: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        return json
    }

    private static func settingsTab(for rawSection: String?) -> SettingsTab {
        switch rawSection?.lowercased() {
        case "communications":
            .channels
        case "appearance":
            .general
        case "automation":
            .cron
        case "infrastructure":
            .config
        case "aiagents", "ai-agents":
            .skills
        case "mac":
            .permissions
        case "debug":
            .debug
        case "logs":
            .debug
        default:
            .general
        }
    }
}

private enum AlisioHostBridgeError: LocalizedError {
    case invalidParams(String)
    case unknownMethod(String)
    case actionFailed(String)

    var errorDescription: String? {
        switch self {
        case let .invalidParams(message):
            message
        case let .unknownMethod(method):
            "Unknown native host method: \(method)"
        case let .actionFailed(message):
            message
        }
    }
}
