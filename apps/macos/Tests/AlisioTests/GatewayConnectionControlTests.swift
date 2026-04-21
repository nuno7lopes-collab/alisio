import Foundation
import Testing
import AlisioSupport
@testable import Alisio
@testable import AlisioIPC

private final class FakeWebSocketTask: WebSocketTasking, @unchecked Sendable {
    var state: URLSessionTask.State = .running

    func resume() {}

    func cancel(with _: URLSessionWebSocketTask.CloseCode, reason _: Data?) {
        self.state = .canceling
    }

    func send(_: URLSessionWebSocketTask.Message) async throws {}

    func receive() async throws -> URLSessionWebSocketTask.Message {
        throw URLError(.cannotConnectToHost)
    }

    func receive(completionHandler: @escaping @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {
        completionHandler(.failure(URLError(.cannotConnectToHost)))
    }
}

private final class FakeWebSocketSession: WebSocketSessioning, @unchecked Sendable {
    func makeWebSocketTask(url _: URL) -> WebSocketTaskBox {
        WebSocketTaskBox(task: FakeWebSocketTask())
    }
}

private func gatewayRequestMethod(from message: URLSessionWebSocketTask.Message) -> String? {
    let data: Data?
    switch message {
    case let .data(payload):
        data = payload
    case let .string(text):
        data = text.data(using: .utf8)
    @unknown default:
        data = nil
    }
    guard
        let data,
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        return nil
    }
    return object["method"] as? String
}

private func gatewayRequestData(from message: URLSessionWebSocketTask.Message) -> Data? {
    switch message {
    case let .data(payload):
        payload
    case let .string(text):
        text.data(using: .utf8)
    @unknown default:
        nil
    }
}

private actor CapturedGatewayFrameStore {
    private var lastFrame: Data?

    func record(_ frame: Data) {
        self.lastFrame = frame
    }

    func snapshot() -> Data? {
        self.lastFrame
    }
}

private func makeTestGatewayConnection() -> GatewayConnection {
    GatewayConnection(
        configProvider: {
            (url: URL(string: "ws://127.0.0.1:1")!, token: nil, password: nil)
        },
        sessionBox: WebSocketSessionBox(session: FakeWebSocketSession()))
}

@Suite(.serialized) struct GatewayConnectionControlTests {
    @Test func `status fails when process missing`() async {
        let connection = makeTestGatewayConnection()
        let result = await connection.status()
        #expect(result.ok == false)
        #expect(result.error != nil)
    }

    @Test func `reject empty message`() async {
        let connection = makeTestGatewayConnection()
        let result = await connection.sendAgent(
            message: "",
            thinking: nil,
            sessionKey: "main",
            deliver: false,
            to: nil)
        #expect(result.ok == false)
    }

    @Test func `first message request trims payload and forwards delivery metadata`() async throws {
        let captured = CapturedGatewayFrameStore()
        let session = GatewayTestWebSocketSession(
            taskFactory: {
                GatewayTestWebSocketTask(
                    sendHook: { task, message, sendIndex in
                        guard sendIndex > 0 else { return }
                        guard let frame = gatewayRequestData(from: message) else { return }
                        await captured.record(frame)
                        guard let id = GatewayWebSocketTestSupport.requestID(from: message) else { return }
                        task.emitReceiveSuccess(.data(GatewayWebSocketTestSupport.okResponseData(id: id)))
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

        let result = await connection.sendAgent(
            message: "  primeira mensagem macOS  ",
            thinking: nil,
            sessionKey: "  main  ",
            deliver: true,
            to: "+351910000000",
            channel: .telegram,
            timeoutSeconds: 45,
            idempotencyKey: "qa-first-message")

        #expect(result.ok)
        let frameData = try #require(await captured.snapshot())
        let frame = try #require(try JSONSerialization.jsonObject(with: frameData) as? [String: Any])
        #expect(frame["method"] as? String == GatewayConnection.Method.agent.rawValue)
        let params = try #require(frame["params"] as? [String: Any])
        #expect(params["message"] as? String == "primeira mensagem macOS")
        #expect(params["sessionKey"] as? String == "main")
        #expect(params["thinking"] as? String == "default")
        #expect(params["deliver"] as? Bool == true)
        #expect(params["to"] as? String == "+351910000000")
        #expect(params["channel"] as? String == GatewayAgentChannel.telegram.rawValue)
        #expect(params["timeout"] as? Int == 45)
        #expect(params["idempotencyKey"] as? String == "qa-first-message")
    }

    @Test func `healthOK falls back to status when health rpc is unavailable`() async throws {
        let session = GatewayTestWebSocketSession(
            taskFactory: {
                GatewayTestWebSocketTask(
                    sendHook: { task, message, sendIndex in
                        guard sendIndex > 0 else { return }
                        guard let id = GatewayWebSocketTestSupport.requestID(from: message) else { return }
                        switch gatewayRequestMethod(from: message) {
                        case "health":
                            task.emitReceiveFailure(URLError(.timedOut))
                        case "status":
                            task.emitReceiveSuccess(.data(GatewayWebSocketTestSupport.okResponseData(id: id)))
                        default:
                            break
                        }
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

        let ok = try await connection.healthOK(timeoutMs: 100)

        #expect(ok)
    }
}
