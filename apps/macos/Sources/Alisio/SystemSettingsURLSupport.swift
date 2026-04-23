import AppKit
import Foundation

import AlisioSupport
enum SystemSettingsURLSupport {
    @discardableResult
    static func openFirst(_ candidates: [String], openURL: (URL) -> Bool = { NSWorkspace.shared.open($0) }) -> URL? {
        for url in self.urls(from: candidates) {
            if openURL(url) {
                return url
            }
        }
        return nil
    }

    static func urls(from candidates: [String]) -> [URL] {
        candidates.compactMap { candidate in
            let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            guard
                !trimmed.isEmpty,
                let url = URL(string: trimmed),
                let scheme = url.scheme,
                !scheme.isEmpty
            else {
                return nil
            }
            return url
        }
    }
}
