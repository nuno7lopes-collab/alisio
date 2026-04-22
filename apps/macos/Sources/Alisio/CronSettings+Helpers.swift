import SwiftUI

import AlisioSupport
extension CronSettings {
    var listState: ListState {
        if !self.store.jobs.isEmpty {
            return .list
        }

        if self.store.isLoadingJobs || !self.store.hasLoadedJobsOnce {
            return .loading
        }

        if let error = self.trimmedLastError {
            return .error(error)
        }

        return .empty(self.trimmedStatusMessage ?? "No schedules exist yet.")
    }

    var selectedJob: CronJob? {
        guard let id = self.store.selectedJobId else { return nil }
        return self.store.jobs.first(where: { $0.id == id })
    }

    var trimmedLastError: String? {
        let trimmed = self.store.lastError?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    var trimmedStatusMessage: String? {
        let trimmed = self.store.statusMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    func ensureSelection() {
        guard !self.store.jobs.isEmpty else {
            self.store.selectedJobId = nil
            self.store.runEntries = []
            self.store.hasLoadedRunsOnce = false
            return
        }

        if let selectedJobId = self.store.selectedJobId,
           self.store.jobs.contains(where: { $0.id == selectedJobId })
        {
            return
        }

        self.store.selectedJobId = self.store.jobs.first?.id
    }

    func statusTint(_ status: String?) -> Color {
        switch (status ?? "").lowercased() {
        case "ok": .green
        case "error": .red
        case "skipped": .orange
        default: .secondary
        }
    }

    func statusLabel(_ status: String?) -> String {
        switch (status ?? "").lowercased() {
        case "ok":
            "ok"
        case "error":
            "error"
        case "skipped":
            "skipped"
        case "":
            "unknown"
        default:
            status ?? "unknown"
        }
    }

    func sessionTargetLabel(_ job: CronJob) -> String {
        switch job.parsedSessionTarget {
        case .predefined(.main):
            "main"
        case .predefined(.isolated):
            "isolated"
        case .predefined(.current):
            "current"
        case let .session(id):
            "session \(id)"
        }
    }

    func wakeModeLabel(_ wakeMode: CronWakeMode) -> String {
        switch wakeMode {
        case .now:
            "now"
        case .nextHeartbeat:
            "next heartbeat"
        }
    }

    func scheduleSummary(_ schedule: CronSchedule) -> String {
        switch schedule {
        case let .at(at):
            if let date = CronSchedule.parseAtDate(at) {
                return "once at \(date.formatted(date: .abbreviated, time: .standard))"
            }
            return "once at \(at)"
        case let .every(everyMs, _):
            return "every \(self.formatDuration(ms: everyMs))"
        case let .cron(expr, tz):
            if let tz, !tz.isEmpty { return "cron \(expr) (\(tz))" }
            return "cron \(expr)"
        }
    }

    func formatDuration(ms: Int) -> String {
        DurationFormattingSupport.conciseDuration(ms: ms)
    }

    func nextRunLabel(_ date: Date, now: Date = .init()) -> String {
        let delta = date.timeIntervalSince(now)
        if delta <= 0 { return "now" }
        if delta < 60 { return "in <1 min" }
        let minutes = Int(round(delta / 60))
        if minutes < 60 { return "in \(minutes) min" }
        let hours = Int(round(Double(minutes) / 60))
        if hours < 48 { return "in \(hours) h" }
        let days = Int(round(Double(hours) / 24))
        return "in \(days) d"
    }
}
