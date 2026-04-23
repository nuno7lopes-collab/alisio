import CryptoKit
import Foundation

struct ScheduleCalendarProjection: Equatable {
    struct Occurrence: Identifiable, Equatable {
        let id: String
        let jobId: String
        let jobName: String
        let startAt: Date
        let isEnabled: Bool
        let scheduleKind: String
    }

    struct UnsupportedSchedule: Identifiable, Equatable {
        var id: String { self.jobId }

        let jobId: String
        let jobName: String
        let reason: String
        let isEnabled: Bool
        let nextRunAt: Date?
    }

    struct Day: Identifiable, Equatable {
        var id: Int { Int(self.start.timeIntervalSince1970) }

        let start: Date
        let occurrences: [Occurrence]
    }

    let interval: DateInterval
    let days: [Day]
    let occurrences: [Occurrence]
    let unsupportedSchedules: [UnsupportedSchedule]

    static func week(
        containing referenceDate: Date,
        jobs: [CronJob],
        calendar: Calendar = .current,
        maximumOccurrencesPerJob: Int = 5_000) -> ScheduleCalendarProjection
    {
        let interval = calendar.dateInterval(of: .weekOfYear, for: referenceDate)
            ?? DateInterval(start: calendar.startOfDay(for: referenceDate), duration: 7 * 86_400)
        return self.make(
            jobs: jobs,
            interval: interval,
            calendar: calendar,
            maximumOccurrencesPerJob: maximumOccurrencesPerJob)
    }

    static func month(
        containing referenceDate: Date,
        jobs: [CronJob],
        calendar: Calendar = .current,
        maximumOccurrencesPerJob: Int = 5_000) -> ScheduleCalendarProjection
    {
        let interval = calendar.dateInterval(of: .month, for: referenceDate)
            ?? DateInterval(start: calendar.startOfDay(for: referenceDate), duration: 31 * 86_400)
        return self.make(
            jobs: jobs,
            interval: interval,
            calendar: calendar,
            maximumOccurrencesPerJob: maximumOccurrencesPerJob)
    }

    static func make(
        jobs: [CronJob],
        interval: DateInterval,
        calendar: Calendar = .current,
        maximumOccurrencesPerJob: Int = 5_000) -> ScheduleCalendarProjection
    {
        let dayStarts = self.dayStarts(in: interval, calendar: calendar)
        var occurrences: [Occurrence] = []
        var unsupported: [UnsupportedSchedule] = []

        for job in jobs {
            switch self.expand(job: job, in: interval, calendar: calendar, maximumOccurrences: maximumOccurrencesPerJob) {
            case let .occurrences(jobOccurrences):
                occurrences.append(contentsOf: jobOccurrences)
            case let .unsupported(reason):
                unsupported.append(UnsupportedSchedule(
                    jobId: job.id,
                    jobName: job.displayName,
                    reason: reason,
                    isEnabled: job.enabled,
                    nextRunAt: job.nextRunDate))
            }
        }

        occurrences.sort {
            if $0.startAt == $1.startAt {
                return $0.jobName.localizedCaseInsensitiveCompare($1.jobName) == .orderedAscending
            }
            return $0.startAt < $1.startAt
        }

        let grouped = Dictionary(grouping: occurrences) { occurrence in
            calendar.startOfDay(for: occurrence.startAt)
        }
        let days = dayStarts.map { dayStart in
            Day(start: dayStart, occurrences: grouped[dayStart] ?? [])
        }

        unsupported.sort {
            $0.jobName.localizedCaseInsensitiveCompare($1.jobName) == .orderedAscending
        }

        return ScheduleCalendarProjection(
            interval: interval,
            days: days,
            occurrences: occurrences,
            unsupportedSchedules: unsupported)
    }

    private enum ExpansionResult {
        case occurrences([Occurrence])
        case unsupported(String)
    }

    private static func expand(
        job: CronJob,
        in interval: DateInterval,
        calendar: Calendar,
        maximumOccurrences: Int) -> ExpansionResult
    {
        switch job.schedule {
        case let .at(at):
            guard let date = CronSchedule.parseAtDate(at) else {
                return .unsupported("The one-shot time could not be parsed.")
            }
            guard self.contains(date, in: interval) else {
                return .occurrences([])
            }
            return .occurrences([self.occurrence(for: job, at: date, scheduleKind: "once")])
        case let .every(everyMs, anchorMs):
            return self.expandEvery(
                job: job,
                everyMs: everyMs,
                anchorMs: anchorMs,
                interval: interval,
                maximumOccurrences: maximumOccurrences)
        case let .cron(expr, tz, staggerMs):
            return self.expandCron(
                job: job,
                expr: expr,
                tz: tz,
                staggerMs: staggerMs,
                interval: interval,
                calendar: calendar,
                maximumOccurrences: maximumOccurrences)
        }
    }

    private static func expandEvery(
        job: CronJob,
        everyMs: Int,
        anchorMs: Int?,
        interval: DateInterval,
        maximumOccurrences: Int) -> ExpansionResult
    {
        guard everyMs > 0 else {
            return .unsupported("The interval must be greater than zero.")
        }

        let intervalMs = Int64(everyMs)
        let rangeStartMs = self.milliseconds(since1970: interval.start)
        let rangeEndMs = self.milliseconds(since1970: interval.end)
        let anchor = Int64(anchorMs ?? job.createdAtMs)
        let firstMs: Int64
        if rangeStartMs <= anchor {
            firstMs = anchor
        } else {
            let elapsed = rangeStartMs - anchor
            let steps = (elapsed + intervalMs - 1) / intervalMs
            firstMs = anchor + steps * intervalMs
        }

        guard firstMs < rangeEndMs else {
            return .occurrences([])
        }

        let estimatedCount = Int(((rangeEndMs - firstMs) + intervalMs - 1) / intervalMs)
        guard estimatedCount <= maximumOccurrences else {
            return .unsupported("The interval is too frequent to render honestly in this calendar range.")
        }

        var result: [Occurrence] = []
        var cursor = firstMs
        while cursor < rangeEndMs {
            result.append(self.occurrence(
                for: job,
                at: self.date(fromMilliseconds: cursor),
                scheduleKind: "every"))
            cursor += intervalMs
        }
        return .occurrences(result)
    }

    private static func expandCron(
        job: CronJob,
        expr: String,
        tz: String?,
        staggerMs: Int?,
        interval: DateInterval,
        calendar: Calendar,
        maximumOccurrences: Int) -> ExpansionResult
    {
        let pattern: ScheduleCronPattern
        do {
            pattern = try ScheduleCronPattern(expr: expr, tz: tz, calendar: calendar)
        } catch let error as ScheduleCronPattern.ParseError {
            return .unsupported(error.message)
        } catch {
            return .unsupported("The cron expression could not be parsed.")
        }

        let offsetMs = self.cronOffsetMs(jobId: job.id, expr: expr, staggerMs: staggerMs)
        let baseInterval: DateInterval
        if offsetMs > 0 {
            let startMs = max(0, self.milliseconds(since1970: interval.start) - Int64(offsetMs))
            let endMs = max(0, self.milliseconds(since1970: interval.end) - Int64(offsetMs))
            baseInterval = DateInterval(
                start: self.date(fromMilliseconds: startMs),
                end: self.date(fromMilliseconds: endMs))
        } else {
            baseInterval = interval
        }

        var dates: [Date]
        do {
            dates = try pattern.occurrences(in: baseInterval, maximum: maximumOccurrences + 1)
        } catch let error as ScheduleCronPattern.ParseError {
            return .unsupported(error.message)
        } catch {
            return .unsupported("The cron expression could not be expanded.")
        }

        guard dates.count <= maximumOccurrences else {
            return .unsupported("The cron expression is too frequent to render honestly in this calendar range.")
        }

        if offsetMs > 0 {
            dates = dates.map { date in
                self.date(fromMilliseconds: self.milliseconds(since1970: date) + Int64(offsetMs))
            }
        }

        let occurrences = dates
            .filter { self.contains($0, in: interval) }
            .map { self.occurrence(for: job, at: $0, scheduleKind: "cron") }
        return .occurrences(occurrences)
    }

    private static func occurrence(for job: CronJob, at date: Date, scheduleKind: String) -> Occurrence {
        Occurrence(
            id: "\(job.id):\(self.milliseconds(since1970: date))",
            jobId: job.id,
            jobName: job.displayName,
            startAt: date,
            isEnabled: job.enabled,
            scheduleKind: scheduleKind)
    }

    private static func dayStarts(in interval: DateInterval, calendar: Calendar) -> [Date] {
        var days: [Date] = []
        var cursor = calendar.startOfDay(for: interval.start)
        while cursor < interval.end {
            days.append(cursor)
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor), next > cursor else {
                break
            }
            cursor = next
        }
        return days
    }

    private static func contains(_ date: Date, in interval: DateInterval) -> Bool {
        date >= interval.start && date < interval.end
    }

    private static func milliseconds(since1970 date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded(.down))
    }

    private static func date(fromMilliseconds milliseconds: Int64) -> Date {
        Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1_000)
    }

    private static func cronOffsetMs(jobId: String, expr: String, staggerMs: Int?) -> Int {
        let windowMs: Int
        if let staggerMs {
            windowMs = max(0, staggerMs)
        } else if self.isTopOfHourCronExpr(expr) {
            windowMs = 5 * 60 * 1_000
        } else {
            windowMs = 0
        }
        guard windowMs > 1 else { return 0 }
        let digest = SHA256.hash(data: Data(jobId.utf8))
        let bytes = Array(digest.prefix(4))
        let value = UInt32(bytes[0]) << 24 | UInt32(bytes[1]) << 16 | UInt32(bytes[2]) << 8 | UInt32(bytes[3])
        return Int(value % UInt32(windowMs))
    }

    private static func isTopOfHourCronExpr(_ expr: String) -> Bool {
        let fields = expr.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        if fields.count == 5 {
            return fields[0] == "0" && fields[1].contains("*")
        }
        if fields.count == 6 {
            return fields[0] == "0" && fields[1] == "0" && fields[2].contains("*")
        }
        return false
    }
}

private struct ScheduleCronPattern {
    struct ParseError: Error {
        let message: String
    }

    private let seconds: CronField
    private let minutes: CronField
    private let hours: CronField
    private let daysOfMonth: CronField
    private let months: CronField
    private let daysOfWeek: CronField
    private var calendar: Calendar

    init(expr: String, tz: String?, calendar baseCalendar: Calendar) throws {
        let fields = expr.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard fields.count == 5 || fields.count == 6 else {
            throw ParseError(message: "The calendar can render 5-field or 6-field cron expressions only.")
        }

        let offset = fields.count == 6 ? 1 : 0
        self.seconds = try fields.count == 6
            ? CronField(raw: fields[0], minimum: 0, maximum: 59)
            : CronField.single(0)
        self.minutes = try CronField(raw: fields[offset], minimum: 0, maximum: 59)
        self.hours = try CronField(raw: fields[offset + 1], minimum: 0, maximum: 23)
        self.daysOfMonth = try CronField(raw: fields[offset + 2], minimum: 1, maximum: 31)
        self.months = try CronField(raw: fields[offset + 3], minimum: 1, maximum: 12)
        self.daysOfWeek = try CronField(raw: fields[offset + 4], minimum: 0, maximum: 7)

        guard self.daysOfMonth.isWildcard || self.daysOfWeek.isWildcard else {
            throw ParseError(
                message: "Cron expressions that constrain both day of month and day of week are not rendered.")
        }

        var calendar = baseCalendar
        if let tz, !tz.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let timeZone = TimeZone(identifier: tz.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                throw ParseError(message: "The cron timezone is not valid.")
            }
            calendar.timeZone = timeZone
        }
        self.calendar = calendar
    }

    func occurrences(in interval: DateInterval, maximum: Int) throws -> [Date] {
        var result: [Date] = []
        var cursor = self.calendar.startOfDay(for: interval.start)

        while cursor < interval.end {
            let dayComponents = self.calendar.dateComponents([.year, .month, .day, .weekday], from: cursor)
            if self.matchesDay(dayComponents) {
                for hour in self.hours.values {
                    for minute in self.minutes.values {
                        for second in self.seconds.values {
                            var components = DateComponents()
                            components.calendar = self.calendar
                            components.timeZone = self.calendar.timeZone
                            components.year = dayComponents.year
                            components.month = dayComponents.month
                            components.day = dayComponents.day
                            components.hour = hour
                            components.minute = minute
                            components.second = second
                            guard let date = self.calendar.date(from: components),
                                  self.matchesRequestedTime(date, hour: hour, minute: minute, second: second),
                                  date >= interval.start,
                                  date < interval.end
                            else {
                                continue
                            }
                            result.append(date)
                            if result.count > maximum {
                                return result
                            }
                        }
                    }
                }
            }

            guard let next = self.calendar.date(byAdding: .day, value: 1, to: cursor), next > cursor else {
                break
            }
            cursor = next
        }

        return result.sorted()
    }

    private func matchesDay(_ components: DateComponents) -> Bool {
        guard let month = components.month,
              let day = components.day,
              let weekday = components.weekday,
              self.months.contains(month)
        else {
            return false
        }

        if !self.daysOfMonth.isWildcard, !self.daysOfMonth.contains(day) {
            return false
        }

        if !self.daysOfWeek.isWildcard {
            let cronWeekday = weekday == 1 ? 0 : weekday - 1
            if !self.daysOfWeek.contains(cronWeekday) && !(weekday == 1 && self.daysOfWeek.contains(7)) {
                return false
            }
        }

        return true
    }

    private func matchesRequestedTime(_ date: Date, hour: Int, minute: Int, second: Int) -> Bool {
        let components = self.calendar.dateComponents([.hour, .minute, .second], from: date)
        return components.hour == hour && components.minute == minute && components.second == second
    }

    private struct CronField {
        let values: [Int]
        let isWildcard: Bool

        static func single(_ value: Int) -> CronField {
            CronField(values: [value], isWildcard: false)
        }

        private init(values: [Int], isWildcard: Bool) {
            self.values = values
            self.isWildcard = isWildcard
        }

        init(raw: String, minimum: Int, maximum: Int) throws {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                throw ParseError(message: "The cron expression contains an empty field.")
            }

            var values = Set<Int>()
            var wildcard = false

            for piece in trimmed.split(separator: ",", omittingEmptySubsequences: false).map(String.init) {
                let parsed = try Self.parsePiece(piece, minimum: minimum, maximum: maximum)
                wildcard = wildcard || parsed.isWildcard
                for value in stride(from: parsed.lower, through: parsed.upper, by: parsed.step) {
                    values.insert(value)
                }
            }

            guard !values.isEmpty else {
                throw ParseError(message: "The cron expression contains an empty field.")
            }

            self.values = values.sorted()
            self.isWildcard = wildcard && values.count >= (maximum - minimum + 1)
        }

        func contains(_ value: Int) -> Bool {
            self.values.contains(value)
        }

        private static func parsePiece(
            _ piece: String,
            minimum: Int,
            maximum: Int) throws -> (lower: Int, upper: Int, step: Int, isWildcard: Bool)
        {
            let parts = piece.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            guard parts.count <= 2 else {
                throw ParseError(message: "The cron expression contains an unsupported step field.")
            }
            let step = try parts.count == 2 ? self.parsePositiveInt(parts[1]) : 1
            let body = parts[0]

            let lower: Int
            let upper: Int
            let wildcard: Bool
            if body == "*" {
                lower = minimum
                upper = maximum
                wildcard = true
            } else if body.contains("-") {
                let rangeParts = body.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
                guard rangeParts.count == 2 else {
                    throw ParseError(message: "The cron expression contains an unsupported range.")
                }
                lower = try self.parseInt(rangeParts[0])
                upper = try self.parseInt(rangeParts[1])
                wildcard = false
            } else {
                lower = try self.parseInt(body)
                upper = lower
                wildcard = false
            }

            guard step > 0, lower >= minimum, upper <= maximum, lower <= upper else {
                throw ParseError(message: "The cron expression has a field outside the supported range.")
            }
            return (lower, upper, step, wildcard)
        }

        private static func parsePositiveInt(_ raw: String) throws -> Int {
            let value = try self.parseInt(raw)
            guard value > 0 else {
                throw ParseError(message: "Cron steps must be greater than zero.")
            }
            return value
        }

        private static func parseInt(_ raw: String) throws -> Int {
            guard let value = Int(raw) else {
                throw ParseError(message: "The calendar only renders numeric cron fields.")
            }
            return value
        }
    }
}
