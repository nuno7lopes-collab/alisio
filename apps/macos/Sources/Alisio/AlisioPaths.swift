import Foundation

import AlisioSupport
enum AlisioEnv {
    static func path(_ key: String) -> String? {
        // Normalize env overrides once so UI + file IO stay consistent.
        guard let raw = getenv(key) else { return nil }
        let value = String(cString: raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty
        else {
            return nil
        }
        return value
    }
}

enum AlisioPaths {
    private static let configPathEnv = [AlisioBrand.configPathEnv, LegacyBrand.configPathEnv]
    private static let stateDirEnv = [AlisioBrand.stateDirEnv, LegacyBrand.stateDirEnv]

    private static var legacyStateDirURL: URL {
        FileManager().homeDirectoryForCurrentUser
            .appendingPathComponent(LegacyBrand.stateDirectoryName, isDirectory: true)
    }

    static var stateDirURL: URL {
        for key in self.stateDirEnv {
            if let override = AlisioEnv.path(key) {
                return URL(fileURLWithPath: override, isDirectory: true)
            }
        }
        let home = FileManager().homeDirectoryForCurrentUser
        let preferred = home.appendingPathComponent(AlisioBrand.stateDirectoryName, isDirectory: true)
        if FileManager().fileExists(atPath: preferred.path) { return preferred }
        if FileManager().fileExists(atPath: self.legacyStateDirURL.path) { return self.legacyStateDirURL }
        return preferred
    }

    private static func resolveConfigCandidate(in dir: URL) -> URL? {
        let candidates = [
            dir.appendingPathComponent(AlisioBrand.configFileName),
            dir.appendingPathComponent(LegacyBrand.configFileName),
        ]
        return candidates.first(where: { FileManager().fileExists(atPath: $0.path) })
    }

    static var configURL: URL {
        for key in self.configPathEnv {
            if let override = AlisioEnv.path(key) {
                return URL(fileURLWithPath: override)
            }
        }
        let stateDir = self.stateDirURL
        if let existing = self.resolveConfigCandidate(in: stateDir) {
            return existing
        }
        return stateDir.appendingPathComponent(AlisioBrand.configFileName)
    }

    static var workspaceURL: URL {
        self.stateDirURL.appendingPathComponent("workspace", isDirectory: true)
    }
}
