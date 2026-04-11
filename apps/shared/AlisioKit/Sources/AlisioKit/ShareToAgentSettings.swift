import Foundation

public enum ShareToAgentSettings {
    private static let suiteName = AlisioBranding.shareGroupSuiteName
    private static let defaultInstructionKey = "share.defaultInstruction"
    private static let fallbackInstruction = "Please help me with this."

    public static func loadDefaultInstruction() -> String {
        let raw = AlisioDefaultsStore.loadString(
            forKey: self.defaultInstructionKey,
            suiteName: self.suiteName)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let raw, !raw.isEmpty {
            return raw
        }
        return self.fallbackInstruction
    }

    public static func saveDefaultInstruction(_ value: String?) {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            AlisioDefaultsStore.removeObject(
                forKey: self.defaultInstructionKey,
                suiteName: self.suiteName)
            return
        }
        AlisioDefaultsStore.save(
            trimmed,
            forKey: self.defaultInstructionKey,
            suiteName: self.suiteName)
    }
}
