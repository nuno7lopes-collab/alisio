import CoreLocation
import Foundation
import Testing
import AlisioSupport
@testable import Alisio

struct MacNodeRuntimeTests {
    @Test func `handle invoke rejects unknown command`() async {
        let runtime = MacNodeRuntime()
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-1", command: "unknown.command"))
        #expect(response.ok == false)
    }

    @Test func `handle invoke rejects empty system run`() async throws {
        let runtime = MacNodeRuntime()
        let params = AlisioSystemRunParams(command: [])
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-2", command: AlisioSystemCommand.run.rawValue, paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func `handle invoke rejects blocked system run env override before execution`() async throws {
        let runtime = MacNodeRuntime()
        let params = AlisioSystemRunParams(
            command: ["/bin/sh", "-lc", "echo ok"],
            env: ["CLASSPATH": "/tmp/evil-classpath"])
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-2c", command: AlisioSystemCommand.run.rawValue, paramsJSON: json))
        #expect(response.ok == false)
        #expect(response.error?.message.contains("SYSTEM_RUN_DENIED: environment override rejected") == true)
        #expect(response.error?.message.contains("CLASSPATH") == true)
    }

    @Test func `handle invoke rejects invalid system run env override key before execution`() async throws {
        let runtime = MacNodeRuntime()
        let params = AlisioSystemRunParams(
            command: ["/bin/sh", "-lc", "echo ok"],
            env: ["BAD-KEY": "x"])
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-2d", command: AlisioSystemCommand.run.rawValue, paramsJSON: json))
        #expect(response.ok == false)
        #expect(response.error?.message.contains("SYSTEM_RUN_DENIED: environment override rejected") == true)
        #expect(response.error?.message.contains("BAD-KEY") == true)
    }

    @Test func `handle invoke rejects empty system which`() async throws {
        let runtime = MacNodeRuntime()
        let params = AlisioSystemWhichParams(bins: [])
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-2b", command: AlisioSystemCommand.which.rawValue, paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func `handle invoke rejects empty notification`() async throws {
        let runtime = MacNodeRuntime()
        let params = AlisioSystemNotifyParams(title: "", body: "")
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-3", command: AlisioSystemCommand.notify.rawValue, paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func `handle invoke camera list requires enabled camera`() async {
        await TestIsolation.withUserDefaultsValues([cameraEnabledKey: false]) {
            let runtime = MacNodeRuntime()
            let response = await runtime.handleInvoke(
                BridgeInvokeRequest(id: "req-4", command: AlisioCameraCommand.list.rawValue))
            #expect(response.ok == false)
            #expect(response.error?.message.contains("CAMERA_DISABLED") == true)
        }
    }

    @Test func `handle invoke screen record uses injected services`() async throws {
        @MainActor
        final class FakeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
            func recordScreen(
                screenIndex: Int?,
                durationMs: Int?,
                fps: Double?,
                includeAudio: Bool?,
                outPath: String?) async throws -> (path: String, hasAudio: Bool)
            {
                let url = FileManager().temporaryDirectory
                    .appendingPathComponent("alisio-test-screen-record-\(UUID().uuidString).mp4")
                try Data("ok".utf8).write(to: url)
                return (path: url.path, hasAudio: false)
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

        let services = await MainActor.run { FakeMainActorServices() }
        let runtime = MacNodeRuntime(makeMainActorServices: { services })

        let params = MacNodeScreenRecordParams(durationMs: 250)
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-5", command: MacNodeScreenCommand.record.rawValue, paramsJSON: json))
        #expect(response.ok == true)
        let payloadJSON = try #require(response.payloadJSON)

        struct Payload: Decodable {
            var format: String
            var base64: String
        }
        let payload = try JSONDecoder().decode(Payload.self, from: Data(payloadJSON.utf8))
        #expect(payload.format == "mp4")
        #expect(!payload.base64.isEmpty)
    }

    @Test func `handle invoke location accepts while using authorization`() async {
        @MainActor
        final class FakeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
            func recordScreen(
                screenIndex _: Int?,
                durationMs _: Int?,
                fps _: Double?,
                includeAudio _: Bool?,
                outPath _: String?) async throws -> (path: String, hasAudio: Bool)
            {
                Issue.record("recordScreen should not be called for location tests")
                return ("", false)
            }

            func locationAuthorizationStatus() -> CLAuthorizationStatus {
                .authorized
            }

            func locationAccuracyAuthorization() -> CLAccuracyAuthorization {
                .reducedAccuracy
            }

            func isApplicationActive() -> Bool {
                true
            }

            func currentLocation(
                desiredAccuracy _: AlisioLocationAccuracy,
                maxAgeMs _: Int?,
                timeoutMs _: Int?) async throws -> CLLocation
            {
                CLLocation(latitude: 38.7223, longitude: -9.1393)
            }
        }

        await TestIsolation.withUserDefaultsValues([
            locationModeKey: AlisioLocationMode.whileUsing.rawValue,
            locationPreciseKey: false,
        ]) {
            let services = await MainActor.run { FakeMainActorServices() }
            let runtime = MacNodeRuntime(makeMainActorServices: { services })
            let response = await runtime.handleInvoke(
                BridgeInvokeRequest(id: "req-location", command: AlisioLocationCommand.get.rawValue))

            #expect(response.ok == true)
        }
    }

    @Test func `handle invoke location blocks while using in background`() async {
        @MainActor
        final class FakeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
            func recordScreen(
                screenIndex _: Int?,
                durationMs _: Int?,
                fps _: Double?,
                includeAudio _: Bool?,
                outPath _: String?) async throws -> (path: String, hasAudio: Bool)
            {
                Issue.record("recordScreen should not be called for location tests")
                return ("", false)
            }

            func locationAuthorizationStatus() -> CLAuthorizationStatus {
                .authorizedAlways
            }

            func locationAccuracyAuthorization() -> CLAccuracyAuthorization {
                .reducedAccuracy
            }

            func isApplicationActive() -> Bool {
                false
            }

            func currentLocation(
                desiredAccuracy _: AlisioLocationAccuracy,
                maxAgeMs _: Int?,
                timeoutMs _: Int?) async throws -> CLLocation
            {
                Issue.record("currentLocation should not run while background-restricted")
                return CLLocation(latitude: 38.7223, longitude: -9.1393)
            }
        }

        await TestIsolation.withUserDefaultsValues([
            locationModeKey: AlisioLocationMode.whileUsing.rawValue,
            locationPreciseKey: false,
        ]) {
            let services = await MainActor.run { FakeMainActorServices() }
            let runtime = MacNodeRuntime(makeMainActorServices: { services })
            let response = await runtime.handleInvoke(
                BridgeInvokeRequest(id: "req-location-bg", command: AlisioLocationCommand.get.rawValue))

            #expect(response.ok == false)
            #expect(response.error?.code == .backgroundUnavailable)
            #expect(response.error?.message.contains("LOCATION_BACKGROUND_UNAVAILABLE") == true)
        }
    }

    @Test func `handle invoke browser proxy uses injected request`() async {
        let runtime = MacNodeRuntime(browserProxyRequest: { paramsJSON in
            #expect(paramsJSON?.contains("/tabs") == true)
            return #"{"result":{"ok":true,"tabs":[{"id":"tab-1"}]}}"#
        })
        let paramsJSON = #"{"method":"GET","path":"/tabs","timeoutMs":2500}"#
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(
                id: "req-browser",
                command: AlisioBrowserCommand.proxy.rawValue,
                paramsJSON: paramsJSON))

        #expect(response.ok == true)
        #expect(response.payloadJSON == #"{"result":{"ok":true,"tabs":[{"id":"tab-1"}]}}"#)
    }

    @Test func `handle invoke browser proxy rejects disabled browser control`() async throws {
        let override = TestIsolation.tempConfigPath()
        try await TestIsolation.withEnvValues(["ALISIO_CONFIG_PATH": override]) {
            try JSONSerialization.data(withJSONObject: ["browser": ["enabled": false]])
                .write(to: URL(fileURLWithPath: override))

            let runtime = MacNodeRuntime(browserProxyRequest: { _ in
                Issue.record("browserProxyRequest should not run when browser control is disabled")
                return "{}"
            })
            let response = await runtime.handleInvoke(
                BridgeInvokeRequest(
                    id: "req-browser-disabled",
                    command: AlisioBrowserCommand.proxy.rawValue,
                    paramsJSON: #"{"method":"GET","path":"/tabs"}"#))

            #expect(response.ok == false)
            #expect(response.error?.message.contains("BROWSER_DISABLED") == true)
        }
    }
}
