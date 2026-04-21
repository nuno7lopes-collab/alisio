import CoreLocation
import Foundation
import AppKit

import AlisioSupport
@MainActor
protocol MacNodeRuntimeMainActorServices: Sendable {
    func startComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload
    func stopComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload
    func pauseComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload
    func resumeComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload
    func observeComputer(_ sessionId: String) async throws -> MacNodeComputerObservePayload
    func performComputerActions(
        _ sessionId: String,
        actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload
    func computerContext(_ sessionId: String) async throws -> MacNodeComputerObservePayload.Context
    func computerPermissionState() async throws -> MacNodeComputerPermissionPayload
    func computerHealth(sessionId: String?) async -> MacNodeComputerRuntimeHealthPayload
    func killComputerHelper() async -> MacNodeComputerRuntimeHealthPayload
    func recordScreen(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> (path: String, hasAudio: Bool)

    func locationAuthorizationStatus() -> CLAuthorizationStatus
    func locationAccuracyAuthorization() -> CLAccuracyAuthorization
    func isApplicationActive() -> Bool
    func currentLocation(
        desiredAccuracy: AlisioLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
}

extension MacNodeRuntimeMainActorServices {
    func startComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        throw NSError(
            domain: "MacNodeRuntimeMainActorServices",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "computer session start unsupported"])
    }

    func stopComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        throw NSError(
            domain: "MacNodeRuntimeMainActorServices",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "computer session stop unsupported"])
    }

    func pauseComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        throw NSError(
            domain: "MacNodeRuntimeMainActorServices",
            code: 3,
            userInfo: [NSLocalizedDescriptionKey: "computer session pause unsupported"])
    }

    func resumeComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        throw NSError(
            domain: "MacNodeRuntimeMainActorServices",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "computer session resume unsupported"])
    }

    func observeComputer(_ sessionId: String) async throws -> MacNodeComputerObservePayload {
        throw NSError(
            domain: "MacNodeRuntimeMainActorServices",
            code: 5,
            userInfo: [NSLocalizedDescriptionKey: "computer observe unsupported"])
    }

    func performComputerActions(
        _ sessionId: String,
        actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload
    {
        throw NSError(
            domain: "MacNodeRuntimeMainActorServices",
            code: 6,
            userInfo: [NSLocalizedDescriptionKey: "computer actions unsupported"])
    }

    func computerContext(_ sessionId: String) async throws -> MacNodeComputerObservePayload.Context {
        throw NSError(
            domain: "MacNodeRuntimeMainActorServices",
            code: 7,
            userInfo: [NSLocalizedDescriptionKey: "computer context unsupported"])
    }

    func computerPermissionState() async throws -> MacNodeComputerPermissionPayload {
        throw NSError(
            domain: "MacNodeRuntimeMainActorServices",
            code: 8,
            userInfo: [NSLocalizedDescriptionKey: "computer permissions unsupported"])
    }

    func computerHealth(sessionId: String?) async -> MacNodeComputerRuntimeHealthPayload {
        MacNodeComputerRuntimeHealthPayload(
            connectionState: .invalidated,
            launchCount: 0,
            helper: nil,
            lastError: MacNodeComputerHelperErrorPayload(
                code: .helperUnavailable,
                message: "computer helper unavailable",
                retryable: true))
    }

    func killComputerHelper() async -> MacNodeComputerRuntimeHealthPayload {
        await self.computerHealth(sessionId: nil)
    }
}

@MainActor
final class LiveMacNodeRuntimeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
    static let shared = LiveMacNodeRuntimeMainActorServices()

    private let computerHelper = MacNodeComputerHelperClient()
    private let screenRecorder = ScreenRecordService()
    private let locationService = MacNodeLocationService()

    func startComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        self.withCurrentComputerPermissions(try await self.computerHelper.startSession(sessionId))
    }

    func stopComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        self.withCurrentComputerPermissions(try await self.computerHelper.stopSession(sessionId))
    }

    func pauseComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        self.withCurrentComputerPermissions(try await self.computerHelper.pauseSession(sessionId))
    }

    func resumeComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        self.withCurrentComputerPermissions(try await self.computerHelper.resumeSession(sessionId))
    }

    func observeComputer(_ sessionId: String) async throws -> MacNodeComputerObservePayload {
        try await self.computerHelper.captureFrame(sessionId: sessionId)
    }

    func performComputerActions(
        _ sessionId: String,
        actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload
    {
        try await self.computerHelper.performActions(sessionId: sessionId, actions: actions)
    }

    func computerContext(_ sessionId: String) async throws -> MacNodeComputerObservePayload.Context {
        try await self.computerHelper.getContext(sessionId: sessionId)
    }

    func computerPermissionState() async throws -> MacNodeComputerPermissionPayload {
        ComputerControlService.currentPermissionState()
    }

    func computerHealth(sessionId: String?) async -> MacNodeComputerRuntimeHealthPayload {
        await self.computerHelper.health(sessionId: sessionId)
    }

    func killComputerHelper() async -> MacNodeComputerRuntimeHealthPayload {
        await self.computerHelper.kill()
    }

    private func withCurrentComputerPermissions(
        _ payload: MacNodeComputerSessionPayload) -> MacNodeComputerSessionPayload
    {
        var updated = payload
        updated.permissions = ComputerControlService.currentPermissionState()
        return updated
    }

    func recordScreen(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> (path: String, hasAudio: Bool)
    {
        try await self.screenRecorder.record(
            screenIndex: screenIndex,
            durationMs: durationMs,
            fps: fps,
            includeAudio: includeAudio,
            outPath: outPath)
    }

    func locationAuthorizationStatus() -> CLAuthorizationStatus {
        self.locationService.authorizationStatus()
    }

    func locationAccuracyAuthorization() -> CLAccuracyAuthorization {
        self.locationService.accuracyAuthorization()
    }

    func isApplicationActive() -> Bool {
        NSApp.isActive
    }

    func currentLocation(
        desiredAccuracy: AlisioLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    {
        try await self.locationService.currentLocation(
            desiredAccuracy: desiredAccuracy,
            maxAgeMs: maxAgeMs,
            timeoutMs: timeoutMs)
    }
}
