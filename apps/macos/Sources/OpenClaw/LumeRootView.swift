import Observation
import SwiftUI

@MainActor
struct LumeRootView: View {
    @Bindable var state: AppState
    @Bindable private var controlChannel = ControlChannel.shared
    @Bindable private var gatewayManager = GatewayProcessManager.shared
    @Bindable private var healthStore = HealthStore.shared
    let updater: UpdaterProviding?
    @Bindable var shellState: LumeShellState

    private let secondarySidebarWidth: CGFloat = 272
    private let primaryRailWidth: CGFloat = 92

    var body: some View {
        ZStack {
            self.backdrop

            HStack(spacing: 0) {
                self.primaryRail
                self.shellDivider
                self.secondarySidebar
                self.shellDivider
                self.mainStage
            }
            .padding(18)
        }
        .frame(minWidth: 1120, minHeight: 760)
    }

    private var backdrop: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
            LinearGradient(
                colors: [
                    Color(nsColor: .windowBackgroundColor),
                    Color(red: 0.93, green: 0.91, blue: 0.88).opacity(0.32),
                    Color.black.opacity(0.18),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing)
            RadialGradient(
                colors: [
                    Color(red: 0.92, green: 0.62, blue: 0.34).opacity(0.22),
                    .clear,
                ],
                center: .topLeading,
                startRadius: 30,
                endRadius: 360)
            RadialGradient(
                colors: [
                    Color(red: 0.35, green: 0.52, blue: 0.50).opacity(0.18),
                    .clear,
                ],
                center: .bottomTrailing,
                startRadius: 40,
                endRadius: 340)
            Color.black.opacity(0.08)
        }
        .ignoresSafeArea()
    }

    private var primaryRail: some View {
        VStack(alignment: .center, spacing: 18) {
            VStack(spacing: 6) {
                Text("L")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)
                    .frame(width: 52, height: 52)
                    .background(
                        Circle()
                            .fill(Color.white.opacity(0.09))
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.10), lineWidth: 1)))
                Text("Lume")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 10)

            VStack(spacing: 8) {
                ForEach(LumeShellState.Route.allCases) { route in
                    Button {
                        self.shellState.show(route: route)
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: route.symbolName)
                                .font(.system(size: 16, weight: .semibold))
                            Text(route.title)
                                .font(.system(size: 11, weight: .semibold))
                                .lineLimit(1)
                        }
                        .foregroundStyle(self.shellState.route == route ? .primary : .secondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 62)
                        .background(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .fill(self.shellState.route == route ? Color.white.opacity(0.10) : .clear)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                                        .strokeBorder(
                                            self.shellState.route == route
                                                ? Color.white.opacity(0.12)
                                                : Color.clear,
                                            lineWidth: 1)))
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer(minLength: 0)

            VStack(spacing: 8) {
                Circle()
                    .fill(self.statusColor)
                    .frame(width: 8, height: 8)
                Text(self.connectionModeLabel)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.bottom, 10)
        }
        .padding(12)
        .frame(width: self.primaryRailWidth)
        .background {
            VisualEffectView(material: .sidebar, blendingMode: .behindWindow)
                .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 30, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.09), lineWidth: 1))
        }
    }

    private var secondarySidebar: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text(self.shellState.route.title)
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                Text(self.sidebarDescription)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 6)

            self.sidebarContent

            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(width: self.secondarySidebarWidth, maxHeight: .infinity, alignment: .topLeading)
        .background {
            VisualEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
                .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 30, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
        }
    }

    @ViewBuilder
    private var sidebarContent: some View {
        switch self.shellState.route {
        case .chat:
            self.chatSidebar
        case .runtime:
            self.runtimeSidebar
        case .sessions:
            self.sessionsSidebar
        case .skills:
            self.skillsSidebar
        case .settings:
            self.settingsSidebar
        }
    }

    private var chatSidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            self.sidebarCard(
                title: "Active Session",
                value: self.shellState.activeSessionKey ?? "Loading…",
                detail: "This is the current chat context kept by the local gateway.")

            Button("Open Main Session") {
                Task { @MainActor in
                    let sessionKey = await WebChatManager.shared.preferredSessionKey()
                    self.shellState.showChat(sessionKey: sessionKey)
                }
            }
            .buttonStyle(.borderedProminent)

            Button("Go to Runtime") {
                self.shellState.show(route: .runtime)
            }
            .buttonStyle(.bordered)
        }
    }

    private var runtimeSidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            self.sidebarCard(
                title: "Gateway",
                value: self.gatewayManager.status.label,
                detail: "The local runtime stays here while the shell controls it.")
            self.sidebarCard(
                title: "Health",
                value: self.healthStore.summaryLine,
                detail: self.healthStore.detailLine ?? "The latest control probe result.")
        }
    }

    private var sessionsSidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            self.sidebarCard(
                title: "What Lives Here",
                value: "Context Buckets",
                detail: "Sessions are conversation buckets reused for context, tools, and routing.")
            Button("Open Chat") {
                LumeWindowManager.shared.show(route: .chat)
            }
            .buttonStyle(.bordered)
        }
    }

    private var skillsSidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            self.sidebarCard(
                title: "Readiness",
                value: "Local Capabilities",
                detail: "Skills are only useful when their binaries, env vars, and config are present.")
            Button("Open Settings") {
                self.shellState.showSettings(tab: .skills)
            }
            .buttonStyle(.bordered)
        }
    }

    private var settingsSidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(self.visibleSettingsTabs, id: \.self) { tab in
                    Button {
                        self.shellState.selectedSettingsTab = tab
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: tab.systemImage)
                                .font(.system(size: 13, weight: .semibold))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(tab.title)
                                    .font(.system(size: 13, weight: .semibold))
                                Text(self.settingsTabSubtitle(tab))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(self.shellState.selectedSettingsTab == tab ? .primary : .secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(self.shellState.selectedSettingsTab == tab ? Color.white.opacity(0.08) : .clear)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .strokeBorder(
                                            self.shellState.selectedSettingsTab == tab
                                                ? Color.white.opacity(0.10)
                                                : Color.clear,
                                            lineWidth: 1)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func sidebarCard(title: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.05))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)))
    }

    private var mainStage: some View {
        VStack(alignment: .leading, spacing: 18) {
            LumeRouteHeader(route: self.shellState.route)
            self.stageContent
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var stageContent: some View {
        switch self.shellState.route {
        case .chat:
            LumeChatStageView(
                sessionKey: self.shellState.activeSessionKey ?? "main",
                accentHex: self.state.seamColorHex,
                onSessionKeyChanged: { sessionKey in
                    self.shellState.activeSessionKey = sessionKey
                })
        case .runtime:
            LumeRuntimeStageView(state: self.state)
        case .sessions:
            LumeSurface {
                SessionsSettings()
                    .padding(24)
            }
        case .skills:
            LumeSurface {
                SkillsSettings(state: self.state)
                    .padding(24)
            }
        case .settings:
            LumeSettingsStageView(
                state: self.state,
                updater: self.updater,
                selectedTab: self.shellState.selectedSettingsTab)
                .padding(.bottom, 1)
        }
    }

    private var shellDivider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.07))
            .frame(width: 1)
            .padding(.vertical, 12)
    }

    private var connectionModeLabel: String {
        switch self.state.connectionMode {
        case .unconfigured: "Setup"
        case .local: "Local"
        case .remote: "Remote"
        }
    }

    private var statusColor: Color {
        switch self.state.connectionMode {
        case .unconfigured: .orange
        case .local, .remote:
            switch self.controlChannel.state {
            case .connected: .green
            case .connecting: .orange
            case .disconnected, .degraded: .red
            }
        }
    }

    private var sidebarDescription: String {
        switch self.shellState.route {
        case .chat:
            "A cleaner, persistent surface for the main agent conversation."
        case .runtime:
            "Live runtime state without jumping into technical panels."
        case .sessions:
            "Historical context buckets and their recent load."
        case .skills:
            "Installed tools and readiness checks for this machine."
        case .settings:
            "One settings surface instead of separate windows and tabs."
        }
    }

    private var visibleSettingsTabs: [SettingsTab] {
        SettingsTab.allCases.filter { tab in
            if tab == .debug {
                return self.state.debugPaneEnabled
            }
            return true
        }
    }

    private func settingsTabSubtitle(_ tab: SettingsTab) -> String {
        switch tab {
        case .general: "Core app behavior"
        case .channels: "Linked channels and providers"
        case .skills: "Local capabilities"
        case .sessions: "Saved chat buckets"
        case .cron: "Scheduled jobs"
        case .config: "Config and paths"
        case .instances: "Detected runtimes"
        case .voiceWake: "Wake words and audio"
        case .permissions: "macOS access and prompts"
        case .debug: "Diagnostics and developer tools"
        case .about: "Version and updates"
        }
    }
}
