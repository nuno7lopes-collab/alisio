import Foundation

enum MacNodeComputerCommand: String, Codable, Sendable {
    case observe = "computer.observe"
    case act = "computer.act"
    case sessionStart = "computer.session.start"
    case sessionStop = "computer.session.stop"
    case sessionPause = "computer.session.pause"
    case sessionResume = "computer.session.resume"
    case context = "computer.context"
    case permissions = "computer.permissions"
    case health = "computer.health"
    case helperKill = "computer.helper.kill"
}

enum MacNodeComputerOrientation: String, Codable, Equatable, Sendable {
    case landscape
    case portrait
}

enum MacNodeComputerCoordinateSpace: String, Codable, Equatable, Sendable {
    case displayPixel = "display-pixel"
    case renderedPane = "rendered-pane"
}

enum MacNodeComputerActionFailureCategory: String, Codable, Equatable, Sendable {
    case validation = "validation"
    case staleFrame = "stale-frame"
    case invalidTarget = "invalid-target"
    case permissionMissing = "permission-missing"
    case cancelled = "cancelled"
    case executionFailed = "execution-failed"
    case actionRejected = "action-rejected"
}

struct MacNodeComputerActionFramePayload: Codable, Equatable, Sendable {
    var frameId: String?
    var displayId: String?
    var capturedAt: Int?
    var maxAgeMs: Int?
    var sourceSpace: MacNodeComputerCoordinateSpace?
    var pixelWidth: Double?
    var pixelHeight: Double?
    var logicalWidth: Double?
    var logicalHeight: Double?
    var scaleFactor: Double?
    var orientation: MacNodeComputerOrientation?
}

struct MacNodeComputerActionTransformPayload: Codable, Equatable, Sendable {
    var sourceSpace: MacNodeComputerCoordinateSpace
    var sourceWidth: Double
    var sourceHeight: Double
    var renderedWidth: Double?
    var renderedHeight: Double?
    var downscaleFactorX: Double?
    var downscaleFactorY: Double?
}

struct MacNodeComputerActionResultPayload: Codable, Equatable, Sendable, Error {
    var id: String
    var actionId: String?
    var type: String
    var success: Bool
    var elapsedMs: Int
    var retryCount: Int
    var summary: String
    var failureCategory: MacNodeComputerActionFailureCategory?
    var sourceFrameId: String?
    var resultFrameId: String?
}

struct MacNodeComputerPerformActionsPayload: Codable, Equatable, Sendable {
    var ok: Bool
    var summary: String
    var results: [MacNodeComputerActionResultPayload]
}

struct MacNodeComputerObservePayload: Codable, Sendable {
    struct Frame: Codable, Sendable {
        struct Cursor: Codable, Sendable {
            var x: Double
            var y: Double
            var visible: Bool
        }

        var id: String
        var dataUrl: String
        var mimeType: String
        var width: Int
        var height: Int
        var pixelWidth: Int
        var pixelHeight: Int
        var logicalWidth: Double
        var logicalHeight: Double
        var scaleFactor: Double
        var orientation: MacNodeComputerOrientation
        var displayId: String?
        var sourceSpace: MacNodeComputerCoordinateSpace
        var capturedAt: Int
        var maxAgeMs: Int
        var staleAt: Int
        var cursor: Cursor?
    }

    struct Context: Codable, Sendable {
        struct Display: Codable, Sendable {
            var id: String?
            var width: Double
            var height: Double
            var scale: Double
            var logicalWidth: Double
            var logicalHeight: Double
            var pixelWidth: Double
            var pixelHeight: Double
            var orientation: MacNodeComputerOrientation
        }

        struct ActiveApp: Codable, Sendable {
            var name: String?
            var bundleId: String?
            var processId: Int32?
        }

        struct ActiveWindow: Codable, Sendable {
            var title: String?
        }

        var display: Display
        var activeApp: ActiveApp?
        var activeWindow: ActiveWindow?
        var errorState: String?
        var capturedAt: Int
    }

    var frame: Frame
    var context: Context
}

struct MacNodeComputerActionPayload: Codable, Equatable, Sendable {
    var id: String?
    var type: String
    var x: Double?
    var y: Double?
    var toX: Double?
    var toY: Double?
    var deltaX: Double?
    var deltaY: Double?
    var text: String?
    var key: String?
    var modifiers: [String]?
    var url: String?
    var path: String?
    var app: String?
    var delayMs: Int?
    var coordinateSpace: MacNodeComputerCoordinateSpace?
    var frame: MacNodeComputerActionFramePayload?
    var transform: MacNodeComputerActionTransformPayload?
}

struct MacNodeComputerActPayload: Codable, Sendable {
    var ok: Bool
    var summary: String
    var results: [MacNodeComputerActionResultPayload]
    var observation: MacNodeComputerObservePayload?
}

struct MacNodeComputerActParams: Codable, Equatable, Sendable {
    var sessionId: String?
    var action: MacNodeComputerActionPayload
}
