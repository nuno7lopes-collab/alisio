import Darwin
import Foundation

@MainActor
protocol MacNodeComputerControlling: Sendable {
    func captureFrame() async throws -> MacNodeComputerObservePayload
    func performActions(_ actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload
    func getContext() async throws -> MacNodeComputerObservePayload.Context
    func getPermissionState() async -> MacNodeComputerPermissionPayload
}

@MainActor
final class LiveMacNodeComputerController: MacNodeComputerControlling, @unchecked Sendable {
    private let service = ComputerControlService()

    func captureFrame() async throws -> MacNodeComputerObservePayload {
        try await self.service.captureFrame()
    }

    func performActions(_ actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload {
        try await self.service.performActions(actions)
    }

    func getContext() async throws -> MacNodeComputerObservePayload.Context {
        try self.service.getContext()
    }

    func getPermissionState() async -> MacNodeComputerPermissionPayload {
        self.service.getPermissionState()
    }
}

actor MacNodeComputerHelperServer {
    private struct SessionRecord: Sendable {
        var sessionId: String
        var state: MacNodeComputerSessionLifecycleState
        var updatedAt: Int
        var lastFrame: MacNodeComputerFrameReference?
        var lastActionAt: Int?
    }

    private let makeController: () async -> any MacNodeComputerControlling
    private var cachedController: (any MacNodeComputerControlling)?
    private var sessions: [String: SessionRecord] = [:]
    private var lastActiveSessionId: String?
    private var lastError: MacNodeComputerHelperErrorPayload?

    init(
        makeController: @escaping () async -> any MacNodeComputerControlling = {
            await MainActor.run { LiveMacNodeComputerController() }
        })
    {
        self.makeController = makeController
    }

    func handleLine(_ line: String) async -> (responseLine: String, shouldExit: Bool)? {
        let response: MacNodeComputerHelperResponseEnvelope
        let shouldExit: Bool
        do {
            let request = try MacNodeComputerHelperProtocolCodec.decodeRequest(from: line)
            guard request.version == macNodeComputerHelperProtocolVersion else {
                let error = MacNodeComputerHelperErrorPayload(
                    code: .protocolVersionMismatch,
                    message: "expected helper protocol version \(macNodeComputerHelperProtocolVersion); got \(request.version)",
                    retryable: false)
                response = MacNodeComputerHelperResponseEnvelope(
                    version: macNodeComputerHelperProtocolVersion,
                    id: request.id,
                    ok: false,
                    payloadJSON: nil,
                    error: error)
                shouldExit = true
                self.lastError = error
                let encoded = try MacNodeComputerHelperProtocolCodec.encodeResponse(response)
                return (encoded, shouldExit)
            }
            let handled = try await self.handle(request)
            response = handled.response
            shouldExit = handled.shouldExit
        } catch let error as MacNodeComputerHelperErrorPayload {
            let response = MacNodeComputerHelperResponseEnvelope(
                version: macNodeComputerHelperProtocolVersion,
                id: UUID().uuidString,
                ok: false,
                payloadJSON: nil,
                error: error)
            guard let encoded = try? MacNodeComputerHelperProtocolCodec.encodeResponse(response) else {
                return nil
            }
            return (encoded, false)
        } catch {
            let payload = MacNodeComputerHelperErrorPayload(
                code: .invalidRequest,
                message: error.localizedDescription,
                retryable: false)
            let response = MacNodeComputerHelperResponseEnvelope(
                version: macNodeComputerHelperProtocolVersion,
                id: UUID().uuidString,
                ok: false,
                payloadJSON: nil,
                error: payload)
            guard let encoded = try? MacNodeComputerHelperProtocolCodec.encodeResponse(response) else {
                return nil
            }
            self.lastError = payload
            return (encoded, false)
        }

        do {
            let encoded = try MacNodeComputerHelperProtocolCodec.encodeResponse(response)
            return (encoded, shouldExit)
        } catch {
            return nil
        }
    }

    private func handle(
        _ request: MacNodeComputerHelperRequestEnvelope) async throws -> (
            response: MacNodeComputerHelperResponseEnvelope, shouldExit: Bool
        )
    {
        switch request.method {
        case .startSession:
            let params = try MacNodeComputerHelperProtocolCodec.decodePayload(
                MacNodeComputerSessionParams.self,
                from: request.payloadJSON)
            let payload = try await self.startSession(sessionId: params.sessionId)
            return try await self.okResponse(request, payload: payload)
        case .stopSession:
            let params = try MacNodeComputerHelperProtocolCodec.decodePayload(
                MacNodeComputerSessionParams.self,
                from: request.payloadJSON)
            let payload = try await self.stopSession(sessionId: params.sessionId)
            return try await self.okResponse(request, payload: payload)
        case .pauseSession:
            let params = try MacNodeComputerHelperProtocolCodec.decodePayload(
                MacNodeComputerSessionParams.self,
                from: request.payloadJSON)
            let payload = try await self.pauseSession(sessionId: params.sessionId)
            return try await self.okResponse(request, payload: payload)
        case .resumeSession:
            let params = try MacNodeComputerHelperProtocolCodec.decodePayload(
                MacNodeComputerSessionParams.self,
                from: request.payloadJSON)
            let payload = try await self.resumeSession(sessionId: params.sessionId)
            return try await self.okResponse(request, payload: payload)
        case .captureFrame:
            let params = try MacNodeComputerHelperProtocolCodec.decodePayload(
                MacNodeComputerSessionParams.self,
                from: request.payloadJSON)
            let payload = try await self.captureFrame(sessionId: params.sessionId)
            return try await self.okResponse(request, payload: payload)
        case .performActions:
            let params = try MacNodeComputerHelperProtocolCodec.decodePayload(
                MacNodeComputerPerformActionsParams.self,
                from: request.payloadJSON)
            let payload = try await self.performActions(
                sessionId: params.sessionId,
                actions: params.actions)
            return try await self.okResponse(request, payload: payload)
        case .getContext:
            let params = try MacNodeComputerHelperProtocolCodec.decodePayload(
                MacNodeComputerSessionParams.self,
                from: request.payloadJSON)
            let payload = try await self.getContext(sessionId: params.sessionId)
            return try await self.okResponse(request, payload: payload)
        case .getPermissionState:
            let payload = await self.permissionState()
            return try await self.okResponse(request, payload: payload)
        case .health:
            let params = try MacNodeComputerHelperProtocolCodec.decodePayload(
                MacNodeComputerHealthQueryParams.self,
                from: request.payloadJSON)
            let payload = await self.healthPayload(for: params.sessionId)
            return try await self.okResponse(request, payload: payload)
        case .kill:
            let payload = await self.healthPayload(for: nil)
            let handled = try await self.okResponse(request, payload: payload)
            return (handled.response, true)
        }
    }

    private func okResponse<T: Encodable>(
        _ request: MacNodeComputerHelperRequestEnvelope,
        payload: T) async throws -> (response: MacNodeComputerHelperResponseEnvelope, shouldExit: Bool)
    {
        (
            MacNodeComputerHelperResponseEnvelope(
                version: macNodeComputerHelperProtocolVersion,
                id: request.id,
                ok: true,
                payloadJSON: try MacNodeComputerHelperProtocolCodec.encodePayload(payload),
                error: nil),
            false)
    }

    private func controller() async -> any MacNodeComputerControlling {
        if let cachedController {
            return cachedController
        }
        let created = await self.makeController()
        self.cachedController = created
        return created
    }

    private func startSession(sessionId rawSessionId: String?) async throws -> MacNodeComputerHelperSessionPayload {
        let sessionId = MacNodeComputerHelperSettings.normalizedSessionId(rawSessionId)
        let now = self.nowMs()
        self.sessions[sessionId] = SessionRecord(
            sessionId: sessionId,
            state: .running,
            updatedAt: now,
            lastFrame: nil,
            lastActionAt: nil)
        self.lastActiveSessionId = sessionId
        return await self.sessionPayload(sessionId: sessionId)
    }

    private func stopSession(sessionId rawSessionId: String?) async throws -> MacNodeComputerHelperSessionPayload {
        let sessionId = MacNodeComputerHelperSettings.normalizedSessionId(rawSessionId)
        let now = self.nowMs()
        self.sessions[sessionId] = SessionRecord(
            sessionId: sessionId,
            state: .stopped,
            updatedAt: now,
            lastFrame: self.sessions[sessionId]?.lastFrame,
            lastActionAt: self.sessions[sessionId]?.lastActionAt)
        self.lastActiveSessionId = sessionId
        return await self.sessionPayload(sessionId: sessionId)
    }

    private func pauseSession(sessionId rawSessionId: String?) async throws -> MacNodeComputerHelperSessionPayload {
        let sessionId = MacNodeComputerHelperSettings.normalizedSessionId(rawSessionId)
        let now = self.nowMs()
        self.sessions[sessionId] = SessionRecord(
            sessionId: sessionId,
            state: .paused,
            updatedAt: now,
            lastFrame: self.sessions[sessionId]?.lastFrame,
            lastActionAt: self.sessions[sessionId]?.lastActionAt)
        self.lastActiveSessionId = sessionId
        return await self.sessionPayload(sessionId: sessionId)
    }

    private func resumeSession(sessionId rawSessionId: String?) async throws -> MacNodeComputerHelperSessionPayload {
        let sessionId = MacNodeComputerHelperSettings.normalizedSessionId(rawSessionId)
        let now = self.nowMs()
        self.sessions[sessionId] = SessionRecord(
            sessionId: sessionId,
            state: .running,
            updatedAt: now,
            lastFrame: self.sessions[sessionId]?.lastFrame,
            lastActionAt: self.sessions[sessionId]?.lastActionAt)
        self.lastActiveSessionId = sessionId
        return await self.sessionPayload(sessionId: sessionId)
    }

    private func captureFrame(sessionId rawSessionId: String?) async throws -> MacNodeComputerObservePayload {
        let sessionId = MacNodeComputerHelperSettings.normalizedSessionId(rawSessionId)
        guard self.sessions[sessionId] != nil else {
            throw MacNodeComputerHelperErrorPayload(
                code: .actionRejected,
                message: "computer session \(sessionId) not started",
                retryable: false)
        }
        self.lastActiveSessionId = sessionId
        do {
            let controller = await self.controller()
            let payload = try await controller.captureFrame()
            if var record = self.sessions[sessionId] {
                record.updatedAt = self.nowMs()
                record.lastFrame = MacNodeComputerFrameReference(frame: payload.frame)
                self.sessions[sessionId] = record
            }
            return payload
        } catch {
            let payload = self.mapControllerError(error, method: .captureFrame)
            self.lastError = payload
            throw payload
        }
    }

    private func performActions(
        sessionId rawSessionId: String?,
        actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload
    {
        let sessionId = MacNodeComputerHelperSettings.normalizedSessionId(rawSessionId)
        guard let record = self.sessions[sessionId] else {
            throw MacNodeComputerHelperErrorPayload(
                code: .actionRejected,
                message: "computer session \(sessionId) not started",
                retryable: false)
        }
        guard record.state == .running else {
            throw MacNodeComputerHelperErrorPayload(
                code: .actionRejected,
                message: "computer session \(sessionId) is \(record.state.rawValue)",
                retryable: false)
        }
        self.lastActiveSessionId = sessionId
        var validatedActions: [MacNodeComputerActionPayload] = []
        for action in actions {
            switch MacNodeComputerActionEngine.validateAction(
                action,
                sessionFrame: record.lastFrame,
                nowMs: self.nowMs())
            {
            case let .failure(failure):
                return MacNodeComputerPerformActionsPayload(
                    ok: false,
                    summary: failure.summary,
                    results: [failure])
            case .success:
                validatedActions.append(action)
            }
        }
        if let lastActionAt = record.lastActionAt {
            let elapsed = self.nowMs() - lastActionAt
            if elapsed < MacNodeComputerActionEngine.minimumInterActionDelayMs {
                try await Task.sleep(
                    nanoseconds: UInt64(MacNodeComputerActionEngine.minimumInterActionDelayMs - elapsed) * 1_000_000)
            }
        }
        do {
            let controller = await self.controller()
            let payload = try await controller.performActions(validatedActions)
            if var updatedRecord = self.sessions[sessionId] {
                updatedRecord.updatedAt = self.nowMs()
                updatedRecord.lastActionAt = updatedRecord.updatedAt
                self.sessions[sessionId] = updatedRecord
            }
            return payload
        } catch {
            let payload = self.mapControllerError(error, method: .performActions)
            self.lastError = payload
            throw payload
        }
    }

    private func getContext(sessionId rawSessionId: String?) async throws -> MacNodeComputerObservePayload.Context {
        let sessionId = MacNodeComputerHelperSettings.normalizedSessionId(rawSessionId)
        guard self.sessions[sessionId] != nil else {
            throw MacNodeComputerHelperErrorPayload(
                code: .actionRejected,
                message: "computer session \(sessionId) not started",
                retryable: false)
        }
        self.lastActiveSessionId = sessionId
        do {
            let controller = await self.controller()
            return try await controller.getContext()
        } catch {
            let payload = self.mapControllerError(error, method: .getContext)
            self.lastError = payload
            throw payload
        }
    }

    private func permissionState() async -> MacNodeComputerPermissionPayload {
        let controller = await self.controller()
        return await controller.getPermissionState()
    }

    private func sessionPayload(sessionId: String) async -> MacNodeComputerHelperSessionPayload {
        let state = self.sessions[sessionId]?.state ?? .running
        return MacNodeComputerHelperSessionPayload(
            sessionId: sessionId,
            state: state,
            permissions: await self.permissionState(),
            helper: await self.healthPayload(for: sessionId))
    }

    private func healthPayload(for sessionId: String?) async -> MacNodeComputerHelperHealthPayload {
        let resolvedSessionId = MacNodeComputerHelperSettings.normalizedSessionId(sessionId)
        let active = self.sessions[resolvedSessionId]
            ?? self.lastActiveSessionId.flatMap { self.sessions[$0] }
        return MacNodeComputerHelperHealthPayload(
            protocolVersion: macNodeComputerHelperProtocolVersion,
            helperVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev",
            processId: getpid(),
            activeSession: active.map {
                MacNodeComputerHelperSessionSummary(
                    sessionId: $0.sessionId,
                    state: $0.state,
                    updatedAt: $0.updatedAt)
            },
            lastError: self.lastError)
    }

    private func mapControllerError(
        _ error: Error,
        method: MacNodeComputerHelperMethod) -> MacNodeComputerHelperErrorPayload
    {
        if let payload = error as? MacNodeComputerHelperErrorPayload {
            return payload
        }
        let message = error.localizedDescription
        if message.hasPrefix("PERMISSION_MISSING:") {
            let permission = message.components(separatedBy: ":").dropFirst().joined(separator: ":")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return MacNodeComputerHelperErrorPayload(
                code: .permissionMissing,
                message: message,
                retryable: false,
                permission: permission.isEmpty ? nil : permission)
        }
        switch method {
        case .captureFrame:
            return MacNodeComputerHelperErrorPayload(
                code: .captureFailed,
                message: message,
                retryable: true)
        case .performActions:
            return MacNodeComputerHelperErrorPayload(
                code: .actionRejected,
                message: message,
                retryable: false)
        default:
            return MacNodeComputerHelperErrorPayload(
                code: .helperUnavailable,
                message: message,
                retryable: true)
        }
    }

    private func nowMs() -> Int {
        Int(Date().timeIntervalSince1970 * 1000)
    }
}
