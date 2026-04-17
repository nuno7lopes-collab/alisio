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
