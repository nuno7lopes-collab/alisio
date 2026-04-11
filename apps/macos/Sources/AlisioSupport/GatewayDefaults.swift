import Foundation

public enum GatewayDefaults {
    public static let defaultPort = 40705
    private static let envKeys = ["ALISIO_GATEWAY_PORT"]

    public static func resolvedPort(
        env: [String: String] = ProcessInfo.processInfo.environment,
        configPort: Int? = nil,
        storedPort: Int? = nil) -> Int
    {
        for key in self.envKeys {
            let raw = env[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if let parsed = Int(raw), parsed > 0 {
                return parsed
            }
        }
        if let configPort, configPort > 0 {
            return configPort
        }
        if let storedPort, storedPort > 0 {
            return storedPort
        }
        return self.defaultPort
    }
}
