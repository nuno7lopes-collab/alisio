import Foundation

public enum AlisioChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(AlisioChatEventPayload)
    case agent(AlisioAgentEventPayload)
    case seqGap
}

public protocol AlisioChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> AlisioChatHistoryPayload
    func listModels() async throws -> [AlisioChatModelChoice]
    func listSessions(query: AlisioChatSessionsQuery) async throws -> AlisioChatSessionsListResponse
    func createSession(request: AlisioChatSessionCreateRequest) async throws -> AlisioChatSessionCreateResponse
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [AlisioChatAttachmentPayload]) async throws -> AlisioChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func setSessionModel(sessionKey: String, model: String?) async throws
    func setSessionThinking(sessionKey: String, thinkingLevel: String) async throws
    func renameSession(sessionKey: String, displayName: String?) async throws

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<AlisioChatTransportEvent>

    func resetSession(sessionKey: String) async throws
    func compactSession(sessionKey: String) async throws
    func deleteSession(sessionKey: String) async throws
}

extension AlisioChatTransport {
    public func listSessions(query _: AlisioChatSessionsQuery) async throws -> AlisioChatSessionsListResponse {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }

    public func createSession(request _: AlisioChatSessionCreateRequest) async throws -> AlisioChatSessionCreateResponse {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.create not supported by this transport"])
    }

    public func resetSession(sessionKey _: String) async throws {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.reset not supported by this transport"])
    }

    public func compactSession(sessionKey _: String) async throws {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.compact not supported by this transport"])
    }

    public func deleteSession(sessionKey _: String) async throws {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.delete not supported by this transport"])
    }

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listModels() async throws -> [AlisioChatModelChoice] {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "models.list not supported by this transport"])
    }

    public func setSessionModel(sessionKey _: String, model _: String?) async throws {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.patch(model) not supported by this transport"])
    }

    public func setSessionThinking(sessionKey _: String, thinkingLevel _: String) async throws {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.patch(thinkingLevel) not supported by this transport"])
    }

    public func renameSession(sessionKey _: String, displayName _: String?) async throws {
        throw NSError(
            domain: "AlisioChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.patch(displayName) not supported by this transport"])
    }
}
