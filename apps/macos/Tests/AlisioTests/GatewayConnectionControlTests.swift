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

private func gatewayCanonicalAccountPayloadJSON(authMethod: String) -> String {
    """
    {
      "accountId": "acct-1",
      "canonical": {
        "authenticated": true,
        "accountId": "acct-1",
        "source": "account_id"
      },
      "profile": {
        "userId": "user-1",
        "email": "nuno@example.com",
        "displayName": "Nuno Lopes"
      },
      "session": {
        "state": "signed_in",
        "authenticated": true,
        "accountId": "acct-1",
        "authMethod": "\(authMethod)"
      },
      "devices": []
    }
    """
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

    @Test func `begin account email auth forwards native callback url`() async throws {
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
                            payloadJSON: #"{"ok":true,"email":"nuno@example.com","message":"Check your email."}"#)))
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

        let challenge = try await connection.beginAccountEmailAuth(email: "  Nuno@Example.com  ")

        #expect(challenge.method == .email)
        #expect(challenge.email == "nuno@example.com")
        #expect(challenge.supportsMagicLink)
        #expect(challenge.supportsManualCode)
        let frameData = try #require(await captured.snapshot())
        let frame = try #require(try JSONSerialization.jsonObject(with: frameData) as? [String: Any])
        #expect(frame["method"] as? String == GatewayConnection.Method.alisioAccountBeginEmailAuth.rawValue)
        let params = try #require(frame["params"] as? [String: Any])
        #expect(params["email"] as? String == "Nuno@Example.com")
        #expect(params["callbackUrl"] as? String == GatewayConnection.accountAuthCallbackURL.absoluteString)
    }

    @Test func `verify account email auth forwards code and decodes snapshot`() async throws {
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
                            payloadJSON: gatewayCanonicalAccountPayloadJSON(authMethod: "email"))))
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

        let snapshot = try await connection.verifyAccountEmailAuth(
            email: "  nuno@example.com  ",
            code: " 123456 ")

        #expect(snapshot.isAuthenticated)
        #expect(snapshot.session?.authMethod == .email)
        let frameData = try #require(await captured.snapshot())
        let frame = try #require(try JSONSerialization.jsonObject(with: frameData) as? [String: Any])
        #expect(frame["method"] as? String == GatewayConnection.Method.alisioAccountVerifyEmailAuth.rawValue)
        let params = try #require(frame["params"] as? [String: Any])
        #expect(params["email"] as? String == "nuno@example.com")
        #expect(params["code"] as? String == "123456")
    }

    @Test func `complete account email link forwards tokens and decodes snapshot`() async throws {
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
                            payloadJSON: gatewayCanonicalAccountPayloadJSON(authMethod: "email"))))
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

        let snapshot = try await connection.completeAccountEmailLinkAuth(
            .init(
                accessToken: "access-token",
                refreshToken: "refresh-token",
                expiresIn: 3600,
                tokenType: "bearer"))

        #expect(snapshot.isAuthenticated)
        #expect(snapshot.session?.authMethod == .email)
        let frameData = try #require(await captured.snapshot())
        let frame = try #require(try JSONSerialization.jsonObject(with: frameData) as? [String: Any])
        #expect(frame["method"] as? String == GatewayConnection.Method.alisioAccountCompleteEmailLinkAuth.rawValue)
        let params = try #require(frame["params"] as? [String: Any])
        #expect(params["accessToken"] as? String == "access-token")
        #expect(params["refreshToken"] as? String == "refresh-token")
        #expect(params["expiresIn"] as? Int == 3600)
        #expect(params["tokenType"] as? String == "bearer")
    }

    @Test func `begin account google auth forwards native callback url`() async throws {
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
                            payloadJSON: #"{"setupUrl":"https://example.com/google-auth"}"#)))
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

        let request = try await connection.beginAccountGoogleAuth()

        #expect(request.method == .google)
        #expect(request.setupURL.absoluteString == "https://example.com/google-auth")
        let frameData = try #require(await captured.snapshot())
        let frame = try #require(try JSONSerialization.jsonObject(with: frameData) as? [String: Any])
        #expect(frame["method"] as? String == GatewayConnection.Method.alisioAccountBeginGoogleAuth.rawValue)
        let params = try #require(frame["params"] as? [String: Any])
        #expect(params["callbackUrl"] as? String == GatewayConnection.accountAuthCallbackURL.absoluteString)
    }

    @Test func `complete account google auth forwards callback payload and decodes snapshot`() async throws {
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
                            payloadJSON: gatewayCanonicalAccountPayloadJSON(authMethod: "google"))))
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

        let snapshot = try await connection.completeAccountGoogleAuth(
            .init(
                stateToken: "state-1",
                code: "google-code",
                error: nil,
                errorDescription: nil))

        #expect(snapshot.isAuthenticated)
        #expect(snapshot.session?.authMethod == .google)
        let frameData = try #require(await captured.snapshot())
        let frame = try #require(try JSONSerialization.jsonObject(with: frameData) as? [String: Any])
        #expect(frame["method"] as? String == GatewayConnection.Method.alisioAccountCompleteGoogleAuth.rawValue)
        let params = try #require(frame["params"] as? [String: Any])
        #expect(params["stateToken"] as? String == "state-1")
        #expect(params["code"] as? String == "google-code")
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

    @Test @MainActor func `sessions create request forwards canonical new chat fields`() async throws {
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
                                payloadJSON: #"{"ok":true,"key":"agent:main:dashboard:new-chat","sessionId":"sess-new","runStarted":false}"#)))
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

            let response = try await connection.sessionsCreate(
                parentSessionKey: "  main  ",
                agentId: " main ",
                label: "  Native Chat  ",
                model: "  openai/gpt-5.4  ",
                task: "  hello from create  ")

            #expect(response.key == "agent:main:dashboard:new-chat")
            #expect(response.sessionId == "sess-new")
            let frameData = try #require(await captured.snapshot())
            let frame = try #require(try JSONSerialization.jsonObject(with: frameData) as? [String: Any])
            #expect(frame["method"] as? String == GatewayConnection.Method.sessionsCreate.rawValue)
            let params = try #require(frame["params"] as? [String: Any])
            #expect(params["parentSessionKey"] as? String == "main")
            #expect(params["agentId"] as? String == "main")
            #expect(params["label"] as? String == "Native Chat")
            #expect(params["model"] as? String == "openai/gpt-5.4")
            #expect(params["task"] as? String == "hello from create")
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
