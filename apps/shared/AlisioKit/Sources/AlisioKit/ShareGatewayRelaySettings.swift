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
    private static let suiteName = AlisioBranding.shareGroupSuiteName
    private static let relayConfigKey = "share.gatewayRelay.config.v1"
    private static let lastEventKey = "share.gatewayRelay.event.v1"

    public static func loadConfig() -> ShareGatewayRelayConfig? {
        guard let data = AlisioDefaultsStore.loadData(
            forKey: self.relayConfigKey,
            suiteName: self.suiteName)
        else {
            return nil
        }
        return try? JSONDecoder().decode(ShareGatewayRelayConfig.self, from: data)
    }

    public static func saveConfig(_ config: ShareGatewayRelayConfig) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        AlisioDefaultsStore.save(
            data,
            forKey: self.relayConfigKey,
            suiteName: self.suiteName)
    }

    public static func clearConfig() {
        AlisioDefaultsStore.removeObject(
            forKey: self.relayConfigKey,
            suiteName: self.suiteName)
    }

    public static func saveLastEvent(_ message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let payload = "[\(timestamp)] \(message)"
        AlisioDefaultsStore.save(
            payload,
            forKey: self.lastEventKey,
            suiteName: self.suiteName)
    }

    public static func loadLastEvent() -> String? {
        let value = AlisioDefaultsStore.loadString(
            forKey: self.lastEventKey,
            suiteName: self.suiteName)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }
}
