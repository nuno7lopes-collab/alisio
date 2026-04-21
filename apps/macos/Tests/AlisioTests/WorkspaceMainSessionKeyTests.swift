import Foundation
import Testing
import AlisioSupport
@testable import Alisio

struct WorkspaceMainSessionKeyTests {
    @Test func `config get snapshot falls back to main when session config is missing`() throws {
        let json = """
        {
          "path": "/Users/pete/.alisio/alisio.json",
          "exists": true,
          "raw": null,
          "parsed": {},
          "valid": true,
          "config": {},
          "issues": []
        }
        """
        let key = try GatewayConnection.mainSessionKey(fromConfigGetData: Data(json.utf8))
        #expect(key == "main")
    }

    @Test func `config get snapshot falls back to main when config is null`() throws {
        let json = """
        {
          "config": null
        }
        """
        let key = try GatewayConnection.mainSessionKey(fromConfigGetData: Data(json.utf8))
        #expect(key == "main")
    }

    @Test func `config get snapshot uses global scope`() throws {
        let json = """
        {
          "config": { "session": { "scope": "global" } }
        }
        """
        let key = try GatewayConnection.mainSessionKey(fromConfigGetData: Data(json.utf8))
        #expect(key == "global")
    }
}
