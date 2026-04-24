import SwiftUI

import AlisioSupport
extension AppsSettings {
    func appStatusTint(_ status: AppIntegrationGroup.Status) -> Color {
        switch status {
        case .connected:
            .green
        case .needsReconnect:
            .orange
        case .setupRequired:
            .red
        case .partiallyConnected:
            .accentColor
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
        case .setupRequired:
            .red
        case .disconnected:
            .secondary
        }
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

    func appSidebarDetailLine(_ app: AppIntegrationGroup) -> String {
        switch app.status {
        case .connected:
            return self.accountText(label: app.accountLabel, email: app.accountEmail) ??
                app.detail?.nonEmpty ??
                app.summary
        case .needsReconnect, .setupRequired, .partiallyConnected:
            return app.detail?.nonEmpty ?? app.summary
        case .disconnected:
            return app.summary
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
            return parts.isEmpty ? "Ready to use." : parts.joined(separator: " · ")
        case .needsReconnect:
            return capability.setupHint ?? "Sign in again to keep using this."
        case .setupRequired:
            return capability.setupHint ?? "Finish setup on this Mac before connecting."
        case .disconnected:
            return capability.detail?.nonEmpty ?? capability.subtitle
        }
    }

    func refreshStatusLine(lastUpdated: Date?, isRefreshing: Bool) -> String? {
        if isRefreshing {
            if let lastUpdated {
                return "Refreshing. Last checked \(relativeAge(from: lastUpdated))"
            }
            return "Refreshing"
        }
        guard let lastUpdated else { return nil }
        return "Updated \(relativeAge(from: lastUpdated))"
    }

    func statusMessageTone(_ tone: AppsStatusMessageTone) -> WorkspaceSurfaceTone {
        switch tone {
        case .neutral:
            .neutral
        case .success:
            .success
        case .warning:
            .caution
        }
    }
}
