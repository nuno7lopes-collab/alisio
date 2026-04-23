import SwiftUI

import AlisioSupport
extension CronSettings {
    func jobRow(_ job: CronJob) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(job.displayName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                if !job.enabled {
                    StatusPill(text: "paused", tint: .secondary)
                } else if let next = job.nextRunDate {
                    StatusPill(text: self.nextRunLabel(next), tint: .secondary)
                } else {
                    StatusPill(text: "no next run", tint: .secondary)
                }
            }
            HStack(spacing: 6) {
                StatusPill(text: self.sessionTargetLabel(job), tint: .secondary)
                StatusPill(text: self.wakeModeLabel(job.wakeMode), tint: .secondary)
                if let agentId = job.agentId, !agentId.isEmpty {
                    StatusPill(text: "agent \(agentId)", tint: .secondary)
                }
                if let status = job.state.displayStatus {
                    StatusPill(text: self.statusLabel(status), tint: self.statusTint(status))
                }
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    func jobContextMenu(_ job: CronJob) -> some View {
        Button("Run now") { Task { await self.store.runJob(id: job.id, force: true) } }
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

    func detailHeader(_ job: CronJob) -> some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Text(job.displayName)
                    .font(.title3.weight(.semibold))
                Text(job.id)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Text(job.enabled ? "Active" : "Paused")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Toggle("Active", isOn: Binding(
                        get: { job.enabled },
                        set: { enabled in Task { await self.store.setJobEnabled(id: job.id, enabled: enabled) } }))
                        .toggleStyle(.switch)
                        .labelsHidden()
                }
                Button("Run now") { Task { await self.store.runJob(id: job.id, force: true) } }
                    .buttonStyle(.borderedProminent)
                if let transcriptSessionKey = job.transcriptSessionKey {
                    Button("Session") {
                        AlisioWorkspaceManager.shared.show(sessionKey: transcriptSessionKey)
                    }
                    .buttonStyle(.bordered)
                }
                Button("Edit") {
                    self.editingJob = job
                    self.editorError = nil
                    self.showEditor = true
                }
                .buttonStyle(.bordered)
            }
        }
    }

    func detailCard(_ job: CronJob) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LabeledContent("Status") { Text(job.enabled ? "Active" : "Paused") }
            LabeledContent("Schedule") { Text(self.scheduleSummary(job.schedule)).font(.callout) }
            if case .at = job.schedule, job.deleteAfterRun == true {
                LabeledContent("Delete after run") { Text("yes") }
            }
            if let desc = job.description, !desc.isEmpty {
                LabeledContent("Description") { Text(desc).font(.callout) }
            }
            if let agentId = job.agentId, !agentId.isEmpty {
                LabeledContent("Agent") { Text(agentId) }
            }
            LabeledContent("Session") { Text(self.sessionTargetLabel(job)) }
            LabeledContent("Wake mode") { Text(self.wakeModeLabel(job.wakeMode)) }
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
                LabeledContent("Last delivery") { Text(self.statusLabel(deliveryStatus)) }
            }
            if let err = job.state.lastError, !err.isEmpty {
                self.errorBlock(title: "Last run error", message: err)
            }
            if let deliveryError = job.state.lastDeliveryError, !deliveryError.isEmpty {
                self.errorBlock(title: "Last delivery error", message: deliveryError)
            }
            if let actionError = self.store.actionError(for: job.id) {
                self.errorBlock(title: "Schedule action failed", message: actionError)
            }
            self.actionSummary(job)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.secondary.opacity(0.06))
        .cornerRadius(8)
    }

    func runHistoryCard(_ job: CronJob) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Recent activity")
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

            if isLoading {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading recent activity…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if let error = self.store.runsError(for: job.id), !isLoading {
                self.errorBlock(title: "Activity could not be loaded", message: error)
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.secondary.opacity(0.06))
        .cornerRadius(8)
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
                    Text("\(ms)ms")
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
            if let error = entry.error, !error.isEmpty {
                self.inlineErrorText("Run error: \(error)")
            }
            if let deliveryError = entry.deliveryError, !deliveryError.isEmpty {
                self.inlineErrorText("Delivery error: \(deliveryError)")
            }
        }
        .padding(.vertical, 4)
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
                        if job.supportsAnnounceDelivery {
                            let delivery = job.delivery
                            if let delivery {
                                if delivery.mode == .announce {
                                    StatusPill(text: "announce", tint: .secondary)
                                    if let channel = delivery.channel, !channel.isEmpty {
                                        StatusPill(text: channel, tint: .secondary)
                                    }
                                    if let to = delivery.to, !to.isEmpty { StatusPill(text: to, tint: .secondary) }
                                } else {
                                    StatusPill(text: "no delivery", tint: .secondary)
                                }
                            }
                        }
                    }
                }
            }
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
