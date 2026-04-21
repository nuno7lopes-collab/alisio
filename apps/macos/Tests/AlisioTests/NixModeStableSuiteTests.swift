import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
struct NixModeStableSuiteTests {
    @Test func `resolves from stable suite for app bundles`() throws {
        let suite = try #require(UserDefaults(suiteName: launchdLabel))
        let key = "alisio.nixMode"
        let prev = suite.object(forKey: key)
        defer {
            if let prev { suite.set(prev, forKey: key) } else { suite.removeObject(forKey: key) }
        }

        suite.set(true, forKey: key)

        let standard = try #require(UserDefaults(suiteName: "NixModeStableSuiteTests.\(UUID().uuidString)"))
        #expect(!standard.bool(forKey: key))

        let resolved = ProcessInfo.resolveNixMode(
            environment: [:],
            standard: standard,
            stableSuites: [suite],
            isAppBundle: true)
        #expect(resolved)
    }

    @Test func `ignores stable suite outside app bundles`() throws {
        let suite = try #require(UserDefaults(suiteName: launchdLabel))
        let key = "alisio.nixMode"
        let prev = suite.object(forKey: key)
        defer {
            if let prev { suite.set(prev, forKey: key) } else { suite.removeObject(forKey: key) }
        }

        suite.set(true, forKey: key)
        let standard = try #require(UserDefaults(suiteName: "NixModeStableSuiteTests.\(UUID().uuidString)"))

        let resolved = ProcessInfo.resolveNixMode(
            environment: [:],
            standard: standard,
            stableSuites: [suite],
            isAppBundle: false)
        #expect(!resolved)
    }

    @Test func `resolves nix mode from alisio env`() throws {
        let standard = try #require(UserDefaults(suiteName: "NixModeStableSuiteTests.\(UUID().uuidString)"))
        let resolved = ProcessInfo.resolveNixMode(
            environment: ["ALISIO_NIX_MODE": "1"],
            standard: standard,
            stableSuites: [],
            isAppBundle: true)
        #expect(resolved)
    }
}
