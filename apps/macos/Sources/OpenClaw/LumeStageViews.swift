import Observation
import OpenClawChatUI
import SwiftUI

private let lumeThinkingDefaultsKey = "openclaw.webchat.thinkingLevel"

struct LumeRouteHeader: View {
    let route: LumeShellState.Route

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(self.route.title)
                .font(.system(size: 28, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
            Text(self.route.subtitle)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct LumeSurface<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        self.content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(Color.white.opacity(0.06))
                    .background(
                        VisualEffectView(material: .hudWindow, blendingMode: .behindWindow)
                            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.10), lineWidth: 1))
            }
    }
}

struct LumeChatStageView: View {
    let sessionKey: String
    let accentHex: String?
    let onSessionKeyChanged: (String) -> Void

    var body: some View {
        LumeSurface {
            OpenClawChatView(
                viewModel: OpenClawChatViewModel(
                    sessionKey: self.sessionKey,
                    transport: MacGatewayChatTransport(),
                    initialThinkingLevel: UserDefaults.standard.string(forKey: lumeThinkingDefaultsKey) ?? "medium",
                    onThinkingLevelChanged: { level in
                        UserDefaults.standard.set(level, forKey: lumeThinkingDefaultsKey)
                    },
                    onSessionKeyChanged: self.onSessionKeyChanged),
                showsSessionSwitcher: true,
                style: .lume,
                userAccent: Self.color(fromHex: self.accentHex))
                .id(self.sessionKey)
        }
    }

    private static func color(fromHex hex: String?) -> Color? {
        guard let hex else { return nil }
        let sanitized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard sanitized.count == 6, let value = Int(sanitized, radix: 16) else { return nil }
        let red = Double((value >> 16) & 0xFF) / 255
        let green = Double((value >> 8) & 0xFF) / 255
        let blue = Double(value & 0xFF) / 255
        return Color(red: red, green: green, blue: blue)
    }
}

@MainActor
struct LumeRuntimeStageView: View {
    @Bindable var state: AppState
    @Bindable private var gatewayManager = GatewayProcessManager.shared
    @Bindable private var controlChannel = ControlChannel.shared
    @Bindable private var healthStore = HealthStore.shared

    var body: some View {
        LumeSurface {
            VStack(alignment: .leading, spacing: 18) {
                self.statusGrid
                self.quickActions
                self.gatewayLog
            }
            .padding(24)
        }
    }

    private var statusGrid: some View {
        VStack(spacing: 14) {
            HStack(spacing: 14) {
                self.metricCard(
                    title: "Mode",
                    value: self.connectionModeLabel,
                    detail: "How this app reaches the gateway.")
                self.metricCard(
                    title: "Gateway",
                    value: self.gatewayManager.status.label,
                    detail: "Local process state on this Mac.")
            }

            HStack(spacing: 14) {
                self.metricCard(
                    title: "Control",
                    value: self.controlStateLabel,
                    detail: "Live control channel connection.")
                self.metricCard(
                    title: "Health",
                    value: self.healthStore.summaryLine,
                    detail: self.healthStore.detailLine ?? "Recent linked-channel health snapshot.")
            }
        }
    }

    private func metricCard(title: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 18, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.045))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)))
    }

    private var quickActions: some View {
        HStack(spacing: 10) {
            Button("Refresh Health") {
                Task { await self.healthStore.refresh(onDemand: true) }
            }
            .buttonStyle(.borderedProminent)

            if self.state.connectionMode == .local {
                Button("Restart Gateway") {
                    DebugActions.restartGateway()
                }
                .buttonStyle(.bordered)
            }

            Button("Open Settings") {
                LumeWindowManager.shared.showSettings(tab: .general)
            }
            .buttonStyle(.bordered)

            Spacer(minLength: 0)
        }
    }

    private var gatewayLog: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Gateway Log")
                    .font(.headline)
                Spacer(minLength: 0)
                Button("Refresh") {
                    self.gatewayManager.refreshLog()
                }
                .buttonStyle(.bordered)
            }

            ScrollView {
                Text(self.gatewayManager.log.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "No recent gateway log lines."
                    : self.gatewayManager.log)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .textSelection(.enabled)
            }
            .frame(minHeight: 220)
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.black.opacity(0.18))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)))
        }
    }

    private var connectionModeLabel: String {
        switch self.state.connectionMode {
        case .unconfigured: "Unconfigured"
        case .local: "Local"
        case .remote: "Remote"
        }
    }

    private var controlStateLabel: String {
        switch self.controlChannel.state {
        case .disconnected: "Disconnected"
        case .connecting: "Connecting…"
        case .connected: "Connected"
        case let .degraded(message):
            if message.isEmpty { return "Degraded" }
            return "Degraded · \(message)"
        }
    }
}

@MainActor
struct LumeSettingsStageView: View {
    @Bindable var state: AppState
    let updater: UpdaterProviding?
    let selectedTab: SettingsTab

    var body: some View {
        LumeSurface {
            Group {
                switch self.selectedTab {
                case .general:
                    GeneralSettings(state: self.state)
                case .channels:
                    ChannelsSettings()
                case .skills:
                    SkillsSettings(state: self.state)
                case .sessions:
                    SessionsSettings()
                case .cron:
                    CronSettings()
                case .config:
                    ConfigSettings()
                case .instances:
                    InstancesSettings()
                case .voiceWake:
                    VoiceWakeSettings(state: self.state, isActive: true)
                case .permissions:
                    PermissionsSettings(
                        status: PermissionMonitor.shared.status,
                        refresh: {
                            await PermissionMonitor.shared.refreshNow()
                        },
                        showOnboarding: { DebugActions.restartOnboarding() })
                case .debug:
                    DebugSettings(state: self.state)
                case .about:
                    AboutSettings(updater: self.updater)
                }
            }
        }
    }
}
