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
        store.jobsStatusMessage = "No schedules exist yet."
        let view = CronSettings(store: store, channelsStore: ChannelsStore(isPreview: true))
        #expect(view.listState == .empty("No schedules exist yet."))

        store.jobsError = "Gateway offline"
        #expect(view.listState == .error("Gateway offline"))
    }

    @Test func `cron settings keeps selection stable and clears stale state`() {
        let store = CronJobsStore(isPreview: true)
        let job1 = self.makeJob(id: "job-1")
        let job2 = self.makeJob(id: "job-2", name: "Weekly review")

        store.jobs = [job1, job2]
        store.reconcileSelection()
        #expect(store.selectedJobId == "job-1")

        store.selectJob("missing")
        store.reconcileSelection()
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
        store.loadedRunsJobId = "job-1"
        store.hasLoadedRunsOnce = true
        store.jobs = []
        store.reconcileSelection()

        #expect(store.selectedJobId == nil)
        #expect(store.runEntries.isEmpty)
        #expect(store.hasLoadedRunsOnce == false)
    }

    @Test func `cron settings only exposes activity for the loaded schedule`() {
        let store = CronJobsStore(isPreview: true)
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
            CronRunLogEntry(
                ts: 2,
                jobId: "job-2",
                action: "finished",
                status: "error",
                error: "failed",
                summary: nil,
                deliveryStatus: nil,
                deliveryError: nil,
                sessionId: nil,
                sessionKey: nil,
                runAtMs: nil,
                durationMs: nil,
                nextRunAtMs: nil),
        ]
        store.loadedRunsJobId = "job-1"
        store.hasLoadedRunsOnce = true

        #expect(store.runEntries(for: "job-1").map(\.jobId) == ["job-1"])
        #expect(store.runEntries(for: "job-2").isEmpty)
        #expect(store.hasLoadedRuns(for: "job-1") == true)
        #expect(store.hasLoadedRuns(for: "job-2") == false)
    }

    @Test func `cron settings scopes schedule action errors to the affected schedule`() {
        let store = CronJobsStore(isPreview: true)
        store.actionError = "Could not pause schedule."
        store.actionErrorJobId = "job-2"

        #expect(store.actionError(for: "job-1") == nil)
        #expect(store.actionError(for: "job-2") == "Could not pause schedule.")
    }
}
