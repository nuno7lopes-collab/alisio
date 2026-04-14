import CryptoKit
import Foundation
import Testing
@testable import AlisioKit

private struct CanonicalStoredDeviceIdentityFixture: Codable {
    var version: Int
    var deviceId: String
    var publicKeyPem: String
    var privateKeyPem: String
    var createdAtMs: Int
}

@Suite("DeviceIdentityStore")
struct DeviceIdentityStoreTests {
    @Test func migratesLegacyRawIdentityIntoCanonicalPemStorage() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        let previousStateDir = ProcessInfo.processInfo.environment[AlisioBranding.stateDirEnv]
        setenv(AlisioBranding.stateDirEnv, tempDir.path, 1)
        defer {
            if let previousStateDir {
                setenv(AlisioBranding.stateDirEnv, previousStateDir, 1)
            } else {
                unsetenv(AlisioBranding.stateDirEnv)
            }
            try? FileManager.default.removeItem(at: tempDir)
        }

        let privateKey = Curve25519.Signing.PrivateKey()
        let publicKeyData = privateKey.publicKey.rawRepresentation
        let legacy = DeviceIdentity(
            deviceId: SHA256.hash(data: publicKeyData).compactMap { String(format: "%02x", $0) }.joined(),
            publicKey: Data(publicKeyData).base64EncodedString(),
            privateKey: Data(privateKey.rawRepresentation).base64EncodedString(),
            createdAtMs: 123
        )
        let identityFile = tempDir
            .appendingPathComponent("identity", isDirectory: true)
            .appendingPathComponent("device.json", isDirectory: false)
        try FileManager.default.createDirectory(
            at: identityFile.deletingLastPathComponent(),
            withIntermediateDirectories: true)
        try JSONEncoder().encode(legacy).write(to: identityFile, options: [.atomic])

        let loaded = DeviceIdentityStore.loadOrCreate()
        let stored = try JSONDecoder().decode(
            CanonicalStoredDeviceIdentityFixture.self,
            from: Data(contentsOf: identityFile))

        #expect(loaded.deviceId == legacy.deviceId)
        #expect(loaded.publicKey == legacy.publicKey)
        #expect(loaded.privateKey == legacy.privateKey)
        #expect(stored.version == 1)
        #expect(stored.deviceId == legacy.deviceId)
        #expect(stored.publicKeyPem.contains("BEGIN PUBLIC KEY"))
        #expect(stored.privateKeyPem.contains("BEGIN PRIVATE KEY"))
    }
}
