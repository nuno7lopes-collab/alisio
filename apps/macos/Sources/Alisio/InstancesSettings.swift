import AppKit
import SwiftUI

import AlisioSupport

enum ConnectionsSurfaceStatus: Equatable {
    case connected
    case connecting
    case attention

    var label: String {
        switch self {
        case .connected:
            "Connected"
        case .connecting:
            "Connecting"
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
    @Bindable var store: InstancesStore
    @Bindable var state: AppState
    @Bindable private var healthStore = HealthStore.shared
    @Bindable private var controlChannel = ControlChannel.shared
    @Bindable private var connectivityCoordinator = GatewayConnectivityCoordinator.shared

    init(store: InstancesStore = .shared, state: AppState = AppStateStore.shared) {
        self.store = store
        self.state = state
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
        .onDisappear { self.store.stop() }
    }

    private var isRefreshingSurface: Bool {
        self.store.isLoading || self.healthStore.isRefreshing
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Connections")
                    .font(.headline)
                Text("See how this Mac reaches the runtime, whether health checks are passing, and which nodes are alive.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            SettingsRefreshButton(isLoading: self.isRefreshingSurface) {
                Task { await self.refreshAll() }
            }
        }
    }

    private var connectionOverview: ConnectionOverview {
        Self.resolveConnectionOverview(
            mode: self.state.connectionMode,
            remoteTransport: self.state.remoteTransport,
            remoteTarget: self.state.remoteTarget,
            remoteURL: self.state.remoteUrl,
            endpointState: self.connectivityCoordinator.endpointState,
            controlState: self.controlChannel.state)
    }

    private var connectionCard: some View {
        self.surfaceCard(title: self.connectionOverview.title, systemImage: "network") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(self.connectionOverview.status.color)
                        .frame(width: 10, height: 10)
                    Text(self.connectionOverview.summary)
                        .font(.callout.weight(.semibold))
                    Spacer()
                    self.statusPill(
                        self.connectionOverview.status.label,
                        color: self.connectionOverview.status.color)
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
            }
        }
    }

    private var healthCard: some View {
        self.surfaceCard(title: "Health", systemImage: "stethoscope") {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(self.healthStore.state.tint)
                        .frame(width: 10, height: 10)
                    Text(self.healthStore.summaryLine)
                        .font(.callout.weight(.semibold))
                }

                if let detail = self.healthStore.detailLine, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let lastSuccess = self.healthStore.lastSuccess {
                    Text("Last checked \(relativeAge(from: lastSuccess)).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if self.healthStore.isRefreshing {
                    Text("Running a fresh health check.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Health check has not completed yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var nodesCard: some View {
        self.surfaceCard(title: "Nodes", systemImage: "desktopcomputer.trianglebadge.exclamationmark") {
            VStack(alignment: .leading, spacing: 10) {
                if let err = self.store.lastError, !err.isEmpty {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let info = self.store.statusMessage, !info.isEmpty {
                    Text(info)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if self.store.instances.isEmpty {
                    Text("No local or remote nodes have reported in yet.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
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

    private func surfaceCard(
        title: String,
        systemImage: String,
        @ViewBuilder content: () -> some View) -> some View
    {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            content()
        }
        .padding(14)
        .background(Color.gray.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func statusPill(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.14))
            .foregroundStyle(color)
            .clipShape(Capsule())
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

    static func resolveConnectionOverview(
        mode: AppState.ConnectionMode,
        remoteTransport: AppState.RemoteTransport,
        remoteTarget: String,
        remoteURL: String,
        endpointState: GatewayEndpointState?,
        controlState: ControlChannel.ConnectionState) -> ConnectionOverview
    {
        let accessLabel: (String?, String?) -> String = { token, password in
            if let token, !token.isEmpty {
                return "Gateway token"
            }
            if let password, !password.isEmpty {
                return "Password"
            }
            return "No gateway auth"
        }

        let trimmedTarget = remoteTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedRemoteURL = remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)

        let controlDetail: String? = {
            switch controlState {
            case let .degraded(message):
                return message.nonEmpty
            case .connecting:
                return "The control channel is still connecting."
            case .connected, .disconnected:
                return nil
            }
        }()

        switch mode {
        case .unconfigured:
            return ConnectionOverview(
                title: "Gateway not configured",
                summary: "Choose local or remote mode before using connections.",
                detail: "General settings is the single place to set how this Mac should reach Alisio.",
                status: .attention,
                facts: [])
        case .local:
            switch endpointState {
            case let .ready(_, url, token, password):
                return ConnectionOverview(
                    title: "Local runtime",
                    summary: "This Mac is connected directly to the local gateway.",
                    detail: controlDetail,
                    status: .connected,
                    facts: [
                        ConnectionFact(label: "Route", value: "This Mac"),
                        ConnectionFact(label: "Gateway", value: Self.hostLabel(for: url)),
                        ConnectionFact(label: "Access", value: accessLabel(token, password)),
                    ])
            case let .connecting(_, detail):
                return ConnectionOverview(
                    title: "Starting local runtime",
                    summary: detail,
                    detail: controlDetail,
                    status: .connecting,
                    facts: [
                        ConnectionFact(label: "Route", value: "This Mac"),
                    ])
            case let .unavailable(_, reason):
                return ConnectionOverview(
                    title: "Local runtime unavailable",
                    summary: reason,
                    detail: controlDetail,
                    status: .attention,
                    facts: [
                        ConnectionFact(label: "Route", value: "This Mac"),
                    ])
            case .none:
                return ConnectionOverview(
                    title: "Local runtime",
                    summary: "Waiting to resolve the local gateway endpoint.",
                    detail: controlDetail,
                    status: .connecting,
                    facts: [
                        ConnectionFact(label: "Route", value: "This Mac"),
                    ])
            }
        case .remote:
            let routeValue = remoteTransport == .direct ? "Direct URL" : "SSH tunnel"
            let targetValue = remoteTransport == .direct
                ? (Self.remoteHostLabel(from: trimmedRemoteURL) ?? "Remote gateway")
                : (trimmedTarget.isEmpty ? "Remote gateway" : trimmedTarget)

            switch endpointState {
            case let .ready(_, _, token, password):
                let summary = remoteTransport == .direct
                    ? "This Mac is connected to a remote gateway over a direct URL."
                    : "This Mac is connected to a remote gateway over SSH tunnel."
                return ConnectionOverview(
                    title: "Remote runtime",
                    summary: summary,
                    detail: controlDetail,
                    status: .connected,
                    facts: [
                        ConnectionFact(label: "Route", value: routeValue),
                        ConnectionFact(label: "Target", value: targetValue),
                        ConnectionFact(label: "Access", value: accessLabel(token, password)),
                    ])
            case let .connecting(_, detail):
                return ConnectionOverview(
                    title: "Connecting to remote runtime",
                    summary: detail,
                    detail: controlDetail,
                    status: .connecting,
                    facts: [
                        ConnectionFact(label: "Route", value: routeValue),
                        ConnectionFact(label: "Target", value: targetValue),
                    ])
            case let .unavailable(_, reason):
                return ConnectionOverview(
                    title: "Remote runtime unavailable",
                    summary: reason,
                    detail: controlDetail,
                    status: .attention,
                    facts: [
                        ConnectionFact(label: "Route", value: routeValue),
                        ConnectionFact(label: "Target", value: targetValue),
                    ])
            case .none:
                return ConnectionOverview(
                    title: "Remote runtime",
                    summary: "Waiting to resolve the remote gateway endpoint.",
                    detail: controlDetail,
                    status: .connecting,
                    facts: [
                        ConnectionFact(label: "Route", value: routeValue),
                        ConnectionFact(label: "Target", value: targetValue),
                    ])
            }
        }
    }

    private static func remoteHostLabel(from rawURL: String) -> String? {
        guard let url = URL(string: rawURL), let host = url.host else { return nil }
        if let port = url.port {
            return "\(host):\(port)"
        }
        return host
    }

    private static func hostLabel(for url: URL) -> String {
        let host = url.host ?? url.absoluteString
        if let port = url.port {
            return "\(host):\(port)"
        }
        return host
    }

    @ViewBuilder
    private func instanceRow(_ inst: InstanceInfo) -> some View {
        let isGateway = (inst.mode ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "gateway"
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
                    Text(inst.host ?? "unknown host").font(.subheadline.bold())
                    self.presenceIndicator(inst)
                    if let ip = inst.ip { Text("(") + Text(ip).monospaced() + Text(")") }
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

                    if let mode = inst.mode {
                        self.label(icon: "network", text: mode.capitalized)
                    }
                }
                .layoutPriority(1)

                if !isGateway, self.shouldShowUpdateRow(inst) {
                    HStack(spacing: 8) {
                        Spacer(minLength: 0)

                        if let secs = inst.lastInputSeconds {
                            self.label(icon: "clock", text: "\(secs)s ago")
                        }

                        if let update = self.updateSummaryText(inst, isGateway: isGateway) {
                            self.label(icon: "arrow.clockwise", text: update)
                                .help(self.presenceUpdateSourceHelp(inst.reason ?? ""))
                        }
                    }
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 8)
        .help(inst.text)
        .contextMenu {
            Button("Copy Debug Summary") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(inst.text, forType: .string)
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
        .help("Presence updated \(inst.ageDescription).")
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

    private func shouldShowUpdateRow(_ inst: InstanceInfo) -> Bool {
        if inst.lastInputSeconds != nil { return true }
        if self.updateSummaryText(inst, isGateway: false) != nil { return true }
        return false
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

    private func presenceUpdateSourceShortText(_ reason: String) -> String? {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        switch trimmed {
        case "self":
            return "Self"
        case "connect":
            return "Connect"
        case "disconnect":
            return "Disconnect"
        case "node-connected":
            return "Node connect"
        case "node-disconnected":
            return "Node disconnect"
        case "launch":
            return "Launch"
        case "periodic":
            return "Heartbeat"
        case "instances-refresh":
            return "Instances"
        case "seq gap":
            return "Resync"
        default:
            return trimmed
        }
    }

    private func updateSummaryText(_ inst: InstanceInfo, isGateway: Bool) -> String? {
        if isGateway {
            return nil
        }

        let age = inst.ageDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !age.isEmpty else { return nil }

        let source = self.presenceUpdateSourceShortText(inst.reason ?? "")
        if let source, !source.isEmpty {
            return "\(age) · \(source)"
        }
        return age
    }

    private func presenceUpdateSourceHelp(_ reason: String) -> String {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "Why this presence entry was last updated (debug marker)."
        }
        return "Why this presence entry was last updated (debug marker). Raw: \(trimmed)"
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
