import CoreLocation
import Foundation
import AlisioKit
import UIKit

typealias AlisioCameraSnapResult = (format: String, base64: String, width: Int, height: Int)
typealias AlisioCameraClipResult = (format: String, base64: String, durationMs: Int, hasAudio: Bool)

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: AlisioCameraSnapParams) async throws -> AlisioCameraSnapResult
    func clip(params: AlisioCameraClipParams) async throws -> AlisioCameraClipResult
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: AlisioLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: AlisioLocationGetParams,
        desiredAccuracy: AlisioLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: AlisioLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

@MainActor
protocol DeviceStatusServicing: Sendable {
    func status() async throws -> AlisioDeviceStatusPayload
    func info() -> AlisioDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: AlisioPhotosLatestParams) async throws -> AlisioPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: AlisioContactsSearchParams) async throws -> AlisioContactsSearchPayload
    func add(params: AlisioContactsAddParams) async throws -> AlisioContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: AlisioCalendarEventsParams) async throws -> AlisioCalendarEventsPayload
    func add(params: AlisioCalendarAddParams) async throws -> AlisioCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: AlisioRemindersListParams) async throws -> AlisioRemindersListPayload
    func add(params: AlisioRemindersAddParams) async throws -> AlisioRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: AlisioMotionActivityParams) async throws -> AlisioMotionActivityPayload
    func pedometer(params: AlisioPedometerParams) async throws -> AlisioPedometerPayload
}

struct WatchMessagingStatus: Sendable, Equatable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchQuickReplyEvent: Sendable, Equatable {
    var replyId: String
    var promptId: String
    var actionId: String
    var actionLabel: String?
    var sessionKey: String?
    var note: String?
    var sentAtMs: Int?
    var transport: String
}

struct WatchNotificationSendResult: Sendable, Equatable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setReplyHandler(_ handler: (@Sendable (WatchQuickReplyEvent) -> Void)?)
    func sendNotification(
        id: String,
        params: AlisioWatchNotifyParams) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
