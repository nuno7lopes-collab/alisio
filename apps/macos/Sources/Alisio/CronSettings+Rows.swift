import SwiftUI

import AlisioSupport
extension CronSettings {
    func jobRow(_ job: CronJob, coverage: ScheduleCalendarProjection.JobCoverage?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(job.displayName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                if job.isRunning {
                    StatusPill(text: "running now", tint: .blue)
                } else if !job.enabled {
                    StatusPill(text: "paused", tint: .secondary)
                } else if let next = job.nextRunDate {
                    StatusPill(text: self.nextRunLabel(next), tint: .secondary)
                } else {
                    StatusPill(text: "no next run", tint: .secondary)
                }
            }
            Text(self.scheduleSummary(job.schedule))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(self.compactCoverageSummary(coverage))
                .font(.caption2)
                .foregroundStyle(self.coverageTint(coverage))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                StatusPill(text: self.sessionTargetLabel(job), tint: .secondary)
                StatusPill(text: self.wakeModeLabel(job.wakeMode), tint: .secondary)
                if !job.isRunning, let status = job.state.displayStatus {
                    StatusPill(text: self.statusLabel(status), tint: self.statusTint(status))
                }
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    func jobContextMenu(_ job: CronJob) -> some View {
        Button("Run now") { Task { await self.store.runJob(id: job.id, force: true) } }
            .disabled(job.isRunning)
        if let transcriptSessionKey = job.transcriptSessionKey {
            Button("Open session") {
                AlisioWorkspaceManager.shared.show(sessionKey: transcriptSessionKey)
            }
        }
        Divider()
        Button(job.enabled ? "Pause" : "Resume") {
            Task { await self.store.setJobEnabled(id: job.id, enabled: !job.enabled) }
        }
        Button("Edit…") {
            self.editingJob = job
            self.editorError = nil
            self.showEditor = true
        }
        Divider()
        Button("Delete…", role: .destructive) {
            self.confirmDelete = job
        }
    }

    func detailHeader(
        _ job: CronJob,
        coverage: ScheduleCalendarProjection.JobCoverage?,
        projection: ScheduleCalendarProjection) -> some View
    {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(job.displayName)
                        .font(.title3.weight(.semibold))
                    Text(self.scheduleSummary(job.schedule))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("\(self.rangeLabel()) · \(self.rangeCaption(for: projection))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(self.coverageSummary(coverage))
                        .font(.footnote)
                        .foregroundStyle(self.coverageTint(coverage))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                if job.isRunning {
                    StatusPill(text: "running now", tint: .blue)
                } else if !job.enabled {
                    StatusPill(text: "paused", tint: .secondary)
                } else if let status = job.state.displayStatus {
                    StatusPill(text: self.statusLabel(status), tint: self.statusTint(status))
                }
            }

            self.detailActions(job)
        }
    }

    func detailCard(
        _ job: CronJob,
        coverage: ScheduleCalendarProjection.JobCoverage?,
        projection: ScheduleCalendarProjection,
        calendar _: Calendar) -> some View
    {
        WorkspaceSurfaceCard(padding: 12) {
            VStack(alignment: .leading, spacing: 14) {
                LabeledContent("Status") { Text(self.runStateLabel(job)) }
                LabeledContent("Automatic runs") { Text(job.enabled ? "Active" : "Paused") }
                LabeledContent("Schedule") { Text(self.scheduleSummary(job.schedule)).font(.callout) }
                if job.schedule.isOneShot {
                    LabeledContent("After success") {
                        Text(job.effectiveDeleteAfterRun ? "Delete the schedule" : "Keep the schedule paused")
                    }
                }
                if let desc = job.description, !desc.isEmpty {
                    LabeledContent("Description") { Text(desc).font(.callout) }
                }
                if let agentId = job.agentId, !agentId.isEmpty {
                    LabeledContent("Agent") { Text(agentId) }
                }
                LabeledContent("Conversation") { Text(self.sessionTargetLabel(job)) }
                LabeledContent("Start") { Text(self.wakeModeLabel(job.wakeMode)) }
                LabeledContent("Next run") {
                    if let date = job.nextRunDate {
                        Text(date.formatted(date: .abbreviated, time: .standard))
                    } else {
                        Text("—").foregroundStyle(.secondary)
                    }
                }
                LabeledContent("Last run") {
                    if let date = job.lastRunDate {
                        Text("\(date.formatted(date: .abbreviated, time: .standard)) · \(relativeAge(from: date))")
                    } else {
                        Text("—").foregroundStyle(.secondary)
                    }
                }
                if let status = job.state.displayStatus {
                    LabeledContent("Last status") { Text(self.statusLabel(status)) }
                }
                if let deliveryStatus = job.state.lastDeliveryStatus, !deliveryStatus.isEmpty {
                    LabeledContent("Last follow-up") { Text(self.statusLabel(deliveryStatus)) }
                }
                if let consecutiveErrors = job.state.consecutiveErrors, consecutiveErrors > 1 {
                    LabeledContent("Recent failures") { Text("\(consecutiveErrors) in a row") }
                }
                Divider()
                self.calendarCoverageSection(coverage, projection: projection)
                if let err = job.state.lastError, !err.isEmpty {
                    self.errorBlock(title: "Last run failed", message: err)
                }
                if let deliveryError = job.state.lastDeliveryError, !deliveryError.isEmpty {
                    self.errorBlock(title: "Last follow-up failed", message: deliveryError)
                }
                if let actionError = self.store.actionError(for: job.id) {
                    self.errorBlock(title: "Could not change this schedule", message: actionError)
                }
                Divider()
                self.actionSummary(job)
                Divider()
                self.followUpSummary(job)
                Divider()
                LabeledContent("ID") {
                    Text(job.id)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }

    func runHistoryCard(_ job: CronJob) -> some View {
        WorkspaceSurfaceCard(padding: 12) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("History")
                        .font(.headline)
                    Spacer()
                    Button {
                        Task { await self.store.refreshRuns(jobId: job.id) }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .disabled(self.store.isLoadingRuns(for: job.id))
                }

                let entries = self.store.runEntries(for: job.id)
                let isLoading = self.store.isLoadingRuns(for: job.id)
                let loaded = self.store.hasLoadedRuns(for: job.id)

                if isLoading || !loaded {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text(isLoading ? "Loading recent activity…" : "Preparing recent activity…")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if let error = self.store.runsError(for: job.id), !isLoading {
                    self.errorBlock(title: "Could not load recent activity", message: error)
                } else if entries.isEmpty, !isLoading, loaded {
                    Text(self.store.runsStatusMessage ?? "No recent activity yet.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else if !entries.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(entries) { entry in
                            self.runRow(entry)
                        }
                    }
                }
            }
        }
    }

    func runRow(_ entry: CronRunLogEntry) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                StatusPill(text: self.statusLabel(entry.status), tint: self.statusTint(entry.status))
                if let deliveryStatus = entry.deliveryStatus, !deliveryStatus.isEmpty {
                    StatusPill(
                        text: self.statusLabel(deliveryStatus),
                        tint: self.statusTint(deliveryStatus))
                }
                Text(entry.date.formatted(date: .abbreviated, time: .standard))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if let ms = entry.durationMs {
                    Text(self.formatDuration(ms: ms))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            if let summary = entry.summary, !summary.isEmpty {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .lineLimit(2)
            }
            if let nextRunAtMs = entry.nextRunAtMs {
                let nextRun = Date(timeIntervalSince1970: TimeInterval(nextRunAtMs) / 1000)
                Text("Next run: \(nextRun.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let error = entry.error, !error.isEmpty {
                self.inlineErrorText("Run failed: \(error)")
            }
            if let deliveryError = entry.deliveryError, !deliveryError.isEmpty {
                self.inlineErrorText("Follow-up failed: \(deliveryError)")
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    func detailActions(_ job: CronJob) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                self.detailActiveToggle(job)
                self.runNowButton(job)
                if let transcriptSessionKey = job.transcriptSessionKey {
                    self.openChatButton(transcriptSessionKey)
                }
                self.editButton(job)
                self.deleteButton(job)
            }
            VStack(alignment: .leading, spacing: 8) {
                self.detailActiveToggle(job)
                HStack(spacing: 8) {
                    self.runNowButton(job)
                    if let transcriptSessionKey = job.transcriptSessionKey {
                        self.openChatButton(transcriptSessionKey)
                    }
                    self.editButton(job)
                    self.deleteButton(job)
                }
            }
        }
    }

    func detailActiveToggle(_ job: CronJob) -> some View {
        HStack(spacing: 8) {
            Text(job.enabled ? "Active" : "Paused")
                .font(.caption)
                .foregroundStyle(.secondary)
            Toggle("Active", isOn: Binding(
                get: { job.enabled },
                set: { enabled in Task { await self.store.setJobEnabled(id: job.id, enabled: enabled) } }))
                .toggleStyle(.switch)
                .labelsHidden()
        }
    }

    func runNowButton(_ job: CronJob) -> some View {
        Button(job.isRunning ? "Running" : "Run now") {
            Task { await self.store.runJob(id: job.id, force: true) }
        }
        .buttonStyle(.borderedProminent)
        .disabled(job.isRunning)
    }

    func openChatButton(_ transcriptSessionKey: String) -> some View {
        Button("Open chat") {
            AlisioWorkspaceManager.shared.show(sessionKey: transcriptSessionKey)
        }
        .buttonStyle(.bordered)
    }

    func editButton(_ job: CronJob) -> some View {
        Button("Edit") {
            self.editingJob = job
            self.editorError = nil
            self.showEditor = true
        }
        .buttonStyle(.bordered)
    }

    func deleteButton(_ job: CronJob) -> some View {
        Button("Delete…", role: .destructive) {
            self.confirmDelete = job
        }
        .buttonStyle(.bordered)
    }

    func actionSummary(_ job: CronJob) -> some View {
        let action = job.payload
        return VStack(alignment: .leading, spacing: 6) {
            Text("Action")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            switch action {
            case let .systemEvent(text):
                Text(text)
                    .font(.callout)
                    .textSelection(.enabled)
            case let .agentTurn(message, thinking, timeoutSeconds, _, _, _, _):
                VStack(alignment: .leading, spacing: 4) {
                    Text(message)
                        .font(.callout)
                        .textSelection(.enabled)
                    HStack(spacing: 8) {
                        if let thinking, !thinking.isEmpty {
                            StatusPill(text: "thinking \(thinking)", tint: .secondary)
                        }
                        if let timeoutSeconds {
                            StatusPill(text: "timeout \(timeoutSeconds)s", tint: .secondary)
                        }
                    }
                }
            }
        }
    }

    func followUpSummary(_ job: CronJob) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("After it runs")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                StatusPill(text: self.resultHandlingLabel(job.delivery), tint: .secondary)
                if let destination = self.resultHandlingDestination(job.delivery), !destination.isEmpty {
                    StatusPill(text: destination, tint: .secondary)
                }
                if job.delivery?.bestEffort == true {
                    StatusPill(text: "best effort", tint: .secondary)
                }
            }
        }
    }

    @ViewBuilder
    func calendarCoverageSection(
        _ coverage: ScheduleCalendarProjection.JobCoverage?,
        projection: ScheduleCalendarProjection) -> some View
    {
        VStack(alignment: .leading, spacing: 8) {
            Text("Calendar")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text("\(self.rangeLabel()) · \(self.rangeCaption(for: projection))")
                .font(.footnote)
                .foregroundStyle(.secondary)

            if let coverage {
                switch coverage.state {
                case .visible:
                    Text(self.coverageSummary(coverage))
                        .font(.callout)
                        .fixedSize(horizontal: false, vertical: true)
                    let preview = self.visibleOccurrencePreview(for: coverage)
                    if !preview.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(preview) { occurrence in
                                HStack(spacing: 8) {
                                    Image(systemName: occurrence.isEnabled ? "circle.fill" : "pause.circle")
                                        .font(.system(size: 6))
                                        .foregroundStyle(occurrence.isEnabled ? Color.accentColor : Color.secondary)
                                    Text(self.occurrenceLabel(occurrence))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    let hiddenCount = self.hiddenOccurrenceCount(for: coverage)
                    if hiddenCount > 0 {
                        Text("Showing the first \(preview.count) of \(coverage.occurrenceCount) runs.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                case .noOccurrencesInRange:
                    Text(self.coverageSummary(coverage))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let nextRunAt = coverage.nextRunAt {
                        Text("Next run: \(nextRunAt.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                case .unsupported:
                    Text(self.coverageSummary(coverage))
                        .font(.callout)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                    if let nextRunAt = coverage.nextRunAt {
                        Text("Next scheduled run: \(nextRunAt.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                Text("Calendar coverage is not available yet.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    func coverageTint(_ coverage: ScheduleCalendarProjection.JobCoverage?) -> Color {
        guard let coverage else { return .secondary }
        switch coverage.state {
        case .visible, .noOccurrencesInRange:
            return .secondary
        case .unsupported:
            return .orange
        }
    }

    func errorBlock(title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.orange)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    func inlineErrorText(_ message: String) -> some View {
        Text(message)
            .font(.caption)
            .foregroundStyle(.orange)
            .textSelection(.enabled)
            .lineLimit(2)
    }
}
