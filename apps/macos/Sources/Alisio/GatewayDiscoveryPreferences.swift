import Foundation

import AlisioSupport
enum GatewayDiscoveryPreferences {
    private static let preferredStableIDKey = "gateway.preferredStableID"

    static func preferredStableID() -> String? {
        let defaults = UserDefaults.standard
        let raw = defaults.string(forKey: self.preferredStableIDKey)
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    static func setPreferredStableID(_ stableID: String?) {
        let trimmed = stableID?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmed, !trimmed.isEmpty {
            UserDefaults.standard.set(trimmed, forKey: self.preferredStableIDKey)
        } else {
            UserDefaults.standard.removeObject(forKey: self.preferredStableIDKey)
        }
    }
}
