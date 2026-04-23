import AlisioKit
import Foundation
import Testing
@testable import AlisioChatUI

private func chatTextMessage(role: String, text: String, timestamp: Double) -> AnyCodable {
    AnyCodable([
        "role": role,
        "content": [["type": "text", "text": text]],
        "timestamp": timestamp,
    ])
}

private func historyPayload(
    sessionKey: String = "main",
    sessionId: String? = "sess-main",
    messages: [AnyCodable] = []) -> AlisioChatHistoryPayload
{
    AlisioChatHistoryPayload(
        sessionKey: sessionKey,
        sessionId: sessionId,
        messages: messages,
        thinkingLevel: "off")
}

private func sessionEntry(key: String, updatedAt: Double, displayName: String? = nil) -> AlisioChatSessionEntry {
    AlisioChatSessionEntry(
        key: key,
        kind: nil,
        displayName: displayName,
        surface: nil,
        subject: nil,
        room: nil,
        space: nil,
        updatedAt: updatedAt,
        sessionId: nil,
        systemSent: nil,
        abortedLastRun: nil,
        thinkingLevel: nil,
        verboseLevel: nil,
        inputTokens: nil,
        outputTokens: nil,
        totalTokens: nil,
        modelProvider: nil,
        model: nil,
        contextTokens: nil)
}

private func sessionEntry(
    key: String,
    updatedAt: Double,
    model: String?,
    modelProvider: String? = nil) -> AlisioChatSessionEntry
{
    AlisioChatSessionEntry(
        key: key,
        kind: nil,
        displayName: nil,
        surface: nil,
        subject: nil,
        room: nil,
        space: nil,
        updatedAt: updatedAt,
        sessionId: nil,
        systemSent: nil,
        abortedLastRun: nil,
        thinkingLevel: nil,
        verboseLevel: nil,
        inputTokens: nil,
        outputTokens: nil,
        totalTokens: nil,
        modelProvider: modelProvider,
        model: model,
        contextTokens: nil)
}

private func modelChoice(id: String, name: String, provider: String = "anthropic") -> AlisioChatModelChoice {
    AlisioChatModelChoice(modelID: id, name: name, provider: provider, contextWindow: nil)
}

private func makeViewModel(
    sessionKey: String = "main",
    historyResponses: [AlisioChatHistoryPayload],
    sessionsResponses: [AlisioChatSessionsListResponse] = [],
    modelResponses: [[AlisioChatModelChoice]] = [],
    createSessionResponses: [AlisioChatSessionCreateResponse] = [],
    listSessionsHook: (@Sendable (AlisioChatSessionsQuery) async throws -> AlisioChatSessionsListResponse)? = nil,
    resetSessionHook: (@Sendable (String) async throws -> Void)? = nil,
    compactSessionHook: (@Sendable (String) async throws -> Void)? = nil,
    deleteSessionHook: (@Sendable (String) async throws -> Void)? = nil,
    renameSessionHook: (@Sendable (String, String?) async throws -> Void)? = nil,
    createSessionHook: (@Sendable (AlisioChatSessionCreateRequest) async throws -> AlisioChatSessionCreateResponse)? = nil,
    setSessionModelHook: (@Sendable (String?) async throws -> Void)? = nil,
    setSessionThinkingHook: (@Sendable (String) async throws -> Void)? = nil,
    sendMessageHook: (@Sendable (
        _ sessionKey: String,
        _ message: String,
        _ thinking: String,
        _ idempotencyKey: String,
        _ attachments: [AlisioChatAttachmentPayload]) async throws -> AlisioChatSendResponse)? = nil,
    initialThinkingLevel: String? = nil,
    onThinkingLevelChanged: (@MainActor @Sendable (String) -> Void)? = nil) async
    -> (TestChatTransport, AlisioChatViewModel)
{
    let transport = TestChatTransport(
        historyResponses: historyResponses,
        sessionsResponses: sessionsResponses,
        modelResponses: modelResponses,
        createSessionResponses: createSessionResponses,
        listSessionsHook: listSessionsHook,
        resetSessionHook: resetSessionHook,
        compactSessionHook: compactSessionHook,
        deleteSessionHook: deleteSessionHook,
        renameSessionHook: renameSessionHook,
        createSessionHook: createSessionHook,
        setSessionModelHook: setSessionModelHook,
        sendMessageHook: sendMessageHook,
        setSessionThinkingHook: setSessionThinkingHook)
    let vm = await MainActor.run {
        AlisioChatViewModel(
            sessionKey: sessionKey,
            transport: transport,
            initialThinkingLevel: initialThinkingLevel,
            onThinkingLevelChanged: onThinkingLevelChanged)
    }
    return (transport, vm)
}

private func loadAndWaitBootstrap(
    vm: AlisioChatViewModel,
    sessionId: String? = nil) async throws
{
    await MainActor.run { vm.load() }
    try await waitUntil("bootstrap") {
        await MainActor.run {
            vm.healthOK && (sessionId == nil || vm.sessionId == sessionId)
        }
    }
}

private func sendUserMessage(_ vm: AlisioChatViewModel, text: String = "hi") async {
    await MainActor.run {
        vm.input = text
        vm.send()
    }
}

@discardableResult
private func sendMessageAndEmitFinal(
    transport: TestChatTransport,
    vm: AlisioChatViewModel,
    text: String,
    sessionKey: String = "main") async throws -> String
{
    let previousRunId = await transport.lastSentRunId()
    await sendUserMessage(vm, text: text)
    try await waitUntil("send dispatches a new run") {
        let latestRunId = await transport.lastSentRunId()
        guard let latestRunId else { return false }
        return latestRunId != previousRunId
    }
    try await waitUntil("pending run starts") { await MainActor.run { vm.pendingRunCount >= 1 } }

    let runId = try #require(await transport.lastSentRunId())
    transport.emit(
        .chat(
            AlisioChatEventPayload(
                runId: runId,
                sessionKey: sessionKey,
                state: "final",
                message: nil,
                errorMessage: nil)))
    try await waitUntil("pending run clears after final") { await MainActor.run { vm.pendingRunCount == 0 } }
    return runId
}

private func emitAssistantText(
    transport: TestChatTransport,
    runId: String,
    text: String,
    seq: Int = 1,
    sessionKey: String? = nil)
{
    transport.emit(
        .agent(
            AlisioAgentEventPayload(
                runId: runId,
                seq: seq,
                stream: "assistant",
                ts: Int(Date().timeIntervalSince1970 * 1000),
                data: ["text": AnyCodable(text)],
                sessionKey: sessionKey)))
}

private func emitToolStart(
    transport: TestChatTransport,
    runId: String,
    seq: Int = 2,
    sessionKey: String? = nil)
{
    transport.emit(
        .agent(
            AlisioAgentEventPayload(
                runId: runId,
                seq: seq,
                stream: "tool",
                ts: Int(Date().timeIntervalSince1970 * 1000),
                data: [
                    "phase": AnyCodable("start"),
                    "name": AnyCodable("demo"),
                    "toolCallId": AnyCodable("t1"),
                    "args": AnyCodable(["x": 1]),
                ],
                sessionKey: sessionKey)))
}

private func emitExternalFinal(
    transport: TestChatTransport,
    runId: String = "other-run",
    sessionKey: String = "main")
{
    transport.emit(
        .chat(
            AlisioChatEventPayload(
                runId: runId,
                sessionKey: sessionKey,
                state: "final",
                message: nil,
                errorMessage: nil)))
}

@MainActor
private final class CallbackBox {
    var values: [String] = []
}

private actor AsyncGate {
    private var continuation: CheckedContinuation<Void, Never>?

    func wait() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func open() {
        self.continuation?.resume()
        self.continuation = nil
    }
}

private actor AsyncCounter {
    private var value: Int

    init(_ initialValue: Int = 0) {
        self.value = initialValue
    }

    func increment() -> Int {
        self.value += 1
        return self.value
    }
}

private actor TestChatTransportState {
    var renamedSessions: [SessionRenameCall] = []
    var historyCallCount: Int = 0
    var sessionsCallCount: Int = 0
    var modelsCallCount: Int = 0
    var listSessionQueries: [AlisioChatSessionsQuery] = []
    var resetSessionKeys: [String] = []
    var compactSessionKeys: [String] = []
    var deleteSessionKeys: [String] = []
    var createSessionRequests: [AlisioChatSessionCreateRequest] = []
    var sentRunIds: [String] = []
    var sentThinkingLevels: [String] = []
    var sentAttachments: [[AlisioChatAttachmentPayload]] = []
    var abortedRunIds: [String] = []
    var patchedModels: [String?] = []
    var patchedThinkingLevels: [String] = []
}

private struct SessionRenameCall: Equatable, Sendable {
    let sessionKey: String
    let displayName: String?
}

private final class TestChatTransport: @unchecked Sendable, AlisioChatTransport {
    private let state = TestChatTransportState()
    private let historyResponses: [AlisioChatHistoryPayload]
    private let sessionsResponses: [AlisioChatSessionsListResponse]
    private let modelResponses: [[AlisioChatModelChoice]]
    private let createSessionResponses: [AlisioChatSessionCreateResponse]
    private let listSessionsHook: (@Sendable (AlisioChatSessionsQuery) async throws -> AlisioChatSessionsListResponse)?
    private let resetSessionHook: (@Sendable (String) async throws -> Void)?
    private let compactSessionHook: (@Sendable (String) async throws -> Void)?
    private let deleteSessionHook: (@Sendable (String) async throws -> Void)?
    private let renameSessionHook: (@Sendable (String, String?) async throws -> Void)?
    private let createSessionHook: (@Sendable (AlisioChatSessionCreateRequest) async throws -> AlisioChatSessionCreateResponse)?
    private let setSessionModelHook: (@Sendable (String?) async throws -> Void)?
    private let sendMessageHook: (@Sendable (
        _ sessionKey: String,
        _ message: String,
        _ thinking: String,
        _ idempotencyKey: String,
        _ attachments: [AlisioChatAttachmentPayload]) async throws -> AlisioChatSendResponse)?
    private let setSessionThinkingHook: (@Sendable (String) async throws -> Void)?

    private let stream: AsyncStream<AlisioChatTransportEvent>
    private let continuation: AsyncStream<AlisioChatTransportEvent>.Continuation

    init(
        historyResponses: [AlisioChatHistoryPayload],
        sessionsResponses: [AlisioChatSessionsListResponse] = [],
        modelResponses: [[AlisioChatModelChoice]] = [],
        createSessionResponses: [AlisioChatSessionCreateResponse] = [],
        listSessionsHook: (@Sendable (AlisioChatSessionsQuery) async throws -> AlisioChatSessionsListResponse)? = nil,
        resetSessionHook: (@Sendable (String) async throws -> Void)? = nil,
        compactSessionHook: (@Sendable (String) async throws -> Void)? = nil,
        deleteSessionHook: (@Sendable (String) async throws -> Void)? = nil,
        renameSessionHook: (@Sendable (String, String?) async throws -> Void)? = nil,
        createSessionHook: (@Sendable (AlisioChatSessionCreateRequest) async throws -> AlisioChatSessionCreateResponse)? = nil,
        setSessionModelHook: (@Sendable (String?) async throws -> Void)? = nil,
        sendMessageHook: (@Sendable (
            _ sessionKey: String,
            _ message: String,
            _ thinking: String,
            _ idempotencyKey: String,
            _ attachments: [AlisioChatAttachmentPayload]) async throws -> AlisioChatSendResponse)? = nil,
        setSessionThinkingHook: (@Sendable (String) async throws -> Void)? = nil)
    {
        self.historyResponses = historyResponses
        self.sessionsResponses = sessionsResponses
        self.modelResponses = modelResponses
        self.createSessionResponses = createSessionResponses
        self.listSessionsHook = listSessionsHook
        self.resetSessionHook = resetSessionHook
        self.compactSessionHook = compactSessionHook
        self.deleteSessionHook = deleteSessionHook
        self.renameSessionHook = renameSessionHook
        self.createSessionHook = createSessionHook
        self.setSessionModelHook = setSessionModelHook
        self.sendMessageHook = sendMessageHook
        self.setSessionThinkingHook = setSessionThinkingHook
        var cont: AsyncStream<AlisioChatTransportEvent>.Continuation!
        self.stream = AsyncStream { c in
            cont = c
        }
        self.continuation = cont
    }

    func events() -> AsyncStream<AlisioChatTransportEvent> {
        self.stream
    }

    func requestHistory(sessionKey: String) async throws -> AlisioChatHistoryPayload {
        let idx = await self.state.historyCallCount
        await self.state.setHistoryCallCount(idx + 1)
        if idx < self.historyResponses.count {
            return self.historyResponses[idx]
        }
        return self.historyResponses.last ?? AlisioChatHistoryPayload(
            sessionKey: sessionKey,
            sessionId: nil,
            messages: [],
            thinkingLevel: "off")
    }

    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [AlisioChatAttachmentPayload]) async throws -> AlisioChatSendResponse
    {
        await self.state.sentRunIdsAppend(idempotencyKey)
        await self.state.sentThinkingLevelsAppend(thinking)
        await self.state.sentAttachmentsAppend(attachments)
        if let sendMessageHook = self.sendMessageHook {
            return try await sendMessageHook(sessionKey, message, thinking, idempotencyKey, attachments)
        }
        return AlisioChatSendResponse(runId: idempotencyKey, status: "ok")
    }

    func abortRun(sessionKey _: String, runId: String) async throws {
        await self.state.abortedRunIdsAppend(runId)
    }

    func listSessions(query: AlisioChatSessionsQuery) async throws -> AlisioChatSessionsListResponse {
        await self.state.listSessionQueriesAppend(query)
        if let listSessionsHook = self.listSessionsHook {
            return try await listSessionsHook(query)
        }
        let idx = await self.state.sessionsCallCount
        await self.state.setSessionsCallCount(idx + 1)
        if idx < self.sessionsResponses.count {
            return self.sessionsResponses[idx]
        }
        return self.sessionsResponses.last ?? AlisioChatSessionsListResponse(
            ts: nil,
            path: nil,
            count: 0,
            defaults: nil,
            sessions: [])
    }

    func listModels() async throws -> [AlisioChatModelChoice] {
        let idx = await self.state.modelsCallCount
        await self.state.setModelsCallCount(idx + 1)
        if idx < self.modelResponses.count {
            return self.modelResponses[idx]
        }
        return self.modelResponses.last ?? []
    }

    func createSession(request: AlisioChatSessionCreateRequest) async throws -> AlisioChatSessionCreateResponse {
        await self.state.createSessionRequestsAppend(request)
        if let createSessionHook = self.createSessionHook {
            return try await createSessionHook(request)
        }
        let requests = await self.state.createSessionRequests
        let fallbackIndex = max(0, requests.count - 1)
        if fallbackIndex < self.createSessionResponses.count {
            return self.createSessionResponses[fallbackIndex]
        }
        let key = "agent:main:dashboard:\(UUID().uuidString.lowercased())"
        return AlisioChatSessionCreateResponse(
            ok: true,
            key: key,
            sessionId: "sess-\(fallbackIndex)",
            entry: sessionEntry(key: key, updatedAt: Date().timeIntervalSince1970 * 1000))
    }

    func setSessionModel(sessionKey _: String, model: String?) async throws {
        await self.state.patchedModelsAppend(model)
        if let setSessionModelHook = self.setSessionModelHook {
            try await setSessionModelHook(model)
        }
    }

    func resetSession(sessionKey: String) async throws {
        await self.state.resetSessionKeysAppend(sessionKey)
        if let resetSessionHook = self.resetSessionHook {
            try await resetSessionHook(sessionKey)
        }
    }

    func deleteSession(sessionKey: String) async throws {
        await self.state.deleteSessionKeysAppend(sessionKey)
        if let deleteSessionHook = self.deleteSessionHook {
            try await deleteSessionHook(sessionKey)
        }
    }

    func compactSession(sessionKey: String) async throws {
        await self.state.compactSessionKeysAppend(sessionKey)
        if let compactSessionHook = self.compactSessionHook {
            try await compactSessionHook(sessionKey)
        }
    }

    func renameSession(sessionKey: String, displayName: String?) async throws {
        await self.state.renamedSessionsAppend(.init(sessionKey: sessionKey, displayName: displayName))
        if let renameSessionHook = self.renameSessionHook {
            try await renameSessionHook(sessionKey, displayName)
        }
    }

    func setSessionThinking(sessionKey _: String, thinkingLevel: String) async throws {
        await self.state.patchedThinkingLevelsAppend(thinkingLevel)
        if let setSessionThinkingHook = self.setSessionThinkingHook {
            try await setSessionThinkingHook(thinkingLevel)
        }
    }

    func requestHealth(timeoutMs _: Int) async throws -> Bool {
        true
    }

    func emit(_ evt: AlisioChatTransportEvent) {
        self.continuation.yield(evt)
    }

    func lastSentRunId() async -> String? {
        let ids = await self.state.sentRunIds
        return ids.last
    }

    func abortedRunIds() async -> [String] {
        await self.state.abortedRunIds
    }

    func sentThinkingLevels() async -> [String] {
        await self.state.sentThinkingLevels
    }

    func sentAttachments() async -> [[AlisioChatAttachmentPayload]] {
        await self.state.sentAttachments
    }

    func patchedModels() async -> [String?] {
        await self.state.patchedModels
    }

    func patchedThinkingLevels() async -> [String] {
        await self.state.patchedThinkingLevels
    }

    func resetSessionKeys() async -> [String] {
        await self.state.resetSessionKeys
    }

    func compactSessionKeys() async -> [String] {
        await self.state.compactSessionKeys
    }

    func deleteSessionKeys() async -> [String] {
        await self.state.deleteSessionKeys
    }

    func createSessionRequests() async -> [AlisioChatSessionCreateRequest] {
        await self.state.createSessionRequests
    }

    func listSessionQueries() async -> [AlisioChatSessionsQuery] {
        await self.state.listSessionQueries
    }

    func renamedSessions() async -> [SessionRenameCall] {
        await self.state.renamedSessions
    }
}

extension TestChatTransportState {
    fileprivate func renamedSessionsAppend(_ value: SessionRenameCall) {
        self.renamedSessions.append(value)
    }

    fileprivate func setHistoryCallCount(_ v: Int) {
        self.historyCallCount = v
    }

    fileprivate func setSessionsCallCount(_ v: Int) {
        self.sessionsCallCount = v
    }

    fileprivate func setModelsCallCount(_ v: Int) {
        self.modelsCallCount = v
    }

    fileprivate func sentRunIdsAppend(_ v: String) {
        self.sentRunIds.append(v)
    }

    fileprivate func abortedRunIdsAppend(_ v: String) {
        self.abortedRunIds.append(v)
    }

    fileprivate func sentThinkingLevelsAppend(_ v: String) {
        self.sentThinkingLevels.append(v)
    }

    fileprivate func sentAttachmentsAppend(_ value: [AlisioChatAttachmentPayload]) {
        self.sentAttachments.append(value)
    }

    fileprivate func patchedModelsAppend(_ v: String?) {
        self.patchedModels.append(v)
    }

    fileprivate func patchedThinkingLevelsAppend(_ v: String) {
        self.patchedThinkingLevels.append(v)
    }

    fileprivate func resetSessionKeysAppend(_ v: String) {
        self.resetSessionKeys.append(v)
    }

    fileprivate func compactSessionKeysAppend(_ v: String) {
        self.compactSessionKeys.append(v)
    }

    fileprivate func deleteSessionKeysAppend(_ v: String) {
        self.deleteSessionKeys.append(v)
    }

    fileprivate func createSessionRequestsAppend(_ value: AlisioChatSessionCreateRequest) {
        self.createSessionRequests.append(value)
    }

    fileprivate func listSessionQueriesAppend(_ value: AlisioChatSessionsQuery) {
        self.listSessionQueries.append(value)
    }
}

@Suite struct ChatViewModelTests {
    @Test func streamsAssistantAndClearsOnFinal() async throws {
        let sessionId = "sess-main"
        let history1 = historyPayload(sessionId: sessionId)
        let history2 = historyPayload(
            sessionId: sessionId,
            messages: [
                chatTextMessage(
                    role: "assistant",
                    text: "final answer",
                    timestamp: Date().timeIntervalSince1970 * 1000),
            ])

        let (transport, vm) = await makeViewModel(historyResponses: [history1, history2])
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)
        await sendUserMessage(vm)
        try await waitUntil("pending run starts") { await MainActor.run { vm.pendingRunCount == 1 } }

        emitAssistantText(transport: transport, runId: sessionId, text: "streaming…")

        try await waitUntil("assistant stream visible") {
            await MainActor.run { vm.streamingAssistantText == "streaming…" }
        }

        emitToolStart(transport: transport, runId: sessionId)

        try await waitUntil("tool call pending") { await MainActor.run { vm.pendingToolCalls.count == 1 } }

        let runId = try #require(await transport.lastSentRunId())
        transport.emit(
            .chat(
                AlisioChatEventPayload(
                    runId: runId,
                    sessionKey: "main",
                    state: "final",
                    message: nil,
                    errorMessage: nil)))

        try await waitUntil("pending run clears") { await MainActor.run { vm.pendingRunCount == 0 } }
        try await waitUntil("history refresh") {
            await MainActor.run { vm.messages.contains(where: { $0.role == "assistant" }) }
        }
        #expect(await MainActor.run { vm.streamingAssistantText } == nil)
        #expect(await MainActor.run { vm.pendingToolCalls.isEmpty })
    }

    @Test func streamsAgentEventsForPendingChatRunIdWithSessionKey() async throws {
        let history = historyPayload(sessionId: "sess-main")
        let (transport, vm) = await makeViewModel(historyResponses: [history, history])
        try await loadAndWaitBootstrap(vm: vm, sessionId: "sess-main")
        await sendUserMessage(vm)

        try await waitUntil("chat run dispatched") {
            await transport.lastSentRunId() != nil
        }
        let runId = try #require(await transport.lastSentRunId())

        emitAssistantText(
            transport: transport,
            runId: "other-run",
            text: "wrong session",
            sessionKey: "agent:main:other")
        try await Task.sleep(for: .milliseconds(50))
        #expect(await MainActor.run { vm.streamingAssistantText } == nil)

        emitAssistantText(
            transport: transport,
            runId: runId,
            text: "streaming from chat run",
            sessionKey: "agent:main:main")
        try await waitUntil("assistant event accepted for pending chat run") {
            await MainActor.run { vm.streamingAssistantText == "streaming from chat run" }
        }

        emitToolStart(transport: transport, runId: runId, sessionKey: "agent:main:main")
        try await waitUntil("tool event accepted for pending chat run") {
            await MainActor.run { vm.pendingToolCalls.count == 1 }
        }
    }

    @Test func keepsOptimisticUserMessageWhenFinalRefreshReturnsOnlyAssistantHistory() async throws {
        let sessionId = "sess-main"
        let now = Date().timeIntervalSince1970 * 1000
        let history1 = historyPayload(sessionId: sessionId)
        let history2 = historyPayload(
            sessionId: sessionId,
            messages: [
                chatTextMessage(
                    role: "assistant",
                    text: "final answer",
                    timestamp: now + 1),
            ])

        let (transport, vm) = await makeViewModel(historyResponses: [history1, history2])
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)
        try await sendMessageAndEmitFinal(
            transport: transport,
            vm: vm,
            text: "hello from mac workspace")

        try await waitUntil("assistant history refreshes without dropping user message") {
            await MainActor.run {
                let texts = vm.messages.map { message in
                    (message.role, message.content.compactMap(\.text).joined(separator: "\n"))
                }
                return texts.contains(where: { $0.0 == "assistant" && $0.1 == "final answer" }) &&
                    texts.contains(where: { $0.0 == "user" && $0.1 == "hello from mac workspace" })
            }
        }
    }

    @Test func keepsOptimisticUserMessageWhenFinalRefreshHistoryIsTemporarilyEmpty() async throws {
        let sessionId = "sess-main"
        let history1 = historyPayload(sessionId: sessionId)
        let history2 = historyPayload(sessionId: sessionId, messages: [])

        let (transport, vm) = await makeViewModel(historyResponses: [history1, history2])
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)
        try await sendMessageAndEmitFinal(
            transport: transport,
            vm: vm,
            text: "hello from mac workspace")

        try await waitUntil("empty refresh does not clear optimistic user message") {
            await MainActor.run {
                vm.messages.contains { message in
                    message.role == "user" &&
                        message.content.compactMap(\.text).joined(separator: "\n") == "hello from mac workspace"
                }
            }
        }
    }

    @Test func doesNotDuplicateUserMessageWhenRefreshReturnsCanonicalTimestamp() async throws {
        let sessionId = "sess-main"
        let now = Date().timeIntervalSince1970 * 1000
        let history1 = historyPayload(sessionId: sessionId)
        let history2 = historyPayload(
            sessionId: sessionId,
            messages: [
                chatTextMessage(
                    role: "user",
                    text: "hello from mac workspace",
                    timestamp: now + 5_000),
                chatTextMessage(
                    role: "assistant",
                    text: "final answer",
                    timestamp: now + 6_000),
            ])

        let (transport, vm) = await makeViewModel(historyResponses: [history1, history2])
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)
        try await sendMessageAndEmitFinal(
            transport: transport,
            vm: vm,
            text: "hello from mac workspace")

        try await waitUntil("canonical refresh keeps one user message") {
            await MainActor.run {
                let userMessages = vm.messages.filter { message in
                    message.role == "user" &&
                        message.content.compactMap(\.text).joined(separator: "\n") == "hello from mac workspace"
                }
                let hasAssistant = vm.messages.contains { message in
                    message.role == "assistant" &&
                        message.content.compactMap(\.text).joined(separator: "\n") == "final answer"
                }
                return hasAssistant && userMessages.count == 1
            }
        }
    }

    @Test func preservesRepeatedOptimisticUserMessagesWithIdenticalContentDuringRefresh() async throws {
        let sessionId = "sess-main"
        let now = Date().timeIntervalSince1970 * 1000
        let history1 = historyPayload(sessionId: sessionId)
        let history2 = historyPayload(
            sessionId: sessionId,
            messages: [
                chatTextMessage(
                    role: "user",
                    text: "retry",
                    timestamp: now + 5_000),
                chatTextMessage(
                    role: "assistant",
                    text: "first answer",
                    timestamp: now + 6_000),
            ])

        let (transport, vm) = await makeViewModel(historyResponses: [history1, history2, history2])
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)
        try await sendMessageAndEmitFinal(
            transport: transport,
            vm: vm,
            text: "retry")
        try await sendMessageAndEmitFinal(
            transport: transport,
            vm: vm,
            text: "retry")

        try await waitUntil("repeated optimistic user message is preserved") {
            await MainActor.run {
                let retryMessages = vm.messages.filter { message in
                    message.role == "user" &&
                        message.content.compactMap(\.text).joined(separator: "\n") == "retry"
                }
                let hasAssistant = vm.messages.contains { message in
                    message.role == "assistant" &&
                        message.content.compactMap(\.text).joined(separator: "\n") == "first answer"
                }
                return hasAssistant && retryMessages.count == 2
            }
        }
    }

    @Test func acceptsCanonicalSessionKeyEventsForOwnPendingRun() async throws {
        let history1 = historyPayload()
        let history2 = historyPayload(
            messages: [
                chatTextMessage(
                    role: "assistant",
                    text: "from history",
                    timestamp: Date().timeIntervalSince1970 * 1000),
            ])

        let (transport, vm) = await makeViewModel(historyResponses: [history1, history2])
        try await loadAndWaitBootstrap(vm: vm)
        await sendUserMessage(vm)
        try await waitUntil("pending run starts") { await MainActor.run { vm.pendingRunCount == 1 } }

        let runId = try #require(await transport.lastSentRunId())
        transport.emit(
            .chat(
                AlisioChatEventPayload(
                    runId: runId,
                    sessionKey: "agent:main:main",
                    state: "final",
                    message: nil,
                    errorMessage: nil)))

        try await waitUntil("pending run clears") { await MainActor.run { vm.pendingRunCount == 0 } }
        try await waitUntil("history refresh") {
            await MainActor.run { vm.messages.contains(where: { $0.role == "assistant" }) }
        }
    }

    @Test func acceptsCanonicalSessionKeyEventsForExternalRuns() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history1 = historyPayload(messages: [chatTextMessage(role: "user", text: "first", timestamp: now)])
        let history2 = historyPayload(
            messages: [
                chatTextMessage(role: "user", text: "first", timestamp: now),
                chatTextMessage(role: "assistant", text: "from external run", timestamp: now + 1),
            ])

        let (transport, vm) = await makeViewModel(historyResponses: [history1, history2])

        await MainActor.run { vm.load() }
        try await waitUntil("bootstrap history loaded") { await MainActor.run { vm.messages.count == 1 } }

        transport.emit(
            .chat(
                AlisioChatEventPayload(
                    runId: "external-run",
                    sessionKey: "agent:main:main",
                    state: "final",
                    message: nil,
                    errorMessage: nil)))

        try await waitUntil("history refresh after canonical external event") {
            await MainActor.run { vm.messages.count == 2 }
        }
    }

    @Test func preservesMessageIDsAcrossHistoryRefreshes() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history1 = historyPayload(messages: [chatTextMessage(role: "user", text: "hello", timestamp: now)])
        let history2 = historyPayload(
            messages: [
                chatTextMessage(role: "user", text: "hello", timestamp: now),
                chatTextMessage(role: "assistant", text: "world", timestamp: now + 1),
            ])

        let (transport, vm) = await makeViewModel(historyResponses: [history1, history2])

        await MainActor.run { vm.load() }
        try await waitUntil("bootstrap history loaded") { await MainActor.run { vm.messages.count == 1 } }
        let firstIdBefore = try #require(await MainActor.run { vm.messages.first?.id })

        emitExternalFinal(transport: transport)

        try await waitUntil("history refresh") { await MainActor.run { vm.messages.count == 2 } }
        let firstIdAfter = try #require(await MainActor.run { vm.messages.first?.id })
        #expect(firstIdAfter == firstIdBefore)
    }

    @Test func clearsStreamingOnExternalFinalEvent() async throws {
        let sessionId = "sess-main"
        let history = historyPayload(sessionId: sessionId)
        let (transport, vm) = await makeViewModel(historyResponses: [history, history])
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)

        emitAssistantText(transport: transport, runId: sessionId, text: "external stream")
        emitToolStart(transport: transport, runId: sessionId)

        try await waitUntil("streaming active") {
            await MainActor.run { vm.streamingAssistantText == "external stream" }
        }
        try await waitUntil("tool call pending") { await MainActor.run { vm.pendingToolCalls.count == 1 } }

        emitExternalFinal(transport: transport)

        try await waitUntil("streaming cleared") { await MainActor.run { vm.streamingAssistantText == nil } }
        #expect(await MainActor.run { vm.pendingToolCalls.isEmpty })
    }

    @Test func externalFinalDoesNotClearLocalStreamingForOwnPendingRun() async throws {
        let sessionId = "sess-main"
        let history = historyPayload(sessionId: sessionId)
        let (transport, vm) = await makeViewModel(historyResponses: [history, history])
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)

        await sendUserMessage(vm)
        try await waitUntil("pending run starts") { await MainActor.run { vm.pendingRunCount == 1 } }

        let runId = try #require(await transport.lastSentRunId())
        emitAssistantText(transport: transport, runId: runId, text: "local stream", sessionKey: "main")
        emitToolStart(transport: transport, runId: runId, sessionKey: "main")

        try await waitUntil("local stream visible") {
            await MainActor.run { vm.streamingAssistantText == "local stream" && vm.pendingToolCalls.count == 1 }
        }

        emitExternalFinal(transport: transport, runId: "other-run", sessionKey: "main")
        try? await Task.sleep(for: .milliseconds(50))

        #expect(await MainActor.run { vm.streamingAssistantText } == "local stream")
        #expect(await MainActor.run { vm.pendingToolCalls.count } == 1)
    }

    @Test func sendsGenericFileAttachmentsWithoutRejectingNonImageFiles() async throws {
        let (transport, vm) = await makeViewModel(historyResponses: [historyPayload(), historyPayload()])
        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run {
            vm.addAttachment(
                data: Data("draft notes".utf8),
                fileName: "notes.txt",
                mimeType: "text/plain")
        }

        try await waitUntil("attachment queued") {
            await MainActor.run { vm.attachments.count == 1 && vm.attachments.first?.type == "file" }
        }

        await MainActor.run { vm.send() }
        try await waitUntil("attachment send captured") {
            await transport.sentAttachments().count == 1
        }

        let sentAttachment = try #require(await transport.sentAttachments().first?.first)
        #expect(sentAttachment.type == "file")
        #expect(sentAttachment.mimeType == "text/plain")
        #expect(sentAttachment.fileName == "notes.txt")
        #expect(await MainActor.run {
            vm.messages.last?.content.contains(where: { content in
                content.type == "file" && content.fileName == "notes.txt"
            }) == true
        })

        let runId = try #require(await transport.lastSentRunId())
        transport.emit(
            .chat(
                AlisioChatEventPayload(
                    runId: runId,
                    sessionKey: "main",
                    state: "final",
                    message: nil,
                    errorMessage: nil)))
        try await waitUntil("attachment send settles") { await MainActor.run { vm.pendingRunCount == 0 } }
    }

    @Test func seqGapClearsPendingRunsAndAutoRefreshesHistory() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history1 = historyPayload()
        let history2 = historyPayload(messages: [chatTextMessage(role: "assistant", text: "resynced after gap", timestamp: now)])

        let (transport, vm) = await makeViewModel(historyResponses: [history1, history2])

        try await loadAndWaitBootstrap(vm: vm)

        await sendUserMessage(vm, text: "hello")
        try await waitUntil("pending run starts") { await MainActor.run { vm.pendingRunCount == 1 } }

        transport.emit(.seqGap)

        try await waitUntil("pending run clears on seqGap") {
            await MainActor.run { vm.pendingRunCount == 0 }
        }
        try await waitUntil("history refreshes on seqGap") {
            await MainActor.run { vm.messages.contains(where: { $0.role == "assistant" }) }
        }
        #expect(await MainActor.run { vm.errorText == nil })
    }

    @Test func sessionChoicesPreferMainAndKeepOlderChatsAvailable() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let recent = now - (2 * 60 * 60 * 1000)
        let recentOlder = now - (5 * 60 * 60 * 1000)
        let stale = now - (26 * 60 * 60 * 1000)
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 4,
            defaults: nil,
            sessions: [
                sessionEntry(key: "recent-1", updatedAt: recent),
                sessionEntry(key: "main", updatedAt: stale),
                sessionEntry(key: "recent-2", updatedAt: recentOlder),
                sessionEntry(key: "old-1", updatedAt: stale),
            ])

        let (_, vm) = await makeViewModel(historyResponses: [history], sessionsResponses: [sessions])
        await MainActor.run { vm.load() }
        try await waitUntil("sessions loaded") { await MainActor.run { !vm.sessions.isEmpty } }

        let keys = await MainActor.run { vm.sessionChoices.map(\.key) }
        #expect(keys == ["main", "recent-1", "recent-2", "old-1"])
    }

    @Test func sessionChoicesIncludeCurrentWhenMissing() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let recent = now - (30 * 60 * 1000)
        let history = historyPayload(sessionKey: "custom", sessionId: "sess-custom")
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: recent),
            ])

        let (_, vm) = await makeViewModel(
            sessionKey: "custom",
            historyResponses: [history],
            sessionsResponses: [sessions])
        await MainActor.run { vm.load() }
        try await waitUntil("sessions loaded") { await MainActor.run { !vm.sessions.isEmpty } }

        let keys = await MainActor.run { vm.sessionChoices.map(\.key) }
        #expect(keys == ["main", "custom"])
    }

    @Test func sessionChoicesUseResolvedMainSessionKeyInsteadOfLiteralMain() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let recent = now - (30 * 60 * 1000)
        let recentOlder = now - (90 * 60 * 1000)
        let history = historyPayload(sessionKey: "Luke’s MacBook Pro", sessionId: "sess-main")
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: AlisioChatSessionsDefaults(
                model: nil,
                contextTokens: nil,
                mainSessionKey: "Luke’s MacBook Pro"),
            sessions: [
                AlisioChatSessionEntry(
                    key: "Luke’s MacBook Pro",
                    kind: nil,
                    displayName: "Luke’s MacBook Pro",
                    surface: nil,
                    subject: nil,
                    room: nil,
                    space: nil,
                    updatedAt: recent,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    modelProvider: nil,
                    model: nil,
                    contextTokens: nil),
                sessionEntry(key: "recent-1", updatedAt: recentOlder),
            ])

        let (_, vm) = await makeViewModel(
            sessionKey: "Luke’s MacBook Pro",
            historyResponses: [history],
            sessionsResponses: [sessions])
        await MainActor.run { vm.load() }
        try await waitUntil("sessions loaded") { await MainActor.run { !vm.sessions.isEmpty } }

        let keys = await MainActor.run { vm.sessionChoices.map(\.key) }
        #expect(keys == ["Luke’s MacBook Pro", "recent-1"])
    }

    @Test func sessionChoicesDedupeMainAliasAgainstResolvedMainSessionKey() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload(sessionKey: "main", sessionId: "sess-main")
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 3,
            defaults: AlisioChatSessionsDefaults(
                model: nil,
                contextTokens: nil,
                mainSessionKey: "Luke’s MacBook Pro"),
            sessions: [
                sessionEntry(key: "main", updatedAt: now - 1_000),
                AlisioChatSessionEntry(
                    key: "Luke’s MacBook Pro",
                    kind: nil,
                    displayName: "Luke’s MacBook Pro",
                    surface: nil,
                    subject: nil,
                    room: nil,
                    space: nil,
                    updatedAt: now,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    modelProvider: nil,
                    model: nil,
                    contextTokens: nil),
                sessionEntry(key: "recent-1", updatedAt: now - 2_000),
            ])

        let (_, vm) = await makeViewModel(
            sessionKey: "main",
            historyResponses: [history],
            sessionsResponses: [sessions])
        await MainActor.run { vm.load() }
        try await waitUntil("deduped main sessions loaded") {
            await MainActor.run { !vm.sessions.isEmpty }
        }

        let keys = await MainActor.run { vm.sessionChoices.map(\.key) }
        #expect(keys == ["Luke’s MacBook Pro", "recent-1"])
        #expect(await MainActor.run { vm.currentSessionEntry?.displayName } == "Luke’s MacBook Pro")
    }

    @Test func refreshWithoutDefaultsKeepsResolvedMainSessionIdentity() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let initial = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: AlisioChatSessionsDefaults(
                model: nil,
                contextTokens: nil,
                mainSessionKey: "Luke’s MacBook Pro"),
            sessions: [
                sessionEntry(key: "Luke’s MacBook Pro", updatedAt: now, displayName: "Luke’s MacBook Pro"),
                sessionEntry(key: "recent-1", updatedAt: now - 1_000),
            ])
        let staleRefresh = AlisioChatSessionsListResponse(
            ts: now + 1,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now + 1),
                sessionEntry(key: "recent-1", updatedAt: now - 1_000),
            ])

        let (_, vm) = await makeViewModel(
            sessionKey: "Luke’s MacBook Pro",
            historyResponses: [historyPayload(sessionKey: "Luke’s MacBook Pro", sessionId: "sess-main")],
            sessionsResponses: [initial, staleRefresh])
        await MainActor.run { vm.load() }
        try await waitUntil("initial canonical main loaded") {
            await MainActor.run { vm.sessionChoices.map(\.key) == ["Luke’s MacBook Pro", "recent-1"] }
        }

        await MainActor.run { vm.refreshSessions(limit: 200) }
        try await waitUntil("refresh without defaults applied without duplicate main aliases") {
            await MainActor.run { vm.sessionChoices.map(\.key) == ["main", "recent-1"] }
        }
        #expect(await MainActor.run { vm.currentSessionEntry?.displayName } == "Luke’s MacBook Pro")
        #expect(await MainActor.run { vm.sessionTitle(forKey: "Luke’s MacBook Pro") } == "Luke’s MacBook Pro")
    }

    @Test func sessionTitlesPreferHumanFallbacksOverCanonicalKeys() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now),
                sessionEntry(key: "agent:main:dashboard:new-chat", updatedAt: now - 1),
            ])

        let (_, vm) = await makeViewModel(historyResponses: [history], sessionsResponses: [sessions])
        await MainActor.run { vm.load() }
        try await waitUntil("sessions loaded") { await MainActor.run { !vm.sessions.isEmpty } }

        let titles = await MainActor.run {
            Dictionary(uniqueKeysWithValues: vm.sessionChoices.map { ($0.key, vm.sessionTitle(for: $0)) })
        }
        #expect(titles["main"] == "Main chat")
        #expect(titles["agent:main:dashboard:new-chat"] == "Chat")
    }

    @Test func newCurrentSessionUsesProductSummaryInsteadOfInfraCopy() async throws {
        let (_, vm) = await makeViewModel(
            sessionKey: "agent:main:dashboard:new-chat",
            historyResponses: [historyPayload(sessionKey: "agent:main:dashboard:new-chat", sessionId: "sess-new")])

        let title = await MainActor.run { vm.sessionTitle(forKey: vm.sessionKey) }
        let summary = await MainActor.run { vm.sessionSummary(forKey: vm.sessionKey) }

        #expect(title == "New chat")
        #expect(summary == "Start a fresh chat without losing your place.")
    }

    @Test func sessionChoicesHideInternalOnboardingSession() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let recent = now - (2 * 60 * 1000)
        let recentOlder = now - (5 * 60 * 1000)
        let history = historyPayload(sessionKey: "agent:main:main", sessionId: "sess-main")
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: AlisioChatSessionsDefaults(
                model: nil,
                contextTokens: nil,
                mainSessionKey: "agent:main:main"),
            sessions: [
                AlisioChatSessionEntry(
                    key: "agent:main:onboarding",
                    kind: nil,
                    displayName: "Luke’s MacBook Pro",
                    surface: nil,
                    subject: nil,
                    room: nil,
                    space: nil,
                    updatedAt: recent,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    modelProvider: nil,
                    model: nil,
                    contextTokens: nil),
                AlisioChatSessionEntry(
                    key: "agent:main:main",
                    kind: nil,
                    displayName: "Luke’s MacBook Pro",
                    surface: nil,
                    subject: nil,
                    room: nil,
                    space: nil,
                    updatedAt: recentOlder,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    modelProvider: nil,
                    model: nil,
                    contextTokens: nil),
            ])

        let (_, vm) = await makeViewModel(
            sessionKey: "agent:main:main",
            historyResponses: [history],
            sessionsResponses: [sessions])
        await MainActor.run { vm.load() }
        try await waitUntil("sessions loaded") { await MainActor.run { !vm.sessions.isEmpty } }

        let keys = await MainActor.run { vm.sessionChoices.map(\.key) }
        #expect(keys == ["agent:main:main"])
    }

    @Test func resetSessionActionResetsSessionAndReloadsHistory() async throws {
        let before = historyPayload(
            messages: [
                chatTextMessage(role: "assistant", text: "before reset", timestamp: 1),
            ])
        let after = historyPayload(
            messages: [
                chatTextMessage(role: "assistant", text: "after reset", timestamp: 2),
            ])

        let (transport, vm) = await makeViewModel(historyResponses: [before, after])
        try await loadAndWaitBootstrap(vm: vm)
        try await waitUntil("initial history loaded") {
            await MainActor.run { vm.messages.first?.content.first?.text == "before reset" }
        }

        await MainActor.run { vm.resetSession() }

        try await waitUntil("reset called") {
            await transport.resetSessionKeys() == ["main"]
        }
        try await waitUntil("history reloaded") {
            await MainActor.run { vm.messages.first?.content.first?.text == "after reset" }
        }
        #expect(await transport.lastSentRunId() == nil)
    }

    @Test func newChatCreatesCanonicalSessionAndPreservesDraftsPerSession() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let createdKey = "agent:main:dashboard:new-chat"
        let initialSessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now),
            ])
        let sessionsAfterCreate = AlisioChatSessionsListResponse(
            ts: now + 1,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: createdKey, updatedAt: now + 1),
                sessionEntry(key: "main", updatedAt: now),
            ])
        let createdResponse = AlisioChatSessionCreateResponse(
            ok: true,
            key: createdKey,
            sessionId: "sess-new",
            entry: sessionEntry(key: createdKey, updatedAt: now + 1))

        let (transport, vm) = await makeViewModel(
            historyResponses: [
                historyPayload(sessionKey: "main", sessionId: "sess-main"),
                historyPayload(sessionKey: createdKey, sessionId: "sess-new"),
                historyPayload(sessionKey: "main", sessionId: "sess-main"),
            ],
            sessionsResponses: [initialSessions, sessionsAfterCreate, sessionsAfterCreate],
            createSessionResponses: [createdResponse])
        try await loadAndWaitBootstrap(vm: vm, sessionId: "sess-main")

        await MainActor.run {
            vm.input = "draft for main chat"
            vm.newChat()
        }

        try await waitUntil("new chat request issued") {
            let requests = await transport.createSessionRequests()
            return requests.count == 1
        }
        try await waitUntil("view model switches to created session") {
            await MainActor.run { vm.sessionKey == createdKey && vm.sessionId == "sess-new" }
        }
        #expect(await MainActor.run { vm.input } == "")

        await MainActor.run { vm.switchSession(to: "main") }
        try await waitUntil("switch back to main session") {
            await MainActor.run { vm.sessionKey == "main" && vm.sessionId == "sess-main" }
        }
        #expect(await MainActor.run { vm.input } == "draft for main chat")
    }

    @Test func compactSessionActionCompactsSessionAndReloadsHistory() async throws {
        let before = historyPayload(
            messages: [
                chatTextMessage(role: "assistant", text: "before compact", timestamp: 1),
            ])
        let after = historyPayload(
            messages: [
                chatTextMessage(role: "assistant", text: "after compact", timestamp: 2),
            ])

        let (transport, vm) = await makeViewModel(historyResponses: [before, after])
        try await loadAndWaitBootstrap(vm: vm)
        try await waitUntil("initial history loaded") {
            await MainActor.run { vm.messages.first?.content.first?.text == "before compact" }
        }

        await MainActor.run { vm.compactSession() }

        try await waitUntil("compact called") {
            await transport.compactSessionKeys() == ["main"]
        }
        try await waitUntil("history reloaded") {
            await MainActor.run { vm.messages.first?.content.first?.text == "after compact" }
        }
        #expect(await transport.lastSentRunId() == nil)
    }

    @Test func compactSessionActionShowsGenericErrorMessageOnFailure() async throws {
        let history = historyPayload()
        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            compactSessionHook: { _ in
                throw NSError(
                    domain: "TestCompact",
                    code: 42,
                    userInfo: [NSLocalizedDescriptionKey: "backend details should not leak"])
            })
        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run { vm.compactSession() }

        try await waitUntil("compact attempted") {
            await transport.compactSessionKeys() == ["main"]
        }
        #expect(await MainActor.run { vm.errorText } == "Unable to compact the session. Please try again.")
    }

    @Test func compactSessionActionIgnoresConcurrentAndImmediateRepeatRequests() async throws {
        let before = historyPayload(
            messages: [
                chatTextMessage(role: "assistant", text: "before compact", timestamp: 1),
            ])
        let after = historyPayload(
            messages: [
                chatTextMessage(role: "assistant", text: "after compact", timestamp: 2),
            ])
        let gate = AsyncGate()
        let (transport, vm) = await makeViewModel(
            historyResponses: [before, after],
            compactSessionHook: { _ in
                await gate.wait()
            })
        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run {
            vm.compactSession()
            vm.compactSession()
        }

        try await waitUntil("single compact request issued") {
            await transport.compactSessionKeys() == ["main"]
        }
        #expect(await MainActor.run { vm.errorText } == nil)

        await gate.open()
        try await waitUntil("history reloaded after compact") {
            await MainActor.run { vm.messages.first?.content.first?.text == "after compact" }
        }

        await MainActor.run { vm.compactSession() }

        try await Task.sleep(for: .milliseconds(50))
        #expect(await transport.compactSessionKeys() == ["main"])
        #expect(await MainActor.run { vm.errorText } == "Please wait before compacting this session again.")
    }

    @Test func compactSessionActionAllowsImmediateRetryAfterFailure() async throws {
        let history = historyPayload()
        let attemptCount = AsyncCounter()
        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            compactSessionHook: { _ in
                let next = await attemptCount.increment()
                if next == 1 {
                    throw NSError(
                        domain: "TestCompact",
                        code: 42,
                        userInfo: [NSLocalizedDescriptionKey: "temporary failure"])
                }
            })
        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run { vm.compactSession() }

        try await waitUntil("first compact attempted") {
            await transport.compactSessionKeys() == ["main"]
        }
        #expect(await MainActor.run { vm.errorText } == "Unable to compact the session. Please try again.")

        await MainActor.run { vm.compactSession() }

        try await waitUntil("second compact attempted") {
            await transport.compactSessionKeys() == ["main", "main"]
        }
        #expect(await MainActor.run { vm.errorText } == nil)
    }

    @Test func deleteCurrentSessionFallsBackToMainAndRemovesDeletedEntry() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: AlisioChatSessionsDefaults(model: nil, contextTokens: nil, mainSessionKey: "main"),
            sessions: [
                sessionEntry(key: "main", updatedAt: now),
                sessionEntry(key: "other", updatedAt: now - 1_000),
            ])

        let (transport, vm) = await makeViewModel(
            sessionKey: "other",
            historyResponses: [
                historyPayload(sessionKey: "other", sessionId: "sess-other"),
                historyPayload(sessionKey: "main", sessionId: "sess-main"),
            ],
            sessionsResponses: [sessions, sessions],
            deleteSessionHook: { key in
                #expect(key == "other")
            })
        try await loadAndWaitBootstrap(vm: vm, sessionId: "sess-other")

        await MainActor.run { vm.deleteSession(sessionKey: "other") }

        try await waitUntil("delete issued") {
            await transport.deleteSessionKeys() == ["other"]
        }
        try await waitUntil("deleted current session falls back to main") {
            await MainActor.run { vm.sessionKey == "main" && vm.sessionId == "sess-main" }
        }
        #expect(await MainActor.run { vm.sessionChoices.map(\.key) } == ["main"])
    }

    @Test func refreshSessionsSearchKeepsLatestResponseOnly() async throws {
        let firstGate = AsyncGate()
        let secondGate = AsyncGate()
        let oldResponse = AlisioChatSessionsListResponse(
            ts: 1,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [sessionEntry(key: "old-result", updatedAt: 1)])
        let newResponse = AlisioChatSessionsListResponse(
            ts: 2,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [sessionEntry(key: "new-result", updatedAt: 2)])
        let listAttemptCount = AsyncCounter()
        let (transport, vm) = await makeViewModel(
            historyResponses: [historyPayload()],
            listSessionsHook: { query in
                let attempt = await listAttemptCount.increment()
                if attempt == 1 {
                    #expect(query.search == "old")
                    await firstGate.wait()
                    return oldResponse
                }
                #expect(query.search == "new")
                await secondGate.wait()
                return newResponse
            })

        await MainActor.run { vm.refreshSessions(search: "old", limit: 200) }
        try await waitUntil("first search request issued") {
            await transport.listSessionQueries().count == 1
        }

        await MainActor.run { vm.refreshSessions(search: "new", limit: 200) }
        try await waitUntil("second search request issued") {
            await transport.listSessionQueries().count == 2
        }

        let queries = await transport.listSessionQueries()
        #expect(queries.map { $0.search ?? "" } == ["old", "new"])

        await secondGate.open()
        try await waitUntil("latest search response applied") {
            await MainActor.run { vm.sessionChoices.contains(where: { $0.key == "new-result" }) }
        }
        #expect(await MainActor.run { vm.sessionChoices.contains(where: { $0.key == "old-result" }) } == false)

        await firstGate.open()
        try? await Task.sleep(for: .milliseconds(50))

        #expect(await MainActor.run { vm.sessionChoices.contains(where: { $0.key == "new-result" }) })
        #expect(await MainActor.run { vm.sessionChoices.contains(where: { $0.key == "old-result" }) } == false)
    }

    @Test func bootstrapsModelSelectionFromSessionAndDefaults() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: AlisioChatSessionsDefaults(model: "openai/gpt-4.1-mini", contextTokens: nil),
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: "anthropic/claude-opus-4-6"),
            ])
        let models = [
            modelChoice(id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6"),
            modelChoice(id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini", provider: "openai"),
        ]

        let (_, vm) = await makeViewModel(
            historyResponses: [history],
            sessionsResponses: [sessions],
            modelResponses: [models])

        try await loadAndWaitBootstrap(vm: vm)

        #expect(await MainActor.run { vm.showsModelPicker })
        #expect(await MainActor.run { vm.modelSelectionID } == "anthropic/claude-opus-4-6")
        #expect(await MainActor.run { vm.activeModelLabel } == "anthropic/claude-opus-4-6")
        #expect(await MainActor.run { vm.defaultModelLabel } == "Default: openai/gpt-4.1-mini")
    }

    @Test func selectingDefaultModelPatchesNilAndUpdatesSelection() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: AlisioChatSessionsDefaults(model: "openai/gpt-4.1-mini", contextTokens: nil),
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: "anthropic/claude-opus-4-6"),
            ])
        let models = [
            modelChoice(id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6"),
            modelChoice(id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini", provider: "openai"),
        ]

        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            sessionsResponses: [sessions],
            modelResponses: [models])

        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run { vm.selectModel(AlisioChatViewModel.defaultModelSelectionID) }

        try await waitUntil("session model patched") {
            let patched = await transport.patchedModels()
            return patched == [nil]
        }

        #expect(await MainActor.run { vm.modelSelectionID } == AlisioChatViewModel.defaultModelSelectionID)
        #expect(await MainActor.run { vm.activeModelLabel } == "openai/gpt-4.1-mini")
    }

    @Test func selectingProviderQualifiedModelDisambiguatesDuplicateModelIDs() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: AlisioChatSessionsDefaults(model: "openrouter/gpt-4.1-mini", contextTokens: nil),
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: "gpt-4.1-mini", modelProvider: "openrouter"),
            ])
        let models = [
            modelChoice(id: "gpt-4.1-mini", name: "GPT-4.1 mini", provider: "openai"),
            modelChoice(id: "gpt-4.1-mini", name: "GPT-4.1 mini", provider: "openrouter"),
        ]

        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            sessionsResponses: [sessions],
            modelResponses: [models])

        try await loadAndWaitBootstrap(vm: vm)

        #expect(await MainActor.run { vm.modelSelectionID } == "openrouter/gpt-4.1-mini")

        await MainActor.run { vm.selectModel("openai/gpt-4.1-mini") }

        try await waitUntil("provider-qualified model patched") {
            let patched = await transport.patchedModels()
            return patched == ["openai/gpt-4.1-mini"]
        }
    }

    @Test func slashModelIDsStayProviderQualifiedInSelectionAndPatch() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: nil),
            ])
        let models = [
            modelChoice(
                id: "openai/gpt-5.4",
                name: "GPT-5.4 via Vercel AI Gateway",
                provider: "vercel-ai-gateway"),
        ]

        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            sessionsResponses: [sessions],
            modelResponses: [models])

        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run { vm.selectModel("vercel-ai-gateway/openai/gpt-5.4") }

        try await waitUntil("slash model patched with provider-qualified ref") {
            let patched = await transport.patchedModels()
            return patched == ["vercel-ai-gateway/openai/gpt-5.4"]
        }
    }

    @Test func staleModelPatchCompletionsDoNotOverwriteNewerSelection() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: nil),
            ])
        let models = [
            modelChoice(id: "gpt-5.4", name: "GPT-5.4", provider: "openai"),
            modelChoice(id: "gpt-5.4-pro", name: "GPT-5.4 Pro", provider: "openai"),
        ]

        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            sessionsResponses: [sessions],
            modelResponses: [models],
            setSessionModelHook: { model in
                if model == "openai/gpt-5.4" {
                    try await Task.sleep(for: .milliseconds(200))
                }
            })

        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run {
            vm.selectModel("openai/gpt-5.4")
            vm.selectModel("openai/gpt-5.4-pro")
        }

        try await waitUntil("two model patches complete") {
            let patched = await transport.patchedModels()
            return patched == ["openai/gpt-5.4", "openai/gpt-5.4-pro"]
        }

        #expect(await MainActor.run { vm.modelSelectionID } == "openai/gpt-5.4-pro")
        #expect(await MainActor.run { vm.sessions.first(where: { $0.key == "main" })?.model } == "gpt-5.4-pro")
        #expect(await MainActor.run { vm.sessions.first(where: { $0.key == "main" })?.modelProvider } == "openai")
    }

    @Test func sendWaitsForInFlightModelPatchToFinish() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: nil),
            ])
        let models = [
            modelChoice(id: "gpt-5.4", name: "GPT-5.4", provider: "openai"),
        ]
        let gate = AsyncGate()

        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            sessionsResponses: [sessions],
            modelResponses: [models],
            setSessionModelHook: { model in
                if model == "openai/gpt-5.4" {
                    await gate.wait()
                }
            })

        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run { vm.selectModel("openai/gpt-5.4") }
        try await waitUntil("model patch started") {
            let patched = await transport.patchedModels()
            return patched == ["openai/gpt-5.4"]
        }

        await sendUserMessage(vm, text: "hello")
        try await waitUntil("send entered waiting state") {
            await MainActor.run { vm.isSending }
        }
        #expect(await transport.lastSentRunId() == nil)

        await MainActor.run { vm.selectThinkingLevel("high") }
        try await waitUntil("thinking level changed while send is blocked") {
            await MainActor.run { vm.thinkingLevel == "high" }
        }

        await gate.open()

        try await waitUntil("send released after model patch") {
            await transport.lastSentRunId() != nil
        }
        #expect(await transport.sentThinkingLevels() == ["off"])
    }

    @Test func failedLatestModelSelectionDoesNotReplayAfterOlderCompletionFinishes() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: nil),
            ])
        let models = [
            modelChoice(id: "gpt-5.4", name: "GPT-5.4", provider: "openai"),
            modelChoice(id: "gpt-5.4-pro", name: "GPT-5.4 Pro", provider: "openai"),
        ]

        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            sessionsResponses: [sessions],
            modelResponses: [models],
            setSessionModelHook: { model in
                if model == "openai/gpt-5.4" {
                    try await Task.sleep(for: .milliseconds(200))
                    return
                }
                if model == "openai/gpt-5.4-pro" {
                    throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "boom"])
                }
            })

        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run {
            vm.selectModel("openai/gpt-5.4")
            vm.selectModel("openai/gpt-5.4-pro")
        }

        try await waitUntil("older model completion wins after latest failure") {
            await MainActor.run {
                vm.sessions.first(where: { $0.key == "main" })?.model == "gpt-5.4" &&
                    vm.sessions.first(where: { $0.key == "main" })?.modelProvider == "openai"
            }
        }

        #expect(await MainActor.run { vm.modelSelectionID } == "openai/gpt-5.4")
        #expect(await MainActor.run { vm.sessions.first(where: { $0.key == "main" })?.model } == "gpt-5.4")
        #expect(await MainActor.run { vm.sessions.first(where: { $0.key == "main" })?.modelProvider } == "openai")
        #expect(await transport.patchedModels() == ["openai/gpt-5.4", "openai/gpt-5.4-pro"])
    }

    @Test func failedLatestModelSelectionRestoresEarlierSuccessWithoutReplay() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let history = historyPayload()
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 1,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: nil),
            ])
        let models = [
            modelChoice(id: "gpt-5.4", name: "GPT-5.4", provider: "openai"),
            modelChoice(id: "gpt-5.4-pro", name: "GPT-5.4 Pro", provider: "openai"),
        ]

        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            sessionsResponses: [sessions],
            modelResponses: [models],
            setSessionModelHook: { model in
                if model == "openai/gpt-5.4" {
                    try await Task.sleep(for: .milliseconds(100))
                    return
                }
                if model == "openai/gpt-5.4-pro" {
                    try await Task.sleep(for: .milliseconds(200))
                    throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "boom"])
                }
            })

        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run {
            vm.selectModel("openai/gpt-5.4")
            vm.selectModel("openai/gpt-5.4-pro")
        }

        try await waitUntil("latest failure restores prior successful model") {
            await MainActor.run {
                vm.modelSelectionID == "openai/gpt-5.4" &&
                    vm.sessions.first(where: { $0.key == "main" })?.model == "gpt-5.4" &&
                    vm.sessions.first(where: { $0.key == "main" })?.modelProvider == "openai"
            }
        }

        #expect(await transport.patchedModels() == ["openai/gpt-5.4", "openai/gpt-5.4-pro"])
    }

    @Test func switchingSessionsIgnoresLateModelPatchCompletionFromPreviousSession() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let sessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: nil),
                sessionEntry(key: "other", updatedAt: now - 1000, model: nil),
            ])
        let models = [
            modelChoice(id: "gpt-5.4", name: "GPT-5.4", provider: "openai"),
        ]

        let (transport, vm) = await makeViewModel(
            historyResponses: [
                historyPayload(sessionKey: "main", sessionId: "sess-main"),
                historyPayload(sessionKey: "other", sessionId: "sess-other"),
            ],
            sessionsResponses: [sessions, sessions],
            modelResponses: [models, models],
            setSessionModelHook: { model in
                if model == "openai/gpt-5.4" {
                    try await Task.sleep(for: .milliseconds(200))
                }
            })

        try await loadAndWaitBootstrap(vm: vm, sessionId: "sess-main")

        await MainActor.run { vm.selectModel("openai/gpt-5.4") }
        await MainActor.run { vm.switchSession(to: "other") }

        try await waitUntil("switched sessions") {
            await MainActor.run { vm.sessionKey == "other" && vm.sessionId == "sess-other" }
        }
        try await waitUntil("late model patch finished") {
            let patched = await transport.patchedModels()
            return patched == ["openai/gpt-5.4"]
        }

        #expect(await MainActor.run { vm.modelSelectionID } == AlisioChatViewModel.defaultModelSelectionID)
        #expect(await MainActor.run { vm.sessions.first(where: { $0.key == "other" })?.model } == nil)
    }

    @Test func lateModelCompletionDoesNotReplayCurrentSessionSelectionIntoPreviousSession() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let initialSessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: nil),
                sessionEntry(key: "other", updatedAt: now - 1000, model: nil),
            ])
        let sessionsAfterOtherSelection = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now, model: nil),
                sessionEntry(key: "other", updatedAt: now - 1000, model: "openai/gpt-5.4-pro"),
            ])
        let models = [
            modelChoice(id: "gpt-5.4", name: "GPT-5.4", provider: "openai"),
            modelChoice(id: "gpt-5.4-pro", name: "GPT-5.4 Pro", provider: "openai"),
        ]

        let (transport, vm) = await makeViewModel(
            historyResponses: [
                historyPayload(sessionKey: "main", sessionId: "sess-main"),
                historyPayload(sessionKey: "other", sessionId: "sess-other"),
                historyPayload(sessionKey: "main", sessionId: "sess-main"),
            ],
            sessionsResponses: [initialSessions, initialSessions, sessionsAfterOtherSelection],
            modelResponses: [models, models, models],
            setSessionModelHook: { model in
                if model == "openai/gpt-5.4" {
                    try await Task.sleep(for: .milliseconds(200))
                }
            })

        try await loadAndWaitBootstrap(vm: vm, sessionId: "sess-main")

        await MainActor.run { vm.selectModel("openai/gpt-5.4") }
        await MainActor.run { vm.switchSession(to: "other") }
        try await waitUntil("switched to other session") {
            await MainActor.run { vm.sessionKey == "other" && vm.sessionId == "sess-other" }
        }

        await MainActor.run { vm.selectModel("openai/gpt-5.4-pro") }
        try await waitUntil("both model patches issued") {
            let patched = await transport.patchedModels()
            return patched == ["openai/gpt-5.4", "openai/gpt-5.4-pro"]
        }
        await MainActor.run { vm.switchSession(to: "main") }
        try await waitUntil("switched back to main session") {
            await MainActor.run { vm.sessionKey == "main" && vm.sessionId == "sess-main" }
        }

        try await waitUntil("late model completion updates only the original session") {
            await MainActor.run {
                vm.sessions.first(where: { $0.key == "main" })?.model == "gpt-5.4" &&
                    vm.sessions.first(where: { $0.key == "main" })?.modelProvider == "openai"
            }
        }

        #expect(await MainActor.run { vm.modelSelectionID } == "openai/gpt-5.4")
        #expect(await MainActor.run { vm.sessions.first(where: { $0.key == "main" })?.model } == "gpt-5.4")
        #expect(await MainActor.run { vm.sessions.first(where: { $0.key == "main" })?.modelProvider } == "openai")
        #expect(await MainActor.run { vm.sessions.first(where: { $0.key == "other" })?.model } == "openai/gpt-5.4-pro")
        #expect(await MainActor.run { vm.sessions.first(where: { $0.key == "other" })?.modelProvider } == nil)
        #expect(await transport.patchedModels() == ["openai/gpt-5.4", "openai/gpt-5.4-pro"])
    }

    @Test func explicitThinkingLevelWinsOverHistoryAndPersistsChanges() async throws {
        let history = AlisioChatHistoryPayload(
            sessionKey: "main",
            sessionId: "sess-main",
            messages: [],
            thinkingLevel: "off")
        let callbackState = await MainActor.run { CallbackBox() }

        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            initialThinkingLevel: "high",
            onThinkingLevelChanged: { level in
                callbackState.values.append(level)
            })

        try await loadAndWaitBootstrap(vm: vm, sessionId: "sess-main")
        #expect(await MainActor.run { vm.thinkingLevel } == "high")

        await MainActor.run { vm.selectThinkingLevel("medium") }

        try await waitUntil("thinking level patched") {
            let patched = await transport.patchedThinkingLevels()
            return patched == ["medium"]
        }

        #expect(await MainActor.run { vm.thinkingLevel } == "medium")
        #expect(await MainActor.run { callbackState.values } == ["medium"])
    }

    @Test func serverProvidedThinkingLevelsOutsideMenuArePreservedForSend() async throws {
        let history = AlisioChatHistoryPayload(
            sessionKey: "main",
            sessionId: "sess-main",
            messages: [],
            thinkingLevel: "xhigh")

        let (transport, vm) = await makeViewModel(historyResponses: [history])

        try await loadAndWaitBootstrap(vm: vm, sessionId: "sess-main")
        #expect(await MainActor.run { vm.thinkingLevel } == "xhigh")

        await sendUserMessage(vm, text: "hello")
        try await waitUntil("send uses preserved thinking level") {
            await transport.sentThinkingLevels() == ["xhigh"]
        }
    }

    @Test func staleThinkingPatchCompletionReappliesLatestSelection() async throws {
        let history = AlisioChatHistoryPayload(
            sessionKey: "main",
            sessionId: "sess-main",
            messages: [],
            thinkingLevel: "off")

        let (transport, vm) = await makeViewModel(
            historyResponses: [history],
            setSessionThinkingHook: { level in
                if level == "medium" {
                    try await Task.sleep(for: .milliseconds(200))
                }
            })

        try await loadAndWaitBootstrap(vm: vm, sessionId: "sess-main")

        await MainActor.run {
            vm.selectThinkingLevel("medium")
            vm.selectThinkingLevel("high")
        }

        try await waitUntil("thinking patch replayed latest selection") {
            let patched = await transport.patchedThinkingLevels()
            return patched == ["medium", "high", "high"]
        }

        #expect(await MainActor.run { vm.thinkingLevel } == "high")
    }

    @Test func clearsStreamingOnExternalErrorEvent() async throws {
        let sessionId = "sess-main"
        let history = historyPayload(sessionId: sessionId)
        let (transport, vm) = await makeViewModel(historyResponses: [history, history])
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)

        emitAssistantText(transport: transport, runId: sessionId, text: "external stream")

        try await waitUntil("streaming active") {
            await MainActor.run { vm.streamingAssistantText == "external stream" }
        }

        transport.emit(
            .chat(
                AlisioChatEventPayload(
                    runId: "other-run",
                    sessionKey: "main",
                    state: "error",
                    message: nil,
                    errorMessage: "boom")))

        try await waitUntil("streaming cleared") { await MainActor.run { vm.streamingAssistantText == nil } }
    }

    @Test func stripsInboundMetadataFromHistoryMessages() async throws {
        let history = AlisioChatHistoryPayload(
            sessionKey: "main",
            sessionId: "sess-main",
            messages: [
                AnyCodable([
                    "role": "user",
                    "content": [["type": "text", "text": """
Conversation info (untrusted metadata):
```json
{ \"sender\": \"alisio-macos\" }
```

Hello?
"""]],
                    "timestamp": Date().timeIntervalSince1970 * 1000,
                ]),
            ],
            thinkingLevel: "off")
        let transport = TestChatTransport(historyResponses: [history])
        let vm = await MainActor.run { AlisioChatViewModel(sessionKey: "main", transport: transport) }

        await MainActor.run { vm.load() }
        try await waitUntil("history loaded") { await MainActor.run { !vm.messages.isEmpty } }

        let sanitized = await MainActor.run { vm.messages.first?.content.first?.text }
        #expect(sanitized == "Hello?")
    }

    @Test func abortRequestsDoNotClearPendingUntilAbortedEvent() async throws {
        let sessionId = "sess-main"
        let history = historyPayload(sessionId: sessionId)
        let (transport, vm) = await makeViewModel(historyResponses: [history, history])
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)

        await sendUserMessage(vm)
        try await waitUntil("pending run starts") { await MainActor.run { vm.pendingRunCount == 1 } }

        let runId = try #require(await transport.lastSentRunId())
        await MainActor.run { vm.abort() }

        try await waitUntil("abortRun called") {
            let ids = await transport.abortedRunIds()
            return ids == [runId]
        }

        // Pending remains until the gateway broadcasts an aborted/final chat event.
        #expect(await MainActor.run { vm.pendingRunCount } == 1)

        transport.emit(
            .chat(
                AlisioChatEventPayload(
                    runId: runId,
                    sessionKey: "main",
                    state: "aborted",
                    message: nil,
                    errorMessage: nil)))

        try await waitUntil("pending run clears") { await MainActor.run { vm.pendingRunCount == 0 } }
    }

    @Test func abortWaitsForDispatchToFinishBeforeCallingAbortRun() async throws {
        let sessionId = "sess-main"
        let history = historyPayload(sessionId: sessionId)
        let gate = AsyncGate()
        let (transport, vm) = await makeViewModel(
            historyResponses: [history, history],
            sendMessageHook: { _, _, _, idempotencyKey, _ in
                await gate.wait()
                return AlisioChatSendResponse(runId: idempotencyKey, status: "ok")
            })
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)

        await sendUserMessage(vm)
        try await waitUntil("dispatching run tracked") { await MainActor.run { vm.pendingRunCount == 1 } }

        let runId = try #require(await transport.lastSentRunId())
        await MainActor.run { vm.abort() }
        try? await Task.sleep(for: .milliseconds(50))

        #expect(await transport.abortedRunIds().isEmpty)
        #expect(await MainActor.run { vm.isAborting })
        #expect(await MainActor.run { vm.pendingRunCount } == 1)

        await gate.open()

        try await waitUntil("abort fires after dispatch") {
            await transport.abortedRunIds() == [runId]
        }

        transport.emit(
            .chat(
                AlisioChatEventPayload(
                    runId: runId,
                    sessionKey: "main",
                    state: "aborted",
                    message: nil,
                    errorMessage: nil)))

        try await waitUntil("abort state clears") {
            await MainActor.run { vm.pendingRunCount == 0 && vm.isAborting == false }
        }
        #expect(await MainActor.run { vm.errorText } == nil)
    }

    @Test func sendDoesNotStayStuckWhenTerminalEventArrivesBeforeAccept() async throws {
        let sessionId = "sess-main"
        let history = historyPayload(sessionId: sessionId)
        let gate = AsyncGate()
        let (transport, vm) = await makeViewModel(
            historyResponses: [history, history],
            sendMessageHook: { _, _, _, idempotencyKey, _ in
                await gate.wait()
                return AlisioChatSendResponse(runId: idempotencyKey, status: "ok")
            })
        try await loadAndWaitBootstrap(vm: vm, sessionId: sessionId)

        await sendUserMessage(vm)
        try await waitUntil("dispatching run tracked") { await MainActor.run { vm.pendingRunCount == 1 } }

        let runId = try #require(await transport.lastSentRunId())
        transport.emit(
            .chat(
                AlisioChatEventPayload(
                    runId: runId,
                    sessionKey: "main",
                    state: "final",
                    message: nil,
                    errorMessage: nil)))
        try await waitUntil("terminal event clears pending run") {
            await MainActor.run { vm.pendingRunCount == 0 }
        }

        await gate.open()

        try await waitUntil("sending state clears after early terminal event") {
            await MainActor.run { vm.isSending == false }
        }
        #expect(await MainActor.run { vm.errorText } == nil)
    }

    @Test func abortWithoutActiveRunShowsHonestError() async throws {
        let (_, vm) = await makeViewModel(historyResponses: [historyPayload()])
        try await loadAndWaitBootstrap(vm: vm)

        await MainActor.run { vm.abort() }

        #expect(await MainActor.run { vm.errorText } == "There is no active reply to stop.")
    }

    @Test func renameSessionPersistsAndUpdatesVisibleTitle() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let initialSessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now),
                sessionEntry(key: "other", updatedAt: now - 1_000),
            ])
        let renamedSessions = AlisioChatSessionsListResponse(
            ts: now + 1,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now),
                sessionEntry(key: "other", updatedAt: now + 500, displayName: "Deep work"),
            ])

        let (transport, vm) = await makeViewModel(
            historyResponses: [historyPayload()],
            sessionsResponses: [initialSessions, renamedSessions])
        try await loadAndWaitBootstrap(vm: vm)
        try await waitUntil("sessions loaded") {
            await MainActor.run { vm.sessionChoices.count == 2 }
        }

        let renamed = await vm.renameSessionAndWait(sessionKey: "other", displayName: "  Deep work  ")

        #expect(renamed)
        #expect(await transport.renamedSessions() == [.init(sessionKey: "other", displayName: "Deep work")])
        try await waitUntil("visible title updated") {
            await MainActor.run { vm.sessionTitle(forKey: "other") == "Deep work" }
        }
    }

    @Test func clearingCustomChatTitleFallsBackToServerTitle() async throws {
        let now = Date().timeIntervalSince1970 * 1000
        let initialSessions = AlisioChatSessionsListResponse(
            ts: now,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now),
                AlisioChatSessionEntry(
                    key: "other",
                    kind: nil,
                    label: nil,
                    displayName: "Launch prep",
                    derivedTitle: nil,
                    lastMessagePreview: nil,
                    surface: nil,
                    subject: "Quarterly planning",
                    room: nil,
                    space: nil,
                    updatedAt: now - 1_000,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    modelProvider: nil,
                    model: nil,
                    contextTokens: nil),
            ])
        let clearedSessions = AlisioChatSessionsListResponse(
            ts: now + 1,
            path: nil,
            count: 2,
            defaults: nil,
            sessions: [
                sessionEntry(key: "main", updatedAt: now),
                AlisioChatSessionEntry(
                    key: "other",
                    kind: nil,
                    label: nil,
                    displayName: nil,
                    derivedTitle: nil,
                    lastMessagePreview: nil,
                    surface: nil,
                    subject: "Quarterly planning",
                    room: nil,
                    space: nil,
                    updatedAt: now + 500,
                    sessionId: nil,
                    systemSent: nil,
                    abortedLastRun: nil,
                    thinkingLevel: nil,
                    verboseLevel: nil,
                    inputTokens: nil,
                    outputTokens: nil,
                    totalTokens: nil,
                    modelProvider: nil,
                    model: nil,
                    contextTokens: nil),
            ])

        let (transport, vm) = await makeViewModel(
            historyResponses: [historyPayload()],
            sessionsResponses: [initialSessions, clearedSessions])
        try await loadAndWaitBootstrap(vm: vm)
        try await waitUntil("sessions loaded") {
            await MainActor.run { vm.sessionTitle(forKey: "other") == "Launch prep" }
        }

        let cleared = await vm.renameSessionAndWait(sessionKey: "other", displayName: nil)

        #expect(cleared)
        #expect(await transport.renamedSessions() == [.init(sessionKey: "other", displayName: nil)])
        try await waitUntil("custom title cleared") {
            await MainActor.run { vm.sessionTitle(forKey: "other") == "Quarterly planning" }
        }
    }

    @Test func previewStateFlagsFirstMessagePhaseWhenOnlyUserTurnExists() async {
        let vm = await MainActor.run {
            AlisioChatViewModel.preview(
                sessionKey: "main",
                messages: [
                    AlisioChatMessage(
                        role: "user",
                        content: [
                            AlisioChatMessageContent(
                                type: "text",
                                text: "hello",
                                thinking: nil,
                                thinkingSignature: nil,
                                mimeType: nil,
                                fileName: nil,
                                content: nil),
                        ],
                        timestamp: Date().timeIntervalSince1970 * 1000),
                ],
                sessions: [
                    sessionEntry(
                        key: "main",
                        updatedAt: Date().timeIntervalSince1970 * 1000,
                        model: "claude-opus-4-6"),
                ],
                healthOK: true,
                pendingRunCount: 1)
        }

        #expect(await MainActor.run { vm.connectionPhase } == .firstMessage)
    }

    @Test func previewStateKeepsFirstMessagePhaseWhenOnlyEmptyAssistantPlaceholderExists() async {
        let vm = await MainActor.run {
            AlisioChatViewModel.preview(
                sessionKey: "main",
                messages: [
                    AlisioChatMessage(
                        role: "user",
                        content: [
                            AlisioChatMessageContent(
                                type: "text",
                                text: "hello",
                                thinking: nil,
                                thinkingSignature: nil,
                                mimeType: nil,
                                fileName: nil,
                                content: nil),
                        ],
                        timestamp: 1),
                    AlisioChatMessage(
                        role: "assistant",
                        content: [],
                        timestamp: 2),
                ],
                healthOK: true,
                pendingRunCount: 1)
        }

        #expect(await MainActor.run { vm.connectionPhase } == .firstMessage)
    }

    @Test func previewStateFlagsReconnectPhaseWhenHealthDrops() async {
        let vm = await MainActor.run {
            AlisioChatViewModel.preview(
                sessionKey: "main",
                messages: [],
                healthOK: false,
                isRecoveringConnection: true,
                hasLoadedHistory: true)
        }

        #expect(await MainActor.run { vm.connectionPhase } == .reconnecting)
    }

    @Test func currentSessionEntryResolvesCanonicalMainAlias() async {
        let vm = await MainActor.run {
            AlisioChatViewModel.preview(
                sessionKey: "main",
                sessions: [
                    AlisioChatSessionEntry(
                        key: "agent:main:main",
                        kind: nil,
                        displayName: "Main Alias",
                        surface: nil,
                        subject: nil,
                        room: nil,
                        space: nil,
                        updatedAt: Date().timeIntervalSince1970 * 1000,
                        sessionId: "sess-main",
                        systemSent: nil,
                        abortedLastRun: nil,
                        thinkingLevel: "low",
                        verboseLevel: nil,
                        inputTokens: 1200,
                        outputTokens: 800,
                        totalTokens: 2000,
                        modelProvider: "openai",
                        model: "gpt-5.4",
                        contextTokens: 200_000),
                ])
        }

        let entry = await MainActor.run { vm.currentSessionEntry }
        let usage = await MainActor.run { vm.currentSessionContextUsage }
        #expect(entry?.displayName == "Main Alias")
        #expect(usage?.totalTokens == 2000)
        #expect(usage?.contextWindow == 200_000)
    }
}
