import Testing
@testable import AlisioChatUI

@Suite("ToolResultTextFormatter")
struct ToolResultTextFormatterTests {
    @Test func leavesPlainTextUntouched() {
        let result = ToolResultTextFormatter.format(text: "All good", toolName: "nodes")
        #expect(result == "All good")
    }

    @Test func summarizesNodesListJSON() {
        let json = """
        {
          "ts": 1771610031380,
          "nodes": [
            {
              "displayName": "MacBook Pro",
              "connected": true,
              "platform": "macos"
            }
          ]
        }
        """

        let result = ToolResultTextFormatter.format(text: json, toolName: "nodes")
        #expect(result.contains("1 node found."))
        #expect(result.contains("MacBook Pro"))
        #expect(result.contains("connected"))
    }

    @Test func summarizesErrorJSONAndDropsAgentPrefix() {
        let json = """
        {
          "status": "error",
          "tool": "nodes",
          "error": "agent=main node=MacBook gateway=default action=invoke: pairing required"
        }
        """

        let result = ToolResultTextFormatter.format(text: json, toolName: "nodes")
        #expect(result == "Error: pairing required")
    }

    @Test func suppressesUnknownStructuredPayload() {
        let json = """
        {
          "foo": "bar"
        }
        """

        let result = ToolResultTextFormatter.format(text: json, toolName: "nodes")
        #expect(result.isEmpty)
    }
}
