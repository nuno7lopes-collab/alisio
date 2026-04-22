import AppKit
import Foundation
import Observation
import OSLog
import SwiftUI

import AlisioIPC
import AlisioSupport

@MainActor
protocol MacDesktopComputerSessionDriving: Sendable {
    func getSession(_ sessionKey: String) async throws -> GatewayConnection.ComputerSessionSnapshot
    func updateSession(
        _ sessionKey: String,
        command: GatewayConnection.ComputerSessionCommand) async throws -> GatewayConnection.ComputerSessionSnapshot
}

@MainActor
final class GatewayMacDesktopComputerSessionDriver: MacDesktopComputerSessionDriving, @unchecked Sendable {
    func getSession(_ sessionKey: String) async throws -> GatewayConnection.ComputerSessionSnapshot {
        try await GatewayConnection.shared.computerSession(sessionKey: sessionKey)
    }

    func updateSession(
        _ sessionKey: String,
        command: GatewayConnection.ComputerSessionCommand) async throws -> GatewayConnection.ComputerSessionSnapshot
    {
        try await GatewayConnection.shared.computerSession(sessionKey: sessionKey, command: command)
    }
}

@MainActor
@Observable
final class MacDesktopComputerStore {
    private static let refreshIntervalNanoseconds: UInt64 = 900_000_000
    private static let signedOutMessage = "Sign in to use computer control."

    private enum AccountGate {
        case authenticated
        case signedOut
        case unavailable(String)
    }

    let sessionKey: String

    private(set) var sessionState: MacNodeComputerSessionLifecycleState = .stopped
    private(set) var sessionStatus: GatewayConnection.ComputerSessionStatus = .stopped
    private(set) var blockingState: GatewayConnection.ComputerBlockingState?
    private(set) var permissions = MacNodeComputerPermissionPayload(
        accessibility: false,
        screenRecording: false)
    private(set) var runtime = MacNodeComputerRuntimeHealthPayload(
        connectionState: .idle,
        launchCount: 0,
        helper: nil,
        lastError: nil)
    private(set) var observation: MacNodeComputerObservePayload?
    private(set) var frameImage: NSImage?
    private(set) var errorText: String?
    private(set) var isBusy = false
    private(set) var lastUpdatedAt: Date?
    private(set) var permissionRestartHint: String?

    @ObservationIgnored
    private let services: any MacNodeRuntimeMainActorServices

    @ObservationIgnored
    private let sessionDriver: any MacDesktopComputerSessionDriving

    @ObservationIgnored
    private var refreshTask: Task<Void, Never>?

    @ObservationIgnored
    private let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "desktop.computer")

    init(
        sessionKey: String,
        services: any MacNodeRuntimeMainActorServices = LiveMacNodeRuntimeMainActorServices.shared,
        sessionDriver: any MacDesktopComputerSessionDriving = GatewayMacDesktopComputerSessionDriver())
    {
        self.sessionKey = sessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "main" : sessionKey
        self.services = services
        self.sessionDriver = sessionDriver
    }

    deinit {
        self.refreshTask?.cancel()
    }

    var needsPermissionGuidance: Bool {
        self.showsPermissionActions
    }

    var needsObservationPermission: Bool {
        !self.permissions.screenRecording
    }

    var needsControlPermission: Bool {
        !self.permissions.accessibility
    }

    var showsPermissionActions: Bool {
        self.permissionRestartHint != nil || self.needsObservationPermission || self.needsControlPermission
    }

    var canStartSession: Bool {
        self.permissions.screenRecording && self.permissions.screenRecordingRestartRequired != true
    }

    var shouldAutoPresentPane: Bool {
        self.sessionStatus != .stopped ||
            self.frameImage != nil ||
            self.observation != nil ||
            self.errorText != nil ||
            self.blockingSummary != nil
    }

    var blockingSummary: String? {
        let trimmed = self.blockingState?.summary.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    var statusLabel: String {
        if let blockingSummary {
            return blockingSummary
        }
        if let errorText, !errorText.isEmpty {
            return errorText
        }
        switch self.sessionStatus {
        case .running, .observing:
            return "Running"
        case .paused:
            return "Paused"
        case .idle:
            return self.runtime.connectionState == .running ? "Ready" : "Idle"
        case .error:
            return "Computer unavailable"
        case .stopped:
            return "Stopped"
        case .blockedOnFocus:
            return "Foreground control required"
        case .blockedOnApproval:
            return "Waiting for approval"
        case .blockedOnRuntime:
            return "Runtime busy"
        case .blockedOnPermissions:
            return "Permission required"
        case .blockedOnRestartRequired:
            return "Restart required"
        }
    }

    func activate() {
        guard self.refreshTask == nil else { return }
        self.refreshTask = Task { [weak self] in
            guard let self else { return }
            await self.bootstrap()
            while !Task.isCancelled {
                await self.refreshObservation()
                try? await Task.sleep(nanoseconds: Self.refreshIntervalNanoseconds)
            }
        }
    }

    func deactivate(stopSession: Bool = false) {
        self.refreshTask?.cancel()
        self.refreshTask = nil
        guard stopSession else { return }
        Task {
            do {
                let session = try await self.sessionDriver.updateSession(self.sessionKey, command: .stop)
                await MainActor.run {
                    self.applySession(session)
                    self.clearObservation()
                }
            } catch {
                await MainActor.run {
                    self.handle(error: error)
                }
            }
        }
    }

    func requestObservationPermission() {
        self.requestPermissions([.screenRecording])
    }

    func requestControlPermission() {
        self.requestPermissions([.accessibility])
    }

    private func requestPermissions(_ capabilities: [Capability]) {
        Task {
            let previousPermissions = self.permissions
            _ = await PermissionManager.ensure(capabilities, interactive: true)
            let refreshedPermissions = await self.refreshPermissionState(fallback: previousPermissions)
            await MainActor.run {
                self.permissions = refreshedPermissions
                PermissionRestartCoordinator.shared.markRequested(
                    capabilities,
                    currentStatus: Self.statusDictionary(from: refreshedPermissions),
                    restartRequired: Self.restartDictionary(from: refreshedPermissions))
                self.permissionRestartHint = Self.resolvePermissionRestartHint(permissions: refreshedPermissions)
                    ?? Self.resolveRequestedPermissionRestartHint(
                        requestedCapabilities: capabilities,
                        permissions: refreshedPermissions)
                if refreshedPermissions.accessibility || refreshedPermissions.screenRecording {
                    self.errorText = nil
                }
            }
            await self.bootstrap()
        }
    }

    func pause() {
        self.transition(.pause)
    }

    func resume() {
        self.transition(.resume)
    }

    func stop() {
        self.transition(.stop)
    }

    func start() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            let gate = await self.accountGate(reason: GatewayConnection.Method.computerSessionUpdate.rawValue)
            guard self.applyAccountGate(gate, signedOutMessage: Self.signedOutMessage) else { return }
            if self.permissions.screenRecordingRestartRequired == true {
                self.errorText = "Restart Alisio to refresh Screen Recording access"
                self.permissionRestartHint = Self.resolvePermissionRestartHint(permissions: self.permissions)
                return
            }
            guard self.canStartSession else {
                self.errorText = "Screen Recording permission required"
                self.permissionRestartHint = Self.resolveRequestedPermissionRestartHint(
                    requestedCapabilities: [.screenRecording],
                    permissions: self.permissions)
                return
            }
            self.runTransition(.start)
        }
    }

    private var shouldObserveFrames: Bool {
        guard self.permissions.screenRecording, self.permissions.screenRecordingRestartRequired != true else {
            return false
        }
        guard self.runtime.connectionState == .running else { return false }
        switch self.sessionState {
        case .running, .paused:
            return true
        case .stopped:
            return false
        }
    }

    private func bootstrap() async {
        let gate = await self.accountGate(reason: GatewayConnection.Method.computerSessionGet.rawValue)
        guard self.applyAccountGate(gate, signedOutMessage: Self.signedOutMessage) else { return }
        await self.refreshSessionState()
        guard self.shouldObserveFrames else { return }
        await self.refreshObservationFrame()
    }

    private func refreshObservation() async {
        let gate = await self.accountGate(reason: GatewayConnection.Method.computerSessionGet.rawValue)
        guard self.applyAccountGate(gate, signedOutMessage: Self.signedOutMessage) else { return }
        await self.refreshSessionState()
        guard self.shouldObserveFrames else { return }
        await self.refreshObservationFrame()
    }

    private func transition(_ command: GatewayConnection.ComputerSessionCommand) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            let gate = await self.accountGate(reason: GatewayConnection.Method.computerSessionUpdate.rawValue)
            guard self.applyAccountGate(gate, signedOutMessage: Self.signedOutMessage) else { return }
            self.runTransition(command)
        }
    }

    private func runTransition(_ command: GatewayConnection.ComputerSessionCommand) {
        guard !self.isBusy else { return }
        self.isBusy = true
        Task {
            defer {
                Task { @MainActor in
                    self.isBusy = false
                }
            }
            do {
                let session = try await self.sessionDriver.updateSession(self.sessionKey, command: command)
                await MainActor.run {
                    self.applySession(session)
                    if session.status == .stopped {
                        self.clearObservation()
                    }
                }
                guard command != .stop else { return }
                await self.refreshObservation()
            } catch {
                await MainActor.run {
                    self.handle(error: error)
                }
            }
        }
    }

    private func applySession(_ session: GatewayConnection.ComputerSessionSnapshot) {
        self.sessionStatus = session.status
        self.blockingState = session.blocking
        self.permissions = Self.permissionPayload(from: session.permissions)
        self.runtime = Self.runtimePayload(from: session.runtime)
        self.permissionRestartHint = Self.resolvePermissionRestartHint(permissions: self.permissions)
        if self.blockingSummary != nil {
            self.errorText = nil
        } else if let lastError = session.lastError?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !lastError.isEmpty
        {
            self.errorText = lastError
        } else {
            self.errorText = session.runtime?.lastError?.message
        }
        Self.reconcileRestartCoordinator(permissions: self.permissions)
        self.syncSessionStateFromSession()
    }

    private func handle(error: Error) {
        self.runtime = self.runtimeWith(error: error, fallback: self.runtime)
        self.errorText = self.userFacingMessage(for: error)
        self.permissionRestartHint = Self.resolvePermissionRestartHint(permissions: self.permissions)
        if let helperSession = self.runtime.helper?.activeSession,
           helperSession.sessionId == self.sessionKey
        {
            self.sessionState = helperSession.state
        } else if self.runtime.connectionState == .invalidated || self.runtime.connectionState == .disabled {
            self.sessionStatus = .blockedOnRuntime
            self.blockingState = self.blockingState ?? GatewayConnection.ComputerBlockingState(
                kind: .blockedOnRuntime,
                reasonCode: "runtime_unavailable",
                summary: "computer helper unavailable",
                at: Int(Date().timeIntervalSince1970 * 1000))
            self.sessionState = .stopped
            self.clearObservation()
        }
    }

    private func refreshSessionState() async {
        do {
            let session = try await self.sessionDriver.getSession(self.sessionKey)
            await MainActor.run {
                self.applySession(session)
            }
        } catch {
            await MainActor.run {
                self.handle(error: error)
            }
        }
    }

    private func refreshObservationFrame() async {
        do {
            let payload = try await self.services.observeComputer(self.sessionKey)
            self.observation = payload
            self.frameImage = Self.decodeImage(from: payload.frame.dataUrl)
            self.lastUpdatedAt = Date()
            self.errorText = nil
            if self.permissionRestartHint == nil {
                self.permissionRestartHint = Self.resolvePermissionRestartHint(permissions: self.permissions)
            }
            if let helperSession = self.runtime.helper?.activeSession,
               helperSession.sessionId == self.sessionKey
            {
                self.sessionState = helperSession.state
            } else if self.sessionState == .stopped {
                self.sessionState = .running
            }
        } catch {
            self.handle(error: error)
        }
    }

    private func refreshPermissionState(
        fallback: MacNodeComputerPermissionPayload) async -> MacNodeComputerPermissionPayload
    {
        do {
            let permissions = try await self.services.computerPermissionState()
            Self.reconcileRestartCoordinator(permissions: permissions)
            return permissions
        } catch {
            self.logger.error("computer permissions refresh failed \(error.localizedDescription, privacy: .public)")
            return fallback
        }
    }

    private func syncSessionStateFromSession() {
        if let helperSession = self.runtime.helper?.activeSession,
           helperSession.sessionId == self.sessionKey
        {
            self.sessionState = helperSession.state
            return
        }

        switch self.sessionStatus {
        case .paused:
            self.sessionState = .paused
        case .running, .observing, .blockedOnFocus, .blockedOnApproval:
            self.sessionState = .running
        case .idle, .blockedOnRuntime:
            if self.runtime.connectionState != .running {
                self.sessionState = .stopped
            }
        case .blockedOnPermissions, .blockedOnRestartRequired, .error, .stopped:
            self.sessionState = .stopped
        }

        if self.sessionState == .stopped &&
            (self.sessionStatus == .stopped ||
                self.sessionStatus == .blockedOnPermissions ||
                self.sessionStatus == .blockedOnRestartRequired ||
                self.runtime.connectionState == .invalidated ||
                self.runtime.connectionState == .disabled)
        {
            self.clearObservation()
        }
    }

    private func clearObservation() {
        self.observation = nil
        self.frameImage = nil
    }

    private static func permissionPayload(
        from permissions: GatewayConnection.ComputerPermissionSnapshot) -> MacNodeComputerPermissionPayload
    {
        let accessibility = permissions.accessibility
            ?? (permissions.control == .granted || permissions.control == .restartRequired)
        let screenRecording = permissions.screenRecording
            ?? (permissions.observation == .granted || permissions.observation == .restartRequired)
        return MacNodeComputerPermissionPayload(
            accessibility: accessibility,
            screenRecording: screenRecording,
            accessibilityRestartRequired: permissions.control == .restartRequired,
            screenRecordingRestartRequired: permissions.observation == .restartRequired)
    }

    private static func runtimePayload(
        from runtime: GatewayConnection.ComputerRuntimeSnapshot?) -> MacNodeComputerRuntimeHealthPayload
    {
        guard let runtime else {
            return MacNodeComputerRuntimeHealthPayload(
                connectionState: .idle,
                launchCount: 0,
                helper: nil,
                lastError: nil)
        }
        return MacNodeComputerRuntimeHealthPayload(
            connectionState: runtime.connectionState,
            launchCount: runtime.launchCount,
            helper: MacNodeComputerHelperHealthPayload(
                protocolVersion: runtime.helperProtocolVersion ?? macNodeComputerHelperProtocolVersion,
                helperVersion: runtime.helperVersion ?? "gateway",
                processId: Int32(runtime.helperProcessId ?? 0),
                activeSession: runtime.activeSession.map {
                    MacNodeComputerHelperSessionSummary(
                        sessionId: $0.sessionKey,
                        state: $0.state,
                        updatedAt: $0.updatedAt)
                },
                lastError: runtime.lastError),
            lastError: runtime.lastError)
    }

    private static func resolvePermissionRestartHint(
        permissions: MacNodeComputerPermissionPayload) -> String?
    {
        let observationRestart = permissions.screenRecordingRestartRequired == true
        let controlRestart = permissions.accessibilityRestartRequired == true
        guard observationRestart || controlRestart else {
            return nil
        }

        if observationRestart && controlRestart {
            return "Screen Recording and Accessibility were granted, but macOS still requires an Alisio restart."
        }
        if observationRestart {
            return "Screen Recording was granted, but macOS still requires an Alisio restart."
        }
        return "Accessibility was granted, but macOS still requires an Alisio restart."
    }

    private static func resolveRequestedPermissionRestartHint(
        requestedCapabilities: [Capability],
        permissions: MacNodeComputerPermissionPayload) -> String?
    {
        let missingObservation = requestedCapabilities.contains(.screenRecording) && !permissions.screenRecording
        let missingControl = requestedCapabilities.contains(.accessibility) && !permissions.accessibility
        guard missingObservation || missingControl else {
            return nil
        }

        if missingObservation && missingControl {
            return "If you just enabled Screen Recording or Accessibility in System Settings, restart Alisio before checking again."
        }
        if missingObservation {
            return "If you just enabled Screen Recording in System Settings, restart Alisio before checking again."
        }
        return "If you just enabled Accessibility in System Settings, restart Alisio before checking again."
    }

    private func runtimeWith(
        error: Error,
        fallback: MacNodeComputerRuntimeHealthPayload) -> MacNodeComputerRuntimeHealthPayload
    {
        if let helperError = error as? MacNodeComputerHelperErrorPayload {
            return MacNodeComputerRuntimeHealthPayload(
                connectionState: helperError.retryable ? .invalidated : .disabled,
                launchCount: fallback.launchCount,
                helper: fallback.helper,
                lastError: helperError)
        }

        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        if message.hasPrefix("PERMISSION_MISSING:") {
            let permissionName = message.replacingOccurrences(of: "PERMISSION_MISSING:", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let helperError = MacNodeComputerHelperErrorPayload(
                code: .permissionMissing,
                message: message,
                retryable: false,
                permission: permissionName.isEmpty ? nil : permissionName)
            return MacNodeComputerRuntimeHealthPayload(
                connectionState: .running,
                launchCount: fallback.launchCount,
                helper: fallback.helper,
                lastError: helperError)
        }

        let helperError = MacNodeComputerHelperErrorPayload(
            code: .helperUnavailable,
            message: message.isEmpty ? "computer helper unavailable" : message,
            retryable: true)
        return MacNodeComputerRuntimeHealthPayload(
            connectionState: .invalidated,
            launchCount: fallback.launchCount,
            helper: fallback.helper,
            lastError: helperError)
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

    private func applyAccountGate(_ gate: AccountGate, signedOutMessage: String) -> Bool {
        switch gate {
        case .authenticated:
            return true
        case .signedOut:
            self.applyAccountUnavailableState(message: signedOutMessage, retryable: false)
            return false
        case let .unavailable(message):
            self.applyAccountUnavailableState(message: message, retryable: true)
            return false
        }
    }

    private func applyAccountUnavailableState(message: String, retryable: Bool) {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved = trimmed.isEmpty ? "Computer unavailable" : trimmed
        self.errorText = resolved
        self.sessionStatus = .blockedOnRuntime
        self.sessionState = .stopped
        self.blockingState = nil
        self.permissionRestartHint = Self.resolvePermissionRestartHint(permissions: self.permissions)
        self.clearObservation()
        self.runtime = MacNodeComputerRuntimeHealthPayload(
            connectionState: retryable ? .invalidated : .idle,
            launchCount: self.runtime.launchCount,
            helper: self.runtime.helper,
            lastError: retryable
                ? MacNodeComputerHelperErrorPayload(
                    code: .helperUnavailable,
                    message: resolved,
                    retryable: true)
                : nil)
    }

    private func userFacingMessage(for error: Error) -> String {
        let raw = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return "Computer unavailable" }
        if raw == "PERMISSION_MISSING: screenRecording" {
            return "Screen Recording permission required"
        }
        if raw == "PERMISSION_MISSING: accessibility" {
            return "Accessibility permission required"
        }
        return raw
    }

    private static func decodeImage(from dataUrl: String) -> NSImage? {
        guard let marker = dataUrl.range(of: ",") else { return nil }
        let encoded = String(dataUrl[marker.upperBound...])
        guard let data = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters) else { return nil }
        return NSImage(data: data)
    }

    private static func statusDictionary(from permissions: MacNodeComputerPermissionPayload) -> [Capability: Bool] {
        [
            .accessibility: permissions.accessibility,
            .screenRecording: permissions.screenRecording,
        ]
    }

    private static func restartDictionary(
        from permissions: MacNodeComputerPermissionPayload) -> [Capability: Bool]
    {
        [
            .accessibility: permissions.accessibilityRestartRequired == true,
            .screenRecording: permissions.screenRecordingRestartRequired == true,
        ]
    }

    private static func reconcileRestartCoordinator(permissions: MacNodeComputerPermissionPayload) {
        PermissionRestartCoordinator.shared.reconcile(
            status: self.statusDictionary(from: permissions),
            restartRequired: self.restartDictionary(from: permissions))
    }
}

#if DEBUG
@MainActor
extension MacDesktopComputerStore {
    static func preview(
        sessionKey: String = "main",
        sessionState: MacNodeComputerSessionLifecycleState = .stopped,
        permissions: MacNodeComputerPermissionPayload = MacNodeComputerPermissionPayload(
            accessibility: true,
            screenRecording: true),
        runtime: MacNodeComputerRuntimeHealthPayload = MacNodeComputerRuntimeHealthPayload(
            connectionState: .running,
            launchCount: 1,
            helper: nil,
            lastError: nil),
        observation: MacNodeComputerObservePayload? = nil,
        frameImage: NSImage? = nil,
        errorText: String? = nil,
        lastUpdatedAt: Date? = nil,
        permissionRestartHint: String? = nil) -> MacDesktopComputerStore
    {
        let store = MacDesktopComputerStore(sessionKey: sessionKey)
        store.sessionState = sessionState
        store.sessionStatus = switch sessionState {
        case .running:
            .running
        case .paused:
            .paused
        case .stopped:
            .stopped
        }
        store.permissions = permissions
        store.runtime = runtime
        store.observation = observation
        store.frameImage = frameImage
        store.errorText = errorText
        store.lastUpdatedAt = lastUpdatedAt
        store.permissionRestartHint = permissionRestartHint
        return store
    }
}
#endif
