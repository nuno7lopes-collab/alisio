import Foundation
import OSLog

import AlisioChatUI
import AlisioSupport
private let gatewayConnectionLogger = Logger(subsystem: AlisioBrand.logSubsystem, category: "gateway.connection")

enum GatewayAgentChannel: String, Codable, CaseIterable {
    case last
    case whatsapp
    case telegram
    case discord
    case googlechat
    case slack
    case signal
    case imessage
    case msteams
    case bluebubbles
    case webchat

    init(raw: String?) {
        let normalized = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        self = GatewayAgentChannel(rawValue: normalized) ?? .last
    }

    var isDeliverable: Bool {
        self != .webchat
    }

    func shouldDeliver(_ deliver: Bool) -> Bool {
        deliver && self.isDeliverable
    }
}

struct GatewayAgentInvocation {
    var message: String
    var sessionKey: String = "main"
    var thinking: String?
    var deliver: Bool = false
    var to: String?
    var channel: GatewayAgentChannel = .last
    var timeoutSeconds: Int?
    var idempotencyKey: String = UUID().uuidString
}

/// Single, shared Gateway websocket connection for the whole app.
///
/// This owns exactly one `GatewayChannelActor` and reuses it across all callers
/// (ControlChannel, debug actions, native workspace, etc.).
actor GatewayConnection: AppsGatewayClient {
    static let shared = GatewayConnection()
    private static let operatorConnectScopes = [
        "operator.admin",
        "operator.read",
        "operator.write",
        "operator.approvals",
        "operator.pairing",
    ]

    typealias Config = (url: URL, token: String?, password: String?)

    enum Method: String {
        case agent
        case status
        case setHeartbeats = "set-heartbeats"
        case systemEvent = "system-event"
        case health
        case channelsStatus = "channels.status"
        case alisioProvidersGet = "alisio.providers.get"
        case connectorsBegin = "connectors.begin"
        case connectorsRevoke = "connectors.revoke"
        case configGet = "config.get"
        case configSet = "config.set"
        case configPatch = "config.patch"
        case configSchema = "config.schema"
        case wizardStart = "wizard.start"
        case wizardNext = "wizard.next"
        case wizardCancel = "wizard.cancel"
        case wizardStatus = "wizard.status"
        case talkConfig = "talk.config"
        case talkMode = "talk.mode"
        case webLoginStart = "web.login.start"
        case webLoginWait = "web.login.wait"
        case channelsLogout = "channels.logout"
        case modelsList = "models.list"
        case chatHistory = "chat.history"
        case sessionsCreate = "sessions.create"
        case sessionsPreview = "sessions.preview"
        case chatSend = "chat.send"
        case chatAbort = "chat.abort"
        case skillsStatus = "skills.status"
        case skillsInstall = "skills.install"
        case skillsUpdate = "skills.update"
        case voicewakeGet = "voicewake.get"
        case voicewakeSet = "voicewake.set"
        case sessionsList = "sessions.list"
        case sessionsPatch = "sessions.patch"
        case sessionsReset = "sessions.reset"
        case sessionsDelete = "sessions.delete"
        case sessionsCompact = "sessions.compact"
        case nodePairApprove = "node.pair.approve"
        case nodePairReject = "node.pair.reject"
        case devicePairList = "device.pair.list"
        case devicePairApprove = "device.pair.approve"
        case devicePairReject = "device.pair.reject"
        case execApprovalResolve = "exec.approval.resolve"
        case computerSessionGet = "computer.session.get"
        case computerSessionUpdate = "computer.session.update"
        case cronList = "cron.list"
        case cronRuns = "cron.runs"
        case cronRun = "cron.run"
        case cronRemove = "cron.remove"
        case cronUpdate = "cron.update"
        case cronAdd = "cron.add"
        case cronStatus = "cron.status"
        case alisioAccountGet = "alisio.account.get"
        case alisioAccountBeginEmailAuth = "alisio.account.beginEmailAuth"
        case alisioAccountVerifyEmailAuth = "alisio.account.verifyEmailAuth"
        case alisioAccountCompleteEmailLinkAuth = "alisio.account.completeEmailLinkAuth"
        case alisioAccountBeginGoogleAuth = "alisio.account.beginGoogleAuth"
        case alisioAccountCompleteGoogleAuth = "alisio.account.completeGoogleAuth"
        case alisioAccountCompleteProfile = "alisio.account.completeProfile"
    }

    private let configProvider: @Sendable () async throws -> Config
    private let sessionBox: WebSocketSessionBox?
    private let decoder = JSONDecoder()

    private var client: GatewayChannelActor?
    private var configuredURL: URL?
    private var configuredToken: String?
    private var configuredPassword: String?

    private var subscribers: [UUID: AsyncStream<GatewayPush>.Continuation] = [:]
    private var lastSnapshot: HelloOk?

    private struct LossyDecodable<Value: Decodable>: Decodable {
        let value: Value?

        init(from decoder: Decoder) throws {
            do {
                self.value = try Value(from: decoder)
            } catch {
                self.value = nil
            }
        }
    }

    private struct LossyCronListResponse: Decodable {
        let jobs: [LossyDecodable<CronJob>]

        enum CodingKeys: String, CodingKey {
            case jobs
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.jobs = try container.decodeIfPresent([LossyDecodable<CronJob>].self, forKey: .jobs) ?? []
        }
    }

    private struct LossyCronRunsResponse: Decodable {
        let entries: [LossyDecodable<CronRunLogEntry>]

        enum CodingKeys: String, CodingKey {
            case entries
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.entries = try container.decodeIfPresent([LossyDecodable<CronRunLogEntry>].self, forKey: .entries) ?? []
        }
    }

    init(
        configProvider: @escaping @Sendable () async throws -> Config = GatewayConnection.defaultConfigProvider,
        sessionBox: WebSocketSessionBox? = nil)
    {
        self.configProvider = configProvider
        self.sessionBox = sessionBox
    }

    // MARK: - Low-level request

    func request(
        method: String,
        params: [String: AnyCodable]?,
        timeoutMs: Double? = nil) async throws -> Data
    {
        let cfg = try await self.configProvider()
        await self.configure(url: cfg.url, token: cfg.token, password: cfg.password)
        guard let client else {
            throw NSError(domain: "Gateway", code: 0, userInfo: [NSLocalizedDescriptionKey: "gateway not configured"])
        }

        do {
            return try await client.request(method: method, params: params, timeoutMs: timeoutMs)
        } catch {
            await self.refreshAccountStateIfNeeded(after: error, reason: method)
            if error is GatewayResponseError || error is GatewayDecodingError {
                throw error
            }

            // Auto-recover in local mode by spawning/attaching a gateway and retrying a few times.
            // Canvas interactions should "just work" even if the local gateway isn't running yet.
            let mode = await MainActor.run { AppStateStore.shared.connectionMode }
            switch mode {
            case .local:
                await MainActor.run { GatewayProcessManager.shared.setActive(true) }

                var lastError: Error = error
                for delayMs in [150, 400, 900] {
                    try await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
                    do {
                        return try await client.request(method: method, params: params, timeoutMs: timeoutMs)
                    } catch {
                        lastError = error
                    }
                }

                let nsError = lastError as NSError
                if nsError.domain == URLError.errorDomain,
                   let fallback = await GatewayEndpointStore.shared.maybeFallbackToTailnet(from: cfg.url)
                {
                    await self.configure(url: fallback.url, token: fallback.token, password: fallback.password)
                    for delayMs in [150, 400, 900] {
                        try await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
                        do {
                            guard let client = self.client else {
                                throw NSError(
                                    domain: "Gateway",
                                    code: 0,
                                    userInfo: [NSLocalizedDescriptionKey: "gateway not configured"])
                            }
                            return try await client.request(method: method, params: params, timeoutMs: timeoutMs)
                        } catch {
                            lastError = error
                        }
                    }
                }

                throw lastError
            case .remote:
                let nsError = error as NSError
                guard nsError.domain == URLError.errorDomain else { throw error }

                var lastError: Error = error
                await RemoteTunnelManager.shared.stopAll()
                do {
                    _ = try await GatewayEndpointStore.shared.ensureRemoteControlTunnel()
                } catch {
                    lastError = error
                }

                for delayMs in [150, 400, 900] {
                    try await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
                    do {
                        let cfg = try await self.configProvider()
                        await self.configure(url: cfg.url, token: cfg.token, password: cfg.password)
                        guard let client = self.client else {
                            throw NSError(
                                domain: "Gateway",
                                code: 0,
                                userInfo: [NSLocalizedDescriptionKey: "gateway not configured"])
                        }
                        return try await client.request(method: method, params: params, timeoutMs: timeoutMs)
                    } catch {
                        lastError = error
                    }
                }

                throw lastError
            case .unconfigured:
                throw error
            }
        }
    }

    func requestRaw(
        method: Method,
        params: [String: AnyCodable]? = nil,
        timeoutMs: Double? = nil) async throws -> Data
    {
        try await self.request(method: method.rawValue, params: params, timeoutMs: timeoutMs)
    }

    func requestRaw(
        method: String,
        params: [String: AnyCodable]? = nil,
        timeoutMs: Double? = nil) async throws -> Data
    {
        try await self.request(method: method, params: params, timeoutMs: timeoutMs)
    }

    func requestDecoded<T: Decodable>(
        method: Method,
        params: [String: AnyCodable]? = nil,
        timeoutMs: Double? = nil) async throws -> T
    {
        let data = try await self.requestRaw(method: method, params: params, timeoutMs: timeoutMs)
        do {
            return try self.decoder.decode(T.self, from: data)
        } catch {
            throw GatewayDecodingError(method: method.rawValue, message: error.localizedDescription)
        }
    }

    func requestVoid(
        method: Method,
        params: [String: AnyCodable]? = nil,
        timeoutMs: Double? = nil) async throws
    {
        _ = try await self.requestRaw(method: method, params: params, timeoutMs: timeoutMs)
    }

    /// Ensure the underlying socket is configured (and replaced if config changed).
    func refresh() async throws {
        let cfg = try await self.configProvider()
        await self.configure(url: cfg.url, token: cfg.token, password: cfg.password)
    }

    func authSource() async -> GatewayAuthSource? {
        guard let client else { return nil }
        return await client.authSource()
    }

    func shutdown() async {
        if let client {
            await client.shutdown()
        }
        self.client = nil
        self.configuredURL = nil
        self.configuredToken = nil
        self.lastSnapshot = nil
    }

    func canvasHostUrl() async -> String? {
        guard let snapshot = self.lastSnapshot else { return nil }
        let trimmed = snapshot.canvashosturl?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private func sessionDefaultString(_ defaults: [String: AlisioProtocol.AnyCodable]?, key: String) -> String {
        let raw = defaults?[key]?.value as? String
        return (raw ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
    }

    func cachedMainSessionKey() -> String? {
        guard let snapshot = self.lastSnapshot else { return nil }
        let trimmed = self.sessionDefaultString(snapshot.snapshot.sessiondefaults, key: "mainSessionKey")
        return trimmed.isEmpty ? nil : trimmed
    }

    func cachedGatewayVersion() -> String? {
        guard let snapshot = self.lastSnapshot else { return nil }
        let raw = snapshot.server["version"]?.value as? String
        let trimmed = raw?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    func snapshotPaths() -> (configPath: String?, stateDir: String?) {
        guard let snapshot = self.lastSnapshot else { return (nil, nil) }
        let configPath = snapshot.snapshot.configpath?.trimmingCharacters(in: .whitespacesAndNewlines)
        let stateDir = snapshot.snapshot.statedir?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (
            configPath?.isEmpty == false ? configPath : nil,
            stateDir?.isEmpty == false ? stateDir : nil)
    }

    func subscribe(bufferingNewest: Int = 100) -> AsyncStream<GatewayPush> {
        let id = UUID()
        let snapshot = self.lastSnapshot
        let connection = self
        return AsyncStream(bufferingPolicy: .bufferingNewest(bufferingNewest)) { continuation in
            if let snapshot {
                continuation.yield(.snapshot(snapshot))
            }
            self.subscribers[id] = continuation
            continuation.onTermination = { @Sendable _ in
                Task { await connection.removeSubscriber(id) }
            }
        }
    }

    private func removeSubscriber(_ id: UUID) {
        self.subscribers[id] = nil
    }

    private func broadcast(_ push: GatewayPush) {
        if case let .snapshot(snapshot) = push {
            self.lastSnapshot = snapshot
            if let mainSessionKey = self.cachedMainSessionKey() {
                Task { @MainActor in
                    WorkActivityStore.shared.setMainSessionKey(mainSessionKey)
                }
            }
        }
        for (_, continuation) in self.subscribers {
            continuation.yield(push)
        }
    }

    private func canonicalizeSessionKey(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return trimmed }
        guard let defaults = self.lastSnapshot?.snapshot.sessiondefaults else { return trimmed }
        let mainSessionKey = self.sessionDefaultString(defaults, key: "mainSessionKey")
        guard !mainSessionKey.isEmpty else { return trimmed }
        let mainKey = self.sessionDefaultString(defaults, key: "mainKey")
        let defaultAgentId = self.sessionDefaultString(defaults, key: "defaultAgentId")
        let isMainAlias =
            trimmed == "main" ||
            (!mainKey.isEmpty && trimmed == mainKey) ||
            trimmed == mainSessionKey ||
            (!defaultAgentId.isEmpty &&
                (trimmed == "agent:\(defaultAgentId):main" ||
                    (mainKey.isEmpty == false && trimmed == "agent:\(defaultAgentId):\(mainKey)")))
        return isMainAlias ? mainSessionKey : trimmed
    }

    private func configure(url: URL, token: String?, password: String?) async {
        if self.client != nil, self.configuredURL == url, self.configuredToken == token,
           self.configuredPassword == password
        {
            return
        }
        if let client {
            await client.shutdown()
        }
        self.lastSnapshot = nil
        let connectOptions = GatewayConnectOptions(
            role: "operator",
            scopes: Self.operatorConnectScopes,
            caps: [],
            commands: [],
            permissions: [:],
            clientId: AlisioBrand.gatewayClientIdentifier,
            clientMode: "ui",
            clientDisplayName: InstanceIdentity.displayName)
        self.client = GatewayChannelActor(
            url: url,
            token: token,
            password: password,
            session: self.sessionBox,
            pushHandler: { [weak self] push in
                await self?.handle(push: push)
            },
            connectOptions: connectOptions)
        self.configuredURL = url
        self.configuredToken = token
        self.configuredPassword = password
    }

    private func handle(push: GatewayPush) {
        self.broadcast(push)
    }

    private func ensureLocalGatewayReadyIfNeeded(reason: String, timeout: TimeInterval = 15) async throws {
        // Injected websocket sessions are test-only and should not trigger the app-level
        // local gateway manager.
        guard self.sessionBox == nil else { return }
        try await LocalGatewayPreflight.ensureReadyIfNeeded(reason: reason, timeout: timeout)
    }

    private func refreshAccountStateIfNeeded(after error: Error, reason: String) async {
        guard Self.isAccountRequiredGatewayError(error) else { return }
        await AlisioAccountStore.shared.refresh(reason: reason)
    }

    private static func defaultConfigProvider() async throws -> Config {
        try await GatewayEndpointStore.shared.requireConfig()
    }

    private static func isAccountRequiredGatewayError(_ error: Error) -> Bool {
        guard let response = error as? GatewayResponseError else { return false }
        guard response.code == ErrorCode.invalidRequest.rawValue else { return false }
        let normalized = response.message.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalized.contains("account") else { return false }
        return normalized.contains("sign-in required") || normalized.contains("sign in required")
    }
}

// MARK: - Typed gateway API

extension GatewayConnection {
    private struct AccountEmailAuthBeginResponse: Decodable {
        let email: String
    }

    private struct AccountGoogleAuthBeginResponse: Decodable {
        let setupUrl: String
    }

    enum SessionPatchValue<Value: Sendable>: Sendable {
        case unchanged
        case set(Value)
        case clear
    }

    enum ComputerSessionCommand: String {
        case start
        case pause
        case resume
        case stop
    }

    enum ComputerSessionStatus: String, Codable {
        case idle
        case observing
        case running
        case paused
        case blockedOnFocus = "blocked_on_focus"
        case blockedOnApproval = "blocked_on_approval"
        case blockedOnRuntime = "blocked_on_runtime"
        case blockedOnPermissions = "blocked_on_permissions"
        case blockedOnRestartRequired = "blocked_on_restart_required"
        case error
        case stopped
    }

    enum ComputerBlockingKind: String, Codable {
        case blockedOnFocus = "blocked_on_focus"
        case blockedOnApproval = "blocked_on_approval"
        case blockedOnRuntime = "blocked_on_runtime"
        case blockedOnPermissions = "blocked_on_permissions"
        case blockedOnRestartRequired = "blocked_on_restart_required"
    }

    enum ComputerPermissionAccessState: String, Codable {
        case unknown
        case granted
        case missing
        case restartRequired = "restart_required"
        case notSupported = "not_supported"
    }

    struct ComputerBlockingState: Codable, Equatable {
        let kind: ComputerBlockingKind
        let reasonCode: String
        let summary: String
        let at: Int?
    }

    struct ComputerPermissionSnapshot: Codable, Equatable {
        let accessibility: Bool?
        let screenRecording: Bool?
        let observation: ComputerPermissionAccessState
        let control: ComputerPermissionAccessState
    }

    struct ComputerRuntimeSessionSnapshot: Codable, Equatable {
        let sessionKey: String
        let state: MacNodeComputerSessionLifecycleState
        let updatedAt: Int
    }

    struct ComputerRuntimeSnapshot: Codable, Equatable {
        let connectionState: MacNodeComputerHelperConnectionState
        let launchCount: Int
        let helperProtocolVersion: Int?
        let helperVersion: String?
        let helperProcessId: Int?
        let activeSession: ComputerRuntimeSessionSnapshot?
        let lastError: MacNodeComputerHelperErrorPayload?
    }

    struct ComputerSessionSnapshot: Codable, Equatable {
        let sessionKey: String
        let status: ComputerSessionStatus
        let blocking: ComputerBlockingState?
        let permissions: ComputerPermissionSnapshot
        let runtime: ComputerRuntimeSnapshot?
        let lastError: String?
    }

    private struct ComputerSessionResponse: Decodable {
        let sessionKey: String
        let session: ComputerSessionSnapshot
    }

    struct ConfigGetSnapshot: Decodable {
        struct SnapshotConfig: Decodable {
            struct Session: Decodable {
                let scope: String?
            }

            let session: Session?
        }

        let config: SnapshotConfig?
    }

    nonisolated static let accountAuthCallbackURL = URL(string: "alisio://auth/account/callback")!

    static func mainSessionKey(fromConfigGetData data: Data) throws -> String {
        let snapshot = try JSONDecoder().decode(ConfigGetSnapshot.self, from: data)
        let scope = snapshot.config?.session?.scope?.trimmingCharacters(in: .whitespacesAndNewlines)
        if scope == "global" {
            return "global"
        }
        return "main"
    }

    func mainSessionKey(timeoutMs: Double = 15000) async -> String {
        if let cached = self.cachedMainSessionKey() {
            return cached
        }
        do {
            let data = try await self.requestRaw(method: "config.get", params: nil, timeoutMs: timeoutMs)
            return try Self.mainSessionKey(fromConfigGetData: data)
        } catch {
            return "main"
        }
    }

    func status() async -> (ok: Bool, error: String?) {
        do {
            _ = try await self.requestRaw(method: .status)
            return (true, nil)
        } catch {
            return (false, error.localizedDescription)
        }
    }

    func setHeartbeatsEnabledResult(_ enabled: Bool) async -> (ok: Bool, error: String?) {
        do {
            try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.setHeartbeats.rawValue)
            try await self.requestVoid(method: .setHeartbeats, params: ["enabled": AnyCodable(enabled)])
            return (true, nil)
        } catch {
            gatewayConnectionLogger.error("setHeartbeatsEnabled failed \(error.localizedDescription, privacy: .public)")
            return (false, error.localizedDescription)
        }
    }

    func setHeartbeatsEnabled(_ enabled: Bool) async -> Bool {
        (await self.setHeartbeatsEnabledResult(enabled)).ok
    }

    func sendAgent(_ invocation: GatewayAgentInvocation) async -> (ok: Bool, error: String?) {
        let trimmed = invocation.message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return (false, "message empty") }
        let sessionKey = self.canonicalizeSessionKey(invocation.sessionKey)

        var params: [String: AnyCodable] = [
            "message": AnyCodable(trimmed),
            "sessionKey": AnyCodable(sessionKey),
            "thinking": AnyCodable(invocation.thinking ?? "default"),
            "deliver": AnyCodable(invocation.deliver),
            "to": AnyCodable(invocation.to ?? ""),
            "channel": AnyCodable(invocation.channel.rawValue),
            "idempotencyKey": AnyCodable(invocation.idempotencyKey),
        ]
        if let timeout = invocation.timeoutSeconds {
            params["timeout"] = AnyCodable(timeout)
        }

        do {
            try await self.requireAuthenticatedAccount(reason: Method.agent.rawValue)
            let readinessTimeout = min(max(TimeInterval(invocation.timeoutSeconds ?? 15), 15), 45)
            try await self.ensureLocalGatewayReadyIfNeeded(
                reason: Method.agent.rawValue,
                timeout: readinessTimeout)
            try await self.requestVoid(method: .agent, params: params)
            return (true, nil)
        } catch {
            return (false, error.localizedDescription)
        }
    }

    func sendAgent(
        message: String,
        thinking: String?,
        sessionKey: String,
        deliver: Bool,
        to: String?,
        channel: GatewayAgentChannel = .last,
        timeoutSeconds: Int? = nil,
        idempotencyKey: String = UUID().uuidString) async -> (ok: Bool, error: String?)
    {
        await self.sendAgent(GatewayAgentInvocation(
            message: message,
            sessionKey: sessionKey,
            thinking: thinking,
            deliver: deliver,
            to: to,
            channel: channel,
            timeoutSeconds: timeoutSeconds,
            idempotencyKey: idempotencyKey))
    }

    func sendSystemEvent(_ params: [String: AnyCodable]) async {
        do {
            try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.systemEvent.rawValue)
            try await self.requestVoid(method: .systemEvent, params: params)
        } catch {
            // Best-effort only.
        }
    }

    // MARK: - Health

    func healthSnapshot(timeoutMs: Double? = nil) async throws -> HealthSnapshot {
        let data = try await self.requestRaw(method: .health, timeoutMs: timeoutMs)
        if let snap = decodeHealthSnapshot(from: data) { return snap }
        throw GatewayDecodingError(method: Method.health.rawValue, message: "failed to decode health snapshot")
    }

    func livenessSnapshot(timeoutMs: Int = 8000) async throws -> HealthSnapshot? {
        do {
            return try await self.healthSnapshot(timeoutMs: Double(timeoutMs))
        } catch {
            // Some gateway builds can serve the control UI and websocket correctly while the
            // dedicated `health` RPC is still unavailable or timing out during startup/restart.
            // Treat a successful `status` RPC as sufficient liveness while preserving the
            // richer health snapshot when it is available.
            _ = try await self.requestRaw(method: .status, timeoutMs: Double(timeoutMs))
            return nil
        }
    }

    func healthOK(timeoutMs: Int = 8000) async throws -> Bool {
        _ = try await self.livenessSnapshot(timeoutMs: timeoutMs)
        return true
    }

    // MARK: - Apps

    func fetchAppsOverview(timeoutMs: Double = 8000) async throws -> GatewayProvidersAppsResponse {
        try await self.requestDecoded(method: .alisioProvidersGet, timeoutMs: timeoutMs)
    }

    func beginAppConnection(appID: String, timeoutMs: Double = 8000) async throws -> GatewayConnectorBeginResult {
        try await self.requestDecoded(
            method: .connectorsBegin,
            params: ["connectorId": AnyCodable(appID)],
            timeoutMs: timeoutMs)
    }

    func revokeAppConnection(appID: String, timeoutMs: Double = 5000) async throws {
        try await self.requestVoid(
            method: .connectorsRevoke,
            params: ["connectorId": AnyCodable(appID)],
            timeoutMs: timeoutMs)
    }

    // MARK: - Account

    func accountSnapshot() async throws -> AlisioAccountSnapshot {
        return try await self.requestDecoded(method: .alisioAccountGet)
    }

    func beginAccountEmailAuth(email: String) async throws -> AlisioEmailAuthChallenge {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let response: AccountEmailAuthBeginResponse = try await self.requestDecoded(
            method: .alisioAccountBeginEmailAuth,
            params: [
                "email": AnyCodable(trimmedEmail),
                "callbackUrl": AnyCodable(Self.accountAuthCallbackURL.absoluteString),
            ])
        return AlisioEmailAuthChallenge(email: response.email)
    }

    func verifyAccountEmailAuth(email: String, code: String) async throws -> AlisioAccountSnapshot {
        return try await self.requestDecoded(
            method: .alisioAccountVerifyEmailAuth,
            params: [
                "email": AnyCodable(email.trimmingCharacters(in: .whitespacesAndNewlines)),
                "code": AnyCodable(code.trimmingCharacters(in: .whitespacesAndNewlines)),
            ])
    }

    func completeAccountEmailLinkAuth(
        _ link: AccountEmailLinkDeepLink) async throws -> AlisioAccountSnapshot
    {
        var params: [String: AnyCodable] = [
            "accessToken": AnyCodable(link.accessToken),
        ]
        if let refreshToken = link.refreshToken {
            params["refreshToken"] = AnyCodable(refreshToken)
        }
        if let expiresIn = link.expiresIn {
            params["expiresIn"] = AnyCodable(expiresIn)
        }
        if let tokenType = link.tokenType {
            params["tokenType"] = AnyCodable(tokenType)
        }
        return try await self.requestDecoded(
            method: .alisioAccountCompleteEmailLinkAuth,
            params: params)
    }

    func beginAccountGoogleAuth() async throws -> AlisioGoogleAuthRequest {
        let response: AccountGoogleAuthBeginResponse = try await self.requestDecoded(
            method: .alisioAccountBeginGoogleAuth,
            params: [
                "callbackUrl": AnyCodable(Self.accountAuthCallbackURL.absoluteString),
            ])
        guard let setupURL = URL(string: response.setupUrl) else {
            throw GatewayDecodingError(
                method: Method.alisioAccountBeginGoogleAuth.rawValue,
                message: "invalid Google auth setup URL")
        }
        return AlisioGoogleAuthRequest(setupURL: setupURL)
    }

    func completeAccountGoogleAuth(
        _ callback: AccountGoogleAuthCallbackDeepLink) async throws -> AlisioAccountSnapshot
    {
        var params: [String: AnyCodable] = [:]
        if let stateToken = callback.stateToken {
            params["stateToken"] = AnyCodable(stateToken)
        }
        if let code = callback.code {
            params["code"] = AnyCodable(code)
        }
        if let error = callback.error {
            params["error"] = AnyCodable(error)
        }
        if let errorDescription = callback.errorDescription {
            params["errorDescription"] = AnyCodable(errorDescription)
        }
        return try await self.requestDecoded(
            method: .alisioAccountCompleteGoogleAuth,
            params: params)
    }

    func completeAccountProfile(
        _ submission: EntryFlowProfileSubmission) async throws -> AlisioAccountSnapshot
    {
        let formatter = ISO8601DateFormatter()
        let username = Self.deriveAccountUsername(
            displayName: submission.displayName,
            email: submission.email)
        let params: [String: AnyCodable] = [
            "username": AnyCodable(username),
            "displayName": AnyCodable(submission.displayName.trimmingCharacters(in: .whitespacesAndNewlines)),
            "email": AnyCodable(submission.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()),
            "avatarLabel": AnyCodable(Self.deriveAvatarLabel(displayName: submission.displayName, username: username)),
            "termsAcceptedAt": AnyCodable(formatter.string(from: submission.termsAcceptedAt)),
        ]
        return try await self.requestDecoded(
            method: .alisioAccountCompleteProfile,
            params: params)
    }

    private func requireAuthenticatedAccount(reason: String) async throws {
        _ = try await AlisioAccountStore.shared.requireAuthenticated(reason: reason)
    }

    private static func deriveAccountUsername(displayName: String, email: String) -> String {
        let candidates = [
            displayName,
            email.split(separator: "@").first.map(String.init) ?? "",
            "alisio",
        ]
        for candidate in candidates {
            let normalized = Self.sanitizeAccountUsername(candidate)
            if normalized.count >= 4 {
                return String(normalized.prefix(15))
            }
        }
        let fallback = Self.sanitizeAccountUsername("alisio.user")
        return String(fallback.prefix(15))
    }

    private static func deriveAvatarLabel(displayName: String, username: String) -> String {
        let primary = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if let scalar = primary.unicodeScalars.first(where: CharacterSet.letters.contains) {
            return String(scalar).uppercased()
        }
        if let scalar = username.unicodeScalars.first(where: CharacterSet.alphanumerics.contains) {
            return String(scalar).uppercased()
        }
        return "A"
    }

    private static func sanitizeAccountUsername(_ value: String) -> String {
        var scalars: [UnicodeScalar] = []
        var lastWasSeparator = false
        for scalar in value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                scalars.append(scalar)
                lastWasSeparator = false
                continue
            }
            if scalar == "." || scalar == "_" {
                if !lastWasSeparator && !scalars.isEmpty {
                    scalars.append(scalar)
                    lastWasSeparator = true
                }
                continue
            }
            if !lastWasSeparator && !scalars.isEmpty {
                scalars.append(".")
                lastWasSeparator = true
            }
        }
        while let last = scalars.last, last == "." || last == "_" {
            scalars.removeLast()
        }
        let normalized = String(String.UnicodeScalarView(scalars))
        if normalized.count >= 4 {
            return normalized
        }
        return (normalized + "alisio").prefix(6).description
    }

    func skillsStatus() async throws -> SkillsStatusReport {
        try await self.requestDecoded(method: .skillsStatus)
    }

    func skillsInstall(
        name: String,
        installId: String,
        timeoutMs: Int? = nil) async throws -> SkillInstallResult
    {
        var params: [String: AnyCodable] = [
            "name": AnyCodable(name),
            "installId": AnyCodable(installId),
        ]
        if let timeoutMs {
            params["timeoutMs"] = AnyCodable(timeoutMs)
        }
        return try await self.requestDecoded(method: .skillsInstall, params: params)
    }

    func skillsUpdate(
        skillKey: String,
        enabled: Bool? = nil,
        apiKey: String? = nil,
        env: [String: String]? = nil) async throws -> SkillUpdateResult
    {
        var params: [String: AnyCodable] = [
            "skillKey": AnyCodable(skillKey),
        ]
        if let enabled { params["enabled"] = AnyCodable(enabled) }
        if let apiKey { params["apiKey"] = AnyCodable(apiKey) }
        if let env, !env.isEmpty { params["env"] = AnyCodable(env) }
        return try await self.requestDecoded(method: .skillsUpdate, params: params)
    }

    // MARK: - Sessions

    func sessionsList(
        includeGlobal: Bool = true,
        includeUnknown: Bool = false,
        activeMinutes: Int? = nil,
        search: String? = nil,
        limit: Int? = nil,
        includeDerivedTitles: Bool = false,
        includeLastMessage: Bool = false,
        agentId: String? = nil) async throws -> AlisioChatSessionsListResponse
    {
        try await self.requireAuthenticatedAccount(reason: Method.sessionsList.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.sessionsList.rawValue)
        var params: [String: AnyCodable] = [
            "includeGlobal": AnyCodable(includeGlobal),
            "includeUnknown": AnyCodable(includeUnknown),
        ]
        if let activeMinutes {
            params["activeMinutes"] = AnyCodable(activeMinutes)
        }
        if let search {
            let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                params["search"] = AnyCodable(trimmed)
            }
        }
        if let limit {
            params["limit"] = AnyCodable(limit)
        }
        if includeDerivedTitles {
            params["includeDerivedTitles"] = AnyCodable(true)
        }
        if includeLastMessage {
            params["includeLastMessage"] = AnyCodable(true)
        }
        if let agentId {
            let trimmed = agentId.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                params["agentId"] = AnyCodable(trimmed)
            }
        }
        return try await self.requestDecoded(method: .sessionsList, params: params)
    }

    func sessionsCreate(
        parentSessionKey: String? = nil,
        agentId: String? = nil,
        label: String? = nil,
        model: String? = nil,
        task: String? = nil) async throws -> AlisioChatSessionCreateResponse
    {
        try await self.requireAuthenticatedAccount(reason: Method.sessionsCreate.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.sessionsCreate.rawValue)

        var params: [String: AnyCodable] = [:]

        if let parentSessionKey {
            let trimmed = parentSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                params["parentSessionKey"] = AnyCodable(self.canonicalizeSessionKey(trimmed))
            }
        }
        if let agentId {
            let trimmed = agentId.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                params["agentId"] = AnyCodable(trimmed)
            }
        }
        if let label {
            let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                params["label"] = AnyCodable(trimmed)
            }
        }
        if let model {
            let trimmed = model.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                params["model"] = AnyCodable(trimmed)
            }
        }
        if let task {
            let trimmed = task.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                params["task"] = AnyCodable(trimmed)
            }
        }

        return try await self.requestDecoded(method: .sessionsCreate, params: params)
    }

    func sessionsPatch(
        key: String,
        model: SessionPatchValue<String> = .unchanged,
        thinkingLevel: SessionPatchValue<String> = .unchanged,
        displayName: SessionPatchValue<String> = .unchanged,
        verboseLevel: SessionPatchValue<String> = .unchanged) async throws
    {
        try await self.requireAuthenticatedAccount(reason: Method.sessionsPatch.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.sessionsPatch.rawValue)

        let resolvedKey = self.canonicalizeSessionKey(key)
        var params: [String: AnyCodable] = ["key": AnyCodable(resolvedKey)]

        switch model {
        case .unchanged:
            break
        case let .set(value):
            params["model"] = AnyCodable(value)
        case .clear:
            params["model"] = AnyCodable(NSNull())
        }

        switch thinkingLevel {
        case .unchanged:
            break
        case let .set(value):
            params["thinkingLevel"] = AnyCodable(value)
        case .clear:
            params["thinkingLevel"] = AnyCodable(NSNull())
        }

        switch displayName {
        case .unchanged:
            break
        case let .set(value):
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                params["displayName"] = AnyCodable(trimmed)
            }
        case .clear:
            params["displayName"] = AnyCodable(NSNull())
        }

        switch verboseLevel {
        case .unchanged:
            break
        case let .set(value):
            params["verboseLevel"] = AnyCodable(value)
        case .clear:
            params["verboseLevel"] = AnyCodable(NSNull())
        }

        try await self.requestVoid(method: .sessionsPatch, params: params)
    }

    func sessionsReset(key: String) async throws {
        try await self.requireAuthenticatedAccount(reason: Method.sessionsReset.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.sessionsReset.rawValue)
        let resolvedKey = self.canonicalizeSessionKey(key)
        try await self.requestVoid(method: .sessionsReset, params: ["key": AnyCodable(resolvedKey)])
    }

    func sessionsDelete(key: String, deleteTranscript: Bool = true) async throws {
        try await self.requireAuthenticatedAccount(reason: Method.sessionsDelete.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.sessionsDelete.rawValue)
        let resolvedKey = self.canonicalizeSessionKey(key)
        try await self.requestVoid(
            method: .sessionsDelete,
            params: [
                "key": AnyCodable(resolvedKey),
                "deleteTranscript": AnyCodable(deleteTranscript),
            ])
    }

    func sessionsCompact(key: String, maxLines: Int = 400) async throws {
        try await self.requireAuthenticatedAccount(reason: Method.sessionsCompact.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.sessionsCompact.rawValue)
        let resolvedKey = self.canonicalizeSessionKey(key)
        try await self.requestVoid(
            method: .sessionsCompact,
            params: [
                "key": AnyCodable(resolvedKey),
                "maxLines": AnyCodable(maxLines),
            ])
    }

    func sessionsPreview(
        keys: [String],
        limit: Int? = nil,
        maxChars: Int? = nil,
        timeoutMs: Int? = nil) async throws -> AlisioSessionsPreviewPayload
    {
        try await self.requireAuthenticatedAccount(reason: Method.sessionsPreview.rawValue)
        let resolvedKeys = keys
            .map { self.canonicalizeSessionKey($0) }
            .filter { !$0.isEmpty }
        if resolvedKeys.isEmpty {
            return AlisioSessionsPreviewPayload(ts: 0, previews: [])
        }
        var params: [String: AnyCodable] = ["keys": AnyCodable(resolvedKeys)]
        if let limit { params["limit"] = AnyCodable(limit) }
        if let maxChars { params["maxChars"] = AnyCodable(maxChars) }
        let timeout = timeoutMs.map { Double($0) }
        return try await self.requestDecoded(
            method: .sessionsPreview,
            params: params,
            timeoutMs: timeout)
    }

    // MARK: - Chat

    func chatHistory(
        sessionKey: String,
        limit: Int? = nil,
        timeoutMs: Int? = nil) async throws -> AlisioChatHistoryPayload
    {
        try await self.requireAuthenticatedAccount(reason: Method.chatHistory.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.chatHistory.rawValue)
        let resolvedKey = self.canonicalizeSessionKey(sessionKey)
        var params: [String: AnyCodable] = ["sessionKey": AnyCodable(resolvedKey)]
        if let limit { params["limit"] = AnyCodable(limit) }
        let timeout = timeoutMs.map { Double($0) }
        return try await self.requestDecoded(
            method: .chatHistory,
            params: params,
            timeoutMs: timeout)
    }

    func chatSend(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [AlisioChatAttachmentPayload],
        timeoutMs: Int = 30000) async throws -> AlisioChatSendResponse
    {
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedMessage.isEmpty else {
            throw NSError(
                domain: "Gateway",
                code: 0,
                userInfo: [NSLocalizedDescriptionKey: "message empty"])
        }
        try await self.requireAuthenticatedAccount(reason: Method.chatSend.rawValue)
        let readinessTimeout = min(max(TimeInterval(timeoutMs) / 1000, 15), 45)
        try await self.ensureLocalGatewayReadyIfNeeded(
            reason: Method.chatSend.rawValue,
            timeout: readinessTimeout)
        let resolvedKey = self.canonicalizeSessionKey(sessionKey)
        var params: [String: AnyCodable] = [
            "sessionKey": AnyCodable(resolvedKey),
            "message": AnyCodable(trimmedMessage),
            "thinking": AnyCodable(thinking),
            "idempotencyKey": AnyCodable(idempotencyKey),
            "timeoutMs": AnyCodable(timeoutMs),
        ]

        if !attachments.isEmpty {
            let encoded = attachments.map { att in
                [
                    "type": att.type,
                    "mimeType": att.mimeType,
                    "fileName": att.fileName,
                    "content": att.content,
                ]
            }
            params["attachments"] = AnyCodable(encoded)
        }

        return try await self.requestDecoded(
            method: .chatSend,
            params: params,
            timeoutMs: Double(timeoutMs))
    }

    func chatAbort(sessionKey: String, runId: String) async throws -> Bool {
        try await self.requireAuthenticatedAccount(reason: Method.chatAbort.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.chatAbort.rawValue)
        let resolvedKey = self.canonicalizeSessionKey(sessionKey)
        struct AbortResponse: Decodable { let ok: Bool?; let aborted: Bool? }
        let res: AbortResponse = try await self.requestDecoded(
            method: .chatAbort,
            params: ["sessionKey": AnyCodable(resolvedKey), "runId": AnyCodable(runId)])
        return res.aborted ?? false
    }

    func talkMode(enabled: Bool, phase: String? = nil) async {
        var params: [String: AnyCodable] = ["enabled": AnyCodable(enabled)]
        if let phase { params["phase"] = AnyCodable(phase) }
        try? await self.requestVoid(method: .talkMode, params: params)
    }

    // MARK: - VoiceWake

    func voiceWakeGetTriggers() async throws -> [String] {
        struct VoiceWakePayload: Decodable { let triggers: [String] }
        let payload: VoiceWakePayload = try await self.requestDecoded(method: .voicewakeGet)
        return payload.triggers
    }

    func voiceWakeSetTriggers(_ triggers: [String]) async {
        do {
            try await self.requestVoid(
                method: .voicewakeSet,
                params: ["triggers": AnyCodable(triggers)],
                timeoutMs: 10000)
        } catch {
            // Best-effort only.
        }
    }

    // MARK: - Node pairing

    func nodePairApprove(requestId: String) async throws {
        try await self.requestVoid(
            method: .nodePairApprove,
            params: ["requestId": AnyCodable(requestId)],
            timeoutMs: 10000)
    }

    func nodePairReject(requestId: String) async throws {
        try await self.requestVoid(
            method: .nodePairReject,
            params: ["requestId": AnyCodable(requestId)],
            timeoutMs: 10000)
    }

    // MARK: - Device pairing

    func devicePairApprove(requestId: String) async throws {
        try await self.requestVoid(
            method: .devicePairApprove,
            params: ["requestId": AnyCodable(requestId)],
            timeoutMs: 10000)
    }

    func devicePairReject(requestId: String) async throws {
        try await self.requestVoid(
            method: .devicePairReject,
            params: ["requestId": AnyCodable(requestId)],
            timeoutMs: 10000)
    }

    // MARK: - Cron

    struct CronSchedulerStatus: Decodable {
        let enabled: Bool
    }

    func cronStatus() async throws -> CronSchedulerStatus {
        try await self.requireAuthenticatedAccount(reason: Method.cronStatus.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.cronStatus.rawValue)
        let status: CronSchedulerStatus = try await self.requestDecoded(method: .cronStatus)
        return status
    }

    func cronList(includeDisabled: Bool = true) async throws -> [CronJob] {
        try await self.requireAuthenticatedAccount(reason: Method.cronList.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.cronList.rawValue)
        let data = try await self.requestRaw(
            method: .cronList,
            params: ["includeDisabled": AnyCodable(includeDisabled)])
        return try Self.decodeCronListResponse(data)
    }

    func cronRuns(jobId: String, limit: Int = 200) async throws -> [CronRunLogEntry] {
        try await self.requireAuthenticatedAccount(reason: Method.cronRuns.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.cronRuns.rawValue)
        let data = try await self.requestRaw(
            method: .cronRuns,
            params: ["id": AnyCodable(jobId), "limit": AnyCodable(limit)])
        return try Self.decodeCronRunsResponse(data)
    }

    func cronRun(jobId: String, force: Bool = true) async throws {
        try await self.requireAuthenticatedAccount(reason: Method.cronRun.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.cronRun.rawValue)
        try await self.requestVoid(
            method: .cronRun,
            params: [
                "id": AnyCodable(jobId),
                "mode": AnyCodable(force ? "force" : "due"),
            ],
            timeoutMs: 20000)
    }

    func cronRemove(jobId: String) async throws {
        try await self.requireAuthenticatedAccount(reason: Method.cronRemove.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.cronRemove.rawValue)
        try await self.requestVoid(method: .cronRemove, params: ["id": AnyCodable(jobId)])
    }

    func cronUpdate(jobId: String, patch: [String: AnyCodable]) async throws -> CronJob {
        try await self.requireAuthenticatedAccount(reason: Method.cronUpdate.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.cronUpdate.rawValue)
        return try await self.requestDecoded(
            method: .cronUpdate,
            params: ["id": AnyCodable(jobId), "patch": AnyCodable(patch)])
    }

    func cronAdd(request: [String: AnyCodable]) async throws -> CronJob {
        try await self.requireAuthenticatedAccount(reason: Method.cronAdd.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.cronAdd.rawValue)
        return try await self.requestDecoded(method: .cronAdd, params: request)
    }

    func computerSession(sessionKey: String) async throws -> ComputerSessionSnapshot {
        try await self.requireAuthenticatedAccount(reason: Method.computerSessionGet.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.computerSessionGet.rawValue)
        let resolvedKey = self.canonicalizeSessionKey(sessionKey)
        let response: ComputerSessionResponse = try await self.requestDecoded(
            method: .computerSessionGet,
            params: ["sessionKey": AnyCodable(resolvedKey)])
        return response.session
    }

    func computerSession(
        sessionKey: String,
        command: ComputerSessionCommand) async throws -> ComputerSessionSnapshot
    {
        try await self.requireAuthenticatedAccount(reason: Method.computerSessionUpdate.rawValue)
        try await self.ensureLocalGatewayReadyIfNeeded(reason: Method.computerSessionUpdate.rawValue)
        let resolvedKey = self.canonicalizeSessionKey(sessionKey)
        let response: ComputerSessionResponse = try await self.requestDecoded(
            method: .computerSessionUpdate,
            params: [
                "sessionKey": AnyCodable(resolvedKey),
                "command": AnyCodable(command.rawValue),
            ])
        return response.session
    }

    nonisolated static func decodeCronListResponse(_ data: Data) throws -> [CronJob] {
        let decoded = try JSONDecoder().decode(LossyCronListResponse.self, from: data)
        let jobs = decoded.jobs.compactMap(\.value)
        let skipped = decoded.jobs.count - jobs.count
        if skipped > 0 {
            gatewayConnectionLogger.warning("cron.list skipped \(skipped, privacy: .public) malformed jobs")
        }
        return jobs
    }

    nonisolated static func decodeCronRunsResponse(_ data: Data) throws -> [CronRunLogEntry] {
        let decoded = try JSONDecoder().decode(LossyCronRunsResponse.self, from: data)
        let entries = decoded.entries.compactMap(\.value)
        let skipped = decoded.entries.count - entries.count
        if skipped > 0 {
            gatewayConnectionLogger.warning("cron.runs skipped \(skipped, privacy: .public) malformed entries")
        }
        return entries
    }
}
