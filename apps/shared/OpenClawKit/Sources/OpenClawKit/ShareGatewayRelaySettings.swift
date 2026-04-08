import Foundation

public struct ShareGatewayRelayConfig: Codable, Sendable, Equatable {
    public let gatewayURLString: String
    public let token: String?
    public let password: String?
    public let sessionKey: String
    public let deliveryChannel: String?
    public let deliveryTo: String?

    public init(
        gatewayURLString: String,
        token: String?,
        password: String?,
        sessionKey: String,
        deliveryChannel: String? = nil,
        deliveryTo: String? = nil)
    {
        self.gatewayURLString = gatewayURLString
        self.token = token
        self.password = password
        self.sessionKey = sessionKey
        self.deliveryChannel = deliveryChannel
        self.deliveryTo = deliveryTo
    }
}

public enum ShareGatewayRelaySettings {
    private static let canonicalSuiteName = AlisioBranding.canonicalShareGroupSuiteName
    private static let legacySuiteName = AlisioBranding.legacyShareGroupSuiteName
    private static let relayConfigKey = "share.gatewayRelay.config.v1"
    private static let lastEventKey = "share.gatewayRelay.event.v1"

    public static func loadConfig() -> ShareGatewayRelayConfig? {
        guard let data = AlisioDefaultsMigrationSupport.loadData(
            forKey: self.relayConfigKey,
            canonicalSuiteName: self.canonicalSuiteName,
            legacySuiteName: self.legacySuiteName)
        else {
            return nil
        }
        return try? JSONDecoder().decode(ShareGatewayRelayConfig.self, from: data)
    }

    public static func saveConfig(_ config: ShareGatewayRelayConfig) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        AlisioDefaultsMigrationSupport.save(
            data,
            forKey: self.relayConfigKey,
            canonicalSuiteName: self.canonicalSuiteName,
            legacySuiteName: self.legacySuiteName)
    }

    public static func clearConfig() {
        AlisioDefaultsMigrationSupport.removeObject(
            forKey: self.relayConfigKey,
            canonicalSuiteName: self.canonicalSuiteName,
            legacySuiteName: self.legacySuiteName)
    }

    public static func saveLastEvent(_ message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let payload = "[\(timestamp)] \(message)"
        AlisioDefaultsMigrationSupport.save(
            payload,
            forKey: self.lastEventKey,
            canonicalSuiteName: self.canonicalSuiteName,
            legacySuiteName: self.legacySuiteName)
    }

    public static func loadLastEvent() -> String? {
        let value = AlisioDefaultsMigrationSupport.loadString(
            forKey: self.lastEventKey,
            canonicalSuiteName: self.canonicalSuiteName,
            legacySuiteName: self.legacySuiteName)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }
}
