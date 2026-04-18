import AlisioChatUI
import AlisioKit
import AlisioProtocol
import Foundation
import OSLog

import AlisioSupport
struct MacGatewayChatTransport: AlisioChatTransport, Sendable {
    private static let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "desktop.chat.transport")

    func requestHistory(sessionKey: String) async throws -> AlisioChatHistoryPayload {
        try await GatewayConnection.shared.chatHistory(sessionKey: sessionKey)
    }

    func listModels() async throws -> [AlisioChatModelChoice] {
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
        Self.logger.info(
            "chat.send start session=\(sessionKey, privacy: .public) len=\(message.count, privacy: .public) " +
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
        var params: [String: AnyHashable] = [
            "includeGlobal": AnyHashable(true),
            "includeUnknown": AnyHashable(false),
        ]
        if let limit {
            params["limit"] = AnyHashable(limit)
        }
        let data = try await ControlChannel.shared.request(method: "sessions.list", params: params)
        return try JSONDecoder().decode(AlisioChatSessionsListResponse.self, from: data)
    }

    func setSessionModel(sessionKey: String, model: String?) async throws {
        var params: [String: AnyHashable] = ["key": AnyHashable(sessionKey)]
        params["model"] = model.map(AnyHashable.init) ?? AnyHashable(NSNull())
        _ = try await ControlChannel.shared.request(method: "sessions.patch", params: params)
    }

    func setSessionThinking(sessionKey: String, thinkingLevel: String) async throws {
        try await SessionActions.patchSession(key: sessionKey, thinking: .some(thinkingLevel))
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
                    case let .seqGap(_, _):
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
}
