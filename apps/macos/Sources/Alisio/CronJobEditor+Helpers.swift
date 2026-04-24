import Foundation
import SwiftUI

import AlisioSupport
extension CronJobEditor {
    struct SchedulePreviewSnapshot {
        let week: ScheduleCalendarProjection.JobCoverage
        let month: ScheduleCalendarProjection.JobCoverage
    }

    enum SchedulePreviewState {
        case ready(SchedulePreviewSnapshot)
        case invalid(String)
    }

    func gridLabel(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(.secondary)
            .frame(width: self.labelColumnWidth, alignment: .leading)
    }

    func hydrateFromJob() {
        guard let job else { return }
        self.name = job.name
        self.description = job.description ?? ""
        self.agentId = job.agentId ?? ""
        self.enabled = job.enabled
        self.deleteAfterRun = job.effectiveDeleteAfterRun
        switch job.parsedSessionTarget {
        case let .predefined(target):
            self.sessionTarget = target
            self.preservedSessionTargetRaw = nil
        case let .session(id):
            self.sessionTarget = .isolated
            self.preservedSessionTargetRaw = "session:\(id)"
        }
        self.wakeMode = job.wakeMode

        switch job.schedule {
        case let .at(at):
            self.scheduleKind = .at
            if let date = CronSchedule.parseAtDate(at) {
                self.atDate = date
            }
        case let .every(everyMs, anchorMs):
            self.scheduleKind = .every
            self.everyText = self.formatDuration(ms: everyMs)
            self.everyAnchorMs = anchorMs
        case let .cron(expr, tz, staggerMs):
            self.scheduleKind = .cron
            self.cronExpr = expr
            self.cronTz = tz ?? ""
            self.cronStaggerMs = staggerMs
        }

        switch job.payload {
        case let .systemEvent(text):
            self.payloadKind = .systemEvent
            self.systemEventText = text
        case let .agentTurn(message, thinking, timeoutSeconds, _, _, _, _):
            self.payloadKind = .agentTurn
            self.agentMessage = message
            self.thinking = thinking ?? ""
            self.timeoutSeconds = timeoutSeconds.map(String.init) ?? ""
        }

        if let delivery = job.delivery {
            switch delivery.mode {
            case .announce:
                self.deliveryMode = .announce
            case .webhook:
                self.deliveryMode = .webhook
            case .none:
                self.deliveryMode = .none
            }
            let trimmed = (delivery.channel ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            self.channel = trimmed.isEmpty ? "last" : trimmed
            self.to = delivery.to ?? ""
            self.bestEffortDeliver = delivery.bestEffort ?? false
        } else {
            self.deliveryMode = .none
            self.channel = "last"
            self.to = ""
            self.bestEffortDeliver = false
        }
        if !self.canAnnounceFollowUp, self.deliveryMode == .announce {
            self.deliveryMode = .none
        }
    }

    func save() {
        do {
            self.error = nil
            let request = try self.buildRequest()
            self.onSave(request)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func buildRequest() throws -> [String: AnyCodable] {
        let name = try self.requireName()
        let description = self.trimmed(self.description)
        let agentId = self.trimmed(self.agentId)
        let schedule = try self.buildSchedule()
        let action = try self.buildSelectedAction()

        try self.validateSessionTarget(action)
        try self.validateActionRequiredFields(action)
        try self.validateDelivery()

        var root: [String: Any] = [
            "name": name,
            "enabled": self.enabled,
            "schedule": schedule,
            "sessionTarget": self.effectiveSessionTargetRaw,
            "wakeMode": self.wakeMode.rawValue,
            "payload": action,
        ]
        self.applyDeleteAfterRun(to: &root)
        self.applyStringPatch(
            to: &root,
            key: "description",
            value: description,
            previousValue: self.job?.description,
            emptyReplacement: "")
        self.applyStringPatch(
            to: &root,
            key: "agentId",
            value: agentId,
            previousValue: self.job?.agentId,
            emptyReplacement: NSNull())

        if self.shouldIncludeDeliveryPatch {
            root["delivery"] = self.buildDelivery()
        }

        return root.mapValues { AnyCodable($0) }
    }

    func buildDelivery() -> [String: Any] {
        self.buildDelivery(
            mode: self.deliveryMode,
            channel: self.channel,
            to: self.to,
            bestEffort: self.bestEffortDeliver,
            existingDelivery: self.job?.delivery)
    }

    func buildDelivery(
        mode: DeliveryChoice,
        channel: String,
        to: String,
        bestEffort: Bool,
        existingDelivery: CronDelivery?) -> [String: Any]
    {
        let mode: String = switch mode {
        case .announce:
            "announce"
        case .webhook:
            "webhook"
        case .none:
            "none"
        }
        var delivery: [String: Any] = ["mode": mode]
        let existingDestination = self.trimmed(existingDelivery?.to ?? "")
        if mode == "announce" {
            let trimmed = self.trimmed(channel)
            delivery["channel"] = trimmed.isEmpty ? "last" : trimmed
            let destination = self.trimmed(to)
            if !destination.isEmpty {
                delivery["to"] = destination
            } else if !existingDestination.isEmpty {
                delivery["to"] = ""
            }
            if bestEffort || existingDelivery?.bestEffort != nil {
                delivery["bestEffort"] = bestEffort
            }
        } else if mode == "webhook" {
            if existingDelivery?.channel != nil {
                delivery["channel"] = ""
            }
            let destination = self.trimmed(to)
            if !destination.isEmpty {
                delivery["to"] = destination
            } else if !existingDestination.isEmpty {
                delivery["to"] = ""
            }
            if bestEffort || existingDelivery?.bestEffort != nil {
                delivery["bestEffort"] = bestEffort
            }
        } else {
            if existingDelivery?.channel != nil {
                delivery["channel"] = ""
            }
            if !existingDestination.isEmpty {
                delivery["to"] = ""
            }
            if existingDelivery?.bestEffort != nil {
                delivery["bestEffort"] = false
            }
        }
        return delivery
    }

    func applyStringPatch(
        to root: inout [String: Any],
        key: String,
        value: String,
        previousValue: String?,
        emptyReplacement: Any)
    {
        let trimmed = self.trimmed(value)
        if !trimmed.isEmpty {
            root[key] = trimmed
        } else if previousValue != nil {
            root[key] = emptyReplacement
        }
    }

    func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func requireName() throws -> String {
        let name = self.trimmed(self.name)
        if name.isEmpty {
            throw NSError(
                domain: "Cron",
                code: 0,
                userInfo: [NSLocalizedDescriptionKey: "Name is required."])
        }
        return name
    }

    func buildSchedule() throws -> [String: Any] {
        switch try self.buildScheduleModel() {
        case let .at(at):
            return ["kind": "at", "at": at]
        case let .every(everyMs, anchorMs):
            var schedule: [String: Any] = ["kind": "every", "everyMs": everyMs]
            if let anchorMs {
                schedule["anchorMs"] = anchorMs
            }
            return schedule
        case let .cron(expr, tz, staggerMs):
            var schedule: [String: Any] = ["kind": "cron", "expr": expr]
            if let tz, !tz.isEmpty {
                schedule["tz"] = tz
            }
            if let staggerMs {
                schedule["staggerMs"] = staggerMs
            }
            return schedule
        }
    }

    func buildScheduleModel() throws -> CronSchedule {
        switch self.scheduleKind {
        case .at:
            return .at(at: CronSchedule.formatIsoDate(self.atDate))
        case .every:
            guard let ms = Self.parseDurationMs(self.everyText) else {
                throw NSError(
                    domain: "Cron",
                    code: 0,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid repeat interval. Use values such as 10m, 1h, or 1d."])
            }
            return .every(everyMs: ms, anchorMs: self.everyAnchorMs)
        case .cron:
            let expr = self.trimmed(self.cronExpr)
            if expr.isEmpty {
                throw NSError(
                    domain: "Cron",
                    code: 0,
                    userInfo: [NSLocalizedDescriptionKey: "The custom pattern is required."])
            }
            let tz = self.trimmed(self.cronTz)
            return .cron(
                expr: expr,
                tz: tz.isEmpty ? nil : tz,
                staggerMs: self.cronStaggerMs)
        }
    }

    func buildSelectedAction() throws -> [String: Any] {
        if self.isIsolatedLikeSessionTarget { return self.buildAgentTurnAction() }
        switch self.payloadKind {
        case .systemEvent:
            let text = self.trimmed(self.systemEventText)
            return ["kind": "systemEvent", "text": text]
        case .agentTurn:
            return self.buildAgentTurnAction()
        }
    }

    func validateSessionTarget(_ action: [String: Any]) throws {
        if self.effectiveSessionTargetRaw == "main", action["kind"] as? String == "agentTurn" {
            throw NSError(
                domain: "Cron",
                code: 0,
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "The main chat only accepts notes. Switch to a separate chat to run an agent task.",
                ])
        }

        if self.effectiveSessionTargetRaw != "main", action["kind"] as? String == "systemEvent" {
            throw NSError(
                domain: "Cron",
                code: 0,
                userInfo: [NSLocalizedDescriptionKey: "Separate chats require an agent task."])
        }
    }

    func validateActionRequiredFields(_ action: [String: Any]) throws {
        if action["kind"] as? String == "systemEvent" {
            if (action["text"] as? String ?? "").isEmpty {
                throw NSError(
                    domain: "Cron",
                    code: 0,
                    userInfo: [NSLocalizedDescriptionKey: "The note is required."])
            }
        }
        if action["kind"] as? String == "agentTurn" {
            if (action["message"] as? String ?? "").isEmpty {
                throw NSError(
                    domain: "Cron",
                    code: 0,
                    userInfo: [NSLocalizedDescriptionKey: "The task instructions are required."])
            }
        }
    }

    func validateDelivery() throws {
        if self.deliveryMode == .announce, !self.canAnnounceFollowUp {
            throw NSError(
                domain: "Cron",
                code: 0,
                userInfo: [NSLocalizedDescriptionKey: "Posting a follow-up to chat requires this chat or a separate chat."])
        }
        if self.deliveryMode == .webhook {
            let destination = self.trimmed(self.to)
            if destination.isEmpty {
                throw NSError(
                    domain: "Cron",
                    code: 0,
                    userInfo: [NSLocalizedDescriptionKey: "The follow-up URL is required."])
            }
        }
    }

    func applyDeleteAfterRun(
        to root: inout [String: Any],
        scheduleKind: ScheduleKind? = nil,
        deleteAfterRun: Bool? = nil)
    {
        let resolvedSchedule = scheduleKind ?? self.scheduleKind
        let resolvedDelete = deleteAfterRun ?? self.deleteAfterRun
        if resolvedSchedule == .at {
            root["deleteAfterRun"] = resolvedDelete
        } else if self.job?.deleteAfterRun != nil {
            root["deleteAfterRun"] = false
        }
    }

    func buildAgentTurnAction() -> [String: Any] {
        let msg = self.agentMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        var action: [String: Any] = ["kind": "agentTurn", "message": msg]
        let thinking = self.thinking.trimmingCharacters(in: .whitespacesAndNewlines)
        if !thinking.isEmpty { action["thinking"] = thinking }
        if let n = Int(self.timeoutSeconds), n > 0 { action["timeoutSeconds"] = n }
        return action
    }

    func schedulePreviewState(
        referenceDate: Date = .init(),
        calendar: Calendar = .current) -> SchedulePreviewState
    {
        do {
            return .ready(try self.schedulePreviewSnapshot(referenceDate: referenceDate, calendar: calendar))
        } catch {
            return .invalid(error.localizedDescription)
        }
    }

    func schedulePreviewSnapshot(
        referenceDate: Date = .init(),
        calendar: Calendar = .current) throws -> SchedulePreviewSnapshot
    {
        let previewJob = try self.schedulePreviewJob(referenceDate: referenceDate)
        let weekProjection = ScheduleCalendarProjection.week(
            containing: referenceDate,
            jobs: [previewJob],
            calendar: calendar)
        let monthProjection = ScheduleCalendarProjection.month(
            containing: referenceDate,
            jobs: [previewJob],
            calendar: calendar)
        guard let week = weekProjection.coverage(for: previewJob.id),
              let month = monthProjection.coverage(for: previewJob.id)
        else {
            throw NSError(
                domain: "Cron",
                code: 0,
                userInfo: [NSLocalizedDescriptionKey: "The calendar preview is not available yet."])
        }
        return SchedulePreviewSnapshot(week: week, month: month)
    }

    func schedulePreviewJob(referenceDate: Date = .init()) throws -> CronJob {
        let schedule = try self.buildScheduleModel()
        let nowMs = Int((referenceDate.timeIntervalSince1970 * 1_000).rounded(.down))
        let previewName = self.trimmed(self.name).isEmpty ? "Schedule preview" : self.trimmed(self.name)
        let agentId = self.trimmed(self.agentId)
        let payload: CronPayload
        if self.isIsolatedLikeSessionTarget || self.payloadKind == .agentTurn {
            let message = self.trimmed(self.agentMessage)
            payload = .agentTurn(
                message: message.isEmpty ? "Preview" : message,
                thinking: nil,
                timeoutSeconds: nil,
                deliver: nil,
                channel: nil,
                to: nil,
                bestEffortDeliver: nil)
        } else {
            let note = self.trimmed(self.systemEventText)
            payload = .systemEvent(text: note.isEmpty ? "Preview" : note)
        }

        return CronJob(
            id: self.job?.id ?? "preview-schedule",
            agentId: agentId.isEmpty ? nil : agentId,
            name: previewName,
            description: nil,
            enabled: self.enabled,
            deleteAfterRun: schedule.isOneShot ? self.deleteAfterRun : nil,
            createdAtMs: self.job?.createdAtMs ?? nowMs,
            updatedAtMs: self.job?.updatedAtMs ?? nowMs,
            schedule: schedule,
            sessionTarget: CronCustomSessionTarget.from(self.effectiveSessionTargetRaw),
            wakeMode: self.wakeMode,
            payload: payload,
            delivery: nil,
            state: CronJobState())
    }

    func schedulePreviewSummary(title: String, coverage: ScheduleCalendarProjection.JobCoverage) -> String {
        switch coverage.state {
        case .visible:
            let count = coverage.occurrenceCount
            let noun = count == 1 ? "run" : "runs"
            if let first = coverage.firstOccurrence?.startAt {
                return "\(title) shows \(count) \(noun). First run: \(first.formatted(date: .abbreviated, time: .shortened))."
            }
            return "\(title) shows \(count) \(noun)."
        case .noOccurrencesInRange:
            return "\(title) has no runs for this schedule."
        case let .unsupported(reason):
            return "\(title) cannot place this schedule on the calendar yet. \(reason)"
        }
    }

    func schedulePreviewTint(for coverage: ScheduleCalendarProjection.JobCoverage) -> Color {
        switch coverage.state {
        case .visible, .noOccurrencesInRange:
            .primary
        case .unsupported:
            .orange
        }
    }

    static func parseDurationMs(_ input: String) -> Int? {
        let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return nil }

        let rx = try? NSRegularExpression(pattern: "^(\\d+(?:\\.\\d+)?)(ms|s|m|h|d)$", options: [.caseInsensitive])
        guard let match = rx?.firstMatch(in: raw, range: NSRange(location: 0, length: raw.utf16.count)) else {
            return nil
        }
        func group(_ idx: Int) -> String {
            let range = match.range(at: idx)
            guard let r = Range(range, in: raw) else { return "" }
            return String(raw[r])
        }
        let n = Double(group(1)) ?? 0
        if !n.isFinite || n <= 0 { return nil }
        let unit = group(2).lowercased()
        let factor: Double = switch unit {
        case "ms": 1
        case "s": 1000
        case "m": 60000
        case "h": 3_600_000
        default: 86_400_000
        }
        return Int(floor(n * factor))
    }

    var effectiveSessionTargetRaw: String {
        if self.sessionTarget == .isolated,
           let preserved = self.preservedSessionTargetRaw?.trimmingCharacters(in: .whitespacesAndNewlines),
           !preserved.isEmpty
        {
            return preserved
        }
        return self.sessionTarget.rawValue
    }

    var isIsolatedLikeSessionTarget: Bool {
        self.effectiveSessionTargetRaw != "main"
    }

    var canAnnounceFollowUp: Bool {
        self.isIsolatedLikeSessionTarget
    }

    var shouldIncludeDeliveryPatch: Bool {
        self.isIsolatedLikeSessionTarget || self.deliveryMode != .none || self.job?.delivery != nil
    }

    func formatDuration(ms: Int) -> String {
        DurationFormattingSupport.conciseDuration(ms: ms)
    }
}
