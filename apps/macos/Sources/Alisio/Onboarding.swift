import AppKit
import SwiftUI

import AlisioIPC
import AlisioSupport

enum MacSetupRuntimeState: Equatable {
    case checking(title: String, detail: String)
    case ready(title: String, detail: String)
    case blocked(title: String, detail: String)

    var title: String {
        switch self {
        case let .checking(title, _), let .ready(title, _), let .blocked(title, _):
            title
        }
    }

    var detail: String {
        switch self {
        case let .checking(_, detail), let .ready(_, detail), let .blocked(_, detail):
            detail
        }
    }

    var systemImage: String {
        switch self {
        case .checking:
            "hourglass"
        case .ready:
            "checkmark.circle"
        case .blocked:
            "exclamationmark.circle"
        }
    }

    var tint: Color {
        switch self {
        case .checking:
            .secondary
        case .ready:
            .green
        case .blocked:
            .orange
        }
    }

    var isReady: Bool {
        if case .ready = self {
            return true
        }
        return false
    }
}

struct MacSetupPermissionSummary: Equatable {
    let hasSnapshot: Bool
    let grantedCount: Int
    let totalCount: Int

    init(status: [Capability: Bool]) {
        self.hasSnapshot = !status.isEmpty
        self.totalCount = Capability.allCases.count
        self.grantedCount = Capability.allCases.reduce(into: 0) { total, capability in
            if status[capability] == true {
                total += 1
            }
        }
    }

    var missingCount: Int {
        max(self.totalCount - self.grantedCount, 0)
    }

    var summary: String {
        if !self.hasSnapshot {
            return "Checking macOS permissions."
        }
        if self.missingCount == 0 {
            return "All reviewed permissions are on."
        }
        if self.missingCount == 1 {
            return "1 permission is still off."
        }
        return "\(self.missingCount) permissions are still off."
    }

    var detail: String {
        if !self.hasSnapshot {
            return "Permissions refresh after the app checks macOS. Nothing here blocks the workspace."
        }
        if self.missingCount == 0 {
            return "You can still change Accessibility, Screen Recording, microphone, location, or other device access later in Settings."
        }
        return "Permissions stay optional until you turn on the feature that needs them."
    }

    var systemImage: String {
        if !self.hasSnapshot {
            return "lock.shield"
        }
        return self.missingCount == 0 ? "checkmark.shield" : "lock.shield"
    }

    var tint: Color {
        if !self.hasSnapshot {
            return .secondary
        }
        return self.missingCount == 0 ? .green : .orange
    }
}

struct MacSetupSnapshot: Equatable {
    let runtime: MacSetupRuntimeState
    let permissions: MacSetupPermissionSummary

    var canOpenWorkspace: Bool {
        self.runtime.isReady
    }

    var statusTitle: String {
        switch self.runtime {
        case .checking:
            "Checking this Mac"
        case .ready:
            "This Mac is ready"
        case .blocked:
            "Finish runtime setup to open the workspace"
        }
    }

    var statusDetail: String {
        switch self.runtime {
        case let .checking(_, detail):
            return detail
        case let .blocked(_, detail):
            if self.permissions.hasSnapshot, self.permissions.missingCount > 0 {
                return "\(detail) Permissions can wait until you need the matching feature."
            }
            return detail
        case .ready:
            if !self.permissions.hasSnapshot {
                return "The runtime is ready. Permission status is still refreshing."
            }
            if self.permissions.missingCount == 0 {
                return "The runtime is ready and nothing else is blocking the workspace."
            }
            if self.permissions.missingCount == 1 {
                return "The runtime is ready. 1 optional permission is still off and can be enabled later in Settings."
            }
            return "The runtime is ready. \(self.permissions.missingCount) optional permissions are still off and can be enabled later in Settings."
        }
    }
}

enum MacSetupEvaluator {
    static func snapshot(
        connectionMode: AppState.ConnectionMode,
        gatewayStatus: GatewayEnvironmentStatus?,
        remoteProbe: RemoteGatewayProbeResult?,
        permissionStatus: [Capability: Bool]) -> MacSetupSnapshot
    {
        MacSetupSnapshot(
            runtime: self.runtime(
                connectionMode: connectionMode,
                gatewayStatus: gatewayStatus,
                remoteProbe: remoteProbe),
            permissions: MacSetupPermissionSummary(status: permissionStatus))
    }

    static func runtime(
        connectionMode: AppState.ConnectionMode,
        gatewayStatus: GatewayEnvironmentStatus?,
        remoteProbe: RemoteGatewayProbeResult?) -> MacSetupRuntimeState
    {
        switch connectionMode {
        case .unconfigured:
            return .blocked(
                title: "Choose where this Mac connects to Alisio",
                detail: "Pick Local or Remote in General Settings before opening the workspace.")

        case .local:
            guard let gatewayStatus else {
                return .checking(
                    title: "Checking the local runtime",
                    detail: "Alisio is verifying the local runtime on this Mac.")
            }

            switch gatewayStatus.kind {
            case .checking:
                return .checking(
                    title: "Checking the local runtime",
                    detail: "Alisio is verifying the local runtime on this Mac.")
            case .ok:
                return .ready(
                    title: "Local runtime ready",
                    detail: "This Mac can run Alisio locally.")
            case .missingNode:
                return .blocked(
                    title: "Install Node on this Mac",
                    detail: "Local mode needs Node 22 or later before Alisio can open the workspace.")
            case .missingGateway:
                return .blocked(
                    title: "Install the Alisio runtime",
                    detail: "Local mode needs the Alisio CLI on this Mac before the workspace can open.")
            case let .incompatible(found, required):
                return .blocked(
                    title: "Update the local runtime",
                    detail: "This Mac has Alisio runtime \(found), but this app needs \(required). Update the runtime, then recheck.")
            case let .error(message):
                let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
                return .blocked(
                    title: "Finish local runtime setup",
                    detail: trimmed.isEmpty
                        ? "Alisio could not confirm the local runtime on this Mac."
                        : trimmed)
            }

        case .remote:
            guard let remoteProbe else {
                return .checking(
                    title: "Checking the remote runtime",
                    detail: "Alisio is testing the remote connection for this Mac.")
            }

            switch remoteProbe {
            case let .ready(success):
                return .ready(
                    title: success.title,
                    detail: success.detail ?? "This Mac can reach its remote Alisio runtime.")
            case let .authIssue(issue):
                return .blocked(
                    title: issue.title,
                    detail: issue.statusMessage)
            case let .failed(message):
                let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
                return .blocked(
                    title: "Finish the remote connection",
                    detail: trimmed.isEmpty
                        ? "Alisio could not reach the selected remote runtime."
                        : trimmed)
            }
        }
    }
}

struct MacSetupView: View {
    @Bindable var state: AppState
    var permissionMonitor: PermissionMonitor
    @State private var didLoadInitialState = false
    @State private var gatewayStatus: GatewayEnvironmentStatus?
    @State private var remoteProbeResult: RemoteGatewayProbeResult?

    init(
        state: AppState = AppStateStore.shared,
        permissionMonitor: PermissionMonitor = .shared)
    {
        self.state = state
        self.permissionMonitor = permissionMonitor
    }

    var body: some View {
        let setup = MacSetupEvaluator.snapshot(
            connectionMode: self.state.connectionMode,
            gatewayStatus: self.gatewayStatus,
            remoteProbe: self.remoteProbeResult,
            permissionStatus: self.permissionMonitor.status)

        ScrollView {
            VStack(spacing: 24) {
                AlisioOnboardingIcon()
                    .padding(.top, 8)

                VStack(spacing: 10) {
                    Text("Set up this Mac")
                        .font(.largeTitle.weight(.semibold))
                    Text(
                        "Confirm how this Mac reaches Alisio, then review any optional permissions before opening the workspace.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 560)
                }

                self.setupCard(
                    title: "Runtime",
                    badgeTitle: "Required",
                    badgeTint: .orange,
                    summary: setup.runtime.title,
                    detail: setup.runtime.detail,
                    systemImage: setup.runtime.systemImage,
                    tint: setup.runtime.tint,
                    actionTitle: "Open General Settings",
                    action: { self.openSettings(tab: .general) },
                    secondaryActionTitle: self.state.connectionMode == .unconfigured ? nil : "Recheck",
                    secondaryAction: self.state.connectionMode == .unconfigured
                        ? nil
                        : { Task { await self.refreshRuntimeState() } })

                self.setupCard(
                    title: "Permissions",
                    badgeTitle: "Optional",
                    badgeTint: .secondary,
                    summary: setup.permissions.summary,
                    detail: setup.permissions.detail,
                    systemImage: setup.permissions.systemImage,
                    tint: setup.permissions.tint,
                    actionTitle: "Open Permissions",
                    action: { self.openSettings(tab: .permissions) })

                VStack(alignment: .leading, spacing: 10) {
                    Text(setup.statusTitle)
                        .font(.headline)
                    Text(setup.statusDetail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color(nsColor: .controlBackgroundColor)))

                HStack(spacing: 12) {
                    if setup.canOpenWorkspace {
                        Button("General Settings") {
                            self.openSettings(tab: .general)
                        }
                        .buttonStyle(.bordered)
                    } else {
                        Button("General Settings") {
                            self.openSettings(tab: .general)
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    Button("Permissions") {
                        self.openSettings(tab: .permissions)
                    }
                    .buttonStyle(.bordered)

                    if self.state.connectionMode != .unconfigured {
                        Button {
                            Task { await self.refreshSetupState() }
                        } label: {
                            Label("Recheck", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered)
                    }

                    if setup.canOpenWorkspace {
                        Button("Open Workspace") {
                            self.finish()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(nsColor: .windowBackgroundColor))
        .task {
            guard !self.didLoadInitialState else { return }
            self.didLoadInitialState = true
            await self.refreshSetupState()
        }
        .onChange(of: self.state.connectionMode) { _, _ in
            Task { await self.refreshRuntimeState() }
        }
        .onChange(of: self.state.remoteTransport) { _, _ in
            Task { await self.refreshRuntimeState() }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await self.refreshSetupState() }
        }
    }

    private func refreshSetupState() async {
        await self.permissionMonitor.refreshNow()
        await self.refreshRuntimeState()
    }

    private func refreshRuntimeState() async {
        switch self.state.connectionMode {
        case .unconfigured:
            self.gatewayStatus = nil
            self.remoteProbeResult = nil
        case .local:
            self.remoteProbeResult = nil
            self.gatewayStatus = await Task.detached(priority: .utility) {
                GatewayEnvironment.check()
            }.value
        case .remote:
            self.gatewayStatus = nil
            self.remoteProbeResult = await RemoteGatewayProbe.run()
        }
    }

    private func openSettings(tab: SettingsTab) {
        SettingsWindowOpener.shared.open(tab: tab)
    }

    private func finish() {
        self.state.completeMacSetup()
        AlisioWindowManager.shared.showPreferredChat()
    }

    @ViewBuilder
    private func setupCard(
        title: String,
        badgeTitle: String,
        badgeTint: Color,
        summary: String,
        detail: String,
        systemImage: String,
        tint: Color,
        actionTitle: String,
        action: @escaping () -> Void,
        secondaryActionTitle: String? = nil,
        secondaryAction: (() -> Void)? = nil) -> some View
    {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: systemImage)
                .font(.title2.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .center, spacing: 10) {
                    Text(title)
                        .font(.headline)
                    MacSetupBadge(title: badgeTitle, tint: badgeTint)
                }

                Text(summary)
                    .font(.subheadline.weight(.semibold))

                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 12) {
                    Button(actionTitle, action: action)
                        .buttonStyle(.link)

                    if let secondaryActionTitle, let secondaryAction {
                        Button(secondaryActionTitle, action: secondaryAction)
                            .buttonStyle(.link)
                    }
                }
                .padding(.top, 2)
            }

            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor)))
    }
}

private struct MacSetupBadge: View {
    let title: String
    let tint: Color

    var body: some View {
        Text(self.title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(self.tint)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(
                Capsule()
                    .fill(self.tint.opacity(0.12)))
    }
}
