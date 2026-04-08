import Foundation

enum VoiceWakePreferences {
    static let enabledKey = "voiceWake.enabled"
    static let triggerWordsKey = "voiceWake.triggerWords"
    private static let legacyBrandWord = ["open", "claw"].joined()

    // Keep defaults aligned with the mac app.
    static let defaultTriggerWords: [String] = ["alisio", "claude"]
    static let maxWords = 32
    static let maxWordLength = 64

    static func decodeGatewayTriggers(from payloadJSON: String) -> [String]? {
        guard let data = payloadJSON.data(using: .utf8) else { return nil }
        return self.decodeGatewayTriggers(from: data)
    }

    static func decodeGatewayTriggers(from data: Data) -> [String]? {
        struct Payload: Decodable { var triggers: [String] }
        guard let decoded = try? JSONDecoder().decode(Payload.self, from: data) else { return nil }
        return self.sanitizeTriggerWords(decoded.triggers)
    }

    static func loadTriggerWords(defaults: UserDefaults = .standard) -> [String] {
        let stored = defaults.stringArray(forKey: self.triggerWordsKey) ?? self.defaultTriggerWords
        let sanitized = self.sanitizeTriggerWords(stored)
        if sanitized != stored {
            defaults.set(sanitized, forKey: self.triggerWordsKey)
        }
        return sanitized
    }

    static func saveTriggerWords(_ words: [String], defaults: UserDefaults = .standard) {
        defaults.set(self.sanitizeTriggerWords(words), forKey: self.triggerWordsKey)
    }

    static func sanitizeTriggerWords(_ words: [String]) -> [String] {
        let preferredBrandWord = Self.defaultTriggerWords.first ?? "alisio"
        let cleaned = words
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .map { candidate in
                candidate.compare(
                    Self.legacyBrandWord,
                    options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
                    ? preferredBrandWord
                    : candidate
            }
            .filter { !$0.isEmpty }
            .prefix(Self.maxWords)
            .map { String($0.prefix(Self.maxWordLength)) }

        var deduped: [String] = []
        var seen = Set<String>()
        for word in cleaned {
            let key = word.lowercased()
            if seen.insert(key).inserted {
                deduped.append(word)
            }
        }

        return deduped.isEmpty ? Self.defaultTriggerWords : deduped
    }

    static func displayString(for words: [String]) -> String {
        let sanitized = self.sanitizeTriggerWords(words)
        return sanitized.joined(separator: ", ")
    }
}
