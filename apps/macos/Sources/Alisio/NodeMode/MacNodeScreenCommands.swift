import Foundation

import AlisioSupport
enum MacNodeScreenCommand: String, Codable {
    case record = "screen.record"
}

struct MacNodeScreenRecordParams: Codable, Equatable {
    var screenIndex: Int?
    var durationMs: Int?
    var fps: Double?
    var format: String?
    var includeAudio: Bool?
}
