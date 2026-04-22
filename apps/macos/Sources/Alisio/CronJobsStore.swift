import Foundation
import Observation
import OSLog

import AlisioSupport
@MainActor
@Observable
final class CronJobsStore {
    static let shared = CronJobsStore()

    var jobs: [CronJob] = []
    var selectedJobId: String?
    var runEntries: [CronRunLogEntry] = []

    var schedulerEnabled: Bool?
    var schedulerStorePath: String?
    var schedulerNextWakeAtMs: Int?

    var isLoadingJobs = false
    var isLoadingRuns = false
    var hasLoadedJobsOnce = false
    var hasLoadedRunsOnce = false
    var lastError: String?
    var statusMessage: String?

    private let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "cron.ui")
    private var refreshTask: Task<Void, Never>?
    private var runsTask: Task<Void, Never>?
    private var eventTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?

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
            self.runEntries = []
            self.lastError = nil
            self.statusMessage = "Sign in to manage schedules."
            self.hasLoadedJobsOnce = true
            self.hasLoadedRunsOnce = true
            return
        case let .unavailable(message):
            self.lastError = message
            self.statusMessage = nil
            self.hasLoadedJobsOnce = true
            return
        }
        self.isLoadingJobs = true
        self.lastError = nil
        self.statusMessage = nil
        defer {
            self.isLoadingJobs = false
            self.hasLoadedJobsOnce = true
        }

        do {
            if let status = try? await GatewayConnection.shared.cronStatus() {
                self.schedulerEnabled = status.enabled
                self.schedulerStorePath = status.storePath
                self.schedulerNextWakeAtMs = status.nextWakeAtMs
            }
            self.jobs = try await GatewayConnection.shared.cronList(includeDisabled: true)
            if self.jobs.isEmpty {
                self.statusMessage = "No schedules exist yet."
            }
        } catch {
            self.logger.error("cron.list failed \(error.localizedDescription, privacy: .public)")
            self.lastError = error.localizedDescription
        }
    }

    func refreshRuns(jobId: String, limit: Int = 200) async {
        guard !self.isLoadingRuns else { return }
        switch await self.accountGate(reason: "cron.runs") {
        case .authenticated:
            break
        case .signedOut:
            self.runEntries = []
            self.lastError = nil
            self.statusMessage = "Sign in to view run history."
            self.hasLoadedRunsOnce = true
            return
        case let .unavailable(message):
            self.lastError = message
            self.statusMessage = nil
            self.hasLoadedRunsOnce = true
            return
        }
        self.isLoadingRuns = true
        defer {
            self.isLoadingRuns = false
            self.hasLoadedRunsOnce = true
        }

        do {
            self.runEntries = try await GatewayConnection.shared.cronRuns(jobId: jobId, limit: limit)
        } catch {
            self.logger.error("cron.runs failed \(error.localizedDescription, privacy: .public)")
            self.lastError = error.localizedDescription
        }
    }

    func runJob(id: String, force: Bool = true) async {
        switch await self.accountGate(reason: "cron.run") {
        case .authenticated:
            break
        case .signedOut:
            self.lastError = "Sign in to run schedules."
            return
        case let .unavailable(message):
            self.lastError = message
            return
        }
        do {
            try await GatewayConnection.shared.cronRun(jobId: id, force: force)
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func removeJob(id: String) async {
        switch await self.accountGate(reason: "cron.remove") {
        case .authenticated:
            break
        case .signedOut:
            self.lastError = "Sign in to delete schedules."
            return
        case let .unavailable(message):
            self.lastError = message
            return
        }
        do {
            try await GatewayConnection.shared.cronRemove(jobId: id)
            await self.refreshJobs()
            if self.selectedJobId == id {
                self.selectedJobId = nil
                self.runEntries = []
                self.hasLoadedRunsOnce = false
            }
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func setJobEnabled(id: String, enabled: Bool) async {
        switch await self.accountGate(reason: "cron.update") {
        case .authenticated:
            break
        case .signedOut:
            self.lastError = "Sign in to edit schedules."
            return
        case let .unavailable(message):
            self.lastError = message
            return
        }
        do {
            try await GatewayConnection.shared.cronUpdate(
                jobId: id,
                patch: ["enabled": AnyCodable(enabled)])
            await self.refreshJobs()
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func upsertJob(
        id: String?,
        payload: [String: AnyCodable]) async throws
    {
        switch await self.accountGate(reason: id == nil ? "cron.add" : "cron.update") {
        case .authenticated:
            break
        case .signedOut:
            throw AlisioAccountRequiredError.signedOut
        case let .unavailable(message):
            throw AlisioAccountRequiredError.unavailable(message)
        }
        if let id {
            try await GatewayConnection.shared.cronUpdate(jobId: id, patch: payload)
        } else {
            try await GatewayConnection.shared.cronAdd(payload: payload)
        }
        await self.refreshJobs()
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
        // Keep UI in sync with the gateway scheduler.
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

    // MARK: - (no additional RPC helpers)
}
