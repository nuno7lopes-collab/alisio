import SwiftUI
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct CronJobEditorTests {
    @Test func `cron job editor includes delete after run for at schedule`() {
        let view = CronJobEditor(
            job: nil,
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        var root: [String: Any] = [:]
        view.applyDeleteAfterRun(to: &root, scheduleKind: CronJobEditor.ScheduleKind.at, deleteAfterRun: true)
        let raw = root["deleteAfterRun"] as? Bool
        #expect(raw == true)
    }
}
