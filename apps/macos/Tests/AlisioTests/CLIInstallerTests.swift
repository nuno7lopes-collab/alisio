import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct CLIInstallerTests {
    @Test func `installed location finds executable`() throws {
        let fm = FileManager()
        let root = fm.temporaryDirectory.appendingPathComponent(
            "alisio-cli-installer-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }

        let binDir = root.appendingPathComponent("bin")
        try fm.createDirectory(at: binDir, withIntermediateDirectories: true)
        let cli = binDir.appendingPathComponent("alisio")
        fm.createFile(atPath: cli.path, contents: Data())
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: cli.path)

        let found = CLIInstaller.installedLocation(
            searchPaths: [binDir.path],
            fileManager: fm)
        #expect(found == cli.path)

        try fm.removeItem(at: cli)
        fm.createFile(atPath: cli.path, contents: Data())
        try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: cli.path)

        let missing = CLIInstaller.installedLocation(
            searchPaths: [binDir.path],
            fileManager: fm)
        #expect(missing == nil)
    }

    @Test func `install script uses alisio host`() {
        let command = CLIInstaller._testInstallScriptCommand(version: "2026.3.30", prefix: "/tmp/alisio")
        let rendered = command.joined(separator: " ")
        #expect(rendered.contains(AlisioBrand.installCLIURL))
        #expect(!rendered.contains("clawd"))
    }

    @Test func `installed location ignores legacy clawd executable`() throws {
        let fm = FileManager()
        let root = fm.temporaryDirectory.appendingPathComponent(
            "alisio-cli-installer-legacy-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }

        let binDir = root.appendingPathComponent("bin")
        try fm.createDirectory(at: binDir, withIntermediateDirectories: true)
        let legacy = binDir.appendingPathComponent("clawd")
        fm.createFile(atPath: legacy.path, contents: Data())
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: legacy.path)

        let found = CLIInstaller.installedLocation(
            searchPaths: [binDir.path],
            fileManager: fm)
        #expect(found == nil)
    }
}
