import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
struct GatewayEnvironmentTests {
    private final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var value = 0

        func increment() {
            self.lock.lock()
            self.value += 1
            self.lock.unlock()
        }

        func snapshot() -> Int {
            self.lock.lock()
            defer { self.lock.unlock() }
            return self.value
        }
    }

    @Test func `semver parses common forms`() {
        #expect(Semver.parse("1.2.3") == Semver(major: 1, minor: 2, patch: 3))
        #expect(Semver.parse("  v1.2.3  \n") == Semver(major: 1, minor: 2, patch: 3))
        #expect(Semver.parse("v2.0.0") == Semver(major: 2, minor: 0, patch: 0))
        #expect(Semver.parse("3.4.5-beta.1") == Semver(major: 3, minor: 4, patch: 5)) // prerelease suffix stripped
        #expect(Semver.parse("2026.1.11-4") == Semver(major: 2026, minor: 1, patch: 11)) // build suffix stripped
        #expect(Semver.parse("1.0.5+build.123") == Semver(major: 1, minor: 0, patch: 5)) // metadata suffix stripped
        #expect(Semver.parse("v1.2.3+build.9") == Semver(major: 1, minor: 2, patch: 3))
        #expect(Semver.parse("1.2.3+build.123") == Semver(major: 1, minor: 2, patch: 3))
        #expect(Semver.parse("1.2.3-rc.1+build.7") == Semver(major: 1, minor: 2, patch: 3))
        #expect(Semver.parse("v1.2.3-rc.1") == Semver(major: 1, minor: 2, patch: 3))
        #expect(Semver.parse("1.2.0") == Semver(major: 1, minor: 2, patch: 0))
        #expect(Semver.parse(nil) == nil)
        #expect(Semver.parse("invalid") == nil)
        #expect(Semver.parse("1.2") == nil)
        #expect(Semver.parse("1.2.x") == nil)
        // Product-prefixed output from `alisio --version` should NOT parse as semver
        // (the prefix must be stripped by the caller, not the parser).
        #expect(Semver.parse("Alisio 2026.3.23-1") == nil)
    }

    @Test func `gateway version output strips product prefix before parsing`() {
        let normalized = GatewayEnvironment.normalizeGatewayVersionOutput("  Alisio 2026.3.23-1 \n")
        #expect(normalized == "2026.3.23-1")
        #expect(Semver.parse(normalized) == Semver(major: 2026, minor: 3, patch: 23))
    }

    @Test func `cached gateway environment check reuses recent result`() async {
        await GatewayEnvironment._testResetCache()
        let counter = Counter()
        let expected = GatewayEnvironmentStatus(
            kind: .ok,
            nodeVersion: "22.16.0",
            gatewayVersion: "2026.4.23",
            requiredGateway: "2026.4.23",
            message: "cached")

        let first = await GatewayEnvironment._testCheckCached(maxAge: 60) {
            counter.increment()
            return expected
        }
        let second = await GatewayEnvironment._testCheckCached(maxAge: 60) {
            counter.increment()
            return .checking
        }

        #expect(first == expected)
        #expect(second == expected)
        #expect(counter.snapshot() == 1)
    }

    @Test func `forced gateway environment check bypasses cache`() async {
        await GatewayEnvironment._testResetCache()
        let counter = Counter()
        let first = await GatewayEnvironment._testCheckCached(maxAge: 60) {
            counter.increment()
            return GatewayEnvironmentStatus(
                kind: .ok,
                nodeVersion: "22.16.0",
                gatewayVersion: "2026.4.23",
                requiredGateway: "2026.4.23",
                message: "first")
        }
        let second = await GatewayEnvironment._testCheckCached(force: true, maxAge: 60) {
            counter.increment()
            return GatewayEnvironmentStatus(
                kind: .ok,
                nodeVersion: "22.16.0",
                gatewayVersion: "2026.4.24",
                requiredGateway: "2026.4.24",
                message: "second")
        }

        #expect(first.message == "first")
        #expect(second.message == "second")
        #expect(counter.snapshot() == 2)
    }

    @Test func `concurrent cached gateway environment checks share one in flight computation`() async {
        await GatewayEnvironment._testResetCache()
        let counter = Counter()
        let expected = GatewayEnvironmentStatus(
            kind: .ok,
            nodeVersion: "22.16.0",
            gatewayVersion: "2026.4.23",
            requiredGateway: "2026.4.23",
            message: "shared")

        async let first: GatewayEnvironmentStatus = GatewayEnvironment._testCheckCached(maxAge: 60) {
            counter.increment()
            usleep(120_000)
            return expected
        }
        async let second: GatewayEnvironmentStatus = GatewayEnvironment._testCheckCached(maxAge: 60) {
            counter.increment()
            return .checking
        }

        let firstResult = await first
        let secondResult = await second

        #expect(firstResult == expected)
        #expect(secondResult == expected)
        #expect(counter.snapshot() == 1)
    }

    @Test func `semver compatibility requires same major and not older`() {
        let required = Semver(major: 2, minor: 1, patch: 0)
        #expect(Semver(major: 2, minor: 1, patch: 0).compatible(with: required))
        #expect(Semver(major: 2, minor: 2, patch: 0).compatible(with: required))
        #expect(Semver(major: 2, minor: 1, patch: 1).compatible(with: required))
        #expect(Semver(major: 2, minor: 0, patch: 9).compatible(with: required) == false)
        #expect(Semver(major: 3, minor: 0, patch: 0).compatible(with: required) == false)
        #expect(Semver(major: 1, minor: 9, patch: 9).compatible(with: required) == false)
    }

    @Test func `gateway port defaults and respects override`() async {
        let configPath = TestIsolation.tempConfigPath()
        await TestIsolation.withIsolatedState(
            env: ["ALISIO_CONFIG_PATH": configPath],
            defaults: ["gatewayPort": nil])
        {
            let defaultPort = GatewayEnvironment.gatewayPort()
            #expect(defaultPort == 40705)

            UserDefaults.standard.set(19999, forKey: "gatewayPort")
            defer { UserDefaults.standard.removeObject(forKey: "gatewayPort") }
            #expect(GatewayEnvironment.gatewayPort() == 19999)
        }
    }

    @Test func `expected gateway version from string uses parser`() {
        #expect(GatewayEnvironment.expectedGatewayVersion(from: "v9.1.2") == Semver(major: 9, minor: 1, patch: 2))
        #expect(GatewayEnvironment.expectedGatewayVersion(from: "2026.1.11-4") == Semver(
            major: 2026,
            minor: 1,
            patch: 11))
        #expect(GatewayEnvironment.expectedGatewayVersion(from: nil) == nil)
    }

    @Test func `bundled runtime uses bundled app labels`() throws {
        let bundleRoot = try makeTempDirForTests()
        let projectRoot = bundleRoot
            .appendingPathComponent("Alisio.app", isDirectory: true)
            .appendingPathComponent("Contents/Resources/alisio-package", isDirectory: true)
        try FileManager().createDirectory(at: projectRoot, withIntermediateDirectories: true)
        try #"{"name":"alisio"}"#.write(
            to: projectRoot.appendingPathComponent("package.json"),
            atomically: true,
            encoding: .utf8)
        try FileManager().createDirectory(
            at: projectRoot.appendingPathComponent("dist"),
            withIntermediateDirectories: true)
        try "export {};\n".write(
            to: projectRoot.appendingPathComponent("dist/index.js"),
            atomically: true,
            encoding: .utf8)

        let label = GatewayEnvironment.gatewayLocationLabel(
            gatewayBinary: nil,
            projectRoot: projectRoot,
            projectEntrypoint: projectRoot.appendingPathComponent("dist/index.js").path)
        let missingMessage = GatewayEnvironment.missingGatewayMessage(projectRoot: projectRoot)

        #expect(label == "(bundled app runtime)")
        #expect(missingMessage == "Bundled Alisio runtime missing from app package; rebuild the app.")
    }

    @Test func `configured local cli uses local labels and remediation`() throws {
        let localRoot = try makeTempDirForTests()
        let label = GatewayEnvironment.gatewayLocationLabel(
            gatewayBinary: localRoot.appendingPathComponent("node_modules/.bin/alisio").path,
            projectRoot: localRoot,
            projectEntrypoint: nil)
        let missingMessage = GatewayEnvironment.missingGatewayMessage(projectRoot: localRoot)

        #expect(label == "(local CLI)")
        #expect(missingMessage == "Configured local Alisio runtime missing entrypoint or local CLI.")
    }
}
