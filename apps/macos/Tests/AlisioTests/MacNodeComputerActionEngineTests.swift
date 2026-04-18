import CoreGraphics
import Foundation
import Testing
@testable import Alisio

private func makeFrameReference(
    capturedAt: Int = 1_000,
    maxAgeMs: Int = 5_000) -> MacNodeComputerFrameReference
{
    MacNodeComputerFrameReference(frame: .init(
        id: "frame-1",
        dataUrl: "data:image/jpeg;base64,abc",
        mimeType: "image/jpeg",
        width: 2_000,
        height: 1_000,
        pixelWidth: 2_000,
        pixelHeight: 1_000,
        logicalWidth: 1_000,
        logicalHeight: 500,
        scaleFactor: 2,
        orientation: .landscape,
        displayId: "display-1",
        sourceSpace: .displayPixel,
        capturedAt: capturedAt,
        maxAgeMs: maxAgeMs,
        staleAt: capturedAt + maxAgeMs,
        cursor: nil))
}

private func makePointAction(
    type: String = "click",
    x: Double = 400,
    y: Double = 200,
    coordinateSpace: MacNodeComputerCoordinateSpace = .displayPixel,
    frame: MacNodeComputerFrameReference = makeFrameReference()) -> MacNodeComputerActionPayload
{
    MacNodeComputerActionPayload(
        id: "action-1",
        type: type,
        x: x,
        y: y,
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
        coordinateSpace: coordinateSpace,
        frame: .init(
            frameId: frame.frameId,
            displayId: frame.displayId,
            capturedAt: frame.capturedAt,
            maxAgeMs: frame.maxAgeMs,
            sourceSpace: frame.sourceSpace,
            pixelWidth: frame.pixelWidth,
            pixelHeight: frame.pixelHeight,
            logicalWidth: frame.logicalWidth,
            logicalHeight: frame.logicalHeight,
            scaleFactor: frame.scaleFactor,
            orientation: frame.orientation),
        transform: .init(
            sourceSpace: frame.sourceSpace,
            sourceWidth: frame.pixelWidth,
            sourceHeight: frame.pixelHeight,
            renderedWidth: nil,
            renderedHeight: nil,
            downscaleFactorX: nil,
            downscaleFactorY: nil))
}

struct MacNodeComputerActionEngineTests {
    @Test func `maps retina and non-retina points into global display coordinates`() {
        let retina = MacNodeComputerActionEngine.resolveGlobalPoint(
            localPixelPoint: CGPoint(x: 400, y: 200),
            display: .init(
                displayId: "display-retina",
                logicalFrame: CGRect(x: 100, y: 50, width: 1_440, height: 900),
                scaleFactor: 2))
        let nonRetina = MacNodeComputerActionEngine.resolveGlobalPoint(
            localPixelPoint: CGPoint(x: 400, y: 200),
            display: .init(
                displayId: "display-1x",
                logicalFrame: CGRect(x: 100, y: 50, width: 1_440, height: 900),
                scaleFactor: 1))

        #expect(retina.x == 300)
        #expect(retina.y == 850)
        #expect(nonRetina.x == 500)
        #expect(nonRetina.y == 750)
    }

    @Test func `preserves display origin on multi-monitor mappings`() {
        let point = MacNodeComputerActionEngine.resolveGlobalPoint(
            localPixelPoint: CGPoint(x: 200, y: 100),
            display: .init(
                displayId: "display-2",
                logicalFrame: CGRect(x: 1_440, y: 0, width: 1_440, height: 900),
                scaleFactor: 2))

        #expect(point.x == 1_540)
        #expect(point.y == 850)
    }

    @Test func `remaps rendered pane coordinates back to display pixels`() {
        let frame = makeFrameReference()
        let action = MacNodeComputerActionPayload(
            id: "action-rendered",
            type: "click",
            x: 250,
            y: 100,
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
            coordinateSpace: .renderedPane,
            frame: .init(
                frameId: frame.frameId,
                displayId: frame.displayId,
                capturedAt: frame.capturedAt,
                maxAgeMs: frame.maxAgeMs,
                sourceSpace: frame.sourceSpace,
                pixelWidth: frame.pixelWidth,
                pixelHeight: frame.pixelHeight,
                logicalWidth: frame.logicalWidth,
                logicalHeight: frame.logicalHeight,
                scaleFactor: frame.scaleFactor,
                orientation: frame.orientation),
            transform: .init(
                sourceSpace: .displayPixel,
                sourceWidth: 2_000,
                sourceHeight: 1_000,
                renderedWidth: 1_000,
                renderedHeight: 500,
                downscaleFactorX: nil,
                downscaleFactorY: nil))

        let result = MacNodeComputerActionEngine.validateAction(
            action,
            sessionFrame: frame,
            nowMs: 1_200)

        switch result {
        case let .success(validated):
            #expect(validated.point == CGPoint(x: 500, y: 200))
        case let .failure(error):
            Issue.record("unexpected validation failure: \(error.summary)")
        }
    }

    @Test func `builds a deterministic drag path`() {
        let points = MacNodeComputerActionEngine.dragPath(
            from: CGPoint(x: 0, y: 0),
            to: CGPoint(x: 120, y: 60),
            steps: 3)

        #expect(points == [
            CGPoint(x: 40, y: 20),
            CGPoint(x: 80, y: 40),
            CGPoint(x: 120, y: 60),
        ])
    }

    @MainActor
    @Test func `releases the drag on cancellation mid-action`() async {
        var events: [String] = []
        let task = Task {
            try await MacNodeComputerActionEngine.runDrag(
                from: CGPoint(x: 0, y: 0),
                to: CGPoint(x: 30, y: 15),
                steps: 3,
                stepDelayMs: 50,
                moveMouse: { _ in
                    events.append("move")
                },
                postMouseDown: { _ in
                    events.append("down")
                },
                postMouseDragged: { point in
                    events.append("drag:\(Int(point.x)),\(Int(point.y))")
                },
                postMouseUp: { point in
                    events.append("up:\(Int(point.x)),\(Int(point.y))")
                },
                sleep: { delayMs in
                    try await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
                })
        }

        try? await Task.sleep(nanoseconds: 20_000_000)
        task.cancel()

        do {
            try await task.value
            Issue.record("expected drag cancellation")
        } catch {
            #expect(error is CancellationError)
        }

        #expect(events.contains("down"))
        #expect(events.contains(where: { $0.hasPrefix("drag:") }))
        #expect(events.contains(where: { $0.hasPrefix("up:") }))
    }

    @Test func `rejects stale source frames before execution`() {
        let frame = makeFrameReference(capturedAt: 1_000, maxAgeMs: 200)
        let result = MacNodeComputerActionEngine.validateAction(
            makePointAction(frame: frame),
            sessionFrame: frame,
            nowMs: 1_250)

        switch result {
        case .success:
            Issue.record("expected stale frame rejection")
        case let .failure(error):
            #expect(error.failureCategory == .staleFrame)
            #expect(error.summary == "source frame is stale")
        }
    }
}
