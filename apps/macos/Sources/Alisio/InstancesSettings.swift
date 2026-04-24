import AppKit
import SwiftUI

import AlisioSupport

enum ConnectionsSurfaceStatus: Equatable {
    case connected
    case connecting
    case disconnected
    case attention

    var label: String {
        switch self {
        case .connected:
            "Connected"
        case .connecting:
            "Checking"
        case .disconnected:
            "Disconnected"
        case .attention:
            "Needs attention"
        }
    }

    var color: Color {
        switch self {
        case .connected:
            .green
        case .connecting:
            .secondary
        case .disconnected:
            .secondary
        case .attention:
            .orange
        }
    }
}

struct ConnectionFact: Identifiable, Equatable {
    let label: String
    let value: String

    var id: String {
        self.label
    }
}

struct ConnectionOverview: Equatable {
    let title: String
    let summary: String
    let detail: String?
    let status: ConnectionsSurfaceStatus
    let facts: [ConnectionFact]
}

struct InstancesSettings: View {
    enum NodesListState: Equatable {
        case loading(String)
        case error(String)
        case empty(String)
        case list
    }

    @Bindable var store: InstancesStore
    @Bindable var state: AppState
    let showsHeader: Bool
    @State private var isMutatingConnection = false
    @Bindable private var healthStore = HealthStore.shared
    @Bindable private var controlChannel = ControlChannel.shared
    @Bindable private var connectivityCoordinator = GatewayConnectivityCoordinator.shared

    init(
        store: InstancesStore = .shared,
        state: AppState = AppStateStore.shared,
        showsHeader: Bool = true)
    {
        self.store = store
        self.state = state
        self.showsHeader = showsHeader
    }

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 16) {
                self.header
                self.connectionCard
                self.healthCard

                if self.state.connectionMode == .local {
                    TailscaleIntegrationSection(
                        connectionMode: self.state.connectionMode,
                        isPaused: self.state.isPaused)
                        .environment(TailscaleService.shared)
                }

                self.nodesCard
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 12)
        }
        .onAppear {
            self.store.start()
            Task { await self.refreshAll() }
        }
        .onChange(of: self.state.connectionMode) { _, _ in
            Task { await self.refreshAll() }
        }
        .onChange(of: self.controlChannel.state) { _, newValue in
            guard case .connected = newValue else { return }
            Task { await self.refreshAll() }
        }
        .onDisappear { self.store.stop() }
    }

    private var isRefreshingSurface: Bool {
        self.store.isLoading || self.healthStore.isRefreshing
    }

    private var header: some View {
        WorkspaceRouteHeader(
            title: "Connections",
            subtitle: "Runtime, health and nodes with no hidden state.",
            showsTitle: self.showsHeader)
        {
            SettingsRefreshButton(isLoading: self.isRefreshingSurface) {
                Task { await self.refreshAll() }
            }
        }
    }

    private var healthPresentation: HealthSurfacePresentation {
        self.healthStore.surfacePresentation(controlState: self.controlChannel.state)
    }

    private var connectionOverview: ConnectionOverview {
        Self.resolveConnectionOverview(
            mode: self.state.connectionMode,
            remoteTransport: self.state.remoteTransport,
            remoteTarget: self.state.remoteTarget,
            remoteURL: self.state.remoteUrl,
            endpointState: self.connectivityCoordinator.endpointState,
            controlState: self.controlChannel.state,
            authSource: self.controlChannel.authSource)
    }

    private var connectionCard: some View {
        self.surfaceCard(title: "Overview", systemImage: "network") {
            VStack(alignment: .leading, spacing: 12) {
                Text(self.connectionOverview.title)
                    .font(.title3.weight(.semibold))

                HStack(spacing: 8) {
                    Circle()
                        .fill(self.connectionOverview.status.color)
                        .frame(width: 10, height: 10)
                    Text(self.connectionOverview.summary)
                        .font(.callout.weight(.semibold))
                    Spacer()
                    StatusPill(
                        text: self.connectionOverview.status.label,
                        tint: self.connectionOverview.status.color)
                }

                if let detail = self.connectionOverview.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !self.connectionOverview.facts.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(self.connectionOverview.facts) { fact in
                            LabeledContent(fact.label, value: fact.value)
                                .font(.caption)
                        }
                    }
                }

                self.connectionActions
            }
        }
    }

    private var healthCard: some View {
        self.surfaceCard(title: "Health", systemImage: "stethoscope") {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(self.healthPresentation.status.color)
                        .frame(width: 10, height: 10)
                    Text(self.healthPresentation.summary)
                        .font(.callout.weight(.semibold))
                    Spacer()
                    StatusPill(
                        text: self.healthPresentation.status.label,
                        tint: self.healthPresentation.status.color)
                }

                if let detail = self.healthPresentation.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let lastKnown = self.healthPresentation.lastKnownSummary {
                    Text("Last known result: \(lastKnown).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let lastSuccess = self.healthStore.lastSuccess,
                          self.healthPresentation.status == .connected
                {
                    Text("Last checked \(relativeAge(from: lastSuccess)).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var nodesCard: some View {
        self.surfaceCard(title: "Nodes", systemImage: "desktopcomputer.trianglebadge.exclamationmark") {
            switch self.nodesListState {
            case let .loading(message):
                HStack(spacing: 8) {
                    ProgressView()
                    Text(message)
                        .font(.callout.weight(.semibold))
                    Spacer()
                }
            case let .error(message):
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            case let .empty(message):
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            case .list:
                VStack(alignment: .leading, spacing: 10) {
                    if let info = self.nodesBannerText {
                        Text(info)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(self.store.instances.enumerated()), id: \.element.id) { index, inst in
                            self.instanceRow(inst)
                            if index < self.store.instances.count - 1 {
                                Divider()
                            }
                        }
                    }
                }
            }
        }
    }

    private var trimmedNodesError: String? {
        let trimmed = self.store.lastError?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private var trimmedNodesMessage: String? {
        let trimmed = self.store.statusMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private var nodesBannerText: String? {
        guard !self.store.instances.isEmpty else { return nil }

        let suffix = self.store.lastSuccess.map { " Last updated \(relativeAge(from: $0))." } ?? ""

        switch self.controlChannel.state {
        case .connecting:
            return "Showing the last known nodes while reconnecting." + suffix
        case .disconnected:
            return "Showing the last known nodes while disconnected." + suffix
        case let .degraded(message):
            let failure = Self.connectionFailurePresentation(message, mode: self.state.connectionMode)
            return "Showing the last known nodes. \(failure.summary)" + suffix
        case .connected:
            break
        }

        if let error = self.trimmedNodesError {
            return error + suffix
        }
        if self.store.isLoading {
            return "Refreshing nodes…" + suffix
        }
        return nil
    }

    var nodesListState: NodesListState {
        Self.resolveNodesListState(
            instanceCount: self.store.instances.count,
            hasLoadedOnce: self.store.hasLoadedOnce,
            isLoading: self.store.isLoading,
            lastError: self.trimmedNodesError,
            emptyMessage: self.trimmedNodesMessage,
            controlState: self.controlChannel.state,
            mode: self.state.connectionMode)
    }

    private func surfaceCard(
        title: String,
        systemImage: String,
        @ViewBuilder content: () -> some View) -> some View
    {
        WorkspaceSurfaceCard(padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                Label(title, systemImage: systemImage)
                    .font(.headline)
                content()
            }
        }
    }

    @ViewBuilder
    private var connectionActions: some View {
        switch self.controlChannel.state {
        case .connected, .connecting:
            Button("Disconnect") {
                Task { await self.disconnectRuntime() }
            }
            .buttonStyle(.bordered)
            .disabled(self.isMutatingConnection)
        case .disconnected, .degraded:
            Button("Reconnect") {
                Task { await self.reconnectRuntime() }
            }
            .buttonStyle(.bordered)
            .disabled(self.isMutatingConnection || self.state.connectionMode == .unconfigured)
        }
    }

    @MainActor
    private func refreshAll() async {
        async let presenceRefresh: Void = self.store.refresh()
        async let healthRefresh: Void = self.healthStore.refresh(onDemand: true)
        async let endpointRefresh: Void = GatewayEndpointStore.shared.refresh()

        if self.state.connectionMode == .local {
            async let tailscaleRefresh: Void = TailscaleService.shared.checkTailscaleStatus()
            _ = await (presenceRefresh, healthRefresh, endpointRefresh, tailscaleRefresh)
        } else {
            _ = await (presenceRefresh, healthRefresh, endpointRefresh)
        }
    }

    @MainActor
    private func reconnectRuntime() async {
        guard !self.isMutatingConnection else { return }
        self.isMutatingConnection = true
        defer { self.isMutatingConnection = false }
        await self.controlChannel.reconnectUsingSavedSettings()
        await self.refreshAll()
    }

    @MainActor
    private func disconnectRuntime() async {
        guard !self.isMutatingConnection else { return }
        self.isMutatingConnection = true
        defer { self.isMutatingConnection = false }
        await self.controlChannel.disconnect()
    }

    static func resolveConnectionOverview(
        mode: AppState.ConnectionMode,
        remoteTransport: AppState.RemoteTransport,
        remoteTarget: String,
        remoteURL: String,
        endpointState: GatewayEndpointState?,
        controlState: ControlChannel.ConnectionState,
        authSource: GatewayAuthSource? = nil) -> ConnectionOverview
    {
        let trimmedTarget = remoteTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedRemoteURL = remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let activeAccessValue = Self.accessFactValue(from: authSource)
        let remoteLabel = remoteTransport == .direct
            ? Self.remoteHostLabel(from: trimmedRemoteURL)
            : (trimmedTarget.isEmpty ? nil : trimmedTarget)

        let configuredAccessValue: (GatewayEndpointState?) -> String? = { endpointState in
            guard case let .ready(_, _, token, password) = endpointState else { return nil }
            if let token, !token.isEmpty {
                return "Connection token"
            }
            if let password, !password.isEmpty {
                return "Password"
            }
            return nil
        }

        switch mode {
        case .unconfigured:
            return ConnectionOverview(
                title: "Not set up",
                summary: "Choose how this Mac should connect.",
                detail: "Select On this Mac or Remote in General settings.",
                status: .attention,
                facts: [])
        case .local:
            var facts: [ConnectionFact] = []
            if let access = activeAccessValue ?? configuredAccessValue(endpointState) {
                facts.append(ConnectionFact(label: "Access", value: access))
            }

            if case let .unavailable(_, reason) = endpointState, controlState != .connected {
                let failure = Self.connectionFailurePresentation(reason, mode: .local)
                return ConnectionOverview(
                    title: "On this Mac",
                    summary: failure.summary,
                    detail: failure.detail,
                    status: .attention,
                    facts: facts)
            }

            switch controlState {
            case .connected:
                return ConnectionOverview(
                    title: "On this Mac",
                    summary: "Connected to the local runtime.",
                    detail: nil,
                    status: .connected,
                    facts: facts)
            case .connecting:
                return ConnectionOverview(
                    title: "On this Mac",
                    summary: {
                        switch endpointState {
                        case .connecting, .none:
                            "Starting the local runtime."
                        default:
                            "Reconnecting to the local runtime."
                        }
                    }(),
                    detail: nil,
                    status: .connecting,
                    facts: facts)
            case .disconnected:
                let detail: String?
                if case .connecting = endpointState {
                    detail = "The local runtime is still starting."
                } else {
                    detail = "Settings stay saved. Reconnect to restore access."
                }
                return ConnectionOverview(
                    title: "On this Mac",
                    summary: "Disconnected from the local runtime.",
                    detail: detail,
                    status: .disconnected,
                    facts: facts)
            case let .degraded(message):
                let failure = Self.connectionFailurePresentation(message, mode: .local)
                return ConnectionOverview(
                    title: "On this Mac",
                    summary: failure.summary,
                    detail: failure.detail,
                    status: .attention,
                    facts: facts)
            }
        case .remote:
            var facts = [
                ConnectionFact(label: "Transport", value: remoteTransport == .direct ? "Direct URL" : "SSH tunnel"),
            ]
            if let remoteLabel {
                facts.append(ConnectionFact(label: "Remote", value: remoteLabel))
            }
            if let access = activeAccessValue ?? configuredAccessValue(endpointState) {
                facts.append(ConnectionFact(label: "Access", value: access))
            }

            if case let .unavailable(_, reason) = endpointState, controlState != .connected {
                let failure = Self.connectionFailurePresentation(reason, mode: .remote)
                return ConnectionOverview(
                    title: "Remote runtime",
                    summary: failure.summary,
                    detail: failure.detail,
                    status: .attention,
                    facts: facts)
            }

            switch controlState {
            case .connected:
                return ConnectionOverview(
                    title: "Remote runtime",
                    summary: "Connected to the remote runtime.",
                    detail: nil,
                    status: .connected,
                    facts: facts)
            case .connecting:
                return ConnectionOverview(
                    title: "Remote runtime",
                    summary: {
                        if remoteTransport == .ssh, case .connecting = endpointState {
                            return "Opening the remote connection."
                        }
                        return "Reconnecting to the remote runtime."
                    }(),
                    detail: nil,
                    status: .connecting,
                    facts: facts)
            case .disconnected:
                return ConnectionOverview(
                    title: "Remote runtime",
                    summary: "Disconnected from the remote runtime.",
                    detail: remoteTransport == .direct
                        ? "Settings stay saved. Reconnect to restore access."
                        : "Reconnect to reopen the remote connection.",
                    status: .disconnected,
                    facts: facts)
            case let .degraded(message):
                let failure = Self.connectionFailurePresentation(message, mode: .remote)
                return ConnectionOverview(
                    title: "Remote runtime",
                    summary: failure.summary,
                    detail: failure.detail,
                    status: .attention,
                    facts: facts)
            }
        }
    }

    private static func accessFactValue(from authSource: GatewayAuthSource?) -> String? {
        guard let authSource else { return nil }
        switch authSource {
        case .deviceToken:
            return "Paired device"
        case .bootstrapToken:
            return "Setup code"
        case .sharedToken:
            return "Connection token"
        case .password:
            return "Password"
        case .none:
            return nil
        }
    }

    private static func connectionFailurePresentation(
        _ raw: String?,
        mode: AppState.ConnectionMode) -> (summary: String, detail: String?)
    {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else {
            return ("The runtime needs attention.", "Try reconnecting or review General settings.")
        }

        let lower = trimmed.lowercased()
        if lower.contains("setup code") && (lower.contains("expired") || lower.contains("already used")) {
            return ("Setup code expired.", "Use a fresh setup code to reconnect this Mac.")
        }
        if lower.contains("pairing required") || lower.contains("/pair approve") || lower.contains("approve this device")
        {
            return ("Pairing approval needed.", "Approve this Mac from another paired Alisio client, then reconnect.")
        }
        if lower.contains("password auth") || lower.contains("unsupported auth") {
            return ("Access needs attention.", "Switch the runtime to token-based access before reconnecting.")
        }
        if lower.contains("token") {
            if lower.contains("not configured") || lower.contains("missing") {
                return (
                    mode == .remote ? "Remote setup is incomplete." : "Access is not set up yet.",
                    mode == .remote
                        ? "Finish access setup on the runtime, then reconnect."
                        : "Finish setting up access for the local runtime.")
            }
            return ("Access needs attention.", "Check the saved connection token and try again.")
        }
        if lower.contains("sign in") {
            return ("Sign-in required.", "Sign in to Alisio to finish linking this Mac.")
        }
        if lower.contains("timeout") {
            return ("The runtime is taking too long to respond.", "Wait a moment, then try again.")
        }
        if lower.contains("cannot reach gateway") ||
            lower.contains("cannot connect") ||
            lower.contains("connection refused") ||
            lower.contains("disconnected") ||
            lower.contains("network")
        {
            return (
                "Can't reach the runtime right now.",
                mode == .local
                    ? "Open Alisio again or wait for the local runtime to finish starting."
                    : "Check the remote connection and try again.")
        }
        if lower.contains("remote control tunnel failed") || lower.contains("ssh") {
            return ("The remote connection could not open.", "Check the remote host and try reconnecting.")
        }
        if lower.contains("missing or invalid") || lower.contains("not configured") {
            return (
                mode == .remote ? "Remote setup is incomplete." : "Connection is not set up yet.",
                mode == .remote
                    ? "Add a valid remote address in General settings."
                    : "Finish setting up the local runtime.")
        }
        if lower.contains("non-gateway data") || lower.contains("another process is using that port") {
            return ("Another app is blocking the gateway.", "Close the conflicting app or tunnel and try again.")
        }
        return ("The runtime needs attention.", "Try reconnecting or review General settings.")
    }

    private static func remoteHostLabel(from rawURL: String) -> String? {
        guard let url = URL(string: rawURL), let host = url.host else { return nil }
        if let port = url.port {
            return "\(host):\(port)"
        }
        return host
    }

    static func resolveNodesListState(
        instanceCount: Int,
        hasLoadedOnce: Bool,
        isLoading: Bool,
        lastError: String?,
        emptyMessage: String?,
        controlState: ControlChannel.ConnectionState,
        mode: AppState.ConnectionMode) -> NodesListState
    {
        guard instanceCount == 0 else { return .list }

        if !hasLoadedOnce || isLoading {
            return .loading(controlState == .connecting ? "Reconnecting to the runtime…" : "Checking for nodes…")
        }

        switch controlState {
        case .connecting:
            return .loading("Reconnecting to the runtime…")
        case .disconnected:
            return .error("Alisio is not connected to the runtime right now.")
        case let .degraded(message):
            return .error(Self.connectionFailurePresentation(message, mode: mode).summary)
        case .connected:
            break
        }

        if let lastError, !lastError.isEmpty {
            return .error(lastError)
        }
        return .empty(emptyMessage ?? "No nodes have checked in yet.")
    }

    @ViewBuilder
    private func instanceRow(_ inst: InstanceInfo) -> some View {
        let prettyPlatform = inst.platform.flatMap { self.prettyPlatform($0) }
        let device = DeviceModelCatalog.presentation(
            deviceFamily: inst.deviceFamily,
            modelIdentifier: inst.modelIdentifier)

        HStack(alignment: .top, spacing: 12) {
            self.leadingDeviceIcon(inst, device: device)
                .frame(width: 28, height: 28, alignment: .center)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(self.nodeDisplayName(for: inst)).font(.subheadline.bold())
                    self.presenceIndicator(inst)
                    if let ip = inst.ip {
                        Text(ip)
                            .monospaced()
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                HStack(spacing: 8) {
                    if let version = inst.version {
                        self.label(icon: "shippingbox", text: version)
                    }

                    if let device {
                        let family = (inst.deviceFamily ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        let isGeneric = !family.isEmpty && device.title == family
                        if !isGeneric {
                            if let prettyPlatform {
                                self.label(icon: device.symbol, text: "\(device.title) · \(prettyPlatform)")
                            } else {
                                self.label(icon: device.symbol, text: device.title)
                            }
                        } else if let prettyPlatform, let platform = inst.platform {
                            self.label(icon: self.platformIcon(platform), text: prettyPlatform)
                        }
                    } else if let prettyPlatform, let platform = inst.platform {
                        self.label(icon: self.platformIcon(platform), text: prettyPlatform)
                    }

                    if let role = self.nodeRoleLabel(for: inst) {
                        self.label(icon: "network", text: role)
                    }
                }
                .layoutPriority(1)

                if self.shouldShowActivityRow(inst) {
                    HStack(spacing: 8) {
                        self.label(icon: "clock", text: "Seen \(inst.ageDescription)")
                        if let secs = inst.lastInputSeconds {
                            self.label(icon: "timer", text: "Last input \(secs)s ago")
                        }
                    }
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 8)
        .contextMenu {
            Button("Copy node summary") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(self.nodeSummaryText(for: inst), forType: .string)
            }
        }
    }

    private func label(icon: String?, text: String) -> some View {
        HStack(spacing: 4) {
            if let icon, self.isSystemSymbolAvailable(icon) {
                Image(systemName: icon).foregroundStyle(.secondary).font(.caption)
            }
            Text(text)
        }
        .font(.footnote)
    }

    private func presenceIndicator(_ inst: InstanceInfo) -> some View {
        let status = self.presenceStatus(for: inst)
        return HStack(spacing: 4) {
            Circle()
                .fill(status.color)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(status.label)
                .foregroundStyle(.secondary)
        }
        .font(.caption)
        .accessibilityLabel("\(status.label) presence")
    }

    private func presenceStatus(for inst: InstanceInfo) -> (label: String, color: Color) {
        let nowMs = Date().timeIntervalSince1970 * 1000
        let ageSeconds = max(0, Int((nowMs - inst.ts) / 1000))
        if ageSeconds <= 120 { return ("Active", .green) }
        if ageSeconds <= 300 { return ("Idle", .yellow) }
        return ("Stale", .gray)
    }

    @ViewBuilder
    private func leadingDeviceIcon(_ inst: InstanceInfo, device: DevicePresentation?) -> some View {
        let symbol = self.leadingDeviceSymbol(inst, device: device)
        Image(systemName: symbol)
            .font(.system(size: 26, weight: .regular))
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
    }

    private func leadingDeviceSymbol(_ inst: InstanceInfo, device: DevicePresentation?) -> String {
        if let title = device?.title.lowercased() {
            if title.contains("mac studio") {
                return self.safeSystemSymbol("macstudio", fallback: "desktopcomputer")
            }
            if title.contains("macbook") {
                return self.safeSystemSymbol("laptopcomputer", fallback: "laptopcomputer")
            }
        }

        if let symbol = device?.symbol {
            return self.safeSystemSymbol(symbol, fallback: "cpu")
        }

        if let platform = inst.platform {
            return self.safeSystemSymbol(self.platformIcon(platform), fallback: "cpu")
        }

        return "cpu"
    }

    private func shouldShowActivityRow(_ inst: InstanceInfo) -> Bool {
        let age = inst.ageDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return !age.isEmpty || inst.lastInputSeconds != nil
    }

    private func safeSystemSymbol(_ preferred: String, fallback: String) -> String {
        if self.isSystemSymbolAvailable(preferred) { return preferred }
        return fallback
    }

    private func isSystemSymbolAvailable(_ name: String) -> Bool {
        NSImage(systemSymbolName: name, accessibilityDescription: nil) != nil
    }

    private func platformIcon(_ raw: String) -> String {
        let (prefix, _) = PlatformLabelFormatter.parse(raw)
        switch prefix {
        case "macos":
            return "laptopcomputer"
        default:
            return "cpu"
        }
    }

    private func prettyPlatform(_ raw: String) -> String? {
        PlatformLabelFormatter.pretty(raw)
    }

    private func nodeDisplayName(for inst: InstanceInfo) -> String {
        let host = inst.host?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !host.isEmpty {
            return host
        }
        let ip = inst.ip?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !ip.isEmpty {
            return ip
        }
        let family = inst.deviceFamily?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !family.isEmpty {
            return family
        }
        return "Unknown node"
    }

    private func nodeRoleLabel(for inst: InstanceInfo) -> String? {
        let trimmed = inst.mode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        switch trimmed {
        case "local":
            return "This Mac"
        case "remote":
            return "Remote"
        case "gateway":
            return "Gateway"
        default:
            return nil
        }
    }

    private func nodeSummaryText(for inst: InstanceInfo) -> String {
        var parts = [self.nodeDisplayName(for: inst), self.presenceStatus(for: inst).label]
        if let ip = inst.ip?.trimmingCharacters(in: .whitespacesAndNewlines), !ip.isEmpty {
            parts.append(ip)
        }
        if let platform = inst.platform.flatMap({ self.prettyPlatform($0) }), !platform.isEmpty {
            parts.append(platform)
        }
        if let version = inst.version?.trimmingCharacters(in: .whitespacesAndNewlines), !version.isEmpty {
            parts.append(version)
        }
        return parts.joined(separator: " · ")
    }
}

#if DEBUG
struct InstancesSettings_Previews: PreviewProvider {
    static var previews: some View {
        InstancesSettings(store: .preview())
            .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
            .environment(TailscaleService.shared)
    }
}
#endif
