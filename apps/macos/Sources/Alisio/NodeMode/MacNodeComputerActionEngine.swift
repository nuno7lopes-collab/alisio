import CoreGraphics
import Foundation

struct MacNodeComputerFrameReference: Equatable, Sendable {
    var frameId: String
    var displayId: String?
    var pixelWidth: Double
    var pixelHeight: Double
    var logicalWidth: Double
    var logicalHeight: Double
    var scaleFactor: Double
    var orientation: MacNodeComputerOrientation
    var sourceSpace: MacNodeComputerCoordinateSpace
    var capturedAt: Int
    var maxAgeMs: Int
    var staleAt: Int

    init(frame: MacNodeComputerObservePayload.Frame) {
        self.frameId = frame.id
        self.displayId = frame.displayId
        self.pixelWidth = Double(frame.pixelWidth)
        self.pixelHeight = Double(frame.pixelHeight)
        self.logicalWidth = frame.logicalWidth
        self.logicalHeight = frame.logicalHeight
        self.scaleFactor = frame.scaleFactor
        self.orientation = frame.orientation
        self.sourceSpace = frame.sourceSpace
        self.capturedAt = frame.capturedAt
        self.maxAgeMs = frame.maxAgeMs
        self.staleAt = frame.staleAt
    }

    init?(payload: MacNodeComputerActionFramePayload?) {
        guard let payload,
              let frameId = payload.frameId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !frameId.isEmpty,
              let pixelWidth = payload.pixelWidth,
              let pixelHeight = payload.pixelHeight,
              let logicalWidth = payload.logicalWidth,
              let logicalHeight = payload.logicalHeight,
              let scaleFactor = payload.scaleFactor,
              let capturedAt = payload.capturedAt,
              let maxAgeMs = payload.maxAgeMs,
              let sourceSpace = payload.sourceSpace
        else {
            return nil
        }
        self.frameId = frameId
        self.displayId = payload.displayId
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.logicalWidth = logicalWidth
        self.logicalHeight = logicalHeight
        self.scaleFactor = scaleFactor
        self.orientation = payload.orientation ?? (pixelWidth >= pixelHeight ? .landscape : .portrait)
        self.sourceSpace = sourceSpace
        self.capturedAt = capturedAt
        self.maxAgeMs = maxAgeMs
        self.staleAt = capturedAt + maxAgeMs
    }
}

struct MacNodeComputerDisplayDescriptor: Equatable, Sendable {
    var displayId: String?
    var logicalFrame: CGRect
    var scaleFactor: Double
}

struct MacNodeComputerValidatedAction: Equatable, Sendable {
    var actionId: String
    var normalizedType: String
    var coordinateSpace: MacNodeComputerCoordinateSpace
    var sourceFrame: MacNodeComputerFrameReference?
    var point: CGPoint?
    var toPoint: CGPoint?
}

enum MacNodeComputerActionEngine {
    static let defaultFrameMaxAgeMs = 5_000
    static let minimumInterActionDelayMs = 24
    static let dragStepCount = 12
    static let dragStepDelayMs = 12

    static func normalizeActionType(_ raw: String) -> String {
        switch raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "app_focus":
            "focus_app"
        default:
            raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        }
    }

    static func validateAction(
        _ action: MacNodeComputerActionPayload,
        sessionFrame: MacNodeComputerFrameReference?,
        nowMs: Int) -> Result<MacNodeComputerValidatedAction, MacNodeComputerActionResultPayload>
    {
        let trimmedActionId = action.id?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let actionId = trimmedActionId.isEmpty ? UUID().uuidString : trimmedActionId
        let normalizedType = self.normalizeActionType(action.type)
        let coordinateSpace = action.coordinateSpace ?? .displayPixel

        func failurePayload(
            _ summary: String,
            category: MacNodeComputerActionFailureCategory,
            sourceFrameId: String? = nil) -> MacNodeComputerActionResultPayload
        {
            MacNodeComputerActionResultPayload(
                id: UUID().uuidString,
                actionId: actionId,
                type: normalizedType,
                success: false,
                elapsedMs: 0,
                retryCount: 0,
                summary: summary,
                failureCategory: category,
                sourceFrameId: sourceFrameId,
                resultFrameId: nil)
        }

        func failure(
            _ summary: String,
            category: MacNodeComputerActionFailureCategory,
            sourceFrameId: String? = nil) -> Result<MacNodeComputerValidatedAction, MacNodeComputerActionResultPayload>
        {
            .failure(failurePayload(summary, category: category, sourceFrameId: sourceFrameId))
        }

        let requiresFrame = switch normalizedType {
        case "wait", "screenshot", "open_url", "reveal_path", "open_path", "open_app", "focus_app":
            false
        default:
            true
        }

        let sourceFrame = sessionFrame ?? MacNodeComputerFrameReference(payload: action.frame)

        if requiresFrame {
            guard let sourceFrame else {
                return failure("action requires a fresh source frame", category: .staleFrame)
            }
            let frame = action.frame
            if let expectedFrameId = frame?.frameId?.trimmingCharacters(in: .whitespacesAndNewlines),
               !expectedFrameId.isEmpty,
               expectedFrameId != sourceFrame.frameId
            {
                return failure("source frame mismatch", category: .staleFrame, sourceFrameId: sourceFrame.frameId)
            }
            if let expectedDisplayId = frame?.displayId?.trimmingCharacters(in: .whitespacesAndNewlines),
               !expectedDisplayId.isEmpty,
               expectedDisplayId != sourceFrame.displayId
            {
                return failure("source display mismatch", category: .staleFrame, sourceFrameId: sourceFrame.frameId)
            }
            if let expectedCapturedAt = frame?.capturedAt, expectedCapturedAt != sourceFrame.capturedAt {
                return failure("source frame timestamp mismatch", category: .staleFrame, sourceFrameId: sourceFrame.frameId)
            }
            let maxAgeMs = max(0, frame?.maxAgeMs ?? sourceFrame.maxAgeMs)
            if nowMs >= sourceFrame.capturedAt + maxAgeMs || nowMs >= sourceFrame.staleAt {
                return failure("source frame is stale", category: .staleFrame, sourceFrameId: sourceFrame.frameId)
            }
        }

        func remapPoint(x: Double?, y: Double?) -> Result<CGPoint, MacNodeComputerActionResultPayload> {
            guard let sourceFrame else {
                return .failure(failurePayload("action requires a fresh source frame", category: .staleFrame))
            }
            guard let x, let y else {
                return .failure(failurePayload(
                    "action requires x/y coordinates",
                    category: .validation,
                    sourceFrameId: sourceFrame.frameId))
            }
            switch coordinateSpace {
            case .displayPixel:
                return .success(CGPoint(x: x, y: y))
            case .renderedPane:
                guard let transform = action.transform else {
                    return .failure(failurePayload(
                        "rendered-pane coordinates require transform metadata",
                        category: .validation,
                        sourceFrameId: sourceFrame.frameId))
                }
                guard transform.sourceSpace == sourceFrame.sourceSpace else {
                    return .failure(failurePayload(
                        "transform source space mismatch",
                        category: .invalidTarget,
                        sourceFrameId: sourceFrame.frameId))
                }
                guard transform.sourceWidth > 0,
                      transform.sourceHeight > 0,
                      let renderedWidth = transform.renderedWidth,
                      let renderedHeight = transform.renderedHeight,
                      renderedWidth > 0,
                      renderedHeight > 0
                else {
                    return .failure(failurePayload(
                        "render transform is incomplete",
                        category: .validation,
                        sourceFrameId: sourceFrame.frameId))
                }
                let derivedX = transform.sourceWidth / renderedWidth
                let derivedY = transform.sourceHeight / renderedHeight
                let downscaleX = transform.downscaleFactorX ?? derivedX
                let downscaleY = transform.downscaleFactorY ?? derivedY
                if abs(transform.sourceWidth - sourceFrame.pixelWidth) > 1 || abs(transform.sourceHeight - sourceFrame.pixelHeight) > 1 {
                    return .failure(failurePayload(
                        "transform source size no longer matches source frame",
                        category: .staleFrame,
                        sourceFrameId: sourceFrame.frameId))
                }
                return .success(CGPoint(x: x * downscaleX, y: y * downscaleY))
            }
        }

        func validateBounds(
            _ point: CGPoint,
            sourceFrame: MacNodeComputerFrameReference) -> Result<CGPoint, MacNodeComputerActionResultPayload>
        {
            guard point.x >= 0,
                  point.y >= 0,
                  point.x < sourceFrame.pixelWidth,
                  point.y < sourceFrame.pixelHeight
            else {
                return .failure(failurePayload(
                    "target is outside the source frame bounds",
                    category: .invalidTarget,
                    sourceFrameId: sourceFrame.frameId))
            }
            return .success(point)
        }

        switch normalizedType {
        case "move", "click", "double_click", "right_click":
            guard let sourceFrame else {
                return failure("action requires a fresh source frame", category: .staleFrame)
            }
            switch remapPoint(x: action.x, y: action.y) {
            case let .failure(error):
                return .failure(error)
            case let .success(point):
                switch validateBounds(point, sourceFrame: sourceFrame) {
                case let .failure(error):
                    return .failure(error)
                case let .success(validated):
                    return .success(MacNodeComputerValidatedAction(
                        actionId: actionId,
                        normalizedType: normalizedType,
                        coordinateSpace: coordinateSpace,
                        sourceFrame: sourceFrame,
                        point: validated,
                        toPoint: nil))
                }
            }
        case "drag":
            guard let sourceFrame else {
                return failure("action requires a fresh source frame", category: .staleFrame)
            }
            let startResult = remapPoint(x: action.x, y: action.y)
            let endResult = remapPoint(x: action.toX, y: action.toY)
            switch (startResult, endResult) {
            case let (.failure(error), _), let (_, .failure(error)):
                return .failure(error)
            case let (.success(start), .success(end)):
                switch (validateBounds(start, sourceFrame: sourceFrame), validateBounds(end, sourceFrame: sourceFrame)) {
                case let (.failure(error), _), let (_, .failure(error)):
                    return .failure(error)
                case let (.success(validStart), .success(validEnd)):
                    return .success(MacNodeComputerValidatedAction(
                        actionId: actionId,
                        normalizedType: normalizedType,
                        coordinateSpace: coordinateSpace,
                        sourceFrame: sourceFrame,
                        point: validStart,
                        toPoint: validEnd))
                }
            }
        case "scroll":
            if (abs(action.deltaX ?? 0) + abs(action.deltaY ?? 0)) <= 0 {
                return failure("scroll requires a non-zero delta", category: .validation, sourceFrameId: sourceFrame?.frameId)
            }
        case "type":
            if (action.text ?? "").isEmpty {
                return failure("type requires text", category: .validation, sourceFrameId: sourceFrame?.frameId)
            }
        case "keypress":
            if action.key?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
                return failure("keypress requires key", category: .validation, sourceFrameId: sourceFrame?.frameId)
            }
        case "wait":
            if (action.delayMs ?? 0) < 0 {
                return failure("wait requires delayMs >= 0", category: .validation)
            }
        case "screenshot":
            break
        case "open_url":
            let raw = action.url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if raw.isEmpty || URL(string: raw) == nil {
                return failure("open_url requires a valid url", category: .validation)
            }
        case "reveal_path", "open_path":
            if action.path?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
                return failure("\(normalizedType) requires path", category: .validation)
            }
        case "focus_app", "open_app":
            if action.app?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
                return failure("\(normalizedType) requires app", category: .validation)
            }
        default:
            return failure("unsupported computer action \(normalizedType)", category: .validation, sourceFrameId: sourceFrame?.frameId)
        }

        return .success(MacNodeComputerValidatedAction(
            actionId: actionId,
            normalizedType: normalizedType,
            coordinateSpace: coordinateSpace,
            sourceFrame: sourceFrame,
            point: nil,
            toPoint: nil))
    }

    static func resolveGlobalPoint(
        localPixelPoint: CGPoint,
        display: MacNodeComputerDisplayDescriptor) -> CGPoint
    {
        CGPoint(
            x: display.logicalFrame.minX + (localPixelPoint.x / display.scaleFactor),
            y: display.logicalFrame.maxY - (localPixelPoint.y / display.scaleFactor))
    }

    static func dragPath(
        from start: CGPoint,
        to end: CGPoint,
        steps: Int = MacNodeComputerActionEngine.dragStepCount) -> [CGPoint]
    {
        guard steps > 0 else { return [end] }
        return (1...steps).map { step in
            let progress = Double(step) / Double(steps)
            return CGPoint(
                x: start.x + ((end.x - start.x) * progress),
                y: start.y + ((end.y - start.y) * progress))
        }
    }

    static func runDrag(
        from start: CGPoint,
        to end: CGPoint,
        steps: Int = MacNodeComputerActionEngine.dragStepCount,
        stepDelayMs: Int = MacNodeComputerActionEngine.dragStepDelayMs,
        moveMouse: @MainActor @Sendable (CGPoint) -> Void,
        postMouseDown: @MainActor @Sendable (CGPoint) throws -> Void,
        postMouseDragged: @MainActor @Sendable (CGPoint) throws -> Void,
        postMouseUp: @MainActor @Sendable (CGPoint) throws -> Void,
        sleep: @Sendable (Int) async throws -> Void) async throws
    {
        await moveMouse(start)
        try await postMouseDown(start)

        var releasePoint = start
        do {
            for point in self.dragPath(from: start, to: end, steps: steps) {
                try await postMouseDragged(point)
                releasePoint = point
                // Once the drag is active, emit at least one drag step before honoring
                // cancellation so cleanup can release from the current pointer position.
                try Task.checkCancellation()
                try await sleep(stepDelayMs)
            }
            try await postMouseUp(end)
        } catch {
            try? await postMouseUp(releasePoint)
            throw error
        }
    }
}
