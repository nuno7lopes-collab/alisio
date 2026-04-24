import SwiftUI

extension CronSettings {
    func calendarContent(projection: ScheduleCalendarProjection, calendar: Calendar) -> some View {
        HStack(spacing: 12) {
            self.calendarPane(projection: projection, calendar: calendar)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            Divider()

            self.detail(projection: projection, calendar: calendar)
                .frame(width: 400, alignment: .topLeading)
                .frame(maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder
    func calendarPane(projection: ScheduleCalendarProjection, calendar: Calendar) -> some View {
        switch self.listState {
        case .loading:
            WorkspaceStateCard(
                title: "Loading schedules…",
                message: "Checking what is configured on this Mac.",
                systemImage: "calendar.badge.clock",
                showsProgress: true)
        case let .error(message):
            WorkspaceStateCard(
                title: "Schedules could not be loaded.",
                message: message,
                systemImage: "exclamationmark.triangle.fill",
                tone: .caution,
                actionTitle: "Try again")
            {
                Task { await self.store.refreshJobs() }
            }
        case let .empty(message):
            WorkspaceStateCard(
                title: message,
                message: message.hasPrefix("Sign in")
                    ? "After you sign in, this account's schedules appear here."
                    : "Create the first schedule to see it on the calendar.",
                systemImage: message.hasPrefix("Sign in") ? "person.crop.circle.badge.exclamationmark" : "calendar.badge.plus",
                actionTitle: message.hasPrefix("Sign in") ? nil : "New schedule")
            {
                guard !message.hasPrefix("Sign in") else { return }
                self.editorError = nil
                self.editingJob = nil
                self.showEditor = true
            }
        case .list:
            VStack(alignment: .leading, spacing: 10) {
                self.calendarControls(projection: projection)

                if !projection.unsupportedSchedules.isEmpty {
                    ScheduleUnsupportedList(
                        schedules: projection.unsupportedSchedules,
                        onSelectJob: self.openCalendarJob)
                }

                if projection.occurrences.isEmpty, projection.unsupportedSchedules.isEmpty {
                    Text("No runs fall inside this range.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                switch self.displayMode {
                case .list:
                    EmptyView()
                case .week:
                    ScheduleWeekCalendarGrid(
                        projection: projection,
                        calendar: calendar,
                        selectedJobId: self.store.selectedJobId,
                        onSelect: self.openCalendarOccurrence)
                case .month:
                    ScheduleMonthCalendarGrid(
                        projection: projection,
                        calendar: calendar,
                        selectedJobId: self.store.selectedJobId,
                        onSelect: self.openCalendarOccurrence)
                }
            }
        }
    }

    func calendarControls(projection: ScheduleCalendarProjection) -> some View {
        HStack(spacing: 8) {
            Button {
                self.moveCalendar(by: -1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.bordered)
            .help(self.displayMode == .week ? "Previous week" : "Previous month")

            Button("Today") {
                self.calendarReferenceDate = Date()
            }
            .buttonStyle(.bordered)

            Button {
                self.moveCalendar(by: 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.bordered)
            .help(self.displayMode == .week ? "Next week" : "Next month")

            Text(self.calendarTitle(for: projection))
                .font(.headline)
                .lineLimit(1)

            Spacer()

            let shownCount = projection.occurrences.count
            let reviewCount = projection.unsupportedSchedules.count
            Text(reviewCount == 0 ? "\(shownCount) runs" : "\(shownCount) runs · \(reviewCount) need review")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    func moveCalendar(by value: Int) {
        let component: Calendar.Component = self.displayMode == .week ? .weekOfYear : .month
        self.calendarReferenceDate = Calendar.current.date(
            byAdding: component,
            value: value,
            to: self.calendarReferenceDate) ?? self.calendarReferenceDate
    }

    func calendarTitle(for projection: ScheduleCalendarProjection) -> String {
        self.rangeCaption(for: projection, mode: self.displayMode)
    }

    func openCalendarOccurrence(_ occurrence: ScheduleCalendarProjection.Occurrence) {
        self.openCalendarJob(id: occurrence.jobId)
    }

    func openCalendarJob(id: String) {
        guard self.store.jobs.contains(where: { $0.id == id }) else { return }
        self.store.selectJob(id)
    }
}

private struct ScheduleUnsupportedList: View {
    let schedules: [ScheduleCalendarProjection.UnsupportedSchedule]
    let onSelectJob: (String) -> Void

    var body: some View {
        WorkspaceSurfaceCard(padding: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Calendar review")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text("These schedules stay available in the list, but the calendar cannot place them clearly in this range yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(self.schedules) { schedule in
                    Button {
                        self.onSelectJob(schedule.jobId)
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(schedule.jobName)
                                        .font(.caption.weight(.semibold))
                                        .lineLimit(1)
                                    if !schedule.isEnabled {
                                        StatusPill(text: "paused", tint: .secondary)
                                    }
                                }
                                Text(schedule.reason)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                if let nextRunAt = schedule.nextRunAt {
                                    Text("Next run: \(nextRunAt.formatted(date: .abbreviated, time: .standard))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct ScheduleWeekCalendarGrid: View {
    let projection: ScheduleCalendarProjection
    let calendar: Calendar
    let selectedJobId: String?
    let onSelect: (ScheduleCalendarProjection.Occurrence) -> Void

    private var columns: [GridItem] {
        [GridItem(.fixed(54), spacing: 6)]
            + Array(repeating: GridItem(.flexible(minimum: 78), spacing: 6), count: self.projection.days.count)
    }

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            LazyVGrid(columns: self.columns, alignment: .leading, spacing: 6) {
                Text("")
                ForEach(self.projection.days) { day in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(day.start.formatted(.dateTime.weekday(.abbreviated)))
                            .font(.caption.weight(.semibold))
                        Text(day.start.formatted(.dateTime.month(.abbreviated).day()))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                ForEach(0..<24, id: \.self) { hour in
                    Text(Self.hourLabel(hour))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(height: 58, alignment: .topLeading)

                    ForEach(self.projection.days) { day in
                        self.hourCell(day: day, hour: hour)
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func hourCell(day: ScheduleCalendarProjection.Day, hour: Int) -> some View {
        let occurrences = day.occurrences.filter { occurrence in
            self.calendar.component(.hour, from: occurrence.startAt) == hour
        }
        return VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(occurrences.prefix(3))) { occurrence in
                ScheduleOccurrenceButton(
                    occurrence: occurrence,
                    calendar: self.calendar,
                    selected: occurrence.jobId == self.selectedJobId,
                    onSelect: self.onSelect)
            }
            if occurrences.count > 3 {
                Text("+\(occurrences.count - 3) more")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .topLeading)
        .padding(4)
        .background(Color.secondary.opacity(0.04))
        .cornerRadius(6)
    }

    private static func hourLabel(_ hour: Int) -> String {
        String(format: "%02d:00", hour)
    }
}

private struct ScheduleMonthCalendarGrid: View {
    let projection: ScheduleCalendarProjection
    let calendar: Calendar
    let selectedJobId: String?
    let onSelect: (ScheduleCalendarProjection.Occurrence) -> Void

    private let columns = Array(repeating: GridItem(.flexible(minimum: 86), spacing: 6), count: 7)

    private var weekdaySymbols: [String] {
        let symbols = self.calendar.shortWeekdaySymbols
        let start = max(0, self.calendar.firstWeekday - 1)
        return Array(symbols[start..<symbols.count]) + Array(symbols[0..<start])
    }

    private var cells: [ScheduleCalendarProjection.Day?] {
        guard let first = self.projection.days.first else { return [] }
        let weekday = self.calendar.component(.weekday, from: first.start)
        let leading = (weekday - self.calendar.firstWeekday + 7) % 7
        let baseCells = Array(repeating: nil, count: leading) + self.projection.days.map(Optional.some)
        let trailing = (7 - (baseCells.count % 7)) % 7
        return baseCells + Array(repeating: nil, count: trailing)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(columns: self.columns, alignment: .leading, spacing: 6) {
                ForEach(self.weekdaySymbols, id: \.self) { symbol in
                    Text(symbol)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }

            ScrollView(.vertical) {
                LazyVGrid(columns: self.columns, alignment: .leading, spacing: 6) {
                    ForEach(self.cells.indices, id: \.self) { index in
                        if let day = self.cells[index] {
                            self.dayCell(day)
                        } else {
                            Color.clear.frame(minHeight: 92)
                        }
                    }
                }
            }
        }
    }

    private func dayCell(_ day: ScheduleCalendarProjection.Day) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(day.start.formatted(.dateTime.day()))
                    .font(.caption.weight(.semibold))
                Spacer()
                if day.occurrences.count > 3 {
                    Text("\(day.occurrences.count)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            ForEach(Array(day.occurrences.prefix(3))) { occurrence in
                ScheduleOccurrenceButton(
                    occurrence: occurrence,
                    calendar: self.calendar,
                    selected: occurrence.jobId == self.selectedJobId,
                    onSelect: self.onSelect)
            }

            if day.occurrences.count > 3 {
                Text("+\(day.occurrences.count - 3) more")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
        .padding(6)
        .background(Color.secondary.opacity(0.04))
        .cornerRadius(6)
    }
}

private struct ScheduleOccurrenceButton: View {
    let occurrence: ScheduleCalendarProjection.Occurrence
    let calendar: Calendar
    let selected: Bool
    let onSelect: (ScheduleCalendarProjection.Occurrence) -> Void

    var body: some View {
        Button {
            self.onSelect(self.occurrence)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: self.occurrence.isEnabled ? "circle.fill" : "pause.circle")
                    .font(.system(size: 7))
                    .foregroundStyle(self.occurrence.isEnabled ? Color.accentColor : Color.secondary)
                Text(self.timeLabel)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                Text(self.occurrence.jobName)
                    .font(.caption2.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .background(self.selected ? Color.accentColor.opacity(0.16) : Color.clear)
            .cornerRadius(5)
            .opacity(self.occurrence.isEnabled ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .help("\(self.occurrence.jobName) at \(self.fullTimeLabel)")
    }

    private var timeLabel: String {
        let components = self.calendar.dateComponents([.hour, .minute, .second, .nanosecond], from: self.occurrence.startAt)
        let hour = components.hour ?? 0
        let minute = components.minute ?? 0
        let second = components.second ?? 0
        let millisecond = max(0, (components.nanosecond ?? 0) / 1_000_000)
        if millisecond > 0 {
            return String(format: "%02d:%02d:%02d.%03d", hour, minute, second, millisecond)
        }
        if second > 0 {
            return String(format: "%02d:%02d:%02d", hour, minute, second)
        }
        return String(format: "%02d:%02d", hour, minute)
    }

    private var fullTimeLabel: String {
        self.occurrence.startAt.formatted(date: .abbreviated, time: .standard)
    }
}
