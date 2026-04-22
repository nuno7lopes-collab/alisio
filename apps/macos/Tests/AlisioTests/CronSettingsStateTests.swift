import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct CronSettingsStateTests {
    private func makeJob(
        id: String = "job-1",
        name: String = "Daily summary",
        enabled: Bool = true) -> Alisio.CronJob
    {
        Alisio.CronJob(
            id: id,
            agentId: nil,
            name: name,
            description: nil,
            enabled: enabled,
            deleteAfterRun: nil,
            createdAtMs: 0,
            updatedAtMs: 0,
            schedule: .every(everyMs: 3_600_000, anchorMs: nil),
            sessionTarget: .main,
            wakeMode: .now,
            payload: .systemEvent(text: "Summary"),
            delivery: nil,
            state: CronJobState())
    }

    @Test func `cron settings starts in loading state before the first refresh`() {
        let store = CronJobsStore(isPreview: true)
        let view = CronSettings(store: store, channelsStore: ChannelsStore(isPreview: true))

        #expect(view.listState == .loading)
    }

    @Test func `cron settings exposes empty and error states honestly`() {
        let store = CronJobsStore(isPreview: true)
        store.hasLoadedJobsOnce = true
        store.statusMessage = "No schedules exist yet."
        let view = CronSettings(store: store, channelsStore: ChannelsStore(isPreview: true))
        #expect(view.listState == .empty("No schedules exist yet."))

        store.lastError = "Gateway offline"
        #expect(view.listState == .error("Gateway offline"))
    }

    @Test func `cron settings keeps selection stable and clears stale state`() {
        let store = CronJobsStore(isPreview: true)
        let job1 = self.makeJob(id: "job-1")
        let job2 = self.makeJob(id: "job-2", name: "Weekly review")
        var view = CronSettings(store: store, channelsStore: ChannelsStore(isPreview: true))

        store.jobs = [job1, job2]
        view.ensureSelection()
        #expect(store.selectedJobId == "job-1")

        store.selectedJobId = "missing"
        view.ensureSelection()
        #expect(store.selectedJobId == "job-1")

        store.runEntries = [
            CronRunLogEntry(
                ts: 1,
                jobId: "job-1",
                action: "finished",
                status: "ok",
                error: nil,
                summary: nil,
                deliveryStatus: nil,
                deliveryError: nil,
                sessionId: nil,
                sessionKey: nil,
                runAtMs: nil,
                durationMs: nil,
                nextRunAtMs: nil),
        ]
        store.hasLoadedRunsOnce = true
        store.jobs = []
        view.ensureSelection()

        #expect(store.selectedJobId == nil)
        #expect(store.runEntries.isEmpty)
        #expect(store.hasLoadedRunsOnce == false)
    }
}
