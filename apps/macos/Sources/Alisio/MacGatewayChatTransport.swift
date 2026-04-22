import AlisioChatUI
import AlisioKit
import AlisioProtocol
import Foundation
import OSLog

import AlisioSupport
struct MacGatewayChatTransport: AlisioChatTransport, Sendable {
    private static let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "desktop.chat.transport")

    func requestHistory(sessionKey: String) async throws -> AlisioChatHistoryPayload {
        return try await GatewayConnection.shared.chatHistory(sessionKey: sessionKey)
    }

    func listModels() async throws -> [AlisioChatModelChoice] {
        try await self.ensureLocalGatewayReadyIfNeeded(reason: "models.list")
        let decoded: ModelsListResult = try await GatewayConnection.shared.requestDecoded(method: .modelsList)
        return decoded.models.map { model in
            AlisioChatModelChoice(
                modelID: model.id,
                name: model.name,
                provider: model.provider,
                contextWindow: model.contextwindow)
        }
    }

    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [AlisioChatAttachmentPayload]) async throws -> AlisioChatSendResponse
    {
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        Self.logger.info(
            "chat.send start session=\(sessionKey, privacy: .public) len=\(trimmedMessage.count, privacy: .public) " +
                "attachments=\(attachments.count, privacy: .public)")
        do {
            let response = try await GatewayConnection.shared.chatSend(
                sessionKey: sessionKey,
                message: message,
                thinking: thinking,
                idempotencyKey: idempotencyKey,
                attachments: attachments)
            Self.logger.info("chat.send ok runId=\(response.runId, privacy: .public)")
            return response
        } catch {
            Self.logger.error("chat.send failed \(error.localizedDescription, privacy: .public)")
            throw error
        }
    }

    func abortRun(sessionKey: String, runId: String) async throws {
        _ = try await GatewayConnection.shared.chatAbort(sessionKey: sessionKey, runId: runId)
    }

    func listSessions(limit: Int?) async throws -> AlisioChatSessionsListResponse {
        try await GatewayConnection.shared.sessionsList(
            includeGlobal: true,
            includeUnknown: false,
            limit: limit)
    }

    func setSessionModel(sessionKey: String, model: String?) async throws {
        try await GatewayConnection.shared.sessionsPatch(
            key: sessionKey,
            model: model.map(GatewayConnection.SessionPatchValue.set) ?? .clear)
    }

    func setSessionThinking(sessionKey: String, thinkingLevel: String) async throws {
        try await GatewayConnection.shared.sessionsPatch(
            key: sessionKey,
            thinkingLevel: .set(thinkingLevel))
    }

    func requestHealth(timeoutMs: Int) async throws -> Bool {
        try await GatewayConnection.shared.healthOK(timeoutMs: timeoutMs)
    }

    func events() -> AsyncStream<AlisioChatTransportEvent> {
        AsyncStream { continuation in
            let task = Task {
                let stream = await GatewayConnection.shared.subscribe(bufferingNewest: 200)
                for await push in stream {
                    if Task.isCancelled { return }
                    switch push {
                    case .snapshot:
                        continuation.yield(.health(ok: true))
                    case .seqGap(_, _):
                        continuation.yield(.seqGap)
                    case let .event(event):
                        switch event.event {
                        case "tick":
                            continuation.yield(.tick)
                        case "health":
                            guard let payload = event.payload else { break }
                            let ok = (try? GatewayPayloadDecoding.decode(
                                payload,
                                as: AlisioGatewayHealthOK.self))?.ok ?? true
                            continuation.yield(.health(ok: ok))
                        case "chat":
                            guard let payload = event.payload,
                                  let decoded = try? GatewayPayloadDecoding.decode(
                                      payload,
                                      as: AlisioChatEventPayload.self)
                            else { break }
                            continuation.yield(.chat(decoded))
                        case "agent":
                            guard let payload = event.payload,
                                  let decoded = try? GatewayPayloadDecoding.decode(
                                      payload,
                                      as: AlisioAgentEventPayload.self)
                            else { break }
                            continuation.yield(.agent(decoded))
                        default:
                            break
                        }
                    }
                }
            }

            continuation.onTermination = { @Sendable _ in
                task.cancel()
            }
        }
    }

    func setActiveSessionKey(_: String) async throws {
        // Operator clients receive session-scoped chat events without an explicit subscription RPC.
    }

    func resetSession(sessionKey: String) async throws {
        try await SessionActions.resetSession(key: sessionKey)
    }

    func compactSession(sessionKey: String) async throws {
        try await SessionActions.compactSession(key: sessionKey)
    }

    private func ensureLocalGatewayReadyIfNeeded(reason: String, timeout: TimeInterval = 15) async throws {
        do {
            try await LocalGatewayPreflight.ensureReadyIfNeeded(reason: reason, timeout: timeout)
        } catch {
            Self.logger.error(
                "local gateway readiness failed before \(reason, privacy: .public): \(error.localizedDescription, privacy: .public)")
            throw error
        }
    }
}
