import AppKit
import CoreLocation
import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct MacDesktopComputerStoreTests {
    @Test func `activate tracks an existing local computer session and captures a frame`() async throws {
        let services = FakeMainActorServices(
            permissions: .init(accessibility: true, screenRecording: true),
            health: Self.makeHealth(sessionId: "main", state: .running),
            sessionState: .running,
            observationResult: .success(Self.makeObservation(sessionId: "main")))
        let store = MacDesktopComputerStore(sessionKey: "", services: services)

        store.activate()
        defer { store.deactivate(stopSession: true) }

        try await self.waitUntil("frame image to load") {
            store.frameImage != nil && store.sessionState == .running && store.lastUpdatedAt != nil
        }

        #expect(store.sessionKey == "main")
        #expect(store.frameImage != nil)
        #expect(store.observation?.context.activeApp?.name == "Finder")
        #expect(store.observation?.context.activeWindow?.title == "Desktop")
        #expect(store.needsPermissionGuidance == false)
        #expect(services.startCalls == 0)
        #expect(services.observeCalls >= 1)
    }

    @Test func `activate does not auto-start a stopped session`() async throws {
        let services = FakeMainActorServices(
            permissions: .init(accessibility: true, screenRecording: true),
            health: Self.makeHealth(sessionId: nil, state: nil),
            sessionState: .running,
            observationResult: .success(Self.makeObservation(sessionId: "main")))
        let store = MacDesktopComputerStore(sessionKey: "main", services: services)

        store.activate()
        defer { store.deactivate(stopSession: true) }

        try await self.waitUntil("initial runtime sync") {
            store.sessionState == .stopped
        }

        #expect(store.frameImage == nil)
        #expect(store.observation == nil)
        #expect(services.startCalls == 0)
        #expect(services.observeCalls == 0)
    }

    @Test func `start explicitly begins a stopped session once observation permission exists`() async throws {
        let services = FakeMainActorServices(
            permissions: .init(accessibility: true, screenRecording: true),
            health: Self.makeHealth(sessionId: nil, state: nil),
            sessionState: .running,
            observationResult: .success(Self.makeObservation(sessionId: "main")))
        let store = MacDesktopComputerStore(sessionKey: "main", services: services)

        store.activate()
        try await self.waitUntil("screen recording state to refresh") {
            store.canStartSession
        }
        store.start()
        defer { store.deactivate(stopSession: true) }

        try await self.waitUntil("session start to capture frame") {
            store.frameImage != nil && store.sessionState == .running
        }

        #expect(services.startCalls >= 1)
        #expect(services.observeCalls >= 1)
    }

    @Test func `activate surfaces permission guidance when observation is blocked`() async throws {
        let services = FakeMainActorServices(
            permissions: .init(accessibility: false, screenRecording: true),
            health: Self.makeHealth(sessionId: "main", state: .running),
            sessionState: .running,
            observationResult: .failure(NSError(
                domain: "MacDesktopComputerStoreTests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "PERMISSION_MISSING: accessibility"])))
        let store = MacDesktopComputerStore(sessionKey: "main", services: services)

        store.activate()
        defer { store.deactivate(stopSession: true) }

        try await self.waitUntil("permission error to surface") {
            store.errorText == "Accessibility permission required"
        }

        #expect(store.errorText == "Accessibility permission required")
        #expect(store.needsPermissionGuidance == true)
        #expect(store.runtime.lastError?.code == .permissionMissing)
        #expect(store.runtime.lastError?.permission == "accessibility")
    }

    private func waitUntil(
        _ description: String,
        timeoutNanoseconds: UInt64 = 3_000_000_000,
        pollNanoseconds: UInt64 = 50_000_000,
        condition: @escaping @MainActor () -> Bool) async throws
    {
        let deadline = ContinuousClock.now.advanced(by: .nanoseconds(Int64(timeoutNanoseconds)))
        while ContinuousClock.now < deadline {
            if condition() {
                return
            }
            try await Task.sleep(nanoseconds: pollNanoseconds)
        }
        Issue.record("Timed out waiting for \(description)")
    }

    private static func makeObservation(sessionId: String) -> MacNodeComputerObservePayload {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        return MacNodeComputerObservePayload(
            frame: .init(
                id: "frame-\(sessionId)",
                dataUrl: Self.onePixelPNGDataURL,
                mimeType: "image/png",
                width: 1,
                height: 1,
                pixelWidth: 1,
                pixelHeight: 1,
                logicalWidth: 1440,
                logicalHeight: 900,
                scaleFactor: 2,
                orientation: .landscape,
                displayId: "main-display",
                sourceSpace: .displayPixel,
                capturedAt: now,
                maxAgeMs: 500,
                staleAt: now + 500,
                cursor: .init(x: 120, y: 80, visible: true)),
            context: .init(
                display: .init(
                    id: "main-display",
                    width: 2880,
                    height: 1800,
                    scale: 2,
                    logicalWidth: 1440,
                    logicalHeight: 900,
                    pixelWidth: 2880,
                    pixelHeight: 1800,
                    orientation: .landscape),
                activeApp: .init(name: "Finder", bundleId: "com.apple.finder", processId: 100),
                activeWindow: .init(title: "Desktop"),
                errorState: nil,
                capturedAt: now))
    }

    private static func makeHealth(
        sessionId: String?,
        state: MacNodeComputerSessionLifecycleState?) -> MacNodeComputerRuntimeHealthPayload
    {
        MacNodeComputerRuntimeHealthPayload(
            connectionState: .running,
            launchCount: 1,
            helper: .init(
                protocolVersion: macNodeComputerHelperProtocolVersion,
                helperVersion: "test",
                processId: 42,
                activeSession: {
                    guard let sessionId, let state else { return nil }
                    return .init(sessionId: sessionId, state: state, updatedAt: 1)
                }(),
                lastError: nil),
            lastError: nil)
    }

    private static let onePixelPNGDataURL =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+X8l9WQAAAABJRU5ErkJggg=="
}

@MainActor
private final class FakeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
    let permissions: MacNodeComputerPermissionPayload
    let healthPayload: MacNodeComputerRuntimeHealthPayload
    let sessionState: MacNodeComputerSessionLifecycleState
    let observationResult: Result<MacNodeComputerObservePayload, Error>

    private(set) var startCalls = 0
    private(set) var stopCalls = 0
    private(set) var observeCalls = 0

    init(
        permissions: MacNodeComputerPermissionPayload,
        health: MacNodeComputerRuntimeHealthPayload,
        sessionState: MacNodeComputerSessionLifecycleState,
        observationResult: Result<MacNodeComputerObservePayload, Error>)
    {
        self.permissions = permissions
        self.healthPayload = health
        self.sessionState = sessionState
        self.observationResult = observationResult
    }

    func startComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        self.startCalls += 1
        return .init(
            sessionId: sessionId,
            state: self.sessionState,
            permissions: self.permissions,
            health: self.healthPayload)
    }

    func stopComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        self.stopCalls += 1
        return .init(
            sessionId: sessionId,
            state: .stopped,
            permissions: self.permissions,
            health: self.healthPayload)
    }

    func pauseComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        .init(
            sessionId: sessionId,
            state: .paused,
            permissions: self.permissions,
            health: self.healthPayload)
    }

    func resumeComputerSession(_ sessionId: String) async throws -> MacNodeComputerSessionPayload {
        .init(
            sessionId: sessionId,
            state: .running,
            permissions: self.permissions,
            health: self.healthPayload)
    }

    func observeComputer(_ sessionId: String) async throws -> MacNodeComputerObservePayload {
        self.observeCalls += 1
        return try self.observationResult.get()
    }

    func performComputerActions(
        _ sessionId: String,
        actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload
    {
        .init(ok: true, summary: "noop", results: [])
    }

    func computerContext(_ sessionId: String) async throws -> MacNodeComputerObservePayload.Context {
        try self.observationResult.get().context
    }

    func computerPermissionState() async throws -> MacNodeComputerPermissionPayload {
        self.permissions
    }

    func computerHealth(sessionId: String?) async -> MacNodeComputerRuntimeHealthPayload {
        self.healthPayload
    }

    func killComputerHelper() async -> MacNodeComputerRuntimeHealthPayload {
        self.healthPayload
    }

    func recordScreen(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> (path: String, hasAudio: Bool)
    {
        ("", false)
    }

    func locationAuthorizationStatus() -> CLAuthorizationStatus {
        .authorizedAlways
    }

    func locationAccuracyAuthorization() -> CLAccuracyAuthorization {
        .fullAccuracy
    }

    func isApplicationActive() -> Bool {
        true
    }

    func currentLocation(
        desiredAccuracy: AlisioLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    {
        CLLocation(latitude: 0, longitude: 0)
    }
}
