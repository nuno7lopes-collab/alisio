import Foundation

private struct StoredPushRelayRegistrationState: Codable {
    var relayHandle: String
    var sendGrant: String
    var relayOrigin: String?
    var gatewayDeviceId: String
    var relayHandleExpiresAtMs: Int64?
    var tokenDebugSuffix: String?
    var lastAPNsTokenHashHex: String
    var installationId: String
    var lastTransport: String
}

enum PushRelayRegistrationStore {
    private static let service = "ai.alisio.pushrelay"
    private static let legacyService = service
    private static let registrationStateAccount = "registration-state"
    private static let appAttestKeyIDAccount = "app-attest-key-id"
    private static let appAttestedKeyIDAccount = "app-attested-key-id"

    struct RegistrationState: Codable {
        var relayHandle: String
        var sendGrant: String
        var relayOrigin: String?
        var gatewayDeviceId: String
        var relayHandleExpiresAtMs: Int64?
        var tokenDebugSuffix: String?
        var lastAPNsTokenHashHex: String
        var installationId: String
        var lastTransport: String
    }

    static func loadRegistrationState() -> RegistrationState? {
        guard let raw = self.loadPromotingRawString(
            service: self.service,
            legacyService: self.legacyService,
            account: self.registrationStateAccount),
            let data = raw.data(using: .utf8),
            let decoded = try? JSONDecoder().decode(StoredPushRelayRegistrationState.self, from: data)
        else {
            return nil
        }
        return RegistrationState(
            relayHandle: decoded.relayHandle,
            sendGrant: decoded.sendGrant,
            relayOrigin: decoded.relayOrigin,
            gatewayDeviceId: decoded.gatewayDeviceId,
            relayHandleExpiresAtMs: decoded.relayHandleExpiresAtMs,
            tokenDebugSuffix: decoded.tokenDebugSuffix,
            lastAPNsTokenHashHex: decoded.lastAPNsTokenHashHex,
            installationId: decoded.installationId,
            lastTransport: decoded.lastTransport)
    }

    @discardableResult
    static func saveRegistrationState(_ state: RegistrationState) -> Bool {
        let stored = StoredPushRelayRegistrationState(
            relayHandle: state.relayHandle,
            sendGrant: state.sendGrant,
            relayOrigin: state.relayOrigin,
            gatewayDeviceId: state.gatewayDeviceId,
            relayHandleExpiresAtMs: state.relayHandleExpiresAtMs,
            tokenDebugSuffix: state.tokenDebugSuffix,
            lastAPNsTokenHashHex: state.lastAPNsTokenHashHex,
            installationId: state.installationId,
            lastTransport: state.lastTransport)
        guard let data = try? JSONEncoder().encode(stored),
              let raw = String(data: data, encoding: .utf8)
        else {
            return false
        }
        return KeychainStore.saveString(raw, service: self.service, account: self.registrationStateAccount)
    }

    @discardableResult
    static func clearRegistrationState() -> Bool {
        self.deleteCurrentAndLegacyEntries(account: self.registrationStateAccount)
    }

    static func loadAppAttestKeyID() -> String? {
        self.loadPromotingTrimmedString(account: self.appAttestKeyIDAccount)
    }

    @discardableResult
    static func saveAppAttestKeyID(_ keyID: String) -> Bool {
        KeychainStore.saveString(keyID, service: self.service, account: self.appAttestKeyIDAccount)
    }

    @discardableResult
    static func clearAppAttestKeyID() -> Bool {
        self.deleteCurrentAndLegacyEntries(account: self.appAttestKeyIDAccount)
    }

    static func loadAttestedKeyID() -> String? {
        self.loadPromotingTrimmedString(account: self.appAttestedKeyIDAccount)
    }

    @discardableResult
    static func saveAttestedKeyID(_ keyID: String) -> Bool {
        KeychainStore.saveString(keyID, service: self.service, account: self.appAttestedKeyIDAccount)
    }

    @discardableResult
    static func clearAttestedKeyID() -> Bool {
        self.deleteCurrentAndLegacyEntries(account: self.appAttestedKeyIDAccount)
    }

    private static func loadPromotingTrimmedString(account: String) -> String? {
        if let current = KeychainStore.loadString(service: self.service, account: account)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !current.isEmpty
        {
            return current
        }
        guard let legacy = KeychainStore.loadString(service: self.legacyService, account: account)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !legacy.isEmpty
        else {
            return nil
        }
        _ = KeychainStore.saveString(legacy, service: self.service, account: account)
        return legacy
    }

    private static func loadPromotingRawString(
        service: String,
        legacyService: String,
        account: String) -> String?
    {
        if let current = KeychainStore.loadString(service: service, account: account),
           !current.isEmpty
        {
            return current
        }
        guard let legacy = KeychainStore.loadString(service: legacyService, account: account),
              !legacy.isEmpty
        else {
            return nil
        }
        _ = KeychainStore.saveString(legacy, service: service, account: account)
        return legacy
    }

    @discardableResult
    private static func deleteCurrentAndLegacyEntries(account: String) -> Bool {
        let currentDeleted = KeychainStore.delete(service: self.service, account: account)
        let legacyDeleted = KeychainStore.delete(service: self.legacyService, account: account)
        return currentDeleted || legacyDeleted
    }
}
