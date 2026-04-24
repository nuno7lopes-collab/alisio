import SwiftUI
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct CronJobEditorTests {
    private func makeJob(
        id: String = "job-1",
        description: String? = "Existing description",
        sessionTarget: CronSessionTarget = .main,
        schedule: CronSchedule = .every(everyMs: 3_600_000, anchorMs: nil),
        payload: CronPayload = .systemEvent(text: "Summarize today"),
        delivery: CronDelivery? = nil,
        deleteAfterRun: Bool? = false) -> Alisio.CronJob
    {
        Alisio.CronJob(
            id: id,
            agentId: nil,
            name: "Daily summary",
            description: description,
            enabled: true,
            deleteAfterRun: deleteAfterRun,
            createdAtMs: 1_700_000_000_000,
            updatedAtMs: 1_700_000_100_000,
            schedule: schedule,
            sessionTarget: sessionTarget,
            wakeMode: .now,
            payload: payload,
            delivery: delivery,
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

    @Test func `cron job editor defaults new one shot schedules to delete after success`() {
        let view = CronJobEditor(
            job: nil,
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        #expect(view.deleteAfterRun == true)
    }

    @Test func `cron job editor clears an existing description when saved blank`() throws {
        let view = CronJobEditor(
            job: self.makeJob(),
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        var root: [String: Any] = [:]
        view.applyStringPatch(
            to: &root,
            key: "description",
            value: "   ",
            previousValue: "Existing description",
            emptyReplacement: "")

        #expect(root["description"] as? String == "")
    }

    @Test func `cron job editor keeps webhook follow up on main chat jobs`() throws {
        let view = CronJobEditor(
            job: self.makeJob(
                sessionTarget: .main,
                delivery: CronDelivery(
                    mode: .webhook,
                    channel: nil,
                    to: "https://example.com/hook",
                    bestEffort: true)),
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        let delivery = view.buildDelivery(
            mode: .webhook,
            channel: "last",
            to: "https://example.com/hook",
            bestEffort: true,
            existingDelivery: CronDelivery(
                mode: .webhook,
                channel: nil,
                to: "https://example.com/hook",
                bestEffort: true))
        #expect(delivery["mode"] as? String == "webhook")
        #expect(delivery["to"] as? String == "https://example.com/hook")
        #expect(delivery["bestEffort"] as? Bool == true)
    }

    @Test func `cron job editor hydrates isolated jobs without follow up honestly`() {
        let view = CronJobEditor(
            job: self.makeJob(
                sessionTarget: .isolated,
                payload: .agentTurn(
                    message: "Run the report",
                    thinking: nil,
                    timeoutSeconds: nil,
                    deliver: nil,
                    channel: nil,
                    to: nil,
                    bestEffortDeliver: nil),
                delivery: nil),
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        view.hydrateFromJob()

        #expect(view.deliveryMode == .none)
    }

    @Test func `cron job editor clears optional announce target when removed`() {
        let view = CronJobEditor(
            job: self.makeJob(
                sessionTarget: .isolated,
                payload: .agentTurn(
                    message: "Run the report",
                    thinking: nil,
                    timeoutSeconds: nil,
                    deliver: nil,
                    channel: nil,
                    to: nil,
                    bestEffortDeliver: nil),
                delivery: CronDelivery(
                    mode: .announce,
                    channel: "telegram",
                    to: "@ops",
                    bestEffort: true)),
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        let delivery = view.buildDelivery(
            mode: .announce,
            channel: "last",
            to: "   ",
            bestEffort: false,
            existingDelivery: CronDelivery(
                mode: .announce,
                channel: "telegram",
                to: "@ops",
                bestEffort: true))

        #expect(delivery["mode"] as? String == "announce")
        #expect(delivery["channel"] as? String == "last")
        #expect(delivery["to"] as? String == "")
        #expect(delivery["bestEffort"] as? Bool == false)
    }

    @Test func `cron job editor clears chat follow up when moving back to main chat`() throws {
        let view = CronJobEditor(
            job: self.makeJob(
                sessionTarget: .isolated,
                payload: .agentTurn(
                    message: "Run the report",
                    thinking: nil,
                    timeoutSeconds: nil,
                    deliver: nil,
                    channel: nil,
                    to: nil,
                    bestEffortDeliver: nil),
                delivery: CronDelivery(
                    mode: .announce,
                    channel: "telegram",
                    to: "@ops",
                    bestEffort: false)),
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        let delivery = view.buildDelivery(
            mode: .none,
            channel: "telegram",
            to: "@ops",
            bestEffort: false,
            existingDelivery: CronDelivery(
                mode: .announce,
                channel: "telegram",
                to: "@ops",
                bestEffort: false))

        #expect(delivery["mode"] as? String == "none")
        #expect(delivery["channel"] as? String == "")
        #expect(delivery["to"] as? String == "")
        #expect(delivery["bestEffort"] as? Bool == false)
    }

    @Test func `cron job editor does not keep best effort when follow up is none on a new job`() {
        let view = CronJobEditor(
            job: nil,
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        let delivery = view.buildDelivery(
            mode: .none,
            channel: "last",
            to: "",
            bestEffort: true,
            existingDelivery: nil)

        #expect(delivery["mode"] as? String == "none")
        #expect(delivery["bestEffort"] == nil)
    }

    @Test func `cron job editor preserves every anchor when editing an interval schedule`() throws {
        let anchorMs = 1_700_000_222_000
        let view = CronJobEditor(
            job: self.makeJob(schedule: .every(everyMs: 3_600_000, anchorMs: anchorMs)),
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        view.hydrateFromJob()
        let schedule = try view.buildSchedule()

        #expect(schedule["kind"] as? String == "every")
        #expect(schedule["anchorMs"] as? Int == anchorMs)
    }

    @Test func `cron job editor hydrates one shot jobs with backend delete default`() {
        let view = CronJobEditor(
            job: self.makeJob(
                schedule: .at(at: "2026-04-21T10:15:00Z"),
                deleteAfterRun: nil),
            isSaving: .constant(false),
            error: .constant(nil),
            channelsStore: ChannelsStore(isPreview: true),
            onCancel: {},
            onSave: { _ in })

        view.hydrateFromJob()

        #expect(view.deleteAfterRun == true)
    }
}
