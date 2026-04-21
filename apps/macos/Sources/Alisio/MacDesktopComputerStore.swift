import AppKit
import Foundation
import Observation
import OSLog
import SwiftUI

import AlisioIPC
import AlisioSupport
@MainActor
@Observable
final class MacDesktopComputerStore {
    private static let refreshIntervalNanoseconds: UInt64 = 900_000_000

    let sessionKey: String

    private(set) var sessionState: MacNodeComputerSessionLifecycleState = .stopped
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
    private var refreshTask: Task<Void, Never>?

    @ObservationIgnored
    private let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "desktop.computer")

    init(
        sessionKey: String,
        services: any MacNodeRuntimeMainActorServices = LiveMacNodeRuntimeMainActorServices.shared)
    {
        self.sessionKey = sessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "main" : sessionKey
        self.services = services
    }

    deinit {
        self.refreshTask?.cancel()
    }

    var needsPermissionGuidance: Bool {
        !self.permissions.accessibility || !self.permissions.screenRecording
    }

    var needsObservationPermission: Bool {
        !self.permissions.screenRecording
    }

    var needsControlPermission: Bool {
        !self.permissions.accessibility
    }

    var canStartSession: Bool {
        self.permissions.screenRecording
    }

    var shouldAutoPresentPane: Bool {
        self.sessionState != .stopped || self.frameImage != nil || self.observation != nil || self.errorText != nil
    }

    var statusLabel: String {
        if let errorText, !errorText.isEmpty {
            return errorText
        }
        switch self.sessionState {
        case .running:
            return "Running"
        case .paused:
            return "Paused"
        case .stopped:
            return "Stopped"
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
                let payload = try await self.services.stopComputerSession(self.sessionKey)
                await MainActor.run {
                    self.applySession(payload)
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
                    currentStatus: Self.statusDictionary(from: refreshedPermissions))
                self.permissionRestartHint = Self.resolvePermissionRestartHint(
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
        self.transition { services, sessionKey in
            try await services.pauseComputerSession(sessionKey)
        }
    }

    func resume() {
        self.transition { services, sessionKey in
            try await services.resumeComputerSession(sessionKey)
        }
    }

    func stop() {
        self.transition { services, sessionKey in
            try await services.stopComputerSession(sessionKey)
        }
    }

    func start() {
        guard self.canStartSession else {
            self.errorText = "Screen Recording permission required"
            self.permissionRestartHint = Self.resolvePermissionRestartHint(
                requestedCapabilities: [.screenRecording],
                permissions: self.permissions)
            return
        }
        self.transition { services, sessionKey in
            try await services.startComputerSession(sessionKey)
        }
    }

    private func bootstrap() async {
        await self.refreshRuntimeAndPermissions()
        if self.sessionState != .stopped {
            await self.refreshObservationFrame()
        }
    }

    private func refreshObservation() async {
        await self.refreshRuntimeAndPermissions()
        guard self.sessionState != .stopped else { return }
        await self.refreshObservationFrame()
    }

    private func transition(
        _ action: @escaping @Sendable (
            any MacNodeRuntimeMainActorServices,
            String) async throws -> MacNodeComputerSessionPayload)
    {
        guard !self.isBusy else { return }
        self.isBusy = true
        Task {
            defer {
                Task { @MainActor in
                    self.isBusy = false
                }
            }
            do {
                let session = try await action(self.services, self.sessionKey)
                await MainActor.run {
                    self.applySession(session)
                    if session.state == .stopped {
                        self.observation = nil
                        self.frameImage = nil
                    }
                }
                if session.state != .stopped {
                    await self.refreshObservation()
                }
            } catch {
                await MainActor.run {
                    self.handle(error: error)
                }
            }
        }
    }

    private func applySession(_ session: MacNodeComputerSessionPayload) {
        self.sessionState = session.state
        self.permissions = session.permissions
        self.runtime = session.health
        self.errorText = session.health.lastError?.message
        if session.permissions.accessibility && session.permissions.screenRecording {
            self.permissionRestartHint = nil
        }
    }

    private func handle(error: Error) {
        self.runtime = self.runtimeWith(error: error, fallback: self.runtime)
        self.errorText = self.userFacingMessage(for: error)
        if self.runtime.helper?.activeSession?.sessionId == self.sessionKey {
            self.sessionState = self.runtime.helper?.activeSession?.state ?? self.sessionState
        } else if self.runtime.connectionState == .invalidated || self.runtime.connectionState == .disabled {
            self.sessionState = .stopped
        }
    }

    private func refreshRuntimeAndPermissions() async {
        self.runtime = await self.services.computerHealth(sessionId: self.sessionKey)
        self.permissions = await self.refreshPermissionState(fallback: self.permissions)
        self.syncSessionStateFromRuntime()
        if self.permissions.accessibility && self.permissions.screenRecording {
            self.permissionRestartHint = nil
        }
    }

    private func refreshObservationFrame() async {
        do {
            let payload = try await self.services.observeComputer(self.sessionKey)
            self.observation = payload
            self.frameImage = Self.decodeImage(from: payload.frame.dataUrl)
            self.lastUpdatedAt = Date()
            self.errorText = nil
            self.permissionRestartHint = nil
            if let helperSession = self.runtime.helper?.activeSession,
               helperSession.sessionId == self.sessionKey
            {
                self.sessionState = helperSession.state
            } else {
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
            return try await self.services.computerPermissionState()
        } catch {
            self.logger.error("computer permissions refresh failed \(error.localizedDescription, privacy: .public)")
            return fallback
        }
    }

    private func syncSessionStateFromRuntime() {
        if let helperSession = self.runtime.helper?.activeSession,
           helperSession.sessionId == self.sessionKey
        {
            self.sessionState = helperSession.state
            return
        }

        if self.runtime.connectionState == .invalidated || self.runtime.connectionState == .disabled {
            self.sessionState = .stopped
            self.observation = nil
            self.frameImage = nil
            return
        }

        self.sessionState = .stopped
        self.observation = nil
        self.frameImage = nil
    }

    private static func resolvePermissionRestartHint(
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
}
