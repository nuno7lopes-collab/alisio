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

        return .empty(self.trimmedStatusMessage ?? "No schedules yet.")
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
        case "running": .blue
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
        case "running":
            "running"
        case "ok":
            "completed"
        case "error":
            "failed"
        case "skipped":
            "skipped"
        case "delivered":
            "delivered"
        case "not-delivered":
            "send failed"
        case "not-requested":
            "not sent"
        case "":
            "unknown"
        default:
            status ?? "unknown"
        }
    }

    func sessionTargetLabel(_ job: CronJob) -> String {
        switch job.parsedSessionTarget {
        case .predefined(.main):
            "Main chat"
        case .predefined(.isolated):
            "Separate chat"
        case .predefined(.current):
            "This chat"
        case let .session(id):
            "Chat \(id)"
        }
    }

    func wakeModeLabel(_ wakeMode: CronWakeMode) -> String {
        switch wakeMode {
        case .now:
            "Immediately"
        case .nextHeartbeat:
            "On wake-up"
        }
    }

    func scheduleSummary(_ schedule: CronSchedule) -> String {
        switch schedule {
        case let .at(at):
            if let date = CronSchedule.parseAtDate(at) {
                return "One time on \(date.formatted(date: .abbreviated, time: .standard))"
            }
            return "One time on \(at)"
        case let .every(everyMs, _):
            return "Every \(self.formatDuration(ms: everyMs))"
        case let .cron(expr, tz, staggerMs):
            var parts = ["Custom pattern \(expr)"]
            if let tz, !tz.isEmpty { parts.append("in \(tz)") }
            if let staggerMs, staggerMs > 0 {
                parts.append("with up to \(self.formatDuration(ms: staggerMs)) spread")
            }
            return parts.joined(separator: " ")
        }
    }

    func runStateLabel(_ job: CronJob) -> String {
        if job.isRunning {
            return "Running now"
        }
        if !job.enabled {
            return "Paused"
        }
        if let status = job.state.displayStatus {
            return self.statusLabel(status)
        }
        return "Scheduled"
    }

    func resultHandlingLabel(_ delivery: CronDelivery?) -> String {
        guard let delivery else { return "No follow-up" }
        switch delivery.mode {
        case .announce:
            return "Post to chat"
        case .webhook:
            return "Send to URL"
        case .none:
            return "No follow-up"
        }
    }

    func resultHandlingDestination(_ delivery: CronDelivery?) -> String? {
        guard let delivery else { return nil }
        switch delivery.mode {
        case .announce:
            let rawChannel = (delivery.channel ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let channel: String
            if rawChannel.isEmpty {
                channel = ""
            } else if rawChannel == "last" {
                channel = "Last used chat"
            } else {
                channel = self.channelsStore.resolveChannelLabel(rawChannel)
            }
            let target = (delivery.to ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if channel.isEmpty, target.isEmpty {
                return "Last used chat"
            }
            if !channel.isEmpty, !target.isEmpty {
                return "\(channel) · \(target)"
            }
            if !channel.isEmpty {
                return channel
            }
            return target.isEmpty ? nil : target
        case .webhook:
            let target = (delivery.to ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return target.isEmpty ? nil : target
        case .none:
            return nil
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
