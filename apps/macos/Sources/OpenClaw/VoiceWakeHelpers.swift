import Foundation

struct VoiceWakeLocaleSelection: Equatable {
    let primary: String
    let additional: [String]

    var ordered: [String] {
        [self.primary] + self.additional
    }
}

func sanitizeVoiceWakeTriggers(_ words: [String]) -> [String] {
    let cleaned = words
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .prefix(voiceWakeMaxWords)
        .map { String($0.prefix(voiceWakeMaxWordLength)) }
    return cleaned.isEmpty ? defaultVoiceWakeTriggers : cleaned
}

func normalizeLocaleIdentifier(_ raw: String) -> String {
    var trimmed = raw
    if let at = trimmed.firstIndex(of: "@") {
        trimmed = String(trimmed[..<at])
    }
    if let u = trimmed.range(of: "-u-") {
        trimmed = String(trimmed[..<u.lowerBound])
    }
    if let t = trimmed.range(of: "-t-") {
        trimmed = String(trimmed[..<t.lowerBound])
    }
    return trimmed
}

func canonicalVoiceWakeLocaleIdentifier(_ raw: String) -> String? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let normalized = normalizeLocaleIdentifier(trimmed)
    guard !normalized.isEmpty else { return nil }
    let canonical = Locale.identifier(.icu, from: normalized)
    let candidate = (canonical.isEmpty ? normalized : canonical).replacingOccurrences(of: "-", with: "_")
    return candidate.isEmpty ? nil : candidate
}

func resolveVoiceWakeLocaleSelection(
    primary rawPrimary: String,
    additional rawAdditional: [String],
    availableLocaleIDs: [String] = []) -> VoiceWakeLocaleSelection
{
    let lookup = VoiceWakeLocaleLookup(ids: availableLocaleIDs)

    func resolveCandidate(_ raw: String) -> String? {
        guard let canonical = canonicalVoiceWakeLocaleIdentifier(raw) else { return nil }
        if !lookup.ids.isEmpty {
            if let exact = lookup.byCanonical[canonical] {
                return exact
            }
            guard let languageCode = voiceWakeLanguageCode(for: canonical) else { return nil }
            return lookup.ids.first { voiceWakeLanguageCode(for: $0) == languageCode }
        }
        return canonical
    }

    let fallback = [rawPrimary, Locale.current.identifier]
        .compactMap(resolveCandidate)
        .first
        ?? lookup.ids.first
        ?? canonicalVoiceWakeLocaleIdentifier(Locale.current.identifier)
        ?? "en_US"

    let primary = resolveCandidate(rawPrimary) ?? fallback

    var seenCanonicals = Set([canonicalVoiceWakeLocaleIdentifier(primary)].compactMap { $0 })
    var additional: [String] = []

    for raw in rawAdditional {
        guard let resolved = resolveCandidate(raw),
              let canonical = canonicalVoiceWakeLocaleIdentifier(resolved),
              !seenCanonicals.contains(canonical)
        else { continue }
        seenCanonicals.insert(canonical)
        additional.append(resolved)
    }

    return VoiceWakeLocaleSelection(primary: primary, additional: additional)
}

func voiceWakeLocaleDisplayName(_ localeID: String, displayLocale: Locale = .current) -> String {
    let cleanedID = canonicalVoiceWakeLocaleIdentifier(localeID) ?? normalizeLocaleIdentifier(localeID)
    let locale = Locale(identifier: cleanedID)

    if let langCode = locale.language.languageCode?.identifier,
       let language = displayLocale.localizedString(forLanguageCode: langCode),
       let regionCode = locale.region?.identifier,
       let region = displayLocale.localizedString(forRegionCode: regionCode)
    {
        return "\(language) (\(region))"
    }

    if let langCode = locale.language.languageCode?.identifier,
       let language = displayLocale.localizedString(forLanguageCode: langCode)
    {
        return language
    }

    return displayLocale.localizedString(forIdentifier: cleanedID) ?? cleanedID
}

private struct VoiceWakeLocaleLookup {
    let ids: [String]
    let byCanonical: [String: String]

    init(ids: [String]) {
        var ordered: [String] = []
        var canonicalMap: [String: String] = [:]

        for id in ids {
            guard let canonical = canonicalVoiceWakeLocaleIdentifier(id),
                  canonicalMap[canonical] == nil
            else { continue }
            canonicalMap[canonical] = id
            ordered.append(id)
        }

        self.ids = ordered
        self.byCanonical = canonicalMap
    }
}

private func voiceWakeLanguageCode(for localeID: String) -> String? {
    Locale(identifier: localeID).language.languageCode?.identifier
}
