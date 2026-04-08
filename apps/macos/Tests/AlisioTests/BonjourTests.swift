import Darwin
import Foundation
import Testing
import AlisioSupport

@Suite(.serialized)
struct BonjourTests {
    @Test func `wide area domain reads alisio env`() {
        let key = "ALISIO_WIDE_AREA_DOMAIN"
        let previous = ProcessInfo.processInfo.environment[key]
        defer { restoreEnv(key: key, value: previous) }

        setenv(key, "alisio.internal", 1)

        #expect(AlisioBonjour.wideAreaGatewayServiceDomain == "alisio.internal.")
        #expect(AlisioBonjour.gatewayServiceDomains == ["local.", "alisio.internal."])
    }

    @Test func `wide area domain falls back to legacy env`() {
        let key = "ALISIO_WIDE_AREA_DOMAIN"
        let legacyKey = ["OPEN", "CLAW", "WIDE", "AREA", "DOMAIN"].joined(separator: "_")
        let previous = ProcessInfo.processInfo.environment[key]
        let previousLegacy = ProcessInfo.processInfo.environment[legacyKey]
        defer {
            restoreEnv(key: key, value: previous)
            restoreEnv(key: legacyKey, value: previousLegacy)
        }

        unsetenv(key)
        setenv(legacyKey, "legacy.internal", 1)

        #expect(AlisioBonjour.wideAreaGatewayServiceDomain == "legacy.internal.")
    }

    @Test func `normalize service domain preserves local default`() {
        #expect(AlisioBonjour.normalizeServiceDomain(nil) == "local.")
        #expect(AlisioBonjour.normalizeServiceDomain(" local ") == "local.")
        #expect(AlisioBonjour.normalizeServiceDomain("alisio.internal") == "alisio.internal.")
    }

    private func restoreEnv(key: String, value: String?) {
        if let value {
            setenv(key, value, 1)
        } else {
            unsetenv(key)
        }
    }
}
