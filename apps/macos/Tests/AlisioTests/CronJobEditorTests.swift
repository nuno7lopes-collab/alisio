import SwiftUI
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct CronJobEditorTests {
    private func makeJob(
        id: String = "job-1",
        description: String? = "Existing description") -> Alisio.CronJob
    {
        Alisio.CronJob(
            id: id,
            agentId: nil,
            name: "Daily summary",
            description: description,
            enabled: true,
            deleteAfterRun: false,
            createdAtMs: 1_700_000_000_000,
            updatedAtMs: 1_700_000_100_000,
            schedule: .every(everyMs: 3_600_000, anchorMs: nil),
            sessionTarget: .main,
            wakeMode: .now,
            payload: .systemEvent(text: "Summarize today"),
            delivery: nil,
            state: CronJobState())
    }

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

    @Test func `cron job editor clears an existing description when saved blank`() throws {
        var view = CronJobEditor(
            job: self.makeJob(),
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        view.hydrateFromJob()
        view.description = "   "

        let request = try view.buildRequest()
        #expect(request["description"]?.value as? String == "")
    }
}
