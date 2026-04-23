import Foundation
import Observation
import SwiftUI

import AlisioSupport
struct HealthSnapshot: Codable {
    struct ChannelSummary: Codable {
        struct Probe: Codable {
            struct Bot: Codable {
                let username: String?
            }

            struct Webhook: Codable {
                let url: String?
            }

            let ok: Bool?
            let status: Int?
            let error: String?
            let elapsedMs: Double?
            let bot: Bot?
            let webhook: Webhook?
        }

        let configured: Bool?
        let linked: Bool?
        let authAgeMs: Double?
        let probe: Probe?
        let lastProbeAt: Double?
    }

    struct SessionInfo: Codable {
        let key: String
        let updatedAt: Double?
        let age: Double?
    }

    struct Sessions: Codable {
        let path: String
        let count: Int
        let recent: [SessionInfo]
    }

    let ok: Bool?
    let ts: Double
    let durationMs: Double
    let channels: [String: ChannelSummary]
    let channelOrder: [String]?
    let channelLabels: [String: String]?
    let heartbeatSeconds: Int?
    let sessions: Sessions
}

enum HealthState: Equatable {
    case unknown
    case ok
    case linkingNeeded
    case degraded(String)

    var tint: Color {
        switch self {
        case .ok: .green
        case .linkingNeeded: .red
        case .degraded: .orange
        case .unknown: .secondary
        }
    }
}

@MainActor
@Observable
final class HealthStore {
    static let shared = HealthStore()

    private static let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "health")

    private(set) var snapshot: HealthSnapshot?
    private(set) var lastSuccess: Date?
    private(set) var lastError: String?
    private(set) var isRefreshing = false
    private(set) var hasLoadedOnce = false

    private var loopTask: Task<Void, Never>?
    private let refreshInterval: TimeInterval = 60

    init(autoStart: Bool = true) {
        // Avoid background health polling in SwiftUI previews and tests.
        if autoStart, !ProcessInfo.processInfo.isPreview, !ProcessInfo.processInfo.isRunningTests {
            self.start()
        }
    }

    /// Test-only escape hatch: the HealthStore is a process-wide singleton but
    /// state derivation is pure from `snapshot` + `lastError`.
    func __setSnapshotForTest(_ snapshot: HealthSnapshot?, lastError: String? = nil) {
        self.snapshot = snapshot
        self.lastError = lastError
        self.hasLoadedOnce = snapshot != nil || Self.trimmed(lastError) != nil
    }

    func __setRefreshingForTest(_ isRefreshing: Bool) {
        self.isRefreshing = isRefreshing
    }

    func start() {
        guard self.loopTask == nil else { return }
        self.loopTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await self.refresh()
                try? await Task.sleep(nanoseconds: UInt64(self.refreshInterval * 1_000_000_000))
            }
        }
    }

    func stop() {
        self.loopTask?.cancel()
        self.loopTask = nil
    }

    func refresh(onDemand: Bool = false) async {
        guard !self.isRefreshing else { return }
        self.isRefreshing = true
        defer {
            self.isRefreshing = false
            self.hasLoadedOnce = true
        }
        let previousError = self.lastError

        do {
            let data = try await ControlChannel.shared.health(timeout: 15)
            if let decoded = decodeHealthSnapshot(from: data) {
                self.snapshot = decoded
                self.lastSuccess = Date()
                self.lastError = nil
                if previousError != nil {
                    Self.logger.info("health refresh recovered")
                }
            } else {
                self.lastError = "health output not JSON"
                if onDemand { self.snapshot = nil }
                if previousError != self.lastError {
                    Self.logger.warning("health refresh failed: output not JSON")
                }
            }
        } catch {
            let desc = error.localizedDescription
            self.lastError = desc
            if onDemand { self.snapshot = nil }
            if previousError != desc {
                Self.logger.error("health refresh failed \(desc, privacy: .public)")
            }
        }
    }

    private static func isChannelHealthy(_ summary: HealthSnapshot.ChannelSummary) -> Bool {
        guard summary.configured == true else { return false }
        // If probe is missing, treat it as "configured but unknown health" (not a hard fail).
        return summary.probe?.ok ?? true
    }

    private static func describeProbeFailure(_ probe: HealthSnapshot.ChannelSummary.Probe) -> String {
        let lower = probe.error?.lowercased() ?? ""
        if lower.contains("timeout") || probe.status == nil {
            return "Health check timed out"
        }
        if lower.contains("unauthorized") ||
            lower.contains("forbidden") ||
            lower.contains("authentication") ||
            lower.contains("rejected token")
        {
            return "Health check failed because sign-in needs attention"
        }
        if let status = probe.status, status >= 500 {
            return "Health check failed because the runtime is unavailable"
        }
        return "Health check failed"
    }

    private func resolveLinkChannel(
        _ snap: HealthSnapshot) -> (id: String, summary: HealthSnapshot.ChannelSummary)?
    {
        let order = snap.channelOrder ?? Array(snap.channels.keys)
        for id in order {
            if let summary = snap.channels[id], summary.linked == true {
                return (id: id, summary: summary)
            }
        }
        for id in order {
            if let summary = snap.channels[id], summary.linked != nil {
                return (id: id, summary: summary)
            }
        }
        return nil
    }

    private func resolveFallbackChannel(
        _ snap: HealthSnapshot,
        excluding id: String?) -> (id: String, summary: HealthSnapshot.ChannelSummary)?
    {
        let order = snap.channelOrder ?? Array(snap.channels.keys)
        for channelId in order {
            if channelId == id { continue }
            guard let summary = snap.channels[channelId] else { continue }
            if Self.isChannelHealthy(summary) {
                return (id: channelId, summary: summary)
            }
        }
        return nil
    }

    private static func trimmed(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private func label(for channelID: String, in snap: HealthSnapshot) -> String {
        snap.channelLabels?[channelID] ?? channelID.capitalized
    }

    private static func healthHeadline(for error: String) -> String {
        let lower = error.lowercased()
        if lower.contains("sign in") {
            return "Sign in required"
        }
        if lower.contains("timeout") {
            return "Health check timed out"
        }
        if lower.contains("disconnected") ||
            lower.contains("cannot reach gateway") ||
            lower.contains("cannot connect") ||
            lower.contains("connection refused") ||
            lower.contains("network")
        {
            return "Runtime unavailable"
        }
        if lower.contains("not json") || lower.contains("invalid") {
            return "Health check failed"
        }
        return "Health needs attention"
    }

    private static func healthDetail(for error: String) -> String {
        let lower = error.lowercased()
        if lower.contains("sign in") {
            return "Sign in to Alisio to finish linking this Mac."
        }
        if lower.contains("connection refused") ||
            lower.contains("cannot reach gateway") ||
            lower.contains("cannot connect") ||
            lower.contains("disconnected")
        {
            return "Alisio could not reach the runtime. Open Alisio again or wait for it to finish starting."
        }
        if lower.contains("timeout") {
            return "The runtime is taking longer than expected to answer."
        }
        if lower.contains("not json") || lower.contains("invalid") {
            return "Alisio received an invalid health response from the runtime."
        }
        return error
    }

    var state: HealthState {
        if let error = self.lastError, !error.isEmpty {
            return .degraded(error)
        }
        guard let snap = self.snapshot else { return .unknown }
        guard let link = self.resolveLinkChannel(snap) else { return .unknown }
        if link.summary.linked != true {
            // Linking is optional if any other channel is healthy; don't paint the whole app red.
            let fallback = self.resolveFallbackChannel(snap, excluding: link.id)
            return fallback != nil ? .degraded("Not linked") : .linkingNeeded
        }
        // A channel can be "linked" but still unhealthy (failed probe / cannot connect).
        if let probe = link.summary.probe, probe.ok == false {
            return .degraded(Self.describeProbeFailure(probe))
        }
        return .ok
    }

    var summaryLine: String {
        if let error = Self.trimmed(self.lastError) {
            return Self.healthHeadline(for: error)
        }
        if self.isRefreshing, self.snapshot == nil {
            return "Checking health…"
        }
        guard let snap = self.snapshot else {
            return self.hasLoadedOnce ? "Health unavailable" : "Health check pending"
        }
        guard let link = self.resolveLinkChannel(snap) else {
            return self.isRefreshing ? "Checking health…" : "Health check pending"
        }
        if link.summary.linked != true {
            if let fallback = self.resolveFallbackChannel(snap, excluding: link.id) {
                return "\(self.label(for: fallback.id, in: snap)) is working"
            }
            return "Sign in required"
        }
        if let probe = link.summary.probe, probe.ok == false {
            return "\(self.label(for: link.id, in: snap)) needs attention"
        }
        return "Healthy"
    }

    /// Short, human-friendly detail for the last failure, used in the UI.
    var detailLine: String? {
        if let error = Self.trimmed(self.lastError) {
            return Self.healthDetail(for: error)
        }
        guard let snap = self.snapshot, let link = self.resolveLinkChannel(snap) else {
            if self.isRefreshing {
                return "Running a fresh health check."
            }
            return nil
        }
        if link.summary.linked != true {
            if let fallback = self.resolveFallbackChannel(snap, excluding: link.id) {
                return "\(self.label(for: fallback.id, in: snap)) is available, but this Mac is not linked yet."
            }
            return "Sign in to Alisio to finish linking this Mac."
        }
        if let probe = link.summary.probe, probe.ok == false {
            return Self.describeProbeFailure(probe)
        }
        if self.isRefreshing {
            return "Refreshing health status."
        }
        if let authAge = link.summary.authAgeMs {
            return "\(self.label(for: link.id, in: snap)) linked · last sign-in \(msToAge(authAge))."
        }
        return nil
    }

    func describeFailure(from snap: HealthSnapshot, fallback: String?) -> String {
        if let link = self.resolveLinkChannel(snap), link.summary.linked != true {
            return "Not linked — sign in to Alisio"
        }
        if let link = self.resolveLinkChannel(snap), let probe = link.summary.probe, probe.ok == false {
            return Self.describeProbeFailure(probe)
        }
        if let fallback, !fallback.isEmpty {
            return fallback
        }
        return "health probe failed"
    }

    var degradedSummary: String? {
        guard case let .degraded(reason) = self.state else { return nil }
        if let detail = self.detailLine {
            return detail
        }
        if reason == "[object Object]" || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let snap = self.snapshot
        {
            return self.describeFailure(from: snap, fallback: reason)
        }
        return reason
    }
}

func msToAge(_ ms: Double) -> String {
    let minutes = Int(round(ms / 60000))
    if minutes < 1 { return "just now" }
    if minutes < 60 { return "\(minutes)m" }
    let hours = Int(round(Double(minutes) / 60))
    if hours < 48 { return "\(hours)h" }
    let days = Int(round(Double(hours) / 24))
    return "\(days)d"
}

/// Decode a health snapshot, tolerating stray log lines before/after the JSON blob.
func decodeHealthSnapshot(from data: Data) -> HealthSnapshot? {
    let decoder = JSONDecoder()
    if let snap = try? decoder.decode(HealthSnapshot.self, from: data) {
        return snap
    }
    guard let text = String(data: data, encoding: .utf8) else { return nil }
    guard let firstBrace = text.firstIndex(of: "{"), let lastBrace = text.lastIndex(of: "}") else {
        return nil
    }
    let slice = text[firstBrace...lastBrace]
    let cleaned = Data(slice.utf8)
    return try? decoder.decode(HealthSnapshot.self, from: cleaned)
}
