import AlisioKit
import Foundation
import Testing

@Suite struct CanvasA2UIActionTests {
    @Test func sanitizeTagValueIsStable() {
        #expect(AlisioCanvasA2UIAction.sanitizeTagValue("Hello World!") == "Hello_World_")
        #expect(AlisioCanvasA2UIAction.sanitizeTagValue("  ") == "-")
        #expect(AlisioCanvasA2UIAction.sanitizeTagValue("macOS 26.2") == "macOS_26.2")
    }

    @Test func extractActionNameAcceptsNameOrAction() {
        #expect(AlisioCanvasA2UIAction.extractActionName(["name": "Hello"]) == "Hello")
        #expect(AlisioCanvasA2UIAction.extractActionName(["action": "Wave"]) == "Wave")
        #expect(AlisioCanvasA2UIAction.extractActionName(["name": "  ", "action": "Fallback"]) == "Fallback")
        #expect(AlisioCanvasA2UIAction.extractActionName(["action": " "]) == nil)
    }

    @Test func formatAgentMessageIsTokenEfficientAndUnambiguous() {
        let messageContext = AlisioCanvasA2UIAction.AgentMessageContext(
            actionName: "Get Weather",
            session: .init(key: "main", surfaceId: "main"),
            component: .init(id: "btnWeather", host: "Peter’s MacBook", instanceId: "mac16,6"),
            contextJSON: "{\"city\":\"Vienna\"}")
        let msg = AlisioCanvasA2UIAction.formatAgentMessage(messageContext)

        #expect(msg.contains("CANVAS_A2UI "))
        #expect(msg.contains("action=Get_Weather"))
        #expect(msg.contains("session=main"))
        #expect(msg.contains("surface=main"))
        #expect(msg.contains("component=btnWeather"))
        #expect(msg.contains("host=Peter_s_MacBook"))
        #expect(msg.contains("instance=mac16_6 ctx={\"city\":\"Vienna\"}"))
        #expect(msg.hasSuffix(" default=update_canvas"))
    }

    @Test func jsDispatchA2uiStatusUsesAlisioEventName() {
        let js = AlisioCanvasA2UIAction.jsDispatchA2UIActionStatus(actionId: "a1", ok: true, error: nil)
        #expect(js.contains("alisio:a2ui-action-status"))
        #expect(js.contains(#""id":"a1""#))
    }
}
