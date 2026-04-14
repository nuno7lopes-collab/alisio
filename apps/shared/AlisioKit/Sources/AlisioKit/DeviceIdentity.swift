import CryptoKit
import Foundation

public struct DeviceIdentity: Codable, Sendable {
    public var deviceId: String
    public var publicKey: String
    public var privateKey: String
    public var createdAtMs: Int

    public init(deviceId: String, publicKey: String, privateKey: String, createdAtMs: Int) {
        self.deviceId = deviceId
        self.publicKey = publicKey
        self.privateKey = privateKey
        self.createdAtMs = createdAtMs
    }
}

private struct CanonicalStoredDeviceIdentity: Codable, Equatable {
    var version: Int
    var deviceId: String
    var publicKeyPem: String
    var privateKeyPem: String
    var createdAtMs: Int
}

enum DeviceIdentityPaths {
    private static func explicitStateDirURL() -> URL? {
        guard let raw = getenv(AlisioBranding.stateDirEnv) else { return nil }
        let value = String(cString: raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        return URL(fileURLWithPath: value, isDirectory: true)
    }

    static func stateDirURL() -> URL {
        if let explicit = self.explicitStateDirURL() {
            return explicit
        }

#if os(macOS)
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".\(AlisioBranding.lowercaseName)", isDirectory: true)
#else
        if let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            return AlisioBranding.preferredDirectory(in: appSupport)
        }

        return AlisioBranding.preferredDirectory(
            in: FileManager.default.temporaryDirectory,
            canonicalName: AlisioBranding.lowercaseName)
#endif
    }

#if os(macOS)
    static func legacyStateDirURL() -> URL? {
        guard self.explicitStateDirURL() == nil else { return nil }
        guard let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else {
            return nil
        }
        return AlisioBranding.preferredDirectory(in: appSupport)
    }
#endif
}

public enum DeviceIdentityStore {
    private static let fileName = "device.json"
    private static let publicKeyDerPrefix = Data([
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ])
    private static let privateKeyDerPrefix = Data([
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ])

    public static func loadOrCreate() -> DeviceIdentity {
        let url = self.fileURL()
        if let identity = self.loadStoredIdentity(from: url) {
            return identity
        }

#if os(macOS)
        if let legacyUrl = self.legacyFileURL(),
           legacyUrl != url,
           let identity = self.loadStoredIdentity(from: legacyUrl)
        {
            self.save(identity, to: url)
            return identity
        }
#endif

        let identity = self.generate()
        self.save(identity)
        return identity
    }

    public static func signPayload(_ payload: String, identity: DeviceIdentity) -> String? {
        guard let privateKeyData = Data(base64Encoded: identity.privateKey) else { return nil }
        do {
            let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: privateKeyData)
            let signature = try privateKey.signature(for: Data(payload.utf8))
            return self.base64UrlEncode(signature)
        } catch {
            return nil
        }
    }

    private static func generate() -> DeviceIdentity {
        let privateKey = Curve25519.Signing.PrivateKey()
        let publicKey = privateKey.publicKey
        let publicKeyData = publicKey.rawRepresentation
        let privateKeyData = privateKey.rawRepresentation
        let deviceId = SHA256.hash(data: publicKeyData).compactMap { String(format: "%02x", $0) }.joined()
        return DeviceIdentity(
            deviceId: deviceId,
            publicKey: publicKeyData.base64EncodedString(),
            privateKey: privateKeyData.base64EncodedString(),
            createdAtMs: Int(Date().timeIntervalSince1970 * 1000))
    }

    private static func base64UrlEncode(_ data: Data) -> String {
        let base64 = data.base64EncodedString()
        return base64
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func publicKeyBase64Url(_ identity: DeviceIdentity) -> String? {
        guard let data = Data(base64Encoded: identity.publicKey) else { return nil }
        return self.base64UrlEncode(data)
    }

    private static func save(_ identity: DeviceIdentity, to url: URL? = nil) {
        guard let stored = self.canonicalStoredIdentity(from: identity) else { return }
        let targetURL = url ?? self.fileURL()
        do {
            try FileManager.default.createDirectory(
                at: targetURL.deletingLastPathComponent(),
                withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(stored)
            try data.write(to: targetURL, options: [.atomic])
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: targetURL.path)
        } catch {
            // best-effort only
        }
    }

    private static func loadStoredIdentity(from url: URL) -> DeviceIdentity? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        if let canonical = try? JSONDecoder().decode(CanonicalStoredDeviceIdentity.self, from: data),
           let identity = self.identity(fromCanonical: canonical)
        {
            let normalized = self.canonicalStoredIdentity(from: identity)
            if normalized != canonical {
                self.save(identity, to: url)
            }
            return identity
        }
        if let legacy = try? JSONDecoder().decode(DeviceIdentity.self, from: data),
           let identity = self.identity(fromLegacy: legacy)
        {
            self.save(identity, to: url)
            return identity
        }
        return nil
    }

    private static func identity(fromCanonical stored: CanonicalStoredDeviceIdentity) -> DeviceIdentity? {
        guard stored.version == 1,
              let privateKeyData = self.rawPrivateKeyData(fromPem: stored.privateKeyPem)
        else {
            return nil
        }
        return self.normalizeRawIdentity(
            privateKeyData: privateKeyData,
            createdAtMs: stored.createdAtMs)
    }

    private static func identity(fromLegacy stored: DeviceIdentity) -> DeviceIdentity? {
        guard !stored.deviceId.isEmpty,
              !stored.publicKey.isEmpty,
              !stored.privateKey.isEmpty,
              let privateKeyData = Data(base64Encoded: stored.privateKey)
        else {
            return nil
        }
        return self.normalizeRawIdentity(
            privateKeyData: privateKeyData,
            createdAtMs: stored.createdAtMs)
    }

    private static func normalizeRawIdentity(
        privateKeyData: Data,
        createdAtMs: Int
    ) -> DeviceIdentity?
    {
        do {
            let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: privateKeyData)
            let derivedPublicKeyData = privateKey.publicKey.rawRepresentation
            return DeviceIdentity(
                deviceId: self.deviceId(for: derivedPublicKeyData),
                publicKey: derivedPublicKeyData.base64EncodedString(),
                privateKey: privateKeyData.base64EncodedString(),
                createdAtMs: createdAtMs)
        } catch {
            return nil
        }
    }

    private static func canonicalStoredIdentity(from identity: DeviceIdentity) -> CanonicalStoredDeviceIdentity? {
        guard let privateKeyData = Data(base64Encoded: identity.privateKey),
              let normalized = self.normalizeRawIdentity(
                  privateKeyData: privateKeyData,
                  createdAtMs: identity.createdAtMs),
              let publicKeyData = Data(base64Encoded: normalized.publicKey)
        else {
            return nil
        }

        return CanonicalStoredDeviceIdentity(
            version: 1,
            deviceId: normalized.deviceId,
            publicKeyPem: self.publicKeyPem(fromRaw: publicKeyData),
            privateKeyPem: self.privateKeyPem(fromRaw: privateKeyData),
            createdAtMs: normalized.createdAtMs)
    }

    private static func rawPrivateKeyData(fromPem pem: String) -> Data? {
        guard let der = self.pemBodyData(pem) else { return nil }
        if der.count == 32 {
            return der
        }
        guard der.count == self.privateKeyDerPrefix.count + 32,
              der.starts(with: self.privateKeyDerPrefix)
        else {
            return nil
        }
        return der.suffix(32)
    }

    private static func pemBodyData(_ pem: String) -> Data? {
        let trimmed = pem.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let body = trimmed
            .split(whereSeparator: \.isNewline)
            .filter { !$0.hasPrefix("-----BEGIN") && !$0.hasPrefix("-----END") }
            .joined()
        guard !body.isEmpty else { return nil }
        return Data(base64Encoded: body)
    }

    private static func publicKeyPem(fromRaw keyData: Data) -> String {
        var der = self.publicKeyDerPrefix
        der.append(keyData)
        return self.pemEncode(der, header: "PUBLIC KEY")
    }

    private static func privateKeyPem(fromRaw keyData: Data) -> String {
        var der = self.privateKeyDerPrefix
        der.append(keyData)
        return self.pemEncode(der, header: "PRIVATE KEY")
    }

    private static func pemEncode(_ der: Data, header: String) -> String {
        let base64 = der.base64EncodedString()
        var lines: [String] = []
        var index = base64.startIndex
        while index < base64.endIndex {
            let next = base64.index(index, offsetBy: 64, limitedBy: base64.endIndex) ?? base64.endIndex
            lines.append(String(base64[index..<next]))
            index = next
        }
        return "-----BEGIN \(header)-----\n\(lines.joined(separator: "\n"))\n-----END \(header)-----\n"
    }

    private static func deviceId(for publicKeyData: Data) -> String {
        SHA256.hash(data: publicKeyData).compactMap { String(format: "%02x", $0) }.joined()
    }

#if os(macOS)
    private static func legacyFileURL() -> URL? {
        guard let base = DeviceIdentityPaths.legacyStateDirURL() else { return nil }
        return base
            .appendingPathComponent("identity", isDirectory: true)
            .appendingPathComponent(fileName, isDirectory: false)
    }
#endif

    private static func fileURL() -> URL {
        let base = DeviceIdentityPaths.stateDirURL()
        return base
            .appendingPathComponent("identity", isDirectory: true)
            .appendingPathComponent(fileName, isDirectory: false)
    }
}
