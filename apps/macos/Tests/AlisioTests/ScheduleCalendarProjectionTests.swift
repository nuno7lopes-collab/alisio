import Foundation
import Testing
@testable import Alisio

@Suite(.serialized)
struct ScheduleCalendarProjectionTests {
    @Test func `week projection places one-shot interval and cron jobs on the right days and hours`() {
        let calendar = Self.utcCalendar()
        let dailyAnchor = Self.date("2026-04-20T09:00:00Z")
        let jobs = [
            self.makeJob(
                id: "one-shot",
                name: "One shot",
                schedule: .at(at: "2026-04-21T10:15:00Z")),
            self.makeJob(
                id: "daily",
                name: "Daily",
                schedule: .every(everyMs: 86_400_000, anchorMs: Self.ms(dailyAnchor)),
                createdAtMs: Self.ms(dailyAnchor)),
            self.makeJob(
                id: "cron",
                name: "Morning cron",
                schedule: .cron(expr: "30 8 * * *", tz: "UTC", staggerMs: 0)),
        ]

        let projection = ScheduleCalendarProjection.week(
            containing: Self.date("2026-04-22T12:00:00Z"),
            jobs: jobs,
            calendar: calendar)

        #expect(projection.days.count == 7)
        #expect(projection.occurrences.filter { $0.jobId == "daily" }.count == 7)
        #expect(projection.occurrences.filter { $0.jobId == "cron" }.count == 7)

        let oneShot = try! #require(projection.occurrences.first { $0.jobId == "one-shot" })
        #expect(calendar.component(.weekday, from: oneShot.startAt) == 3)
        #expect(calendar.component(.hour, from: oneShot.startAt) == 10)
        #expect(calendar.component(.minute, from: oneShot.startAt) == 15)

        let cron = try! #require(projection.occurrences.first { $0.jobId == "cron" })
        #expect(calendar.component(.hour, from: cron.startAt) == 8)
        #expect(calendar.component(.minute, from: cron.startAt) == 30)
    }

    @Test func `month projection groups renderable jobs by day`() {
        let calendar = Self.utcCalendar()
        let weeklyAnchor = Self.date("2026-04-06T14:00:00Z")
        let jobs = [
            self.makeJob(
                id: "weekly",
                name: "Weekly",
                schedule: .every(everyMs: 7 * 86_400_000, anchorMs: Self.ms(weeklyAnchor)),
                createdAtMs: Self.ms(weeklyAnchor)),
            self.makeJob(
                id: "month-end",
                name: "Month end",
                schedule: .at(at: "2026-04-30T18:00:00Z")),
        ]

        let projection = ScheduleCalendarProjection.month(
            containing: Self.date("2026-04-15T12:00:00Z"),
            jobs: jobs,
            calendar: calendar)

        #expect(projection.days.count == 30)
        #expect(Self.dayNumbers(for: "weekly", in: projection, calendar: calendar) == [6, 13, 20, 27])
        #expect(Self.dayNumbers(for: "month-end", in: projection, calendar: calendar) == [30])
    }

    @Test func `disabled jobs render distinctly without losing their schedule`() {
        let calendar = Self.utcCalendar()
        let anchor = Self.date("2026-04-20T11:00:00Z")
        let job = self.makeJob(
            id: "paused",
            name: "Paused",
            enabled: false,
            schedule: .every(everyMs: 86_400_000, anchorMs: Self.ms(anchor)),
            createdAtMs: Self.ms(anchor))

        let projection = ScheduleCalendarProjection.week(
            containing: Self.date("2026-04-22T12:00:00Z"),
            jobs: [job],
            calendar: calendar)

        let occurrences = projection.occurrences.filter { $0.jobId == "paused" }
        #expect(occurrences.count == 7)
        #expect(occurrences.allSatisfy { !$0.isEnabled })
    }

    @Test func `unsupported schedules are reported without fake occurrences`() {
        let calendar = Self.utcCalendar()
        let unsupported = self.makeJob(
            id: "unsupported",
            name: "Ambiguous cron",
            schedule: .cron(expr: "0 9 1 * 1", tz: "UTC", staggerMs: 0),
            state: CronJobState(nextRunAtMs: Self.ms(Self.date("2026-04-27T09:00:00Z"))))

        let projection = ScheduleCalendarProjection.month(
            containing: Self.date("2026-04-15T12:00:00Z"),
            jobs: [unsupported],
            calendar: calendar)

        #expect(projection.occurrences.isEmpty)
        let issue = try! #require(projection.unsupportedSchedules.first)
        #expect(issue.jobId == "unsupported")
        #expect(issue.reason.contains("day of month"))
        #expect(issue.nextRunAt == Self.date("2026-04-27T09:00:00Z"))
    }

    @MainActor
    @Test func `opening a calendar occurrence selects the same job detail used by the list`() {
        let store = CronJobsStore(isPreview: true)
        let job = self.makeJob(id: "job-1", name: "Daily", schedule: .every(everyMs: 86_400_000, anchorMs: nil))
        store.jobs = [job]
        let view = CronSettings(store: store, channelsStore: ChannelsStore(isPreview: true))
        let occurrence = ScheduleCalendarProjection.Occurrence(
            id: "job-1:1",
            jobId: "job-1",
            jobName: "Daily",
            startAt: Self.date("2026-04-21T09:00:00Z"),
            isEnabled: true,
            scheduleKind: "every")

        view.openCalendarOccurrence(occurrence)

        #expect(store.selectedJobId == "job-1")
    }

    private func makeJob(
        id: String,
        name: String,
        enabled: Bool = true,
        schedule: CronSchedule,
        createdAtMs: Int = 0,
        state: CronJobState = CronJobState()) -> CronJob
    {
        CronJob(
            id: id,
            agentId: nil,
            name: name,
            description: nil,
            enabled: enabled,
            deleteAfterRun: nil,
            createdAtMs: createdAtMs,
            updatedAtMs: createdAtMs,
            schedule: schedule,
            sessionTarget: .main,
            wakeMode: .now,
            payload: .systemEvent(text: "Run"),
            delivery: nil,
            state: state)
    }

    private static func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        calendar.firstWeekday = 2
        return calendar
    }

    private static func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    private static func ms(_ date: Date) -> Int {
        Int((date.timeIntervalSince1970 * 1_000).rounded(.down))
    }

    private static func dayNumbers(
        for jobId: String,
        in projection: ScheduleCalendarProjection,
        calendar: Calendar) -> [Int]
    {
        projection.occurrences
            .filter { $0.jobId == jobId }
            .map { calendar.component(.day, from: $0.startAt) }
    }
}
