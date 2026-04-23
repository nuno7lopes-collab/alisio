import AppKit
import SwiftUI

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

struct MacSetupSnapshot: Equatable {
    let runtime: MacSetupRuntimeState

    var canOpenWorkspace: Bool {
        self.runtime.isReady
    }

    var surfaceTitle: String {
        switch self.runtime {
        case .checking:
            "Checking this Mac"
        case .ready:
            "Opening the workspace"
        case .blocked:
            "Can't open the workspace yet"
        }
    }
}

enum MacSetupEvaluator {
    static func snapshot(
        connectionMode: AppState.ConnectionMode,
        gatewayStatus: GatewayEnvironmentStatus?,
        remoteProbe: RemoteGatewayProbeResult?) -> MacSetupSnapshot
    {
        MacSetupSnapshot(
            runtime: self.runtime(
                connectionMode: connectionMode,
                gatewayStatus: gatewayStatus,
                remoteProbe: remoteProbe))
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
    @State private var didLoadInitialState = false
    @State private var didAutoFinish = false
    @State private var gatewayStatus: GatewayEnvironmentStatus?
    @State private var remoteProbeResult: RemoteGatewayProbeResult?

    init(state: AppState = AppStateStore.shared) {
        self.state = state
    }

    var body: some View {
        let setup = MacSetupEvaluator.snapshot(
            connectionMode: self.state.connectionMode,
            gatewayStatus: self.gatewayStatus,
            remoteProbe: self.remoteProbeResult)

        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: setup.runtime.systemImage)
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundStyle(setup.runtime.tint)
                    .padding(.top, 8)

                VStack(spacing: 8) {
                    Text(setup.surfaceTitle)
                        .font(.largeTitle.weight(.semibold))
                    Text(setup.runtime.title)
                        .font(.title3.weight(.semibold))
                    Text(setup.runtime.detail)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 520)
                }

                if case .checking = setup.runtime {
                    ProgressView()
                        .controlSize(.regular)
                }

                HStack(spacing: 12) {
                    Button("Open General Settings") {
                        self.openSettings(tab: .general)
                    }
                    .buttonStyle(.borderedProminent)

                    if self.state.connectionMode != .unconfigured {
                        self.recheckButton
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
            await self.refreshRuntimeState()
        }
        .onChange(of: self.state.connectionMode) { _, _ in
            Task { await self.refreshRuntimeState() }
        }
        .onChange(of: self.state.remoteTransport) { _, _ in
            Task { await self.refreshRuntimeState() }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await self.refreshRuntimeState() }
        }
    }

    private func refreshRuntimeState() async {
        let snapshot = await self.state.refreshRuntimeReadinessSnapshot()
        self.gatewayStatus = snapshot.gatewayStatus
        self.remoteProbeResult = snapshot.remoteProbeResult

        self.finishIfReady()
    }

    private func openSettings(tab: SettingsTab) {
        SettingsWindowOpener.shared.open(tab: tab)
    }

    private func finishIfReady() {
        guard !self.didAutoFinish else { return }
        let setup = MacSetupEvaluator.snapshot(
            connectionMode: self.state.connectionMode,
            gatewayStatus: self.gatewayStatus,
            remoteProbe: self.remoteProbeResult)
        guard setup.canOpenWorkspace else { return }
        self.didAutoFinish = true
        self.finish()
    }

    private func finish() {
        AlisioWindowManager.shared.showPreferredChat()
    }

    private var recheckButton: some View {
        Button {
            Task { await self.refreshRuntimeState() }
        } label: {
            Label("Recheck", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
    }
}
