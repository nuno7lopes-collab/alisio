import Foundation

enum AlisioBranding {
    static let canonicalDisplayName = "Alisio"
    static let legacyDisplayName = ["Open", "Claw"].joined()
    static let canonicalLowercaseName = "alisio"
    static let legacyLowercaseName = ["open", "claw"].joined()
    static let canonicalStateDirEnv = "ALISIO_STATE_DIR"
    static let legacyStateDirEnv = "OPENCLAW_STATE_DIR"
    static let canonicalSharedSuiteName = "ai.alisio.shared"
    static let legacySharedSuiteName = "ai.openclaw.shared"
    static let canonicalShareGroupSuiteName = "group.ai.alisio.shared"
    static let legacyShareGroupSuiteName = "group.ai.openclaw.shared"
    static let canonicalTLSPinningService = "ai.alisio.tls-pinning"
    static let legacyTLSPinningService = "ai.openclaw.tls-pinning"
    static let canonicalDeepLinkScheme = "alisio"
    static let legacyDeepLinkScheme = ["open", "claw"].joined()
    static let canonicalCanvasCapabilityMarker = "/__alisio__/cap/"
    static let legacyCanvasCapabilityMarker = "/__openclaw__/cap/"
    static let canonicalA2UIStatusEvent = "alisio:a2ui-action-status"

    static func preferredDirectory(
        in base: URL,
        canonicalName: String = canonicalDisplayName,
        legacyName: String = legacyDisplayName) -> URL
    {
        let fileManager = FileManager.default
        let canonicalURL = base.appendingPathComponent(canonicalName, isDirectory: true)
        if fileManager.fileExists(atPath: canonicalURL.path) {
            return canonicalURL
        }

        let legacyURL = base.appendingPathComponent(legacyName, isDirectory: true)
        if fileManager.fileExists(atPath: legacyURL.path) {
            return legacyURL
        }

        return canonicalURL
    }

    static func canonicalizeCanvasCapabilityMarker(in value: String) -> String {
        value.replacingOccurrences(of: legacyCanvasCapabilityMarker, with: canonicalCanvasCapabilityMarker)
    }
}

enum AlisioDefaultsMigrationSupport {
    static func loadString(
        forKey key: String,
        canonicalSuiteName: String,
        legacySuiteName: String) -> String?
    {
        if let canonical = self.canonicalDefaults(suiteName: canonicalSuiteName),
           let value = canonical.string(forKey: key)
        {
            return value
        }

        if let legacy = self.legacyDefaults(suiteName: legacySuiteName),
           let value = legacy.string(forKey: key)
        {
            self.canonicalDefaults(suiteName: canonicalSuiteName)?.set(value, forKey: key)
            legacy.removeObject(forKey: key)
            return value
        }

        let standardValue = UserDefaults.standard.string(forKey: key)
        if let standardValue {
            self.canonicalDefaults(suiteName: canonicalSuiteName)?.set(standardValue, forKey: key)
        }
        return standardValue
    }

    static func loadData(
        forKey key: String,
        canonicalSuiteName: String,
        legacySuiteName: String) -> Data?
    {
        if let canonical = self.canonicalDefaults(suiteName: canonicalSuiteName),
           let value = canonical.data(forKey: key)
        {
            return value
        }

        if let legacy = self.legacyDefaults(suiteName: legacySuiteName),
           let value = legacy.data(forKey: key)
        {
            self.canonicalDefaults(suiteName: canonicalSuiteName)?.set(value, forKey: key)
            legacy.removeObject(forKey: key)
            return value
        }

        let standardValue = UserDefaults.standard.data(forKey: key)
        if let standardValue {
            self.canonicalDefaults(suiteName: canonicalSuiteName)?.set(standardValue, forKey: key)
        }
        return standardValue
    }

    static func save(
        _ value: Any,
        forKey key: String,
        canonicalSuiteName: String,
        legacySuiteName: String)
    {
        if let canonical = self.canonicalDefaults(suiteName: canonicalSuiteName) {
            canonical.set(value, forKey: key)
            self.legacyDefaults(suiteName: legacySuiteName)?.removeObject(forKey: key)
            UserDefaults.standard.removeObject(forKey: key)
            return
        }

        if let legacy = self.legacyDefaults(suiteName: legacySuiteName) {
            legacy.set(value, forKey: key)
            return
        }

        UserDefaults.standard.set(value, forKey: key)
    }

    static func removeObject(
        forKey key: String,
        canonicalSuiteName: String,
        legacySuiteName: String)
    {
        self.canonicalDefaults(suiteName: canonicalSuiteName)?.removeObject(forKey: key)
        self.legacyDefaults(suiteName: legacySuiteName)?.removeObject(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
    }

    private static func canonicalDefaults(suiteName: String) -> UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    private static func legacyDefaults(suiteName: String) -> UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }
}
