import Foundation

public enum AlisioCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum AlisioCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum AlisioCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum AlisioCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct AlisioCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: AlisioCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: AlisioCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: AlisioCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: AlisioCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct AlisioCameraClipParams: Codable, Sendable, Equatable {
    public var facing: AlisioCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: AlisioCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: AlisioCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: AlisioCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
