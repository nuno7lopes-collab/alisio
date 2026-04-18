import Foundation
import Testing
@testable import Alisio

@MainActor
private final class FakeMacNodeComputerController: MacNodeComputerControlling, @unchecked Sendable {
    var captureFrameHandler: @Sendable () async throws -> MacNodeComputerObservePayload = {
        makeObservePayload(capturedAt: 100)
    }
    var performActionsHandler: @Sendable ([MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload = { actions in
        MacNodeComputerPerformActionsPayload(
            ok: true,
            summary: "performed \(actions.count) actions",
            results: actions.map { action in
                MacNodeComputerActionResultPayload(
                    id: "result-\(action.id ?? action.type)",
                    actionId: action.id,
                    type: MacNodeComputerActionEngine.normalizeActionType(action.type),
                    success: true,
                    elapsedMs: 12,
                    retryCount: 0,
                    summary: "performed \(action.type)",
                    failureCategory: nil,
                    sourceFrameId: action.frame?.frameId,
                    resultFrameId: nil)
            })
    }
    var contextHandler: @Sendable () async throws -> MacNodeComputerObservePayload.Context = {
        makeObservePayload(capturedAt: 100).context
    }
    var permissionState = MacNodeComputerPermissionPayload(
        accessibility: true,
        screenRecording: true)

    func captureFrame() async throws -> MacNodeComputerObservePayload {
        try await self.captureFrameHandler()
    }

    func performActions(_ actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload {
        try await self.performActionsHandler(actions)
    }

    func getContext() async throws -> MacNodeComputerObservePayload.Context {
        try await self.contextHandler()
    }

    func getPermissionState() async -> MacNodeComputerPermissionPayload {
        self.permissionState
    }
}

private func makeObservePayload(capturedAt: Int) -> MacNodeComputerObservePayload {
    MacNodeComputerObservePayload(
        frame: .init(
            id: "frame-\(capturedAt)",
            dataUrl: "data:image/jpeg;base64,abc",
            mimeType: "image/jpeg",
            width: 1440,
            height: 900,
            pixelWidth: 1440,
            pixelHeight: 900,
            logicalWidth: 720,
            logicalHeight: 450,
            scaleFactor: 2,
            orientation: .landscape,
            displayId: "display-1",
            sourceSpace: .displayPixel,
            capturedAt: capturedAt,
            maxAgeMs: 5_000,
            staleAt: capturedAt + 5_000,
            cursor: .init(x: 10, y: 20, visible: true)),
        context: .init(
            display: .init(
                id: "display-1",
                width: 1440,
                height: 900,
                scale: 2,
                logicalWidth: 720,
                logicalHeight: 450,
                pixelWidth: 1440,
                pixelHeight: 900,
                orientation: .landscape),
            activeApp: .init(name: "Finder", bundleId: "com.apple.finder", processId: 42),
            activeWindow: .init(title: "Downloads"),
            errorState: nil,
            capturedAt: capturedAt))
}

private func encodeRequest(
    id: String,
    version: Int = macNodeComputerHelperProtocolVersion,
    method: MacNodeComputerHelperMethod,
    payloadJSON: String?) throws -> String
{
    try MacNodeComputerHelperProtocolCodec.encodePayload(MacNodeComputerHelperRequestEnvelope(
        version: version,
        id: id,
        method: method,
        payloadJSON: payloadJSON))
}

private func decodeResponseLine(
    _ line: String) throws -> MacNodeComputerHelperResponseEnvelope
{
    try MacNodeComputerHelperProtocolCodec.decodeResponse(from: line)
}

struct MacNodeComputerHelperServerTests {
    @Test func `server start and stop session lifecycle`() async throws {
        let controller = await MainActor.run { FakeMacNodeComputerController() }
        let server = MacNodeComputerHelperServer(makeController: { controller })

        let startLine = try encodeRequest(
            id: "req-start",
            method: .startSession,
            payloadJSON: try MacNodeComputerHelperProtocolCodec.encodePayload(
                MacNodeComputerSessionParams(sessionId: "session-a")))
        let startedResult = await server.handleLine(startLine)
        let started = try #require(startedResult)
        let startResponse = try decodeResponseLine(started.responseLine)
        let startPayload = try MacNodeComputerHelperProtocolCodec.decodePayload(
            MacNodeComputerHelperSessionPayload.self,
            from: startResponse.payloadJSON)

        #expect(started.shouldExit == false)
        #expect(startResponse.ok == true)
        #expect(startPayload.sessionId == "session-a")
        #expect(startPayload.state == .running)

        let stopLine = try encodeRequest(
            id: "req-stop",
            method: .stopSession,
            payloadJSON: try MacNodeComputerHelperProtocolCodec.encodePayload(
                MacNodeComputerSessionParams(sessionId: "session-a")))
        let stoppedResult = await server.handleLine(stopLine)
        let stopped = try #require(stoppedResult)
        let stopResponse = try decodeResponseLine(stopped.responseLine)
        let stopPayload = try MacNodeComputerHelperProtocolCodec.decodePayload(
            MacNodeComputerHelperSessionPayload.self,
            from: stopResponse.payloadJSON)

        #expect(stopped.shouldExit == false)
        #expect(stopResponse.ok == true)
        #expect(stopPayload.sessionId == "session-a")
        #expect(stopPayload.state == .stopped)
    }

    @Test func `server returns permission error payload for capture failures`() async throws {
        let controller = await MainActor.run {
            let fake = FakeMacNodeComputerController()
            fake.captureFrameHandler = {
                throw NSError(
                    domain: "ComputerControl",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "PERMISSION_MISSING: accessibility"])
            }
            return fake
        }
        let server = MacNodeComputerHelperServer(makeController: { controller })

        let startLine = try encodeRequest(
            id: "req-start",
            method: .startSession,
            payloadJSON: try MacNodeComputerHelperProtocolCodec.encodePayload(
                MacNodeComputerSessionParams(sessionId: "session-b")))
        let started = await server.handleLine(startLine)
        _ = try #require(started)

        let captureLine = try encodeRequest(
            id: "req-capture",
            method: .captureFrame,
            payloadJSON: try MacNodeComputerHelperProtocolCodec.encodePayload(
                MacNodeComputerSessionParams(sessionId: "session-b")))
        let capturedResult = await server.handleLine(captureLine)
        let captured = try #require(capturedResult)
        let response = try decodeResponseLine(captured.responseLine)

        #expect(response.ok == false)
        #expect(response.error?.code == .permissionMissing)
        #expect(response.error?.permission == "accessibility")
    }

    @Test func `server rejects stale action frames against the last captured session frame`() async throws {
        let controller = await MainActor.run { FakeMacNodeComputerController() }
        let server = MacNodeComputerHelperServer(makeController: { controller })

        let startLine = try encodeRequest(
            id: "req-start-stale",
            method: .startSession,
            payloadJSON: try MacNodeComputerHelperProtocolCodec.encodePayload(
                MacNodeComputerSessionParams(sessionId: "session-stale")))
        _ = try #require(await server.handleLine(startLine))

        let captureLine = try encodeRequest(
            id: "req-capture-stale",
            method: .captureFrame,
            payloadJSON: try MacNodeComputerHelperProtocolCodec.encodePayload(
                MacNodeComputerSessionParams(sessionId: "session-stale")))
        _ = try #require(await server.handleLine(captureLine))

        let staleAction = MacNodeComputerActionPayload(
            id: "action-stale",
            type: "click",
            x: 10,
            y: 12,
            toX: nil,
            toY: nil,
            deltaX: nil,
            deltaY: nil,
            text: nil,
            key: nil,
            modifiers: nil,
            url: nil,
            path: nil,
            app: nil,
            delayMs: nil,
            coordinateSpace: .displayPixel,
            frame: .init(
                frameId: "frame-old",
                displayId: "display-1",
                capturedAt: 99,
                maxAgeMs: 5_000,
                sourceSpace: .displayPixel,
                pixelWidth: 1_440,
                pixelHeight: 900,
                logicalWidth: 720,
                logicalHeight: 450,
                scaleFactor: 2,
                orientation: .landscape),
            transform: .init(
                sourceSpace: .displayPixel,
                sourceWidth: 1_440,
                sourceHeight: 900,
                renderedWidth: nil,
                renderedHeight: nil,
                downscaleFactorX: nil,
                downscaleFactorY: nil))
        let actionLine = try encodeRequest(
            id: "req-action-stale",
            method: .performActions,
            payloadJSON: try MacNodeComputerHelperProtocolCodec.encodePayload(
                MacNodeComputerPerformActionsParams(sessionId: "session-stale", actions: [staleAction])))
        let actionResult = try #require(await server.handleLine(actionLine))
        let actionResponse = try decodeResponseLine(actionResult.responseLine)
        let actionPayload = try MacNodeComputerHelperProtocolCodec.decodePayload(
            MacNodeComputerPerformActionsPayload.self,
            from: actionResponse.payloadJSON)

        #expect(actionResponse.ok == true)
        #expect(actionPayload.ok == false)
        #expect(actionPayload.results.first?.failureCategory == .staleFrame)
    }

    @Test func `server stops on protocol version mismatch`() async throws {
        let controller = await MainActor.run { FakeMacNodeComputerController() }
        let server = MacNodeComputerHelperServer(makeController: { controller })

        let line = try encodeRequest(
            id: "req-health",
            version: macNodeComputerHelperProtocolVersion + 1,
            method: .health,
            payloadJSON: try MacNodeComputerHelperProtocolCodec.encodePayload(
                MacNodeComputerHealthQueryParams(sessionId: nil)))
        let handledResult = await server.handleLine(line)
        let handled = try #require(handledResult)
        let response = try decodeResponseLine(handled.responseLine)

        #expect(handled.shouldExit == true)
        #expect(response.ok == false)
        #expect(response.error?.code == .protocolVersionMismatch)
    }
}
