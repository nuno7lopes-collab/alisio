import AlisioKit
import Foundation
import Testing
@testable import Alisio

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        self.lock()
        defer { self.unlock() }
        return body()
    }
}

private final class RecordingGatewayWebSocketTask: WebSocketTasking, @unchecked Sendable {
    struct RecordedRequest {
        let method: String
        let params: [String: Any]?
    }

    private let lock = NSLock()
    private let responder: @Sendable (String, [String: Any]?) -> [String: Any]
    private var _state: URLSessionTask.State = .suspended
    private var connectRequestId: String?
    private var receivePhase = 0
    private var pendingReceiveHandler:
        (@Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void)?
    private var queuedMessages: [URLSessionWebSocketTask.Message] = []
    private var requests: [RecordedRequest] = []

    init(responder: @escaping @Sendable (String, [String: Any]?) -> [String: Any]) {
        self.responder = responder
    }

    var state: URLSessionTask.State {
        get { self.lock.withLock { self._state } }
        set { self.lock.withLock { self._state = newValue } }
    }

    func resume() {
        self.state = .running
    }

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        _ = (closeCode, reason)
        self.state = .canceling
        let handler = self.lock.withLock { () -> (@Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void)? in
            defer { self.pendingReceiveHandler = nil }
            return self.pendingReceiveHandler
        }
        handler?(Result<URLSessionWebSocketTask.Message, Error>.failure(URLError(.cancelled)))
    }

    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        let data: Data? = switch message {
        case let .data(d): d
        case let .string(s): s.data(using: .utf8)
        @unknown default: nil
        }
        guard let data,
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              obj["type"] as? String == "req",
              let id = obj["id"] as? String,
              let method = obj["method"] as? String
        else {
            return
        }

        if method == "connect" {
            self.lock.withLock {
                self.connectRequestId = id
            }
            return
        }

        let params = obj["params"] as? [String: Any]
        self.lock.withLock {
            self.requests.append(RecordedRequest(method: method, params: params))
        }
        self.enqueue(
            .data(Self.responseData(id: id, payload: self.responder(method, params)))
        )
    }

    func sendPing(pongReceiveHandler: @escaping @Sendable (Error?) -> Void) {
        pongReceiveHandler(nil)
    }

    func receive() async throws -> URLSessionWebSocketTask.Message {
        let phase = self.lock.withLock { () -> Int in
            let current = self.receivePhase
            self.receivePhase += 1
            return current
        }
        if phase == 0 {
            return .data(Self.connectChallengeData(nonce: "nonce-ios-chat"))
        }
        for _ in 0..<50 {
            let id = self.lock.withLock { self.connectRequestId }
            if let id {
                return .data(Self.connectOkData(id: id))
            }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        return .data(Self.connectOkData(id: "connect"))
    }

    func receive(
        completionHandler: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void)
    {
        let queued = self.lock.withLock { () -> URLSessionWebSocketTask.Message? in
            if !self.queuedMessages.isEmpty {
                return self.queuedMessages.removeFirst()
            }
            self.pendingReceiveHandler = completionHandler
            return nil
        }
        if let queued {
            completionHandler(.success(queued))
        }
    }

    func recordedRequests() -> [RecordedRequest] {
        self.lock.withLock { self.requests }
    }

    private func enqueue(_ message: URLSessionWebSocketTask.Message) {
        let handler = self.lock.withLock { () -> (@Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void)? in
            if let handler = self.pendingReceiveHandler {
                self.pendingReceiveHandler = nil
                return handler
            }
            self.queuedMessages.append(message)
            return nil
        }
        handler?(.success(message))
    }

    private static func connectChallengeData(nonce: String) -> Data {
        let frame: [String: Any] = [
            "type": "event",
            "event": "connect.challenge",
            "payload": ["nonce": nonce],
        ]
        return (try? JSONSerialization.data(withJSONObject: frame)) ?? Data()
    }

    private static func connectOkData(id: String) -> Data {
        let payload: [String: Any] = [
            "type": "hello-ok",
            "protocol": 2,
            "server": [
                "version": "test",
                "connId": "ios-chat-test",
            ],
            "features": [
                "methods": [],
                "events": [],
            ],
            "snapshot": [
                "presence": [["ts": 1]],
                "health": [:],
                "stateVersion": [
                    "presence": 0,
                    "health": 0,
                ],
                "uptimeMs": 0,
            ],
            "policy": [
                "maxPayload": 1,
                "maxBufferedBytes": 1,
                "tickIntervalMs": 30_000,
            ],
        ]
        return Self.responseData(id: id, payload: payload)
    }

    private static func responseData(id: String, payload: [String: Any]) -> Data {
        let frame: [String: Any] = [
            "type": "res",
            "id": id,
            "ok": true,
            "payload": payload,
        ]
        return (try? JSONSerialization.data(withJSONObject: frame)) ?? Data()
    }
}

private final class RecordingGatewayWebSocketSession: WebSocketSessioning, @unchecked Sendable {
    private let responder: @Sendable (String, [String: Any]?) -> [String: Any]
    private let lock = NSLock()
    private var tasks: [RecordingGatewayWebSocketTask] = []

    init(responder: @escaping @Sendable (String, [String: Any]?) -> [String: Any]) {
        self.responder = responder
    }

    func latestTask() -> RecordingGatewayWebSocketTask? {
        self.lock.withLock { self.tasks.last }
    }

    func makeWebSocketTask(url: URL) -> WebSocketTaskBox {
        _ = url
        return self.lock.withLock {
            let task = RecordingGatewayWebSocketTask(responder: self.responder)
            self.tasks.append(task)
            return WebSocketTaskBox(task: task)
        }
    }
}

@Suite struct IOSGatewayChatTransportTests {
    private func makeConnectedTransport(
        responder: @escaping @Sendable (String, [String: Any]?) -> [String: Any])
        async throws -> (GatewayNodeSession, IOSGatewayChatTransport, RecordingGatewayWebSocketSession)
    {
        let gateway = GatewayNodeSession()
        let session = RecordingGatewayWebSocketSession(responder: responder)
        try await gateway.connect(
            url: URL(string: "ws://example.invalid")!,
            token: nil,
            bootstrapToken: nil,
            password: nil,
            connectOptions: GatewayConnectOptions(
                role: "operator",
                scopes: ["operator.read", "operator.write"],
                caps: [],
                commands: [],
                permissions: [:],
                clientId: "alisio-ios-chat-transport-test",
                clientMode: "ui",
                clientDisplayName: "iOS Chat Transport Test",
                includeDeviceIdentity: false),
            sessionBox: WebSocketSessionBox(session: session),
            onConnected: {},
            onDisconnected: { _ in },
            onInvoke: { req in
                BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: nil, error: nil)
            })
        return (gateway, IOSGatewayChatTransport(gateway: gateway), session)
    }

    @Test func requestsFailFastWhenGatewayNotConnected() async {
        let gateway = GatewayNodeSession()
        let transport = IOSGatewayChatTransport(gateway: gateway)

        do {
            _ = try await transport.requestHistory(sessionKey: "node-test")
            Issue.record("Expected requestHistory to throw when gateway not connected")
        } catch {}

        do {
            _ = try await transport.sendMessage(
                sessionKey: "node-test",
                message: "hello",
                thinking: "low",
                idempotencyKey: "idempotency",
                attachments: [])
            Issue.record("Expected sendMessage to throw when gateway not connected")
        } catch {}

        do {
            _ = try await transport.requestHealth(timeoutMs: 250)
            Issue.record("Expected requestHealth to throw when gateway not connected")
        } catch {}

        do {
            try await transport.resetSession(sessionKey: "node-test")
            Issue.record("Expected resetSession to throw when gateway not connected")
        } catch {}
    }

    @Test func listModelsDecodesGatewayCatalog() async throws {
        let (gateway, transport, session) = try await self.makeConnectedTransport { method, _ in
            switch method {
            case "models.list":
                return [
                    "models": [
                        [
                            "id": "gpt-5.4",
                            "name": "GPT-5.4",
                            "provider": "openai",
                            "contextWindow": 400000,
                        ],
                        [
                            "id": "claude-opus-4-6",
                            "name": "Claude Opus 4.6",
                            "provider": "anthropic",
                        ],
                    ],
                ]
            default:
                return [:]
            }
        }
        defer { Task { await gateway.disconnect() } }

        let models = try await transport.listModels()
        let requests = try #require(session.latestTask()?.recordedRequests())

        #expect(requests.count == 1)
        #expect(requests[0].method == "models.list")
        #expect(models.map(\.selectionID) == ["openai/gpt-5.4", "anthropic/claude-opus-4-6"])
        #expect(models[0].contextWindow == 400000)
    }

    @Test func sessionPatchesPreserveExplicitNullForDefaultModelAndThinkingLevel() async throws {
        let (gateway, transport, session) = try await self.makeConnectedTransport { method, _ in
            switch method {
            case "sessions.patch":
                return ["ok": true]
            default:
                return [:]
            }
        }
        defer { Task { await gateway.disconnect() } }

        try await transport.setSessionModel(sessionKey: "main", model: nil)
        try await transport.setSessionThinking(sessionKey: "main", thinkingLevel: "high")

        let requests = try #require(session.latestTask()?.recordedRequests())
        #expect(requests.count == 2)

        let modelPatch = requests[0]
        let modelParams = try #require(modelPatch.params)
        #expect(modelPatch.method == "sessions.patch")
        #expect(modelParams["key"] as? String == "main")
        #expect(modelParams.keys.contains("model"))
        #expect(modelParams["model"] is NSNull)

        let thinkingPatch = requests[1]
        let thinkingParams = try #require(thinkingPatch.params)
        #expect(thinkingPatch.method == "sessions.patch")
        #expect(thinkingParams["key"] as? String == "main")
        #expect(thinkingParams["thinkingLevel"] as? String == "high")
        #expect(thinkingParams.keys.contains("model") == false)
    }
}
