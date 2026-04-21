import Darwin
import Foundation
import OSLog

import AlisioSupport

let macNodeComputerHelperProtocolVersion = 2

enum MacNodeComputerHelperMethod: String, Codable, Sendable {
    case startSession
    case stopSession
    case pauseSession
    case resumeSession
    case captureFrame
    case performActions
    case getContext
    case getPermissionState
    case health
    case kill
}

enum MacNodeComputerHelperConnectionState: String, Codable, Equatable, Sendable {
    case idle
    case starting
    case running
    case interrupted
    case invalidated
    case disabled
}

enum MacNodeComputerHelperErrorCode: String, Codable, Equatable, Sendable {
    case permissionMissing = "PERMISSION_MISSING"
    case helperUnavailable = "HELPER_UNAVAILABLE"
    case captureFailed = "CAPTURE_FAILED"
    case actionRejected = "ACTION_REJECTED"
    case connectionInterrupted = "CONNECTION_INTERRUPTED"
    case connectionInvalidated = "CONNECTION_INVALIDATED"
    case protocolVersionMismatch = "PROTOCOL_VERSION_MISMATCH"
    case invalidRequest = "INVALID_REQUEST"
}

struct MacNodeComputerHelperErrorPayload: Codable, Equatable, Sendable, Error {
    var code: MacNodeComputerHelperErrorCode
    var message: String
    var retryable: Bool
    var permission: String?
}

extension MacNodeComputerHelperErrorPayload: LocalizedError {
    var errorDescription: String? {
        "\(self.code.rawValue): \(self.message)"
    }
}

enum MacNodeComputerSessionLifecycleState: String, Codable, Equatable, Sendable {
    case running
    case paused
    case stopped
}

struct MacNodeComputerPermissionPayload: Codable, Equatable, Sendable {
    var accessibility: Bool
    var screenRecording: Bool
    var accessibilityRestartRequired: Bool? = nil
    var screenRecordingRestartRequired: Bool? = nil
}

struct MacNodeComputerHelperSessionSummary: Codable, Equatable, Sendable {
    var sessionId: String
    var state: MacNodeComputerSessionLifecycleState
    var updatedAt: Int
}

struct MacNodeComputerHelperHealthPayload: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var helperVersion: String
    var processId: Int32
    var activeSession: MacNodeComputerHelperSessionSummary?
    var lastError: MacNodeComputerHelperErrorPayload?
}

struct MacNodeComputerRuntimeHealthPayload: Codable, Equatable, Sendable {
    var connectionState: MacNodeComputerHelperConnectionState
    var launchCount: Int
    var helper: MacNodeComputerHelperHealthPayload?
    var lastError: MacNodeComputerHelperErrorPayload?
}

struct MacNodeComputerSessionParams: Codable, Equatable, Sendable {
    var sessionId: String?
}

struct MacNodeComputerHealthQueryParams: Codable, Equatable, Sendable {
    var sessionId: String?
}

struct MacNodeComputerSessionPayload: Codable, Equatable, Sendable {
    var sessionId: String
    var state: MacNodeComputerSessionLifecycleState
    var permissions: MacNodeComputerPermissionPayload
    var health: MacNodeComputerRuntimeHealthPayload
}

struct MacNodeComputerHelperSessionPayload: Codable, Equatable, Sendable {
    var sessionId: String
    var state: MacNodeComputerSessionLifecycleState
    var permissions: MacNodeComputerPermissionPayload
    var helper: MacNodeComputerHelperHealthPayload
}

struct MacNodeComputerPerformActionsParams: Codable, Equatable, Sendable {
    var sessionId: String?
    var actions: [MacNodeComputerActionPayload]
}

struct MacNodeComputerHelperRequestEnvelope: Codable, Sendable {
    var version: Int
    var id: String
    var method: MacNodeComputerHelperMethod
    var payloadJSON: String?
}

struct MacNodeComputerHelperResponseEnvelope: Codable, Sendable {
    var version: Int
    var id: String
    var ok: Bool
    var payloadJSON: String?
    var error: MacNodeComputerHelperErrorPayload?
}

enum MacNodeComputerHelperSettings {
    private static let defaultsKey = AlisioBrand.defaultsPrefix + "computerHelperDisabled"
    static let helperFlag = "--computer-helper"

    static func isDisabled(
        defaults: UserDefaults = .standard,
        environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool
    {
        if let raw = environment["ALISIO_COMPUTER_HELPER_DISABLED"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !raw.isEmpty
        {
            return raw == "1" || raw.caseInsensitiveCompare("true") == .orderedSame
        }
        return defaults.object(forKey: self.defaultsKey) as? Bool ?? false
    }

    static func normalizedSessionId(_ raw: String?) -> String {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "main" : trimmed
    }
}

enum MacNodeComputerHelperProtocolCodec {
    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()

    static func encodePayload<T: Encodable>(_ value: T) throws -> String {
        let data = try self.encoder.encode(value)
        guard let json = String(data: data, encoding: .utf8) else {
            throw MacNodeComputerHelperErrorPayload(
                code: .invalidRequest,
                message: "failed to encode helper payload",
                retryable: false)
        }
        return json
    }

    static func decodePayload<T: Decodable>(_ type: T.Type, from json: String?) throws -> T {
        let data = Data((json ?? "").utf8)
        return try self.decoder.decode(type, from: data)
    }

    static func encodeRequest(
        id: String,
        method: MacNodeComputerHelperMethod,
        payloadJSON: String?) throws -> String
    {
        try self.encodePayload(MacNodeComputerHelperRequestEnvelope(
            version: macNodeComputerHelperProtocolVersion,
            id: id,
            method: method,
            payloadJSON: payloadJSON))
    }

    static func decodeRequest(from line: String) throws -> MacNodeComputerHelperRequestEnvelope {
        try self.decodePayload(MacNodeComputerHelperRequestEnvelope.self, from: line)
    }

    static func encodeResponse(_ response: MacNodeComputerHelperResponseEnvelope) throws -> String {
        try self.encodePayload(response)
    }

    static func decodeResponse(from line: String) throws -> MacNodeComputerHelperResponseEnvelope {
        try self.decodePayload(MacNodeComputerHelperResponseEnvelope.self, from: line)
    }
}

enum MacNodeComputerHelperLogLevel: String, Sendable {
    case info
    case warning
    case error
}

enum MacNodeComputerHelperLogger {
    private static let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "computer-helper")

    static func log(
        _ level: MacNodeComputerHelperLogLevel,
        event: String,
        metadata: [String: String] = [:],
        fileHandle: FileHandle = .standardError)
    {
        let payload: [String: String] = [
            "process": "computer-helper",
            "level": level.rawValue,
            "event": event,
            "pid": "\(getpid())",
            "ts": "\(Int(Date().timeIntervalSince1970 * 1000))",
        ].merging(metadata) { _, rhs in rhs }

        switch level {
        case .info:
            self.logger.info("event=\(event, privacy: .public) metadata=\(String(describing: payload), privacy: .public)")
        case .warning:
            self.logger.warning("event=\(event, privacy: .public) metadata=\(String(describing: payload), privacy: .public)")
        case .error:
            self.logger.error("event=\(event, privacy: .public) metadata=\(String(describing: payload), privacy: .public)")
        }

        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload)
        else {
            return
        }
        try? fileHandle.write(contentsOf: data)
        try? fileHandle.write(contentsOf: Data("\n".utf8))
    }
}
