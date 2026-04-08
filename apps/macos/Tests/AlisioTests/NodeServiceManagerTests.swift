import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized) struct NodeServiceManagerTests {
    @Test func `builds node service commands with current CLI shape`() async throws {
        try await TestIsolation.withUserDefaultsValues(["alisio.gatewayProjectRootPath": nil]) {
            let tmp = try makeTempDirForTests()
            CommandResolver.setProjectRoot(tmp.path)

            let alisioPath = tmp.appendingPathComponent("node_modules/.bin/alisio")
            try makeExecutableForTests(at: alisioPath)

            let start = NodeServiceManager._testServiceCommand(["start"])
            #expect(start == [alisioPath.path, "node", "start", "--json"])

            let stop = NodeServiceManager._testServiceCommand(["stop"])
            #expect(stop == [alisioPath.path, "node", "stop", "--json"])
        }
    }
}
