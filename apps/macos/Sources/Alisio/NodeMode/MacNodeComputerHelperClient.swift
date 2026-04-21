import Darwin
import Foundation
import OSLog

import AlisioSupport

protocol MacNodeComputerHelperTransport: AnyObject, Sendable {
    var pid: Int32 { get }
    var stdoutLines: AsyncThrowingStream<String, Error> { get }
    var stderrLines: AsyncStream<String> { get }
    var onExit: (@Sendable (Int32) -> Void)? { get set }
    func send(line: String) throws
    func terminate()
}

final class ProcessBackedMacNodeComputerHelperTransport: MacNodeComputerHelperTransport, @unchecked Sendable {
    private let process: Process
    private let stdinHandle: FileHandle
    let stdoutLines: AsyncThrowingStream<String, Error>
    let stderrLines: AsyncStream<String>
    var onExit: (@Sendable (Int32) -> Void)?

    var pid: Int32 {
        self.process.processIdentifier
    }

    init(
        executableURL: URL,
        arguments: [String],
        environment: [String: String])
        throws
    {
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()

        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        process.environment = environment
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        self.process = process
        self.stdinHandle = stdinPipe.fileHandleForWriting
        self.stdoutLines = Self.makeThrowingLineStream(handle: stdoutPipe.fileHandleForReading)
        self.stderrLines = Self.makeLineStream(handle: stderrPipe.fileHandleForReading)
        process.terminationHandler = { [weak self] proc in
            self?.onExit?(proc.terminationStatus)
        }
        try process.run()
    }

    func send(line: String) throws {
        try self.stdinHandle.write(contentsOf: Data((line + "\n").utf8))
    }

    func terminate() {
        try? self.stdinHandle.close()
        if self.process.isRunning {
            self.process.terminate()
        }
    }

    private static func makeThrowingLineStream(
        handle: FileHandle) -> AsyncThrowingStream<String, Error>
    {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await line in handle.bytes.lines {
                        continuation.yield(String(line))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    private static func makeLineStream(handle: FileHandle) -> AsyncStream<String> {
        AsyncStream { continuation in
            let task = Task {
                do {
                    for try await line in handle.bytes.lines {
                        continuation.yield(String(line))
                    }
                } catch {
                    // Ignore stderr stream failures; the parent already observes process exit separately.
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}

actor MacNodeComputerHelperClient {
    typealias TransportFactory = @Sendable () throws -> any MacNodeComputerHelperTransport

    private let transportFactory: TransportFactory
    private let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "computer-helper-client")

    private var transport: (any MacNodeComputerHelperTransport)?
    private var responseTask: Task<Void, Never>?
    private var stderrTask: Task<Void, Never>?
    private var pending: [String: CheckedContinuation<MacNodeComputerHelperResponseEnvelope, Error>] = [:]
    private var desiredSessions: [String: MacNodeComputerSessionLifecycleState] = [:]

    private(set) var connectionState: MacNodeComputerHelperConnectionState = .idle
    private(set) var launchCount: Int = 0
    private(set) var lastError: MacNodeComputerHelperErrorPayload?

    init(transportFactory: TransportFactory? = nil) {
        self.transportFactory = transportFactory ?? {
            guard let executableURL = Bundle.main.executableURL else {
                throw MacNodeComputerHelperErrorPayload(
                    code: .helperUnavailable,
                    message: "mac app executable unavailable",
                    retryable: false)
            }
            var environment = ProcessInfo.processInfo.environment
            environment["ALISIO_COMPUTER_HELPER_PARENT_PID"] = "\(getpid())"
            return try ProcessBackedMacNodeComputerHelperTransport(
                executableURL: executableURL,
                arguments: [MacNodeComputerHelperSettings.helperFlag],
                environment: environment)
        }
    }

    func startSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        let normalized = MacNodeComputerHelperSettings.normalizedSessionId(sessionId)
        let payload: MacNodeComputerHelperSessionPayload = try await self.request(
            method: .startSession,
            payload: MacNodeComputerSessionParams(sessionId: normalized))
        self.desiredSessions[normalized] = .running
        return self.runtimeSessionPayload(from: payload)
    }

    func stopSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        let normalized = MacNodeComputerHelperSettings.normalizedSessionId(sessionId)
        let payload: MacNodeComputerHelperSessionPayload = try await self.request(
            method: .stopSession,
            payload: MacNodeComputerSessionParams(sessionId: normalized))
        self.desiredSessions.removeValue(forKey: normalized)
        return self.runtimeSessionPayload(from: payload)
    }

    func pauseSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        let normalized = MacNodeComputerHelperSettings.normalizedSessionId(sessionId)
        let payload: MacNodeComputerHelperSessionPayload = try await self.request(
            method: .pauseSession,
            payload: MacNodeComputerSessionParams(sessionId: normalized))
        self.desiredSessions[normalized] = .paused
        return self.runtimeSessionPayload(from: payload)
    }

    func resumeSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        let normalized = MacNodeComputerHelperSettings.normalizedSessionId(sessionId)
        let payload: MacNodeComputerHelperSessionPayload = try await self.request(
            method: .resumeSession,
            payload: MacNodeComputerSessionParams(sessionId: normalized))
        self.desiredSessions[normalized] = .running
        return self.runtimeSessionPayload(from: payload)
    }

    func captureFrame(sessionId: String) async throws -> MacNodeComputerObservePayload {
        try await self.ensureConnected()
        return try await self.requestUsingExisting(
            method: .captureFrame,
            payload: MacNodeComputerSessionParams(
                sessionId: MacNodeComputerHelperSettings.normalizedSessionId(sessionId)))
    }

    func performActions(
        sessionId: String,
        actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload
    {
        try await self.ensureConnected()
        return try await self.requestUsingExisting(
            method: .performActions,
            payload: MacNodeComputerPerformActionsParams(
                sessionId: MacNodeComputerHelperSettings.normalizedSessionId(sessionId),
                actions: actions))
    }

    func getContext(sessionId: String) async throws -> MacNodeComputerObservePayload.Context {
        try await self.ensureConnected()
        return try await self.requestUsingExisting(
            method: .getContext,
            payload: MacNodeComputerSessionParams(
                sessionId: MacNodeComputerHelperSettings.normalizedSessionId(sessionId)))
    }

    func getPermissionState() async throws -> MacNodeComputerPermissionPayload {
        try await self.ensureConnected()
        return try await self.requestUsingExisting(
            method: .getPermissionState,
            payload: MacNodeComputerHealthQueryParams(sessionId: nil))
    }

    func health(sessionId: String?) async -> MacNodeComputerRuntimeHealthPayload {
        if MacNodeComputerHelperSettings.isDisabled() {
            let error = MacNodeComputerHelperErrorPayload(
                code: .helperUnavailable,
                message: "computer helper disabled by kill switch",
                retryable: false)
            self.connectionState = .disabled
            self.lastError = error
            return self.runtimeHealth(helper: nil)
        }
        do {
            try await self.ensureConnected()
            let helper: MacNodeComputerHelperHealthPayload = try await self.requestUsingExisting(
                method: .health,
                payload: MacNodeComputerHealthQueryParams(sessionId: sessionId))
            self.lastError = nil
            return self.runtimeHealth(helper: helper)
        } catch let error as MacNodeComputerHelperErrorPayload {
            self.lastError = error
            return self.runtimeHealth(helper: nil)
        } catch {
            let payload = MacNodeComputerHelperErrorPayload(
                code: .helperUnavailable,
                message: error.localizedDescription,
                retryable: true)
            self.lastError = payload
            return self.runtimeHealth(helper: nil)
        }
    }

    func kill() async -> MacNodeComputerRuntimeHealthPayload {
        guard self.transport != nil else {
            return await self.health(sessionId: nil)
        }
        do {
            let helper: MacNodeComputerHelperHealthPayload = try await self.requestUsingExisting(
                method: .kill,
                payload: MacNodeComputerHealthQueryParams(sessionId: nil))
            let error = MacNodeComputerHelperErrorPayload(
                code: .connectionInvalidated,
                message: "computer helper terminated by kill request",
                retryable: true)
            self.desiredSessions.removeAll()
            await self.handleInvalidation(error, terminateTransport: true)
            return self.runtimeHealth(helper: helper)
        } catch let error as MacNodeComputerHelperErrorPayload {
            self.desiredSessions.removeAll()
            await self.handleInvalidation(error, terminateTransport: true)
            return self.runtimeHealth(helper: nil)
        } catch {
            let payload = MacNodeComputerHelperErrorPayload(
                code: .connectionInvalidated,
                message: error.localizedDescription,
                retryable: true)
            self.desiredSessions.removeAll()
            await self.handleInvalidation(payload, terminateTransport: true)
            return self.runtimeHealth(helper: nil)
        }
    }

    private func ensureConnected() async throws {
        if MacNodeComputerHelperSettings.isDisabled() {
            let payload = MacNodeComputerHelperErrorPayload(
                code: .helperUnavailable,
                message: "computer helper disabled by kill switch",
                retryable: false)
            self.connectionState = .disabled
            self.lastError = payload
            throw payload
        }
        if self.transport != nil, self.connectionState == .running {
            return
        }

        self.connectionState = .starting
        let created = try self.transportFactory()
        self.transport = created
        self.launchCount += 1
        self.logger.info("computer helper launch pid=\(created.pid, privacy: .public) count=\(self.launchCount, privacy: .public)")
        self.attachTransport(created)

        do {
            let helper: MacNodeComputerHelperHealthPayload = try await self.requestUsingExisting(
                method: .health,
                payload: MacNodeComputerHealthQueryParams(sessionId: nil))
            guard helper.protocolVersion == macNodeComputerHelperProtocolVersion else {
                let payload = MacNodeComputerHelperErrorPayload(
                    code: .protocolVersionMismatch,
                    message: "expected helper protocol version \(macNodeComputerHelperProtocolVersion); got \(helper.protocolVersion)",
                    retryable: false)
                await self.handleInvalidation(payload, terminateTransport: true)
                throw payload
            }
            try await self.restoreDesiredSessions()
            self.connectionState = .running
            self.lastError = nil
            self.logger.info("computer helper connected pid=\(helper.processId, privacy: .public)")
        } catch let error as MacNodeComputerHelperErrorPayload {
            await self.handleInvalidation(error, terminateTransport: true)
            throw error
        } catch {
            let payload = MacNodeComputerHelperErrorPayload(
                code: .helperUnavailable,
                message: error.localizedDescription,
                retryable: true)
            await self.handleInvalidation(payload, terminateTransport: true)
            throw payload
        }
    }

    private func request<T: Decodable, P: Encodable>(
        method: MacNodeComputerHelperMethod,
        payload: P) async throws -> T
    {
        try await self.ensureConnected()
        return try await self.requestUsingExisting(method: method, payload: payload)
    }

    private func requestUsingExisting<T: Decodable, P: Encodable>(
        method: MacNodeComputerHelperMethod,
        payload: P) async throws -> T
    {
        guard let transport = self.transport else {
            throw MacNodeComputerHelperErrorPayload(
                code: .connectionInvalidated,
                message: "computer helper transport not ready",
                retryable: true)
        }
        let requestId = UUID().uuidString
        let payloadJSON = try MacNodeComputerHelperProtocolCodec.encodePayload(payload)
        let line = try MacNodeComputerHelperProtocolCodec.encodeRequest(
            id: requestId,
            method: method,
            payloadJSON: payloadJSON)
        let response = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<MacNodeComputerHelperResponseEnvelope, Error>) in
            self.pending[requestId] = continuation
            do {
                try transport.send(line: line)
            } catch {
                self.pending.removeValue(forKey: requestId)
                Task {
                    await self.handleInvalidation(MacNodeComputerHelperErrorPayload(
                        code: .connectionInvalidated,
                        message: error.localizedDescription,
                        retryable: true), terminateTransport: true)
                }
                continuation.resume(throwing: MacNodeComputerHelperErrorPayload(
                    code: .connectionInvalidated,
                    message: error.localizedDescription,
                    retryable: true))
            }
        }
        if let error = response.error {
            self.lastError = error
            throw error
        }
        self.lastError = nil
        return try MacNodeComputerHelperProtocolCodec.decodePayload(T.self, from: response.payloadJSON)
    }

    private func attachTransport(_ transport: any MacNodeComputerHelperTransport) {
        transport.onExit = { [weak self] status in
            Task {
                await self?.handleInterruption(
                    MacNodeComputerHelperErrorPayload(
                        code: .connectionInterrupted,
                        message: "computer helper exited with status \(status)",
                        retryable: true))
            }
        }

        self.responseTask?.cancel()
        self.responseTask = Task { [weak self] in
            do {
                for try await line in transport.stdoutLines {
                    await self?.handleResponseLine(line)
                }
                await self?.handleInterruption(MacNodeComputerHelperErrorPayload(
                    code: .connectionInterrupted,
                    message: "computer helper stdout closed",
                    retryable: true))
            } catch {
                await self?.handleInterruption(MacNodeComputerHelperErrorPayload(
                    code: .connectionInterrupted,
                    message: error.localizedDescription,
                    retryable: true))
            }
        }

        self.stderrTask?.cancel()
        self.stderrTask = Task {
            for await line in transport.stderrLines {
                self.logger.debug("computer helper stderr: \(line, privacy: .public)")
            }
        }
    }

    private func handleResponseLine(_ line: String) async {
        do {
            let response = try MacNodeComputerHelperProtocolCodec.decodeResponse(from: line)
            guard response.version == macNodeComputerHelperProtocolVersion else {
                let payload = MacNodeComputerHelperErrorPayload(
                    code: .protocolVersionMismatch,
                    message: "expected helper protocol version \(macNodeComputerHelperProtocolVersion); got \(response.version)",
                    retryable: false)
                await self.handleInvalidation(payload, terminateTransport: true)
                return
            }
            guard let continuation = self.pending.removeValue(forKey: response.id) else {
                return
            }
            continuation.resume(returning: response)
        } catch {
            await self.handleInvalidation(MacNodeComputerHelperErrorPayload(
                code: .connectionInvalidated,
                message: error.localizedDescription,
                retryable: true), terminateTransport: true)
        }
    }

    private func handleInterruption(_ error: MacNodeComputerHelperErrorPayload) async {
        guard self.connectionState != .invalidated, self.connectionState != .disabled else {
            return
        }
        self.logger.error("computer helper interrupted code=\(error.code.rawValue, privacy: .public) message=\(error.message, privacy: .public)")
        self.lastError = error
        self.connectionState = .interrupted
        self.finishPending(with: error)
        self.clearTransport(terminate: false)
    }

    private func handleInvalidation(
        _ error: MacNodeComputerHelperErrorPayload,
        terminateTransport: Bool) async
    {
        self.logger.error("computer helper invalidated code=\(error.code.rawValue, privacy: .public) message=\(error.message, privacy: .public)")
        self.lastError = error
        self.connectionState = .invalidated
        self.finishPending(with: error)
        self.clearTransport(terminate: terminateTransport)
    }

    private func clearTransport(terminate: Bool) {
        self.responseTask?.cancel()
        self.responseTask = nil
        self.stderrTask?.cancel()
        self.stderrTask = nil
        if terminate {
            self.transport?.terminate()
        }
        self.transport = nil
    }

    private func finishPending(with error: MacNodeComputerHelperErrorPayload) {
        let pending = self.pending
        self.pending.removeAll()
        for continuation in pending.values {
            continuation.resume(throwing: error)
        }
    }

    private func restoreDesiredSessions() async throws {
        guard !self.desiredSessions.isEmpty else {
            return
        }
        for (sessionId, state) in self.desiredSessions.sorted(by: { $0.key < $1.key }) {
            let _: MacNodeComputerHelperSessionPayload = try await self.requestUsingExisting(
                method: .startSession,
                payload: MacNodeComputerSessionParams(sessionId: sessionId))
            if state == .paused {
                let _: MacNodeComputerHelperSessionPayload = try await self.requestUsingExisting(
                    method: .pauseSession,
                    payload: MacNodeComputerSessionParams(sessionId: sessionId))
            }
        }
    }

    private func runtimeSessionPayload(
        from payload: MacNodeComputerHelperSessionPayload) -> MacNodeComputerSessionPayload
    {
        MacNodeComputerSessionPayload(
            sessionId: payload.sessionId,
            state: payload.state,
            permissions: payload.permissions,
            health: self.runtimeHealth(helper: payload.helper))
    }

    private func runtimeHealth(
        helper: MacNodeComputerHelperHealthPayload?) -> MacNodeComputerRuntimeHealthPayload
    {
        MacNodeComputerRuntimeHealthPayload(
            connectionState: self.connectionState,
            launchCount: self.launchCount,
            helper: helper,
            lastError: self.lastError)
    }
}
