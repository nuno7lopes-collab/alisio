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

        if let error = self.trimmedJobsError {
            return .error(error)
        }

        return .empty(self.trimmedStatusMessage ?? "No schedules exist yet.")
    }

    var trimmedJobsError: String? {
        let trimmed = self.store.jobsError?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    var trimmedActionError: String? {
        let trimmed = self.store.actionError?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    var trimmedStatusMessage: String? {
        let trimmed = self.store.jobsStatusMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    func statusTint(_ status: String?) -> Color {
        switch (status ?? "").lowercased() {
        case "ok": .green
        case "error": .red
        case "skipped": .orange
        case "delivered": .green
        case "not-delivered": .red
        case "not-requested": .secondary
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
        case "delivered":
            "delivered"
        case "not-delivered":
            "delivery failed"
        case "not-requested":
            "not requested"
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
        case let .cron(expr, tz, staggerMs):
            var parts = ["advanced \(expr)"]
            if let tz, !tz.isEmpty { parts.append("(\(tz))") }
            if let staggerMs, staggerMs > 0 {
                parts.append("stagger \(self.formatDuration(ms: staggerMs))")
            }
            return parts.joined(separator: " ")
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
