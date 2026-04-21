import Foundation
import Observation
import SwiftUI

import AlisioSupport

enum AlisioAccountRequiredError: LocalizedError, Equatable {
    case signedOut
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case .signedOut:
            "Sign in to your Alisio account before using this workspace."
        case let .unavailable(message):
            message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "Cannot confirm the signed-in Alisio account."
                : message
        }
    }
}

struct AlisioAccountSnapshot: Decodable, Equatable {
    struct Canonical: Decodable, Equatable {
        let authenticated: Bool?
        let accountId: String?
        let source: String?
    }

    struct Profile: Decodable, Equatable {
        let userId: String?
        let username: String?
        let displayName: String?
        let email: String?
    }

    struct Session: Decodable, Equatable {
        let state: String?
        let authenticated: Bool?
        let accountId: String?
    }

    struct Device: Decodable, Equatable, Identifiable {
        let id: String
        let label: String?
        let platform: String?
        let current: Bool?
        let binding: String?
        let accountId: String?
    }

    struct DeviceBinding: Decodable, Equatable {
        let binding: String?
        let accountId: String?
        let deviceId: String?
        let label: String?
        let platform: String?
        let current: Bool?
    }

    let accountId: String?
    let canonical: Canonical?
    let profile: Profile?
    let session: Session?
    let devices: [Device]
    let deviceBinding: DeviceBinding?

    var resolvedAccountId: String? {
        Self.firstNonEmpty([
            self.accountId,
            self.canonical?.accountId,
            self.session?.accountId,
            self.profile?.userId,
            self.profile?.email,
        ])
    }

    var isAuthenticated: Bool {
        let canonicalAuth = self.canonical?.authenticated == true
        let sessionAuth = self.session?.authenticated == true || self.session?.state == "signed_in"
        return (canonicalAuth || sessionAuth) && self.resolvedAccountId != nil
    }

    var displayName: String {
        Self.firstNonEmpty([
            self.profile?.displayName,
            self.profile?.username,
            self.profile?.email,
            self.resolvedAccountId,
        ]) ?? "Alisio account"
    }

    var currentDevice: Device? {
        self.devices.first(where: { $0.current == true }) ?? self.devices.first
    }

    var deviceId: String? {
        Self.firstNonEmpty([
            self.deviceBinding?.deviceId,
            self.currentDevice?.id,
        ])
    }

    var deviceLabel: String? {
        Self.firstNonEmpty([
            self.deviceBinding?.label,
            self.currentDevice?.label,
        ])
    }

    private static func firstNonEmpty(_ values: [String?]) -> String? {
        for value in values {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !trimmed.isEmpty {
                return trimmed
            }
        }
        return nil
    }
}

@MainActor
@Observable
final class AlisioAccountStore {
    static let shared = AlisioAccountStore()

    private(set) var snapshot: AlisioAccountSnapshot?
    private(set) var isLoading = false
    private(set) var lastError: String?
    private(set) var lastRefreshAt: Date?

    var isAuthenticated: Bool {
        self.snapshot?.isAuthenticated == true
    }

    var accountId: String? {
        self.snapshot?.resolvedAccountId
    }

    var accountLabel: String {
        guard let snapshot else { return "Sign in required" }
        return snapshot.isAuthenticated ? snapshot.displayName : "Sign in required"
    }

    var deviceLabel: String? {
        guard let snapshot, snapshot.isAuthenticated else { return nil }
        return snapshot.deviceLabel ?? snapshot.deviceId
    }

    var statusDetail: String {
        if let lastError, !lastError.isEmpty {
            return lastError
        }
        guard let snapshot else {
            return "Alisio needs an account before chat, memory, devices, computer use, and automations are available."
        }
        guard snapshot.isAuthenticated else {
            return "Sign in to scope workspace, memory, devices, runs, and automations to your account."
        }
        let account = snapshot.resolvedAccountId ?? "account"
        if let deviceLabel = self.deviceLabel {
            return "\(account) · \(deviceLabel)"
        }
        return account
    }

    func clear() {
        self.snapshot = nil
        self.lastError = nil
        self.lastRefreshAt = nil
        self.isLoading = false
    }

    func apply(_ snapshot: AlisioAccountSnapshot) {
        self.snapshot = snapshot
        self.lastError = nil
        self.lastRefreshAt = Date()
    }

    func refresh(reason _: String) async {
        guard !self.isLoading else { return }
        self.isLoading = true
        defer { self.isLoading = false }
        do {
            let snapshot = try await GatewayConnection.shared.accountSnapshot()
            self.apply(snapshot)
        } catch {
            self.lastError = error.localizedDescription
            self.lastRefreshAt = Date()
        }
    }

    func requireAuthenticated(reason: String) async throws -> AlisioAccountSnapshot {
        if let snapshot, snapshot.isAuthenticated {
            return snapshot
        }

        await self.refresh(reason: reason)
        if let snapshot, snapshot.isAuthenticated {
            return snapshot
        }

        if let lastError, !lastError.isEmpty {
            throw AlisioAccountRequiredError.unavailable(lastError)
        }
        throw AlisioAccountRequiredError.signedOut
    }
}

struct AlisioAccountRequiredView: View {
    @Bindable var store: AlisioAccountStore
    let title: String
    let message: String

    init(
        store: AlisioAccountStore = .shared,
        title: String = "Alisio account required",
        message: String = "Chat, memory, devices, computer use, runs, and automations are disabled until this Mac is signed in.")
    {
        self.store = store
        self.title = title
        self.message = message
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "person.crop.circle.badge.exclamationmark")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Color.orange)
                    .frame(width: 34)

                VStack(alignment: .leading, spacing: 6) {
                    Text(self.title)
                        .font(.title3.weight(.semibold))
                    Text(self.message)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(self.store.statusDetail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack(spacing: 10) {
                Button {
                    DebugActions.openSetup()
                } label: {
                    Label("Open setup", systemImage: "arrow.right.circle")
                }
                .buttonStyle(.borderedProminent)

                Button {
                    Task { await self.store.refresh(reason: "account-required-view") }
                } label: {
                    if self.store.isLoading {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Retry", systemImage: "arrow.clockwise")
                    }
                }
                .disabled(self.store.isLoading)
            }
        }
        .padding(18)
        .frame(maxWidth: 560, alignment: .leading)
        .background(Color.gray.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .task {
            await self.store.refresh(reason: "account-required-view")
        }
    }
}

struct AlisioAccountStatusCard: View {
    @Bindable var store: AlisioAccountStore

    init(store: AlisioAccountStore = .shared) {
        self.store = store
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Circle()
                    .fill(self.store.isAuthenticated ? Color.green : Color.orange)
                    .frame(width: 10, height: 10)
                Text(self.store.accountLabel)
                    .font(.callout.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    Task { await self.store.refresh(reason: "account-status-card") }
                } label: {
                    if self.store.isLoading {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .buttonStyle(.borderless)
                .disabled(self.store.isLoading)
            }

            Text(self.store.statusDetail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if !self.store.isAuthenticated {
                Button("Open setup") {
                    DebugActions.openSetup()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(12)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(10)
        .task {
            await self.store.refresh(reason: "account-status-card")
        }
    }
}
