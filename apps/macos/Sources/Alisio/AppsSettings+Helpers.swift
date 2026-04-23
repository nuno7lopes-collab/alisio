import AppKit
import SwiftUI

import AlisioSupport
extension AppsSettings {
    func appStatusTint(_ status: AppIntegrationGroup.Status) -> Color {
        switch status {
        case .connected:
            .green
        case .needsAttention:
            .orange
        case .authError:
            .red
        case .disconnected:
            .secondary
        }
    }

    func capabilityTint(_ status: AppIntegrationCapability.Status) -> Color {
        switch status {
        case .connected:
            .green
        case .needsReconnect:
            .orange
        case .authError:
            .red
        case .disconnected:
            .secondary
        }
    }

    func openExternalURL(_ url: URL) {
        NSWorkspace.shared.open(url)
    }

    func formatConnectedAt(_ date: Date?) -> String? {
        guard let date else { return nil }
        return relativeAge(from: date)
    }

    func accountText(label: String?, email: String?) -> String? {
        let trimmedLabel = label?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines)

        if let trimmedLabel, !trimmedLabel.isEmpty, let trimmedEmail, !trimmedEmail.isEmpty,
           trimmedLabel.caseInsensitiveCompare(trimmedEmail) != .orderedSame
        {
            return "\(trimmedLabel) · \(trimmedEmail)"
        }
        if let trimmedLabel, !trimmedLabel.isEmpty {
            return trimmedLabel
        }
        if let trimmedEmail, !trimmedEmail.isEmpty {
            return trimmedEmail
        }
        return nil
    }

    func appSummaryLine(_ app: AppIntegrationGroup) -> String {
        switch app.status {
        case .connected:
            if let account = self.accountText(label: app.accountLabel, email: app.accountEmail) {
                return account
            }
            return app.capabilities.count == 1
                ? "Connected"
                : "All \(app.capabilities.count) access levels connected"
        case .needsAttention:
            let connectedCount = app.capabilities.filter { $0.status == .connected }.count
            if connectedCount > 0 {
                return "\(connectedCount) of \(app.capabilities.count) access levels connected"
            }
            return "Action required"
        case .authError:
            return "Auth setup required"
        case .disconnected:
            return app.capabilities.count == 1 ? "Disconnected" : "Ready to connect"
        }
    }

    func capabilityDetailLine(_ capability: AppIntegrationCapability) -> String {
        switch capability.status {
        case .connected:
            var parts: [String] = []
            if let account = self.accountText(label: capability.accountLabel, email: capability.accountEmail) {
                parts.append(account)
            }
            if let connectedAt = self.formatConnectedAt(capability.connectedAt) {
                parts.append("Connected \(connectedAt)")
            }
            return parts.isEmpty ? "Connected and ready." : parts.joined(separator: " · ")
        case .needsReconnect:
            return capability.setupHint ?? "Authorization expired or needs reconnecting."
        case .authError:
            return capability.setupHint ?? "Gateway setup is incomplete for this app."
        case .disconnected:
            return capability.detail?.nonEmpty ?? capability.subtitle
        }
    }
}
