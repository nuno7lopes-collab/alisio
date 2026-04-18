import Foundation
import Testing
@testable import Alisio

private actor TestMacNodeComputerHelperTransportState {
    private var sentMethods: [MacNodeComputerHelperMethod] = []

    func record(_ method: MacNodeComputerHelperMethod) {
        self.sentMethods.append(method)
    }

    func snapshot() -> [MacNodeComputerHelperMethod] {
        self.sentMethods
    }
}

private final class TestMacNodeComputerHelperTransport: MacNodeComputerHelperTransport, @unchecked Sendable {
    let pid: Int32
    let stdoutLines: AsyncThrowingStream<String, Error>
    let stderrLines: AsyncStream<String>
    var onExit: (@Sendable (Int32) -> Void)?
    var sendHandler: (@Sendable (MacNodeComputerHelperRequestEnvelope, TestMacNodeComputerHelperTransport) -> Void)?

    private let state = TestMacNodeComputerHelperTransportState()
    private let stdoutContinuation: AsyncThrowingStream<String, Error>.Continuation
    private let stderrContinuation: AsyncStream<String>.Continuation

    init(pid: Int32) {
        self.pid = pid

        var stdoutContinuation: AsyncThrowingStream<String, Error>.Continuation!
        self.stdoutLines = AsyncThrowingStream { continuation in
            stdoutContinuation = continuation
        }
        self.stdoutContinuation = stdoutContinuation

        var stderrContinuation: AsyncStream<String>.Continuation!
        self.stderrLines = AsyncStream { continuation in
            stderrContinuation = continuation
        }
        self.stderrContinuation = stderrContinuation
    }

    func send(line: String) throws {
        let request = try MacNodeComputerHelperProtocolCodec.decodeRequest(from: line)
        Task { await self.state.record(request.method) }
        self.sendHandler?(request, self)
    }

    func terminate() {
        self.stdoutContinuation.finish()
        self.stderrContinuation.finish()
    }

    func emitPayload<T: Encodable>(
        id: String,
        payload: T,
        version: Int = macNodeComputerHelperProtocolVersion)
    {
        let response = MacNodeComputerHelperResponseEnvelope(
            version: version,
            id: id,
            ok: true,
            payloadJSON: try? MacNodeComputerHelperProtocolCodec.encodePayload(payload),
            error: nil)
        self.stdoutContinuation.yield((try? MacNodeComputerHelperProtocolCodec.encodeResponse(response)) ?? "")
    }

    func emitError(id: String, error: MacNodeComputerHelperErrorPayload) {
        let response = MacNodeComputerHelperResponseEnvelope(
            version: macNodeComputerHelperProtocolVersion,
            id: id,
            ok: false,
            payloadJSON: nil,
            error: error)
        self.stdoutContinuation.yield((try? MacNodeComputerHelperProtocolCodec.encodeResponse(response)) ?? "")
    }

    func emitRaw(_ line: String) {
        self.stdoutContinuation.yield(line)
    }

    func exit(status: Int32) {
        self.onExit?(status)
        self.stdoutContinuation.finish()
        self.stderrContinuation.finish()
    }

    func sentMethods() async -> [MacNodeComputerHelperMethod] {
        await self.state.snapshot()
    }
}

private final class SequentialTransportFactory: @unchecked Sendable {
    private var transports: [TestMacNodeComputerHelperTransport]
    private var index = 0

    init(_ transports: [TestMacNodeComputerHelperTransport]) {
        self.transports = transports
    }

    func next() throws -> any MacNodeComputerHelperTransport {
        guard self.index < self.transports.count else {
            throw MacNodeComputerHelperErrorPayload(
                code: .helperUnavailable,
                message: "no more test transports",
                retryable: false)
        }
        defer { self.index += 1 }
        return self.transports[self.index]
    }
}

private func makeHelperHealthPayload(
    protocolVersion: Int = macNodeComputerHelperProtocolVersion,
    pid: Int32,
    sessionId: String? = nil,
    sessionState: MacNodeComputerSessionLifecycleState = .running) -> MacNodeComputerHelperHealthPayload
{
    MacNodeComputerHelperHealthPayload(
        protocolVersion: protocolVersion,
        helperVersion: "test",
        processId: pid,
        activeSession: sessionId.map {
            MacNodeComputerHelperSessionSummary(
                sessionId: $0,
                state: sessionState,
                updatedAt: 123)
        },
        lastError: nil)
}

private func makeHelperSessionPayload(
    sessionId: String,
    state: MacNodeComputerSessionLifecycleState,
    pid: Int32) -> MacNodeComputerHelperSessionPayload
{
    MacNodeComputerHelperSessionPayload(
        sessionId: sessionId,
        state: state,
        permissions: MacNodeComputerPermissionPayload(accessibility: true, screenRecording: true),
        helper: makeHelperHealthPayload(pid: pid, sessionId: sessionId, sessionState: state))
}

private func makeObservePayload(capturedAt: Int) -> MacNodeComputerObservePayload {
    MacNodeComputerObservePayload(
        frame: .init(
            id: "frame-\(capturedAt)",
            dataUrl: "data:image/jpeg;base64,xyz",
            mimeType: "image/jpeg",
            width: 1280,
            height: 720,
            pixelWidth: 1280,
            pixelHeight: 720,
            logicalWidth: 640,
            logicalHeight: 360,
            scaleFactor: 2,
            orientation: .landscape,
            displayId: "display-1",
            sourceSpace: .displayPixel,
            capturedAt: capturedAt,
            maxAgeMs: 5_000,
            staleAt: capturedAt + 5_000,
            cursor: .init(x: 11, y: 22, visible: true)),
        context: .init(
            display: .init(
                id: "display-1",
                width: 1280,
                height: 720,
                scale: 2,
                logicalWidth: 640,
                logicalHeight: 360,
                pixelWidth: 1280,
                pixelHeight: 720,
                orientation: .landscape),
            activeApp: .init(name: "Finder", bundleId: "com.apple.finder", processId: 77),
            activeWindow: .init(title: "Downloads"),
            errorState: nil,
            capturedAt: capturedAt))
}

struct MacNodeComputerHelperClientTests {
    @Test func `client rejects protocol version mismatch during handshake`() async {
        let transport = TestMacNodeComputerHelperTransport(pid: 9001)
        transport.sendHandler = { request, transport in
            if request.method == .health {
                transport.emitPayload(
                    id: request.id,
                    payload: makeHelperHealthPayload(
                        protocolVersion: macNodeComputerHelperProtocolVersion + 1,
                        pid: 9001))
            }
        }
        let client = MacNodeComputerHelperClient(transportFactory: { transport })

        do {
            _ = try await client.startSession("main")
            Issue.record("expected protocol version mismatch")
        } catch let error as MacNodeComputerHelperErrorPayload {
            #expect(error.code == .protocolVersionMismatch)
        } catch {
            Issue.record("unexpected error: \(error)")
        }

        let methods = await transport.sentMethods()
        #expect(methods == [.health])
    }

    @Test func `client invalidates connection on malformed helper response`() async {
        let transport = TestMacNodeComputerHelperTransport(pid: 9002)
        transport.sendHandler = { request, transport in
            if request.method == .health {
                transport.emitRaw("{bad-json")
            }
        }
        let client = MacNodeComputerHelperClient(transportFactory: { transport })

        do {
            _ = try await client.startSession("main")
            Issue.record("expected malformed helper response to fail")
        } catch let error as MacNodeComputerHelperErrorPayload {
            #expect(error.code == .connectionInvalidated)
        } catch {
            Issue.record("unexpected error: \(error)")
        }
    }

    @Test func `client reconnects and restores session after interruption`() async throws {
        let firstTransport = TestMacNodeComputerHelperTransport(pid: 9101)
        firstTransport.sendHandler = { request, transport in
            switch request.method {
            case .health:
                transport.emitPayload(id: request.id, payload: makeHelperHealthPayload(pid: 9101))
            case .startSession:
                transport.emitPayload(
                    id: request.id,
                    payload: makeHelperSessionPayload(sessionId: "main", state: .running, pid: 9101))
            default:
                break
            }
        }

        let secondTransport = TestMacNodeComputerHelperTransport(pid: 9102)
        secondTransport.sendHandler = { request, transport in
            switch request.method {
            case .health:
                transport.emitPayload(id: request.id, payload: makeHelperHealthPayload(pid: 9102, sessionId: "main"))
            case .startSession:
                transport.emitPayload(
                    id: request.id,
                    payload: makeHelperSessionPayload(sessionId: "main", state: .running, pid: 9102))
            case .captureFrame:
                transport.emitPayload(id: request.id, payload: makeObservePayload(capturedAt: 222))
            default:
                break
            }
        }

        let factory = SequentialTransportFactory([firstTransport, secondTransport])
        let client = MacNodeComputerHelperClient(transportFactory: { try factory.next() })

        let started = try await client.startSession("main")
        #expect(started.sessionId == "main")
        #expect(started.health.connectionState == .running)

        firstTransport.exit(status: 9)
        try? await Task.sleep(nanoseconds: 50_000_000)

        let frame = try await client.captureFrame(sessionId: "main")
        #expect(frame.frame.capturedAt == 222)

        let firstMethods = await firstTransport.sentMethods()
        let secondMethods = await secondTransport.sentMethods()
        #expect(firstMethods == [.health, .startSession])
        #expect(secondMethods == [.health, .startSession, .captureFrame])
    }
}
