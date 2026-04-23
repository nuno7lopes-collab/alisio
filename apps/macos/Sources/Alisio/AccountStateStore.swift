import Foundation
import Observation
import OSLog
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

private enum AlisioAccountOperationContext: Equatable {
    case accountStatus
    case beginEmailAuth
    case verifyEmailAuth
    case beginGoogleAuth
    case completeEmailLinkAuth
    case completeGoogleAuth
    case completeProfile
    case generic(String)

    init(reason: String) {
        switch reason {
        case GatewayConnection.Method.alisioAccountGet.rawValue:
            self = .accountStatus
        case GatewayConnection.Method.alisioAccountBeginEmailAuth.rawValue:
            self = .beginEmailAuth
        case GatewayConnection.Method.alisioAccountVerifyEmailAuth.rawValue:
            self = .verifyEmailAuth
        case GatewayConnection.Method.alisioAccountBeginGoogleAuth.rawValue:
            self = .beginGoogleAuth
        case GatewayConnection.Method.alisioAccountCompleteEmailLinkAuth.rawValue:
            self = .completeEmailLinkAuth
        case GatewayConnection.Method.alisioAccountCompleteGoogleAuth.rawValue:
            self = .completeGoogleAuth
        case GatewayConnection.Method.alisioAccountCompleteProfile.rawValue:
            self = .completeProfile
        default:
            self = .generic(reason)
        }
    }

    var readinessTimeout: TimeInterval {
        switch self {
        case .accountStatus:
            return 8
        case .beginGoogleAuth, .completeEmailLinkAuth, .completeGoogleAuth:
            return 18
        case .beginEmailAuth, .verifyEmailAuth, .completeProfile, .generic:
            return 15
        }
    }

    var retryDelays: [UInt64] {
        switch self {
        case .accountStatus:
            return [0, 350_000_000]
        case .beginGoogleAuth, .beginEmailAuth, .verifyEmailAuth, .completeEmailLinkAuth, .completeGoogleAuth, .completeProfile:
            return [0, 500_000_000, 1_200_000_000]
        case .generic:
            return [0, 500_000_000]
        }
    }

    var fallbackFailureMessage: String {
        switch self {
        case .accountStatus:
            return "Alisio could not confirm the account on this Mac right now. Try again in a moment."
        case .beginEmailAuth:
            return "Alisio could not start email sign-in on this Mac right now. Try again in a moment."
        case .verifyEmailAuth, .completeEmailLinkAuth, .completeGoogleAuth:
            return "Alisio could not finish sign-in on this Mac right now. Try again in a moment."
        case .beginGoogleAuth:
            return "Alisio could not start Google sign-in on this Mac right now. Try again in a moment."
        case .completeProfile:
            return "Alisio could not finish account setup on this Mac right now. Try again in a moment."
        case .generic:
            return "Alisio could not reach this Mac right now. Try again in a moment."
        }
    }

    var transientFailureMessage: String {
        switch self {
        case .accountStatus:
            return "Alisio is still getting this Mac ready. Account status will update in a moment."
        case .beginEmailAuth:
            return "Alisio is still getting this Mac ready. Email sign-in is not available just yet. Try again in a moment."
        case .verifyEmailAuth, .completeEmailLinkAuth, .completeGoogleAuth:
            return "Alisio is still finishing sign-in on this Mac. Try again in a moment."
        case .beginGoogleAuth:
            return "Alisio is still getting this Mac ready. Google sign-in is not available just yet. Try again in a moment."
        case .completeProfile:
            return "Alisio is still getting this Mac ready to finish account setup. Try again in a moment."
        case .generic:
            return "Alisio is still getting this Mac ready. Try again in a moment."
        }
    }
}

private struct AlisioAccountErrorPresentation {
    let message: String
    let isTransient: Bool
    let error: NSError
}

enum AlisioCanonicalAccountSource: String, Decodable, Equatable {
    case accountId = "account_id"
    case missing
}

enum AlisioAccountAuthMethod: String, Codable, Equatable, Sendable {
    case email
    case google
}

enum AlisioAccountSessionState: String, Decodable, Equatable {
    case signedOut = "signed_out"
    case signedIn = "signed_in"
}

struct AlisioEmailAuthChallenge: Equatable, Sendable {
    let method: AlisioAccountAuthMethod
    let email: String
    let supportsMagicLink: Bool
    let supportsManualCode: Bool

    init(
        method: AlisioAccountAuthMethod = .email,
        email: String,
        supportsMagicLink: Bool = true,
        supportsManualCode: Bool = true)
    {
        self.method = method
        self.email = email
        self.supportsMagicLink = supportsMagicLink
        self.supportsManualCode = supportsManualCode
    }
}

struct AlisioGoogleAuthRequest: Equatable, Sendable {
    let method: AlisioAccountAuthMethod
    let setupURL: URL

    init(method: AlisioAccountAuthMethod = .google, setupURL: URL) {
        self.method = method
        self.setupURL = setupURL
    }
}

struct AlisioAccountAuthCompletion: Equatable, Sendable {
    let method: AlisioAccountAuthMethod
    let snapshot: AlisioAccountSnapshot
}

struct AlisioAccountSnapshot: Decodable, Equatable {
    struct Canonical: Decodable, Equatable {
        let authenticated: Bool?
        let accountId: String?
        let source: AlisioCanonicalAccountSource?
    }

    struct Profile: Decodable, Equatable {
        let userId: String?
        let username: String?
        let displayName: String?
        let email: String?
        let plan: String?

        init(
            userId: String?,
            username: String?,
            displayName: String?,
            email: String?,
            plan: String? = nil)
        {
            self.userId = userId
            self.username = username
            self.displayName = displayName
            self.email = email
            self.plan = plan
        }
    }

    struct Session: Decodable, Equatable {
        let state: AlisioAccountSessionState?
        let authenticated: Bool?
        let accountId: String?
        let profileCompleted: Bool?
        let authMethod: AlisioAccountAuthMethod?

        init(
            state: AlisioAccountSessionState?,
            authenticated: Bool?,
            accountId: String?,
            profileCompleted: Bool? = nil,
            authMethod: AlisioAccountAuthMethod?)
        {
            self.state = state
            self.authenticated = authenticated
            self.accountId = accountId
            self.profileCompleted = profileCompleted
            self.authMethod = authMethod
        }
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
        let sessionAuth = self.session?.authenticated == true || self.session?.state == .signedIn
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

    private let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "account")

    private(set) var snapshot: AlisioAccountSnapshot?
    private(set) var isLoading = false
    private(set) var lastError: String?
    private(set) var lastErrorIsTransient = false
    private(set) var lastRefreshAt: Date?
    private(set) var lastAuthCompletion: AlisioAccountAuthCompletion?
    private(set) var lastAuthCompletionEventID: UUID?

    var isAuthenticated: Bool {
        self.snapshot?.isAuthenticated == true
    }

    var profileCompleted: Bool {
        self.snapshot?.session?.profileCompleted == true
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

    var hasConfirmedSignedOutState: Bool {
        self.hasConfirmedSignedOutSnapshot
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
        self.lastErrorIsTransient = false
        self.lastRefreshAt = nil
        self.isLoading = false
        self.lastAuthCompletion = nil
        self.lastAuthCompletionEventID = nil
    }

    func apply(_ snapshot: AlisioAccountSnapshot) {
        self.snapshot = snapshot
        self.lastError = nil
        self.lastErrorIsTransient = false
        self.lastRefreshAt = Date()
    }

    func refresh(reason: String) async {
        guard !self.isLoading else { return }
        let hadError = self.lastError?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        self.isLoading = true
        defer { self.isLoading = false }
        let accountReason = GatewayConnection.Method.alisioAccountGet.rawValue
        let context = AlisioAccountOperationContext(reason: accountReason)
        do {
            try await self.ensureLocalGatewayReady(reason: accountReason, timeout: context.readinessTimeout)
            let snapshot = try await GatewayConnection.shared.accountSnapshot()
            self.apply(snapshot)
            if hadError {
                self.logger.info("account refresh recovered")
            }
        } catch {
            let presentation = Self.present(error, for: context)
            self.lastError = presentation.message
            self.lastErrorIsTransient = presentation.isTransient
            self.lastRefreshAt = Date()
            self.logger.warning(
                "account refresh failed reason=\(reason, privacy: .public) technical=\(error.localizedDescription, privacy: .public) presented=\(presentation.message, privacy: .public)")
        }
    }

    func beginEmailAuth(email: String) async throws -> AlisioEmailAuthChallenge {
        try await self.runAccountOperation(reason: GatewayConnection.Method.alisioAccountBeginEmailAuth.rawValue) {
            try await GatewayConnection.shared.beginAccountEmailAuth(email: email)
        }
    }

    func verifyEmailAuth(email: String, code: String) async throws -> AlisioAccountAuthCompletion {
        try await self.runAccountOperation(reason: GatewayConnection.Method.alisioAccountVerifyEmailAuth.rawValue) {
            let snapshot = try await GatewayConnection.shared.verifyAccountEmailAuth(email: email, code: code)
            self.apply(snapshot)
            return AlisioAccountAuthCompletion(method: .email, snapshot: snapshot)
        }
    }

    func completeEmailLinkAuth(_ link: AccountEmailLinkDeepLink) async throws -> AlisioAccountAuthCompletion {
        try await self.runAccountOperation(reason: GatewayConnection.Method.alisioAccountCompleteEmailLinkAuth.rawValue) {
            let snapshot = try await GatewayConnection.shared.completeAccountEmailLinkAuth(link)
            self.apply(snapshot)
            let completion = AlisioAccountAuthCompletion(method: .email, snapshot: snapshot)
            self.publishAuthCompletion(completion)
            return completion
        }
    }

    func beginGoogleAuth() async throws -> AlisioGoogleAuthRequest {
        try await self.runAccountOperation(reason: GatewayConnection.Method.alisioAccountBeginGoogleAuth.rawValue) {
            try await GatewayConnection.shared.beginAccountGoogleAuth()
        }
    }

    func completeGoogleAuth(
        _ callback: AccountGoogleAuthCallbackDeepLink) async throws -> AlisioAccountAuthCompletion
    {
        try await self.runAccountOperation(reason: GatewayConnection.Method.alisioAccountCompleteGoogleAuth.rawValue) {
            let snapshot = try await GatewayConnection.shared.completeAccountGoogleAuth(callback)
            self.apply(snapshot)
            let completion = AlisioAccountAuthCompletion(method: .google, snapshot: snapshot)
            self.publishAuthCompletion(completion)
            return completion
        }
    }

    func completeProfile(_ submission: EntryFlowProfileSubmission) async throws {
        try await self.runAccountOperation(reason: GatewayConnection.Method.alisioAccountCompleteProfile.rawValue) {
            let snapshot = try await GatewayConnection.shared.completeAccountProfile(submission)
            self.apply(snapshot)
        }
    }

    func handleAuthDeepLink(_ link: AccountAuthDeepLink) async throws -> AlisioAccountAuthCompletion {
        switch link {
        case let .emailLink(emailLink):
            return try await self.completeEmailLinkAuth(emailLink)
        case let .googleCallback(callback):
            return try await self.completeGoogleAuth(callback)
        }
    }

    func requireAuthenticated(reason: String) async throws -> AlisioAccountSnapshot {
        if let snapshot, snapshot.isAuthenticated {
            return snapshot
        }

        if self.hasConfirmedSignedOutSnapshot {
            throw AlisioAccountRequiredError.signedOut
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

    private var hasConfirmedSignedOutSnapshot: Bool {
        guard let snapshot, !snapshot.isAuthenticated else { return false }
        guard self.lastRefreshAt != nil else { return false }
        let trimmedError = self.lastError?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmedError.isEmpty
    }

    func takeLastAuthCompletion() -> AlisioAccountAuthCompletion? {
        let completion = self.lastAuthCompletion
        self.lastAuthCompletion = nil
        self.lastAuthCompletionEventID = nil
        return completion
    }

    private func runAccountOperation<T>(
        reason: String,
        _ operation: () async throws -> T) async throws -> T
    {
        self.isLoading = true
        defer { self.isLoading = false }

        let context = AlisioAccountOperationContext(reason: reason)
        var lastPresentation: AlisioAccountErrorPresentation?

        for (index, delay) in context.retryDelays.enumerated() {
            if delay > 0 {
                try? await Task.sleep(nanoseconds: delay)
            }
            guard !Task.isCancelled else {
                throw CancellationError()
            }

            do {
                try await self.ensureLocalGatewayReady(reason: reason, timeout: context.readinessTimeout)
                let result = try await operation()
                self.lastError = nil
                self.lastErrorIsTransient = false
                return result
            } catch {
                let presentation = Self.present(error, for: context)
                lastPresentation = presentation

                let isLastAttempt = index == context.retryDelays.count - 1
                if !presentation.isTransient || isLastAttempt {
                    self.lastError = presentation.message
                    self.lastErrorIsTransient = presentation.isTransient
                    self.logger.warning(
                        "account operation failed reason=\(reason, privacy: .public) technical=\(error.localizedDescription, privacy: .public) presented=\(presentation.message, privacy: .public)")
                    throw presentation.error
                }
            }
        }

        let fallback = lastPresentation ?? Self.present(
            NSError(
                domain: "AlisioAccount",
                code: 0,
                userInfo: [NSLocalizedDescriptionKey: context.transientFailureMessage]),
            for: context)
        self.lastError = fallback.message
        self.lastErrorIsTransient = fallback.isTransient
        throw fallback.error
    }

    private func ensureLocalGatewayReady(reason: String, timeout: TimeInterval) async throws {
        try await LocalGatewayPreflight.ensureReadyIfNeeded(reason: reason, timeout: timeout)
    }

    private func publishAuthCompletion(_ completion: AlisioAccountAuthCompletion) {
        self.lastAuthCompletion = completion
        self.lastAuthCompletionEventID = UUID()
    }

    private static func present(
        _ error: Error,
        for context: AlisioAccountOperationContext) -> AlisioAccountErrorPresentation
    {
        if let readinessError = error as? GatewayReadinessError {
            return Self.makePresentation(
                message: readinessError.userMessage,
                isTransient: readinessError.isTransient,
                underlying: error)
        }
        if let urlError = error as? URLError {
            let isTransient = Self.isRetryable(urlError)
            let message = isTransient ? context.transientFailureMessage : context.fallbackFailureMessage
            return Self.makePresentation(message: message, isTransient: isTransient, underlying: error)
        }
        if error is GatewayDecodingError {
            return Self.makePresentation(
                message: context.fallbackFailureMessage,
                isTransient: false,
                underlying: error)
        }
        if let response = error as? GatewayResponseError {
            let message = response.message.trimmingCharacters(in: .whitespacesAndNewlines)
            if message.isEmpty || Self.isTechnicalMessage(message) {
                return Self.makePresentation(
                    message: context.fallbackFailureMessage,
                    isTransient: false,
                    underlying: error)
            }
            return Self.makePresentation(message: message, isTransient: false, underlying: error)
        }

        let description =
            ((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if description.isEmpty {
            return Self.makePresentation(
                message: context.fallbackFailureMessage,
                isTransient: false,
                underlying: error)
        }
        if description.localizedCaseInsensitiveContains("gateway not configured") {
            return Self.makePresentation(
                message: context.transientFailureMessage,
                isTransient: true,
                underlying: error)
        }
        if Self.isTechnicalMessage(description) {
            return Self.makePresentation(
                message: context.fallbackFailureMessage,
                isTransient: false,
                underlying: error)
        }
        return Self.makePresentation(message: description, isTransient: false, underlying: error)
    }

    private static func makePresentation(
        message: String,
        isTransient: Bool,
        underlying: Error) -> AlisioAccountErrorPresentation
    {
        let error = NSError(
            domain: "AlisioAccount",
            code: isTransient ? 2 : 1,
            userInfo: [
                NSLocalizedDescriptionKey: message,
                NSUnderlyingErrorKey: underlying,
            ])
        return AlisioAccountErrorPresentation(message: message, isTransient: isTransient, error: error)
    }

    private static func isRetryable(_ error: URLError) -> Bool {
        switch error.code {
        case .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .networkConnectionLost, .notConnectedToInternet, .timedOut:
            true
        default:
            false
        }
    }

    private static func isTechnicalMessage(_ message: String) -> Bool {
        let lower = message.lowercased()
        return lower.contains("[readiness:") ||
            lower.contains("gateway on port") ||
            lower.contains("gateway request timed out") ||
            lower.contains("gateway not configured") ||
            lower.contains("while preparing") ||
            lower.contains("health check") ||
            lower.contains("launchd") ||
            lower.contains("protocol mismatch") ||
            lower.contains("127.0.0.1") ||
            lower.contains("localhost") ||
            lower.contains("ws://") ||
            lower.contains("alisio.account.")
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
