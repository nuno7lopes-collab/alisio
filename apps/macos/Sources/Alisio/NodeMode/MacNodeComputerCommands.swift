import Foundation

enum MacNodeComputerCommand: String, Codable {
    case observe = "computer.observe"
    case act = "computer.act"
}

struct MacNodeComputerObservePayload: Codable {
    struct Frame: Codable {
        struct Cursor: Codable {
            var x: Double
            var y: Double
            var visible: Bool
        }

        var dataUrl: String
        var mimeType: String
        var width: Int
        var height: Int
        var capturedAt: Int
        var cursor: Cursor?
    }

    struct Context: Codable {
        struct Display: Codable {
            var id: String?
            var width: Double
            var height: Double
            var scale: Double
        }

        struct ActiveApp: Codable {
            var name: String?
            var bundleId: String?
            var processId: Int32?
        }

        struct ActiveWindow: Codable {
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

struct MacNodeComputerActionPayload: Codable, Equatable {
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
}

struct MacNodeComputerActParams: Codable, Equatable {
    var action: MacNodeComputerActionPayload
}

struct MacNodeComputerActPayload: Codable {
    var ok: Bool
    var summary: String
    var observation: MacNodeComputerObservePayload?
}
