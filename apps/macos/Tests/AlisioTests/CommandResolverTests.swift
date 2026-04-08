import Darwin
import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized) struct CommandResolverTests {
    private func makeDefaults() -> UserDefaults {
        // Use a unique suite to avoid cross-suite concurrency on UserDefaults.standard.
        UserDefaults(suiteName: "CommandResolverTests.\(UUID().uuidString)")!
    }

    private func makeLocalDefaults() -> UserDefaults {
        let defaults = self.makeDefaults()
        defaults.set(AppState.ConnectionMode.local.rawValue, forKey: connectionModeKey)
        return defaults
    }

    private func makeProjectRootWithPnpm() throws -> (tmp: URL, pnpmPath: URL) {
        let tmp = try makeTempDirForTests()
        CommandResolver.setProjectRoot(tmp.path)
        let pnpmPath = tmp.appendingPathComponent("node_modules/.bin/pnpm")
        try makeExecutableForTests(at: pnpmPath)
        return (tmp, pnpmPath)
    }

    @Test func `prefers open claw binary`() throws {
        let defaults = self.makeLocalDefaults()

        let tmp = try makeTempDirForTests()
        CommandResolver.setProjectRoot(tmp.path)

        let alisioPath = tmp.appendingPathComponent("node_modules/.bin/alisio")
        try makeExecutableForTests(at: alisioPath)

        let cmd = CommandResolver.alisioCommand(subcommand: "gateway", defaults: defaults, configRoot: [:])
        #expect(cmd.prefix(2).elementsEqual([alisioPath.path, "gateway"]))
    }

    @Test func `falls back to node and script`() throws {
        let defaults = self.makeLocalDefaults()

        let tmp = try makeTempDirForTests()
        CommandResolver.setProjectRoot(tmp.path)

        let nodePath = tmp.appendingPathComponent("node_modules/.bin/node")
        let scriptPath = tmp.appendingPathComponent("bin/alisio.js")
        try makeExecutableForTests(at: nodePath)
        try "#!/bin/sh\necho v22.16.0\n".write(to: nodePath, atomically: true, encoding: .utf8)
        try FileManager().setAttributes([.posixPermissions: 0o755], ofItemAtPath: nodePath.path)
        try makeExecutableForTests(at: scriptPath)

        let cmd = CommandResolver.alisioCommand(
            subcommand: "rpc",
            defaults: defaults,
            configRoot: [:],
            searchPaths: [tmp.appendingPathComponent("node_modules/.bin").path])

        #expect(cmd.count >= 3)
        if cmd.count >= 3 {
            #expect(cmd[0] == nodePath.path)
            #expect(cmd[1] == scriptPath.path)
            #expect(cmd[2] == "rpc")
        }
    }

    @Test func `prefers open claw binary over pnpm`() throws {
        let defaults = self.makeLocalDefaults()

        let tmp = try makeTempDirForTests()
        CommandResolver.setProjectRoot(tmp.path)

        let binDir = tmp.appendingPathComponent("bin")
        let alisioPath = binDir.appendingPathComponent("alisio")
        let pnpmPath = binDir.appendingPathComponent("pnpm")
        try makeExecutableForTests(at: alisioPath)
        try makeExecutableForTests(at: pnpmPath)

        let cmd = CommandResolver.alisioCommand(
            subcommand: "rpc",
            defaults: defaults,
            configRoot: [:],
            searchPaths: [binDir.path])

        #expect(cmd.prefix(2).elementsEqual([alisioPath.path, "rpc"]))
    }

    @Test func `uses open claw binary without node runtime`() throws {
        let defaults = self.makeLocalDefaults()

        let tmp = try makeTempDirForTests()
        CommandResolver.setProjectRoot(tmp.path)

        let binDir = tmp.appendingPathComponent("bin")
        let alisioPath = binDir.appendingPathComponent("alisio")
        try makeExecutableForTests(at: alisioPath)

        let cmd = CommandResolver.alisioCommand(
            subcommand: "gateway",
            defaults: defaults,
            configRoot: [:],
            searchPaths: [binDir.path])

        #expect(cmd.prefix(2).elementsEqual([alisioPath.path, "gateway"]))
    }

    @Test func `falls back to pnpm`() throws {
        let defaults = self.makeLocalDefaults()
        let (tmp, pnpmPath) = try self.makeProjectRootWithPnpm()

        let cmd = CommandResolver.alisioCommand(
            subcommand: "rpc",
            defaults: defaults,
            configRoot: [:],
            searchPaths: [tmp.appendingPathComponent("node_modules/.bin").path])

        #expect(cmd.prefix(4).elementsEqual([pnpmPath.path, "--silent", "alisio", "rpc"]))
    }

    @Test func `pnpm keeps extra args after subcommand`() throws {
        let defaults = self.makeLocalDefaults()
        let (tmp, pnpmPath) = try self.makeProjectRootWithPnpm()

        let cmd = CommandResolver.alisioCommand(
            subcommand: "health",
            extraArgs: ["--json", "--timeout", "5"],
            defaults: defaults,
            configRoot: [:],
            searchPaths: [tmp.appendingPathComponent("node_modules/.bin").path])

        #expect(cmd.prefix(5).elementsEqual([pnpmPath.path, "--silent", "alisio", "health", "--json"]))
        #expect(cmd.suffix(2).elementsEqual(["--timeout", "5"]))
    }

    @Test func `preferred paths start with project node bins`() throws {
        let tmp = try makeTempDirForTests()
        CommandResolver.setProjectRoot(tmp.path)

        let first = CommandResolver.preferredPaths().first
        #expect(first == tmp.appendingPathComponent("node_modules/.bin").path)
    }

    @Test func `prefers bundled repo root over stale stored project root`() throws {
        let defaults = self.makeDefaults()
        let stale = try makeTempDirForTests()
        defaults.set(stale.path, forKey: "alisio.gatewayProjectRootPath")

        let bundledRoot = try makeTempDirForTests()
        try "{}".write(to: bundledRoot.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)
        try FileManager().createDirectory(
            at: bundledRoot.appendingPathComponent("src"),
            withIntermediateDirectories: true)
        try FileManager().createDirectory(
            at: bundledRoot.appendingPathComponent("ui"),
            withIntermediateDirectories: true)
        try FileManager().createDirectory(
            at: bundledRoot.appendingPathComponent("apps/macos"),
            withIntermediateDirectories: true)
        let bundleURL = bundledRoot.appendingPathComponent("dist/Alisio.app", isDirectory: true)
        try FileManager().createDirectory(at: bundleURL, withIntermediateDirectories: true)

        let resolved = CommandResolver.projectRoot(
            defaults: defaults,
            bundleURL: bundleURL,
            fileManager: FileManager(),
            homeDirectory: FileManager().homeDirectoryForCurrentUser)

        #expect(resolved.path == bundledRoot.path)
    }

    @Test func `prefers packaged runtime root over stored project root`() throws {
        let defaults = self.makeDefaults()
        let stale = try makeTempDirForTests()
        defaults.set(stale.path, forKey: "alisio.gatewayProjectRootPath")

        let packagedBundleRoot = try makeTempDirForTests()
        let bundleURL = packagedBundleRoot.appendingPathComponent("Alisio.app", isDirectory: true)
        let packagedRoot = bundleURL
            .appendingPathComponent("Contents/Resources/alisio-package", isDirectory: true)
        try FileManager().createDirectory(at: packagedRoot, withIntermediateDirectories: true)
        try #"{"name":"alisio"}"#.write(
            to: packagedRoot.appendingPathComponent("package.json"),
            atomically: true,
            encoding: .utf8)
        try FileManager().createDirectory(
            at: packagedRoot.appendingPathComponent("dist"),
            withIntermediateDirectories: true)
        try "export {};\n".write(
            to: packagedRoot.appendingPathComponent("dist/index.js"),
            atomically: true,
            encoding: .utf8)

        let resolved = CommandResolver.projectRoot(
            defaults: defaults,
            bundleURL: bundleURL,
            fileManager: FileManager(),
            homeDirectory: FileManager().homeDirectoryForCurrentUser)

        #expect(resolved.path == packagedRoot.path)
    }

    @Test func `preferred paths include bundled node bin when packaged runtime provides it`() throws {
        let packagedBundleRoot = try makeTempDirForTests()
        let bundleURL = packagedBundleRoot.appendingPathComponent("Alisio.app", isDirectory: true)
        let packagedRoot = bundleURL
            .appendingPathComponent("Contents/Resources/alisio-package", isDirectory: true)
        try FileManager().createDirectory(at: packagedRoot, withIntermediateDirectories: true)
        try #"{"name":"alisio"}"#.write(
            to: packagedRoot.appendingPathComponent("package.json"),
            atomically: true,
            encoding: .utf8)
        try FileManager().createDirectory(
            at: packagedRoot.appendingPathComponent("dist"),
            withIntermediateDirectories: true)
        try "export {};\n".write(
            to: packagedRoot.appendingPathComponent("dist/index.js"),
            atomically: true,
            encoding: .utf8)
        let bundledNode = packagedRoot.appendingPathComponent("tools/node/bin/node")
        try makeExecutableForTests(at: bundledNode)

        let paths = CommandResolver.preferredPaths(
            home: FileManager().homeDirectoryForCurrentUser,
            current: ["/usr/bin"],
            projectRoot: packagedRoot,
            bundleURL: bundleURL,
            fileManager: FileManager())

        #expect(paths.contains(packagedRoot.appendingPathComponent("tools/node/bin").path))
    }

    @Test func `builds SSH command for remote mode`() {
        let defaults = self.makeDefaults()
        defaults.set(AppState.ConnectionMode.remote.rawValue, forKey: connectionModeKey)
        defaults.set("alisio@example.com:2222", forKey: remoteTargetKey)
        defaults.set("/tmp/id_ed25519", forKey: remoteIdentityKey)
        defaults.set("/srv/alisio", forKey: remoteProjectRootKey)

        let cmd = CommandResolver.alisioCommand(
            subcommand: "status",
            extraArgs: ["--json"],
            defaults: defaults,
            configRoot: [:])

        #expect(cmd.first == "/usr/bin/ssh")
        if let marker = cmd.firstIndex(of: "--") {
            #expect(cmd[marker + 1] == "alisio@example.com")
        } else {
            #expect(Bool(false))
        }
        #expect(cmd.contains("-i"))
        #expect(cmd.contains("/tmp/id_ed25519"))
        if let script = cmd.last {
            #expect(script.contains("PRJ='/srv/alisio'"))
            #expect(script.contains("cd \"$PRJ\""))
            #expect(script.contains("alisio"))
            #expect(script.contains("status"))
            #expect(script.contains("--json"))
            #expect(script.contains("CLI="))
        }
    }

    @Test func `rejects unsafe SSH targets`() {
        #expect(CommandResolver.parseSSHTarget("-oProxyCommand=calc") == nil)
        #expect(CommandResolver.parseSSHTarget("host:-oProxyCommand=calc") == nil)
        #expect(CommandResolver.parseSSHTarget("user@host:2222")?.port == 2222)
    }

    @Test func `config root local overrides remote defaults`() throws {
        let defaults = self.makeDefaults()
        defaults.set(AppState.ConnectionMode.remote.rawValue, forKey: connectionModeKey)
        defaults.set("alisio@example.com:2222", forKey: remoteTargetKey)

        let tmp = try makeTempDirForTests()
        CommandResolver.setProjectRoot(tmp.path)

        let alisioPath = tmp.appendingPathComponent("node_modules/.bin/alisio")
        try makeExecutableForTests(at: alisioPath)

        let cmd = CommandResolver.alisioCommand(
            subcommand: "daemon",
            defaults: defaults,
            configRoot: ["gateway": ["mode": "local"]])

        #expect(cmd.first == alisioPath.path)
        #expect(cmd.count >= 2)
        if cmd.count >= 2 {
            #expect(cmd[1] == "daemon")
        }
    }
}
