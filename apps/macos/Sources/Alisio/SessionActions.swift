import AppKit
import Foundation

import AlisioSupport
enum SessionActions {
    static func createSession(
        parentSessionKey: String? = nil,
        agentId: String? = nil,
        label: String? = nil,
        model: String? = nil,
        initialMessage: String? = nil) async throws -> AlisioChatSessionCreateResponse
    {
        try await GatewayConnection.shared.sessionsCreate(
            parentSessionKey: parentSessionKey,
            agentId: agentId,
            label: label,
            model: model,
            task: initialMessage)
    }

    static func patchSession(
        key: String,
        thinking: GatewayConnection.SessionPatchValue<String> = .unchanged,
        verbose: GatewayConnection.SessionPatchValue<String> = .unchanged) async throws
    {
        try await GatewayConnection.shared.sessionsPatch(
            key: key,
            thinkingLevel: thinking,
            verboseLevel: verbose)
    }

    static func resetSession(key: String) async throws {
        try await GatewayConnection.shared.sessionsReset(key: key)
    }

    static func deleteSession(key: String) async throws {
        try await GatewayConnection.shared.sessionsDelete(key: key)
    }

    static func compactSession(key: String, maxLines: Int = 400) async throws {
        try await GatewayConnection.shared.sessionsCompact(key: key, maxLines: maxLines)
    }

    @MainActor
    static func confirmDestructiveAction(title: String, message: String, action: String) -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: action)
        alert.addButton(withTitle: "Cancel")
        alert.alertStyle = .warning
        return alert.runModal() == .alertFirstButtonReturn
    }

    @MainActor
    static func presentError(title: String, error: Error) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        alert.addButton(withTitle: "OK")
        alert.alertStyle = .warning
        alert.runModal()
    }

    @MainActor
    static func openSessionLogInCode(sessionId: String, storePath: String?) {
        let candidates: [URL] = {
            var urls: [URL] = []
            if let storePath, !storePath.isEmpty {
                let dir = URL(fileURLWithPath: storePath).deletingLastPathComponent()
                urls.append(dir.appendingPathComponent("\(sessionId).jsonl"))
            }
            urls.append(AlisioPaths.stateDirURL.appendingPathComponent("sessions/\(sessionId).jsonl"))
            return urls
        }()

        let existing = candidates.first(where: { FileManager().fileExists(atPath: $0.path) })
        guard let url = existing else {
            let alert = NSAlert()
            alert.messageText = "Session log not found"
            alert.informativeText = sessionId
            alert.runModal()
            return
        }

        let proc = Process()
        proc.launchPath = "/usr/bin/env"
        proc.arguments = ["code", url.path]
        if (try? proc.run()) != nil {
            return
        }

        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
}
