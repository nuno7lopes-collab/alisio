import CoreLocation
import Foundation
import AppKit

import AlisioSupport
@MainActor
protocol MacNodeRuntimeMainActorServices: Sendable {
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

@MainActor
final class LiveMacNodeRuntimeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
    private let screenRecorder = ScreenRecordService()
    private let locationService = MacNodeLocationService()

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
