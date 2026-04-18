import Foundation

public enum InstanceIdentity {
    private static let suiteName = AlisioBranding.sharedSuiteName
    private static let instanceIdKey = "instanceId"

    public static let instanceId: String = {
        if let existing = AlisioDefaultsStore.loadString(
            forKey: instanceIdKey,
            suiteName: suiteName)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !existing.isEmpty
        {
            return existing
        }

        let id = UUID().uuidString.lowercased()
        AlisioDefaultsStore.save(
            id,
            forKey: instanceIdKey,
            suiteName: suiteName)
        return id
    }()

    public static let displayName: String = {
        if let name = Host.current().localizedName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !name.isEmpty
        {
            return name
        }
        return AlisioBranding.lowercaseName
    }()

    public static let modelIdentifier: String? = {
        var size = 0
        guard sysctlbyname("hw.model", nil, &size, nil, 0) == 0, size > 1 else { return nil }

        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname("hw.model", &buffer, &size, nil, 0) == 0 else { return nil }

        let bytes = buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
        guard let raw = String(bytes: bytes, encoding: .utf8) else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }()

    public static let deviceFamily: String = {
        return "Mac"
    }()

    public static let platformString: String = {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "macOS \(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }()
}
