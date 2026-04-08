import OpenClawChatUI
import OpenClawKit
import OpenClawProtocol
import AlisioChatUI
import AlisioKit
import AlisioProtocol
import Testing

@Suite struct AlisioKitBridgeTests {
    @Test func bridgesProtocolTypes() {
        let payload = AlisioProtocol.AnyCodable(["ok": true])
        #expect(String(describing: payload.value).contains("ok"))
    }

    @Test func bridgesKitAliases() {
        #expect(AlisioCanvasA2UICommand.push.rawValue == OpenClawCanvasA2UICommand.push.rawValue)
        let params = AlisioScreenRecordParams()
        #expect(params.includeAudio == OpenClawScreenRecordParams().includeAudio)
    }

    @MainActor
    @Test func bridgesChatAliases() {
        #expect(
            AlisioChatViewModel.defaultModelSelectionID ==
                OpenClawChatViewModel.defaultModelSelectionID,
        )
    }
}
