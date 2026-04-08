import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized) struct VoiceWakeGlobalSettingsSyncTests {
    private func voiceWakeChangedEvent(payload: AlisioProtocol.AnyCodable) -> EventFrame {
        EventFrame(
            type: "event",
            event: "voicewake.changed",
            payload: payload,
            seq: nil,
            stateversion: nil)
    }

    private func applyTriggersAndCapturePrevious(_ triggers: [String]) async -> [String] {
        let previous = await MainActor.run { AppStateStore.shared.swabbleTriggerWords }
        await MainActor.run {
            AppStateStore.shared.applyGlobalVoiceWakeTriggers(triggers)
        }
        return previous
    }

    @Test func `applies voice wake changed event to app state`() async {
        let previous = await applyTriggersAndCapturePrevious(["before"])
        let evt = self.voiceWakeChangedEvent(payload: AlisioProtocol.AnyCodable(["triggers": [
            "alisio",
            "computer",
        ]]))

        await VoiceWakeGlobalSettingsSync.shared.handle(push: .event(evt))

        let updated = await MainActor.run { AppStateStore.shared.swabbleTriggerWords }
        #expect(updated == ["alisio", "computer"])

        await MainActor.run {
            AppStateStore.shared.applyGlobalVoiceWakeTriggers(previous)
        }
    }

    @Test func `ignores voice wake changed event with invalid payload`() async {
        let previous = await applyTriggersAndCapturePrevious(["before"])
        let evt = self.voiceWakeChangedEvent(payload: AlisioProtocol.AnyCodable(["unexpected": 123]))

        await VoiceWakeGlobalSettingsSync.shared.handle(push: .event(evt))

        let updated = await MainActor.run { AppStateStore.shared.swabbleTriggerWords }
        #expect(updated == ["before"])

        await MainActor.run {
            AppStateStore.shared.applyGlobalVoiceWakeTriggers(previous)
        }
    }
}
