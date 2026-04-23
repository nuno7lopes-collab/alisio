import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct GatewayProcessManagerTests {
    private actor HealthGate {
        private var healthy: Bool

        init(_ healthy: Bool) {
            self.healthy = healthy
        }

        func setHealthy(_ healthy: Bool) {
            self.healthy = healthy
        }

        func isHealthy() -> Bool {
            self.healthy
        }
    }

    @Test func `clears last failure when health succeeds`() async throws {
        let session = GatewayTestWebSocketSession(
            taskFactory: {
                GatewayTestWebSocketTask(
                    sendHook: { task, message, sendIndex in
                        guard sendIndex > 0 else { return }
                        guard let id = GatewayWebSocketTestSupport.requestID(from: message) else { return }
                        task.emitReceiveSuccess(.data(GatewayWebSocketTestSupport.okResponseData(id: id)))
                    })
            })
        let url = try #require(URL(string: "ws://example.invalid"))
        let connection = GatewayConnection(
            configProvider: { (url: url, token: nil, password: nil) },
            sessionBox: WebSocketSessionBox(session: session))

        let manager = GatewayProcessManager()
        manager.setTestingConnection(connection)
        manager.setTestingDesiredActive(true)
        manager.setTestingLastFailureReason("health failed")
        defer {
            manager.setTestingConnection(nil)
            manager.setTestingDesiredActive(false)
            manager.setTestingLastFailureReason(nil)
        }

        let ready = await manager.waitForGatewayReady(timeout: 0.5)
        #expect(ready)
        #expect(manager.lastFailureReason == nil)
    }

    @Test func `records auth failures during readiness waits`() async throws {
        let session = GatewayTestWebSocketSession(
            taskFactory: {
                GatewayTestWebSocketTask(
                    sendHook: { task, message, sendIndex in
                        guard sendIndex > 0 else { return }
                        guard GatewayWebSocketTestSupport.requestID(from: message) != nil else { return }
                        task.emitReceiveFailure(URLError(.dataNotAllowed))
                    },
                    receiveHook: { task, receiveIndex in
                        if receiveIndex == 0 {
                            return .data(GatewayWebSocketTestSupport.connectChallengeData())
                        }
                        let id = task.snapshotConnectRequestID() ?? "connect"
                        return .data(GatewayWebSocketTestSupport.connectOkData(id: id))
                    })
            })
        let url = try #require(URL(string: "ws://example.invalid"))
        let connection = GatewayConnection(
            configProvider: { (url: url, token: nil, password: nil) },
            sessionBox: WebSocketSessionBox(session: session))

        let manager = GatewayProcessManager()
        manager.setTestingConnection(connection)
        manager.setTestingDesiredActive(true)
        manager.setTestingLastFailureReason(nil)
        defer {
            manager.setTestingConnection(nil)
            manager.setTestingDesiredActive(false)
            manager.setTestingLastFailureReason(nil)
        }

        let ready = await manager.waitForGatewayReady(timeout: 0.15)
        #expect(!ready)
        #expect(manager.lastFailureReason?.contains("rejected auth") == true)
    }

    @Test func `records connection failure code during readiness waits`() async throws {
        let session = GatewayTestWebSocketSession(
            taskFactory: {
                GatewayTestWebSocketTask(
                    receiveHook: { _, _ in
                        throw URLError(.cannotConnectToHost)
                    })
            })
        let url = try #require(URL(string: "ws://example.invalid"))
        let connection = GatewayConnection(
            configProvider: { (url: url, token: nil, password: nil) },
            sessionBox: WebSocketSessionBox(session: session))

        let manager = GatewayProcessManager()
        manager.setTestingConnection(connection)
        manager.setTestingDesiredActive(true)
        manager.setTestingLastFailureReason(nil)
        defer {
            manager.setTestingConnection(nil)
            manager.setTestingDesiredActive(false)
            manager.setTestingLastFailureReason(nil)
        }

        let ready = await manager.waitForGatewayReady(timeout: 0.15)
        #expect(!ready)
        #expect(manager.lastFailureReason?.contains("[readiness:connect]") == true)
    }

    @Test func `readiness errors expose product copy while preserving transient classification`() {
        let transient = GatewayReadinessError(
            technicalMessage: "[readiness:connect] Gateway on port 40705 is not reachable yet: cannot connect (while preparing alisio.account.beginGoogleAuth)",
            operation: GatewayConnection.Method.alisioAccountBeginGoogleAuth.rawValue,
            status: .starting)
        #expect(transient.isTransient)
        #expect(
            transient.errorDescription ==
                "Alisio is still getting this Mac ready. Google sign-in is not available just yet. Try again in a moment.")

        let stable = GatewayReadinessError(
            technicalMessage: "[readiness:auth] Gateway on port 40705 rejected auth.",
            operation: GatewayConnection.Method.alisioAccountBeginGoogleAuth.rawValue,
            status: .failed("auth failed"))
        #expect(!stable.isTransient)
        #expect(
            stable.errorDescription ==
                "Alisio could not start Google sign-in on this Mac right now. Restart Alisio and try again.")
    }

    @Test func `attaches to existing gateway without spawning launchd`() async throws {
        let expectedVersion = "2026.3.30"
        try await TestIsolation.withEnvValues([
            "ALISIO_TEST_EXPECTED_GATEWAY_VERSION": expectedVersion,
        ]) {
            let healthData = Data(
                """
                {
                  "ok": true,
                  "ts": 1,
                  "durationMs": 0,
                  "channels": {
                    "telegram": {
                      "configured": true,
                      "linked": true,
                      "authAgeMs": 60000
                    }
                  },
                  "channelOrder": ["telegram"],
                  "channelLabels": {
                    "telegram": "Telegram"
                  },
                  "heartbeatSeconds": 30,
                  "sessions": {
                    "path": "/tmp/sessions",
                    "count": 1,
                    "recent": []
                  }
                }
                """.utf8)
            let session = GatewayTestWebSocketSession(
                taskFactory: {
                    GatewayTestWebSocketTask(
                        sendHook: { task, message, sendIndex in
                            guard sendIndex > 0 else { return }
                            guard let id = GatewayWebSocketTestSupport.requestID(from: message) else { return }
                            let json = """
                            {
                              "type": "res",
                              "id": "\(id)",
                              "ok": true,
                              "payload": \(String(decoding: healthData, as: UTF8.self))
                            }
                            """
                            task.emitReceiveSuccess(.data(Data(json.utf8)))
                        },
                        receiveHook: { task, receiveIndex in
                            if receiveIndex == 0 {
                                return .data(GatewayWebSocketTestSupport.connectChallengeData())
                            }
                            let id = task.snapshotConnectRequestID() ?? "connect"
                            return .data(GatewayWebSocketTestSupport.connectOkData(id: id, version: expectedVersion))
                        })
                })
            let url = try #require(URL(string: "ws://example.invalid"))
            let connection = GatewayConnection(
                configProvider: { (url: url, token: nil, password: nil) },
                sessionBox: WebSocketSessionBox(session: session))
            let port = GatewayEnvironment.gatewayPort()
            let descriptor = PortGuardian.Descriptor(
                pid: 4242,
                command: "alisio-gateway",
                executablePath: "/tmp/alisio-gateway")

            let manager = GatewayProcessManager()
            manager.clearLog()
            await PortGuardian.shared.setTestingDescriptor(descriptor, forPort: port)
            manager.setTestingConnection(connection)
            manager.setTestingSkipControlChannelRefresh(true)
            manager.setTestingLastFailureReason("stale")

            func cleanup() async {
                await PortGuardian.shared.setTestingDescriptor(nil, forPort: port)
                await MainActor.run {
                    manager.setTestingConnection(nil)
                    manager.setTestingSkipControlChannelRefresh(false)
                    manager.setTestingDesiredActive(false)
                    manager.setTestingLastFailureReason(nil)
                }
            }

            do {
                let attached = await manager._testAttachExistingGatewayIfAvailable()
                #expect(attached)
                #expect(manager.lastFailureReason == nil)
                guard case let .attachedExisting(statusDetails) = manager.status else {
                    Issue.record("expected attachedExisting status")
                    await cleanup()
                    return
                }
                let details = try #require(statusDetails)
                #expect(details.contains("port \(port)"))
                #expect(details.contains("Telegram linked"))
                #expect(details.contains("auth 1m"))
                #expect(details.contains("pid 4242 Alisio runtime @ /tmp/alisio-gateway"))
                await cleanup()
            } catch {
                await cleanup()
                throw error
            }
        }
    }

    @Test func `ignores existing gateway when version is incompatible`() async throws {
        try await TestIsolation.withEnvValues([
            "ALISIO_TEST_EXPECTED_GATEWAY_VERSION": "2026.3.30",
        ]) {
            let healthData = Data(
                """
                {
                  "ok": true,
                  "ts": 1,
                  "durationMs": 0,
                  "channels": {},
                  "channelOrder": [],
                  "sessions": {
                    "path": "/tmp/sessions",
                    "count": 0,
                    "recent": []
                  }
                }
                """.utf8)
            let session = GatewayTestWebSocketSession(
                taskFactory: {
                    GatewayTestWebSocketTask(
                        sendHook: { task, message, sendIndex in
                            guard sendIndex > 0 else { return }
                            guard let id = GatewayWebSocketTestSupport.requestID(from: message) else { return }
                            let json = """
                            {
                              "type": "res",
                              "id": "\(id)",
                              "ok": true,
                              "payload": \(String(decoding: healthData, as: UTF8.self))
                            }
                            """
                            task.emitReceiveSuccess(.data(Data(json.utf8)))
                        },
                        receiveHook: { task, receiveIndex in
                            if receiveIndex == 0 {
                                return .data(GatewayWebSocketTestSupport.connectChallengeData())
                            }
                            let id = task.snapshotConnectRequestID() ?? "connect"
                            return .data(GatewayWebSocketTestSupport.connectOkData(id: id, version: "2026.3.24"))
                        })
                })
            let url = try #require(URL(string: "ws://example.invalid"))
            let connection = GatewayConnection(
                configProvider: { (url: url, token: nil, password: nil) },
                sessionBox: WebSocketSessionBox(session: session))
            let port = GatewayEnvironment.gatewayPort()
            let descriptor = PortGuardian.Descriptor(
                pid: 9898,
                command: "alisio-gateway",
                executablePath: "/tmp/alisio-gateway")

            let manager = GatewayProcessManager()
            manager.clearLog()
            await PortGuardian.shared.setTestingDescriptor(descriptor, forPort: port)
            manager.setTestingConnection(connection)
            manager.setTestingSkipControlChannelRefresh(true)

            func cleanup() async {
                await PortGuardian.shared.setTestingDescriptor(nil, forPort: port)
                await MainActor.run {
                    manager.setTestingConnection(nil)
                    manager.setTestingSkipControlChannelRefresh(false)
                    manager.setTestingDesiredActive(false)
                    manager.setTestingLastFailureReason(nil)
                }
            }

            let attached = await manager._testAttachExistingGatewayIfAvailable()
            #expect(attached == false)
            if case .attachedExisting = manager.status {
                Issue.record("expected incompatible gateway not to attach")
            }
            #expect(manager.log.contains("ignoring existing instance"))
            #expect(manager.log.contains("expected"))
            await cleanup()
        }
    }

    @Test func `recovers an attached existing gateway before surfacing workspace unavailable`() async throws {
        let expectedVersion = "2026.3.30"
        try await TestIsolation.withEnvValues([
            "ALISIO_TEST_EXPECTED_GATEWAY_VERSION": expectedVersion,
        ]) {
            let healthGate = HealthGate(true)
            let healthData = Data(
                """
                {
                  "ok": true,
                  "ts": 1,
                  "durationMs": 0,
                  "channels": {
                    "whatsapp": {
                      "configured": true,
                      "linked": false,
                      "authAgeMs": 60000
                    }
                  },
                  "channelOrder": ["whatsapp"],
                  "channelLabels": {
                    "whatsapp": "WhatsApp"
                  },
                  "heartbeatSeconds": 30,
                  "sessions": {
                    "path": "/tmp/sessions",
                    "count": 1,
                    "recent": []
                  }
                }
                """.utf8)
            let session = GatewayTestWebSocketSession(
                taskFactory: {
                    GatewayTestWebSocketTask(
                        sendHook: { task, message, sendIndex in
                            guard sendIndex > 0 else { return }
                            guard let id = GatewayWebSocketTestSupport.requestID(from: message) else { return }
                            if await healthGate.isHealthy() {
                                let json = """
                                {
                                  "type": "res",
                                  "id": "\(id)",
                                  "ok": true,
                                  "payload": \(String(decoding: healthData, as: UTF8.self))
                                }
                                """
                                task.emitReceiveSuccess(.data(Data(json.utf8)))
                            } else {
                                task.emitReceiveFailure(URLError(.networkConnectionLost))
                            }
                        },
                        receiveHook: { task, receiveIndex in
                            if receiveIndex == 0 {
                                return .data(GatewayWebSocketTestSupport.connectChallengeData())
                            }
                            let id = task.snapshotConnectRequestID() ?? "connect"
                            return .data(GatewayWebSocketTestSupport.connectOkData(id: id, version: expectedVersion))
                        })
                })
            let url = try #require(URL(string: "ws://example.invalid"))
            let connection = GatewayConnection(
                configProvider: { (url: url, token: nil, password: nil) },
                sessionBox: WebSocketSessionBox(session: session))
            let port = GatewayEnvironment.gatewayPort()
            let descriptor = PortGuardian.Descriptor(
                pid: 46520,
                command: "alisio-gateway",
                executablePath: "/tmp/alisio-gateway")

            let manager = GatewayProcessManager()
            manager.clearLog()
            await PortGuardian.shared.setTestingDescriptor(descriptor, forPort: port)
            manager.setTestingConnection(connection)
            manager.setTestingSkipControlChannelRefresh(true)
            manager.setTestingDesiredActive(true)
            manager.setTestingExistingGatewayRecoveryHook {
                await healthGate.setHealthy(true)
            }

            func cleanup() async {
                await PortGuardian.shared.setTestingDescriptor(nil, forPort: port)
                await MainActor.run {
                    manager.setTestingConnection(nil)
                    manager.setTestingSkipControlChannelRefresh(false)
                    manager.setTestingDesiredActive(false)
                    manager.setTestingLastFailureReason(nil)
                    manager.setTestingExistingGatewayRecoveryHook(nil)
                }
            }

            let attached = await manager._testAttachExistingGatewayIfAvailable()
            #expect(attached)
            await healthGate.setHealthy(false)

            let recovered = await manager._testRecoverAttachedExistingGatewayIfNeeded(timeout: 1)
            #expect(recovered)
            guard case let .running(statusDetails) = manager.status else {
                Issue.record("expected running status after recovery")
                await cleanup()
                return
            }
            #expect(statusDetails?.contains("pid") == true)
            #expect(manager.lastFailureReason == nil)
            #expect(manager.log.contains("restarting managed gateway"))
            await cleanup()
        }
    }

    @Test func `existing listener that is still warming up does not surface as a hard attach failure`() async throws {
        let session = GatewayTestWebSocketSession(
            taskFactory: {
                GatewayTestWebSocketTask(
                    receiveHook: { _, _ in
                        throw URLError(.timedOut)
                    })
            })
        let url = try #require(URL(string: "ws://example.invalid"))
        let connection = GatewayConnection(
            configProvider: { (url: url, token: nil, password: nil) },
            sessionBox: WebSocketSessionBox(session: session))
        let port = GatewayEnvironment.gatewayPort()
        let descriptor = PortGuardian.Descriptor(
            pid: 31001,
            command: "alisio-gateway",
            executablePath: "/tmp/alisio-gateway")

        let manager = GatewayProcessManager()
        manager.clearLog()
        await PortGuardian.shared.setTestingDescriptor(descriptor, forPort: port)
        manager.setTestingConnection(connection)
        manager.setTestingSkipControlChannelRefresh(true)

        func cleanup() async {
            await PortGuardian.shared.setTestingDescriptor(nil, forPort: port)
            await MainActor.run {
                manager.setTestingConnection(nil)
                manager.setTestingSkipControlChannelRefresh(false)
                manager.setTestingDesiredActive(false)
                manager.setTestingLastFailureReason(nil)
            }
        }

        let attached = await manager._testAttachExistingGatewayIfAvailable()
        #expect(attached == false)
        guard case .starting = manager.status else {
            Issue.record("expected existing listener warmup to keep manager in starting state")
            await cleanup()
            return
        }
        #expect(manager.lastFailureReason?.contains("[readiness:timeout]") == true)
        #expect(manager.log.contains("still warming up"))
        await cleanup()
    }
}
