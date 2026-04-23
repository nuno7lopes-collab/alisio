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

    @Test func `top of hour cron projection keeps scheduler stagger semantics`() {
        let calendar = Self.utcCalendar()
        let jobs = [
            self.makeJob(
                id: "staggered",
                name: "Default stagger",
                schedule: .cron(expr: "0 * * * *", tz: "UTC", staggerMs: nil)),
            self.makeJob(
                id: "exact",
                name: "Exact hour",
                schedule: .cron(expr: "0 * * * *", tz: "UTC", staggerMs: 0)),
        ]

        let projection = ScheduleCalendarProjection.week(
            containing: Self.date("2026-04-22T12:00:00Z"),
            jobs: jobs,
            calendar: calendar)

        let staggeredOffsets = projection.occurrences
            .filter { $0.jobId == "staggered" }
            .map { Self.hourOffsetMs($0.startAt) }
        #expect(staggeredOffsets.count == 168)
        let staggeredOffset = try! #require(staggeredOffsets.first)
        #expect(staggeredOffsets.allSatisfy { $0 == staggeredOffset })
        #expect(staggeredOffset == 102_620)

        let exactOffsets = projection.occurrences
            .filter { $0.jobId == "exact" }
            .map { Self.hourOffsetMs($0.startAt) }
        #expect(exactOffsets.count == 168)
        #expect(exactOffsets.allSatisfy { $0 == 0 })
    }

    @Test func `cron projection respects OR semantics for day of month and day of week`() {
        let calendar = Self.utcCalendar()
        let job = self.makeJob(
            id: "or-cron",
            name: "First or Monday",
            schedule: .cron(expr: "0 9 1 * 1", tz: "UTC", staggerMs: 0),
            state: CronJobState(nextRunAtMs: Self.ms(Self.date("2026-04-27T09:00:00Z"))))

        let projection = ScheduleCalendarProjection.month(
            containing: Self.date("2026-04-15T12:00:00Z"),
            jobs: [job],
            calendar: calendar)

        #expect(projection.unsupportedSchedules.isEmpty)
        #expect(Self.dayNumbers(for: "or-cron", in: projection, calendar: calendar) == [1, 6, 13, 20, 27])
    }

    @Test func `cron projection supports aliases special modifiers and year field`() {
        let calendar = Self.utcCalendar()
        let januaryMondays = self.makeJob(
            id: "aliases",
            name: "January Mondays",
            schedule: .cron(expr: "0 9 * JAN MON", tz: "UTC", staggerMs: 0))
        let nearestWeekday = self.makeJob(
            id: "nearest-weekday",
            name: "Nearest weekday",
            schedule: .cron(expr: "0 9 15W * *", tz: "UTC", staggerMs: 0))
        let lastDay = self.makeJob(
            id: "last-day",
            name: "Last day",
            schedule: .cron(expr: "0 9 L * *", tz: "UTC", staggerMs: 0))
        let nthWeekday = self.makeJob(
            id: "nth-weekday",
            name: "Second Monday",
            schedule: .cron(expr: "0 9 * * MON#2", tz: "UTC", staggerMs: 0))
        let yearBound = self.makeJob(
            id: "year-bound",
            name: "Year bound",
            schedule: .cron(expr: "0 0 12 * * * 2026", tz: "UTC", staggerMs: 0))

        let januaryProjection = ScheduleCalendarProjection.month(
            containing: Self.date("2027-01-15T12:00:00Z"),
            jobs: [januaryMondays],
            calendar: calendar)
        #expect(Self.dayNumbers(for: "aliases", in: januaryProjection, calendar: calendar) == [4, 11, 18, 25])

        let augustProjection = ScheduleCalendarProjection.month(
            containing: Self.date("2026-08-15T12:00:00Z"),
            jobs: [nearestWeekday],
            calendar: calendar)
        #expect(Self.dayNumbers(for: "nearest-weekday", in: augustProjection, calendar: calendar) == [14])

        let aprilLastDayProjection = ScheduleCalendarProjection.month(
            containing: Self.date("2026-04-15T12:00:00Z"),
            jobs: [lastDay],
            calendar: calendar)
        #expect(Self.dayNumbers(for: "last-day", in: aprilLastDayProjection, calendar: calendar) == [30])

        let aprilProjection = ScheduleCalendarProjection.month(
            containing: Self.date("2026-04-15T12:00:00Z"),
            jobs: [nthWeekday],
            calendar: calendar)
        #expect(Self.dayNumbers(for: "nth-weekday", in: aprilProjection, calendar: calendar) == [13])

        let yearProjection = ScheduleCalendarProjection.week(
            containing: Self.date("2027-01-06T12:00:00Z"),
            jobs: [yearBound],
            calendar: calendar)
        #expect(yearProjection.occurrences.isEmpty)
        #expect(yearProjection.unsupportedSchedules.isEmpty)
    }

    @Test func `cron projection supports one-shot iso patterns and day-of-month lists with last day`() {
        let calendar = Self.utcCalendar()
        let oneShot = self.makeJob(
            id: "iso-once",
            name: "ISO once",
            schedule: .cron(expr: "2026-04-21T10:15:00", tz: "Europe/Lisbon", staggerMs: 0))
        let listWithLastDay = self.makeJob(
            id: "list-last-day",
            name: "List with last day",
            schedule: .cron(expr: "0 9 L,15 * *", tz: "UTC", staggerMs: 0))

        let aprilProjection = ScheduleCalendarProjection.month(
            containing: Self.date("2026-04-15T12:00:00Z"),
            jobs: [oneShot, listWithLastDay],
            calendar: calendar)

        #expect(aprilProjection.unsupportedSchedules.isEmpty)
        let isoOccurrence = try! #require(aprilProjection.occurrences.first { $0.jobId == "iso-once" })
        #expect(isoOccurrence.startAt == Self.date("2026-04-21T09:15:00Z"))
        #expect(Self.dayNumbers(for: "list-last-day", in: aprilProjection, calendar: calendar) == [15, 30])
    }

    @Test func `frequent interval schedules render honestly when the range is still tractable`() {
        let calendar = Self.utcCalendar()
        let anchor = Self.date("2026-04-20T00:00:00Z")
        let projection = ScheduleCalendarProjection.week(
            containing: Self.date("2026-04-22T12:00:00Z"),
            jobs: [
                self.makeJob(
                    id: "every-minute",
                    name: "Every minute",
                    schedule: .every(everyMs: 60_000, anchorMs: Self.ms(anchor)),
                    createdAtMs: Self.ms(anchor)),
            ],
            calendar: calendar)

        #expect(projection.unsupportedSchedules.isEmpty)
        #expect(projection.occurrences.count == 10_080)
    }

    @Test func `unsupported schedules are reported without fake occurrences`() {
        let calendar = Self.utcCalendar()
        let unsupported = self.makeJob(
            id: "unsupported",
            name: "Invalid cron",
            schedule: .cron(expr: "not valid", tz: "UTC", staggerMs: 0),
            state: CronJobState(nextRunAtMs: Self.ms(Self.date("2026-04-27T09:00:00Z"))))

        let projection = ScheduleCalendarProjection.month(
            containing: Self.date("2026-04-15T12:00:00Z"),
            jobs: [unsupported],
            calendar: calendar)

        #expect(projection.occurrences.isEmpty)
        let issue = try! #require(projection.unsupportedSchedules.first)
        #expect(issue.jobId == "unsupported")
        #expect(!issue.reason.isEmpty)
        #expect(issue.nextRunAt == Self.date("2026-04-27T09:00:00Z"))
    }

    @Test func `projection ordering stays stable when names and timestamps match`() {
        let calendar = Self.utcCalendar()
        let jobs = [
            self.makeJob(
                id: "job-b",
                name: "Same name",
                schedule: .at(at: "2026-04-21T10:15:00Z")),
            self.makeJob(
                id: "job-a",
                name: "Same name",
                schedule: .at(at: "2026-04-21T10:15:00Z")),
        ]

        let projection = ScheduleCalendarProjection.week(
            containing: Self.date("2026-04-22T12:00:00Z"),
            jobs: jobs,
            calendar: calendar)

        #expect(projection.occurrences.map(\.jobId) == ["job-a", "job-b"])
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

    private static func hourOffsetMs(_ date: Date) -> Int {
        let totalMs = Int((date.timeIntervalSince1970 * 1_000).rounded(.down))
        let hourMs = 60 * 60 * 1_000
        let offset = totalMs % hourMs
        return offset >= 0 ? offset : offset + hourMs
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
