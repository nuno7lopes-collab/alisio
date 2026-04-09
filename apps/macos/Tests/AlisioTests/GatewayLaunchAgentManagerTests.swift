import Foundation
import Testing
import AlisioSupport
@testable import Alisio

struct GatewayLaunchAgentManagerTests {
    @Test func `launch agent plist snapshot parses args and env`() throws {
        let url = FileManager().temporaryDirectory
            .appendingPathComponent("alisio-launchd-\(UUID().uuidString).plist")
        let plist: [String: Any] = [
            "ProgramArguments": ["alisio", "gateway", "--port", "40705", "--bind", "loopback"],
            "EnvironmentVariables": [
                "ALISIO_GATEWAY_TOKEN": " secret ",
                "ALISIO_GATEWAY_PASSWORD": "pw",
            ],
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: url, options: [.atomic])
        defer { try? FileManager().removeItem(at: url) }

        let snapshot = try #require(LaunchAgentPlist.snapshot(url: url))
        #expect(snapshot.port == 40705)
        #expect(snapshot.bind == "loopback")
        #expect(snapshot.token == "secret")
        #expect(snapshot.password == "pw")
    }

    @Test func `launch agent plist snapshot allows missing bind`() throws {
        let url = FileManager().temporaryDirectory
            .appendingPathComponent("alisio-launchd-\(UUID().uuidString).plist")
        let plist: [String: Any] = [
            "ProgramArguments": ["alisio", "gateway", "--port", "40705"],
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: url, options: [.atomic])
        defer { try? FileManager().removeItem(at: url) }

        let snapshot = try #require(LaunchAgentPlist.snapshot(url: url))
        #expect(snapshot.port == 40705)
        #expect(snapshot.bind == nil)
    }

    @Test func `launch agent plist snapshot resolves current plist from ordered candidates`() throws {
        let root = FileManager().temporaryDirectory
            .appendingPathComponent("alisio-launchd-\(UUID().uuidString)", isDirectory: true)
        try FileManager().createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager().removeItem(at: root) }

        let missing = root.appendingPathComponent("missing.plist")
        let current = root.appendingPathComponent("ai.alisio.gateway.plist")
        let currentPlist: [String: Any] = [
            "ProgramArguments": ["alisio", "gateway", "--port", "40706"],
            "EnvironmentVariables": ["ALISIO_GATEWAY_TOKEN": "current-token"],
        ]
        let currentData = try PropertyListSerialization.data(
            fromPropertyList: currentPlist,
            format: .xml,
            options: 0)
        try currentData.write(to: current, options: [.atomic])

        let snapshot = try #require(LaunchAgentPlist.snapshot(urls: [missing, current]))
        #expect(snapshot.port == 40706)
        #expect(snapshot.token == "current-token")
    }
}
