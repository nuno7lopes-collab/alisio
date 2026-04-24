import CryptoKit
import Foundation

struct ScheduleCalendarProjection: Equatable {
    enum CoverageState: Equatable {
        case visible
        case noOccurrencesInRange
        case unsupported(String)
    }

    struct Occurrence: Identifiable, Equatable {
        let id: String
        let jobId: String
        let jobName: String
        let startAt: Date
        let isEnabled: Bool
    }

    struct JobCoverage: Identifiable, Equatable {
        var id: String { self.jobId }

        let jobId: String
        let jobName: String
        let isEnabled: Bool
        let nextRunAt: Date?
        let state: CoverageState
        let occurrences: [Occurrence]

        var occurrenceCount: Int {
            self.occurrences.count
        }

        var firstOccurrence: Occurrence? {
            self.occurrences.first
        }

        var lastOccurrence: Occurrence? {
            self.occurrences.last
        }
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
    let jobCoverage: [JobCoverage]
    let unsupportedSchedules: [UnsupportedSchedule]

    private static let defaultMaximumOccurrencesPerJob = 300_000

    static func week(
        containing referenceDate: Date,
        jobs: [CronJob],
        calendar: Calendar = .current,
        maximumOccurrencesPerJob: Int = ScheduleCalendarProjection.defaultMaximumOccurrencesPerJob) -> ScheduleCalendarProjection
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
        maximumOccurrencesPerJob: Int = ScheduleCalendarProjection.defaultMaximumOccurrencesPerJob) -> ScheduleCalendarProjection
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
        maximumOccurrencesPerJob: Int = ScheduleCalendarProjection.defaultMaximumOccurrencesPerJob) -> ScheduleCalendarProjection
    {
        let dayStarts = self.dayStarts(in: interval, calendar: calendar)
        var occurrences: [Occurrence] = []
        var coverage: [JobCoverage] = []
        var unsupported: [UnsupportedSchedule] = []

        for job in jobs {
            switch self.expand(job: job, in: interval, calendar: calendar, maximumOccurrences: maximumOccurrencesPerJob) {
            case let .occurrences(jobOccurrences):
                occurrences.append(contentsOf: jobOccurrences)
                coverage.append(JobCoverage(
                    jobId: job.id,
                    jobName: job.displayName,
                    isEnabled: job.enabled,
                    nextRunAt: job.nextRunDate,
                    state: jobOccurrences.isEmpty ? .noOccurrencesInRange : .visible,
                    occurrences: jobOccurrences))
            case let .unsupported(reason):
                unsupported.append(UnsupportedSchedule(
                    jobId: job.id,
                    jobName: job.displayName,
                    reason: reason,
                    isEnabled: job.enabled,
                    nextRunAt: job.nextRunDate))
                coverage.append(JobCoverage(
                    jobId: job.id,
                    jobName: job.displayName,
                    isEnabled: job.enabled,
                    nextRunAt: job.nextRunDate,
                    state: .unsupported(reason),
                    occurrences: []))
            }
        }

        occurrences.sort {
            if $0.startAt != $1.startAt {
                return $0.startAt < $1.startAt
            }

            let nameOrder = $0.jobName.localizedCaseInsensitiveCompare($1.jobName)
            if nameOrder != .orderedSame {
                return nameOrder == .orderedAscending
            }

            if $0.jobId != $1.jobId {
                return $0.jobId < $1.jobId
            }

            return $0.id < $1.id
        }

        let grouped = Dictionary(grouping: occurrences) { occurrence in
            calendar.startOfDay(for: occurrence.startAt)
        }
        let days = dayStarts.map { dayStart in
            Day(start: dayStart, occurrences: grouped[dayStart] ?? [])
        }

        unsupported.sort {
            let nameOrder = $0.jobName.localizedCaseInsensitiveCompare($1.jobName)
            if nameOrder != .orderedSame {
                return nameOrder == .orderedAscending
            }
            return $0.jobId < $1.jobId
        }

        coverage.sort {
            let nameOrder = $0.jobName.localizedCaseInsensitiveCompare($1.jobName)
            if nameOrder != .orderedSame {
                return nameOrder == .orderedAscending
            }
            return $0.jobId < $1.jobId
        }

        return ScheduleCalendarProjection(
            interval: interval,
            days: days,
            occurrences: occurrences,
            jobCoverage: coverage,
            unsupportedSchedules: unsupported)
    }

    func coverage(for jobId: String) -> JobCoverage? {
        self.jobCoverage.first { $0.jobId == jobId }
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
            return .occurrences([self.occurrence(for: job, at: date)])
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
                at: self.date(fromMilliseconds: cursor)))
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
            .map { self.occurrence(for: job, at: $0) }
        return .occurrences(occurrences)
    }

    private static func occurrence(for job: CronJob, at date: Date) -> Occurrence {
        Occurrence(
            id: "\(job.id):\(self.milliseconds(since1970: date))",
            jobId: job.id,
            jobName: job.displayName,
            startAt: date,
            isEnabled: job.enabled)
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

    private struct NumericField {
        let values: [Int]
        private let allowed: Set<Int>

        init(
            raw: String,
            minimum: Int,
            maximum: Int,
            fieldName: String,
            normalize: ((Int) -> Int)? = nil) throws
        {
            self.values = try ScheduleCronPattern.parseNumericValues(
                raw: raw,
                minimum: minimum,
                maximum: maximum,
                fieldName: fieldName,
                normalize: normalize)
            self.allowed = Set(self.values)
        }

        func contains(_ value: Int) -> Bool {
            self.allowed.contains(value)
        }
    }

    private struct DayOfMonthField {
        let matchesAll: Bool
        private let exactDays: Set<Int>
        private let nearestWeekdayDays: Set<Int>
        private let lastDayOfMonth: Bool
        private let lastWeekdayOfMonth: Bool

        init(raw: String) throws {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                throw ParseError(message: "The cron day-of-month field is empty.")
            }

            let uppercase = trimmed.uppercased()
            if uppercase == "LW" {
                self.matchesAll = false
                self.exactDays = []
                self.nearestWeekdayDays = []
                self.lastDayOfMonth = false
                self.lastWeekdayOfMonth = true
                return
            }

            let normalized = ScheduleCronPattern.normalizeWildcards(trimmed)
            if normalized == "*" {
                self.matchesAll = true
                self.exactDays = []
                self.nearestWeekdayDays = []
                self.lastDayOfMonth = false
                self.lastWeekdayOfMonth = false
                return
            }

            let pieces = try ScheduleCronPattern.splitPieces(normalized, fieldName: "day-of-month")
            var exactDays = Set<Int>()
            var nearestWeekdayDays = Set<Int>()
            var lastDayOfMonth = false

            for piece in pieces {
                let upperPiece = piece.uppercased()
                if upperPiece == "L" {
                    lastDayOfMonth = true
                    continue
                }

                if upperPiece.hasSuffix("W") {
                    let rawDay = String(upperPiece.dropLast())
                    guard !rawDay.isEmpty, !rawDay.contains("-"), !rawDay.contains("/") else {
                        throw ParseError(message: "Nearest weekday schedules are only rendered for a single day of month.")
                    }
                    let day = try ScheduleCronPattern.parseInt(rawDay, fieldName: "day-of-month")
                    guard (1...31).contains(day) else {
                        throw ParseError(message: "The cron day-of-month field is outside the supported range.")
                    }
                    nearestWeekdayDays.insert(day)
                    continue
                }

                exactDays.formUnion(
                    try ScheduleCronPattern.parseNumericValues(
                        raw: piece,
                        minimum: 1,
                        maximum: 31,
                        fieldName: "day-of-month"))
            }

            self.matchesAll = false
            self.exactDays = exactDays
            self.nearestWeekdayDays = nearestWeekdayDays
            self.lastDayOfMonth = lastDayOfMonth
            self.lastWeekdayOfMonth = false
        }

        func matches(day: Int, year: Int, month: Int, calendar: Calendar) -> Bool {
            if self.matchesAll {
                return true
            }

            if self.exactDays.contains(day) {
                return true
            }

            if self.lastDayOfMonth, ScheduleCronPattern.lastDayOfMonth(year: year, month: month, calendar: calendar) == day {
                return true
            }

            if self.lastWeekdayOfMonth, ScheduleCronPattern.lastWeekdayOfMonth(year: year, month: month, calendar: calendar) == day {
                return true
            }

            for sourceDay in self.nearestWeekdayDays {
                if ScheduleCronPattern.nearestWeekday(
                    for: sourceDay,
                    year: year,
                    month: month,
                    calendar: calendar) == day
                {
                    return true
                }
            }

            return false
        }
    }

    private struct DayOfWeekField {
        struct NthWeekdayRule {
            let weekdays: Set<Int>
            let ordinal: Int?
            let isLast: Bool
        }

        let matchesAll: Bool
        private let exactWeekdays: Set<Int>
        private let nthRules: [NthWeekdayRule]

        init(raw: String) throws {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                throw ParseError(message: "The cron day-of-week field is empty.")
            }

            let normalized = ScheduleCronPattern.replaceDayAliases(
                ScheduleCronPattern.normalizeWildcards(trimmed.uppercased()))
            if normalized == "*" {
                self.matchesAll = true
                self.exactWeekdays = []
                self.nthRules = []
                return
            }

            let pieces = try ScheduleCronPattern.splitPieces(normalized, fieldName: "day-of-week")
            var exactWeekdays = Set<Int>()
            var nthRules: [NthWeekdayRule] = []

            for piece in pieces {
                let parsed = try Self.parsePiece(piece)
                if let rule = parsed.rule {
                    nthRules.append(rule)
                } else {
                    exactWeekdays.formUnion(parsed.weekdays)
                }
            }

            self.matchesAll = false
            self.exactWeekdays = exactWeekdays
            self.nthRules = nthRules
        }

        func matches(
            day: Int,
            year: Int,
            month: Int,
            weekday: Int,
            calendar: Calendar) -> Bool
        {
            if self.matchesAll {
                return true
            }

            if self.exactWeekdays.contains(weekday) {
                return true
            }

            for rule in self.nthRules where rule.weekdays.contains(weekday) {
                if rule.isLast {
                    if ScheduleCronPattern.isLastWeekdayOccurrence(
                        weekday: weekday,
                        day: day,
                        year: year,
                        month: month,
                        calendar: calendar)
                    {
                        return true
                    }
                } else if let ordinal = rule.ordinal,
                          ScheduleCronPattern.weekdayOrdinalInMonth(
                              weekday: weekday,
                              day: day,
                              year: year,
                              month: month,
                              calendar: calendar) == ordinal
                {
                    return true
                }
            }

            return false
        }

        private static func parsePiece(_ raw: String) throws -> (weekdays: Set<Int>, rule: NthWeekdayRule?) {
            var piece = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            var ordinal: Int?
            var isLast = false

            if let hashIndex = piece.firstIndex(of: "#") {
                let suffix = piece[piece.index(after: hashIndex)...]
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                piece = String(piece[..<hashIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !piece.isEmpty, !suffix.isEmpty else {
                    throw ParseError(message: "The cron day-of-week field contains an invalid nth weekday rule.")
                }
                if suffix.uppercased() == "L" {
                    isLast = true
                } else {
                    let parsedOrdinal = try ScheduleCronPattern.parsePositiveInt(String(suffix), fieldName: "day-of-week")
                    guard (1...5).contains(parsedOrdinal) else {
                        throw ParseError(message: "The cron day-of-week nth value must be between 1 and 5, or L.")
                    }
                    ordinal = parsedOrdinal
                }
            } else if piece.uppercased().hasSuffix("L") && piece.count > 1 {
                piece.removeLast()
                piece = piece.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !piece.isEmpty else {
                    throw ParseError(message: "The cron day-of-week field contains an invalid last-weekday rule.")
                }
                isLast = true
            }

            let weekdays = Set(
                try ScheduleCronPattern.parseNumericValues(
                    raw: piece,
                    minimum: 0,
                    maximum: 7,
                    fieldName: "day-of-week",
                    normalize: { $0 == 7 ? 0 : $0 }))

            if isLast || ordinal != nil {
                return (
                    weekdays,
                    NthWeekdayRule(
                        weekdays: weekdays,
                        ordinal: ordinal,
                        isLast: isLast))
            }

            return (weekdays, nil)
        }
    }

    private let seconds: NumericField
    private let minutes: NumericField
    private let hours: NumericField
    private let daysOfMonth: DayOfMonthField
    private let months: NumericField
    private let daysOfWeek: DayOfWeekField
    private let years: NumericField
    private let strictStarDayOfMonth: Bool
    private let strictStarDayOfWeek: Bool
    private let useAndLogic: Bool
    private let onceDate: Date?
    private var calendar: Calendar

    init(expr: String, tz: String?, calendar baseCalendar: Calendar) throws {
        let canonicalExpr = try Self.expandNicknames(expr.trimmingCharacters(in: .whitespacesAndNewlines))
        var calendar = baseCalendar
        if let tz, !tz.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let timeZone = TimeZone(identifier: tz.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                throw ParseError(message: "The cron timezone is not valid.")
            }
            calendar.timeZone = timeZone
        }
        self.calendar = calendar

        if let onceDate = Self.parseOneShotDate(canonicalExpr, calendar: calendar) {
            self.seconds = try NumericField(raw: "0", minimum: 0, maximum: 59, fieldName: "seconds")
            self.minutes = try NumericField(raw: "0", minimum: 0, maximum: 59, fieldName: "minutes")
            self.hours = try NumericField(raw: "0", minimum: 0, maximum: 23, fieldName: "hours")
            self.daysOfMonth = try DayOfMonthField(raw: "*")
            self.months = try NumericField(raw: "*", minimum: 1, maximum: 12, fieldName: "months")
            self.daysOfWeek = try DayOfWeekField(raw: "*")
            self.years = try NumericField(raw: "*", minimum: 1, maximum: 9_999, fieldName: "years")
            self.strictStarDayOfMonth = true
            self.strictStarDayOfWeek = true
            self.useAndLogic = false
            self.onceDate = onceDate
            return
        }

        let rawFields = canonicalExpr
            .split(whereSeparator: { $0 == " " || $0 == "\t" })
            .map(String.init)
        guard rawFields.count == 5 || rawFields.count == 6 || rawFields.count == 7 else {
            throw ParseError(message: "The calendar can render 5-field, 6-field, or 7-field cron expressions only.")
        }

        var fields = rawFields
        if fields.count == 5 {
            fields.insert("0", at: 0)
            fields.append("*")
        } else if fields.count == 6 {
            fields.append("*")
        }

        let rawDayOfMonth = fields[3].trimmingCharacters(in: .whitespacesAndNewlines)
        var rawDayOfWeek = fields[5].trimmingCharacters(in: .whitespacesAndNewlines)
        self.strictStarDayOfMonth = rawDayOfMonth == "*"
        self.strictStarDayOfWeek = rawDayOfWeek == "*"
        self.useAndLogic = rawDayOfWeek.hasPrefix("+")
        if self.useAndLogic {
            rawDayOfWeek.removeFirst()
            rawDayOfWeek = rawDayOfWeek.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !rawDayOfWeek.isEmpty else {
                throw ParseError(message: "The cron day-of-week field cannot be empty after '+'.")
            }
        }

        self.seconds = try NumericField(
            raw: Self.normalizeWildcards(fields[0]),
            minimum: 0,
            maximum: 59,
            fieldName: "seconds")
        self.minutes = try NumericField(
            raw: Self.normalizeWildcards(fields[1]),
            minimum: 0,
            maximum: 59,
            fieldName: "minutes")
        self.hours = try NumericField(
            raw: Self.normalizeWildcards(fields[2]),
            minimum: 0,
            maximum: 23,
            fieldName: "hours")
        self.daysOfMonth = try DayOfMonthField(raw: Self.normalizeWildcards(rawDayOfMonth))
        self.months = try NumericField(
            raw: Self.replaceMonthAliases(Self.normalizeWildcards(fields[4].uppercased())),
            minimum: 1,
            maximum: 12,
            fieldName: "months")
        self.daysOfWeek = try DayOfWeekField(raw: rawDayOfWeek)
        self.years = try NumericField(
            raw: Self.normalizeWildcards(fields[6]),
            minimum: 1,
            maximum: 9_999,
            fieldName: "years")
        self.onceDate = nil
    }

    func occurrences(in interval: DateInterval, maximum: Int) throws -> [Date] {
        if let onceDate {
            guard onceDate >= interval.start, onceDate < interval.end else {
                return []
            }
            return [onceDate]
        }

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

        return result
    }

    private func matchesDay(_ components: DateComponents) -> Bool {
        guard let year = components.year,
              let month = components.month,
              let day = components.day,
              let weekday = components.weekday,
              self.years.contains(year),
              self.months.contains(month)
        else {
            return false
        }

        let dayOfMonthMatches = self.daysOfMonth.matches(
            day: day,
            year: year,
            month: month,
            calendar: self.calendar)

        if self.strictStarDayOfWeek {
            return dayOfMonthMatches
        }

        let cronWeekday = Self.cronWeekday(fromCalendarWeekday: weekday)
        let dayOfWeekMatches = self.daysOfWeek.matches(
            day: day,
            year: year,
            month: month,
            weekday: cronWeekday,
            calendar: self.calendar)

        if self.useAndLogic || self.strictStarDayOfMonth {
            return dayOfMonthMatches && dayOfWeekMatches
        }

        return dayOfMonthMatches || dayOfWeekMatches
    }

    private func matchesRequestedTime(_ date: Date, hour: Int, minute: Int, second: Int) -> Bool {
        let components = self.calendar.dateComponents([.hour, .minute, .second], from: date)
        return components.hour == hour && components.minute == minute && components.second == second
    }

    private static func expandNicknames(_ expr: String) throws -> String {
        let normalized = expr.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            throw ParseError(message: "The cron expression is empty.")
        }

        switch normalized.lowercased() {
        case "@yearly", "@annually":
            return "0 0 1 1 *"
        case "@monthly":
            return "0 0 1 * *"
        case "@weekly":
            return "0 0 * * 0"
        case "@daily", "@midnight":
            return "0 0 * * *"
        case "@hourly":
            return "0 * * * *"
        case "@reboot":
            throw ParseError(message: "Event-based cron schedules are not rendered on the calendar.")
        default:
            return normalized
        }
    }

    private static func parseOneShotDate(_ raw: String, calendar: Calendar) -> Date? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.contains("T"), !trimmed.contains(" ") else {
            return nil
        }

        if let absolute = Self.parseAbsoluteIsoDate(trimmed) {
            return absolute
        }

        let pattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/
        guard let match = trimmed.wholeMatch(of: pattern) else {
            return nil
        }

        var components = DateComponents()
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        components.year = Int(match.output.1)
        components.month = Int(match.output.2)
        components.day = Int(match.output.3)
        components.hour = Int(match.output.4)
        components.minute = Int(match.output.5)
        if let second = match.output.6 {
            components.second = Int(second)
        } else {
            components.second = 0
        }
        if let fraction = match.output.7, !fraction.isEmpty {
            let padded = String(fraction.prefix(9)).padding(toLength: 9, withPad: "0", startingAt: 0)
            components.nanosecond = Int(padded)
        }
        return calendar.date(from: components)
    }

    private static func parseAbsoluteIsoDate(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: raw) {
            return date
        }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }

    private static func normalizeWildcards(_ raw: String) -> String {
        raw.replacingOccurrences(of: "?", with: "*")
    }

    private static func replaceMonthAliases(_ raw: String) -> String {
        raw.uppercased()
            .replacingOccurrences(of: "JAN", with: "1")
            .replacingOccurrences(of: "FEB", with: "2")
            .replacingOccurrences(of: "MAR", with: "3")
            .replacingOccurrences(of: "APR", with: "4")
            .replacingOccurrences(of: "MAY", with: "5")
            .replacingOccurrences(of: "JUN", with: "6")
            .replacingOccurrences(of: "JUL", with: "7")
            .replacingOccurrences(of: "AUG", with: "8")
            .replacingOccurrences(of: "SEP", with: "9")
            .replacingOccurrences(of: "OCT", with: "10")
            .replacingOccurrences(of: "NOV", with: "11")
            .replacingOccurrences(of: "DEC", with: "12")
    }

    private static func replaceDayAliases(_ raw: String) -> String {
        raw.uppercased()
            .replacingOccurrences(of: "-SUN", with: "-7")
            .replacingOccurrences(of: "SUN", with: "0")
            .replacingOccurrences(of: "MON", with: "1")
            .replacingOccurrences(of: "TUE", with: "2")
            .replacingOccurrences(of: "WED", with: "3")
            .replacingOccurrences(of: "THU", with: "4")
            .replacingOccurrences(of: "FRI", with: "5")
            .replacingOccurrences(of: "SAT", with: "6")
    }

    private static func splitPieces(_ raw: String, fieldName: String) throws -> [String] {
        let pieces = raw
            .split(separator: ",", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard !pieces.isEmpty, pieces.allSatisfy({ !$0.isEmpty }) else {
            throw ParseError(message: "The cron \(fieldName) field contains an empty value.")
        }
        return pieces
    }

    private static func parseNumericValues(
        raw: String,
        minimum: Int,
        maximum: Int,
        fieldName: String,
        normalize: ((Int) -> Int)? = nil) throws -> [Int]
    {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw ParseError(message: "The cron \(fieldName) field is empty.")
        }

        if trimmed == "*" {
            return try Self.expandRange(
                lower: minimum,
                upper: maximum,
                step: 1,
                minimum: minimum,
                maximum: maximum,
                fieldName: fieldName,
                normalize: normalize)
        }

        var values = Set<Int>()
        for piece in try self.splitPieces(trimmed, fieldName: fieldName) {
            for value in try self.parseNumericPiece(
                piece,
                minimum: minimum,
                maximum: maximum,
                fieldName: fieldName,
                normalize: normalize)
            {
                values.insert(value)
            }
        }

        guard !values.isEmpty else {
            throw ParseError(message: "The cron \(fieldName) field is empty.")
        }

        return values.sorted()
    }

    private static func parseNumericPiece(
        _ piece: String,
        minimum: Int,
        maximum: Int,
        fieldName: String,
        normalize: ((Int) -> Int)? = nil) throws -> [Int]
    {
        let stepParts = piece
            .split(separator: "/", omittingEmptySubsequences: false)
            .map(String.init)
        guard stepParts.count <= 2 else {
            throw ParseError(message: "The cron \(fieldName) field contains an unsupported step.")
        }

        let base = stepParts[0].trimmingCharacters(in: .whitespacesAndNewlines)
        let step = try stepParts.count == 2
            ? self.parsePositiveInt(stepParts[1], fieldName: fieldName)
            : 1

        if base == "*" {
            return try self.expandRange(
                lower: minimum,
                upper: maximum,
                step: step,
                minimum: minimum,
                maximum: maximum,
                fieldName: fieldName,
                normalize: normalize)
        }

        if base.contains("-") {
            let rangeParts = base
                .split(separator: "-", omittingEmptySubsequences: false)
                .map(String.init)
            guard rangeParts.count == 2 else {
                throw ParseError(message: "The cron \(fieldName) field contains an unsupported range.")
            }
            let lower = try self.parseInt(rangeParts[0], fieldName: fieldName)
            let upper = try self.parseInt(rangeParts[1], fieldName: fieldName)
            return try self.expandRange(
                lower: lower,
                upper: upper,
                step: step,
                minimum: minimum,
                maximum: maximum,
                fieldName: fieldName,
                normalize: normalize)
        }

        guard stepParts.count == 1 else {
            throw ParseError(message: "The cron \(fieldName) field only supports steps on '*' or ranges.")
        }

        let value = try self.parseInt(base, fieldName: fieldName)
        guard value >= minimum, value <= maximum else {
            throw ParseError(message: "The cron \(fieldName) field is outside the supported range.")
        }
        return [normalize?(value) ?? value]
    }

    private static func expandRange(
        lower: Int,
        upper: Int,
        step: Int,
        minimum: Int,
        maximum: Int,
        fieldName: String,
        normalize: ((Int) -> Int)? = nil) throws -> [Int]
    {
        guard lower >= minimum, upper <= maximum, lower <= upper else {
            throw ParseError(message: "The cron \(fieldName) field is outside the supported range.")
        }

        var values: [Int] = []
        var current = lower
        while current <= upper {
            values.append(normalize?(current) ?? current)
            current += step
        }
        return values
    }

    private static func parseInt(_ raw: String, fieldName: String) throws -> Int {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Int(trimmed) else {
            throw ParseError(message: "The cron \(fieldName) field contains an unsupported value.")
        }
        return value
    }

    private static func parsePositiveInt(_ raw: String, fieldName: String) throws -> Int {
        let value = try self.parseInt(raw, fieldName: fieldName)
        guard value > 0 else {
            throw ParseError(message: "The cron \(fieldName) step must be greater than zero.")
        }
        return value
    }

    private static func cronWeekday(fromCalendarWeekday weekday: Int) -> Int {
        weekday == 1 ? 0 : weekday - 1
    }

    private static func lastDayOfMonth(year: Int, month: Int, calendar: Calendar) -> Int {
        var components = DateComponents()
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        components.year = year
        components.month = month
        components.day = 1
        components.hour = 12
        guard let date = calendar.date(from: components),
              let range = calendar.range(of: .day, in: .month, for: date)
        else {
            return 31
        }
        return range.count
    }

    private static func lastWeekdayOfMonth(year: Int, month: Int, calendar: Calendar) -> Int {
        let lastDay = self.lastDayOfMonth(year: year, month: month, calendar: calendar)
        var candidate = lastDay
        while candidate > 1 {
            let weekday = self.weekday(year: year, month: month, day: candidate, calendar: calendar)
            if weekday != 0 && weekday != 6 {
                return candidate
            }
            candidate -= 1
        }
        return candidate
    }

    private static func nearestWeekday(
        for day: Int,
        year: Int,
        month: Int,
        calendar: Calendar) -> Int?
    {
        let lastDay = self.lastDayOfMonth(year: year, month: month, calendar: calendar)
        guard day >= 1, day <= lastDay else {
            return nil
        }

        let weekday = self.weekday(year: year, month: month, day: day, calendar: calendar)
        switch weekday {
        case 0:
            return day == lastDay ? max(1, day - 2) : day + 1
        case 6:
            return day == 1 ? min(lastDay, day + 2) : day - 1
        default:
            return day
        }
    }

    private static func weekdayOrdinalInMonth(
        weekday: Int,
        day: Int,
        year: Int,
        month: Int,
        calendar: Calendar) -> Int
    {
        guard day > 0 else { return 0 }

        var ordinal = 0
        for candidate in 1...day {
            if self.weekday(year: year, month: month, day: candidate, calendar: calendar) == weekday {
                ordinal += 1
            }
        }
        return ordinal
    }

    private static func isLastWeekdayOccurrence(
        weekday: Int,
        day: Int,
        year: Int,
        month: Int,
        calendar: Calendar) -> Bool
    {
        let lastDay = self.lastDayOfMonth(year: year, month: month, calendar: calendar)
        guard day <= lastDay else { return false }

        if day < lastDay {
            for candidate in (day + 1)...lastDay {
                if self.weekday(year: year, month: month, day: candidate, calendar: calendar) == weekday {
                    return false
                }
            }
        }

        return true
    }

    private static func weekday(year: Int, month: Int, day: Int, calendar: Calendar) -> Int {
        var components = DateComponents()
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        guard let date = calendar.date(from: components) else {
            return 0
        }
        return self.cronWeekday(fromCalendarWeekday: calendar.component(.weekday, from: date))
    }
}
