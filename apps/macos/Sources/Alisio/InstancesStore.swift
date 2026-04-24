import Cocoa
import Foundation
import Observation
import OSLog

import AlisioSupport
struct InstanceInfo: Identifiable, Codable {
    let id: String
    let host: String?
    let ip: String?
    let version: String?
    let platform: String?
    let deviceFamily: String?
    let modelIdentifier: String?
    let lastInputSeconds: Int?
    let mode: String?
    let reason: String?
    let text: String
    let ts: Double

    var ageDescription: String {
        let date = Date(timeIntervalSince1970: ts / 1000)
        return age(from: date)
    }

    var lastInputDescription: String {
        guard let secs = lastInputSeconds else { return "unknown" }
        return "\(secs)s ago"
    }
}

@MainActor
@Observable
final class InstancesStore {
    static let shared = InstancesStore()
    let isPreview: Bool

    var instances: [InstanceInfo] = []
    var lastError: String?
    var statusMessage: String?
    var isLoading = false
    var hasLoadedOnce = false
    var lastSuccess: Date?

    private let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "instances")
    private var task: Task<Void, Never>?
    private let interval: TimeInterval = 30
    private var eventTask: Task<Void, Never>?
    private var startCount = 0
    private var lastPresenceById: [String: InstanceInfo] = [:]
    private var lastLoginNotifiedAtMs: [String: Double] = [:]

    private struct PresenceEventPayload: Codable {
        let presence: [PresenceEntry]
    }

    init(isPreview: Bool = false) {
        self.isPreview = isPreview
    }

    func start() {
        guard !self.isPreview else { return }
        self.startCount += 1
        guard self.startCount == 1 else { return }
        guard self.task == nil else { return }
        GatewayPushSubscription.restartTask(task: &self.eventTask) { [weak self] push in
            self?.handle(push: push)
        }
        SimpleTaskSupport.startDetachedLoop(task: &self.task, interval: self.interval) { [weak self] in
            await self?.refresh()
        }
    }

    func stop() {
        guard !self.isPreview else { return }
        guard self.startCount > 0 else { return }
        self.startCount -= 1
        guard self.startCount == 0 else { return }
        self.task?.cancel()
        self.task = nil
        self.eventTask?.cancel()
        self.eventTask = nil
    }

    private func handle(push: GatewayPush) {
        switch push {
        case let .event(evt) where evt.event == "presence":
            if let payload = evt.payload {
                self.handlePresenceEventPayload(payload)
            }
        case .seqGap:
            Task { await self.refresh() }
        case let .snapshot(hello):
            self.applyPresence(hello.snapshot.presence)
        default:
            break
        }
    }

    func refresh() async {
        if self.isLoading { return }
        self.isLoading = true
        defer {
            self.isLoading = false
            self.hasLoadedOnce = true
        }
        do {
            PresenceReporter.shared.sendImmediate(reason: "instances-refresh")
            let data = try await ControlChannel.shared.request(method: "system-presence")
            self.lastPayload = data
            if data.isEmpty {
                self.logger.error("instances fetch returned empty payload")
                self.applyRefreshFailure(
                    message: self.userFacingRefreshFailure(
                        raw: nil,
                        fallback: "The nodes list could not be loaded right now."))
                return
            }
            let decoded = try JSONDecoder().decode([PresenceEntry].self, from: data)
            self.applyPresence(decoded)
        } catch {
            self.logger.error(
                """
                instances fetch failed: \(error.localizedDescription, privacy: .public) \
                len=\(self.lastPayload?.count ?? 0, privacy: .public) \
                utf8=\(self.snippet(self.lastPayload), privacy: .public)
                """)
            self.applyRefreshFailure(
                message: self.userFacingRefreshFailure(
                    raw: error.localizedDescription,
                    fallback: "The nodes list could not be loaded right now."))
        }
    }

    // MARK: - Helpers

    /// Keep the last raw payload for logging.
    private var lastPayload: Data?

    private func snippet(_ data: Data?, limit: Int = 256) -> String {
        guard let data else { return "<none>" }
        if data.isEmpty { return "<empty>" }
        let prefix = data.prefix(limit)
        if let asString = String(data: prefix, encoding: .utf8) {
            return asString.replacingOccurrences(of: "\n", with: " ")
        }
        return "<\(data.count) bytes non-utf8>"
    }

    func handlePresenceEventPayload(_ payload: AlisioProtocol.AnyCodable) {
        do {
            let wrapper = try GatewayPayloadDecoding.decode(payload, as: PresenceEventPayload.self)
            self.applyPresence(wrapper.presence)
        } catch {
            self.logger.error("presence event decode failed: \(error.localizedDescription, privacy: .public)")
            self.applyRefreshFailure(
                message: self.userFacingRefreshFailure(
                    raw: nil,
                    fallback: "The nodes list could not be refreshed."))
        }
    }

    private func normalizePresence(_ entries: [PresenceEntry]) -> [InstanceInfo] {
        entries.map { entry -> InstanceInfo in
            let key = entry.instanceid ?? entry.host ?? entry.ip ?? entry.text ?? "entry-\(entry.ts)"
            return InstanceInfo(
                id: key,
                host: entry.host,
                ip: entry.ip,
                version: entry.version,
                platform: entry.platform,
                deviceFamily: entry.devicefamily,
                modelIdentifier: entry.modelidentifier,
                lastInputSeconds: entry.lastinputseconds,
                mode: entry.mode,
                reason: entry.reason,
                text: entry.text ?? "Unnamed node",
                ts: Double(entry.ts))
        }
    }

    private func applyPresence(_ entries: [PresenceEntry]) {
        let withIDs = self.normalizePresence(entries)
        self.notifyOnNodeLogin(withIDs)
        self.lastPresenceById = Dictionary(uniqueKeysWithValues: withIDs.map { ($0.id, $0) })
        self.instances = withIDs
        self.statusMessage = withIDs.isEmpty ? "No nodes have checked in yet." : nil
        self.lastError = nil
        self.lastSuccess = Date()
        self.hasLoadedOnce = true
    }

    private func applyRefreshFailure(message: String) {
        self.lastError = message
        self.statusMessage = nil
    }

    private func userFacingRefreshFailure(raw: String?, fallback: String) -> String {
        let hasLastKnownNodes = !self.instances.isEmpty
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let suffix = hasLastKnownNodes ? " Showing the last known nodes." : ""
        let baseFallback = fallback + suffix
        guard !trimmed.isEmpty else { return baseFallback }

        let lower = trimmed.lowercased()
        if lower.contains("sign in") {
            return hasLastKnownNodes
                ? "Sign in to refresh nodes. Showing the last known nodes."
                : "Sign in to load nodes."
        }
        if lower.contains("timeout") {
            return hasLastKnownNodes
                ? "Nodes are taking longer than expected to refresh. Showing the last known nodes."
                : "Nodes are taking longer than expected to load."
        }
        if lower.contains("disconnected") ||
            lower.contains("cannot reach gateway") ||
            lower.contains("cannot connect") ||
            lower.contains("connection refused") ||
            lower.contains("network")
        {
            return hasLastKnownNodes
                ? "Alisio is not connected to the runtime right now. Showing the last known nodes."
                : "Alisio is not connected to the runtime right now."
        }
        return baseFallback
    }

    private func notifyOnNodeLogin(_ instances: [InstanceInfo]) {
        for inst in instances {
            guard let reason = inst.reason?.trimmingCharacters(in: .whitespacesAndNewlines) else { continue }
            guard reason == "node-connected" else { continue }
            if let mode = inst.mode?.lowercased(), mode == "local" { continue }

            let previous = self.lastPresenceById[inst.id]
            if previous?.reason == "node-connected", previous?.ts == inst.ts { continue }

            let lastNotified = self.lastLoginNotifiedAtMs[inst.id] ?? 0
            if inst.ts <= lastNotified { continue }
            self.lastLoginNotifiedAtMs[inst.id] = inst.ts

            let name = inst.host?.trimmingCharacters(in: .whitespacesAndNewlines)
            let device = name?.isEmpty == false ? name! : inst.id
            Task { @MainActor in
                _ = await NotificationManager().send(
                    title: "Node connected",
                    body: device,
                    sound: nil,
                    priority: .active)
            }
        }
    }
}

extension InstancesStore {
    static func preview(instances: [InstanceInfo] = [
        InstanceInfo(
            id: "local",
            host: "steipete-mac",
            ip: "10.0.0.12",
            version: "1.2.3",
            platform: "macos 26.2.0",
            deviceFamily: "Mac",
            modelIdentifier: "Mac16,6",
            lastInputSeconds: 12,
            mode: "local",
            reason: "preview",
            text: "Local node: steipete-mac (10.0.0.12) · app 1.2.3",
            ts: Date().timeIntervalSince1970 * 1000),
        InstanceInfo(
            id: "gateway",
            host: "gateway",
            ip: "100.64.0.2",
            version: "1.2.3",
            platform: "linux 6.6.0",
            deviceFamily: "Linux",
            modelIdentifier: "x86_64",
            lastInputSeconds: 45,
            mode: "remote",
            reason: "preview",
            text: "Gateway node · tunnel ok",
            ts: Date().timeIntervalSince1970 * 1000 - 45000),
    ]) -> InstancesStore {
        let store = InstancesStore(isPreview: true)
        store.instances = instances
        store.statusMessage = "Preview data"
        store.hasLoadedOnce = true
        return store
    }
}
