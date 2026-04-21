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
            observationResult: .success(Self.makeObservation(sessionId: "main")))
        let sessionDriver = FakeComputerSessionDriver(
            snapshot: Self.makeSessionSnapshot(
                sessionId: "main",
                status: .running,
                lifecycleState: .running))
        let store = MacDesktopComputerStore(
            sessionKey: "",
            services: services,
            sessionDriver: sessionDriver)

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
        #expect(store.shouldAutoPresentPane == true)
        #expect(store.statusLabel == "Running")
        #expect(sessionDriver.commandCalls.isEmpty)
        #expect(services.observeCalls >= 1)
    }

    @Test func `activate does not auto-start a stopped session`() async throws {
        let services = FakeMainActorServices(
            permissions: .init(accessibility: true, screenRecording: true),
            observationResult: .success(Self.makeObservation(sessionId: "main")))
        let sessionDriver = FakeComputerSessionDriver(
            snapshot: Self.makeSessionSnapshot(
                sessionId: "main",
                status: .stopped,
                lifecycleState: nil))
        let store = MacDesktopComputerStore(
            sessionKey: "main",
            services: services,
            sessionDriver: sessionDriver)

        store.activate()
        defer { store.deactivate(stopSession: true) }

        try await self.waitUntil("initial runtime sync") {
            store.sessionState == .stopped
        }

        #expect(store.frameImage == nil)
        #expect(store.observation == nil)
        #expect(store.shouldAutoPresentPane == false)
        #expect(sessionDriver.commandCalls.isEmpty)
        #expect(services.observeCalls == 0)
    }

    @Test func `start explicitly begins a stopped session once observation permission exists`() async throws {
        let services = FakeMainActorServices(
            permissions: .init(accessibility: true, screenRecording: true),
            observationResult: .success(Self.makeObservation(sessionId: "main")))
        let sessionDriver = FakeComputerSessionDriver(
            snapshot: Self.makeSessionSnapshot(
                sessionId: "main",
                status: .stopped,
                lifecycleState: nil),
            updatedSnapshots: [
                .start: Self.makeSessionSnapshot(
                    sessionId: "main",
                    status: .idle,
                    lifecycleState: .running),
                .stop: Self.makeSessionSnapshot(
                    sessionId: "main",
                    status: .stopped,
                    lifecycleState: nil),
            ])
        let store = MacDesktopComputerStore(
            sessionKey: "main",
            services: services,
            sessionDriver: sessionDriver)

        store.activate()
        try await self.waitUntil("screen recording state to refresh") {
            store.canStartSession
        }
        store.start()
        defer { store.deactivate(stopSession: true) }

        try await self.waitUntil("session start to capture frame") {
            store.frameImage != nil && store.sessionState == .running
        }

        #expect(sessionDriver.commandCalls.contains(.start))
        #expect(services.observeCalls >= 1)
    }

    @Test func `activate surfaces permission guidance when observation is blocked`() async throws {
        let services = FakeMainActorServices(
            permissions: .init(accessibility: false, screenRecording: true),
            observationResult: .failure(NSError(
                domain: "MacDesktopComputerStoreTests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "PERMISSION_MISSING: accessibility"])))
        let sessionDriver = FakeComputerSessionDriver(
            snapshot: Self.makeSessionSnapshot(
                sessionId: "main",
                status: .running,
                lifecycleState: .running,
                permissions: .init(
                    accessibility: false,
                    screenRecording: true,
                    observation: .granted,
                    control: .missing)))
        let store = MacDesktopComputerStore(
            sessionKey: "main",
            services: services,
            sessionDriver: sessionDriver)

        store.activate()
        defer { store.deactivate(stopSession: true) }

        try await self.waitUntil("permission error to surface") {
            store.errorText == "Accessibility permission required"
        }

        #expect(store.errorText == "Accessibility permission required")
        #expect(store.needsPermissionGuidance == true)
        #expect(store.shouldAutoPresentPane == true)
        #expect(store.statusLabel == "Accessibility permission required")
        #expect(store.runtime.lastError?.code == .permissionMissing)
        #expect(store.runtime.lastError?.permission == "accessibility")
    }

    @Test func `shared session restart required surfaces honest restart guidance`() async throws {
        let services = FakeMainActorServices(
            permissions: .init(
                accessibility: true,
                screenRecording: true,
                accessibilityRestartRequired: true,
                screenRecordingRestartRequired: true),
            observationResult: .success(Self.makeObservation(sessionId: "main")))
        let sessionDriver = FakeComputerSessionDriver(
            snapshot: Self.makeSessionSnapshot(
                sessionId: "main",
                status: .blockedOnRestartRequired,
                lifecycleState: nil,
                permissions: .init(
                    accessibility: true,
                    screenRecording: true,
                    observation: .restartRequired,
                    control: .restartRequired),
                blocking: .init(
                    kind: .blockedOnRestartRequired,
                    reasonCode: "observation_restart_required",
                    summary: "Restart Alisio to pick up newly granted Screen Recording access.",
                    at: 1)))
        let store = MacDesktopComputerStore(
            sessionKey: "main",
            services: services,
            sessionDriver: sessionDriver)

        store.activate()
        defer { store.deactivate(stopSession: true) }

        try await self.waitUntil("restart hint to surface") {
            store.permissionRestartHint != nil
        }

        #expect(store.canStartSession == false)
        #expect(store.shouldAutoPresentPane == true)
        #expect(store.blockingSummary == "Restart Alisio to pick up newly granted Screen Recording access.")
        #expect(
            store.permissionRestartHint ==
                "Screen Recording and Accessibility were granted, but macOS still requires an Alisio restart.")
        #expect(store.showsPermissionActions == true)
        #expect(services.observeCalls == 0)
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

    private static func makeSessionSnapshot(
        sessionId: String,
        status: GatewayConnection.ComputerSessionStatus,
        lifecycleState: MacNodeComputerSessionLifecycleState?,
        permissions: GatewayConnection.ComputerPermissionSnapshot = .init(
            accessibility: true,
            screenRecording: true,
            observation: .granted,
            control: .granted),
        blocking: GatewayConnection.ComputerBlockingState? = nil) -> GatewayConnection.ComputerSessionSnapshot
    {
        GatewayConnection.ComputerSessionSnapshot(
            sessionKey: sessionId,
            status: status,
            blocking: blocking,
            permissions: permissions,
            runtime: .init(
                connectionState: .running,
                launchCount: 1,
                helperProtocolVersion: macNodeComputerHelperProtocolVersion,
                helperVersion: "test",
                helperProcessId: 42,
                activeSession: {
                    guard let lifecycleState else { return nil }
                    return .init(sessionKey: sessionId, state: lifecycleState, updatedAt: 1)
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
    let observationResult: Result<MacNodeComputerObservePayload, Error>

    private(set) var observeCalls = 0

    init(
        permissions: MacNodeComputerPermissionPayload,
        observationResult: Result<MacNodeComputerObservePayload, Error>)
    {
        self.permissions = permissions
        self.observationResult = observationResult
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
        MacNodeComputerRuntimeHealthPayload(
            connectionState: .running,
            launchCount: 1,
            helper: .init(
                protocolVersion: macNodeComputerHelperProtocolVersion,
                helperVersion: "test",
                processId: 42,
                activeSession: nil,
                lastError: nil),
            lastError: nil)
    }

    func killComputerHelper() async -> MacNodeComputerRuntimeHealthPayload {
        await self.computerHealth(sessionId: nil)
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

@MainActor
private final class FakeComputerSessionDriver: MacDesktopComputerSessionDriving, @unchecked Sendable {
    private(set) var snapshot: GatewayConnection.ComputerSessionSnapshot
    private let updatedSnapshots: [GatewayConnection.ComputerSessionCommand: GatewayConnection.ComputerSessionSnapshot]

    private(set) var commandCalls: [GatewayConnection.ComputerSessionCommand] = []

    init(
        snapshot: GatewayConnection.ComputerSessionSnapshot,
        updatedSnapshots: [GatewayConnection.ComputerSessionCommand: GatewayConnection.ComputerSessionSnapshot] = [:])
    {
        self.snapshot = snapshot
        self.updatedSnapshots = updatedSnapshots
    }

    func getSession(_ sessionKey: String) async throws -> GatewayConnection.ComputerSessionSnapshot {
        #expect(sessionKey.isEmpty == false)
        return self.snapshot
    }

    func updateSession(
        _ sessionKey: String,
        command: GatewayConnection.ComputerSessionCommand) async throws -> GatewayConnection.ComputerSessionSnapshot
    {
        #expect(sessionKey.isEmpty == false)
        self.commandCalls.append(command)
        if let updated = self.updatedSnapshots[command] {
            self.snapshot = updated
        }
        return self.snapshot
    }
}
