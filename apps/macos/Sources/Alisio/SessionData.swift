import Foundation
import SwiftUI

import AlisioChatUI
import AlisioSupport

struct SessionTokenStats {
    let input: Int
    let output: Int
    let total: Int
    let contextTokens: Int

    var contextSummaryShort: String {
        "\(Self.formatKTokens(self.total))/\(Self.formatKTokens(self.contextTokens))"
    }

    var percentUsed: Int? {
        guard self.contextTokens > 0, self.total > 0 else { return nil }
        return min(100, Int(round((Double(self.total) / Double(self.contextTokens)) * 100)))
    }

    var summary: String {
        let parts = ["in \(input)", "out \(output)", "total \(total)"]
        var text = parts.joined(separator: " | ")
        if let percentUsed {
            text += " (\(percentUsed)% of \(self.contextTokens))"
        }
        return text
    }

    static func formatKTokens(_ value: Int) -> String {
        if value < 1000 { return "\(value)" }
        let thousands = Double(value) / 1000
        let decimals = value >= 10000 ? 0 : 1
        return String(format: "%.\(decimals)fk", thousands)
    }
}

struct SessionRow: Identifiable {
    let id: String
    let key: String
    let kind: SessionKind
    let labelOverride: String?
    let displayName: String?
    let derivedTitle: String?
    let lastMessagePreview: String?
    let subject: String?
    let room: String?
    let space: String?
    let updatedAt: Date?
    let sessionId: String?
    let thinkingLevel: String?
    let verboseLevel: String?
    let systemSent: Bool
    let abortedLastRun: Bool
    let tokens: SessionTokenStats
    let model: String?

    var ageText: String {
        relativeAge(from: self.updatedAt)
    }

    var label: String {
        self.derivedTitle ?? self.displayName ?? self.labelOverride ?? self.key
    }

    var previewText: String? {
        let trimmedPreview = self.lastMessagePreview?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmedPreview, !trimmedPreview.isEmpty {
            return trimmedPreview
        }
        let trimmedSubject = self.subject?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmedSubject, !trimmedSubject.isEmpty {
            return trimmedSubject
        }
        return nil
    }

    var flagLabels: [String] {
        var flags: [String] = []
        if let thinkingLevel { flags.append("think \(thinkingLevel)") }
        if let verboseLevel { flags.append("verbose \(verboseLevel)") }
        if self.systemSent { flags.append("system sent") }
        if self.abortedLastRun { flags.append("aborted") }
        return flags
    }
}

enum SessionKind {
    case direct, group, global, unknown

    static func from(key: String) -> SessionKind {
        if key == "global" { return .global }
        if key.hasPrefix("group:") { return .group }
        if key.contains(":group:") { return .group }
        if key.contains(":channel:") { return .group }
        if key == "unknown" { return .unknown }
        return .direct
    }

    var label: String {
        switch self {
        case .direct: "Direct"
        case .group: "Group"
        case .global: "Global"
        case .unknown: "Unknown"
        }
    }

    var tint: Color {
        switch self {
        case .direct: .accentColor
        case .group: .orange
        case .global: .purple
        case .unknown: .gray
        }
    }
}

struct SessionDefaults {
    let model: String
    let contextTokens: Int
}

struct ModelChoice: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let provider: String
    let contextWindow: Int?
}

enum SessionLoadError: LocalizedError {
    case gatewayUnavailable(String)
    case decodeFailed(String)

    var errorDescription: String? {
        switch self {
        case let .gatewayUnavailable(reason):
            "Could not reach the gateway for sessions: \(reason)"

        case let .decodeFailed(reason):
            "Could not decode gateway session payload: \(reason)"
        }
    }
}

struct SessionStoreSnapshot {
    let storePath: String
    let defaults: SessionDefaults
    let rows: [SessionRow]
}

@MainActor
enum SessionLoader {
    static let fallbackModel = "claude-opus-4-6"
    static let fallbackContextTokens = 200_000

    static let defaultStorePath = standardize(
        AlisioPaths.stateDirURL
            .appendingPathComponent("sessions/sessions.json").path)

    static func loadSnapshot(
        activeMinutes: Int? = nil,
        limit: Int? = nil,
        includeGlobal: Bool = true,
        includeUnknown: Bool = true,
        search: String? = nil) async throws -> SessionStoreSnapshot
    {
        let payload: AlisioChatSessionsListResponse
        do {
            payload = try await GatewayConnection.shared.sessionsList(
                includeGlobal: includeGlobal,
                includeUnknown: includeUnknown,
                activeMinutes: activeMinutes,
                search: search,
                limit: limit,
                includeDerivedTitles: true,
                includeLastMessage: true)
        } catch let error as AlisioAccountRequiredError {
            throw error
        } catch {
            if let response = error as? GatewayResponseError,
               response.code == ErrorCode.invalidRequest.rawValue,
               response.message.localizedCaseInsensitiveContains("unknown method: sessions.list")
            {
                throw SessionLoadError.gatewayUnavailable(
                    "Gateway is too old (missing sessions.list). Restart/update the gateway.")
            }
            if error is GatewayDecodingError {
                throw SessionLoadError.decodeFailed(error.localizedDescription)
            }
            let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            throw SessionLoadError.gatewayUnavailable(msg)
        }

        let defaults = SessionDefaults(
            model: payload.defaults?.model ?? self.fallbackModel,
            contextTokens: payload.defaults?.contextTokens ?? self.fallbackContextTokens)

        let rows = payload.sessions.map { entry -> SessionRow in
            let updated = entry.updatedAt.map { Date(timeIntervalSince1970: $0 / 1000) }
            let input = entry.inputTokens ?? 0
            let output = entry.outputTokens ?? 0
            let total = entry.totalTokens ?? input + output
            let context = entry.contextTokens ?? defaults.contextTokens
            let model = entry.model ?? defaults.model

            return SessionRow(
                id: entry.key,
                key: entry.key,
                kind: SessionKind.from(key: entry.key),
                labelOverride: entry.label,
                displayName: entry.displayName,
                derivedTitle: entry.derivedTitle,
                lastMessagePreview: entry.lastMessagePreview,
                subject: entry.subject,
                room: entry.room,
                space: entry.space,
                updatedAt: updated,
                sessionId: entry.sessionId,
                thinkingLevel: entry.thinkingLevel,
                verboseLevel: entry.verboseLevel,
                systemSent: entry.systemSent ?? false,
                abortedLastRun: entry.abortedLastRun ?? false,
                tokens: SessionTokenStats(
                    input: input,
                    output: output,
                    total: total,
                    contextTokens: context),
                model: model)
        }.sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }

        return SessionStoreSnapshot(storePath: payload.path ?? self.defaultStorePath, defaults: defaults, rows: rows)
    }

    private static func standardize(_ path: String) -> String {
        (path as NSString).expandingTildeInPath.replacingOccurrences(of: "//", with: "/")
    }
}

func relativeAge(from date: Date?) -> String {
    guard let date else { return "unknown" }
    let delta = Date().timeIntervalSince(date)
    if delta < 60 { return "just now" }
    let minutes = Int(round(delta / 60))
    if minutes < 60 { return "\(minutes)m ago" }
    let hours = Int(round(Double(minutes) / 60))
    if hours < 48 { return "\(hours)h ago" }
    let days = Int(round(Double(hours) / 24))
    return "\(days)d ago"
}
