import Foundation

enum AlisioBranding {
    static let displayName = "Alisio"
    static let lowercaseName = "alisio"
    static let stateDirEnv = "ALISIO_STATE_DIR"
    static let sharedSuiteName = "ai.alisio.shared"
    static let shareGroupSuiteName = "group.ai.alisio.shared"
    static let tlsPinningService = "ai.alisio.tls-pinning"
    static let deepLinkScheme = "alisio"
    static let canvasCapabilityMarker = "/__alisio__/cap/"
    static let a2uiStatusEvent = "alisio:a2ui-action-status"

    static func preferredDirectory(
        in base: URL,
        canonicalName: String = displayName) -> URL
    {
        let fileManager = FileManager.default
        let canonicalURL = base.appendingPathComponent(canonicalName, isDirectory: true)
        if fileManager.fileExists(atPath: canonicalURL.path) {
            return canonicalURL
        }
        return canonicalURL
    }
}

enum AlisioDefaultsStore {
    static func loadString(forKey key: String, suiteName: String) -> String? {
        if let value = self.defaults(suiteName: suiteName)?.string(forKey: key) {
            return value
        }
        return UserDefaults.standard.string(forKey: key)
    }

    static func loadData(forKey key: String, suiteName: String) -> Data? {
        if let value = self.defaults(suiteName: suiteName)?.data(forKey: key) {
            return value
        }
        return UserDefaults.standard.data(forKey: key)
    }

    static func save(_ value: Any, forKey key: String, suiteName: String) {
        if let defaults = self.defaults(suiteName: suiteName) {
            defaults.set(value, forKey: key)
            UserDefaults.standard.removeObject(forKey: key)
            return
        }
        UserDefaults.standard.set(value, forKey: key)
    }

    static func removeObject(forKey key: String, suiteName: String) {
        self.defaults(suiteName: suiteName)?.removeObject(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
    }

    private static func defaults(suiteName: String) -> UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }
}
