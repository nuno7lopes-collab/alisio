import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized) struct NodeServiceManagerTests {
    @Test func `builds node service commands with current CLI shape`() async throws {
        let tmp = try makeTempDirForTests()
        let binDir = tmp.appendingPathComponent("node_modules/.bin")
        let alisioPath = binDir.appendingPathComponent("alisio")
        try makeExecutableForTests(at: alisioPath)

        let currentPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
        await TestIsolation.withIsolatedState(
            env: ["PATH": [binDir.path, currentPath].joined(separator: ":")],
            defaults: ["alisio.gatewayProjectRootPath": nil])
        {
            CommandResolver.setProjectRoot(tmp.path)

            let start = NodeServiceManager._testServiceCommand(["start"])
            #expect(start == [alisioPath.path, "node", "start", "--json"])

            let stop = NodeServiceManager._testServiceCommand(["stop"])
            #expect(stop == [alisioPath.path, "node", "stop", "--json"])
        }
    }
}
