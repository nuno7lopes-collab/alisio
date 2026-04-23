import Foundation
import Observation
import OSLog

import AlisioSupport
@MainActor
@Observable
final class CronJobsStore {
    static let shared = CronJobsStore()

    private struct UserVisibleCronError: LocalizedError {
        let message: String

        var errorDescription: String? {
            self.message
        }
    }

    var jobs: [CronJob] = []
    var selectedJobId: String?
    var runEntries: [CronRunLogEntry] = []
    var loadedRunsJobId: String?

    var automaticRunsEnabled: Bool?

    var isLoadingJobs = false
    var isLoadingRuns = false
    var loadingRunsJobId: String?
    var hasLoadedJobsOnce = false
    var hasLoadedRunsOnce = false
    var jobsError: String?
    var runsError: String?
    var runsErrorJobId: String?
    var actionError: String?
    var actionErrorJobId: String?
    var jobsStatusMessage: String?
    var runsStatusMessage: String?

    private let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "cron.ui")
    private var refreshTask: Task<Void, Never>?
    private var runsTask: Task<Void, Never>?
    private var eventTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var currentRunsRefreshToken: UUID?

    private let interval: TimeInterval = 30
    private let isPreview: Bool

    init(isPreview: Bool = ProcessInfo.processInfo.isPreview) {
        self.isPreview = isPreview
    }

    private enum AccountGate {
        case authenticated
        case signedOut
        case unavailable(String)
    }

    func start() {
        guard !self.isPreview else { return }
        guard self.eventTask == nil else { return }
        GatewayPushSubscription.restartTask(task: &self.eventTask) { [weak self] push in
            self?.handle(push: push)
        }
        self.pollTask = Task.detached { [weak self] in
            guard let self else { return }
            await self.refreshJobs()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(self.interval * 1_000_000_000))
                await self.refreshJobs()
            }
        }
    }

    func stop() {
        self.refreshTask?.cancel()
        self.refreshTask = nil
        self.runsTask?.cancel()
        self.runsTask = nil
        self.eventTask?.cancel()
        self.eventTask = nil
        self.pollTask?.cancel()
        self.pollTask = nil
    }

    func refreshJobs() async {
        guard !self.isLoadingJobs else { return }
        switch await self.accountGate(reason: "cron.list") {
        case .authenticated:
            break
        case .signedOut:
            self.jobs = []
            self.clearRunHistory()
            self.automaticRunsEnabled = nil
            self.jobsError = nil
            self.jobsStatusMessage = "Sign in to manage schedules."
            self.hasLoadedJobsOnce = true
            self.reconcileSelection()
            return
        case let .unavailable(message):
            self.automaticRunsEnabled = nil
            self.jobsError = message
            self.jobsStatusMessage = nil
            self.hasLoadedJobsOnce = true
            self.reconcileSelection()
            return
        }
        self.isLoadingJobs = true
        self.jobsError = nil
        self.jobsStatusMessage = nil
        defer {
            self.isLoadingJobs = false
            self.hasLoadedJobsOnce = true
            self.reconcileSelection()
        }

        do {
            if let status = try? await GatewayConnection.shared.cronStatus() {
                self.automaticRunsEnabled = status.enabled
            }
            self.jobs = Self.sortedJobs(try await GatewayConnection.shared.cronList(includeDisabled: true))
            if self.jobs.isEmpty {
                self.jobsStatusMessage = "No schedules yet."
            }
        } catch {
            self.logger.error("cron.list failed \(error.localizedDescription, privacy: .public)")
            self.jobsError = self.gatewayErrorMessage(error)
        }
    }

    func refreshRuns(jobId: String, limit: Int = 200) async {
        let jobId = jobId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !jobId.isEmpty else { return }
        if self.isLoadingRuns, self.loadingRunsJobId == jobId { return }

        let token = UUID()
        self.currentRunsRefreshToken = token
        self.loadingRunsJobId = jobId
        self.isLoadingRuns = true
        self.runsError = nil
        self.runsErrorJobId = nil
        self.runsStatusMessage = nil

        switch await self.accountGate(reason: "cron.runs") {
        case .authenticated:
            break
        case .signedOut:
            self.applyRunsResult(
                token: token,
                jobId: jobId,
                entries: [],
                error: nil,
                message: "Sign in to view schedule activity.")
            self.finishRunsRefresh(token: token, jobId: jobId)
            return
        case let .unavailable(message):
            self.applyRunsResult(token: token, jobId: jobId, entries: [], error: message, message: nil)
            self.finishRunsRefresh(token: token, jobId: jobId)
            return
        }
        defer {
            self.finishRunsRefresh(token: token, jobId: jobId)
        }

        do {
            let entries = try await GatewayConnection.shared.cronRuns(jobId: jobId, limit: limit)
            self.applyRunsResult(token: token, jobId: jobId, entries: entries, error: nil, message: nil)
        } catch {
            self.logger.error("cron.runs failed \(error.localizedDescription, privacy: .public)")
            self.applyRunsResult(
                token: token,
                jobId: jobId,
                entries: [],
                error: self.gatewayErrorMessage(error),
                message: nil)
        }
    }

    func runJob(id: String, force: Bool = true) async {
        switch await self.accountGate(reason: "cron.run") {
        case .authenticated:
            break
        case .signedOut:
            self.actionError = "Sign in to run schedules."
            self.actionErrorJobId = id
            return
        case let .unavailable(message):
            self.actionError = message
            self.actionErrorJobId = id
            return
        }
        do {
            self.actionError = nil
            self.actionErrorJobId = nil
            try await GatewayConnection.shared.cronRun(jobId: id, force: force)
            self.scheduleRefresh(delayMs: 150)
            self.scheduleRunsRefresh(jobId: id, delayMs: 500)
        } catch {
            self.actionError = "Could not run schedule: \(self.gatewayErrorMessage(error))"
            self.actionErrorJobId = id
        }
    }

    func removeJob(id: String) async {
        switch await self.accountGate(reason: "cron.remove") {
        case .authenticated:
            break
        case .signedOut:
            self.actionError = "Sign in to delete schedules."
            self.actionErrorJobId = id
            return
        case let .unavailable(message):
            self.actionError = message
            self.actionErrorJobId = id
            return
        }
        do {
            self.actionError = nil
            self.actionErrorJobId = nil
            try await GatewayConnection.shared.cronRemove(jobId: id)
            self.jobs.removeAll { $0.id == id }
            if self.selectedJobId == id {
                self.selectJob(nil)
            }
            await self.refreshJobs()
        } catch {
            self.actionError = "Could not delete schedule: \(self.gatewayErrorMessage(error))"
            self.actionErrorJobId = id
        }
    }

    func setJobEnabled(id: String, enabled: Bool) async {
        switch await self.accountGate(reason: "cron.update") {
        case .authenticated:
            break
        case .signedOut:
            self.actionError = "Sign in to edit schedules."
            self.actionErrorJobId = id
            return
        case let .unavailable(message):
            self.actionError = message
            self.actionErrorJobId = id
            return
        }
        do {
            self.actionError = nil
            self.actionErrorJobId = nil
            let job = try await GatewayConnection.shared.cronUpdate(
                jobId: id,
                patch: ["enabled": AnyCodable(enabled)])
            self.upsertLocalJob(job)
            self.selectJob(job.id)
            await self.refreshJobs()
        } catch {
            let verb = enabled ? "resume" : "pause"
            self.actionError = "Could not \(verb) schedule: \(self.gatewayErrorMessage(error))"
            self.actionErrorJobId = id
        }
    }

    func upsertJob(
        id: String?,
        request: [String: AnyCodable]) async throws
    {
        switch await self.accountGate(reason: id == nil ? "cron.add" : "cron.update") {
        case .authenticated:
            break
        case .signedOut:
            throw UserVisibleCronError(
                message: id == nil ? "Sign in to create schedules." : "Sign in to edit schedules.")
        case let .unavailable(message):
            throw UserVisibleCronError(message: message)
        }
        self.actionError = nil
        self.actionErrorJobId = nil
        do {
            let job: CronJob
            if let id {
                job = try await GatewayConnection.shared.cronUpdate(jobId: id, patch: request)
            } else {
                job = try await GatewayConnection.shared.cronAdd(request: request)
            }
            self.upsertLocalJob(job)
            self.selectJob(job.id)
            await self.refreshJobs()
        } catch {
            let message = id == nil ? "Could not create schedule" : "Could not save schedule"
            throw UserVisibleCronError(message: "\(message): \(self.gatewayErrorMessage(error))")
        }
    }

    var selectedJob: CronJob? {
        guard let selectedJobId else { return nil }
        return self.jobs.first(where: { $0.id == selectedJobId })
    }

    func selectJob(_ id: String?) {
        if self.selectedJobId == id {
            if id == nil {
                self.clearRunHistory()
            }
            return
        }
        self.selectedJobId = id
        self.clearRunHistory()
    }

    func reconcileSelection(preferredJobId: String? = nil) {
        guard !self.jobs.isEmpty else {
            self.selectJob(nil)
            return
        }

        if let preferredJobId, self.jobs.contains(where: { $0.id == preferredJobId }) {
            self.selectJob(preferredJobId)
            return
        }

        if let selectedJobId, self.jobs.contains(where: { $0.id == selectedJobId }) {
            return
        }

        self.selectJob(self.jobs.first?.id)
    }

    func runEntries(for jobId: String) -> [CronRunLogEntry] {
        guard self.loadedRunsJobId == jobId else { return [] }
        return self.runEntries.filter { $0.jobId == jobId }
    }

    func isLoadingRuns(for jobId: String) -> Bool {
        self.isLoadingRuns && self.loadingRunsJobId == jobId
    }

    func hasLoadedRuns(for jobId: String) -> Bool {
        self.hasLoadedRunsOnce && self.loadedRunsJobId == jobId
    }

    func runsError(for jobId: String) -> String? {
        guard self.runsErrorJobId == jobId else { return nil }
        let trimmed = self.runsError?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    func actionError(for jobId: String) -> String? {
        guard self.actionErrorJobId == jobId else { return nil }
        let trimmed = self.actionError?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    func clearRunHistory() {
        self.currentRunsRefreshToken = nil
        self.runsTask?.cancel()
        self.runsTask = nil
        self.loadingRunsJobId = nil
        self.loadedRunsJobId = nil
        self.isLoadingRuns = false
        self.hasLoadedRunsOnce = false
        self.runEntries = []
        self.runsError = nil
        self.runsErrorJobId = nil
        self.runsStatusMessage = nil
    }

    private func upsertLocalJob(_ job: CronJob) {
        if let index = self.jobs.firstIndex(where: { $0.id == job.id }) {
            self.jobs[index] = job
        } else {
            self.jobs.append(job)
        }
        self.jobs = Self.sortedJobs(self.jobs)
    }

    private func applyRunsResult(
        token: UUID,
        jobId: String,
        entries: [CronRunLogEntry],
        error: String?,
        message: String?)
    {
        guard self.shouldApplyRunsRefresh(token: token, jobId: jobId) else { return }
        self.loadedRunsJobId = jobId
        self.runEntries = entries
            .filter { $0.jobId == jobId }
            .sorted { lhs, rhs in
                if lhs.ts != rhs.ts { return lhs.ts > rhs.ts }
                return lhs.id > rhs.id
            }
        self.runsError = error
        self.runsErrorJobId = error == nil ? nil : jobId
        self.runsStatusMessage = message
        if error == nil, message == nil, self.runEntries.isEmpty {
            self.runsStatusMessage = "No recent activity yet."
        }
    }

    private func finishRunsRefresh(token: UUID, jobId: String) {
        guard self.currentRunsRefreshToken == token else { return }
        self.isLoadingRuns = false
        self.loadingRunsJobId = nil
        self.hasLoadedRunsOnce = true
        if self.loadedRunsJobId == nil {
            self.loadedRunsJobId = jobId
        }
    }

    private func shouldApplyRunsRefresh(token: UUID, jobId: String) -> Bool {
        guard self.currentRunsRefreshToken == token else { return false }
        guard let selectedJobId else { return true }
        return selectedJobId == jobId
    }

    private func gatewayErrorMessage(_ error: Error) -> String {
        if let response = error as? GatewayResponseError {
            if response.code == ErrorCode.invalidRequest.rawValue {
                return response.message
            }
            return "[\(response.code)] \(response.message)"
        }
        if let decoding = error as? GatewayDecodingError {
            return "Could not read gateway response: \(decoding.message)"
        }
        let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Unknown gateway error." : trimmed
    }

    // MARK: - Gateway events

    private func handle(push: GatewayPush) {
        switch push {
        case let .event(evt) where evt.event == "cron":
            guard let payload = evt.payload else { return }
            if let cronEvt = try? GatewayPayloadDecoding.decode(payload, as: CronEvent.self) {
                self.handle(cronEvent: cronEvt)
            }
        case .seqGap:
            self.scheduleRefresh()
        default:
            break
        }
    }

    private func handle(cronEvent evt: CronEvent) {
        // Keep the UI in sync with automatic runs in the gateway.
        self.scheduleRefresh(delayMs: 250)
        if evt.action == "finished", let selected = self.selectedJobId, selected == evt.jobId {
            self.scheduleRunsRefresh(jobId: selected, delayMs: 200)
        }
    }

    private func scheduleRefresh(delayMs: Int = 250) {
        self.refreshTask?.cancel()
        self.refreshTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
            await self.refreshJobs()
        }
    }

    private func scheduleRunsRefresh(jobId: String, delayMs: Int = 200) {
        self.runsTask?.cancel()
        self.runsTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
            await self.refreshRuns(jobId: jobId)
        }
    }

    private func accountGate(reason: String) async -> AccountGate {
        do {
            _ = try await AlisioAccountStore.shared.requireAuthenticated(reason: reason)
            return .authenticated
        } catch let error as AlisioAccountRequiredError {
            switch error {
            case .signedOut:
                return .signedOut
            case let .unavailable(message):
                return .unavailable(message)
            }
        } catch {
            return .unavailable(error.localizedDescription)
        }
    }

    private static func sortedJobs(_ jobs: [CronJob]) -> [CronJob] {
        jobs.sorted { lhs, rhs in
            if lhs.isRunning != rhs.isRunning {
                return lhs.isRunning && !rhs.isRunning
            }
            if lhs.enabled != rhs.enabled {
                return lhs.enabled && !rhs.enabled
            }
            let leftNext = lhs.state.nextRunAtMs ?? Int.max
            let rightNext = rhs.state.nextRunAtMs ?? Int.max
            if leftNext != rightNext {
                return leftNext < rightNext
            }
            let leftName = lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName)
            if leftName != .orderedSame {
                return leftName == .orderedAscending
            }
            return lhs.id < rhs.id
        }
    }

    // MARK: - (no additional RPC helpers)
}
