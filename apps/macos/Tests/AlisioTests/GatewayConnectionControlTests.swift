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

private func gatewayResponseData(id: String, payloadJSON: String) -> Data {
    Data(
        """
        {
          "type": "res",
          "id": "\(id)",
          "ok": true,
          "payload": \(payloadJSON)
        }
        """.utf8)
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

    @Test @MainActor func `reject empty message`() async {
        await TestIsolation.withAccountStore {
            let connection = makeTestGatewayConnection()
            let result = await connection.sendAgent(
                message: "",
                thinking: nil,
                sessionKey: "main",
                deliver: false,
                to: nil)
            #expect(result.ok == false)
        }
    }

    @Test @MainActor func `send agent requires signed in account`() async {
        await TestIsolation.withAccountStore {
            let connection = makeTestGatewayConnection()

            let result = await connection.sendAgent(
                message: "olá",
                thinking: nil,
                sessionKey: "main",
                deliver: false,
                to: nil)

            #expect(result.ok == false)
            #expect(result.error != nil)
        }
    }

    @Test @MainActor func `first message request trims payload and forwards delivery metadata`() async throws {
        try await TestIsolation.withSignedInAccount {
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
    }

    @Test @MainActor func `chat send request trims payload and forwards timeout plus attachments`() async throws {
        try await TestIsolation.withSignedInAccount {
            let captured = CapturedGatewayFrameStore()
            let session = GatewayTestWebSocketSession(
                taskFactory: {
                    GatewayTestWebSocketTask(
                        sendHook: { task, message, sendIndex in
                            guard sendIndex > 0 else { return }
                            guard let frame = gatewayRequestData(from: message) else { return }
                            await captured.record(frame)
                            guard let id = GatewayWebSocketTestSupport.requestID(from: message) else { return }
                            task.emitReceiveSuccess(.data(gatewayResponseData(
                                id: id,
                                payloadJSON: #"{"runId":"run-chat-1","status":"accepted"}"#)))
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
            let attachment = AlisioChatAttachmentPayload(
                type: "image",
                mimeType: "image/png",
                fileName: "proof.png",
                content: "base64payload")

            let response = try await connection.chatSend(
                sessionKey: "  main  ",
                message: "  primeira mensagem nativa  ",
                thinking: "high",
                idempotencyKey: "chat-first-message",
                attachments: [attachment],
                timeoutMs: 31000)

            #expect(response.runId == "run-chat-1")
            #expect(response.status == "accepted")
            let frameData = try #require(await captured.snapshot())
            let frame = try #require(try JSONSerialization.jsonObject(with: frameData) as? [String: Any])
            #expect(frame["method"] as? String == GatewayConnection.Method.chatSend.rawValue)
            let params = try #require(frame["params"] as? [String: Any])
            #expect(params["sessionKey"] as? String == "main")
            #expect(params["message"] as? String == "primeira mensagem nativa")
            #expect(params["thinking"] as? String == "high")
            #expect(params["idempotencyKey"] as? String == "chat-first-message")
            #expect(params["timeoutMs"] as? Int == 31000)
            let attachments = try #require(params["attachments"] as? [[String: Any]])
            let firstAttachment = try #require(attachments.first)
            #expect(firstAttachment["type"] as? String == "image")
            #expect(firstAttachment["mimeType"] as? String == "image/png")
            #expect(firstAttachment["fileName"] as? String == "proof.png")
            #expect(firstAttachment["content"] as? String == "base64payload")
        }
    }

    @Test func `chat send rejects empty trimmed message`() async throws {
        let connection = makeTestGatewayConnection()

        do {
            _ = try await connection.chatSend(
                sessionKey: "main",
                message: "   \n\t  ",
                thinking: "default",
                idempotencyKey: "empty-chat",
                attachments: [])
            Issue.record("expected empty message failure")
        } catch {
            #expect(error.localizedDescription == "message empty")
        }
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
