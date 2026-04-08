import Foundation

public enum ShareToAgentSettings {
    private static let canonicalSuiteName = AlisioBranding.canonicalShareGroupSuiteName
    private static let legacySuiteName = AlisioBranding.legacyShareGroupSuiteName
    private static let defaultInstructionKey = "share.defaultInstruction"
    private static let fallbackInstruction = "Please help me with this."

    public static func loadDefaultInstruction() -> String {
        let raw = AlisioDefaultsMigrationSupport.loadString(
            forKey: self.defaultInstructionKey,
            canonicalSuiteName: self.canonicalSuiteName,
            legacySuiteName: self.legacySuiteName)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let raw, !raw.isEmpty {
            return raw
        }
        return self.fallbackInstruction
    }

    public static func saveDefaultInstruction(_ value: String?) {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            AlisioDefaultsMigrationSupport.removeObject(
                forKey: self.defaultInstructionKey,
                canonicalSuiteName: self.canonicalSuiteName,
                legacySuiteName: self.legacySuiteName)
            return
        }
        AlisioDefaultsMigrationSupport.save(
            trimmed,
            forKey: self.defaultInstructionKey,
            canonicalSuiteName: self.canonicalSuiteName,
            legacySuiteName: self.legacySuiteName)
    }
}
