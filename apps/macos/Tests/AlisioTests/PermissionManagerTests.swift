import CoreLocation
import AlisioIPC
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct PermissionManagerTests {
    @Test func `voice wake permission helpers match status`() async {
        let direct = PermissionManager.voiceWakePermissionsGranted()
        let ensured = await PermissionManager.ensureVoiceWakePermissions(interactive: false)
        #expect(ensured == direct)
    }

    @Test func `status can query non interactive caps`() async {
        let caps: [Capability] = [.microphone, .speechRecognition, .screenRecording]
        let status = await PermissionManager.status(caps)
        #expect(status.keys.count == caps.count)
    }

    @Test func `ensure non interactive does not throw`() async {
        let caps: [Capability] = [.microphone, .speechRecognition, .screenRecording]
        let ensured = await PermissionManager.ensure(caps, interactive: false)
        #expect(ensured.keys.count == caps.count)
    }

    @Test func `restart coordinator keeps screen recording restart required until explicit clear`() async {
        PermissionRestartCoordinator.shared.reconcile(
            status: [.screenRecording: true],
            restartRequired: [.screenRecording: false])
        defer {
            PermissionRestartCoordinator.shared.reconcile(
                status: [.screenRecording: true],
                restartRequired: [.screenRecording: false])
        }

        PermissionRestartCoordinator.shared.markRequested(
            [.screenRecording],
            currentStatus: [.screenRecording: true])

        #expect(PermissionRestartCoordinator.shared.requiresRestart(for: .screenRecording))

        PermissionRestartCoordinator.shared.reconcile(status: [.screenRecording: true])

        #expect(PermissionRestartCoordinator.shared.requiresRestart(for: .screenRecording))

        PermissionRestartCoordinator.shared.reconcile(
            status: [.screenRecording: true],
            restartRequired: [.screenRecording: false])

        #expect(!PermissionRestartCoordinator.shared.requiresRestart(for: .screenRecording))
    }

    @Test func `restart coordinator tracks accessibility only after requested grants`() async {
        PermissionRestartCoordinator.shared.reconcile(
            status: [.accessibility: true],
            restartRequired: [.accessibility: false])
        defer {
            PermissionRestartCoordinator.shared.reconcile(
                status: [.accessibility: true],
                restartRequired: [.accessibility: false])
        }

        PermissionRestartCoordinator.shared.markRequested(
            [.accessibility],
            currentStatus: [.accessibility: false],
            restartRequired: [.accessibility: false])

        #expect(PermissionRestartCoordinator.shared.requiresRestart(for: .accessibility))
    }

    @Test func `location status matches authorization always`() async {
        let status = CLLocationManager().authorizationStatus
        let results = await PermissionManager.status([.location])
        #expect(results[.location] == PermissionManager.isLocationAuthorized(status: status, requireAlways: false))
    }

    @Test func `ensure location non interactive matches authorization always`() async {
        let status = CLLocationManager().authorizationStatus
        let ensured = await PermissionManager.ensure([.location], interactive: false)
        #expect(ensured[.location] == PermissionManager.isLocationAuthorized(status: status, requireAlways: false))
    }
}
